import path from 'path';
import { Pool } from 'pg';
import migrate from 'node-pg-migrate';
import { SchemaVersionManager, CODE_SCHEMA_VERSION, CODE_SCHEMA_DESCRIPTION } from './schema-version';

export type MigrationDirection = 'up' | 'down';

export interface RunMigrationOptions {
  direction?: MigrationDirection;
  count?: number;
  /**
   * When true (default), schema-version validation runs before migrating.
   * Set to false only during testing when you want to bypass the check.
   */
  validateSchemaVersion?: boolean;
  /**
   * Optional Pool instance. When provided, schema-version checks use this
   * instead of creating a new connection, which is useful during tests.
   */
  pool?: Pool;
}

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

/**
 * Run database migrations (up or down).
 *
 * When running `up`, this function:
 *  1. Checks schema version compatibility before running migrations.
 *  2. Runs pending migrations via node-pg-migrate.
 *  3. Records the current schema version after a successful run.
 */
export async function runMigrations(options: RunMigrationOptions = {}): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run database migrations');
  }

  const direction = options.direction ?? 'up';
  const migrationsDir = path.join(__dirname, '../../migrations');

  // Create a pool for the schema-version manager
  const pool =
    options.pool ??
    new Pool({
      connectionString: databaseUrl,
      max: 1, // minimal pool for version checks
    });

  const versionManager = new SchemaVersionManager(pool);

  // ── Pre-migration: check schema version compatibility ──────────────────
  if (direction === 'up' && options.validateSchemaVersion !== false) {
    await versionManager.initialize();

    const compatibility = await versionManager.checkCompatibility();
    if (!compatibility.compatible && compatibility.fatal) {
      const msg = `❌ ${compatibility.message}`;
      console.error(msg);
      throw new Error(msg);
    }

    if (!compatibility.compatible) {
      console.warn(`⚠️  ${compatibility.message}`);
    } else if (compatibility.message) {
      console.log(`ℹ️  ${compatibility.message}`);
    }
  }

  // ── Run migrations ─────────────────────────────────────────────────────
  await migrate({
    databaseUrl,
    dir: migrationsDir,
    direction,
    count: options.count,
    migrationsTable: 'pgmigrations',
    log: console.log,
    verbose: true,
    checkOrder: true,
  });

  // ── Post-migration: record schema version ──────────────────────────────
  if (direction === 'up') {
    try {
      await versionManager.setVersion(
        CODE_SCHEMA_VERSION,
        CODE_SCHEMA_DESCRIPTION,
      );
      console.log(`ℹ️  Schema version updated to ${CODE_SCHEMA_VERSION}`);
    } catch (err) {
      // Non-fatal: the migration itself succeeded, version recording is a bonus
      console.warn(
        `⚠️  Could not record schema version: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Clean up the pool only if we created it
  if (!options.pool) {
    await pool.end();
  }
}
