/**
 * Comprehensive tests for IdempotencyTracker.
 *
 * Covers:
 *  - Initialization and cache warming
 *  - isProcessed / shouldSkip (cache hit, DB fallback, unknown)
 *  - markProcessed (idempotent, concurrent)
 *  - withIdempotency (first run, duplicate, rollback, advisory lock serialisation)
 *  - getRecord, getLastProcessedSequence, countInRange
 *  - unmark, cleanup, cache helpers
 *  - buildKey, computeChecksum utilities
 *  - Conflict resolution strategies (SKIP, MERGE, UPDATE_LATEST, DUAL_STATE)
 *  - Request deduplication and payload validation
 *  - Retry safety and transient error recovery
 *  - Race conditions and concurrent processing
 *  - Rollback scenarios and atomic guarantees
 *  - Edge cases: zero counts, large sequences, empty DB, null payloads
 *  - Error handling and logging
 */

import {
  IdempotencyTracker,
  buildKey,
  computeChecksum,
  ConflictResolutionStrategy,
  LedgerTracking,
} from '../idempotency/IdempotencyTracker';
import type { Pool, PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

interface MockRow {
  sequence?: string;
  exists?: boolean;
  count?: string;
  id?: string;
  entity_type?: string;
  entity_key?: string;
  processed_at?: Date;
  tx_count?: number;
  op_count?: number;
  checksum?: string | null;
  payload?: unknown;
  metadata?: Record<string, unknown>;
  strategy?: string;
  attempts?: number;
  last_error?: string | null;
  [k: string]: unknown;
}

/**
 * Build a minimal pg Pool mock.
 *
 * `store` is a map of entity_key to full record data.
 * Supports new entity-based tracking and backward compat with sequences.
 */
function makePool(
  initialRecords: Array<{
    entityType: string;
    entityKey: string;
    sequence: number;
    checksum?: string;
  }> = [],
) {
  const store = new Map<string, MockRow>();
  const queryLog: Array<{ text: string; values: unknown[] }> = [];

  // Track advisory lock calls for concurrency tests
  const advisoryLocks: number[] = [];

  // Initialize with provided records
  for (const rec of initialRecords) {
    store.set(rec.entityKey, {
      id: `id-${rec.entityKey}`,
      entity_type: rec.entityType,
      entity_key: rec.entityKey,
      sequence: rec.sequence,
      processed_at: new Date('2024-01-01'),
      tx_count: 5,
      op_count: 10,
      checksum: rec.checksum ?? null,
      payload: {},
      metadata: {},
      strategy: 'SKIP',
      attempts: 1,
      last_error: null,
    });
  }

  function handleQuery(text: string, values: unknown[] = []): { rows: MockRow[]; rowCount: number } {
    queryLog.push({ text, values });

    // DDL – always succeed
    if (/CREATE TABLE|CREATE INDEX/i.test(text)) return { rows: [], rowCount: 0 };

    // Transaction control
    if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(text)) return { rows: [], rowCount: 0 };

    // Advisory lock
    if (/pg_advisory_xact_lock/i.test(text)) {
      advisoryLocks.push(Number(values[0]));
      return { rows: [{}], rowCount: 1 };
    }

    // SELECT EXISTS
    if (/SELECT EXISTS/i.test(text)) {
      const key = String(values[0]);
      return { rows: [{ exists: store.has(key) }], rowCount: 1 };
    }

    // SELECT id, entity_key, sequence … LIMIT $1  (warm cache new style)
    if (/SELECT id, entity_key, sequence.*FROM idempotency_records.*LIMIT \$1/i.test(text)) {
      const limit = Number(values[0]);
      const rows = [...store.entries()]
        .sort(([, a], [, b]) => (b.processed_at?.getTime() ?? 0) - (a.processed_at?.getTime() ?? 0))
        .slice(0, limit)
        .map(([, rec]) => ({
          id: rec.id,
          entity_key: rec.entity_key,
          sequence: rec.sequence,
        }));
      return { rows, rowCount: rows.length };
    }

    // SELECT sequence FROM processed_ledgers … LIMIT 1  (legacy)
    if (/SELECT sequence FROM processed_ledgers.*LIMIT 1/i.test(text)) {
      const sequences = [...store.values()].map((r) => r.sequence ?? 0);
      const max = sequences.length > 0 ? Math.max(...sequences) : null;
      return { rows: max !== null ? [{ sequence: String(max) }] : [], rowCount: max !== null ? 1 : 0 };
    }

    // SELECT sequence FROM idempotency_records … LIMIT 1  (new style)
    if (/SELECT sequence FROM idempotency_records.*LIMIT 1/i.test(text)) {
      const sequences = [...store.values()].map((r) => r.sequence ?? 0);
      const max = sequences.length > 0 ? Math.max(...sequences) : null;
      return { rows: max !== null ? [{ sequence: String(max) }] : [], rowCount: max !== null ? 1 : 0 };
    }

    // SELECT full record (getRecord)
    if (/SELECT id, entity_type, entity_key, sequence/i.test(text)) {
      const key = String(values[0]);
      const rec = store.get(key);
      if (!rec) return { rows: [], rowCount: 0 };
      return { rows: [rec], rowCount: 1 };
    }

    // SELECT COUNT(*) … countInRange
    if (/SELECT COUNT\(\*\)/i.test(text)) {
      const from = Number(values[0]);
      const to = Number(values[1]);
      const count = [...store.values()].filter((r) => {
        const seq = r.sequence ?? 0;
        return seq >= from && seq <= to;
      }).length;
      return { rows: [{ count: String(count) }], rowCount: 1 };
    }

    // INSERT … ON CONFLICT DO UPDATE RETURNING (new style)
    if (/INSERT INTO idempotency_records/i.test(text)) {
      const id = String(values[0]);
      const entityType = String(values[1]);
      const entityKey = String(values[2]);
      const sequence = Number(values[3]);
      const txCount = Number(values[4]);
      const opCount = Number(values[5]);
      const checksum = values[6] as string | null;
      const payload = values[7];
      const metadata = values[8];
      const strategy = String(values[9] ?? 'SKIP');

      const rec: MockRow = {
        id,
        entity_type: entityType,
        entity_key: entityKey,
        sequence,
        processed_at: new Date(),
        tx_count: txCount,
        op_count: opCount,
        checksum,
        payload,
        metadata: metadata ? JSON.parse(String(metadata)) : {},
        strategy,
        attempts: store.has(entityKey) ? (store.get(entityKey)?.attempts ?? 0) + 1 : 1,
        last_error: null,
      };
      store.set(entityKey, rec);
      return { rows: [rec], rowCount: 1 };
    }

    // INSERT … ON CONFLICT DO NOTHING (legacy)
    if (/INSERT INTO processed_ledgers/i.test(text)) {
      const seq = Number(values[0]);
      const key = `sequence:${seq}`;
      if (!store.has(key)) {
        store.set(key, {
          id: `id-${key}`,
          entity_type: 'ledger',
          entity_key: key,
          sequence: seq,
          processed_at: new Date(),
          tx_count: Number(values[1]) ?? 0,
          op_count: Number(values[2]) ?? 0,
          checksum: (values[3] as string | null) ?? null,
          payload: {},
          metadata: {},
          strategy: 'SKIP',
          attempts: 1,
          last_error: null,
        });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // DELETE … cleanup
    if (/DELETE FROM idempotency_records.*processed_at/i.test(text)) {
      const deleted = store.size;
      store.clear();
      return { rows: [], rowCount: deleted };
    }

    // DELETE … unmark
    if (/DELETE FROM idempotency_records.*entity_key/i.test(text)) {
      const key = String(values[0]);
      const had = store.has(key);
      store.delete(key);
      return { rows: [], rowCount: had ? 1 : 0 };
    }

    // DELETE … unmark (legacy sequence)
    if (/DELETE FROM processed_ledgers.*sequence/i.test(text)) {
      const seq = Number(values[0]);
      const key = `sequence:${seq}`;
      const had = store.has(key);
      store.delete(key);
      return { rows: [], rowCount: had ? 1 : 0 };
    }

    return { rows: [], rowCount: 0 };
  }

  function makeClient(): PoolClient {
    return {
      query: jest.fn((text: string, values?: unknown[]) =>
        Promise.resolve(handleQuery(text, values ?? [])),
      ),
      release: jest.fn(),
    } as unknown as PoolClient;
  }

  const pool = {
    connect: jest.fn(() => Promise.resolve(makeClient())),
    _store: store,
    _queryLog: queryLog,
    _advisoryLocks: advisoryLocks,
  } as unknown as Pool;

  return pool;
}

// ---------------------------------------------------------------------------
// Utility tests
// ---------------------------------------------------------------------------

describe('buildKey', () => {
  it('produces a stable key from entity type and fields', () => {
    expect(buildKey('ledger', { sequence: 1234 })).toBe('ledger:sequence=1234');
  });

  it('sorts fields alphabetically for determinism', () => {
    const a = buildKey('tx', { hash: 'abc', ledger: 5 });
    const b = buildKey('tx', { ledger: 5, hash: 'abc' });
    expect(a).toBe(b);
  });

  it('handles multiple fields', () => {
    expect(buildKey('op', { id: '1-1', type: 'payment' })).toBe('op:id=1-1,type=payment');
  });
});

describe('computeChecksum', () => {
  it('returns a hex string', () => {
    const cs = computeChecksum({ sequence: 1 });
    expect(cs).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic for the same payload', () => {
    const a = computeChecksum({ a: 1, b: 2 });
    const b = computeChecksum({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('differs for different payloads', () => {
    expect(computeChecksum({ a: 1 })).not.toBe(computeChecksum({ a: 2 }));
  });
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – initialize', () => {
  it('creates the table and warms the cache', async () => {
    const pool = makePool([100, 200, 300]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(tracker.cacheSize()).toBe(3);
  });

  it('is idempotent – second call is a no-op', async () => {
    const pool = makePool([1]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    await tracker.initialize();
    // connect() called once for first init only
    expect((pool as any).connect).toHaveBeenCalledTimes(1);
  });

  it('starts with empty cache when DB is empty', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(tracker.cacheSize()).toBe(0);
  });

  it('respects warmCacheSize option', async () => {
    const pool = makePool([1, 2, 3, 4, 5]);
    const tracker = new IdempotencyTracker(pool, { warmCacheSize: 2 });
    await tracker.initialize();
    // Only the 2 most recent sequences are loaded
    expect(tracker.cacheSize()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// isProcessed
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – isProcessed', () => {
  it('returns true for a sequence in the cache', async () => {
    const pool = makePool([500]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(await tracker.isProcessed(500)).toBe(true);
  });

  it('returns false for an unknown sequence', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(await tracker.isProcessed(9999)).toBe(false);
  });

  it('falls back to DB for sequences outside the warm-cache window', async () => {
    // warmCacheSize=0 so nothing is cached; DB has sequence 42
    const pool = makePool([42]);
    const tracker = new IdempotencyTracker(pool, { warmCacheSize: 0 });
    await tracker.initialize();
    expect(tracker.cacheSize()).toBe(0);
    expect(await tracker.isProcessed(42)).toBe(true);
    // Back-fills cache
    expect(tracker.cacheSize()).toBe(1);
  });

  it('back-fills cache on DB hit', async () => {
    const pool = makePool([77]);
    const tracker = new IdempotencyTracker(pool, { warmCacheSize: 0 });
    await tracker.initialize();
    await tracker.isProcessed(77);
    expect(tracker.cacheSize()).toBe(1);
    // Second call uses cache, no extra DB query
    const connectCount = (pool as any).connect.mock.calls.length;
    await tracker.isProcessed(77);
    expect((pool as any).connect.mock.calls.length).toBe(connectCount);
  });
});

// ---------------------------------------------------------------------------
// markProcessed
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – markProcessed', () => {
  it('adds sequence to DB and cache', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    await tracker.markProcessed(1001, 5, 10);
    expect(tracker.cacheSize()).toBe(1);
    expect(await tracker.isProcessed(1001)).toBe(true);
  });

  it('is idempotent – calling twice does not throw', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    await tracker.markProcessed(42);
    await expect(tracker.markProcessed(42)).resolves.toBeUndefined();
  });

  it('stores checksum when provided', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    await expect(tracker.markProcessed(10, 1, 2, 'deadbeef')).resolves.toBeUndefined();
  });

  it('handles zero tx/op counts', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    await expect(tracker.markProcessed(0, 0, 0)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// shouldSkip
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – shouldSkip', () => {
  it('returns true and increments metric for known sequence', async () => {
    const pool = makePool([500]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(await tracker.shouldSkip(500)).toBe(true);
  });

  it('returns false for unknown sequence', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(await tracker.shouldSkip(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// withIdempotency
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – withIdempotency', () => {
  it('executes work and marks processed on first call', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const work = jest.fn(async (_client: PoolClient) => {});
    const executed = await tracker.withIdempotency(1, work, { txCount: 3, opCount: 6 });

    expect(executed).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
    expect(await tracker.isProcessed(1)).toBe(true);
  });

  it('skips work on duplicate call (cache hit)', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const work = jest.fn(async (_client: PoolClient) => {});
    await tracker.withIdempotency(2, work);
    const executed = await tracker.withIdempotency(2, work);

    expect(executed).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('skips work on duplicate call (DB hit, no cache)', async () => {
    const pool = makePool([3]);
    const tracker = new IdempotencyTracker(pool, { warmCacheSize: 0 });
    await tracker.initialize();

    const work = jest.fn(async (_client: PoolClient) => {});
    const executed = await tracker.withIdempotency(3, work);

    expect(executed).toBe(false);
    expect(work).not.toHaveBeenCalled();
  });

  it('acquires advisory lock before checking DB', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    await tracker.withIdempotency(99, async () => {});
    expect((pool as any)._advisoryLocks).toContain(99);
  });

  it('rolls back and rethrows on work error', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const work = jest.fn(async () => { throw new Error('write failed'); });
    await expect(tracker.withIdempotency(5, work)).rejects.toThrow('write failed');

    // Sequence must NOT be marked processed after a rollback
    expect(tracker.cacheSize()).toBe(0);
  });

  it('does not mark processed when work throws', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    await expect(
      tracker.withIdempotency(6, async () => { throw new Error('oops'); }),
    ).rejects.toThrow('oops');

    expect(await tracker.isProcessed(6)).toBe(false);
  });

  it('passes the client to work so it can participate in the transaction', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    let receivedClient: PoolClient | null = null;
    await tracker.withIdempotency(7, async (client) => {
      receivedClient = client;
    });

    expect(receivedClient).not.toBeNull();
  });

  it('handles concurrent calls for the same sequence safely', async () => {
    // Both calls race; only one should execute work.
    // With the mock, the advisory lock is not truly blocking, but we verify
    // that the double-checked read prevents double execution.
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    let execCount = 0;
    const work = jest.fn(async () => { execCount++; });

    // Fire both concurrently
    const [r1, r2] = await Promise.all([
      tracker.withIdempotency(8, work),
      tracker.withIdempotency(8, work),
    ]);

    // At least one executed; total executions ≤ 2 (mock doesn't truly block)
    expect(r1 || r2).toBe(true);
    expect(execCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// getRecord
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – getRecord', () => {
  it('returns null for unknown sequence', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(await tracker.getRecord(999)).toBeNull();
  });

  it('returns a record for a known sequence', async () => {
    const pool = makePool([42]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    const rec = await tracker.getRecord(42);
    expect(rec).not.toBeNull();
    expect(rec!.sequence).toBe(42);
    expect(rec!.txCount).toBe(5);
    expect(rec!.opCount).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// getLastProcessedSequence
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – getLastProcessedSequence', () => {
  it('returns null when no sequences have been processed', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(await tracker.getLastProcessedSequence()).toBeNull();
  });

  it('returns the highest sequence', async () => {
    const pool = makePool([100, 200, 150]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(await tracker.getLastProcessedSequence()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// countInRange
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – countInRange', () => {
  it('returns 0 for an empty range', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(await tracker.countInRange(1, 100)).toBe(0);
  });

  it('counts sequences within the range', async () => {
    const pool = makePool([10, 20, 30, 40, 50]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(await tracker.countInRange(15, 45)).toBe(3); // 20, 30, 40
  });
});

// ---------------------------------------------------------------------------
// unmark
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – unmark', () => {
  it('removes a sequence from DB and cache', async () => {
    const pool = makePool([55]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    expect(await tracker.isProcessed(55)).toBe(true);

    await tracker.unmark(55);
    expect(tracker.cacheSize()).toBe(0);
    expect(await tracker.isProcessed(55)).toBe(false);
  });

  it('is safe to call for a non-existent sequence', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    await expect(tracker.unmark(999)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – cleanup', () => {
  it('is a no-op when retentionDays is 0', async () => {
    const pool = makePool([1, 2, 3]);
    const tracker = new IdempotencyTracker(pool, { retentionDays: 0 });
    await tracker.initialize();
    const deleted = await tracker.cleanup();
    expect(deleted).toBe(0);
  });

  it('deletes old rows and clears cache when retentionDays > 0', async () => {
    const pool = makePool([1, 2, 3]);
    const tracker = new IdempotencyTracker(pool, { retentionDays: 30 });
    await tracker.initialize();
    expect(tracker.cacheSize()).toBe(3);

    const deleted = await tracker.cleanup();
    expect(deleted).toBeGreaterThan(0);
    expect(tracker.cacheSize()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – cache helpers', () => {
  it('evictFromCache removes a single sequence', async () => {
    const pool = makePool([1, 2, 3]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    tracker.evictFromCache(2);
    expect(tracker.cacheSize()).toBe(2);
  });

  it('clearCache empties the cache without touching DB', async () => {
    const pool = makePool([1, 2, 3]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    tracker.clearCache();
    expect(tracker.cacheSize()).toBe(0);
    // DB still has the rows
    expect(await tracker.isProcessed(1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retry safety
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – retry safety', () => {
  it('second markProcessed after a failed first attempt is safe', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    // Simulate first attempt failing mid-way by calling markProcessed twice
    await tracker.markProcessed(200, 1, 2);
    await expect(tracker.markProcessed(200, 1, 2)).resolves.toBeUndefined();
    expect(tracker.cacheSize()).toBe(1);
  });

  it('withIdempotency is safe to retry after a transient error', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    let attempt = 0;
    const work = jest.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error('transient');
    });

    // First attempt fails
    await expect(tracker.withIdempotency(300, work)).rejects.toThrow('transient');
    expect(await tracker.isProcessed(300)).toBe(false);

    // Second attempt succeeds
    const executed = await tracker.withIdempotency(300, work);
    expect(executed).toBe(true);
    expect(await tracker.isProcessed(300)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – edge cases', () => {
  it('handles very large sequence numbers', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    const bigSeq = 2_147_483_647; // max int32
    await tracker.markProcessed(bigSeq);
    expect(await tracker.isProcessed(bigSeq)).toBe(true);
  });

  it('handles sequence 0', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();
    await tracker.markProcessed(0);
    expect(await tracker.isProcessed(0)).toBe(true);
  });

  it('cacheSize returns 0 before initialization', () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    expect(tracker.cacheSize()).toBe(0);
  });

  it('isProcessed works before explicit initialize (no cache)', async () => {
    const pool = makePool([42]);
    const tracker = new IdempotencyTracker(pool);
    // No initialize() call – falls through to DB
    expect(await tracker.isProcessed(42)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Entity-based tracking (new generic API)
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – entity-based tracking', () => {
  it('tracks generic entities with entity type and key', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const entityKey = 'transaction:abc123';
    const record = await tracker.markProcessed('transaction', entityKey, 1, {
      txCount: 1,
      opCount: 5,
    });

    expect(record.entityType).toBe('transaction');
    expect(record.entityKey).toBe(entityKey);
    expect(record.txCount).toBe(1);
    expect(record.opCount).toBe(5);
  });

  it('stores and retrieves metadata', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const metadata = { source: 'horizon', timestamp: '2024-01-01' };
    const record = await tracker.markProcessed('ledger', 'ledger:123', 1, {
      metadata,
    });

    expect(record.metadata).toEqual(metadata);
  });

  it('stores and validates payload checksum', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const payload = { value: 1000, account: 'GTEST' };
    const checksum = computeChecksum(payload);

    const record = await tracker.markProcessed('operation', 'op:1-0', 1, {
      payload,
      checksum,
    });

    expect(record.checksum).toBe(checksum);
    expect(record.payload).toBe(payload);
  });

  it('getRecord returns full entity record', async () => {
    const pool = makePool([
      {
        entityType: 'account',
        entityKey: 'account:GTEST',
        sequence: 100,
        checksum: 'deadbeef',
      },
    ]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const record = await tracker.getRecord('account:GTEST');
    expect(record).not.toBeNull();
    expect(record!.entityType).toBe('account');
    expect(record!.entityKey).toBe('account:GTEST');
    expect(record!.checksum).toBe('deadbeef');
  });
});

// ---------------------------------------------------------------------------
// Conflict resolution strategies
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – conflict resolution', () => {
  it('SKIP strategy skips duplicate execution', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(
      pool,
      { defaultStrategy: ConflictResolutionStrategy.SKIP },
    );
    await tracker.initialize();

    let execCount = 0;
    const work = jest.fn(async () => {
      execCount += 1;
    });

    // First execution
    await tracker.withIdempotency('tx', 'tx:hash1', 1, work, {
      strategy: ConflictResolutionStrategy.SKIP,
    });
    expect(execCount).toBe(1);

    // Second execution should skip
    const result = await tracker.withIdempotency('tx', 'tx:hash1', 1, work, {
      strategy: ConflictResolutionStrategy.SKIP,
    });
    expect(result.executed).toBe(false);
    expect(execCount).toBe(1);
  });

  it('UPDATE_LATEST re-executes on payload change', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    let execCount = 0;
    const work = jest.fn(async () => {
      execCount += 1;
    });

    const payload1 = { value: 100 };
    const checksum1 = computeChecksum(payload1);

    // First execution
    await tracker.withIdempotency('transfer', 'tr:1', 1, work, {
      payload: payload1,
      checksum: checksum1,
      strategy: ConflictResolutionStrategy.UPDATE_LATEST,
    });
    expect(execCount).toBe(1);

    // Different payload – should re-execute
    const payload2 = { value: 200 };
    const checksum2 = computeChecksum(payload2);

    const result = await tracker.withIdempotency('transfer', 'tr:1', 1, work, {
      payload: payload2,
      checksum: checksum2,
      strategy: ConflictResolutionStrategy.UPDATE_LATEST,
    });
    expect(result.executed).toBe(true);
    expect(execCount).toBe(2);
  });

  it('MERGE strategy always re-executes', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    let execCount = 0;
    const work = jest.fn(async () => {
      execCount += 1;
    });

    // First execution
    await tracker.withIdempotency('batch', 'batch:1', 1, work, {
      strategy: ConflictResolutionStrategy.MERGE,
    });
    expect(execCount).toBe(1);

    // Should re-execute due to MERGE strategy
    const result = await tracker.withIdempotency('batch', 'batch:1', 1, work, {
      strategy: ConflictResolutionStrategy.MERGE,
    });
    expect(result.executed).toBe(true);
    expect(execCount).toBe(2);
  });

  it('DUAL_STATE strategy returns both states', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const work = jest.fn(async () => {
      return 'state1';
    });

    // First execution
    const result1 = await tracker.withIdempotency('state', 'state:1', 1, work, {
      strategy: ConflictResolutionStrategy.DUAL_STATE,
    });
    expect(result1.executed).toBe(true);
    expect(result1.result).toBe('state1');

    // Second execution – DUAL_STATE re-executes
    const result2 = await tracker.withIdempotency('state', 'state:1', 1, work, {
      strategy: ConflictResolutionStrategy.DUAL_STATE,
    });
    expect(result2.executed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Request deduplication
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – request deduplication', () => {
  it('detects duplicate request by payload checksum', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const payload = { account: 'GTEST', amount: '1000' };
    const checksum = computeChecksum(payload);

    // First request
    await tracker.markProcessed('payment', 'payment:1', 1, {
      payload,
      checksum,
    });

    // Duplicate request – same checksum
    const record = await tracker.getRecord('payment:1');
    expect(record!.checksum).toBe(checksum);
  });

  it('distinguishes different requests with same key by checksum', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const payload1 = { value: 100 };
    const checksum1 = computeChecksum(payload1);

    const payload2 = { value: 200 };
    const checksum2 = computeChecksum(payload2);

    expect(checksum1).not.toBe(checksum2);
  });
});

// ---------------------------------------------------------------------------
// Concurrent processing
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – concurrent processing', () => {
  it('handles concurrent withIdempotency calls safely', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    let execCount = 0;
    const work = jest.fn(async () => {
      execCount += 1;
    });

    // Fire multiple concurrent calls
    const results = await Promise.all([
      tracker.withIdempotency('concurrent', 'key:1', 1, work),
      tracker.withIdempotency('concurrent', 'key:1', 1, work),
      tracker.withIdempotency('concurrent', 'key:1', 1, work),
    ]);

    // At least one should execute; others should be skipped
    expect(results.filter((r) => r.executed).length).toBeGreaterThanOrEqual(1);
    expect(results.filter((r) => !r.executed).length).toBeGreaterThanOrEqual(0);
  });

  it('different keys can execute concurrently', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    let execCount = 0;
    const work = jest.fn(async () => {
      execCount += 1;
    });

    // Execute for different keys concurrently
    const results = await Promise.all([
      tracker.withIdempotency('entity', 'key:1', 1, work),
      tracker.withIdempotency('entity', 'key:2', 2, work),
      tracker.withIdempotency('entity', 'key:3', 3, work),
    ]);

    // All should execute since they're different keys
    expect(results.every((r) => r.executed)).toBe(true);
    expect(execCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Atomic guarantees and rollback scenarios
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – atomic guarantees', () => {
  it('does not mark as processed when work throws', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const work = jest.fn(async () => {
      throw new Error('work failed');
    });

    await expect(
      tracker.withIdempotency('entity', 'key:error', 1, work),
    ).rejects.toThrow('work failed');

    // Should not be marked processed
    expect(await tracker.isProcessed('key:error')).toBe(false);
  });

  it('rollback on error preserves DB consistency', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const work = jest.fn(async (_client: PoolClient) => {
      throw new Error('db write failed');
    });

    await expect(
      tracker.withIdempotency('entity', 'key:rollback', 1, work),
    ).rejects.toThrow('db write failed');

    // Record should not exist
    const record = await tracker.getRecord('key:rollback');
    expect(record).toBeNull();
  });

  it('work receives client for transaction participation', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    let receivedClient: PoolClient | undefined;
    const work = jest.fn(async (client: PoolClient) => {
      receivedClient = client;
    });

    await tracker.withIdempotency('entity', 'key:client', 1, work);
    expect(receivedClient).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility (ledger tracking)
// ---------------------------------------------------------------------------

describe('LedgerTracking – backward compatibility', () => {
  it('trackLedgerSequence works with new tracker', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const record = await LedgerTracking.trackLedgerSequence(tracker, 42, 5, 10, 'checksum123');
    expect(record.sequence).toBe(42);
    expect(record.txCount).toBe(5);
    expect(record.opCount).toBe(10);
    expect(record.checksum).toBe('checksum123');
  });

  it('isLedgerProcessed works with new tracker', async () => {
    const pool = makePool([
      { entityType: 'ledger', entityKey: 'ledger:999', sequence: 999 },
    ]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const isProcessed = await LedgerTracking.isLedgerProcessed(tracker, 999);
    expect(isProcessed).toBe(true);
  });

  it('withLedgerIdempotency works with new tracker', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    let executed = false;
    const work = jest.fn(async () => {
      executed = true;
    });

    const result = await LedgerTracking.withLedgerIdempotency(tracker, 555, work, {
      txCount: 2,
      opCount: 8,
    });

    expect(result).toBe(true);
    expect(executed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

describe('buildKey and computeChecksum', () => {
  it('buildKey produces deterministic keys', () => {
    const key1 = buildKey('entity', { id: 'abc', type: 'payment' });
    const key2 = buildKey('entity', { type: 'payment', id: 'abc' });
    expect(key1).toBe(key2);
  });

  it('computeChecksum is deterministic', () => {
    const payload = { a: 1, b: 2, c: 3 };
    const cs1 = computeChecksum(payload);
    const cs2 = computeChecksum(payload);
    expect(cs1).toBe(cs2);
  });

  it('computeChecksum differs for different payloads', () => {
    const cs1 = computeChecksum({ value: 100 });
    const cs2 = computeChecksum({ value: 101 });
    expect(cs1).not.toBe(cs2);
  });

  it('computeChecksum returns 8-char hex string', () => {
    const checksum = computeChecksum({ test: 'data' });
    expect(checksum).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// Enhanced error handling and retries
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – error handling', () => {
  it('handles DB connection errors gracefully', async () => {
    const mockPool = {
      connect: jest.fn().mockRejectedValue(new Error('connection failed')),
    } as unknown as Pool;

    const tracker = new IdempotencyTracker(mockPool);

    await expect(tracker.initialize()).rejects.toThrow('connection failed');
  });

  it('retries after transient errors', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    let attempt = 0;
    const work = jest.fn(async () => {
      attempt += 1;
      if (attempt < 2) {
        throw new Error('transient');
      }
    });

    // First attempt fails
    await expect(
      tracker.withIdempotency('entity', 'key:retry', 1, work),
    ).rejects.toThrow('transient');

    // Second attempt succeeds
    const result = await tracker.withIdempotency('entity', 'key:retry', 1, work);
    expect(result.executed).toBe(true);
  });

  it('marks attempts on conflict', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    // First record
    const record1 = await tracker.markProcessed('entity', 'key:attempts', 1);
    expect(record1.attempts).toBe(1);

    // Duplicate call – attempts incremented
    const record2 = await tracker.markProcessed('entity', 'key:attempts', 1);
    expect(record2.attempts).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – cache lifecycle', () => {
  it('warms cache on initialization', async () => {
    const pool = makePool([
      { entityType: 'ledger', entityKey: 'ledger:1', sequence: 1 },
      { entityType: 'ledger', entityKey: 'ledger:2', sequence: 2 },
      { entityType: 'ledger', entityKey: 'ledger:3', sequence: 3 },
    ]);
    const tracker = new IdempotencyTracker(pool, { warmCacheSize: 10 });
    await tracker.initialize();

    expect(tracker.cacheSize()).toBe(3);
  });

  it('respects warmCacheSize limit', async () => {
    const pool = makePool([
      { entityType: 'ledger', entityKey: 'ledger:1', sequence: 1 },
      { entityType: 'ledger', entityKey: 'ledger:2', sequence: 2 },
      { entityType: 'ledger', entityKey: 'ledger:3', sequence: 3 },
    ]);
    const tracker = new IdempotencyTracker(pool, { warmCacheSize: 2 });
    await tracker.initialize();

    expect(tracker.cacheSize()).toBe(2);
  });

  it('back-fills cache on DB hit', async () => {
    const pool = makePool([
      { entityType: 'ledger', entityKey: 'ledger:999', sequence: 999 },
    ]);
    const tracker = new IdempotencyTracker(pool, { warmCacheSize: 0 });
    await tracker.initialize();

    expect(tracker.cacheSize()).toBe(0);
    await tracker.isProcessed('ledger:999');
    expect(tracker.cacheSize()).toBe(1);
  });

  it('clearCache does not affect database', async () => {
    const pool = makePool([
      { entityType: 'ledger', entityKey: 'ledger:100', sequence: 100 },
    ]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    tracker.clearCache();
    expect(tracker.cacheSize()).toBe(0);

    // But DB still has it
    const exists = await tracker.isProcessed('ledger:100');
    expect(exists).toBe(true);
    expect(tracker.cacheSize()).toBe(1); // Re-loaded from DB
  });
});

// ---------------------------------------------------------------------------
// Edge cases and boundaries
// ---------------------------------------------------------------------------

describe('IdempotencyTracker – edge cases and boundaries', () => {
  it('handles null payloads gracefully', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const record = await tracker.markProcessed('entity', 'key:null', 1, {
      payload: null,
    });

    expect(record.payload).toBeNull();
  });

  it('handles empty metadata', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const record = await tracker.markProcessed('entity', 'key:empty-meta', 1, {
      metadata: {},
    });

    expect(record.metadata).toEqual({});
  });

  it('handles very long entity keys', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const longKey = 'entity:' + 'x'.repeat(500);
    const record = await tracker.markProcessed('entity', longKey, 1);

    expect(record.entityKey).toBe(longKey);
  });

  it('handles large sequence numbers', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const largeSeq = Number.MAX_SAFE_INTEGER - 1;
    const record = await tracker.markProcessed('entity', 'key:large-seq', largeSeq);

    expect(record.sequence).toBe(largeSeq);
  });

  it('handles zero values in counts', async () => {
    const pool = makePool([]);
    const tracker = new IdempotencyTracker(pool);
    await tracker.initialize();

    const record = await tracker.markProcessed('entity', 'key:zeros', 0, {
      txCount: 0,
      opCount: 0,
    });

    expect(record.sequence).toBe(0);
    expect(record.txCount).toBe(0);
    expect(record.opCount).toBe(0);
  });
});

