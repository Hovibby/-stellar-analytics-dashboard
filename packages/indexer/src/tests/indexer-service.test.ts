import { IndexerService } from '../services/indexer-service';
import { StellarService } from '../services/stellar-service';

// ---------------------------------------------------------------------------
// Module-level mocks (must be declared before any imports that use them)
// ---------------------------------------------------------------------------

jest.mock('../database/connection', () => ({
  db: {
    getPool: jest.fn().mockReturnValue({ connect: jest.fn() }),
    query:    jest.fn().mockResolvedValue([]),
    queryOne: jest.fn().mockResolvedValue(null),
    transaction: jest.fn(),
  },
}));

jest.mock('../metrics/IndexerMetrics', () => ({
  metrics: {
    lastProcessedLedger:        { set: jest.fn() },
    ledgersProcessed:           { inc: jest.fn() },
    transactionsProcessed:      { inc: jest.fn() },
    operationsProcessed:        { inc: jest.fn() },
    errorsTotal:                { inc: jest.fn() },
    cycleDuration:              { startTimer: jest.fn().mockReturnValue(jest.fn()) },
    dbWriteDuration:            { startTimer: jest.fn().mockReturnValue(jest.fn()) },
    horizonRequestDuration:     { startTimer: jest.fn().mockReturnValue(jest.fn()) },
    validationFailures:         { inc: jest.fn() },
    websocketReconnections:     { inc: jest.fn() },
    idempotencySkips:           { inc: jest.fn() },
    setCircuitBreakerState:     jest.fn(),
  },
}));

jest.mock('../idempotency/IdempotencyTracker', () => ({
  IdempotencyTracker: jest.fn().mockImplementation(() => ({
    initialize:             jest.fn().mockResolvedValue(undefined),
    shouldSkip:             jest.fn().mockResolvedValue(false),
    markProcessed:          jest.fn().mockResolvedValue(undefined),
    getLastProcessedSequence: jest.fn().mockResolvedValue(null),
    cacheSize:              jest.fn().mockReturnValue(0),
  })),
}));

jest.mock('../rate-limiter/RateLimiter', () => ({
  RateLimiter: jest.fn().mockImplementation(() => ({
    consume: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../error-recovery/DeadLetterQueue', () => ({
  dlq: { push: jest.fn(), remove: jest.fn() },
}));

jest.mock('../services/stellar-service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStellarService(): jest.Mocked<StellarService> {
  const MockStellar = StellarService as jest.MockedClass<typeof StellarService>;
  MockStellar.mockImplementation(() => ({
    getLatestLedger:            jest.fn().mockResolvedValue({ sequence: 1000 }),
    getLedger:                  jest.fn().mockResolvedValue({}),
    getTransactionsForLedger:   jest.fn().mockResolvedValue({ records: [] }),
    getOperationsForTransaction: jest.fn().mockResolvedValue({ records: [] }),
    streamLedgers:              jest.fn(),
    streamTransactions:         jest.fn(),
    getHorizonUrl:              jest.fn().mockReturnValue('https://horizon.stellar.org'),
    getServer:                  jest.fn(),
    testConnection:             jest.fn().mockResolvedValue(true),
  } as any));
  return new MockStellar('https://horizon.stellar.org') as jest.Mocked<StellarService>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IndexerService – constructor', () => {
  it('constructs without throwing', () => {
    const stellar = makeStellarService();
    expect(() => new IndexerService(stellar)).not.toThrow();
  });
});

describe('IndexerService – getStatus', () => {
  it('returns isRunning=false before start()', async () => {
    const stellar = makeStellarService();
    const svc = new IndexerService(stellar);

    const status = await svc.getStatus();

    expect(status.isRunning).toBe(false);
    expect(typeof status.lastProcessedLedger).toBe('number');
    expect(typeof status.horizonUrl).toBe('string');
    expect(status.idempotencyCacheSize).toBeGreaterThanOrEqual(0);
  });

  it('exposes circuitBreaker stats in status', async () => {
    const stellar = makeStellarService();
    const svc = new IndexerService(stellar);
    const status = await svc.getStatus();

    expect(status.circuitBreaker).toBeDefined();
    expect(typeof status.circuitBreaker.state).toBe('string');
    expect(typeof status.circuitBreaker.failureCount).toBe('number');
  });
});

describe('IndexerService – stop', () => {
  it('stop() can be called without start() and does not throw', async () => {
    const stellar = makeStellarService();
    const svc = new IndexerService(stellar);
    await expect(svc.stop()).resolves.not.toThrow();
  });

  it('isRunning is false after stop()', async () => {
    const stellar = makeStellarService();
    const svc = new IndexerService(stellar);
    await svc.stop();
    const status = await svc.getStatus();
    expect(status.isRunning).toBe(false);
  });
});

describe('IndexerService – resetCircuitBreaker', () => {
  it('does not throw', () => {
    const stellar = makeStellarService();
    const svc = new IndexerService(stellar);
    expect(() => svc.resetCircuitBreaker()).not.toThrow();
  });

  it('resets circuit breaker state to CLOSED', () => {
    const stellar = makeStellarService();
    const svc = new IndexerService(stellar);
    svc.resetCircuitBreaker();
    const stats = svc['circuitBreaker'].getStats();
    expect(stats.state).toBe('CLOSED');
  });
});
