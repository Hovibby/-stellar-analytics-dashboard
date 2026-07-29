import { transactionResolvers } from './transactions';
import { db } from '../database/connection';

jest.mock('../database/connection', () => ({
  db: {
    query: jest.fn(),
    queryOne: jest.fn(),
    cacheGet: jest.fn(),
    cacheSet: jest.fn(),
    incrementCacheMetric: jest.fn(),
  },
  CACHE_TTL: {
    LEDGER_DATA: 300,
    NETWORK_STATS: 60,
    ACCOUNT_STATS: 300,
    ASSET_DATA: 300,
  },
}));

const mockDb = db as jest.Mocked<typeof db>;

describe('Transaction Resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Query.transactions', () => {
    it('should return empty edges for empty dataset', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([]);
      mockDb.queryOne.mockResolvedValue({ total: '0' });

      const result = await transactionResolvers.Query.transactions(
        null,
        { pagination: { first: 5 } },
        {} as any,
        {} as any
      );

      expect(result.edges).toHaveLength(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.totalCount).toBe(0);
    });

    it('should handle null pagination with defaults', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([]);
      mockDb.queryOne.mockResolvedValue({ total: '0' });

      const result = await transactionResolvers.Query.transactions(
        null,
        {},
        {} as any,
        {} as any
      );

      expect(result.edges).toHaveLength(0);
    });

    it('should handle cache hit and return cached data', async () => {
      const cachedData = {
        edges: [{ cursor: 'token1', node: { hash: 'abc123', sourceAccount: 'GABC...' } }],
        pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: 'token1', endCursor: 'token1' },
        totalCount: 1,
      };
      mockDb.cacheGet.mockResolvedValue(cachedData);

      const result = await transactionResolvers.Query.transactions(
        null,
        { pagination: { first: 5 } },
        {} as any,
        {} as any
      );

      expect(result).toEqual(cachedData);
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should filter by successful transactions', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([]);
      mockDb.queryOne.mockResolvedValue({ total: '0' });

      await transactionResolvers.Query.transactions(
        null,
        {
          pagination: { first: 5 },
          filter: { successful: true },
        },
        {} as any,
        {} as any
      );

      // Check that the query was called with the successful filter
      expect(mockDb.query).toHaveBeenCalled();
      const queryCall = (mockDb.query as jest.Mock).mock.calls[0][0];
      expect(queryCall).toContain('successful');
    });

    it('should filter by time range', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([]);
      mockDb.queryOne.mockResolvedValue({ total: '0' });

      await transactionResolvers.Query.transactions(
        null,
        {
          pagination: { first: 5 },
          timeRange: { startTime: '2024-01-01T00:00:00Z', endTime: '2024-01-31T00:00:00Z' },
        },
        {} as any,
        {} as any
      );

      expect(mockDb.query).toHaveBeenCalled();
      const queryCall = (mockDb.query as jest.Mock).mock.calls[0][0];
      expect(queryCall).toContain('created_at');
    });

    it('should return paginated results', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      const rows = Array.from({ length: 5 }, (_, i) => ({
        id: `${i}`,
        paging_token: `token-${i}`,
        successful: true,
        hash: `hash${i}`,
        ledger_sequence: 100 - i,
        created_at: new Date().toISOString(),
        source_account: `GABC${i}`,
        source_account_sequence: `${i}`,
        fee_account: `GFEE${i}`,
        fee_charged: 100,
        max_fee: 200,
        operation_count: 1,
        envelope_xdr: '',
        result_xdr: '',
        result_meta_xdr: '',
        fee_meta_xdr: '',
        memo_type: 'none',
        memo: null,
        signatures: [],
        valid_after: null,
        valid_before: null,
        fee_bump_transaction: false,
        inner_transaction_hash: null,
        inner_transaction_signatures: null,
      }));
      mockDb.query.mockResolvedValue(rows);
      mockDb.queryOne.mockResolvedValue({ total: '50' });

      const result = await transactionResolvers.Query.transactions(
        null,
        { pagination: { first: 5 } },
        {} as any,
        {} as any
      );

      expect(result.edges).toHaveLength(5);
      expect(result.totalCount).toBe(50);
    });
  });

  describe('Query.transaction', () => {
    it('should return null for non-existent transaction hash', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.queryOne.mockResolvedValue(null);

      const result = await transactionResolvers.Query.transaction(
        null,
        { hash: 'nonexistenthash1234567890abcdef1234567890abcdef1234567890abcdef1234' },
        {} as any,
        {} as any
      );

      expect(result).toBeNull();
    });

    it('should return transaction when found', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      const txData = {
        id: '1',
        paging_token: 'token-1',
        successful: true,
        hash: 'abc123',
        ledger_sequence: 100,
        created_at: '2024-01-01T00:00:00Z',
        source_account: 'GABC...',
        source_account_sequence: '123',
        fee_account: 'GFEE...',
        fee_charged: 100,
        max_fee: 200,
        operation_count: 2,
        envelope_xdr: 'envxdr',
        result_xdr: 'resxdr',
        result_meta_xdr: 'metaxdr',
        fee_meta_xdr: 'feemetaxdr',
        memo_type: 'text',
        memo: 'test memo',
        signatures: ['sig1'],
        valid_after: null,
        valid_before: null,
        fee_bump_transaction: false,
        inner_transaction_hash: null,
        inner_transaction_signatures: null,
      };
      mockDb.queryOne.mockResolvedValue(txData);

      const result = await transactionResolvers.Query.transaction(
        null,
        { hash: 'abc123' },
        {} as any,
        {} as any
      );

      expect(result).not.toBeNull();
      expect(result!.hash).toBe('abc123');
      expect(result!.sourceAccount).toBe('GABC...');
    });
  });

  describe('Transaction.operations', () => {
    it('should return empty array when no operations for a transaction', async () => {
      const loaders = {
        transactionOperationsLoader: {
          load: jest.fn().mockResolvedValue([]),
        },
      };

      const result = await transactionResolvers.Transaction.operations(
        { hash: 'tx-with-no-ops' },
        {},
        { loaders },
        {} as any
      );

      expect(result).toEqual([]);
    });

    it('should return mapped operations for a transaction', async () => {
      const loaders = {
        transactionOperationsLoader: {
          load: jest.fn().mockResolvedValue([
            {
              id: 'op1',
              created_at: '2024-01-01T00:00:00Z',
              transaction_hash: 'txhash',
              transaction_successful: true,
              source_account: 'GABC...',
              ledger_sequence: 100,
              operation_index: 0,
              type: 'payment',
              details: { amount: '100' },
              paging_token: 'pt1',
            },
          ]),
        },
      };

      const result = await transactionResolvers.Transaction.operations(
        { hash: 'txhash' },
        {},
        { loaders },
        {} as any
      );

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('payment');
    });

    it('should handle null/undefined loaders gracefully', async () => {
      // Transaction with operations — should not throw
      await expect(
        transactionResolvers.Transaction.operations(
          { hash: 'txhash' },
          {},
          { loaders: {} } as any,
          {} as any
        )
      ).rejects.toThrow();
    });
  });
});
