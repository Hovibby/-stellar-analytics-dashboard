/**
 * Structured logging module for the Stellar Analytics Indexer.
 *
 * Issue #47 – Add Indexer Logging Framework
 *
 * Replaces ad-hoc console.log calls with a structured, levelled logger built
 * on top of the `pino` library.  Pino was chosen over Winston because it is
 * significantly faster (important for a high-throughput indexer), produces
 * newline-delimited JSON by default (easy to ship to any log aggregator), and
 * has a tiny footprint.
 *
 * Features implemented:
 *  - Log levels: trace | debug | info | warn | error | fatal
 *  - Structured JSON output (machine-parseable)
 *  - Human-readable pretty-print in development (LOG_PRETTY=true)
 *  - Request / context correlation via child loggers
 *  - Log rotation via pino-roll (daily files, 7-day retention)
 *  - Configurable minimum level via LOG_LEVEL env var
 */

import pino, { type Logger, type LoggerOptions } from "pino";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";
const LOG_PRETTY = process.env.LOG_PRETTY === "true";
const LOG_DIR = process.env.LOG_DIR ?? path.join(__dirname, "..", "logs");

// ---------------------------------------------------------------------------
// Transport setup
// ---------------------------------------------------------------------------

/**
 * Build the pino transport configuration.
 *
 * In development (LOG_PRETTY=true) we use pino-pretty for coloured output.
 * In production we write structured JSON to both stdout and a rotating file.
 */
function buildTransport(): NonNullable<LoggerOptions["transport"]> {
  if (LOG_PRETTY) {
    return {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    };
  }

  // Production: stdout + rotating daily file
  return {
    targets: [
      {
        target: "pino/file",
        level: LOG_LEVEL,
        options: { destination: 1 }, // stdout (fd 1)
      },
      {
        target: "pino-roll",
        level: LOG_LEVEL,
        options: {
          file: path.join(LOG_DIR, "indexer.log"),
          frequency: "daily",
          limit: { count: 7 }, // keep 7 days of logs
          mkdir: true,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Root logger
// ---------------------------------------------------------------------------

const rootLogger: Logger = pino(
  {
    level: LOG_LEVEL,
    base: {
      service: "stellar-indexer",
      env: process.env.NODE_ENV ?? "development",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  pino.transport(buildTransport())
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a child logger with additional bound context fields.
 *
 * @example
 * const log = createChildLogger({ module: "backfill", network: "testnet" });
 * log.info({ startSeq: 100, endSeq: 200 }, "Starting backfill");
 */
export function createChildLogger(bindings: Record<string, unknown>): Logger {
  return rootLogger.child(bindings);
}

/** Pre-built module loggers – import these directly in each module. */
export const logger = rootLogger;
export const indexerLogger = createChildLogger({ module: "indexer" });
export const ingesterLogger = createChildLogger({ module: "ingester" });
export const loaderLogger = createChildLogger({ module: "loader" });
export const backfillLogger = createChildLogger({ module: "backfill" });
export const workerLogger = createChildLogger({ module: "worker" });
export const configLogger = createChildLogger({ module: "config" });
export const websocketLogger = createChildLogger({ module: "websocket" });
