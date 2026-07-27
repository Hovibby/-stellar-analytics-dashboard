/**
 * BackfillCheckpointManager – persistent checkpoint storage for resumable backfills.
 *
 * Saves progress to a `backfill_checkpoints` table after every batch so that a
 * restarted backfill can continue from the last successfully checkpointed ledger
 * rather than starting over.
 *
 * Features:
 *  - Per-job checkpoint with unique job_id
 *  - Checkpoint after each batch (periodic persistence, not per-ledger)
 *  - Status tracking: in_progress → completed | failed | cancelled
 *  - Resume: loads the most recent in_progress checkpoint for a given network
 *  - Metrics integration for observability
 */
import { Pool } from 'pg';
import { metrics } from '../metrics/IndexerMetrics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackfillJob {
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
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
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

export interface BackfillCheckpointOptions {
  /** Database connection pool */
  pool: Pool;
  /** Unique identifier for this backfill job (e.g. "backfill:testnet:50000-51000") */
  jobId: string;
  /** Stellar network being backfilled */
  network?: string;
  /** Start ledger sequence */
  startSequence: number;
  /** End ledger sequence */
  endSequence: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_NETWORK = 'public';

// ---------------------------------------------------------------------------
// BackfillCheckpointManager
// ---------------------------------------------------------------------------

export class BackfillCheckpointManager {
  private readonly pool: Pool;
  private readonly jobId: string;
  private readonly network: string;
  private readonly startSequence: number;
  private readonly endSequence: number;

  constructor(options: BackfillCheckpointOptions) {
    this.pool = options.pool;
    this.jobId = options.jobId;
    this.network = options.network ?? DEFAULT_NETWORK;
    this.startSequence = options.startSequence;
    this.endSequence = options.endSequence;
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  /**
   * Ensure the backfill_checkpoints table exists.
   * Safe to call multiple times – subsequent calls are no-ops.
   */
  async ensureTable(): Promise<void> {
    const client = await this.pool.connect();
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

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_backfill_checkpoints_network
          ON backfill_checkpoints (network, status)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_backfill_checkpoints_last_sequence
          ON backfill_checkpoints (last_processed_sequence)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_backfill_checkpoints_updated_at
          ON backfill_checkpoints (updated_at DESC)
      `);
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Create / Load
  // ---------------------------------------------------------------------------

  /**
   * Create a new checkpoint record for this backfill job.
   * If a record with the same job_id already exists, it is a no-op.
   * Returns the created job.
   */
  async createJob(): Promise<BackfillJob> {
    const totalLedgers = this.endSequence - this.startSequence + 1;

    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{
        id: number;
        job_id: string;
        network: string;
        start_sequence: string;
        end_sequence: string;
        last_processed_sequence: string | null;
        total_ledgers: number;
        processed_count: number;
        skipped_count: number;
        failed_count: number;
        status: string;
        error_message: string | null;
        started_at: Date;
        updated_at: Date;
        completed_at: Date | null;
      }>(
        `INSERT INTO backfill_checkpoints
          (job_id, network, start_sequence, end_sequence, total_ledgers, status)
         VALUES ($1, $2, $3, $4, $5, 'in_progress')
         ON CONFLICT (job_id) DO UPDATE SET
           status               = 'in_progress',
           error_message        = NULL,
           completed_at         = NULL,
           updated_at           = NOW()
         RETURNING *`,
        [this.jobId, this.network, this.startSequence, this.endSequence, totalLedgers],
      );

      return this.rowToJob(rows[0]);
    } finally {
      client.release();
    }
  }

  /**
   * Load the latest checkpoint for this job_id.
   * Returns null if no checkpoint exists.
   */
  async loadJob(): Promise<BackfillJob | null> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{
        id: number;
        job_id: string;
        network: string;
        start_sequence: string;
        end_sequence: string;
        last_processed_sequence: string | null;
        total_ledgers: number;
        processed_count: number;
        skipped_count: number;
        failed_count: number;
        status: string;
        error_message: string | null;
        started_at: Date;
        updated_at: Date;
        completed_at: Date | null;
      }>(
        `SELECT * FROM backfill_checkpoints WHERE job_id = $1`,
        [this.jobId],
      );

      return rows.length > 0 ? this.rowToJob(rows[0]) : null;
    } finally {
      client.release();
    }
  }

  /**
   * Find the most recent in_progress checkpoint for the current network.
   * Useful for resuming after an indexer restart.
   */
  async findResumableJob(): Promise<BackfillJob | null> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{
        id: number;
        job_id: string;
        network: string;
        start_sequence: string;
        end_sequence: string;
        last_processed_sequence: string | null;
        total_ledgers: number;
        processed_count: number;
        skipped_count: number;
        failed_count: number;
        status: string;
        error_message: string | null;
        started_at: Date;
        updated_at: Date;
        completed_at: Date | null;
      }>(
        `SELECT * FROM backfill_checkpoints
         WHERE network = $1 AND status = 'in_progress'
         ORDER BY updated_at DESC
         LIMIT 1`,
        [this.network],
      );

      return rows.length > 0 ? this.rowToJob(rows[0]) : null;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Checkpoint operations
  // ---------------------------------------------------------------------------

  /**
   * Save a checkpoint with the current progress.
   * This is called after each batch completes.
   */
  async saveCheckpoint(progress: CheckpointProgress): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE backfill_checkpoints SET
           last_processed_sequence = $1,
           processed_count        = $2,
           skipped_count          = $3,
           failed_count           = $4,
           updated_at             = NOW()
         WHERE job_id = $5`,
        [
          progress.lastProcessedSequence,
          progress.processedCount,
          progress.skippedCount,
          progress.failedCount,
          this.jobId,
        ],
      );
    } finally {
      client.release();
    }

    // Update Prometheus gauge
    const total = this.endSequence - this.startSequence + 1;
    metrics.setBackfillProgress(
      progress.processedCount + progress.skippedCount,
      total,
    );
  }

  /**
   * Mark the backfill job as completed successfully.
   */
  async markCompleted(progress: CheckpointProgress): Promise<void> {
    const client = await this.pool.connect();
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
          this.jobId,
        ],
      );
    } finally {
      client.release();
    }

    const total = this.endSequence - this.startSequence + 1;
    metrics.setBackfillProgress(total, total);
  }

  /**
   * Mark the backfill job as failed.
   */
  async markFailed(
    errorMessage: string,
    progress: CheckpointProgress,
  ): Promise<void> {
    const client = await this.pool.connect();
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
          this.jobId,
        ],
      );
    } finally {
      client.release();
    }
  }

  /**
   * Mark the backfill job as cancelled (e.g. on SIGINT/SIGTERM).
   */
  async markCancelled(progress: CheckpointProgress): Promise<void> {
    const client = await this.pool.connect();
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
          this.jobId,
        ],
      );
    } finally {
      client.release();
    }
  }

  /**
   * Delete a checkpoint record (cleanup).
   */
  async deleteJob(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        'DELETE FROM backfill_checkpoints WHERE job_id = $1',
        [this.jobId],
      );
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private rowToJob(row: any): BackfillJob {
    return {
      id: row.id,
      jobId: row.job_id,
      network: row.network,
      startSequence: Number(row.start_sequence),
      endSequence: Number(row.end_sequence),
      lastProcessedSequence: row.last_processed_sequence
        ? Number(row.last_processed_sequence)
        : null,
      totalLedgers: row.total_ledgers,
      processedCount: row.processed_count,
      skippedCount: row.skipped_count,
      failedCount: row.failed_count,
      status: row.status,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }
}
