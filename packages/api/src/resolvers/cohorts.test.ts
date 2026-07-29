import { cohortResolvers } from './cohorts';
import { db } from '../database/connection';

jest.mock('../database/connection', () => ({
  db: {
    query: jest.fn(),
    queryOne: jest.fn(),
    cacheGet: jest.fn(),
    cacheSet: jest.fn(),
  },
}));

const mockDb = db as jest.Mocked<typeof db>;

describe('Cohort Resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Query.accountCohorts', () => {
    it('should return default 4 cohorts with empty data', async () => {
      mockDb.queryOne
        .mockResolvedValueOnce({ account_count: '0', avg_tx_count: '0', total_volume: '0' })
        .mockResolvedValueOnce({ account_count: '0', avg_tx_count: '0', total_volume: '0' })
        .mockResolvedValueOnce({ account_count: '0', avg_tx_count: '0', total_volume: '0' })
        .mockResolvedValueOnce({ account_count: '0' }); // dormant accounts

      const result = await cohortResolvers.Query.accountCohorts(
        null,
        {},
        {},
        {} as any
      );

      expect(result).toHaveLength(4);
      expect(result[0].cohortId).toBe('high-activity');
      expect(result[1].cohortId).toBe('medium-activity');
      expect(result[2].cohortId).toBe('low-activity');
      expect(result[3].cohortId).toBe('dormant');
      expect(result[0].accountCount).toBe(0);
      expect(result[0].percentageOfTotal).toBe(0);
    });

    it('should return limited number of cohorts', async () => {
      mockDb.queryOne
        .mockResolvedValueOnce({ account_count: '50', avg_tx_count: '200', total_volume: '1000000' })
        .mockResolvedValueOnce({ account_count: '200', avg_tx_count: '30', total_volume: '500000' });

      const result = await cohortResolvers.Query.accountCohorts(
        null,
        { limit: 2 },
        {},
        {} as any
      );

      expect(result).toHaveLength(2);
      expect(result[0].cohortId).toBe('high-activity');
      expect(result[1].cohortId).toBe('medium-activity');
    });

    it('should include date range in each cohort', async () => {
      mockDb.queryOne
        .mockResolvedValueOnce({ account_count: '10', avg_tx_count: '150', total_volume: '500000' })
        .mockResolvedValueOnce({ account_count: '50', avg_tx_count: '25', total_volume: '200000' })
        .mockResolvedValueOnce({ account_count: '100', avg_tx_count: '3', total_volume: '50000' })
        .mockResolvedValueOnce({ account_count: '500' }); // dormant accounts

      const result = await cohortResolvers.Query.accountCohorts(
        null,
        { days: 30 },
        {},
        {} as any
      );

      expect(result).toHaveLength(4);
      for (const cohort of result) {
        expect(cohort.dateRange).toBeDefined();
        expect(cohort.dateRange.startDate).toBeDefined();
        expect(cohort.dateRange.endDate).toBeDefined();
      }
    });

    it('should calculate percentage of total correctly', async () => {
      mockDb.queryOne
        .mockResolvedValueOnce({ account_count: '100', avg_tx_count: '200', total_volume: '1000000' })
        .mockResolvedValueOnce({ account_count: '300', avg_tx_count: '30', total_volume: '500000' })
        .mockResolvedValueOnce({ account_count: '400', avg_tx_count: '3', total_volume: '100000' })
        .mockResolvedValueOnce({ account_count: '200' }); // only dormant accounts

      const result = await cohortResolvers.Query.accountCohorts(
        null,
        {},
        {},
        {} as any
      );

      // Total = 100 + 300 + 400 + 200 = 1000
      // High activity: 100/1000 = 10%
      // Medium activity: 300/1000 = 30%
      // Low activity: 400/1000 = 40%
      // Dormant: 200/1000 = 20%
      expect(result[0].percentageOfTotal).toBe(10);
      expect(result[1].percentageOfTotal).toBe(30);
      expect(result[2].percentageOfTotal).toBe(40);
      expect(result[3].percentageOfTotal).toBe(20);
    });

    it('should handle custom days parameter', async () => {
      mockDb.queryOne
        .mockResolvedValueOnce({ account_count: '50', avg_tx_count: '100', total_volume: '500000' })
        .mockResolvedValueOnce({ account_count: '150', avg_tx_count: '20', total_volume: '300000' })
        .mockResolvedValueOnce({ account_count: '300', avg_tx_count: '2', total_volume: '100000' })
        .mockResolvedValueOnce({ account_count: '100' }); // dormant accounts

      const result = await cohortResolvers.Query.accountCohorts(
        null,
        { days: 7 },
        {},
        {} as any
      );

      expect(result).toHaveLength(4);
      // Verify the query uses 7 days range
      const firstCall = (mockDb.queryOne as jest.Mock).mock.calls[0][1];
      const startDate = new Date(firstCall[0]);
      const endDate = new Date(firstCall[1]);
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(7);
    });

    it('should handle null query results gracefully', async () => {
      mockDb.queryOne.mockResolvedValue(null);

      const result = await cohortResolvers.Query.accountCohorts(
        null,
        {},
        {},
        {} as any
      );

      expect(result).toHaveLength(4);
      // All cohorts should have 0 accounts when results are null
      for (const cohort of result) {
        expect(cohort.accountCount).toBe(0);
        expect(cohort.averageTransactionCount).toBe(0);
        expect(cohort.totalVolume).toBe('0');
      }
    });
  });
});
