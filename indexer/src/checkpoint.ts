/**
 * Checkpoint persistence for the Stellar Analytics Indexer (legacy system).
 *
 * Saves backfill progress to the `backfill_checkpoints` table so a restarted
 * backfill can continue from the last successfully checkpointed ledger.
 *
 * The old `indexer/src/backfill.ts` already has a `resumeFrom` field in
 * `BackfillResult` and skips already-indexed ledgers via `isLedgerIndexed()`.
 * This module adds DB-persisted checkpoints so the progress survives restarts.
 */
import type { Pool } from "pg";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckpointRecord {
  id: number;
  jobId: string;
  network: string;
  startSequence: number;
  endSequence: number;
  lastProcessedSequence: number | null;
  totalLedgers: number;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  errorMessage: string | null;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface CheckpointProgress {
  lastProcessedSequence: number | null;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
}

// ---------------------------------------------------------------------------
// Module-level table creation guard
// ---------------------------------------------------------------------------

let _tableEnsured = false;

async function ensureCheckpointTable(pool: Pool): Promise<void> {
  if (_tableEnsured) return;

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS backfill_checkpoints (
        id                    SERIAL PRIMARY KEY,
        job_id                VARCHAR(128) NOT NULL,
        network               VARCHAR(16) NOT NULL DEFAULT 'public',
        start_sequence        BIGINT NOT NULL,
        end_sequence          BIGINT NOT NULL,
        last_processed_sequence BIGINT,
        total_ledgers         INTEGER NOT NULL DEFAULT 0,
        processed_count       INTEGER NOT NULL DEFAULT 0,
        skipped_count         INTEGER NOT NULL DEFAULT 0,
        failed_count          INTEGER NOT NULL DEFAULT 0,
        status                VARCHAR(16) NOT NULL DEFAULT 'in_progress'
                              CHECK (status IN ('in_progress', 'completed', 'failed', 'cancelled')),
        error_message         TEXT,
        started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at          TIMESTAMPTZ,
        UNIQUE (job_id)
      )
    `);
    _tableEnsured = true;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Save a checkpoint to the database
// ---------------------------------------------------------------------------

/**
 * Create a new backfill checkpoint record.
 */
export async function createCheckpoint(
  pool: Pool,
  jobId: string,
  network: string,
  startSequence: number,
  endSequence: number,
): Promise<void> {
  await ensureCheckpointTable(pool);

  const totalLedgers = endSequence - startSequence + 1;
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO backfill_checkpoints
         (job_id, network, start_sequence, end_sequence, total_ledgers, status)
       VALUES ($1, $2, $3, $4, $5, 'in_progress')
       ON CONFLICT (job_id) DO UPDATE SET
         status        = 'in_progress',
         error_message = NULL,
         completed_at  = NULL,
         updated_at    = NOW()`,
      [jobId, network, startSequence, endSequence, totalLedgers],
    );
  } finally {
    client.release();
  }
}

/**
 * Save progress checkpoint after a batch completes.
 */
export async function saveCheckpoint(
  pool: Pool,
  jobId: string,
  progress: CheckpointProgress,
): Promise<void> {
  await ensureCheckpointTable(pool);

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE backfill_checkpoints SET
         last_processed_sequence = $1,
         processed_count         = $2,
         skipped_count           = $3,
         failed_count            = $4,
         updated_at              = NOW()
       WHERE job_id = $5`,
      [
        progress.lastProcessedSequence,
        progress.processedCount,
        progress.skippedCount,
        progress.failedCount,
        jobId,
      ],
    );
  } finally {
    client.release();
  }
}

/**
 * Mark the backfill as completed.
 */
export async function markCheckpointCompleted(
  pool: Pool,
  jobId: string,
  progress: CheckpointProgress,
): Promise<void> {
  await ensureCheckpointTable(pool);

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE backfill_checkpoints SET
         status                  = 'completed',
         last_processed_sequence = $1,
         processed_count         = $2,
         skipped_count           = $3,
         failed_count            = $4,
         completed_at            = NOW(),
         updated_at              = NOW()
       WHERE job_id = $5`,
      [
        progress.lastProcessedSequence,
        progress.processedCount,
        progress.skippedCount,
        progress.failedCount,
        jobId,
      ],
    );
  } finally {
    client.release();
  }
}

/**
 * Mark the backfill as failed.
 */
export async function markCheckpointFailed(
  pool: Pool,
  jobId: string,
  errorMessage: string,
  progress: CheckpointProgress,
): Promise<void> {
  await ensureCheckpointTable(pool);

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE backfill_checkpoints SET
         status                  = 'failed',
         last_processed_sequence = $1,
         processed_count         = $2,
         skipped_count           = $3,
         failed_count            = $4,
         error_message           = $5,
         completed_at            = NOW(),
         updated_at              = NOW()
       WHERE job_id = $6`,
      [
        progress.lastProcessedSequence,
        progress.processedCount,
        progress.skippedCount,
        progress.failedCount,
        errorMessage,
        jobId,
      ],
    );
  } finally {
    client.release();
  }
}

/**
 * Mark the backfill as cancelled (SIGINT / SIGTERM).
 */
export async function markCheckpointCancelled(
  pool: Pool,
  jobId: string,
  progress: CheckpointProgress,
): Promise<void> {
  await ensureCheckpointTable(pool);

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE backfill_checkpoints SET
         status                  = 'cancelled',
         last_processed_sequence = $1,
         processed_count         = $2,
         skipped_count           = $3,
         failed_count            = $4,
         completed_at            = NOW(),
         updated_at              = NOW()
       WHERE job_id = $5`,
      [
        progress.lastProcessedSequence,
        progress.processedCount,
        progress.skippedCount,
        progress.failedCount,
        jobId,
      ],
    );
  } finally {
    client.release();
  }
}

/**
 * Load the checkpoint for a specific job_id.
 * Returns null if no checkpoint exists.
 */
export async function loadCheckpoint(
  pool: Pool,
  jobId: string,
): Promise<CheckpointRecord | null> {
  await ensureCheckpointTable(pool);

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT * FROM backfill_checkpoints WHERE job_id = $1`,
      [jobId],
    );

    if (rows.length === 0) return null;

    const r = rows[0];
    return {
      id: r.id,
      jobId: r.job_id,
      network: r.network,
      startSequence: Number(r.start_sequence),
      endSequence: Number(r.end_sequence),
      lastProcessedSequence: r.last_processed_sequence
        ? Number(r.last_processed_sequence)
        : null,
      totalLedgers: r.total_ledgers,
      processedCount: r.processed_count,
      skippedCount: r.skipped_count,
      failedCount: r.failed_count,
      status: r.status,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at,
    };
  } finally {
    client.release();
  }
}
