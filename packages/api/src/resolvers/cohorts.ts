import { GraphQLResolveInfo } from 'graphql';
import { db } from '../database/connection';
import type { TraceContext } from '../utils/tracer';

const COHORT_CONFIGS = [
  {
    cohortId: 'high-activity',
    label: 'High Activity',
    minTxCount: 100,
  },
  {
    cohortId: 'medium-activity',
    label: 'Medium Activity',
    minTxCount: 10,
  },
  {
    cohortId: 'low-activity',
    label: 'Low Activity',
    minTxCount: 1,
  },
  {
    cohortId: 'dormant',
    label: 'Dormant',
    minTxCount: 0,
  },
];

interface CohortResult {
  cohortId: string;
  label: string;
  accountCount: number;
  averageTransactionCount: number;
  totalVolume: string;
}

export const cohortResolvers = {
  Query: {
    accountCohorts: async (
      _parent: unknown,
      args: { limit?: number; days?: number },
      _context: { trace?: TraceContext },
      _info: GraphQLResolveInfo
    ) => {
      const days = args.days ?? 30;
      const limit = args.limit ?? 4;

      // Build per-cohort queries
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      const cohorts: CohortResult[] = [];

      for (const config of COHORT_CONFIGS.slice(0, limit)) {
        // Find the next threshold for upper-bound filtering
        const nextConfig = COHORT_CONFIGS.find(c => c.minTxCount > config.minTxCount);
        const upperBound = nextConfig?.minTxCount ?? 999999;

        const result = await db.queryOne<{
          account_count: string;
          avg_tx_count: string;
          total_volume: string;
        }>(
          `WITH account_activity AS (
            SELECT
              source_account,
              COUNT(*) AS tx_count,
              COALESCE(SUM(
                (SELECT COALESCE(SUM(CAST(details->>'amount' AS NUMERIC)), 0)
                 FROM operations o2
                 WHERE o2.transaction_hash = t.hash AND o2.type = 'payment')
              ), 0) AS volume
            FROM transactions t
            WHERE created_at >= $1 AND created_at <= $2
            GROUP BY source_account
          )
          SELECT
            COUNT(*) AS account_count,
            COALESCE(AVG(tx_count), 0) AS avg_tx_count,
            COALESCE(SUM(volume), 0)::text AS total_volume
          FROM account_activity
          WHERE tx_count >= $3
            ${config.cohortId !== 'dormant' ? 'AND tx_count < $4' : ''}`,
          config.cohortId !== 'dormant'
            ? [startDate.toISOString(), endDate.toISOString(), config.minTxCount, upperBound]
            : [startDate.toISOString(), endDate.toISOString(), config.minTxCount]
        );

        // Handle dormant cohort — only accounts with zero transactions in the period
        if (config.cohortId === 'dormant') {
          const dormantResult = await db.queryOne<{
            account_count: string;
          }>(
            `SELECT COUNT(*) AS account_count
             FROM accounts a
             WHERE NOT EXISTS (
               SELECT 1 FROM transactions t
               WHERE t.source_account = a.account_id
                 AND t.created_at >= $1 AND t.created_at <= $2
             )`,
            [startDate.toISOString(), endDate.toISOString()]
          );

          const dormantCount = parseInt(dormantResult?.account_count ?? '0', 10);

          cohorts.push({
            cohortId: config.cohortId,
            label: config.label,
            accountCount: dormantCount,
            averageTransactionCount: 0,
            totalVolume: '0',
          });
        } else if (result) {
          cohorts.push({
            cohortId: config.cohortId,
            label: config.label,
            accountCount: parseInt(result.account_count, 10),
            averageTransactionCount: parseFloat(result.avg_tx_count),
            totalVolume: result.total_volume,
          });
        } else {
          cohorts.push({
            cohortId: config.cohortId,
            label: config.label,
            accountCount: 0,
            averageTransactionCount: 0,
            totalVolume: '0',
          });
        }
      }

      // Calculate total accounts across all cohorts
      const totalAccounts = cohorts.reduce((sum, c) => sum + c.accountCount, 0);

      return cohorts.map((cohort) => ({
        ...cohort,
        percentageOfTotal: totalAccounts > 0
          ? Math.round((cohort.accountCount / totalAccounts) * 10000) / 100
          : 0,
        dateRange: {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
        },
      }));
    },
  },
};
