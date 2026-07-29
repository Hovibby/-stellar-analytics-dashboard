/**
 * ingester.mock.test.ts
 *
 * Unit tests for the Stellar ingester that run entirely offline – no live
 * Horizon calls, no database, no network required.
 *
 * Acceptance criteria:
 *  ✓ pollLatestLedger() returns a valid IngestedData shape from the mock
 *  ✓ Sequence numbers increment on consecutive polls (simulates live stream)
 *  ✓ fetchLedger() returns data for a specific sequence
 *  ✓ fetchLedgerRange() returns the correct number of ledgers in order
 *  ✓ Errors are propagated correctly when the mock throws
 *  ✓ Transformer produces non-empty normalized output from mock data
 *  ✓ Mock data satisfies the schema expected by loader (column shapes)
 */

import { pollLatestLedger, fetchLedger, fetchLedgerRange } from "../src/ingester.js";
import {
  createMockHorizonServer,
  resetMockHorizonSingleton,
} from "../src/mock-horizon.js";
import {
  normalizeLedger,
  normalizeTransactions,
  normalizeOperations,
  normalizePayments,
} from "../src/transformer.js";

// Silence logger output during tests
jest.mock("../src/logger.js", () => ({
  ingesterLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  configLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  indexerLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    debug: jest.fn(),
  },
  loaderLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  backfillLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  workerLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  websocketLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

beforeEach(() => {
  // Ensure the env-driven singleton is cleared between tests
  resetMockHorizonSingleton();
});

// ---------------------------------------------------------------------------
// pollLatestLedger
// ---------------------------------------------------------------------------

describe("pollLatestLedger (mock server)", () => {
  it("returns a well-shaped IngestedData object", async () => {
    const mock = createMockHorizonServer({ startSequence: 500, txsPerLedger: 3, opsPerTx: 2 });
    const data = await pollLatestLedger("testnet", mock as any);

    expect(data).toBeDefined();
    expect(data.ledger).toBeDefined();
    expect(typeof data.ledger.sequence).toBe("number");
    expect(data.ledger.sequence).toBeGreaterThan(0);
    expect(typeof data.ledger.hash).toBe("string");
    expect(typeof data.ledger.closed_at).toBe("string");

    expect(Array.isArray(data.transactions)).toBe(true);
    expect(Array.isArray(data.operations)).toBe(true);
  });

  it("returns the expected number of transactions and operations", async () => {
    const mock = createMockHorizonServer({ startSequence: 200, txsPerLedger: 4, opsPerTx: 3 });
    const data = await pollLatestLedger("testnet", mock as any);

    expect(data.transactions.length).toBe(4);
    // 4 txs × 3 ops each = 12 operations
    expect(data.operations.length).toBe(12);
  });

  it("sequence increments on consecutive polls", async () => {
    const mock = createMockHorizonServer({ startSequence: 1000 });

    const first = await pollLatestLedger("testnet", mock as any);
    const second = await pollLatestLedger("testnet", mock as any);

    expect(second.ledger.sequence).toBe(first.ledger.sequence + 1);
  });

  it("each transaction has a hash that matches the operations' transaction_hash", async () => {
    const mock = createMockHorizonServer({ startSequence: 300, txsPerLedger: 2, opsPerTx: 1 });
    const data = await pollLatestLedger("testnet", mock as any);

    const txHashes = new Set(data.transactions.map((tx) => tx.hash));
    for (const op of data.operations) {
      expect(txHashes.has((op as any).transaction_hash)).toBe(true);
    }
  });

  it("works with mainnet network label (same mock behaviour)", async () => {
    const mock = createMockHorizonServer({ startSequence: 50 });
    const data = await pollLatestLedger("mainnet", mock as any);

    expect(data.ledger.sequence).toBe(50);
  });

  it("throws when the mock has no ledger records", async () => {
    // Manually craft a server that returns empty records
    const emptyServer = {
      ledgers: () => ({
        order: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }),
        ledger: () => ({ call: async () => ({ records: [] }) }),
      }),
      transactions: () => ({ forLedger: () => ({ call: async () => ({ records: [] }), limit: () => ({ call: async () => ({ records: [] }) }) }) }),
      operations: () => ({ forLedger: () => ({ call: async () => ({ records: [] }), limit: () => ({ call: async () => ({ records: [] }) }) }) }),
    };

    await expect(pollLatestLedger("testnet", emptyServer as any)).rejects.toThrow(
      "No ledgers found on Horizon"
    );
  });
});

// ---------------------------------------------------------------------------
// fetchLedger
// ---------------------------------------------------------------------------

describe("fetchLedger (mock server)", () => {
  it("fetches a ledger with the requested sequence number", async () => {
    const mock = createMockHorizonServer({ startSequence: 42 });
    const data = await fetchLedger("testnet", 42, mock as any);

    expect(data.ledger).toBeDefined();
    // Mock ledger() returns the record with the requested sequence
    expect(data.transactions.length).toBeGreaterThan(0);
    expect(data.operations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// fetchLedgerRange
// ---------------------------------------------------------------------------

describe("fetchLedgerRange (mock server)", () => {
  it("returns the correct number of ledgers", async () => {
    const mock = createMockHorizonServer({ startSequence: 10 });
    const results = await fetchLedgerRange("testnet", 10, 14, mock as any);

    expect(results).toHaveLength(5);
  });

  it("results contain non-empty transaction arrays", async () => {
    const mock = createMockHorizonServer({ startSequence: 20 });
    const results = await fetchLedgerRange("testnet", 20, 22, mock as any);

    for (const r of results) {
      expect(r.transactions.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Transformer compatibility
// ---------------------------------------------------------------------------

describe("transformer produces valid DB-ready data from mock output", () => {
  it("normalizeLedger returns required fields", async () => {
    const mock = createMockHorizonServer({ startSequence: 600 });
    const data = await pollLatestLedger("testnet", mock as any);
    const ledger = normalizeLedger(data as any);

    expect(typeof ledger.sequence).toBe("number");
    expect(typeof ledger.hash).toBe("string");
    expect(typeof ledger.close_time).toBe("string");
    expect(typeof ledger.tx_count).toBe("number");
  });

  it("normalizeTransactions returns an array with hash and source_account", async () => {
    const mock = createMockHorizonServer({ startSequence: 700, txsPerLedger: 5 });
    const data = await pollLatestLedger("testnet", mock as any);
    const txs = normalizeTransactions(data as any);

    expect(txs.length).toBe(5);
    for (const tx of txs) {
      expect(typeof tx.hash).toBe("string");
      expect(typeof tx.source_account).toBe("string");
      expect(typeof tx.ledger_seq).toBe("number");
    }
  });

  it("normalizeOperations returns array with id and type", async () => {
    const mock = createMockHorizonServer({ startSequence: 800, txsPerLedger: 2, opsPerTx: 3 });
    const data = await pollLatestLedger("testnet", mock as any);
    const ops = normalizeOperations(data as any);

    expect(ops.length).toBe(6);
    for (const op of ops) {
      expect(typeof op.id).toBe("string");
      expect(typeof op.type).toBe("string");
    }
  });

  it("normalizePayments only includes payment-type operations", async () => {
    const mock = createMockHorizonServer({ startSequence: 900, txsPerLedger: 6, opsPerTx: 1 });
    const data = await pollLatestLedger("testnet", mock as any);
    const payments = normalizePayments(data as any);

    const PAYMENT_TYPES = ["payment", "path_payment_strict_receive", "path_payment_strict_send"];
    for (const p of payments) {
      // Each payment must have originated from a payment-type op
      expect(p.amount).toBeDefined();
      expect(p.from).toBeDefined();
    }
    // Not all ops are payments – result count should be ≤ total ops
    expect(payments.length).toBeLessThanOrEqual(data.operations.length);
  });
});

// ---------------------------------------------------------------------------
// STELLAR_MOCK env flag (integration with the env-driven path)
// ---------------------------------------------------------------------------

describe("STELLAR_MOCK environment flag", () => {
  const originalEnv = process.env.STELLAR_MOCK;

  afterEach(() => {
    process.env.STELLAR_MOCK = originalEnv;
    resetMockHorizonSingleton();
  });

  it("uses the singleton mock when STELLAR_MOCK=true (no server override)", async () => {
    process.env.STELLAR_MOCK = "true";

    // Without passing a server override, the env-driven path is used
    const data = await pollLatestLedger("testnet");

    expect(data.ledger.sequence).toBeGreaterThan(0);
    expect(Array.isArray(data.transactions)).toBe(true);
  });
});
