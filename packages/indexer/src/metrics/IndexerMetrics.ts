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
 *   - indexer_websocket_reconnections_total    (counter)
 *   - indexer_cycle_duration_seconds           (histogram)
 *   - indexer_db_write_duration_seconds        (histogram, labelled by table)
 *   - indexer_horizon_request_duration_seconds (histogram, labelled by endpoint)
 *   - indexer_circuit_breaker_state            (gauge: 0=CLOSED,1=HALF_OPEN,2=OPEN)
 *   - indexer_queue_depth                      (gauge)
 *   - indexer_last_processed_ledger_sequence   (gauge)
 *   - indexer_ingestion_rate_ledgers_per_sec   (gauge)
 *   - indexer_ingestion_rate_txs_per_sec       (gauge)
 *   - indexer_ingestion_rate_ops_per_sec       (gauge)
 *   - indexer_error_rate_percentage            (gauge)
 *   - indexer_errors_by_severity_total         (counter, labelled by severity)
 *   - indexer_end_to_end_latency_seconds       (histogram)
 *   - indexer_processing_latency_seconds       (histogram)
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
  readonly errorsBySeverity: Counter<string>;

  // Histograms
  readonly cycleDuration: Histogram<string>;
  readonly dbWriteDuration: Histogram<string>;
  readonly horizonRequestDuration: Histogram<string>;
  readonly endToEndLatency: Histogram<string>;
  readonly processingLatency: Histogram<string>;

  // Gauges
  readonly circuitBreakerState: Gauge<string>;
  readonly queueDepth: Gauge<string>;
  readonly lastProcessedLedger: Gauge<string>;
  readonly ingestionRateLedgersPerSec: Gauge<string>;
  readonly ingestionRateTxsPerSec: Gauge<string>;
  readonly ingestionRateOpsPerSec: Gauge<string>;
  readonly errorRatePercentage: Gauge<string>;

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

    // Issue #139 – Errors by severity counter
    this.errorsBySeverity = new Counter({
      name: 'indexer_errors_by_severity_total',
      help: 'Total number of errors by severity level',
      labelNames: ['severity'] as const,
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

    // Issue #139 – End-to-end latency histogram
    this.endToEndLatency = new Histogram({
      name: 'indexer_end_to_end_latency_seconds',
      help: 'End-to-end latency from ledger receipt to processing completion in seconds',
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
      registers: [this.registry],
    });

    // Issue #139 – Processing latency histogram
    this.processingLatency = new Histogram({
      name: 'indexer_processing_latency_seconds',
      help: 'Time taken to process a ledger in seconds',
      buckets: [0.1, 0.5, 1, 2, 5, 10],
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

    // Issue #139 – Ingestion rate gauges
    this.ingestionRateLedgersPerSec = new Gauge({
      name: 'indexer_ingestion_rate_ledgers_per_sec',
      help: 'Current ingestion rate of ledgers per second',
      registers: [this.registry],
    });

    this.ingestionRateTxsPerSec = new Gauge({
      name: 'indexer_ingestion_rate_txs_per_sec',
      help: 'Current ingestion rate of transactions per second',
      registers: [this.registry],
    });

    this.ingestionRateOpsPerSec = new Gauge({
      name: 'indexer_ingestion_rate_ops_per_sec',
      help: 'Current ingestion rate of operations per second',
      registers: [this.registry],
    });

    // Issue #139 – Error rate percentage gauge
    this.errorRatePercentage = new Gauge({
      name: 'indexer_error_rate_percentage',
      help: 'Current error rate as a percentage (0-100)',
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

  /** Set ingestion rate metrics. */
  setIngestionRates(ledgersPerSec: number, txsPerSec: number, opsPerSec: number): void {
    this.ingestionRateLedgersPerSec.set(ledgersPerSec);
    this.ingestionRateTxsPerSec.set(txsPerSec);
    this.ingestionRateOpsPerSec.set(opsPerSec);
  }

  /** Set error rate percentage (0-100). */
  setErrorRatePercentage(percentage: number): void {
    this.errorRatePercentage.set(Math.min(100, Math.max(0, percentage)));
  }

  /** Record an error by severity level. */
  recordErrorBySeverity(severity: 'low' | 'medium' | 'high' | 'critical'): void {
    this.errorsBySeverity.inc({ severity });
  }

  /** Record end-to-end latency. */
  recordEndToEndLatency(durationSeconds: number): void {
    this.endToEndLatency.observe(durationSeconds);
  }

  /** Record processing latency. */
  recordProcessingLatency(durationSeconds: number): void {
    this.processingLatency.observe(durationSeconds);
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
