/**
 * Tests for IndexerMetrics – verifies metric creation, recording, and
 * expected behaviour for both existing and new operational metrics.
 */

import { Registry } from 'prom-client';
import { IndexerMetrics } from '../metrics/IndexerMetrics';

// Each test suite gets a fresh IndexerMetrics instance backed by its own
// Registry so tests are fully isolated from the module-level singleton.
function makeMetrics(): IndexerMetrics {
  // Access the private constructor via casting to bypass the singleton.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (IndexerMetrics as any)();
}

// ---------------------------------------------------------------------------
// Registry & singleton
// ---------------------------------------------------------------------------

describe('IndexerMetrics – registry', () => {
  it('exposes a Registry instance', () => {
    const m = makeMetrics();
    expect(m.registry).toBeInstanceOf(Registry);
  });

  it('getInstance returns the same object on repeated calls', () => {
    const a = IndexerMetrics.getInstance();
    const b = IndexerMetrics.getInstance();
    expect(a).toBe(b);
  });

  it('getMetricsText returns a non-empty string', async () => {
    const m = makeMetrics();
    const text = await m.getMetricsText();
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('contentType returns the Prometheus content-type string', () => {
    const m = makeMetrics();
    expect(m.contentType()).toMatch(/text\/plain/);
  });
});

// ---------------------------------------------------------------------------
// Existing counters
// ---------------------------------------------------------------------------

describe('IndexerMetrics – existing counters', () => {
  it('ledgersProcessed increments', async () => {
    const m = makeMetrics();
    m.ledgersProcessed.inc();
    m.ledgersProcessed.inc();
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_ledgers_processed_total 2/);
  });

  it('transactionsProcessed increments', async () => {
    const m = makeMetrics();
    m.transactionsProcessed.inc(5);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_transactions_processed_total 5/);
  });

  it('operationsProcessed increments', async () => {
    const m = makeMetrics();
    m.operationsProcessed.inc(10);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_operations_processed_total 10/);
  });

  it('errorsTotal increments with label', async () => {
    const m = makeMetrics();
    m.errorsTotal.inc({ type: 'fetch_ledger' });
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_errors_total\{type="fetch_ledger"\} 1/);
  });

  it('validationFailures increments with entity label', async () => {
    const m = makeMetrics();
    m.validationFailures.inc({ entity: 'transaction' });
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_validation_failures_total\{entity="transaction"\} 1/);
  });

  it('idempotencySkips increments', async () => {
    const m = makeMetrics();
    m.idempotencySkips.inc(3);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_idempotency_skips_total 3/);
  });

  it('websocketReconnections increments', async () => {
    const m = makeMetrics();
    m.websocketReconnections.inc();
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_websocket_reconnections_total 1/);
  });
});

// ---------------------------------------------------------------------------
// New counters
// ---------------------------------------------------------------------------

describe('IndexerMetrics – new counters', () => {
  it('retriesTotal increments with operation label', async () => {
    const m = makeMetrics();
    m.retriesTotal.inc({ operation: 'fetch_ledger' });
    m.retriesTotal.inc({ operation: 'fetch_ledger' });
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_retries_total\{operation="fetch_ledger"\} 2/);
  });

  it('retriesTotal tracks different operation labels independently', async () => {
    const m = makeMetrics();
    m.retriesTotal.inc({ operation: 'db_write' });
    m.retriesTotal.inc({ operation: 'fetch_ledger' });
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_retries_total\{operation="db_write"\} 1/);
    expect(text).toMatch(/indexer_retries_total\{operation="fetch_ledger"\} 1/);
  });

  it('dlqEnqueued increments', async () => {
    const m = makeMetrics();
    m.dlqEnqueued.inc();
    m.dlqEnqueued.inc();
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_dlq_enqueued_total 2/);
  });
});

// ---------------------------------------------------------------------------
// Existing histograms
// ---------------------------------------------------------------------------

describe('IndexerMetrics – existing histograms', () => {
  it('cycleDuration records an observation', async () => {
    const m = makeMetrics();
    m.cycleDuration.observe(1.5);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_cycle_duration_seconds_count 1/);
  });

  it('dbWriteDuration startTimer returns a callable end function', () => {
    const m = makeMetrics();
    const end = m.dbWriteDuration.startTimer({ table: 'ledgers' });
    expect(typeof end).toBe('function');
    expect(() => end()).not.toThrow();
  });

  it('horizonRequestDuration records with endpoint label', async () => {
    const m = makeMetrics();
    m.horizonRequestDuration.observe({ endpoint: 'transactions' }, 0.3);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_horizon_request_duration_seconds_count\{endpoint="transactions"\} 1/);
  });
});

// ---------------------------------------------------------------------------
// New histograms
// ---------------------------------------------------------------------------

describe('IndexerMetrics – new histograms', () => {
  it('entityProcessingDuration records with entity label', async () => {
    const m = makeMetrics();
    m.entityProcessingDuration.observe({ entity: 'ledger' }, 0.05);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_entity_processing_duration_seconds_count\{entity="ledger"\} 1/);
  });

  it('entityProcessingDuration tracks ledger, transaction, operation independently', async () => {
    const m = makeMetrics();
    m.entityProcessingDuration.observe({ entity: 'ledger' }, 0.1);
    m.entityProcessingDuration.observe({ entity: 'transaction' }, 0.02);
    m.entityProcessingDuration.observe({ entity: 'operation' }, 0.005);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_entity_processing_duration_seconds_count\{entity="ledger"\} 1/);
    expect(text).toMatch(/indexer_entity_processing_duration_seconds_count\{entity="transaction"\} 1/);
    expect(text).toMatch(/indexer_entity_processing_duration_seconds_count\{entity="operation"\} 1/);
  });

  it('entityProcessingDuration startTimer works', () => {
    const m = makeMetrics();
    const end = m.entityProcessingDuration.startTimer({ entity: 'transaction' });
    expect(typeof end).toBe('function');
    expect(() => end()).not.toThrow();
  });

  it('batchSize records with type label', async () => {
    const m = makeMetrics();
    m.batchSize.observe({ type: 'transactions' }, 42);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_batch_size_count\{type="transactions"\} 1/);
    expect(text).toMatch(/indexer_batch_size_sum\{type="transactions"\} 42/);
  });

  it('batchSize tracks different types independently', async () => {
    const m = makeMetrics();
    m.batchSize.observe({ type: 'ledgers' }, 10);
    m.batchSize.observe({ type: 'operations' }, 50);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_batch_size_sum\{type="ledgers"\} 10/);
    expect(text).toMatch(/indexer_batch_size_sum\{type="operations"\} 50/);
  });
});

// ---------------------------------------------------------------------------
// Existing gauges
// ---------------------------------------------------------------------------

describe('IndexerMetrics – existing gauges', () => {
  it('queueDepth can be set and read back', async () => {
    const m = makeMetrics();
    m.queueDepth.set(7);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_queue_depth 7/);
  });

  it('lastProcessedLedger can be set', async () => {
    const m = makeMetrics();
    m.lastProcessedLedger.set(1234567);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_last_processed_ledger_sequence 1234567/);
  });
});

// ---------------------------------------------------------------------------
// New gauges
// ---------------------------------------------------------------------------

describe('IndexerMetrics – new gauges', () => {
  it('backfillProgress can be set directly', async () => {
    const m = makeMetrics();
    m.backfillProgress.set(75);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_backfill_progress 75/);
  });

  it('dlqDepth can be set and decremented', async () => {
    const m = makeMetrics();
    m.dlqDepth.set(5);
    m.dlqDepth.dec();
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_dlq_depth 4/);
  });
});

// ---------------------------------------------------------------------------
// setCircuitBreakerState helper
// ---------------------------------------------------------------------------

describe('IndexerMetrics – setCircuitBreakerState', () => {
  it('sets gauge to 0 for CLOSED', async () => {
    const m = makeMetrics();
    m.setCircuitBreakerState('CLOSED');
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_circuit_breaker_state 0/);
  });

  it('sets gauge to 1 for HALF_OPEN', async () => {
    const m = makeMetrics();
    m.setCircuitBreakerState('HALF_OPEN');
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_circuit_breaker_state 1/);
  });

  it('sets gauge to 2 for OPEN', async () => {
    const m = makeMetrics();
    m.setCircuitBreakerState('OPEN');
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_circuit_breaker_state 2/);
  });
});

// ---------------------------------------------------------------------------
// setBackfillProgress helper
// ---------------------------------------------------------------------------

describe('IndexerMetrics – setBackfillProgress', () => {
  it('computes percentage correctly', async () => {
    const m = makeMetrics();
    m.setBackfillProgress(50, 200);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_backfill_progress 25/);
  });

  it('clamps to 100 when processed exceeds total', async () => {
    const m = makeMetrics();
    m.setBackfillProgress(300, 200);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_backfill_progress 100/);
  });

  it('does nothing when total is 0 (avoids division by zero)', async () => {
    const m = makeMetrics();
    m.backfillProgress.set(42); // pre-set a value
    m.setBackfillProgress(10, 0);
    const text = await m.getMetricsText();
    // Value should remain unchanged
    expect(text).toMatch(/indexer_backfill_progress 42/);
  });

  it('sets 100 when fully complete', async () => {
    const m = makeMetrics();
    m.setBackfillProgress(100, 100);
    const text = await m.getMetricsText();
    expect(text).toMatch(/indexer_backfill_progress 100/);
  });
});
