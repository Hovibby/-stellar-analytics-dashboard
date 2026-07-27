/**
 * Issue #43 – Indexer Metrics Collection
 * Issue #139 – Add more metrics to Prometheus endpoint
 *
 * Prometheus metrics for the indexer using the `prom-client` library.
 * Exposes a /metrics HTTP endpoint on the existing health-check server.
 *
 * Tracked metrics:
 *   - indexer_ledgers_processed_total          (counter)
 *   - indexer_transactions_processed_total     (counter)
 *   - indexer_operations_processed_total       (counter)
 *   - indexer_errors_total                     (counter, labelled by type)
 *   - indexer_validation_failures_total        (counter, labelled by entity)
 *   - indexer_idempotency_skips_total          (counter)
 *   - indexer_retries_total                    (counter, labelled by operation)
 *   - indexer_dlq_enqueued_total               (counter)
 *   - indexer_cycle_duration_seconds           (histogram)
 *   - indexer_db_write_duration_seconds        (histogram, labelled by table)
 *   - indexer_horizon_request_duration_seconds (histogram, labelled by endpoint)
 *   - indexer_entity_processing_duration_seconds (histogram, labelled by entity)
 *   - indexer_batch_size                       (histogram, labelled by type)
 *   - indexer_circuit_breaker_state            (gauge: 0=CLOSED,1=HALF_OPEN,2=OPEN)
 *   - indexer_queue_depth                      (gauge)
 *   - indexer_last_processed_ledger_sequence   (gauge)
 *   - indexer_backfill_progress                (gauge)
 *   - indexer_dlq_depth                        (gauge)
 */

import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

export class IndexerMetrics {
  private static instance: IndexerMetrics;
  readonly registry: Registry;

  // Counters
  readonly ledgersProcessed: Counter<string>;
  readonly transactionsProcessed: Counter<string>;
  readonly operationsProcessed: Counter<string>;
  readonly errorsTotal: Counter<string>;
  readonly validationFailures: Counter<string>;
  readonly idempotencySkips: Counter<string>;
  readonly websocketReconnections: Counter<string>;
  /** Retry attempts per operation type (e.g. fetch_ledger, db_write) */
  readonly retriesTotal: Counter<string>;
  /** Horizon retry events labelled by endpoint and result */
  readonly horizonRetriesTotal: Counter<string>;
  /** Total Horizon requests per endpoint */
  readonly horizonRequestsTotal: Counter<string>;
  /** Horizon request errors per endpoint */
  readonly horizonRequestErrorsTotal: Counter<string>;
  /** Transactions skipped because they were already processed (duplicate detection) */
  readonly duplicateTransactionsSkipped: Counter<string>;
  /** Items enqueued to the dead letter queue */
  readonly dlqEnqueued: Counter<string>;

  // Histograms
  readonly cycleDuration: Histogram<string>;
  readonly dbWriteDuration: Histogram<string>;
  readonly horizonRequestDuration: Histogram<string>;
  /** Per-entity processing latency (ledger | transaction | operation) */
  readonly entityProcessingDuration: Histogram<string>;
  /** Number of items in each processing batch */
  readonly batchSize: Histogram<string>;

  // Gauges
  readonly circuitBreakerState: Gauge<string>;
  readonly queueDepth: Gauge<string>;
  readonly lastProcessedLedger: Gauge<string>;
  /** Backfill progress: 0–100 (percentage of target range completed) */
  readonly backfillProgress: Gauge<string>;
  /** Current number of items sitting in the dead letter queue */
  readonly dlqDepth: Gauge<string>;

  private constructor() {
    this.registry = new Registry();

    // Collect default Node.js metrics (memory, CPU, event loop lag, etc.)
    collectDefaultMetrics({ register: this.registry });

    // -----------------------------------------------------------------------
    // Counters
    // -----------------------------------------------------------------------
    this.ledgersProcessed = new Counter({
      name: 'indexer_ledgers_processed_total',
      help: 'Total number of ledgers successfully processed',
      registers: [this.registry],
    });

    this.transactionsProcessed = new Counter({
      name: 'indexer_transactions_processed_total',
      help: 'Total number of transactions successfully processed',
      registers: [this.registry],
    });

    this.operationsProcessed = new Counter({
      name: 'indexer_operations_processed_total',
      help: 'Total number of operations successfully processed',
      registers: [this.registry],
    });

    this.errorsTotal = new Counter({
      name: 'indexer_errors_total',
      help: 'Total number of errors encountered',
      labelNames: ['type'] as const,
      registers: [this.registry],
    });

    this.validationFailures = new Counter({
      name: 'indexer_validation_failures_total',
      help: 'Total number of Zod validation failures',
      labelNames: ['entity'] as const,
      registers: [this.registry],
    });

    this.idempotencySkips = new Counter({
      name: 'indexer_idempotency_skips_total',
      help: 'Total number of ledgers skipped because they were already processed',
      registers: [this.registry],
    });

    // Issue #34 – WebSocket reconnection counter
    this.websocketReconnections = new Counter({
      name: 'indexer_websocket_reconnections_total',
      help: 'Total number of WebSocket reconnection attempts',
      registers: [this.registry],
    });

    this.retriesTotal = new Counter({
      name: 'indexer_retries_total',
      help: 'Total number of retry attempts per operation type',
      labelNames: ['operation'] as const,
      registers: [this.registry],
    });

    this.horizonRetriesTotal = new Counter({
      name: 'indexer_horizon_retries_total',
      help: 'Horizon API retry events labelled by endpoint and result (retry | exhausted | permanent_error)',
      labelNames: ['endpoint', 'result'] as const,
      registers: [this.registry],
    });

    this.horizonRequestsTotal = new Counter({
      name: 'indexer_horizon_requests_total',
      help: 'Total number of Horizon API requests per endpoint',
      labelNames: ['endpoint'] as const,
      registers: [this.registry],
    });

    this.horizonRequestErrorsTotal = new Counter({
      name: 'indexer_horizon_request_errors_total',
      help: 'Total number of Horizon API request errors per endpoint',
      labelNames: ['endpoint'] as const,
      registers: [this.registry],
    });

    this.duplicateTransactionsSkipped = new Counter({
      name: 'indexer_duplicate_transactions_skipped_total',
      help: 'Total number of transactions skipped via duplicate hash detection',
      registers: [this.registry],
    });

    this.dlqEnqueued = new Counter({
      name: 'indexer_dlq_enqueued_total',
      help: 'Total number of items enqueued to the dead letter queue',
      registers: [this.registry],
    });

    // -----------------------------------------------------------------------
    // Histograms
    // -----------------------------------------------------------------------
    this.cycleDuration = new Histogram({
      name: 'indexer_cycle_duration_seconds',
      help: 'Duration of a full indexer poll cycle in seconds',
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    });

    this.dbWriteDuration = new Histogram({
      name: 'indexer_db_write_duration_seconds',
      help: 'Duration of database write operations in seconds',
      labelNames: ['table'] as const,
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
      registers: [this.registry],
    });

    this.horizonRequestDuration = new Histogram({
      name: 'indexer_horizon_request_duration_seconds',
      help: 'Duration of Horizon API requests in seconds',
      labelNames: ['endpoint'] as const,
      buckets: [0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.entityProcessingDuration = new Histogram({
      name: 'indexer_entity_processing_duration_seconds',
      help: 'End-to-end processing latency per entity type (ledger, transaction, operation)',
      labelNames: ['entity'] as const,
      buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
      registers: [this.registry],
    });

    this.batchSize = new Histogram({
      name: 'indexer_batch_size',
      help: 'Number of items in each processing batch',
      labelNames: ['type'] as const,
      buckets: [1, 5, 10, 25, 50, 100, 200],
      registers: [this.registry],
    });

    // -----------------------------------------------------------------------
    // Gauges
    // -----------------------------------------------------------------------
    this.circuitBreakerState = new Gauge({
      name: 'indexer_circuit_breaker_state',
      help: 'Circuit breaker state: 0=CLOSED, 1=HALF_OPEN, 2=OPEN',
      registers: [this.registry],
    });

    this.queueDepth = new Gauge({
      name: 'indexer_queue_depth',
      help: 'Number of ledgers waiting to be processed',
      registers: [this.registry],
    });

    this.lastProcessedLedger = new Gauge({
      name: 'indexer_last_processed_ledger_sequence',
      help: 'Sequence number of the last successfully processed ledger',
      registers: [this.registry],
    });

    this.backfillProgress = new Gauge({
      name: 'indexer_backfill_progress',
      help: 'Backfill completion percentage (0–100)',
      registers: [this.registry],
    });

    this.dlqDepth = new Gauge({
      name: 'indexer_dlq_depth',
      help: 'Current number of items in the dead letter queue',
      registers: [this.registry],
    });
  }

  static getInstance(): IndexerMetrics {
    if (!IndexerMetrics.instance) {
      IndexerMetrics.instance = new IndexerMetrics();
    }
    return IndexerMetrics.instance;
  }

  // ---------------------------------------------------------------------------
  // Convenience helpers
  // ---------------------------------------------------------------------------

  /** Map CircuitBreaker state string to a numeric gauge value. */
  setCircuitBreakerState(state: 'CLOSED' | 'HALF_OPEN' | 'OPEN'): void {
    const stateMap = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 } as const;
    this.circuitBreakerState.set(stateMap[state]);
  }

  /**
   * Update backfill progress gauge.
   * @param processed Number of ledgers processed so far in the backfill range.
   * @param total     Total ledgers in the backfill range.
   */
  setBackfillProgress(processed: number, total: number): void {
    if (total <= 0) return;
    this.backfillProgress.set(Math.min(100, (processed / total) * 100));
  }

  /** Return the full Prometheus text exposition. */
  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}

export const metrics = IndexerMetrics.getInstance();
