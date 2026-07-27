import { Horizon } from '@stellar/stellar-sdk';
import { STELLAR_NETWORKS, type StellarNetwork } from '@stellar-analytics/shared';
import { ingesterLogger } from './logger.js';
import {
  ledgers_processed_total,
  transactions_processed_total,
  operations_processed_total,
  ingestion_duration_seconds,
} from './metrics.js';

export interface IngestedData {
  ledger: Horizon.ServerApi.LedgerRecord;
  transactions: Horizon.ServerApi.TransactionRecord[];
  operations: Horizon.ServerApi.OperationRecord[];
}

export async function pollLatestLedger(network: StellarNetwork): Promise<IngestedData> {
  const end = ingestion_duration_seconds.startTimer();
  const config = STELLAR_NETWORKS[network];
  const server = new Horizon.Server(config.horizonUrl);

  try {
    ingesterLogger.debug({ network }, 'Polling Horizon for latest ledger');

    // 1. Get latest ledger
    const ledgers = await server.ledgers().order('desc').limit(1).call();
    const latestLedger = ledgers.records[0];

    if (!latestLedger) {
      throw new Error('No ledgers found on Horizon');
    }

    // 2. Get transactions for this ledger
    const transactions = await server.transactions().forLedger(latestLedger.sequence).call();

    // 3. Get operations for this ledger (can be many across all txs)
    const operations = await server.operations().forLedger(latestLedger.sequence).call();

    ledgers_processed_total.inc();
    transactions_processed_total.inc(transactions.records.length);
    operations_processed_total.inc(operations.records.length);

    ingesterLogger.debug(
      {
        network,
        sequence: latestLedger.sequence,
        txCount: transactions.records.length,
        opCount: operations.records.length,
      },
      'Polled latest ledger'
    );

    return {
      ledger: latestLedger,
      transactions: transactions.records,
      operations: operations.records,
    };
  } catch (error: any) {
    ingesterLogger.error(
      { network, error: error?.message ?? String(error) },
      'Failed to poll Horizon'
    );
    throw error;
  } finally {
    end();
  }
}

/**
 * Backfill helper: Fetch a specific ledger by sequence number.
 * Used by the backfill module to fetch individual ledgers in parallel.
 */
export async function fetchLedger(
  network: StellarNetwork,
  sequence: number
): Promise<IngestedData> {
  const config = STELLAR_NETWORKS[network];
  const server = new Horizon.Server(config.horizonUrl);

  const ledgerResp = await (server.ledgers().ledger(sequence) as any).call();
  const ledger: Horizon.ServerApi.LedgerRecord = ledgerResp.records
    ? ledgerResp.records[0]
    : ledgerResp;

  const [txResp, opResp] = await Promise.all([
    server.transactions().forLedger(sequence).limit(200).call(),
    server.operations().forLedger(sequence).limit(200).call(),
  ]);

  return {
    ledger,
    transactions: txResp.records,
    operations: opResp.records,
  };
}

/**
 * Backfill helper: Fetch a range of ledgers sequentially.
 * For parallel fetching, use the backfill module's `runBackfill` instead.
 */
export async function fetchLedgerRange(
  network: StellarNetwork,
  start: number,
  end: number
): Promise<IngestedData[]> {
  const results: IngestedData[] = [];
  for (let seq = start; seq <= end; seq++) {
    results.push(await fetchLedger(network, seq));
  }
  return results;
}
