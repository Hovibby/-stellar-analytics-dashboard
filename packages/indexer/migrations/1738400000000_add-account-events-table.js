/**
 * Migration 1738400000000 – Add account_events table.
 *
 * Tracks discrete account-level state changes captured from Stellar
 * network operations (account creation, merge, balance change, signer
 * updates, trustline changes, data entry changes, sponsorship changes,
 * etc.) for downstream analytics, audit, and notification consumers.
 *
 * Acceptances criteria:
 *  ✓ The account_events table is created with the correct schema.
 *  ✓ A unique index (id) prevents duplicates.
 *  ✓ Performance indexes exist on (account_id, created_at),
 *    (type, created_at), and (ledger_sequence).
 *  ✓ The table is included in pgmigrations tracking.
 *  ✓ Rolling back drops the table and its indexes.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE account_events (
      id              VARCHAR(72)   PRIMARY KEY,
      account_id      VARCHAR(56)   NOT NULL,
      type            VARCHAR(40)   NOT NULL,
      ledger_sequence INTEGER       NOT NULL,
      transaction_hash VARCHAR(64)  NOT NULL,
      created_at      TIMESTAMP WITH TIME ZONE NOT NULL,
      previous_value  JSONB,
      new_value       JSONB,
      details         JSONB,
      row_created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX idx_account_events_account_created
      ON account_events (account_id, created_at DESC);

    CREATE INDEX idx_account_events_type_created
      ON account_events (type, created_at DESC);

    CREATE INDEX idx_account_events_ledger
      ON account_events (ledger_sequence);

    CREATE INDEX idx_account_events_created_at
      ON account_events (created_at DESC);
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS account_events CASCADE;
  `);
};
