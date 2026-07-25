/**
 * mock-horizon.ts
 *
 * A self-contained, deterministic mock of the Horizon API surface used by
 * the ingester.  It produces realistic-looking ledger, transaction, and
 * operation records without making any network calls.
 *
 * Usage (env-driven):
 *   STELLAR_MOCK=true  tsx src/index.ts
 *
 * Usage (programmatic – for unit tests):
 *   import { createMockHorizonServer } from './mock-horizon.js';
 *   const server = createMockHorizonServer({ startSequence: 100 });
 */

// ---------------------------------------------------------------------------
// Minimal subset of the Horizon SDK types that ingester.ts actually touches
// ---------------------------------------------------------------------------

export interface MockLedgerRecord {
  sequence: number;
  hash: string;
  closed_at: string;
  successful_transaction_count: number;
  failed_transaction_count: number;
  operation_count: number;
  tx_set_operation_count: number;
  total_coins: string;
  fee_pool: string;
  base_fee_in_stroops: number;
  base_reserve_in_stroops: number;
  max_tx_set_size: number;
  protocol_version: number;
  header_xdr: string;
}

export interface MockTransactionRecord {
  id: string;
  paging_token: string;
  successful: boolean;
  hash: string;
  /** The ledger sequence number */
  ledger: number;
  created_at: string;
  source_account: string;
  source_account_sequence: string;
  fee_account: string;
  fee_charged: string;
  max_fee: string;
  operation_count: number;
  envelope_xdr: string;
  result_xdr: string;
  result_meta_xdr: string;
  fee_meta_xdr: string;
  memo_type: string;
  signatures: string[];
  transaction_hash: string;
}

export interface MockOperationRecord {
  id: string;
  paging_token: string;
  transaction_hash: string;
  transaction_successful: boolean;
  type: string;
  created_at: string;
  source_account: string;
  /** payment-specific */
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

// ---------------------------------------------------------------------------
// Deterministic data generators
// ---------------------------------------------------------------------------

/** Pad a number to a fixed hex width */
function hexPad(n: number, width = 64): string {
  return n.toString(16).padStart(width, "0");
}

/** Pseudo-random Stellar account-ID (not a real key-pair) */
function mockAccountId(seed: number): string {
  return `GAAA${seed.toString().padStart(52, "0")}`;
}

function mockLedger(sequence: number): MockLedgerRecord {
  const closedAt = new Date(Date.now() - (1000 - sequence % 1000) * 5_000);
  return {
    sequence,
    hash: hexPad(sequence),
    closed_at: closedAt.toISOString(),
    successful_transaction_count: 3 + (sequence % 5),
    failed_transaction_count: sequence % 2,
    operation_count: 6 + (sequence % 10),
    tx_set_operation_count: 6 + (sequence % 10),
    total_coins: "100000000000.0000000",
    fee_pool: "1234.5678900",
    base_fee_in_stroops: 100,
    base_reserve_in_stroops: 5_000_000,
    max_tx_set_size: 500,
    protocol_version: 20,
    header_xdr: `MOCK_LEDGER_XDR_${sequence}`,
  };
}

function mockTransactions(
  ledgerSequence: number,
  count: number
): MockTransactionRecord[] {
  return Array.from({ length: count }, (_, i) => {
    const hash = hexPad(ledgerSequence * 1000 + i);
    const created = new Date(Date.now() - (count - i) * 1_000).toISOString();
    return {
      id: hash,
      paging_token: `${ledgerSequence}-${i}`,
      successful: i % 7 !== 0, // ~85% success rate
      hash,
      ledger: ledgerSequence,
      created_at: created,
      source_account: mockAccountId(i + 1),
      source_account_sequence: String(ledgerSequence * 10 + i),
      fee_account: mockAccountId(i + 1),
      fee_charged: String(100 * (1 + (i % 3))),
      max_fee: "10000",
      operation_count: 1 + (i % 3),
      envelope_xdr: `MOCK_TX_ENVELOPE_XDR_${hash}`,
      result_xdr: "AAAAAAAAAGQ=",
      result_meta_xdr: "MOCK_META",
      fee_meta_xdr: "MOCK_FEE_META",
      memo_type: "none",
      signatures: [],
      transaction_hash: hash,
    };
  });
}

const OP_TYPES = [
  "payment",
  "create_account",
  "path_payment_strict_receive",
  "manage_sell_offer",
  "change_trust",
  "account_merge",
];

function mockOperations(
  ledgerSequence: number,
  txHashes: string[],
  opsPerTx: number
): MockOperationRecord[] {
  const ops: MockOperationRecord[] = [];
  txHashes.forEach((txHash, ti) => {
    for (let oi = 0; oi < opsPerTx; oi++) {
      const type = OP_TYPES[(ti + oi) % OP_TYPES.length];
      const created = new Date(Date.now() - oi * 200).toISOString();
      const op: MockOperationRecord = {
        id: `${ledgerSequence}-${ti}-${oi}`,
        paging_token: `${ledgerSequence}-${ti}-${oi}`,
        transaction_hash: txHash,
        transaction_successful: true,
        type,
        created_at: created,
        source_account: mockAccountId(ti + oi + 10),
      };
      if (type === "payment" || type === "path_payment_strict_receive") {
        op.from = mockAccountId(ti + 1);
        op.to = mockAccountId(ti + 2);
        op.amount = String((100 + ti * 10 + oi).toFixed(7));
        op.asset_type = "native";
        op.asset_code = "XLM";
      }
      ops.push(op);
    }
  });
  return ops;
}

// ---------------------------------------------------------------------------
// Mock server factory
// ---------------------------------------------------------------------------

export interface MockHorizonOptions {
  /**
   * Starting ledger sequence.  Each call to the mock's `ledgers()` chain
   * increments this by 1, simulating real-time ledger closing.
   * @default 100
   */
  startSequence?: number;
  /**
   * Number of transactions to generate per ledger.
   * @default 3
   */
  txsPerLedger?: number;
  /**
   * Number of operations to generate per transaction.
   * @default 2
   */
  opsPerTx?: number;
}

/**
 * Creates a mock object that mimics the `Horizon.Server` interface used by
 * `ingester.ts`.  Only the methods actually called by the ingester are
 * implemented; everything else is a no-op stub.
 *
 * The mock is stateful: each call to `.ledgers().order('desc').limit(1).call()`
 * advances the internal sequence counter so it behaves like a live stream.
 */
export function createMockHorizonServer(options: MockHorizonOptions = {}) {
  let currentSequence = options.startSequence ?? 100;
  const txsPerLedger = options.txsPerLedger ?? 3;
  const opsPerTx = options.opsPerTx ?? 2;

  /** Returns the latest generated sequence (useful in assertions) */
  const getLastSequence = () => currentSequence;
  const resetSequence = (seq: number) => { currentSequence = seq; };

  // ── Chain builders ──────────────────────────────────────────────────────

  function makeLedgersChain(sequence: number) {
    const ledger = mockLedger(sequence);
    return {
      order: () => ({
        limit: () => ({
          call: async () => ({ records: [ledger] }),
        }),
      }),
      ledger: (seq: number) => ({
        call: async () => {
          const l = mockLedger(seq);
          return { records: [l] };
        },
      }),
    };
  }

  function makeTxsChain(sequence: number) {
    const txs = mockTransactions(sequence, txsPerLedger);
    return {
      forLedger: () => ({
        limit: () => ({
          call: async () => ({ records: txs }),
        }),
        call: async () => ({ records: txs }),
      }),
    };
  }

  function makeOpsChain(sequence: number) {
    const txs = mockTransactions(sequence, txsPerLedger);
    const txHashes = txs.map((t) => t.hash);
    const ops = mockOperations(sequence, txHashes, opsPerTx);
    return {
      forLedger: () => ({
        limit: () => ({
          call: async () => ({ records: ops }),
        }),
        call: async () => ({ records: ops }),
      }),
    };
  }

  // ── Public server interface ─────────────────────────────────────────────

  return {
    /** Advance state – call before each ingestion cycle in tests */
    __advance: () => { currentSequence += 1; },
    __getLastSequence: getLastSequence,
    __resetSequence: resetSequence,
    __generateLedger: (seq?: number) => mockLedger(seq ?? currentSequence),
    __generateTransactions: (seq?: number) =>
      mockTransactions(seq ?? currentSequence, txsPerLedger),

    ledgers() {
      const seq = currentSequence;
      currentSequence += 1; // advance on each poll, like real Horizon
      return makeLedgersChain(seq);
    },

    transactions() {
      return makeTxsChain(currentSequence - 1);
    },

    operations() {
      return makeOpsChain(currentSequence - 1);
    },
  };
}

export type MockHorizonServer = ReturnType<typeof createMockHorizonServer>;

// ---------------------------------------------------------------------------
// Environment-driven singleton  (used by the indexer when STELLAR_MOCK=true)
// ---------------------------------------------------------------------------

let _singleton: MockHorizonServer | null = null;

export function getMockHorizonServer(options?: MockHorizonOptions): MockHorizonServer {
  if (!_singleton) {
    _singleton = createMockHorizonServer(options);
  }
  return _singleton;
}

export function resetMockHorizonSingleton(): void {
  _singleton = null;
}
