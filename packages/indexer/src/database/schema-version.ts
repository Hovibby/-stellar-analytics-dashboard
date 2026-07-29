/**
 * SchemaVersionManager – explicit schema version tracking and compatibility checks.
 *
 * Provides a durable `schema_version` table in PostgreSQL that records the logical
 * schema version (semver) independently of the individual migration files tracked
 * by node-pg-migrate.
 *
 * ## Version compatibility rules
 *
 * | Condition                         | Result  | Meaning                              |
 * |-----------------------------------|---------|--------------------------------------|
 * | DB major  <  code major            | FATAL   | Schema is too old – migrate first    |
 * | DB major  >  code major            | FATAL   | Code is too old – deploy newer code  |
 * | DB major == code major             | OK      | Compatible                           |
 * | DB minor  <  code min minor        | WARN    | Schema is slightly behind – migrate  |
 * | DB minor  >= code min minor        | OK      | Compatible                           |
 *
 * PATCH differences are always non-breaking and produce no warnings.
 */

import { Pool, PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

export interface SchemaVersionRecord {
  version: string;
  description: string;
  compatible_min_version: string;
  applied_at: Date;
}

export interface CompatibilityResult {
  compatible: boolean;
  fatal: boolean;
  message: string;
}

/**
 * The _minimum_ schema version the current code requires.
 *
 * Bump `MINOR` when a migration adds optional columns/tables.
 * Bump `MAJOR` when a migration removes or renames columns/tables.
 *
 * The PATCH part is informational and must match the _latest_ schema version.
 */
export const CODE_SCHEMA_VERSION = '1.0.0';
export const CODE_SCHEMA_DESCRIPTION = 'Initial schema with ledgers, transactions, operations, and metrics';

// ---------------------------------------------------------------------------
// SchemaVersionManager
// ---------------------------------------------------------------------------

export class SchemaVersionManager {
  private initialized = false;

  constructor(private readonly pool: Pool) {}

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /**
   * Ensure the `schema_version` table exists.
   *
   * Safe to call multiple times – subsequent calls are no-ops once
   * `initialized` is true.
   */
  async initialize(providedClient?: PoolClient): Promise<void> {
    if (this.initialized) return;

    const client = providedClient ?? (await this.pool.connect());
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version               VARCHAR(32)   NOT NULL,
          description           TEXT          NOT NULL DEFAULT '',
          compatible_min_version VARCHAR(32)  NOT NULL DEFAULT '0.0.0',
          applied_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
          PRIMARY KEY (version)
        )
      `);

      this.initialized = true;
    } finally {
      if (!providedClient) client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Read API
  // -------------------------------------------------------------------------

  /**
   * Return the current schema version record, or `null` if the table is empty.
   */
  async getCurrentVersion(): Promise<SchemaVersionRecord | null> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<SchemaVersionRecord>(
        `SELECT version, description, compatible_min_version, applied_at
         FROM schema_version
         ORDER BY applied_at DESC
         LIMIT 1`
      );
      return rows[0] ?? null;
    } finally {
      client.release();
    }
  }

  /**
   * Return all schema version records ordered by `applied_at` (oldest first).
   */
  async getVersionHistory(): Promise<SchemaVersionRecord[]> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<SchemaVersionRecord>(
        `SELECT version, description, compatible_min_version, applied_at
         FROM schema_version
         ORDER BY applied_at ASC`
      );
      return rows;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Write API
  // -------------------------------------------------------------------------

  /**
   * Record a new schema version.
   *
   * @param version    – The new schema version (e.g. "1.0.0").
   * @param description – Human-readable description of what changed.
   * @param compatibleMinVersion – The earliest code version compatible with this schema.
   */
  async setVersion(
    version: string,
    description: string,
    compatibleMinVersion?: string,
  ): Promise<void> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO schema_version (version, description, compatible_min_version)
         VALUES ($1, $2, $3)
         ON CONFLICT (version) DO UPDATE SET
           description = EXCLUDED.description,
           compatible_min_version = EXCLUDED.compatible_min_version,
           applied_at = NOW()`,
        [version, description, compatibleMinVersion ?? version],
      );
    } finally {
      client.release();
    }
  }

  /**
   * Remove all schema version records (for testing).
   */
  async clearVersions(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM schema_version');
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Compatibility
  // -------------------------------------------------------------------------

  /**
   * Compare two semver strings. Returns:
   *   -1 when a < b
   *    0 when a == b
   *    1 when a > b
   */
  static compareSemver(a: string, b: string): -1 | 0 | 1 {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const aVal = aParts[i] ?? 0;
      const bVal = bParts[i] ?? 0;
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
    }
    return 0;
  }

  /**
   * Parse a semver string into its components.
   */
  static parseSemver(
    v: string,
  ): { major: number; minor: number; patch: number } {
    const parts = v.split('.').map(Number);
    return {
      major: parts[0] ?? 0,
      minor: parts[1] ?? 0,
      patch: parts[2] ?? 0,
    };
  }

  /**
   * Check whether `codeVersion` is compatible with the schema in the database.
   *
   * Returns a `CompatibilityResult` – never throws.
   */
  async checkCompatibility(
    codeVersion: string = CODE_SCHEMA_VERSION,
  ): Promise<CompatibilityResult> {
    await this.initialize();

    const dbVersion = await this.getCurrentVersion();

    if (!dbVersion) {
      return {
        compatible: false,
        fatal: true,
        message:
          'No schema version found in the database. ' +
          'Run migrations with `pnpm db:migrate` before starting the indexer.',
      };
    }

    return SchemaVersionManager.checkVersionCompatibility(
      dbVersion.version,
      codeVersion,
    );
  }

  /**
   * Pure function: compare two semver strings and return a compatibility result.
   * Separated so it can be tested without a database connection.
   */
  static checkVersionCompatibility(
    dbVersion: string,
    codeVersion: string,
  ): CompatibilityResult {
    const db = SchemaVersionManager.parseSemver(dbVersion);
    const code = SchemaVersionManager.parseSemver(codeVersion);

    // ---- Major mismatch (breaking) -----------------------------------------
    if (db.major < code.major) {
      return {
        compatible: false,
        fatal: true,
        message:
          `Schema version ${dbVersion} is too old. ` +
          `Code requires major version ${code.major}. ` +
          `Run \`pnpm db:migrate\` to upgrade the schema.`,
      };
    }

    if (db.major > code.major) {
      return {
        compatible: false,
        fatal: true,
        message:
          `Code schema version ${codeVersion} is too old for database ` +
          `schema ${dbVersion}. Deploy newer application code first.`,
      };
    }

    // ---- Minor mismatch (non-breaking but warn) ----------------------------
    if (db.minor < code.minor) {
      return {
        compatible: true,
        fatal: false,
        message:
          `Schema version ${dbVersion} is behind code version ${codeVersion}. ` +
          `Run \`pnpm db:migrate\` to apply pending migrations.`,
      };
    }

    // ---- Fully compatible --------------------------------------------------
    return {
      compatible: true,
      fatal: false,
      message: `Schema version ${dbVersion} is compatible with code version ${codeVersion}.`,
    };
  }

  // -------------------------------------------------------------------------
  // Migration validation
  // -------------------------------------------------------------------------

  /**
   * Validate that the list of applied migrations in `pgmigrations` is
   * consistent and complete.
   *
   * Checks:
   *  1. Migrations are present.
   *  2. Migration names follow the expected <timestamp>_<name> pattern.
   *  3. No gaps in timestamps (every migration has been applied).
   *
   * @param expectedMigrationNames – Full file names (e.g. "1738000000000_initial-schema").
   *                                 Pass `null` to skip the completeness check.
   *
   * Returns an array of validation errors (empty = valid).
   */
  async validateMigrations(
    expectedMigrationNames: string[] | null = null,
  ): Promise<string[]> {
    const errors: string[] = [];

    const client = await this.pool.connect();
    try {
      // Check pgmigrations exists
      const { rows: tableRows } = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'pgmigrations'
         ) AS exists`
      );

      if (!tableRows[0]?.exists) {
        errors.push('pgmigrations table does not exist – no migrations have been run.');
        return errors;
      }

      // Fetch applied migrations sorted by run_on
      const { rows: migrations } = await client.query<{
        name: string;
        run_on: Date;
      }>(
        `SELECT name, run_on FROM pgmigrations ORDER BY run_on ASC`
      );

      if (migrations.length === 0) {
        errors.push('pgmigrations table exists but is empty – no migrations have been applied.');
        return errors;
      }

      // Validate migration name format
      const namePattern = /^\d{12,}_/;
      for (const m of migrations) {
        if (!namePattern.test(m.name)) {
          errors.push(
            `Migration "${m.name}" does not follow the expected ` +
            `<timestamp>_<name> naming convention.`,
          );
        }
      }

      // If expected names were provided, check completeness and ordering
      if (expectedMigrationNames !== null && expectedMigrationNames.length > 0) {
        const appliedNames = migrations.map((m) => m.name);

        // Check for missing migrations
        for (const expected of expectedMigrationNames) {
          if (!appliedNames.includes(expected)) {
            errors.push(
              `Expected migration "${expected}" has not been applied. ` +
              `Run \`pnpm db:migrate\` to apply pending migrations.`,
            );
          }
        }

        // Check for unexpected migrations (applied but not in expected set)
        for (const applied of appliedNames) {
          if (!expectedMigrationNames.includes(applied)) {
            errors.push(
              `Unexpected migration "${applied}" is applied but not in the expected set. ` +
              `This may indicate a migration from a different branch or version.`,
            );
          }
        }

        // Check ordering: timestamps in applied names should match expected order
        const appliedTimestamps = migrations.map((m) => {
          const match = m.name.match(/^(\d{12,})/);
          return match ? parseInt(match[1], 10) : 0;
        });

        for (let i = 1; i < appliedTimestamps.length; i++) {
          if (appliedTimestamps[i] <= appliedTimestamps[i - 1]) {
            errors.push(
              `Migration order violation: migration at index ${i} has timestamp ` +
              `${appliedTimestamps[i]} which is <= previous timestamp ` +
              `${appliedTimestamps[i - 1]}. Migrations must be applied in order.`,
            );
          }
        }
      }
    } finally {
      client.release();
    }

    return errors;
  }
}
