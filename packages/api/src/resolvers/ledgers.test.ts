import { ledgerResolvers } from './ledgers';
import { db } from '../database/connection';

// Mock the database
jest.mock('../database/connection', () => ({
  db: {
    query: jest.fn(),
    queryOne: jest.fn(),
    cacheGet: jest.fn(),
    cacheSet: jest.fn(),
  },
}));

const mockDb = db as jest.Mocked<typeof db>;

describe('Ledger Resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Query.ledgers', () => {
    it('should return empty edges for empty dataset', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([]);
      mockDb.queryOne.mockResolvedValue({ total: '0' });

      const result = await ledgerResolvers.Query.ledgers(
        null,
        { pagination: { first: 5 } },
        {},
        {} as any
      );

      expect(result.edges).toHaveLength(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.totalCount).toBe(0);
    });

    it('should handle null pagination gracefully', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([]);
      mockDb.queryOne.mockResolvedValue({ total: '0' });

      const result = await ledgerResolvers.Query.ledgers(
        null,
        {},
        {},
        {} as any
      );

      expect(result.edges).toHaveLength(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
    });

    it('should handle cache hit (returns early)', async () => {
      const cachedData = {
        edges: [{ cursor: '123', node: { id: '1', sequence: 123, closedAt: '2024-01-01' } }],
        pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: '123', endCursor: '123' },
        totalCount: 1,
      };
      mockDb.cacheGet.mockResolvedValue(cachedData);

      const result = await ledgerResolvers.Query.ledgers(
        null,
        { pagination: { first: 5 } },
        {},
        {} as any
      );

      expect(result).toEqual(cachedData);
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should return paginated results with hasNextPage', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      // Return limit + 1 to indicate more pages
      const rows = Array.from({ length: 6 }, (_, i) => ({
        id: `${i}`,
        sequence: 100 - i,
        closed_at: new Date().toISOString(),
        successful_transaction_count: 10,
        failed_transaction_count: 0,
        operation_count: 20,
        tx_set_operation_count: 20,
        total_coins: '100000000',
        fee_pool: '1000',
        base_fee_in_stroops: 100,
        base_reserve_in_stroops: 5000000,
        max_tx_set_size: 1000,
        protocol_version: 19,
        header_xdr: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      mockDb.query.mockResolvedValue(rows);
      mockDb.queryOne.mockResolvedValue({ total: '100' });

      const result = await ledgerResolvers.Query.ledgers(
        null,
        { pagination: { first: 5 } },
        {},
        {} as any
      );

      expect(result.edges).toHaveLength(5);
      expect(result.pageInfo.hasNextPage).toBe(true);
      expect(result.totalCount).toBe(100);
    });
  });

  describe('Query.ledger', () => {
    it('should return null for non-existent ledger', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      mockDb.queryOne.mockResolvedValue(null);

      const result = await ledgerResolvers.Query.ledger(
        null,
        { sequence: 999999 },
        { loaders: {} },
        {} as any
      );

      expect(result).toBeNull();
    });

    it('should return ledger data when found', async () => {
      mockDb.cacheGet.mockResolvedValue(null);
      const ledgerData = {
        id: '1',
        sequence: 123,
        closed_at: '2024-01-01T00:00:00Z',
        successful_transaction_count: 50,
        failed_transaction_count: 2,
        operation_count: 100,
        tx_set_operation_count: 100,
        total_coins: '50000000000',
        fee_pool: '5000',
        base_fee_in_stroops: 100,
        base_reserve_in_stroops: 5000000,
        max_tx_set_size: 1000,
        protocol_version: 20,
        header_xdr: 'base64xdr',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      mockDb.queryOne.mockResolvedValue(ledgerData);

      const result = await ledgerResolvers.Query.ledger(
        null,
        { sequence: 123 },
        { loaders: {} },
        {} as any
      );

      expect(result).not.toBeNull();
      expect(result!.sequence).toBe(123);
      expect(result!.closedAt).toBe('2024-01-01T00:00:00Z');
    });

    it('should return cached ledger when available', async () => {
      const cachedLedger = { id: '1', sequence: 123, closedAt: '2024-01-01' };
      mockDb.cacheGet.mockResolvedValue(cachedLedger);

      const result = await ledgerResolvers.Query.ledger(
        null,
        { sequence: 123 },
        { loaders: {} },
        {} as any
      );

      expect(result).toEqual(cachedLedger);
      expect(mockDb.queryOne).not.toHaveBeenCalled();
    });
  });
});
