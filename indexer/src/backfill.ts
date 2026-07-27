/**
 * Backfill module for the Stellar Analytics Indexer.
 *
 * Issue #38 – Add Indexer Backfill Strategy
 * Issue #45 – Add Indexer Parallel Processing
 *
 * Provides:
 *  - `runBackfill(options)`  – process a ledger range with parallel workers
 *  - `BackfillProgress`      – real-time progress tracking
 *  - Resume capability       – skips already-indexed ledgers (idempotent)
 *  - Configurable concurrency via BACKFILL_CONCURRENCY env var
 *  - Per-batch delay to avoid Horizon rate-limiting
 *  - Graceful cancellation via AbortSignal
 */

import { Horizon } from "@stellar/stellar-sdk";
import { STELLAR_NETWORKS, type StellarNetwork } from "@stellar-analytics/shared";
import {
  normalizeLedger,
  normalizeTransactions,
  normalizeOperations,
  normalizePayments,
} from "./transformer.js";
import { writeIngestedData } from "./loader.js";
import { backfillLogger } from "./logger.js";
import type { IndexerConfig } from "./config.js";
import {
  createCheckpoint,
  saveCheckpoint,
  markCheckpointCompleted,
  markCheckpointFailed,
  markCheckpointCancelled,
  loadCheckpoint,
} from "./checkpoint.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackfillOptions {
  /** Stellar network to backfill */
  network: StellarNetwork;
  /** First ledger sequence to process (inclusive) */
  startSequence: number;
  /** Last ledger sequence to process (inclusive) */
  endSequence: number;
  /** PostgreSQL pool (null = dry-run, no DB writes) */
  pool: any;
  /** Indexer configuration */
  config: IndexerConfig;
  /** Optional AbortSignal to cancel the backfill */
  signal?: AbortSignal;
  /** Optional callback invoked after each ledger is processed */
  onProgress?: (progress: BackfillProgress) => void;
}

export interface BackfillProgress {
  /** Total ledgers in the requested range */
  total: number;
  /** Ledgers successfully processed so far */
  processed: number;
  /** Ledgers skipped (already in DB) */
  skipped: number;
  /** Ledgers that failed */
  failed: number;
  /** Percentage complete (0-100) */
  percent: number;
  /** Estimated seconds remaining */
  etaSeconds: number | null;
  /** Whether the backfill has finished */
  done: boolean;
  /** Timestamp when the backfill started */
  startedAt: string;
}

export interface BackfillResult {
  processed: number;
  skipped: number;
  failed: number;
  durationMs: number;
  resumeFrom: number | null;
}

// ---------------------------------------------------------------------------
// Worker pool helpers
// ---------------------------------------------------------------------------

/**
 * Run `tasks` with at most `concurrency` tasks in flight at once.
 * Returns an array of settled results in the same order as `tasks`.
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  signal?: AbortSignal
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      if (signal?.aborted) break;
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (err: any) {
        results[index] = { status: "rejected", reason: err };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Single-ledger fetch
// ---------------------------------------------------------------------------

async function fetchOneLedger(
  server: Horizon.Server,
  sequence: number
): Promise<{ ledger: Horizon.ServerApi.LedgerRecord; transactions: Horizon.ServerApi.TransactionRecord[]; operations: Horizon.ServerApi.OperationRecord[] }> {
  const ledgerResp = await (server.ledgers().ledger(sequence) as any).call();
  // Horizon SDK may return the record directly or wrapped in .records[]
  const ledger: Horizon.ServerApi.LedgerRecord =
    ledgerResp.records ? ledgerResp.records[0] : ledgerResp;

  const [txResp, opResp] = await Promise.all([
    server.transactions().forLedger(sequence).limit(200).call(),
    server.operations().forLedger(sequence).limit(200).call(),
  ]);

  return {
    ledger,
    transactions: txResp.records,
    operations: opResp.records,
  };
}

// ---------------------------------------------------------------------------
// Check if a ledger is already indexed
// ---------------------------------------------------------------------------

async function isLedgerIndexed(pool: any, sequence: number): Promise<boolean> {
  if (!pool) return false;
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        "SELECT 1 FROM ledgers WHERE sequence = $1 LIMIT 1",
        [sequence]
      );
      return res.rowCount > 0;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Process a single ledger
// ---------------------------------------------------------------------------

async function processOneLedger(
  server: Horizon.Server,
  pool: any,
  sequence: number
): Promise<"processed" | "skipped"> {
  // Resume capability: skip if already indexed
  if (await isLedgerIndexed(pool, sequence)) {
    backfillLogger.debug({ sequence }, "Ledger already indexed, skipping");
    return "skipped";
  }

  const ingested = await fetchOneLedger(server, sequence);

  const normalizedData = {
    ledger: normalizeLedger(ingested),
    transactions: normalizeTransactions(ingested),
    operations: normalizeOperations(ingested),
    payments: normalizePayments(ingested),
  };

  await writeIngestedData(pool, normalizedData);
  backfillLogger.debug({ sequence }, "Ledger processed");
  return "processed";
}

// ---------------------------------------------------------------------------
// Main backfill function
// ---------------------------------------------------------------------------

/**
 * Backfill a range of ledgers using a parallel worker pool.
 *
 * @example
 * const result = await runBackfill({
 *   network: "testnet",
 *   startSequence: 50_000,
 *   endSequence:   50_999,
 *   pool,
 *   config,
 * });
 * console.log(`Processed ${result.processed} ledgers in ${result.durationMs}ms`);
 */
export async function runBackfill(options: BackfillOptions): Promise<BackfillResult> {
  const {
    network,
    startSequence,
    endSequence,
    pool,
    config,
    signal,
    onProgress,
  } = options;

  if (startSequence > endSequence) {
    throw new Error(
      `startSequence (${startSequence}) must be <= endSequence (${endSequence})`
    );
  }

  const horizonUrl = STELLAR_NETWORKS[network].horizonUrl;
  const server = new Horizon.Server(horizonUrl);
  const total = endSequence - startSequence + 1;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // ── Checkpoint setup ──────────────────────────────────────────────────────
  const jobId = `backfill:${network}:${startSequence}-${endSequence}`;
  let resumeFromSequence = startSequence;
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  if (pool) {
    // Try to load an existing in-progress checkpoint
    const existing = await loadCheckpoint(pool, jobId);
    if (
      existing &&
      existing.status === 'in_progress' &&
      existing.lastProcessedSequence !== null
    ) {
      resumeFromSequence = existing.lastProcessedSequence + 1;
      processed = existing.processedCount;
      skipped = existing.skippedCount;
      failed = existing.failedCount;
      backfillLogger.info(
        {
          jobId,
          resumeFrom: resumeFromSequence,
          processed: existing.processedCount,
          skipped: existing.skippedCount,
          failed: existing.failedCount,
        },
        "Resuming backfill from checkpoint"
      );
    } else {
      await createCheckpoint(pool, jobId, network, startSequence, endSequence);
    }
  }

  backfillLogger.info(
    {
      network,
      startSequence,
      endSequence,
      resumeFrom: resumeFromSequence,
      total,
      concurrency: config.backfillConcurrency,
      batchSize: config.backfillBatchSize,
    },
    "Starting backfill"
  );

  let lastFailedSequence: number | null = null;

  // Build sequence list from resume point
  const sequences: number[] = [];
  for (let seq = resumeFromSequence; seq <= endSequence; seq++) {
    sequences.push(seq);
  }

  // Process in batches to allow progress reporting and batch delays
  const batchSize = config.backfillBatchSize;

  for (let batchStart = 0; batchStart < sequences.length; batchStart += batchSize) {
    if (signal?.aborted) {
      backfillLogger.warn({ processed, skipped, failed }, "Backfill cancelled by signal");
      if (pool) {
        await markCheckpointCancelled(pool, jobId, {
          lastProcessedSequence:
            batchStart > 0 ? sequences[batchStart - 1] : resumeFromSequence - 1,
          processedCount: processed,
          skippedCount: skipped,
          failedCount: failed,
        });
      }
      break;
    }

    const batch = sequences.slice(batchStart, batchStart + batchSize);

    // Build tasks for this batch
    const tasks = batch.map((seq) => () => processOneLedger(server, pool, seq));

    // Run batch with configured concurrency
    const results = await runWithConcurrency(tasks, config.backfillConcurrency, signal);

    // Tally results
    results.forEach((result, i) => {
      const seq = batch[i];
      if (result.status === "fulfilled") {
        if (result.value === "skipped") {
          skipped++;
        } else {
          processed++;
        }
      } else {
        failed++;
        lastFailedSequence = seq;
        backfillLogger.error(
          { sequence: seq, error: result.reason?.message ?? String(result.reason) },
          "Failed to process ledger"
        );
      }
    });

    // ── Persist checkpoint after each batch ──────────────────────────────────
    if (pool) {
      const batchLastSeq = batch[batch.length - 1];
      await saveCheckpoint(pool, jobId, {
        lastProcessedSequence: batchLastSeq,
        processedCount: processed,
        skippedCount: skipped,
        failedCount: failed,
      });
    }

    // Progress tracking
    const done = processed + skipped + failed;
    const elapsedMs = Date.now() - startMs;
    const rate = done / (elapsedMs / 1000); // ledgers per second
    const remaining = total - done;
    const etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;
    const percent = Math.round((done / total) * 100);

    const progress: BackfillProgress = {
      total,
      processed,
      skipped,
      failed,
      percent,
      etaSeconds,
      done: done >= total,
      startedAt,
    };

    backfillLogger.info(
      { ...progress, batchEnd: batch[batch.length - 1] },
      `Backfill progress: ${percent}% (${done}/${total})`
    );

    onProgress?.(progress);

    // Throttle between batches to avoid Horizon rate-limiting
    if (batchStart + batchSize < sequences.length && config.backfillBatchDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.backfillBatchDelayMs));
    }
  }

  const durationMs = Date.now() - startMs;

  // ── Mark final status ─────────────────────────────────────────────────────
  if (pool) {
    if (lastFailedSequence !== null) {
      await markCheckpointFailed(
        pool,
        jobId,
        `Backfill completed with ${failed} failed ledger(s). Last failed: ${lastFailedSequence}`,
        {
          lastProcessedSequence: sequences.length > 0
            ? sequences[sequences.length - 1]
            : resumeFromSequence - 1,
          processedCount: processed,
          skippedCount: skipped,
          failedCount: failed,
        },
      );
    } else {
      await markCheckpointCompleted(pool, jobId, {
        lastProcessedSequence: endSequence,
        processedCount: processed,
        skippedCount: skipped,
        failedCount: failed,
      });
    }
  }

  backfillLogger.info(
    { processed, skipped, failed, durationMs, total },
    "Backfill complete"
  );

  return {
    processed,
    skipped,
    failed,
    durationMs,
    // If there were failures, suggest resuming from the first failed ledger
    resumeFrom: lastFailedSequence,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point (node backfill.js --start=X --end=Y)
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments for the backfill command.
 * Supports: --start=<seq> --end=<seq> --network=<net> --concurrency=<n>
 */
export function parseBackfillArgs(argv: string[]): {
  startSequence: number;
  endSequence: number;
  network: StellarNetwork;
  concurrency?: number;
} {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([a-zA-Z_-]+)=(.+)$/);
    if (match) args[match[1]] = match[2];
  }

  const startSequence = parseInt(args["start"] ?? "", 10);
  const endSequence = parseInt(args["end"] ?? "", 10);

  if (isNaN(startSequence) || isNaN(endSequence)) {
    throw new Error(
      "Usage: node backfill.js --start=<sequence> --end=<sequence> [--network=testnet|mainnet] [--concurrency=4]"
    );
  }

  const network = (args["network"] ?? "testnet") as StellarNetwork;
  const concurrency = args["concurrency"] ? parseInt(args["concurrency"], 10) : undefined;

  return { startSequence, endSequence, network, concurrency };
}
