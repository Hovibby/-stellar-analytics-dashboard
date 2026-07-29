/**
 * Add backfill_checkpoints table for resumable backfills.
 *
 * The backfill_checkpoints table records the current progress of each backfill
 * job so that a restarted backfill can continue from the last successful
 * checkpoint rather than starting over.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
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
    );

    CREATE INDEX IF NOT EXISTS idx_backfill_checkpoints_network
      ON backfill_checkpoints (network, status);

    CREATE INDEX IF NOT EXISTS idx_backfill_checkpoints_last_sequence
      ON backfill_checkpoints (last_processed_sequence);

    CREATE INDEX IF NOT EXISTS idx_backfill_checkpoints_updated_at
      ON backfill_checkpoints (updated_at DESC);
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_backfill_checkpoints_updated_at;
    DROP INDEX IF EXISTS idx_backfill_checkpoints_last_sequence;
    DROP INDEX IF EXISTS idx_backfill_checkpoints_network;
    DROP TABLE IF EXISTS backfill_checkpoints;
  `);
};
