import DataLoader from "dataloader";
import { query } from "./db.js";

// --- Row types -------------------------------------------------------------

export interface OperationRow {
  id: string;
  tx_hash: string;
  created_at: string;
  [key: string]: unknown;
}

export interface TransactionRow {
  hash: string;
  ledger_sequence: number;
  created_at: string;
  [key: string]: unknown;
}

// --- Generic batching helper -------------------------------------------------

/**
 * Runs `fetchRows`, then groups the results by `keyOf(row)` and returns
 * one array per input key, preserving input order. Missing keys map to [].
 * Uses a Map to avoid prototype-pollution / collision issues with plain objects.
 */
async function loadGrouped<K, R>(
  keys: readonly K[],
  fetchRows: (keys: readonly K[]) => Promise<{ rows: R[] }>,
  keyOf: (row: R) => K,
  normalize: (key: K) => string | number = (k) => k as unknown as string
): Promise<R[][]> {
  const { rows } = await fetchRows(keys);

  const grouped = new Map<string | number, R[]>();
  for (const key of keys) {
    grouped.set(normalize(key), []);
  }

  for (const row of rows) {
    const k = normalize(keyOf(row));
    const bucket = grouped.get(k);
    if (bucket) {
      bucket.push(row);
    }
    // else: row belongs to a key we didn't ask for — ignore defensively
  }

  return keys.map((key) => grouped.get(normalize(key)) ?? []);
}

// --- Loaders -----------------------------------------------------------------

const BATCH_OPTIONS = {
  maxBatchSize: 1000, // guard against unbounded ANY($1) arrays
};

export const createLoaders = () => {
  return {
    // Fetch operations for multiple transactions
    operationsByTxHash: new DataLoader<string, OperationRow[]>(
      (txHashes) =>
        loadGrouped(
          txHashes,
          (hashes) =>
            query(
              "SELECT * FROM operations WHERE tx_hash = ANY($1) ORDER BY created_at ASC",
              [hashes]
            ),
          (row: OperationRow) => row.tx_hash
        ),
      BATCH_OPTIONS
    ),

    // Fetch transactions for multiple ledgers
    transactionsByLedgerSeq: new DataLoader<number, TransactionRow[]>(
      (sequences) =>
        loadGrouped(
          sequences,
          (seqs) =>
            query(
              "SELECT * FROM transactions WHERE ledger_sequence = ANY($1) ORDER BY created_at ASC",
              [seqs]
            ),
          (row: TransactionRow) => Number(row.ledger_sequence)
        ),
      BATCH_OPTIONS
    ),

    // Fetch operations for multiple ledgers (via tx join)
    operationsByLedgerSeq: new DataLoader<number, OperationRow[]>(
      (sequences) =>
        loadGrouped(
          sequences,
          (seqs) =>
            query(
              `SELECT o.*, t.ledger_sequence
               FROM operations o
               JOIN transactions t ON o.tx_hash = t.hash
               WHERE t.ledger_sequence = ANY($1)
               ORDER BY o.created_at ASC`,
              [seqs]
            ),
          (row: OperationRow & { ledger_sequence: number }) =>
            Number(row.ledger_sequence)
        ),
      BATCH_OPTIONS
    ),
  };
};