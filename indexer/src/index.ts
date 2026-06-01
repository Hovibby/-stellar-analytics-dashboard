import "dotenv/config";
import http from "http";
import { Pool } from "pg";
import { Horizon } from "@stellar/stellar-sdk";
import { pollLatestLedger } from "./ingester.js";
import {
  normalizeLedger,
  normalizeTransactions,
  normalizeOperations,
  normalizePayments,
} from "./transformer.js";
import { writeIngestedData, type BatchMetrics } from "./loader.js";
import { broadcastRealtimeUpdate } from "./websocket.js";
import { validateConfig, type StellarNetwork } from "./config.js";
import { indexerLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Validate configuration on startup – fails fast with clear error messages
// ---------------------------------------------------------------------------
const config = validateConfig();

const pool = config.databaseUrl
  ? new Pool({ connectionString: config.databaseUrl })
  : null;

// ── Configuration ─────────────────────────────────────────────────────────────

const STELLAR_NETWORKS = {
  testnet: { horizonUrl: "https://horizon-testnet.stellar.org" },
  mainnet: { horizonUrl: "https://horizon.stellar.org" },
} as const;

const network = config.network;
const POLL_INTERVAL_MS = config.pollIntervalMs;
const BATCH_PERF_WARN_MS = parseInt(process.env.BATCH_PERF_WARN_MS ?? "2000", 10);

// ── State tracking (for health check — issue #42) ─────────────────────────────

interface IndexerState {
  startedAt: Date;
  lastProcessedLedger: number | null;
  lastProcessedAt: Date | null;
  latestHorizonLedger: number | null;
  cycleCount: number;
  errorCount: number;
  lastError: string | null;
  lastErrorAt: Date | null;
  lastBatchMetrics: BatchMetrics | null;
  isShuttingDown: boolean;
}

const state: IndexerState = {
  startedAt: new Date(),
  lastProcessedLedger: null,
  lastProcessedAt: null,
  latestHorizonLedger: null,
  cycleCount: 0,
  errorCount: 0,
  lastError: null,
  lastErrorAt: null,
  lastBatchMetrics: null,
  isShuttingDown: false,
};

// ── Health helpers (issue #42) ────────────────────────────────────────────────

async function checkDatabaseHealth(): Promise<{
  ok: boolean;
  latencyMs?: number;
  error?: string;
}> {
  if (!pool) return { ok: false, error: "no pool configured" };
  const start = Date.now();
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

async function checkHorizonHealth(): Promise<{
  ok: boolean;
  latestLedger?: number;
  latencyMs?: number;
  error?: string;
}> {
  const config = STELLAR_NETWORKS[network];
  const server = new Horizon.Server(config.horizonUrl);
  const start = Date.now();
  try {
    const ledgers = await server.ledgers().order("desc").limit(1).call();
    const seq: number = ledgers.records[0]?.sequence ?? 0;
    state.latestHorizonLedger = seq;
    return { ok: true, latestLedger: seq, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

function computeProcessingLag(): number | null {
  if (
    state.latestHorizonLedger === null ||
    state.lastProcessedLedger === null
  ) {
    return null;
  }
  return state.latestHorizonLedger - state.lastProcessedLedger;
}

function computeErrorRate(): number {
  if (state.cycleCount === 0) return 0;
  return parseFloat(
    ((state.errorCount / state.cycleCount) * 100).toFixed(2)
  );
}

// ── Polling cycle ─────────────────────────────────────────────────────────────

async function runCycle(): Promise<void> {
  if (state.isShuttingDown) return;

  state.cycleCount++;
  try {
    console.log(`[indexer] polling Horizon for ${String(network)}...`);
    const ingested = await pollLatestLedger(network);

    // Track latest Horizon ledger for lag calculation
    state.latestHorizonLedger = ingested.ledger.sequence;

    // Normalize data
    const normalizedData = {
      ledger: normalizeLedger(ingested),
      transactions: normalizeTransactions(ingested),
      operations: normalizeOperations(ingested),
      payments: normalizePayments(ingested),
    };

    // Bulk-load to DB (issue #40)
    const metrics = await writeIngestedData(pool, normalizedData);
    state.lastBatchMetrics = metrics;

    // Warn on slow batches
    if (metrics.durationMs > BATCH_PERF_WARN_MS) {
      console.warn(
        `[indexer] slow batch: ${metrics.durationMs}ms for ledger ${normalizedData.ledger.sequence}`
      );
    }

    // Update state
    state.lastProcessedLedger = normalizedData.ledger.sequence;
    state.lastProcessedAt = new Date();

    // Broadcast update
    broadcastRealtimeUpdate({
      network,
      ledger: normalizedData.ledger.sequence,
      txCount: normalizedData.transactions.length,
      at: state.lastProcessedAt.toISOString(),
    });

    console.log(
      `[indexer] processed ledger ${normalizedData.ledger.sequence} ` +
        `(${metrics.totalTransactions} txs, ${metrics.durationMs}ms)`
    );
  } catch (error: any) {
    state.errorCount++;
    state.lastError = error?.message ?? String(error);
    state.lastErrorAt = new Date();
    console.error("[indexer] cycle error:", error);
  }
}

// ── Health check server (issue #42) ──────────────────────────────────────────

async function buildHealthResponse(): Promise<{
  status: "ok" | "degraded" | "error";
  checks: Record<string, any>;
  metrics: Record<string, any>;
}> {
  const [dbHealth, horizonHealth] = await Promise.all([
    checkDatabaseHealth(),
    checkHorizonHealth(),
  ]);

  const lag = computeProcessingLag();
  const errorRate = computeErrorRate();

  // Determine overall status
  let status: "ok" | "degraded" | "error" = "ok";
  if (!dbHealth.ok || !horizonHealth.ok) {
    status = "error";
  } else if (lag !== null && lag > 10) {
    status = "degraded";
  } else if (errorRate > 10) {
    status = "degraded";
  }

  return {
    status,
    checks: {
      database: {
        ok: dbHealth.ok,
        latencyMs: dbHealth.latencyMs,
        error: dbHealth.error,
      },
      horizon: {
        ok: horizonHealth.ok,
        latestLedger: horizonHealth.latestLedger,
        latencyMs: horizonHealth.latencyMs,
        error: horizonHealth.error,
      },
    },
    metrics: {
      network,
      uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
      lastProcessedLedger: state.lastProcessedLedger,
      lastProcessedAt: state.lastProcessedAt?.toISOString() ?? null,
      processingLagLedgers: lag,
      cycleCount: state.cycleCount,
      errorCount: state.errorCount,
      errorRatePct: errorRate,
      lastError: state.lastError,
      lastErrorAt: state.lastErrorAt?.toISOString() ?? null,
      lastBatch: state.lastBatchMetrics
        ? {
            transactions: state.lastBatchMetrics.totalTransactions,
            operations: state.lastBatchMetrics.totalOperations,
            payments: state.lastBatchMetrics.totalPayments,
            durationMs: state.lastBatchMetrics.durationMs,
          }
        : null,
      time: new Date().toISOString(),
    },
  };
}

function createHealthServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") {
      try {
        const health = await buildHealthResponse();
        const statusCode = health.status === "error" ? 503 : 200;
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(JSON.stringify(health, null, 2));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", error: String(err) }));
      }
    } else if (req.url === "/ready") {
      // Lightweight readiness probe — just checks if we've processed at least one ledger
      const ready = state.lastProcessedLedger !== null;
      res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ready,
          lastProcessedLedger: state.lastProcessedLedger,
        })
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return server;
}

// ── Graceful shutdown (issue #48) ─────────────────────────────────────────────

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let healthServer: http.Server | null = null;

async function shutdown(signal: string): Promise<void> {
  if (state.isShuttingDown) return;
  state.isShuttingDown = true;

  console.log(`\n[indexer] received ${signal} — starting graceful shutdown`);

  // 1. Stop accepting new polling cycles
  if (pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log("[indexer] polling loop stopped");
  }

  // 2. Save checkpoint (last processed ledger)
  if (state.lastProcessedLedger !== null) {
    console.log(
      `[indexer] checkpoint: last processed ledger = ${state.lastProcessedLedger}`
    );
  }

  // 3. Close database pool
  if (pool) {
    try {
      await pool.end();
      console.log("[indexer] database pool closed");
    } catch (err) {
      console.error("[indexer] error closing database pool:", err);
    }
  }

  // 4. Close health check HTTP server
  if (healthServer) {
    await new Promise<void>((resolve) => {
      healthServer!.close(() => {
        console.log("[indexer] health check server closed");
        resolve();
      });
    });
  }

  console.log("[indexer] shutdown complete");
  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[indexer] starting on ${String(network)}`);

  // Register graceful shutdown handlers (issue #48)
  process.on("SIGTERM", () => shutdown("SIGTERM").catch(console.error));
  process.on("SIGINT", () => shutdown("SIGINT").catch(console.error));
  process.on("uncaughtException", (err) => {
    console.error("[indexer] uncaught exception:", err);
    shutdown("uncaughtException").catch(() => process.exit(1));
  });

  // Start enhanced health check server (issue #42)
  healthServer = createHealthServer();
  healthServer.listen(3001, () => {
    console.log("[indexer] health check server listening on port 3001");
    console.log("[indexer]   GET /health  — full health report");
    console.log("[indexer]   GET /ready   — readiness probe");
  });

  // Initial run
  await runCycle();

  // Polling loop
  pollingTimer = setInterval(() => {
    runCycle().catch(console.error);
  }, POLL_INTERVAL_MS);
}

main().catch((error: any) => {
  indexerLogger.fatal({ error: error?.message ?? String(error) }, "Fatal error");
  process.exit(1);
});
