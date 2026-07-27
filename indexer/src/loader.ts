import { Pool, PoolClient } from "pg";
import { Readable } from "stream";
import { loaderLogger } from "./logger.js";

// Batch size for bulk inserts (issue #40)
const BATCH_SIZE = 100;

/**
 * Split an array into chunks of at most `size` elements.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Build a multi-row VALUES clause for a parameterised INSERT.
 *
 * @param rows       Array of row value arrays
 * @param colCount   Number of columns per row
 * @param startIndex Starting $N index (default 1)
 * @returns { text, params }
 */
function buildBulkValues(
  rows: any[][],
  colCount: number,
  startIndex = 1
): { text: string; params: any[] } {
  const params: any[] = [];
  const placeholders: string[] = [];
  let idx = startIndex;

  for (const row of rows) {
    const rowPlaceholders: string[] = [];
    for (const val of row) {
      rowPlaceholders.push(`$${idx++}`);
      params.push(val);
    }
    placeholders.push(`(${rowPlaceholders.join(", ")})`);
  }

  return { text: placeholders.join(", "), params };
}

/**
 * Bulk-insert transactions in batches of BATCH_SIZE.
 * Uses multi-row INSERT … VALUES (…),(…) for efficiency.
 */
async function bulkInsertTransactions(
  client: PoolClient,
  transactions: any[]
): Promise<void> {
  if (transactions.length === 0) return;

  const batches = chunk(transactions, BATCH_SIZE);
  for (const batch of batches) {
    const rows = batch.map((tx) => [
      tx.hash,
      tx.ledger_seq,
      tx.source_account,
      tx.fee_charged,
    ]);
    const { text, params } = buildBulkValues(rows, 4);
    await client.query(
      `INSERT INTO transactions (hash, ledger_sequence, source_account, fee_charged)
       VALUES ${text}
       ON CONFLICT (hash) DO NOTHING`,
      params
    );
    console.log(
      `[loader] inserted batch of ${batch.length} transactions`
    );
  }
}

/**
 * Bulk-insert operations in batches of BATCH_SIZE.
 */
async function bulkInsertOperations(
  client: PoolClient,
  operations: any[]
): Promise<void> {
  if (operations.length === 0) return;

  const batches = chunk(operations, BATCH_SIZE);
  for (const batch of batches) {
    const rows = batch.map((op) => [
      op.id,
      op.tx_hash,
      op.type,
      op.source_account,
      op.created_at,
    ]);
    const { text, params } = buildBulkValues(rows, 5);
    await client.query(
      `INSERT INTO operations (id, tx_hash, type, source_account, created_at)
       VALUES ${text}
       ON CONFLICT (id) DO NOTHING`,
      params
    );
    console.log(
      `[loader] inserted batch of ${batch.length} operations`
    );
  }
}

/**
 * Bulk-insert payments in batches of BATCH_SIZE.
 */
async function bulkInsertPayments(
  client: PoolClient,
  payments: any[]
): Promise<void> {
  if (payments.length === 0) return;

  const batches = chunk(payments, BATCH_SIZE);
  for (const batch of batches) {
    const rows = batch.map((p) => [p.id, p.from, p.to, p.amount, p.asset]);
    const { text, params } = buildBulkValues(rows, 5);
    await client.query(
      `INSERT INTO payments (id, "from", "to", amount, asset)
       VALUES ${text}
       ON CONFLICT (id) DO NOTHING`,
      params
    );
    console.log(
      `[loader] inserted batch of ${batch.length} payments`
    );
  }
}

export interface BatchMetrics {
  transactionBatches: number;
  operationBatches: number;
  paymentBatches: number;
  totalTransactions: number;
  totalOperations: number;
  totalPayments: number;
  durationMs: number;
}

export async function writeIngestedData(
  pool: Pool | null,
  data: any
): Promise<BatchMetrics> {
  const metrics: BatchMetrics = {
    transactionBatches: Math.ceil(data.transactions.length / BATCH_SIZE),
    operationBatches: Math.ceil(data.operations.length / BATCH_SIZE),
    paymentBatches: Math.ceil(data.payments.length / BATCH_SIZE),
    totalTransactions: data.transactions.length,
    totalOperations: data.operations.length,
    totalPayments: data.payments.length,
    durationMs: 0,
  };

  if (!pool) {
    console.warn("[loader] database pool not configured, skipping write");
    return metrics;
  }

  const start = Date.now();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Write ledger (single row — always one per cycle)
    const ledger = data.ledger;
    await client.query(
      `INSERT INTO ledgers (sequence, hash, closed_at, tx_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sequence) DO NOTHING`,
      [ledger.sequence, ledger.hash, ledger.close_time, ledger.tx_count]
    );

    // 2. Bulk-insert transactions
    await bulkInsertTransactions(client, data.transactions);

    // 3. Bulk-insert operations
    await bulkInsertOperations(client, data.operations);

    // 4. Bulk-insert payments
    await bulkInsertPayments(client, data.payments);

    await client.query("COMMIT");

    metrics.durationMs = Date.now() - start;
    console.log(
      `[loader] committed ledger ${ledger.sequence}: ` +
        `${metrics.totalTransactions} txs, ` +
        `${metrics.totalOperations} ops, ` +
        `${metrics.totalPayments} payments in ${metrics.durationMs}ms`
    );
  } catch (error) {
    await client.query("ROLLBACK");
    loaderLogger.error(
      { error: (error as Error)?.message ?? String(error), ledgerSequence: data?.ledger?.sequence },
      "Failed to write to database"
    );
    throw error;
  } finally {
    client.release();
  }

  return metrics;
}
