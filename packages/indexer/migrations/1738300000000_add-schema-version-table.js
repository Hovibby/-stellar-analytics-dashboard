/**
 * Schema versioning – adds a durable `schema_version` table for explicit
 * schema compatibility tracking, independent of the individual migration
 * files tracked by node-pg-migrate.
 *
 * Acceptance criteria:
 *  ✓ The `schema_version` table exists after this migration.
 *  ✓ The initial schema version "1.0.0" is recorded.
 *  ✓ Rolling back this migration drops the table.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- Schema versioning table
    -- Records each logical schema version so application code can check
    -- compatibility before connecting.
    CREATE TABLE IF NOT EXISTS schema_version (
      version               VARCHAR(32)   NOT NULL,
      description           TEXT          NOT NULL DEFAULT '',
      compatible_min_version VARCHAR(32)  NOT NULL DEFAULT '0.0.0',
      applied_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      PRIMARY KEY (version)
    );

    -- Record the current schema version
    INSERT INTO schema_version (version, description, compatible_min_version)
    VALUES (
      '1.0.0',
      'Initial schema with ledgers, transactions, operations, and metrics tables',
      '1.0.0'
    );
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS schema_version CASCADE;
  `);
};
