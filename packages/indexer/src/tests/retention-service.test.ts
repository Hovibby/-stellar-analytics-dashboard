import { RetentionService, RETENTION_PERIODS } from '../services/retention-service';

// ---------------------------------------------------------------------------
// Mock db – all queries resolve to empty arrays by default so start() can
// run applyRetention() without hitting a real database.
// ---------------------------------------------------------------------------

const mockQuery    = jest.fn().mockResolvedValue([]);
const mockQueryOne = jest.fn().mockResolvedValue({ count: '0', oldest: null });

jest.mock('../database/connection', () => ({
  db: {
    query:    mockQuery,
    queryOne: mockQueryOne,
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue([]);
  mockQueryOne.mockResolvedValue({ count: '0', oldest: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RetentionService – RETENTION_PERIODS constants', () => {
  it('defines retention for all expected tables', () => {
    expect(RETENTION_PERIODS.LEDGERS_DAYS).toBeGreaterThan(0);
    expect(RETENTION_PERIODS.TRANSACTIONS_DAYS).toBeGreaterThan(0);
    expect(RETENTION_PERIODS.OPERATIONS_DAYS).toBeGreaterThan(0);
    expect(RETENTION_PERIODS.PAYMENTS_DAYS).toBeGreaterThan(0);
    expect(RETENTION_PERIODS.NETWORK_METRICS_DAYS).toBeGreaterThan(0);
    expect(RETENTION_PERIODS.ASSET_METRICS_DAYS).toBeGreaterThan(0);
    expect(RETENTION_PERIODS.ACCOUNT_METRICS_DAYS).toBeGreaterThan(0);
  });
});

describe('RetentionService – generateComplianceReport', () => {
  it('returns current retention policy', () => {
    const svc = new RetentionService();
    const report = svc.generateComplianceReport();

    expect(report.retentionPolicy).toEqual(RETENTION_PERIODS);
    expect(typeof report.generatedAt).toBe('string');
    expect(new Date(report.generatedAt).getTime()).not.toBeNaN();
  });

  it('lists all archive tables', () => {
    const svc = new RetentionService();
    const { tablesWithArchival } = svc.generateComplianceReport();

    expect(tablesWithArchival).toContain('ledgers_archive');
    expect(tablesWithArchival).toContain('transactions_archive');
    expect(tablesWithArchival).toContain('operations_archive');
    expect(tablesWithArchival).toContain('payments_archive');
  });
});

describe('RetentionService – getRetentionStatus', () => {
  it('returns status for all four tracked tables', async () => {
    mockQueryOne.mockResolvedValue({ count: '10', oldest: new Date('2024-01-01') });

    const svc = new RetentionService();
    const status = await svc.getRetentionStatus();

    expect(status).toHaveProperty('ledgers');
    expect(status).toHaveProperty('transactions');
    expect(status).toHaveProperty('operations');
    expect(status).toHaveProperty('payments');
  });

  it('parses count as a number', async () => {
    mockQueryOne.mockResolvedValue({ count: '42', oldest: null });

    const svc = new RetentionService();
    const status = await svc.getRetentionStatus();

    expect(status.ledgers.count).toBe(42);
    expect(typeof status.ledgers.count).toBe('number');
  });

  it('returns null for oldest when table is empty', async () => {
    mockQueryOne.mockResolvedValue({ count: '0', oldest: null });

    const svc = new RetentionService();
    const status = await svc.getRetentionStatus();

    expect(status.ledgers.oldest).toBeNull();
  });
});

describe('RetentionService – lifecycle', () => {
  it('starts without throwing when db returns empty results', async () => {
    const svc = new RetentionService();
    await expect(svc.start()).resolves.not.toThrow();
    svc.stop();
  });

  it('does not start a second time if already running', async () => {
    const svc = new RetentionService();
    await svc.start();
    const callsAfterFirstStart = mockQuery.mock.calls.length;

    await svc.start(); // second call should be a no-op
    expect(mockQuery.mock.calls.length).toBe(callsAfterFirstStart);

    svc.stop();
  });

  it('stop() is idempotent', () => {
    const svc = new RetentionService();
    svc.stop();
    svc.stop();
  });

  it('runs applyRetention against all seven retention categories', async () => {
    const svc = new RetentionService();
    await svc.start();
    svc.stop();

    const tables = mockQuery.mock.calls.map((call: any[]) => call[0] as string);

    const usesTable = (name: string) => tables.some(sql => sql.includes(name));
    expect(usesTable('ledgers')).toBe(true);
    expect(usesTable('transactions')).toBe(true);
    expect(usesTable('operations')).toBe(true);
    expect(usesTable('payments')).toBe(true);
    expect(usesTable('network_metrics')).toBe(true);
    expect(usesTable('asset_metrics')).toBe(true);
    expect(usesTable('account_metrics')).toBe(true);
  });
});
