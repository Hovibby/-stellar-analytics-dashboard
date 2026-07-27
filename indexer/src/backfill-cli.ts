/**
 * Backfill CLI entry point.
 *
 * Usage:
 *   npx tsx src/backfill-cli.ts --start=<sequence> --end=<sequence> [--network=testnet|mainnet] [--concurrency=4]
 *
 * Environment variables:
 *   DATABASE_URL          – PostgreSQL connection string (optional; omit for dry-run)
 *   STELLAR_NETWORK       – Default network if --network flag is not provided
 *   BACKFILL_CONCURRENCY  – Default concurrency if --concurrency flag is not provided
 *   BACKFILL_BATCH_SIZE   – Ledgers per batch (default: 10)
 *   BACKFILL_BATCH_DELAY_MS – Delay between batches in ms (default: 200)
 *
 * Examples:
 *   # Backfill ledgers 50000-51000 on testnet with 8 parallel workers
 *   npx tsx src/backfill-cli.ts --start=50000 --end=51000 --network=testnet --concurrency=8
 *
 *   # Resume a previous run (already-indexed ledgers are skipped automatically)
 *   npx tsx src/backfill-cli.ts --start=50000 --end=51000
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { runBackfill, parseBackfillArgs, type BackfillProgress } from './backfill.js';
import { validateConfig } from './config.js';
import { backfillLogger } from './logger.js';

async function main(): Promise<void> {
  // Parse CLI arguments
  let cliArgs: ReturnType<typeof parseBackfillArgs>;
  try {
    cliArgs = parseBackfillArgs(process.argv.slice(2));
  } catch (err: any) {
    backfillLogger.error({ error: err.message }, 'Invalid arguments');
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }

  // Validate configuration
  let config = validateConfig();

  // CLI flags override env-based config
  if (cliArgs.concurrency !== undefined) {
    config = { ...config, backfillConcurrency: cliArgs.concurrency };
  }
  if (cliArgs.network) {
    config = { ...config, network: cliArgs.network };
  }

  // Set up database pool
  const pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl }) : null;

  if (!pool) {
    backfillLogger.warn('DATABASE_URL not set – running in dry-run mode (no data will be written)');
  }

  // Set up graceful cancellation
  const abortController = new AbortController();
  process.on('SIGINT', () => {
    backfillLogger.warn('Received SIGINT – cancelling backfill after current batch...');
    abortController.abort();
  });
  process.on('SIGTERM', () => {
    backfillLogger.warn('Received SIGTERM – cancelling backfill after current batch...');
    abortController.abort();
  });

  backfillLogger.info(
    {
      startSequence: cliArgs.startSequence,
      endSequence: cliArgs.endSequence,
      network: cliArgs.network,
      concurrency: config.backfillConcurrency,
      batchSize: config.backfillBatchSize,
      account: cliArgs.account,
    },
    'Backfill CLI started'
  );

  try {
    const result = await runBackfill({
      network: cliArgs.network,
      startSequence: cliArgs.startSequence,
      endSequence: cliArgs.endSequence,
      account: cliArgs.account,
      pool,
      config,
      signal: abortController.signal,
      onProgress: (progress: BackfillProgress) => {
        // Emit a simple progress line to stderr for human operators
        process.stderr.write(
          `\r[backfill] ${progress.percent}% | ` +
            `processed=${progress.processed} skipped=${progress.skipped} failed=${progress.failed}` +
            (progress.etaSeconds !== null ? ` | ETA ${progress.etaSeconds}s` : '') +
            '   '
        );
      },
    });

    process.stderr.write('\n'); // newline after progress line

    backfillLogger.info(result, 'Backfill finished');

    if (result.resumeFrom !== null) {
      backfillLogger.warn(
        { resumeFrom: result.resumeFrom },
        `Some ledgers failed. To resume, re-run with --start=${result.resumeFrom}`
      );
    }

    if (pool) await pool.end();
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (err: any) {
    backfillLogger.error({ error: err.message }, 'Backfill failed with unhandled error');
    if (pool) await pool.end();
    process.exit(1);
  }
}

main();
