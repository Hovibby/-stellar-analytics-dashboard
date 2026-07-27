import { GraphQLResolveInfo } from 'graphql';
import { db, CACHE_TTL } from '../database/connection';
import { buildCacheKey, cachedQuery } from '../database/cached-query';
import { getStatsSummary } from '../services/stats-service';
import { ValidationService } from '../services/validation';
import { withResolverLogging } from '../utils/resolver-error';
import { createConnection, PaginationArgs } from '../utils/pagination';
import { Connection } from '@stellar-analytics/shared';

const NETWORK_METRICS_CACHE_TTL_SECONDS = Number(
  process.env.NETWORK_METRICS_CACHE_TTL_SECONDS ?? 30
);

export const analyticsResolvers = {
  Query: {
    networkMetrics: withResolverLogging(
      'Query.networkMetrics',
      async (
        parent: unknown,
        args: {
          timeRange?: { startTime?: string; endTime?: string };
        },
        _context: unknown,
        _info: GraphQLResolveInfo
      ) => {
        if (args.timeRange) {
          ValidationService.validateTimeRange(args.timeRange);
        }

        const { startTime, endTime } = args.timeRange || {};
        const cacheKey = buildCacheKey('network-metrics', { startTime, endTime });

        const metrics = await cachedQuery(cacheKey, NETWORK_METRICS_CACHE_TTL_SECONDS, async () => {
          let whereClause = 'WHERE 1=1';
          const params: unknown[] = [];
          let paramIndex = 1;

          if (startTime) {
            whereClause += ` AND timestamp >= $${paramIndex++}`;
            params.push(startTime);
          }
          if (endTime) {
            whereClause += ` AND timestamp <= $${paramIndex++}`;
            params.push(endTime);
          }

          return db.query(
            `
          SELECT 
            timestamp, ledger_count, transaction_count, operation_count,
            active_accounts, total_volume, average_fee, success_rate
          FROM network_metrics 
          ${whereClause}
          ORDER BY timestamp DESC
          LIMIT 1000
        `,
            params
          );
        });

        return metrics.map((metric) => ({
          timestamp: metric.timestamp,
          ledgerCount: metric.ledger_count,
          transactionCount: metric.transaction_count,
          operationCount: metric.operation_count,
          activeAccounts: metric.active_accounts,
          totalVolume: metric.total_volume,
          averageFee: parseFloat(metric.average_fee),
          successRate: parseFloat(metric.success_rate),
        }));
      }
    ),

    assetMetrics: withResolverLogging(
      'Query.assetMetrics',
      async (
        parent: unknown,
        args: {
          pagination?: PaginationArgs;
          filter?: {
            assetType?: string;
            assetCode?: string;
            assetIssuer?: string;
          };
          timeRange?: { startTime?: string; endTime?: string };
        },
        _context: unknown,
        _info: GraphQLResolveInfo
      ) => {
        if (args.pagination) {
          ValidationService.validatePagination(args.pagination);
        }
        if (args.filter) {
          ValidationService.validateAssetFilter(args.filter);
        }
        if (args.timeRange) {
          ValidationService.validateTimeRange(args.timeRange);
        }

        const { assetType, assetCode, assetIssuer } = args.filter || {};
        const { startTime, endTime } = args.timeRange || {};

        const cacheKey = buildCacheKey('asset-metrics', {
          assetType,
          assetCode,
          assetIssuer,
          startTime,
          endTime,
        });

        const assets = await cachedQuery(cacheKey, CACHE_TTL.ASSET_DATA, async () => {
          let whereClause = 'WHERE 1=1';
          const params: unknown[] = [];
          let paramIndex = 1;

          if (assetType) {
            whereClause += ` AND a.asset_type = $${paramIndex++}`;
            params.push(assetType);
          }
          if (assetCode) {
            whereClause += ` AND a.asset_code = $${paramIndex++}`;
            params.push(assetCode);
          }
          if (assetIssuer) {
            whereClause += ` AND a.asset_issuer = $${paramIndex++}`;
            params.push(assetIssuer);
          }
          if (startTime) {
            whereClause += ` AND am.timestamp >= $${paramIndex++}`;
            params.push(startTime);
          }
          if (endTime) {
            whereClause += ` AND am.timestamp <= $${paramIndex++}`;
            params.push(endTime);
          }

          const query = `
            SELECT DISTINCT ON (a.id)
              a.id, a.asset_type, a.asset_code, a.asset_issuer, a.native,
              am.volume_24h, am.volume_7d, am.volume_30d,
              am.trades_24h, am.trades_7d, am.trades_30d,
              am.price_change_24h, am.market_cap, am.holders
            FROM assets a
            LEFT JOIN LATERAL (
              SELECT volume_24h, volume_7d, volume_30d, trades_24h, trades_7d, trades_30d,
                     price_change_24h, market_cap, holders
              FROM asset_metrics
              WHERE asset_id = a.id
              ORDER BY timestamp DESC
              LIMIT 1
            ) am ON TRUE
            ${whereClause}
            ORDER BY a.id
          `;

          return db.query(query, params);
        });

        const result = assets.map((asset) => ({
          id: asset.id,
          asset: {
            assetType: asset.asset_type,
            assetCode: asset.asset_code,
            assetIssuer: asset.asset_issuer,
            native: asset.native,
          },
          volume24h: asset.volume_24h,
          volume7d: asset.volume_7d,
          volume30d: asset.volume_30d,
          trades24h: asset.trades_24h,
          trades7d: asset.trades_7d,
          trades30d: asset.trades_30d,
          priceChange24h: parseFloat(asset.price_change_24h ?? '0'),
          marketCap: asset.market_cap,
          holders: asset.holders,
        }));

        return createConnection(result, args.pagination || {}, (item) => item.id);
      }
    ),

    accountMetrics: withResolverLogging(
      'Query.accountMetrics',
      async (
        parent: unknown,
        args: {
          pagination?: PaginationArgs;
          accountId: string;
          timeRange?: { startTime?: string; endTime?: string };
        },
        _context: unknown,
        _info: GraphQLResolveInfo
      ): Promise<Connection<any>> => {
        ValidationService.validateAddress(args.accountId);
        if (args.pagination) {
          ValidationService.validatePagination(args.pagination);
        }
        if (args.timeRange) {
          ValidationService.validateTimeRange(args.timeRange);
        }

        const { accountId } = args;
        const { startTime, endTime } = args.timeRange || {};

        const cacheKey = buildCacheKey('account-metrics', { accountId, startTime, endTime });

        const metrics = await cachedQuery(cacheKey, CACHE_TTL.ACCOUNT_STATS, async () => {
          let whereClause = 'WHERE account_id = $1';
          const params: unknown[] = [accountId];
          let paramIndex = 2;

          if (startTime) {
            whereClause += ` AND timestamp >= $${paramIndex++}`;
            params.push(startTime);
          }
          if (endTime) {
            whereClause += ` AND timestamp <= $${paramIndex++}`;
            params.push(endTime);
          }

          return db.query(
            `
            SELECT 
              account_id, timestamp, balance_native, total_balance_usd,
              transaction_count_24h, transaction_count_7d, transaction_count_30d,
              first_transaction, last_transaction, is_active, trustlines, signers
            FROM account_metrics 
            ${whereClause}
            ORDER BY timestamp DESC
          `,
            params
          );
        });

        const result = metrics.map((metric) => ({
          accountId: metric.account_id,
          timestamp: metric.timestamp,
          balanceNative: metric.balance_native,
          totalBalanceUsd: metric.total_balance_usd,
          transactionCount24h: metric.transaction_count_24h,
          transactionCount7d: metric.transaction_count_7d,
          transactionCount30d: metric.transaction_count_30d,
          firstTransaction: metric.first_transaction,
          lastTransaction: metric.last_transaction,
          isActive: metric.is_active,
          trustlines: metric.trustlines,
          signers: metric.signers,
        }));

        return createConnection(result, args.pagination || {}, (item) =>
          item.timestamp.toISOString()
        );
      }
    ),

    stats: withResolverLogging(
      'Query.stats',
      async (parent: unknown, args: unknown, _context: unknown, _info: GraphQLResolveInfo) => {
        const cacheKey = 'stats-summary';
        return cachedQuery(cacheKey, CACHE_TTL.NETWORK_STATS, async () => {
          return getStatsSummary();
        });
      }
    ),
  },
};
