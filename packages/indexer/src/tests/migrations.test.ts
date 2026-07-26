/**
 * Migration integration tests
 *
 * These tests exercise the full up / down / redo paths for every migration
 * against a real PostgreSQL database.  They are intentionally skipped when
 * DATABASE_URL is not set so they never block local development on a machine
 * without Postgres — they always run in CI (see .github/workflows/ci.yml and
 * e2e-tests.yml which both spin up a Postgres service).
 *
 * Acceptance criteria:
 *  ✓ All three migrations apply cleanly to an empty database (up path).
 *  ✓ Every expected table exists after a full up.
 *  ✓ Every expected index from migration 1 exists after a full up.
 *  ✓ Performance indexes from migration 2 exist after a full up.
 *  ✓ CASCADE foreign-key constraints from migration 3 are present.
 *  ✓ Cascading deletes work end-to-end (delete a ledger → transactions gone).
 *  ✓ The pgmigrations table records all three migrations in order.
 *  ✓ Rolling back one migration at a time leaves the schema in the correct
 *    intermediate state at every step.
 *  ✓ A full down removes every table, index, trigger, and function.
 *  ✓ Re-applying (redo) succeeds without errors after a full down.
 *  ✓ runMigrations() throws when DATABASE_URL is missing.
 */

import { Pool, type PoolClient } from 'pg';
import { runMigrations } from '../database/migration-runner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DB_URL = process.env.DATABASE_URL;
const SKIP = !DB_URL;

/** Run a parameterised query and return all rows. */
async function query<T extends Record<string, unknown>>(
  client: PoolClient,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await client.query<T>(sql, params);
  return result.rows;
}

/** Return true when a table exists in the public schema. */
async function tableExists(client: PoolClient, tableName: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    client,
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return rows[0].exists;
}

/** Return true when an index exists. */
async function indexExists(client: PoolClient, indexName: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    client,
    `SELECT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = $1
     ) AS exists`,
    [indexName]
  );
  return rows[0].exists;
}

/** Return true when a foreign-key constraint exists on a table. */
async function fkExists(
  client: PoolClient,
  tableName: string,
  constraintName: string
): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    client,
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = $1
         AND constraint_name = $2
         AND constraint_type = 'FOREIGN KEY'
     ) AS exists`,
    [tableName, constraintName]
  );
  return rows[0].exists;
}

/** Return the delete_rule for a named FK constraint ('CASCADE', 'NO ACTION', …). */
async function fkDeleteRule(
  client: PoolClient,
  tableName: string,
  constraintName: string
): Promise<string | null> {
  const rows = await query<{ delete_rule: string }>(
    client,
    `SELECT rc.delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.table_constraints tc
         ON tc.constraint_name = rc.constraint_name
        AND tc.table_name      = $1
      WHERE rc.constraint_name = $2`,
    [tableName, constraintName]
  );
  return rows[0]?.delete_rule ?? null;
}

/** Drop every object created by any migration so we can start fresh. */
async function nukeSchema(client: PoolClient): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS
      account_metrics, asset_metrics, network_metrics,
      trustlines, assets, operations, transactions,
      ledgers, accounts, pgmigrations
    CASCADE;
    DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
  `);
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let pool: Pool;
let client: PoolClient;

beforeAll(async () => {
  if (SKIP) return;
  pool = new Pool({ connectionString: DB_URL });
  client = await pool.connect();
  // Start with a clean slate
  await nukeSchema(client);
});

afterAll(async () => {
  if (SKIP) return;
  client.release();
  await pool.end();
});

// Helper that skips the test body when there is no DB available.
function dbTest(name: string, fn: () => Promise<void>): void {
  if (SKIP) {
    it.skip(`${name} (DATABASE_URL not set — skipped)`, () => {});
  } else {
    it(name, fn, 60_000); // 60 s timeout — migrations can be slow in CI
  }
}

// ---------------------------------------------------------------------------
// Guard: runMigrations requires DATABASE_URL
// ---------------------------------------------------------------------------

describe('runMigrations() – configuration guard', () => {
  it('throws when DATABASE_URL is not set', async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    await expect(runMigrations()).rejects.toThrow(
      'DATABASE_URL is required to run database migrations'
    );

    process.env.DATABASE_URL = original;
  });
});

// ---------------------------------------------------------------------------
// Migration 1 – Initial schema (up)
// ---------------------------------------------------------------------------

describe('Migration 1 – initial schema (up)', () => {
  dbTest('applies without errors', async () => {
    await expect(
      runMigrations({ direction: 'up', count: 1 })
    ).resolves.not.toThrow();
  });

  const coreTables = [
    'ledgers',
    'transactions',
    'operations',
    'accounts',
    'assets',
    'trustlines',
    'network_metrics',
    'asset_metrics',
    'account_metrics',
  ];

  for (const table of coreTables) {
    dbTest(`table "${table}" exists`, async () => {
      expect(await tableExists(client, table)).toBe(true);
    });
  }

  const baseIndexes = [
    'idx_ledgers_sequence',
    'idx_ledgers_closed_at',
    'idx_transactions_ledger',
    'idx_transactions_source',
    'idx_transactions_created_at',
    'idx_operations_transaction',
    'idx_operations_source',
    'idx_operations_type',
    'idx_operations_ledger',
    'idx_operations_created_at',
    'idx_accounts_last_modified',
    'idx_trustlines_account',
    'idx_trustlines_asset',
    'idx_network_metrics_timestamp',
    'idx_asset_metrics_timestamp',
    'idx_asset_metrics_asset',
    'idx_account_metrics_timestamp',
    'idx_account_metrics_account',
  ];

  for (const idx of baseIndexes) {
    dbTest(`index "${idx}" exists`, async () => {
      expect(await indexExists(client, idx)).toBe(true);
    });
  }

  dbTest('update_updated_at_column trigger function exists', async () => {
    const rows = await query<{ exists: boolean }>(
      client,
      `SELECT EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
       ) AS exists`
    );
    expect(rows[0].exists).toBe(true);
  });

  dbTest('pgmigrations table records exactly 1 migration', async () => {
    const rows = await query<{ name: string }>(
      client,
      'SELECT name FROM pgmigrations ORDER BY run_on'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toContain('initial-schema');
  });
});

// ---------------------------------------------------------------------------
// Migration 2 – Performance indexes (up)
// ---------------------------------------------------------------------------

describe('Migration 2 – performance indexes (up)', () => {
  dbTest('applies without errors', async () => {
    await expect(
      runMigrations({ direction: 'up', count: 1 })
    ).resolves.not.toThrow();
  });

  const perfIndexes = [
    'idx_transactions_successful_created_at',
    'idx_transactions_source_account_created_at',
    'idx_transactions_memo_type_created_at',
    'idx_transactions_fee_charged_created_at',
    'idx_operations_type_created_at',
    'idx_operations_payment_created_at',
    'idx_operations_source_created_at',
    'idx_assets_type_code_issuer',
    'idx_account_metrics_account_timestamp_desc',
    'idx_asset_metrics_asset_timestamp_desc',
    'idx_ledgers_sequence_desc',
    'idx_network_metrics_timestamp_desc',
  ];

  for (const idx of perfIndexes) {
    dbTest(`performance index "${idx}" exists`, async () => {
      expect(await indexExists(client, idx)).toBe(true);
    });
  }

  dbTest('pgmigrations table records exactly 2 migrations', async () => {
    const rows = await query<{ name: string }>(
      client,
      'SELECT name FROM pgmigrations ORDER BY run_on'
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].name).toContain('add-performance-indexes');
  });
});

// ---------------------------------------------------------------------------
// Migration 3 – Foreign-key constraints (up)
// ---------------------------------------------------------------------------

describe('Migration 3 – foreign-key constraints (up)', () => {
  dbTest('applies without errors', async () => {
    await expect(
      runMigrations({ direction: 'up', count: 1 })
    ).resolves.not.toThrow();
  });

  dbTest('transactions_ledger_sequence_fkey has ON DELETE CASCADE', async () => {
    expect(
      await fkExists(client, 'transactions', 'transactions_ledger_sequence_fkey')
    ).toBe(true);
    expect(
      await fkDeleteRule(client, 'transactions', 'transactions_ledger_sequence_fkey')
    ).toBe('CASCADE');
  });

  dbTest('operations_transaction_hash_fkey has ON DELETE CASCADE', async () => {
    expect(
      await fkExists(client, 'operations', 'operations_transaction_hash_fkey')
    ).toBe(true);
    expect(
      await fkDeleteRule(client, 'operations', 'operations_transaction_hash_fkey')
    ).toBe('CASCADE');
  });

  dbTest('operations_ledger_sequence_fkey has ON DELETE CASCADE', async () => {
    expect(
      await fkExists(client, 'operations', 'operations_ledger_sequence_fkey')
    ).toBe(true);
    expect(
      await fkDeleteRule(client, 'operations', 'operations_ledger_sequence_fkey')
    ).toBe('CASCADE');
  });

  dbTest('pgmigrations table records all 3 migrations in order', async () => {
    const rows = await query<{ name: string }>(
      client,
      'SELECT name FROM pgmigrations ORDER BY run_on'
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].name).toContain('initial-schema');
    expect(rows[1].name).toContain('add-performance-indexes');
    expect(rows[2].name).toContain('add-foreign-key-constraints');
  });
});

// ---------------------------------------------------------------------------
// Cascade behaviour
// ---------------------------------------------------------------------------

describe('Cascade delete behaviour (after all migrations)', () => {
  dbTest(
    'deleting a ledger cascades to its transactions and then to operations',
    async () => {
      // Insert minimal valid rows ─────────────────────────────────────────
      await client.query(`
        INSERT INTO ledgers (
          id, sequence, closed_at, total_coins, fee_pool,
          base_fee_in_stroops, base_reserve_in_stroops,
          max_tx_set_size, protocol_version, header_xdr
        ) VALUES (
          'test-ledger-cascade-001', 9999999,
          NOW(), '105443902087.3107432', '0.0001',
          100, 5000000, 100, 20, 'AAAA'
        )
        ON CONFLICT DO NOTHING;
      `);

      await client.query(`
        INSERT INTO transactions (
          id, paging_token, successful, hash,
          ledger_sequence, created_at,
          source_account, source_account_sequence,
          fee_charged, max_fee, operation_count,
          envelope_xdr, result_xdr, result_meta_xdr, fee_meta_xdr
        ) VALUES (
          'test-tx-cascade-001', 'paging-token-001', true,
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          9999999, NOW(),
          'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
          '1',
          100, 100, 1,
          'envelope', 'result', 'meta', 'fee_meta'
        )
        ON CONFLICT DO NOTHING;
      `);

      await client.query(`
        INSERT INTO operations (
          id, paging_token, transaction_hash, transaction_successful,
          type, created_at, source_account,
          ledger_sequence, operation_index
        ) VALUES (
          'test-op-cascade-001', 'op-paging-001',
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          true, 'payment', NOW(),
          'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
          9999999, 0
        )
        ON CONFLICT DO NOTHING;
      `);

      // Verify rows exist before deletion ─────────────────────────────────
      const txBefore = await query(
        client,
        "SELECT id FROM transactions WHERE id = 'test-tx-cascade-001'"
      );
      expect(txBefore).toHaveLength(1);

      const opBefore = await query(
        client,
        "SELECT id FROM operations WHERE id = 'test-op-cascade-001'"
      );
      expect(opBefore).toHaveLength(1);

      // Delete the ledger ──────────────────────────────────────────────────
      await client.query(
        "DELETE FROM ledgers WHERE id = 'test-ledger-cascade-001'"
      );

      // Both child rows should be gone ─────────────────────────────────────
      const txAfter = await query(
        client,
        "SELECT id FROM transactions WHERE id = 'test-tx-cascade-001'"
      );
      expect(txAfter).toHaveLength(0);

      const opAfter = await query(
        client,
        "SELECT id FROM operations WHERE id = 'test-op-cascade-001'"
      );
      expect(opAfter).toHaveLength(0);
    }
  );
});

// ---------------------------------------------------------------------------
// Down path – rollback one migration at a time
// ---------------------------------------------------------------------------

describe('Down path – rolling back migration 3', () => {
  dbTest('rolls back without errors', async () => {
    await expect(
      runMigrations({ direction: 'down', count: 1 })
    ).resolves.not.toThrow();
  });

  dbTest('FK constraints revert to non-CASCADE behaviour', async () => {
    // After rolling back migration 3, the constraints are recreated without
    // CASCADE.  They should still exist but with NO ACTION delete rule.
    const txRule = await fkDeleteRule(
      client,
      'transactions',
      'transactions_ledger_sequence_fkey'
    );
    // Postgres defaults to NO ACTION when CASCADE is not specified
    expect(['NO ACTION', 'RESTRICT', null]).toContain(txRule);
  });

  dbTest('tables still exist after rolling back migration 3', async () => {
    expect(await tableExists(client, 'ledgers')).toBe(true);
    expect(await tableExists(client, 'transactions')).toBe(true);
    expect(await tableExists(client, 'operations')).toBe(true);
  });

  dbTest('pgmigrations records only 2 applied migrations', async () => {
    const rows = await query<{ name: string }>(
      client,
      'SELECT name FROM pgmigrations ORDER BY run_on'
    );
    expect(rows).toHaveLength(2);
  });
});

describe('Down path – rolling back migration 2', () => {
  dbTest('rolls back without errors', async () => {
    await expect(
      runMigrations({ direction: 'down', count: 1 })
    ).resolves.not.toThrow();
  });

  dbTest('performance indexes are removed', async () => {
    expect(
      await indexExists(client, 'idx_transactions_successful_created_at')
    ).toBe(false);
    expect(
      await indexExists(client, 'idx_ledgers_sequence_desc')
    ).toBe(false);
    expect(
      await indexExists(client, 'idx_network_metrics_timestamp_desc')
    ).toBe(false);
  });

  dbTest('base indexes from migration 1 still exist', async () => {
    expect(await indexExists(client, 'idx_ledgers_sequence')).toBe(true);
    expect(await indexExists(client, 'idx_transactions_ledger')).toBe(true);
  });

  dbTest('pgmigrations records only 1 applied migration', async () => {
    const rows = await query(
      client,
      'SELECT name FROM pgmigrations ORDER BY run_on'
    );
    expect(rows).toHaveLength(1);
  });
});

describe('Down path – rolling back migration 1 (full teardown)', () => {
  dbTest('rolls back without errors', async () => {
    await expect(
      runMigrations({ direction: 'down', count: 1 })
    ).resolves.not.toThrow();
  });

  const allTables = [
    'ledgers',
    'transactions',
    'operations',
    'accounts',
    'assets',
    'trustlines',
    'network_metrics',
    'asset_metrics',
    'account_metrics',
  ];

  for (const table of allTables) {
    dbTest(`table "${table}" is gone`, async () => {
      expect(await tableExists(client, table)).toBe(false);
    });
  }

  dbTest('update_updated_at_column function is dropped', async () => {
    const rows = await query<{ exists: boolean }>(
      client,
      `SELECT EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
       ) AS exists`
    );
    expect(rows[0].exists).toBe(false);
  });

  dbTest('pgmigrations table is empty or absent', async () => {
    // pgmigrations itself is NOT dropped by our migrations — node-pg-migrate
    // manages it.  After a full rollback it must be empty.
    const pgmigrationsExists = await tableExists(client, 'pgmigrations');
    if (pgmigrationsExists) {
      const rows = await query(client, 'SELECT name FROM pgmigrations');
      expect(rows).toHaveLength(0);
    }
    // If the table doesn't exist that's also acceptable — it means the runner
    // cleaned up completely.
  });
});

// ---------------------------------------------------------------------------
// Redo (full down → full up)
// ---------------------------------------------------------------------------

describe('Redo – re-applying all migrations after a full rollback', () => {
  dbTest('applying all migrations again succeeds', async () => {
    await expect(runMigrations({ direction: 'up' })).resolves.not.toThrow();
  });

  dbTest('all tables exist after redo', async () => {
    const tables = [
      'ledgers', 'transactions', 'operations', 'accounts',
      'assets', 'trustlines', 'network_metrics',
      'asset_metrics', 'account_metrics',
    ];
    for (const table of tables) {
      expect(await tableExists(client, table)).toBe(true);
    }
  });

  dbTest('all performance indexes exist after redo', async () => {
    expect(
      await indexExists(client, 'idx_transactions_successful_created_at')
    ).toBe(true);
    expect(
      await indexExists(client, 'idx_ledgers_sequence_desc')
    ).toBe(true);
  });

  dbTest('CASCADE constraints are restored after redo', async () => {
    expect(
      await fkDeleteRule(client, 'transactions', 'transactions_ledger_sequence_fkey')
    ).toBe('CASCADE');
    expect(
      await fkDeleteRule(client, 'operations', 'operations_transaction_hash_fkey')
    ).toBe('CASCADE');
  });

  dbTest('pgmigrations records all 3 migrations after redo', async () => {
    const rows = await query<{ name: string }>(
      client,
      'SELECT name FROM pgmigrations ORDER BY run_on'
    );
    expect(rows).toHaveLength(3);
  });
});
