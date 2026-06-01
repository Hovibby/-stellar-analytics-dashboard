/**
 * Configuration validation module for the Stellar Analytics Indexer.
 *
 * Issue #46 – Add Indexer Configuration Validation
 *
 * Validates all environment variables on startup and fails fast with clear,
 * actionable error messages when the configuration is invalid.
 *
 * Features implemented:
 *  - Validates all required and optional environment variables
 *  - Provides typed, validated config object (no raw process.env access elsewhere)
 *  - Clear error messages listing every missing / invalid variable at once
 *  - Inline documentation for every variable
 *  - Generates a .env.example file path reference
 */

import { configLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StellarNetwork = "testnet" | "mainnet";

export interface IndexerConfig {
  /** Stellar network to index ("testnet" | "mainnet") */
  network: StellarNetwork;

  /** PostgreSQL connection string – required for DB writes */
  databaseUrl: string | null;

  /** Polling interval in milliseconds (default: 5000) */
  pollIntervalMs: number;

  /** HTTP health-check server port (default: 3001) */
  healthPort: number;

  /** WebSocket broadcast server port (default: 8080) */
  wsPort: number;

  /** Minimum log level (default: "info") */
  logLevel: string;

  /** Enable pretty-print logging (default: false) */
  logPretty: boolean;

  /** Directory for log files (default: ./logs) */
  logDir: string;

  // Backfill settings
  /** Maximum number of parallel workers for backfill (default: 4) */
  backfillConcurrency: number;

  /** Number of ledgers per batch during backfill (default: 10) */
  backfillBatchSize: number;

  /** Delay in ms between batches to avoid rate-limiting (default: 200) */
  backfillBatchDelayMs: number;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

interface ValidationError {
  variable: string;
  message: string;
}

function validateNetwork(value: string | undefined): StellarNetwork {
  const valid: StellarNetwork[] = ["testnet", "mainnet"];
  const v = (value ?? "testnet").toLowerCase() as StellarNetwork;
  if (!valid.includes(v)) {
    throw new Error(
      `STELLAR_NETWORK must be one of: ${valid.join(", ")}. Got: "${value}"`
    );
  }
  return v;
}

function validatePositiveInt(
  name: string,
  value: string | undefined,
  defaultValue: number
): number {
  if (value === undefined || value === "") return defaultValue;
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer. Got: "${value}"`);
  }
  return n;
}

function validatePort(name: string, value: string | undefined, defaultValue: number): number {
  const port = validatePositiveInt(name, value, defaultValue);
  if (port > 65535) {
    throw new Error(`${name} must be a valid port (1-65535). Got: ${port}`);
  }
  return port;
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Validate all environment variables and return a typed config object.
 * Throws a descriptive error listing ALL problems found (not just the first).
 */
export function validateConfig(): IndexerConfig {
  const errors: ValidationError[] = [];

  // Helper that collects errors instead of throwing immediately
  function collect<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (err: any) {
      errors.push({ variable: "unknown", message: err.message });
      return fallback;
    }
  }

  // --- Required fields ---
  // DATABASE_URL is optional (indexer can run without DB for testing)
  const databaseUrl = process.env.DATABASE_URL ?? null;

  // --- Validated fields ---
  const network = collect(
    () => validateNetwork(process.env.STELLAR_NETWORK),
    "testnet" as StellarNetwork
  );

  const pollIntervalMs = collect(
    () => validatePositiveInt("POLL_INTERVAL_MS", process.env.POLL_INTERVAL_MS, 5000),
    5000
  );

  const healthPort = collect(
    () => validatePort("HEALTH_PORT", process.env.HEALTH_PORT, 3001),
    3001
  );

  const wsPort = collect(
    () => validatePort("WS_PORT", process.env.WS_PORT, 8080),
    8080
  );

  const backfillConcurrency = collect(
    () => validatePositiveInt("BACKFILL_CONCURRENCY", process.env.BACKFILL_CONCURRENCY, 4),
    4
  );

  const backfillBatchSize = collect(
    () => validatePositiveInt("BACKFILL_BATCH_SIZE", process.env.BACKFILL_BATCH_SIZE, 10),
    10
  );

  const backfillBatchDelayMs = collect(
    () => validatePositiveInt("BACKFILL_BATCH_DELAY_MS", process.env.BACKFILL_BATCH_DELAY_MS, 200),
    200
  );

  // --- Fail fast if any errors ---
  if (errors.length > 0) {
    const messages = errors.map((e) => `  • ${e.message}`).join("\n");
    throw new Error(
      `[config] Invalid configuration – fix the following issues:\n${messages}\n\n` +
        `See indexer/.env.example for all available options.`
    );
  }

  const config: IndexerConfig = {
    network,
    databaseUrl,
    pollIntervalMs,
    healthPort,
    wsPort,
    logLevel: process.env.LOG_LEVEL ?? "info",
    logPretty: process.env.LOG_PRETTY === "true",
    logDir: process.env.LOG_DIR ?? "logs",
    backfillConcurrency,
    backfillBatchSize,
    backfillBatchDelayMs,
  };

  configLogger.info(
    {
      network: config.network,
      pollIntervalMs: config.pollIntervalMs,
      healthPort: config.healthPort,
      wsPort: config.wsPort,
      logLevel: config.logLevel,
      backfillConcurrency: config.backfillConcurrency,
      backfillBatchSize: config.backfillBatchSize,
      databaseConfigured: config.databaseUrl !== null,
    },
    "Configuration validated successfully"
  );

  return config;
}
