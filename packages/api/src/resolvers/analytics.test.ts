import { analyticsResolvers } from './analytics';
import { db, CACHE_TTL } from '../database/connection';

jest.mock('../database/connection', () => ({
  db: {
    query: jest.fn(),
    queryOne: jest.fn(),
    cacheGet: jest.fn(),
    cacheSet: jest.fn(),
  },
  CACHE_TTL: {
    NETWORK_STATS: 60,
    LEDGER_DATA: 300,
    ACCOUNT_STATS: 300,
    ASSET_DATA: 300,
  },
}));

jest.mock('../database/cached-query', () => ({
  buildCacheKey: jest.fn((prefix, parts) => `${prefix}:${JSON.stringify(parts)}`),
  cachedQuery: jest.fn(async (_key, _ttl, fetcher) => fetcher()),
}));

const mockDb = db as jest.Mocked<typeof db>;

describe('Analytics Resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Query.stats', () => {
    it('should return stats with zero/null values for empty database', async () => {
      const zeroRow = {
        total_ledgers: '0',
        total_transactions: '0',
        total_operations: '0',
        total_accounts: '0',
        total_assets: '0',
        latest_ledger: null,
        latest_ledger_time: null,
        active_accounts_24h: '0',
        active_accounts_7d: '0',
        active_accounts_30d: '0',
        volume_24h: '0',
        volume_7d: '0',
        volume_30d: '0',
        average_fee_24h: null,
        success_rate_24h: null,
      };

      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.queryOne.mockResolvedValue(zeroRow);

      const result = await analyticsResolvers.Query.stats(
        null,
        {},
        {},
        {} as any
      );

      expect(result.totalLedgers).toBe(0);
      expect(result.totalTransactions).toBe(0);
      expect(result.totalAccounts).toBe(0);
      expect(result.volume24h).toBe('0');
      expect(result.averageFee24h).toBe(0);
      expect(result.successRate24h).toBe(0);
      expect(result.latestLedger).toBeNull();
    });

    it('should handle missing relations gracefully', async () => {
      // Simulate partial data — some columns might be null
      const partialRow = {
        total_ledgers: '100',
        total_transactions: '5000',
        total_operations: '15000',
        total_accounts: '2000',
        total_assets: '50',
        latest_ledger: null, // Missing relation
        latest_ledger_time: null,
        active_accounts_24h: '500',
        active_accounts_7d: '1200',
        active_accounts_30d: '1800',
        volume_24h: null, // Null volume
        volume_7d: '1000000',
        volume_30d: '5000000',
        average_fee_24h: null,
        success_rate_24h: null,
      };

      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.queryOne.mockResolvedValue(partialRow);

      const result = await analyticsResolvers.Query.stats(
        null,
        {},
        {},
        {} as any
      );

      expect(result.totalLedgers).toBe(100);
      expect(result.latestLedger).toBeNull();
      expect(result.volume24h).toBeNull();
    });

    it('should return cached stats when available', async () => {
      const cachedStats = {
        totalLedgers: 500,
        totalTransactions: 25000,
        averageFee24h: 0.001,
      };
      mockDb.cacheGet.mockResolvedValue(cachedStats);

      const result = await analyticsResolvers.Query.stats(
        null,
        {},
        {},
        {} as any
      );

      expect(result).toEqual(cachedStats);
      expect(mockDb.queryOne).not.toHaveBeenCalled();
    });
  });

  describe('Query.networkMetrics', () => {
    it('should return empty array for empty dataset', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([]);

      const result = await analyticsResolvers.Query.networkMetrics(
        null,
        {},
        {},
        {} as any
      );

      expect(result).toEqual([]);
    });

    it('should handle time range filtering', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([
        {
          timestamp: '2024-01-15T00:00:00Z',
          ledger_count: 100,
          transaction_count: 1000,
          operation_count: 3000,
          active_accounts: 500,
          total_volume: '1000000',
          average_fee: 0.001,
          success_rate: 99.5,
        },
      ]);

      const result = await analyticsResolvers.Query.networkMetrics(
        null,
        { timeRange: { startTime: '2024-01-01T00:00:00Z', endTime: '2024-01-31T00:00:00Z' } },
        {},
        {} as any
      );

      expect(result).toHaveLength(1);
      expect(result[0].transactionCount).toBe(1000);
      expect(result[0].successRate).toBe(99.5);
    });
  });

  describe('Query.accountMetrics', () => {
    it('should return empty array when account has no metrics', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([]);

      const result = await analyticsResolvers.Query.accountMetrics(
        null,
        { accountId: 'GABC...' },
        {},
        {} as any
      );

      expect(result).toEqual([]);
    });

    it('should return metrics for active account', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([
        {
          account_id: 'GABC...',
          timestamp: '2024-01-15T00:00:00Z',
          balance_native: '1000.0000000',
          total_balance_usd: '500.00',
          transaction_count_24h: 5,
          transaction_count_7d: 20,
          transaction_count_30d: 50,
          first_transaction: '2023-06-01T00:00:00Z',
          last_transaction: '2024-01-15T00:00:00Z',
          is_active: true,
          trustlines: 3,
          signers: 2,
        },
      ]);

      const result = await analyticsResolvers.Query.accountMetrics(
        null,
        { accountId: 'GABC...' },
        {},
        {} as any
      );

      expect(result).toHaveLength(1);
      expect(result[0].accountId).toBe('GABC...');
      expect(result[0].isActive).toBe(true);
      expect(result[0].transactionCount24h).toBe(5);
    });

    it('should return inactive account metrics', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([
        {
          account_id: 'GXYZ...',
          timestamp: '2024-01-15T00:00:00Z',
          balance_native: '100.0000000',
          total_balance_usd: '50.00',
          transaction_count_24h: 0,
          transaction_count_7d: 0,
          transaction_count_30d: 1,
          first_transaction: '2023-01-01T00:00:00Z',
          last_transaction: '2024-01-01T00:00:00Z',
          is_active: false,
          trustlines: 1,
          signers: 1,
        },
      ]);

      const result = await analyticsResolvers.Query.accountMetrics(
        null,
        { accountId: 'GXYZ...' },
        {},
        {} as any
      );

      expect(result[0].isActive).toBe(false);
      expect(result[0].transactionCount24h).toBe(0);
    });

    it('should handle null firstTransaction gracefully', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([
        {
          account_id: 'GNEW...',
          timestamp: '2024-01-15T00:00:00Z',
          balance_native: '500.0000000',
          total_balance_usd: '250.00',
          transaction_count_24h: 0,
          transaction_count_7d: 0,
          transaction_count_30d: 0,
          first_transaction: null, // No first transaction
          last_transaction: '2024-01-15T00:00:00Z',
          is_active: false,
          trustlines: 0,
          signers: 1,
        },
      ]);

      const result = await analyticsResolvers.Query.accountMetrics(
        null,
        { accountId: 'GNEW...' },
        {},
        {} as any
      );

      expect(result[0].firstTransaction).toBeNull();
    });
  });

  describe('Query.assetMetrics', () => {
    it('should return empty array when no assets match', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([]);

      const result = await analyticsResolvers.Query.assetMetrics(
        null,
        { filter: { assetCode: 'NONEXISTENT' } },
        {},
        {} as any
      );

      expect(result).toEqual([]);
    });

    it('should handle null asset metrics gracefully', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GABC...',
          native: false,
          volume_24h: null,
          volume_7d: null,
          volume_30d: null,
          trades_24h: 0,
          trades_7d: 0,
          trades_30d: 0,
          price_change_24h: null,
          market_cap: null,
          holders: 0,
        },
      ]);

      const result = await analyticsResolvers.Query.assetMetrics(
        null,
        {},
        {},
        {} as any
      );

      expect(result).toHaveLength(1);
      expect(result[0].volume24h).toBeNull();
      expect(result[0].holders).toBe(0);
      expect(result[0].priceChange24h).toBe(0);
    });
  });

  describe('Query.serviceStatus', () => {
    let originalFetch: typeof global.fetch;

    beforeAll(() => {
      originalFetch = global.fetch;
    });

    afterAll(() => {
      global.fetch = originalFetch;
    });

    it('should return healthy statuses when indexer is fresh and horizon is responsive', async () => {
      const now = new Date();
      mockDb.queryOne.mockResolvedValueOnce({ closed_at: now });
      
      const mockFetch = jest.fn().mockResolvedValueOnce({ ok: true });
      global.fetch = mockFetch;

      const result = await analyticsResolvers.Query.serviceStatus(
        null,
        {},
        {},
        {} as any
      );

      expect(result).toEqual({
        api: 'healthy',
        indexer: 'healthy',
        dataSource: 'healthy',
      });
      expect(mockDb.queryOne).toHaveBeenCalledWith(
        'SELECT closed_at FROM ledgers ORDER BY sequence DESC LIMIT 1'
      );
    });

    it('should return stalled indexer status when latest ledger is older than 1 minute', async () => {
      const longAgo = new Date(Date.now() - 70_000);
      mockDb.queryOne.mockResolvedValueOnce({ closed_at: longAgo });
      
      const mockFetch = jest.fn().mockResolvedValueOnce({ ok: true });
      global.fetch = mockFetch;

      const result = await analyticsResolvers.Query.serviceStatus(
        null,
        {},
        {},
        {} as any
      );

      expect(result.indexer).toBe('stalled');
    });

    it('should return unhealthy data source status when horizon fetch fails', async () => {
      const now = new Date();
      mockDb.queryOne.mockResolvedValueOnce({ closed_at: now });
      
      const mockFetch = jest.fn().mockRejectedValueOnce(new Error('Fetch failed'));
      global.fetch = mockFetch;

      const result = await analyticsResolvers.Query.serviceStatus(
        null,
        {},
        {},
        {} as any
      );

      expect(result.dataSource).toBe('unhealthy');
    });
  });
});
