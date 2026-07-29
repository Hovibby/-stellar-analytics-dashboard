/**
 * IndexerService – orchestrates ledger polling, validation, circuit breaking,
 * metrics collection, and idempotent writes.
 *
 * Issues addressed:
 *   #29 – Database connection pool monitoring
 *   #34 – WebSocket reconnection with exponential backoff
 *   #37 – Rate limiting for Horizon API
 *   #39 – Data validation via Zod schemas before any DB write
 *   #41 – Circuit breaker wrapping all Horizon API calls (in StellarService)
 *   #43 – Prometheus metrics for every significant operation
 *   #44 – Idempotency: skip already-processed ledgers
 *   #36 – Dead letter queue for failed ledger recovery
 */

import { Horizon } from '@stellar/stellar-sdk';
import { StellarService } from './stellar-service';
import { db } from '../database/connection';
import {
  INDEXER,
  PAYMENT_OPERATIONS,
  DEX_OPERATIONS,
  getCachedIndexerConfig,
} from '@stellar-analytics/shared';
import { CircuitOpenError } from '../circuit-breaker/CircuitBreaker';
import { metrics } from '../metrics/IndexerMetrics';
import { IdempotencyTracker } from '../idempotency/IdempotencyTracker';
import { RateLimiter } from '../rate-limiter/RateLimiter';
import {
  HorizonLedgerSchema,
  HorizonTransactionSchema,
  HorizonOperationSchema,
  validateRecord,
  validateRecords,
} from '../validation/schemas';
import { dlq } from '../error-recovery/DeadLetterQueue';
import {
  TransactionTracking,
  TX_IDEMPOTENCY_PREFIX,
} from '../idempotency/IdempotencyTracker';
import { BackfillCheckpointManager } from '../backfill/BackfillCheckpointManager';
import { GapDetector, type GapDetectionReport, type GapRecoveryResult } from '../backfill/GapDetectionService';
import { IngestionProgressTracker, type ProgressSnapshot, type ProgressHistoryEntry } from '../backfill/IngestionProgressTracker';

export interface IndexerServiceOptions {
  /**
   * Number of ledgers to fetch per backfill batch.
   * Defaults to INDEXER.BACKFILL_BATCH_SIZE (1000), overridable via
   * the BACKFILL_BATCH_SIZE env var.
   */
  backfillBatchSize?: number;

  /**
   * Number of ledgers to process per batch during real-time ingestion.
   * Defaults to INDEXER.BATCH_SIZE (100), overridable via
   * the LEDGER_BATCH_SIZE env var.
   */
  ledgerBatchSize?: number;

  /**
   * Number of transactions to batch per DB insert.
   * Default 50.
   */
  transactionBatchSize?: number;

  /**
   * Number of operations to batch per DB insert.
   * Default 100.
   */
  operationBatchSize?: number;
}

export class IndexerService {
  private stellarService: StellarService;
  private isRunning: boolean = false;
  private lastProcessedLedger: number = 0;
  private lastLedgerProcessedAt: number | null = null;
  private websocketReconnectAttempts: number = 0;

  private readonly idempotency: IdempotencyTracker;
  private readonly rateLimiter: RateLimiter;
  private checkpointManager: BackfillCheckpointManager | null = null;
  readonly progressTracker: IngestionProgressTracker = new IngestionProgressTracker();

  /** Configured batch sizes */
  readonly backfillBatchSize: number;
  readonly ledgerBatchSize: number;
  readonly transactionBatchSize: number;
  readonly operationBatchSize: number;

  constructor(
    stellarService: StellarService,
    options: IndexerServiceOptions = {},
  ) {
    this.stellarService = stellarService;

    // Resolve batch sizes: explicit options > env vars > defaults
    const cfg = getCachedIndexerConfig();
    this.backfillBatchSize = options.backfillBatchSize ?? cfg.backfillBatchSize;
    this.ledgerBatchSize = options.ledgerBatchSize ?? cfg.ledgerBatchSize;
    this.transactionBatchSize =
      options.transactionBatchSize ?? cfg.transactionBatchSize;
    this.operationBatchSize =
      options.operationBatchSize ?? cfg.operationBatchSize;

    // Issue #37 – Rate limiter for Horizon API: 2000 requests per minute
    this.rateLimiter = new RateLimiter({
      maxRequestsPerWindow: 2000,
      windowMs: 60 * 1000, // 1 minute
      horizonName: 'HorizonAPI',
    });

    this.idempotency = new IdempotencyTracker(db.getPool());
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Indexer is already running');
      return;
    }

    console.log('Starting Stellar indexer...');
    this.isRunning = true;

    try {
      // Initialise idempotency table + warm cache
      await this.idempotency.initialize();

      await this.initializeLastProcessedLedger();
      await this.startRealtimeStreaming();
      await this.startBackfill();
    } catch (error) {
      console.error('Error starting indexer:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    console.log('Stopping Stellar indexer...');
    this.isRunning = false;
  }

  // ---------------------------------------------------------------------------
  // Initialisation helpers
  // ---------------------------------------------------------------------------

  private async initializeLastProcessedLedger(): Promise<void> {
    // Prefer the backfill checkpoint as the source of truth (most recent resume point)
    const ckpt = new BackfillCheckpointManager({
      pool: db.getPool(),
      jobId: 'indexer-realtime',
      network: 'public',
      startSequence: 1,
      endSequence: Number.MAX_SAFE_INTEGER,
    });
    await ckpt.ensureTable();
    const resumable = await ckpt.findResumableJob();

    if (resumable?.lastProcessedSequence) {
      this.lastProcessedLedger = resumable.lastProcessedSequence;
      console.log(
        `[indexer] resuming from backfill checkpoint at ledger ${this.lastProcessedLedger}`,
      );
      metrics.lastProcessedLedger.set(this.lastProcessedLedger);
      return;
    }

    // Fall back to the idempotency table
    const lastIdempotent = await this.idempotency.getLastProcessedSequence();

    if (lastIdempotent !== null) {
      this.lastProcessedLedger = lastIdempotent;
      console.log(`[indexer] resuming from idempotency table at ledger ${this.lastProcessedLedger}`);
      metrics.lastProcessedLedger.set(this.lastProcessedLedger);
      return;
    }

    // Fall back to the ledgers table
    const latestLedger = await db.queryOne<{ sequence: number }>(
      'SELECT sequence FROM ledgers ORDER BY sequence DESC LIMIT 1',
    );

    if (latestLedger) {
      this.lastProcessedLedger = latestLedger.sequence;
      console.log(`[indexer] resuming from ledgers table at ledger ${this.lastProcessedLedger}`);
    } else {
      // Issue #37 – Apply rate limiter to Horizon API calls
      await this.rateLimiter.consume();
      const horizonLatest = await this.stellarService.getLatestLedger();
      this.lastProcessedLedger = horizonLatest.sequence - 1;
      console.log(`[indexer] starting fresh from ledger ${this.lastProcessedLedger}`);
    }

    metrics.lastProcessedLedger.set(this.lastProcessedLedger);
  }

// ---------------------------------------------------------------------------
  // Streaming
  // ---------------------------------------------------------------------------

  // Issue #34 – WebSocket reconnection with exponential backoff
  private async startRealtimeStreaming(): Promise<void> {
    console.log('[indexer] starting real-time ledger streaming...');

    this.stellarService.streamLedgers(
      async (ledger) => {
        if (ledger.sequence > this.lastProcessedLedger) {
          await this.processLedger(ledger);
          this.lastProcessedLedger = ledger.sequence;
          metrics.lastProcessedLedger.set(this.lastProcessedLedger);
        }
        // Reset reconnect attempts on successful connection
        this.websocketReconnectAttempts = 0;
      },
      (error) => {
        console.error('[indexer] ledger stream error:', error);
        metrics.errorsTotal.inc({ type: 'stream' });

        // Increment reconnect attempts
        this.websocketReconnectAttempts++;

        // Issue #34 – Check if we've exceeded max reconnect attempts
        if (this.websocketReconnectAttempts > INDEXER.WEBSOCKET_MAX_RECONNECT_ATTEMPTS) {
          console.error(`[indexer] max WebSocket reconnection attempts (${INDEXER.WEBSOCKET_MAX_RECONNECT_ATTEMPTS}) exceeded`);
          return;
        }

        // Issue #34 – Calculate delay with exponential backoff: min(1000 * 2^attempt, 30000)
        const delay = Math.min(1000 * 2 ** this.websocketReconnectAttempts, 30_000);
        console.log(`[indexer] scheduling WebSocket reconnection attempt ${this.websocketReconnectAttempts} in ${delay}ms`);
        metrics.websocketReconnections.inc();

        setTimeout(() => {
          if (this.isRunning) this.startRealtimeStreaming();
        }, delay);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Backfill
  // ---------------------------------------------------------------------------

  private async startBackfill(): Promise<void> {
    console.log('[indexer] starting historical data backfill...');

    let horizonLatest: Horizon.ServerApi.LedgerRecord;
    try {
      // Issue #37 – Apply rate limiter to Horizon API calls
      await this.rateLimiter.consume();
      horizonLatest = await this.stellarService.getLatestLedger();
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        console.warn('[indexer] circuit open – skipping backfill');
        return;
      }
      metrics.horizonRequestErrorsTotal.inc({ endpoint: 'latest_ledger' });
      throw err;
    }

    if (this.lastProcessedLedger < horizonLatest.sequence - 10) {
      await this.backfillLedgers(this.lastProcessedLedger + 1, horizonLatest.sequence - 10);
    }
  }

  /**
   * Public API: backfill from a specific ledger sequence.
   * If `endSequence` is omitted, backfill up to `latestLedger.sequence - 10`.
   */
  async backfillFromSequence(startSequence: number, endSequence?: number): Promise<void> {
    console.log(`[indexer] manual backfill requested from ${startSequence}${endSequence ? ` to ${endSequence}` : ''}`);

    if (!Number.isInteger(startSequence) || startSequence <= 0) {
      throw new Error('startSequence must be a positive integer');
    }

    let horizonLatest: Horizon.ServerApi.LedgerRecord;
    try {
      // Apply rate limiter when querying Horizon
      await this.rateLimiter.consume();
      horizonLatest = await this.stellarService.getLatestLedger();
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        console.warn('[indexer] circuit open – cannot perform manual backfill');
        return;
      }
      throw err;
    }

    const resolvedEnd = endSequence && Number.isInteger(endSequence) && endSequence > 0
      ? endSequence
      : Math.max(horizonLatest.sequence - 10, startSequence);

    if (startSequence > resolvedEnd) {
      console.log(`[indexer] startSequence ${startSequence} is after end ${resolvedEnd}; nothing to backfill`);
      return;
    }

    // ── Checkpoint-resumable backfill ───────────────────────────────────────
    // Before starting, check if there's an existing checkpoint for this range
    const jobId = `backfill:${startSequence}-${resolvedEnd}`;
    const ckpt = new BackfillCheckpointManager({
      pool: db.getPool(),
      jobId,
      network: 'public',
      startSequence,
      endSequence: resolvedEnd,
    });
    await ckpt.ensureTable();

    const existingJob = await ckpt.loadJob();
    let effectiveStart = startSequence;

    if (
      existingJob &&
      existingJob.status === 'in_progress' &&
      existingJob.lastProcessedSequence
    ) {
      effectiveStart = existingJob.lastProcessedSequence + 1;
      console.log(
        `[indexer] found resumable backfill – resuming from ledger ${effectiveStart}`,
      );
    }

    await this.backfillLedgers(effectiveStart, resolvedEnd);
  }

  private async backfillLedgers(startSequence: number, endSequence: number): Promise<void> {
    console.log(`[indexer] backfilling ledgers ${startSequence} → ${endSequence}`);
    console.log(`[indexer] batch size: ${this.backfillBatchSize} ledgers per batch`);

    // ── Checkpoint setup ────────────────────────────────────────────────────
    const jobId = `backfill:${startSequence}-${endSequence}`;
    const ckpt = new BackfillCheckpointManager({
      pool: db.getPool(),
      jobId,
      network: 'public',
      startSequence,
      endSequence,
    });
    await ckpt.ensureTable();

    // Check if there is a resumable checkpoint for this range
    const existingJob = await ckpt.loadJob();
    let resumeFrom = startSequence;
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    if (
      existingJob &&
      existingJob.status === 'in_progress' &&
      existingJob.lastProcessedSequence
    ) {
      resumeFrom = existingJob.lastProcessedSequence + 1;
      processed = existingJob.processedCount;
      skipped = existingJob.skippedCount;
      failed = existingJob.failedCount;
      console.log(
        `[indexer] resuming backfill from checkpoint at ledger ${resumeFrom} ` +
          `(processed=${processed}, skipped=${skipped}, failed=${failed})`,
      );
    } else {
      await ckpt.createJob();
    }

    // ── Initialize progress tracker ────────────────────────────────────────
    const totalLedgers = this.endSequence - this.startSequence + 1; // Actually from args
    this.progressTracker.startTracking(endSequence - startSequence + 1);

    // ── Batch loop with checkpoint persistence ──────────────────────────────
    for (
      let sequence = resumeFrom;
      sequence <= endSequence;
      sequence += this.backfillBatchSize
    ) {
      if (!this.isRunning) {
        await ckpt.markCancelled({
          lastProcessedSequence: sequence - 1,
          processedCount: processed,
          skippedCount: skipped,
          failedCount: failed,
        });
        break;
      }

      const batchEnd = Math.min(sequence + this.backfillBatchSize - 1, endSequence);

      try {
        await this.processLedgerBatch(sequence, batchEnd);
        console.log(`[indexer] backfilled ledgers ${sequence} → ${batchEnd}`);

        // Update progress (approximate: we don't know exact per-ledger results here,
        // the per-ledger idempotency tracking handles dedup)
        processed += batchEnd - sequence + 1;

        // ── Update progress tracker ───────────────────────────────────────
        this.progressTracker.updateProgress({
          processed,
          skipped,
          failed,
          total: endSequence - startSequence + 1,
        });

        // ── Persist checkpoint after each batch ───────────────────────────
        await ckpt.saveCheckpoint({
          lastProcessedSequence: batchEnd,
          processedCount: processed,
          skippedCount: skipped,
          failedCount: failed,
        });
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[indexer] error backfilling ledgers ${sequence} → ${batchEnd}:`,
          error,
        );
        metrics.errorsTotal.inc({ type: 'backfill' });

        // ── Mark failed checkpoint ────────────────────────────────────────
        await ckpt.markFailed(errMsg, {
          lastProcessedSequence: sequence - 1,
          processedCount: processed,
          skippedCount: skipped,
          failedCount,
        });
      }
    }

    // ── Mark completed if all ledgers processed ──────────────────────────
    // We don't know the exact skipped/failed counts at this level, but we can
    // check if we reached endSequence
    const lastSeq = existingJob?.lastProcessedSequence
      ? Math.max(existingJob.lastProcessedSequence, resumeFrom - 1) + (processed + skipped)
      : resumeFrom - 1 + processed + skipped;

    if (lastSeq >= endSequence) {
      await ckpt.markCompleted({
        lastProcessedSequence: endSequence,
        processedCount: processed,
        skippedCount: skipped,
        failedCount: failed,
      });
      this.progressTracker.finishTracking();
    }
  }

  private async processLedgerBatch(startSequence: number, endSequence: number): Promise<void> {
    const ledgers: Horizon.ServerApi.LedgerRecord[] = [];

    for (let sequence = startSequence; sequence <= endSequence; sequence++) {
      try {
        // Issue #37 – Apply rate limiter to Horizon API calls
        await this.rateLimiter.consume();
        const ledger = await this.stellarService.getLedger(sequence);
        ledgers.push(ledger);
      } catch (error) {
        if (error instanceof CircuitOpenError) {
          console.warn(`[indexer] circuit open – aborting batch at sequence ${sequence}`);
          return;
        }
        metrics.horizonRequestErrorsTotal.inc({ endpoint: 'ledger' });
        console.error(`[indexer] error fetching ledger ${sequence}:`, error);
        metrics.errorsTotal.inc({ type: 'fetch_ledger' });
      }
    }

    await Promise.all(ledgers.map((ledger) => this.processLedger(ledger)));
  }

  // ---------------------------------------------------------------------------
  // Core processing
  // ---------------------------------------------------------------------------

  private async processLedger(rawLedger: unknown): Promise<void> {
    // ── #39 Validate ──────────────────────────────────────────────────────────
    let ledger: Horizon.ServerApi.LedgerRecord;
    try {
      ledger = validateRecord(
        HorizonLedgerSchema,
        rawLedger,
        'ledger',
      ) as unknown as Horizon.ServerApi.LedgerRecord;
    } catch (err) {
      console.error('[indexer] ledger validation failed – skipping:', err);
      metrics.validationFailures.inc({ entity: 'ledger' });
      metrics.errorsTotal.inc({ type: 'validation' });
      return;
    }

    // ── #44 Idempotency ───────────────────────────────────────────────────────
    if (await this.idempotency.shouldSkip(ledger.sequence)) return;

    // ── #43 Metrics – cycle timer ─────────────────────────────────────────────
    const cycleEnd = metrics.cycleDuration.startTimer();

    try {
      await db.transaction(async (client) => {
        // ── DB write: ledger ──────────────────────────────────────────────────
        const dbWriteEnd = metrics.dbWriteDuration.startTimer({ table: 'ledgers' });
        try {
          await client.query(
            `INSERT INTO ledgers (
              id, sequence, successful_transaction_count, failed_transaction_count,
              operation_count, tx_set_operation_count, closed_at, total_coins,
              fee_pool, base_fee_in_stroops, base_reserve_in_stroops,
              max_tx_set_size, protocol_version, header_xdr
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            ON CONFLICT (sequence) DO UPDATE SET
              successful_transaction_count = EXCLUDED.successful_transaction_count,
              failed_transaction_count     = EXCLUDED.failed_transaction_count,
              operation_count              = EXCLUDED.operation_count,
              tx_set_operation_count       = EXCLUDED.tx_set_operation_count,
              updated_at                   = NOW()`,
            [
              ledger.id,
              ledger.sequence,
              ledger.successful_transaction_count,
              ledger.failed_transaction_count,
              ledger.operation_count,
              ledger.tx_set_operation_count,
              ledger.closed_at,
              ledger.total_coins,
              ledger.fee_pool,
              ledger.base_fee_in_stroops,
              ledger.base_reserve_in_stroops,
              ledger.max_tx_set_size,
              ledger.protocol_version,
              ledger.header_xdr,
            ],
          );
        } catch (error) {
          metrics.dbWriteErrorsTotal.inc({ table: 'ledgers' });
          throw error;
        } finally {
          dbWriteEnd();
        }

        // ── Transactions ──────────────────────────────────────────────────────
        await this.processTransactionsForLedger(ledger.sequence, client);
      });

      // ── #36 Remove from dead letter queue on success ───────────────────────────
      dlq.remove(ledger.sequence);

      // ── Network metrics ───────────────────────────────────────────────────
      await this.updateNetworkMetrics(ledger);

      // ── #44 Mark processed ────────────────────────────────────────────────
      await this.idempotency.markProcessed(
        ledger.sequence,
        ledger.successful_transaction_count + ledger.failed_transaction_count,
        ledger.operation_count,
      );

      // ── #43 Counters ──────────────────────────────────────────────────────
      metrics.ledgersProcessed.inc();
      metrics.lastProcessedLedger.set(ledger.sequence);

      const now = Date.now();
      if (this.lastLedgerProcessedAt !== null) {
        const intervalSeconds = (now - this.lastLedgerProcessedAt) / 1000;
        if (intervalSeconds > 0) {
          metrics.setLedgerIngestionRate(1 / intervalSeconds);
        }
      }
      this.lastLedgerProcessedAt = now;

      // Update circuit breaker state gauge
      metrics.setCircuitBreakerState(this.stellarService.getCircuitBreakerState());
    } catch (error) {
      console.error(`[indexer] error processing ledger ${(rawLedger as any)?.sequence}:`, error);
      metrics.errorsTotal.inc({ type: 'process_ledger' });
      // ── #36 Add to dead letter queue on failure ────────────────────────────────
      dlq.push(ledger.sequence, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      cycleEnd();
    }
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  private async processTransactionsForLedger(
    ledgerSequence: number,
    client: any,
  ): Promise<void> {
    // ── #37 Rate limiter + #41 Circuit breaker ───────────────────────────────────
    metrics.horizonRequestsTotal.inc({ endpoint: 'transactions' });
    const horizonEnd = metrics.horizonRequestDuration.startTimer({ endpoint: 'transactions' });
    let rawTransactions: Horizon.ServerApi.CollectionPage<Horizon.ServerApi.TransactionRecord>;
    try {
      if (this.stellarService.getCircuitBreakerState() === 'OPEN') {
        console.warn(`[indexer] circuit open – skipping transactions for ledger ${ledgerSequence}`);
        return;
      }
      await this.rateLimiter.consume();
      rawTransactions = await this.stellarService.getTransactionsForLedger(ledgerSequence);
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        console.warn(`[indexer] circuit open – skipping transactions for ledger ${ledgerSequence}`);
        return;
      }
      metrics.horizonRequestErrorsTotal.inc({ endpoint: 'transactions' });
      throw err;
    } finally {
      horizonEnd();
    }

    // ── #39 Validate ──────────────────────────────────────────────────────────
    const { valid: transactions, invalid } = validateRecords(
      HorizonTransactionSchema,
      rawTransactions.records,
      'transaction',
    );

    if (invalid.length > 0) {
      metrics.validationFailures.inc({ entity: 'transaction' });
      console.warn(
        `[indexer] ${invalid.length} invalid transaction(s) in ledger ${ledgerSequence} – skipped`,
      );
    }

    // ── Duplicate transaction detection ────────────────────────────────────
    const txHashes = transactions.map(
      (tx) => (tx as any).hash as string,
    );

    const { duplicates } =
      await TransactionTracking.filterDuplicateTxHashes(
        this.idempotency,
        txHashes,
      );

    if (duplicates.length > 0) {
      metrics.duplicateTransactionsSkipped.inc(duplicates.length);
      console.log(
        `[indexer] skipping ${duplicates.length} duplicate transaction(s) in ` +
          `ledger ${ledgerSequence}: ${duplicates.slice(0, 5).join(', ')}` +
          (duplicates.length > 5 ? ` and ${duplicates.length - 5} more` : ''),
      );
    }

    // ── Process only unprocessed transactions ──────────────────────────────
    const duplicateSet = new Set(duplicates);
    for (const tx of transactions) {
      const txRecord = tx as unknown as Horizon.ServerApi.TransactionRecord;

      // Skip if this transaction was already processed
      if (duplicateSet.has(txRecord.hash)) continue;

      await this.processTransaction(txRecord, client);

      // Mark as processed immediately (so subsequent retries skip it)
      await TransactionTracking.markTransactionProcessed(
        this.idempotency,
        txRecord.hash,
        ledgerSequence,
      );
    }
  }

  private async processTransaction(
    txRecord: Horizon.ServerApi.TransactionRecord,
    client: any,
  ): Promise<void> {
    const dbWriteEnd = metrics.dbWriteDuration.startTimer({ table: 'transactions' });
    try {
      try {
        await client.query(
          `INSERT INTO transactions (
            id, paging_token, successful, hash, ledger_sequence, created_at,
            source_account, source_account_sequence, fee_account, fee_charged,
            max_fee, operation_count, envelope_xdr, result_xdr, result_meta_xdr,
            fee_meta_xdr, memo_type, memo, signatures, valid_after, valid_before,
            fee_bump_transaction, inner_transaction_hash, inner_transaction_signatures
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
          ON CONFLICT (hash) DO UPDATE SET
            successful = EXCLUDED.successful,
            updated_at = NOW()`,
          [
            txRecord.id,
            txRecord.paging_token,
            txRecord.successful,
            txRecord.hash,
            txRecord.ledger,
            txRecord.created_at,
            txRecord.source_account,
            txRecord.source_account_sequence,
            txRecord.fee_account,
            txRecord.fee_charged,
            txRecord.max_fee,
            txRecord.operation_count,
            txRecord.envelope_xdr,
            txRecord.result_xdr,
            txRecord.result_meta_xdr,
            txRecord.fee_meta_xdr,
            txRecord.memo_type || 'none',
            txRecord.memo,
            JSON.stringify(txRecord.signatures),
            txRecord.valid_after,
            txRecord.valid_before,
            txRecord.fee_bump_transaction,
            txRecord.inner_transaction?.hash,
            txRecord.inner_transaction
              ? JSON.stringify(txRecord.inner_transaction.signatures)
              : null,
          ],
        );
      } catch (error) {
        metrics.dbWriteErrorsTotal.inc({ table: 'transactions' });
        throw error;
      }
    } finally {
      dbWriteEnd();
    }

    metrics.transactionsProcessed.inc();

    await this.processOperationsForTransaction(txRecord.hash, client);
  }

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  private async processOperationsForTransaction(
    transactionHash: string,
    client: any,
  ): Promise<void> {
    metrics.horizonRequestsTotal.inc({ endpoint: 'operations' });
    const horizonEnd = metrics.horizonRequestDuration.startTimer({ endpoint: 'operations' });
    let rawOperations: Horizon.ServerApi.CollectionPage<Horizon.ServerApi.OperationRecord>;
    try {
      if (this.stellarService.getCircuitBreakerState() === 'OPEN') {
        console.warn(
          `[indexer] circuit open – skipping operations for tx ${transactionHash}`,
        );
        return;
      }
      // Issue #37 – Apply rate limiter to Horizon API calls
      await this.rateLimiter.consume();
      rawOperations = await this.stellarService.getOperationsForTransaction(transactionHash);
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        console.warn(
          `[indexer] circuit open – skipping operations for tx ${transactionHash}`,
        );
        return;
      }
      metrics.horizonRequestErrorsTotal.inc({ endpoint: 'operations' });
      throw err;
    } finally {
      horizonEnd();
    }

    // ── #39 Validate ──────────────────────────────────────────────────────────
    const { valid: operations, invalid } = validateRecords(
      HorizonOperationSchema,
      rawOperations.records,
      'operation',
    );

    if (invalid.length > 0) {
      metrics.validationFailures.inc({ entity: 'operation' });
      console.warn(
        `[indexer] ${invalid.length} invalid operation(s) for tx ${transactionHash} – skipped`,
      );
    }

    for (const op of operations) {
      await this.processOperation(
        op as unknown as Horizon.ServerApi.OperationRecord,
        client,
      );
    }
  }

  private async processOperation(
    opRecord: Horizon.ServerApi.OperationRecord,
    client: any,
  ): Promise<void> {
    const details = this.extractOperationDetails(opRecord);

    const dbWriteEnd = metrics.dbWriteDuration.startTimer({ table: 'operations' });
    try {
      try {
        await client.query(
          `INSERT INTO operations (
            id, paging_token, transaction_hash, transaction_successful,
            type, created_at, source_account, ledger_sequence, operation_index, details
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (id) DO UPDATE SET
            transaction_successful = EXCLUDED.transaction_successful,
            details                = EXCLUDED.details,
            updated_at             = NOW()`,
          [
            opRecord.id,
            opRecord.paging_token,
            opRecord.transaction_hash,
            opRecord.transaction_successful,
            opRecord.type,
            opRecord.created_at,
            opRecord.source_account,
            opRecord.id.split('-')[0],
            parseInt(opRecord.id.split('-')[1]),
            JSON.stringify(details),
          ],
        );
      } catch (error) {
        metrics.dbWriteErrorsTotal.inc({ table: 'operations' });
        throw error;
      }
    } finally {
      dbWriteEnd();
    }

    metrics.operationsProcessed.inc();
  }

  private extractOperationDetails(operation: Horizon.ServerApi.OperationRecord): unknown {
    const base = { type: operation.type, source_account: operation.source_account };

    switch (operation.type) {
      case 'payment':
        return {
          ...base,
          asset_type: operation.asset_type,
          asset_code: operation.asset_code,
          asset_issuer: operation.asset_issuer,
          from: operation.from,
          to: operation.to,
          amount: operation.amount,
        };
      case 'create_account':
        return {
          ...base,
          account: operation.account,
          starting_balance: operation.starting_balance,
          funder: operation.funder,
        };
      case 'manage_sell_offer':
        return {
          ...base,
          selling_asset_type: operation.selling_asset_type,
          selling_asset_code: operation.selling_asset_code,
          selling_asset_issuer: operation.selling_asset_issuer,
          buying_asset_type: operation.buying_asset_type,
          buying_asset_code: operation.buying_asset_code,
          buying_asset_issuer: operation.buying_asset_issuer,
          amount: operation.amount,
          price: operation.price,
          price_r: operation.price_r,
          offer_id: operation.offer_id,
        };
      case 'manage_buy_offer':
        return {
          ...base,
          selling_asset_type: operation.selling_asset_type,
          selling_asset_code: operation.selling_asset_code,
          selling_asset_issuer: operation.selling_asset_issuer,
          buying_asset_type: operation.buying_asset_type,
          buying_asset_code: operation.buying_asset_code,
          buying_asset_issuer: operation.buying_asset_issuer,
          amount: operation.amount,
          price: operation.price,
          price_r: operation.price_r,
          offer_id: operation.offer_id,
        };
      case 'create_passive_sell_offer':
        return {
          ...base,
          selling_asset_type: operation.selling_asset_type,
          selling_asset_code: operation.selling_asset_code,
          selling_asset_issuer: operation.selling_asset_issuer,
          buying_asset_type: operation.buying_asset_type,
          buying_asset_code: operation.buying_asset_code,
          buying_asset_issuer: operation.buying_asset_issuer,
          amount: operation.amount,
          price: operation.price,
          price_r: operation.price_r,
          offer_id: operation.offer_id,
        };
      case 'path_payment_strict_receive':
        return {
          ...base,
          from: operation.from,
          to: operation.to,
          amount: operation.amount,
          source_amount: operation.source_amount,
          source_max: operation.source_max,
          destination_asset: operation.destination_asset,
          destination_min: operation.destination_min,
          path: operation.path,
          asset_type: operation.asset_type,
          asset_code: operation.asset_code,
          asset_issuer: operation.asset_issuer,
        };
      case 'path_payment_strict_send':
        return {
          ...base,
          from: operation.from,
          to: operation.to,
          amount: operation.amount,
          source_amount: operation.source_amount,
          destination_min: operation.destination_min,
          destination_asset: operation.destination_asset,
          path: operation.path,
          asset_type: operation.asset_type,
          asset_code: operation.asset_code,
          asset_issuer: operation.asset_issuer,
        };
      case 'change_trust':
        return {
          ...base,
          asset_type: operation.asset_type,
          asset_code: operation.asset_code,
          asset_issuer: operation.asset_issuer,
          trustor: operation.trustor,
          trustee: operation.trustee,
          limit: operation.limit,
        };
      case 'allow_trust':
        return {
          ...base,
          trustor: operation.trustor,
          trustee: operation.trustee,
          asset_type: operation.asset_type,
          asset_code: operation.asset_code,
          authorize: operation.authorize,
          authorize_to_maintain_liabilities: operation.authorize_to_maintain_liabilities,
        };
      case 'set_options':
        return {
          ...base,
          signer_key: operation.signer_key,
          signer_weight: operation.signer_weight,
          master_key_weight: operation.master_key_weight,
          low_threshold: operation.low_threshold,
          med_threshold: operation.med_threshold,
          high_threshold: operation.high_threshold,
          home_domain: operation.home_domain,
          set_flags: operation.set_flags,
          set_flags_s: operation.set_flags_s,
          clear_flags: operation.clear_flags,
          clear_flags_s: operation.clear_flags_s,
        };
      case 'account_merge':
        return {
          ...base,
          account: operation.account,
          into: operation.into,
        };
      case 'inflation':
        return {
          ...base,
        };
      case 'manage_data':
        return {
          ...base,
          name: operation.name,
          value: operation.value,
        };
      case 'bump_sequence':
        return {
          ...base,
          bump_to: operation.bump_to,
        };
      case 'claim_claimable_balance':
        return {
          ...base,
          balance_id: operation.balance_id,
          claimant: operation.claimant,
        };
      case 'begin_sponsoring_future_reserves':
        return {
          ...base,
          sponsored_id: operation.sponsored_id,
        };
      case 'end_sponsoring_future_reserves':
        return {
          ...base,
          begin_sponsor: operation.begin_sponsor,
        };
      case 'revoke_sponsorship':
        return {
          ...base,
          account_id: operation.account_id,
          claimable_balance_id: operation.claimable_balance_id,
          liquidity_pool_id: operation.liquidity_pool_id,
          offer_id: operation.offer_id,
          trustline_account: operation.trustline_account,
          trustline_asset: operation.trustline_asset,
          signer_account: operation.signer_account,
          signer_key: operation.signer_key,
        };
      case 'clawback':
        return {
          ...base,
          from: operation.from,
          amount: operation.amount,
          asset_type: operation.asset_type,
          asset_code: operation.asset_code,
          asset_issuer: operation.asset_issuer,
        };
      case 'clawback_claimable_balance':
        return {
          ...base,
          balance_id: operation.balance_id,
        };
      case 'set_trust_line_flags':
        return {
          ...base,
          trustor: operation.trustor,
          asset_type: operation.asset_type,
          asset_code: operation.asset_code,
          asset_issuer: operation.asset_issuer,
          set_flags: operation.set_flags,
          set_flags_s: operation.set_flags_s,
          clear_flags: operation.clear_flags,
          clear_flags_s: operation.clear_flags_s,
        };
      case 'liquidity_pool_deposit':
        return {
          ...base,
          liquidity_pool_id: operation.liquidity_pool_id,
          max_amount_a: operation.max_amount_a,
          max_amount_b: operation.max_amount_b,
          min_price: operation.min_price,
          max_price: operation.max_price,
          shares_received: operation.shares_received,
          price_r: operation.price_r,
        };
      case 'liquidity_pool_withdraw':
        return {
          ...base,
          liquidity_pool_id: operation.liquidity_pool_id,
          shares: operation.shares,
          min_amount_a: operation.min_amount_a,
          min_amount_b: operation.min_amount_b,
        };
      case 'invoke_host_function':
        return {
          ...base,
          function: operation.function,
          parameters: operation.parameters,
          address: operation.address,
          salt: operation.salt,
        };
      default:
        return base;
    }
  }

  // ---------------------------------------------------------------------------
  // Network metrics
  // ---------------------------------------------------------------------------

  private async updateNetworkMetrics(ledger: Horizon.ServerApi.LedgerRecord): Promise<void> {
    const timestamp = new Date(ledger.closed_at);
    const metrics_ = await this.calculateNetworkMetrics(timestamp);

    await db.query(
      `INSERT INTO network_metrics (
        timestamp, ledger_count, transaction_count, operation_count,
        active_accounts, total_volume, average_fee, success_rate
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        timestamp,
        metrics_.ledgerCount,
        metrics_.transactionCount,
        metrics_.operationCount,
        metrics_.activeAccounts,
        metrics_.totalVolume,
        metrics_.averageFee,
        metrics_.successRate,
      ],
    );
  }

  private async calculateNetworkMetrics(timestamp: Date): Promise<{
    ledgerCount: number;
    transactionCount: number;
    operationCount: number;
    activeAccounts: number;
    totalVolume: string;
    averageFee: number;
    successRate: number;
  }> {
    const oneHourAgo = new Date(timestamp.getTime() - 60 * 60 * 1000);

    const [txMetrics, opMetrics, accountMetrics, volumeResult] = await Promise.all([
      db.queryOne<{
        transaction_count: string;
        successful_count: string;
        average_fee: string;
      }>(
        `SELECT
           COUNT(*)                                  AS transaction_count,
           COUNT(CASE WHEN successful THEN 1 END)    AS successful_count,
           AVG(fee_charged)                          AS average_fee
         FROM transactions
         WHERE created_at >= $1 AND created_at <= $2`,
        [oneHourAgo, timestamp],
      ),
      db.queryOne<{ operation_count: string }>(
        `SELECT COUNT(*) AS operation_count
         FROM operations
         WHERE created_at >= $1 AND created_at <= $2`,
        [oneHourAgo, timestamp],
      ),
      db.queryOne<{ active_accounts: string }>(
        `SELECT COUNT(DISTINCT source_account) AS active_accounts
         FROM transactions
         WHERE created_at >= $1 AND created_at <= $2`,
        [oneHourAgo, timestamp],
      ),
      db.queryOne<{ total_volume: string }>(
        `SELECT SUM(CAST(details->>'amount' AS NUMERIC)) AS total_volume
         FROM operations
         WHERE type = 'payment'
           AND created_at >= $1 AND created_at <= $2`,
        [oneHourAgo, timestamp],
      ),
    ]);

    const txCount = parseInt(txMetrics?.transaction_count ?? '0');
    const successCount = parseInt(txMetrics?.successful_count ?? '0');
    const successRate = txCount > 0 ? parseFloat(((successCount / txCount) * 100).toFixed(2)) : 0;

    return {
      ledgerCount: 1,
      transactionCount: txCount,
      operationCount: parseInt(opMetrics?.operation_count ?? '0'),
      activeAccounts: parseInt(accountMetrics?.active_accounts ?? '0'),
      totalVolume: volumeResult?.total_volume ?? '0',
      averageFee: parseFloat(txMetrics?.average_fee ?? '0') || 0,
      successRate,
    };
  }

  // ---------------------------------------------------------------------------
  // Status / health
  // ---------------------------------------------------------------------------

  async getStatus(): Promise<{
    isRunning: boolean;
    lastProcessedLedger: number;
    horizonUrl: string;
    circuitBreaker: ReturnType<StellarService['getCircuitBreakerStats']>;
    idempotencyCacheSize: number;
    batchConfig: {
      backfillBatchSize: number;
      ledgerBatchSize: number;
      transactionBatchSize: number;
      operationBatchSize: number;
    };
  }> {
    return {
      isRunning: this.isRunning,
      lastProcessedLedger: this.lastProcessedLedger,
      horizonUrl: this.stellarService.getHorizonUrl(),
      circuitBreaker: this.stellarService.getCircuitBreakerStats(),
      idempotencyCacheSize: this.idempotency.cacheSize(),
      batchConfig: {
        backfillBatchSize: this.backfillBatchSize,
        ledgerBatchSize: this.ledgerBatchSize,
        transactionBatchSize: this.transactionBatchSize,
        operationBatchSize: this.operationBatchSize,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Progress Tracking
  // ---------------------------------------------------------------------------

  /**
   * Get the current ingestion progress snapshot.
   */
  getProgressSnapshot(): ProgressSnapshot {
    return this.progressTracker.getSnapshot();
  }

  /**
   * Get ingestion progress history for trend analysis.
   */
  getProgressHistory(): ProgressHistoryEntry[] {
    return this.progressTracker.getHistory();
  }

  /**
   * Get elapsed time since ingestion started.
   */
  getIngestionElapsedMs(): number {
    return this.progressTracker.getElapsedMs();
  }

  // ---------------------------------------------------------------------------
  // Gap Detection & Recovery
  // ---------------------------------------------------------------------------

  /**
   * Detect missing ledger gaps using multiple strategies.
   */
  async detectGaps(): Promise<GapDetectionReport> {
    const detector = new GapDetector(
      db.getPool(),
      this.stellarService,
      this.idempotency,
    );
    return detector.generateReport();
  }

  /**
   * Recover missing ledgers by backfilling detected gaps.
   */
  async recoverMissingLedgers(): Promise<GapRecoveryResult> {
    const detector = new GapDetector(
      db.getPool(),
      this.stellarService,
      this.idempotency,
    );

    console.log('[indexer] starting gap detection and recovery...');

    return detector.recoverMissingLedgers(
      async (startSeq, endSeq) => {
        await this.backfillLedgers(startSeq, endSeq);
      },
      (message) => {
        console.log(`[indexer] gap recovery: ${message}`);
      },
    );
  }

  /** Manually reset the circuit breaker (e.g. from an admin endpoint). */
  resetCircuitBreaker(): void {
    this.stellarService.resetCircuitBreaker();
    metrics.setCircuitBreakerState('CLOSED');
  }
}
