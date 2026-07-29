import { GraphQLResolveInfo } from 'graphql';
import { db, CACHE_TTL } from '../database/connection';
import { ValidationService } from '../services/validation';
import { getStatsSummary } from '../services/stats-service';
import { withResolverLogging } from '../utils/resolver-error';
import { buildCacheKey, cachedQuery } from '../database/cached-query';
import { Connection, PaginationArgs } from '@stellar-analytics/shared';
import { createConnection } from '../utils/pagination';
import { buildOrderByClause, OrderByClause } from '../utils/sorting';

const OPERATION_SORT_FIELDS = new Map<string, string>([
  ['id', 'id'],
  ['createdAt', 'created_at'],
]);

const ASSET_SORT_FIELDS = new Map<string, string>([
  ['assetCode', 'asset_code'],
]);

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

        return cachedQuery(cacheKey, CACHE_TTL.NETWORK_STATS, async () => {
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

          const rows = await db.query(
            `
            SELECT
              timestamp,
              ledger_count,
              transaction_count,
              operation_count,
              active_accounts,
              total_volume,
              average_fee,
              success_rate
            FROM network_metrics
            ${whereClause}
            ORDER BY timestamp ASC
          `,
            params
          );

          return rows.map((row) => ({
            timestamp: row.timestamp,
            ledgerCount: row.ledger_count,
            transactionCount: row.transaction_count,
            operationCount: row.operation_count,
            activeAccounts: row.active_accounts,
            totalVolume: row.total_volume,
            averageFee: parseFloat(row.average_fee),
            successRate: parseFloat(row.success_rate),
          }));
        });
      }
    ),

    // Issue #220: aggregation endpoints should return summary totals
    // alongside (or instead of) the raw list, not force every caller to
    // fetch and reduce the full point list client-side just to get a sum.
    networkMetricsSummary: withResolverLogging(
      'Query.networkMetricsSummary',
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
        const cacheKey = buildCacheKey('network-metrics-summary', { startTime, endTime });

        return cachedQuery(cacheKey, NETWORK_METRICS_CACHE_TTL_SECONDS, async () => {
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

          const row = await db.queryOne(
            `
            SELECT
              COUNT(*)::int AS data_point_count,
              COALESCE(SUM(ledger_count), 0)::int AS total_ledgers,
              COALESCE(SUM(transaction_count), 0)::int AS total_transactions,
              COALESCE(SUM(operation_count), 0)::int AS total_operations,
              COALESCE(SUM(total_volume), 0)::text AS total_volume,
              COALESCE(AVG(average_fee), 0) AS average_fee,
              COALESCE(AVG(success_rate), 0) AS average_success_rate,
              MIN(timestamp) AS earliest_timestamp,
              MAX(timestamp) AS latest_timestamp
            FROM network_metrics
            ${whereClause}
          `,
            params
          );

          return {
            dataPointCount: row?.data_point_count ?? 0,
            totalLedgers: row?.total_ledgers ?? 0,
            totalTransactions: row?.total_transactions ?? 0,
            totalOperations: row?.total_operations ?? 0,
            totalVolume: row?.total_volume ?? '0',
            averageFee: parseFloat(row?.average_fee ?? '0'),
            averageSuccessRate: parseFloat(row?.average_success_rate ?? '0'),
            earliestTimestamp: row?.earliest_timestamp ?? null,
            latestTimestamp: row?.latest_timestamp ?? null,
          };
        });
      }
    ),

    operations: withResolverLogging(
      'Query.operations',
      async (
        parent: unknown,
        args: {
          pagination?: PaginationArgs;
          timeRange?: { startTime?: string; endTime?: string };
          filter?: {
            type?: string;
            successful?: boolean;
            sourceAccount?: string;
          };
          orderBy?: OrderByClause[];
        },
        _context: unknown,
        _info: GraphQLResolveInfo
      ): Promise<Connection<any>> => {
        if (args.pagination) {
          ValidationService.validatePagination(args.pagination);
        }
        if (args.timeRange) {
          ValidationService.validateTimeRange(args.timeRange);
        }
        if (args.filter) {
          ValidationService.validateOperationFilter(args.filter);
        }

        const { startTime, endTime } = args.timeRange || {};
        const { type, successful, sourceAccount } = args.filter || {};

        const orderByClause = buildOrderByClause(
          args.orderBy,
          OPERATION_SORT_FIELDS,
          'ORDER BY created_at DESC'
        );

        const cacheKey = buildCacheKey('operations', {
          startTime,
          endTime,
          type,
          successful,
          sourceAccount,
          orderBy: args.orderBy,
        });

        const operations = await cachedQuery(cacheKey, CACHE_TTL.LEDGER_DATA, async () => {
          let whereClause = 'WHERE 1=1';
          const params: unknown[] = [];
          let paramIndex = 1;

          if (startTime) {
            whereClause += ` AND created_at >= $${paramIndex++}`;
            params.push(startTime);
          }
          if (endTime) {
            whereClause += ` AND created_at <= $${paramIndex++}`;
            params.push(endTime);
          }
          if (type) {
            whereClause += ` AND type = $${paramIndex++}`;
            params.push(type);
          }
          if (successful !== undefined) {
            whereClause += ` AND transaction_successful = $${paramIndex++}`;
            params.push(successful);
          }
          if (sourceAccount) {
            whereClause += ` AND source_account = $${paramIndex++}`;
            params.push(sourceAccount);
          }

          const query = `
            SELECT 
              id, paging_token, transaction_hash, transaction_successful,
              type, created_at, source_account, ledger_sequence, operation_index, details
            FROM operations 
            ${whereClause}
            ${orderByClause}
          `;

          return db.query(query, params);
        });

        const result = operations.map((op) => ({
          id: op.id,
          pagingToken: op.paging_token,
          transactionHash: op.transaction_hash,
          transactionSuccessful: op.transaction_successful,
          type: op.type,
          createdAt: op.created_at,
          sourceAccount: op.source_account,
          ledger: op.ledger_sequence,
          operationIndex: op.operation_index,
          details: op.details,
        }));

        return createConnection(result, args.pagination || {}, (item) => item.pagingToken);
      }
    ),

    operation: withResolverLogging(
      'Query.operation',
      async (
        parent: unknown,
        args: { id: string },
        _context: unknown,
        _info: GraphQLResolveInfo
      ) => {
        const operation = await db.queryOne(
          `SELECT 
            id, paging_token, transaction_hash, transaction_successful,
            type, created_at, source_account, ledger_sequence, operation_index, details
          FROM operations WHERE id = $1`,
          [args.id]
        );

        if (!operation) {
          throw new GraphQLError(`Operation ${args.id} not found`, {
            extensions: { code: 'NOT_FOUND' },
          });
        }

        return {
          id: operation.id,
          pagingToken: operation.paging_token,
          transactionHash: operation.transaction_hash,
          transactionSuccessful: operation.transaction_successful,
          type: operation.type,
          createdAt: operation.created_at,
          sourceAccount: operation.source_account,
          ledger: operation.ledger_sequence,
          operationIndex: operation.operation_index,
          details: operation.details,
        };
      }
    ),

    accounts: withResolverLogging(
      'Query.accounts',
      async (
        parent: unknown,
        args: {
          pagination?: PaginationArgs;
          filter?: {
            accountId?: string;
            minBalance?: string;
            maxBalance?: string;
            isActive?: boolean;
          };
          orderBy?: OrderByClause[];
        },
        _context: unknown,
        _info: GraphQLResolveInfo
      ): Promise<Connection<any>> => {
        if (args.pagination) {
          ValidationService.validatePagination(args.pagination);
        }
        if (args.filter) {
          ValidationService.validateAccountFilter(args.filter);
        }

        const { accountId, minBalance, maxBalance, isActive } = args.filter || {};

        const cacheKey = buildCacheKey('accounts', {
          accountId,
          minBalance,
          maxBalance,
          isActive,
          orderBy: args.orderBy,
        });

        const accounts = await cachedQuery(cacheKey, CACHE_TTL.ACCOUNT_STATS, async () => {
          let whereClause = 'WHERE 1=1';
          const params: unknown[] = [];
          let paramIndex = 1;

          if (accountId) {
            whereClause += ` AND account_id = $${paramIndex++}`;
            params.push(accountId);
          }
          if (minBalance) {
            whereClause += ` AND CAST(balance AS NUMERIC) >= $${paramIndex++}`;
            params.push(minBalance);
          }
          if (maxBalance) {
            whereClause += ` AND CAST(balance AS NUMERIC) <= $${paramIndex++}`;
            params.push(maxBalance);
          }
          if (isActive !== undefined) {
            whereClause += ` AND is_active = $${paramIndex++}`;
            params.push(isActive);
          }

          const orderByClause = buildOrderByClause(
            args.orderBy,
            new Map<string, string>([
              ['accountId', 'account_id'],
              ['balance', 'balance'],
              ['createdAt', 'created_at'],
              ['updatedAt', 'updated_at'],
            ]),
            'ORDER BY created_at DESC'
          );

          const query = `
            SELECT 
              account_id, balance, asset_type, asset_code, asset_issuer,
              buying_liabilities, selling_liabilities, last_modified_ledger,
              is_authorized, is_authorized_to_maintain_liabilities,
              is_clawback_enabled, sequence_number, num_subentries,
              thresholds, flags, signers, data, sponsor, num_sponsored,
              num_sponsoring, created_at, updated_at
            FROM accounts 
            ${whereClause}
            ${orderByClause}
          `;

          return db.query(query, params);
        });

        const result = accounts.map((acc) => ({
          accountId: acc.account_id,
          balance: acc.balance,
          assetType: acc.asset_type,
          assetCode: acc.asset_code,
          assetIssuer: acc.asset_issuer,
          buyingLiabilities: acc.buying_liabilities,
          sellingLiabilities: acc.selling_liabilities,
          lastModifiedLedger: acc.last_modified_ledger,
          isAuthorized: acc.is_authorized,
          isAuthorizedToMaintainLiabilities: acc.is_authorized_to_maintain_liabilities,
          isClawbackEnabled: acc.is_clawback_enabled,
          sequenceNumber: acc.sequence_number,
          numSubentries: acc.num_subentries,
          thresholds: acc.thresholds,
          flags: acc.flags,
          signers: acc.signers,
          data: acc.data,
          sponsor: acc.sponsor,
          numSponsored: acc.num_sponsored,
          numSponsoring: acc.num_sponsoring,
          createdAt: acc.created_at,
          updatedAt: acc.updated_at,
        }));

        return createConnection(result, args.pagination || {}, (item) => item.accountId);
      }
    ),

    account: withResolverLogging(
      'Query.account',
      async (
        parent: unknown,
        args: { accountId: string },
        _context: unknown,
        _info: GraphQLResolveInfo
      ) => {
        ValidationService.validateAddress(args.accountId);

        const account = await db.queryOne(
          `SELECT 
            account_id, balance, asset_type, asset_code, asset_issuer,
            buying_liabilities, selling_liabilities, last_modified_ledger,
            is_authorized, is_authorized_to_maintain_liabilities,
            is_clawback_enabled, sequence_number, num_subentries,
            thresholds, flags, signers, data, sponsor, num_sponsored,
            num_sponsoring, created_at, updated_at
          FROM accounts WHERE account_id = $1`,
          [args.accountId]
        );

        if (!account) {
          throw new GraphQLError(`Account ${args.accountId} not found`, {
            extensions: { code: 'NOT_FOUND' },
          });
        }

        return {
          accountId: account.account_id,
          balance: account.balance,
          assetType: account.asset_type,
          assetCode: account.asset_code,
          assetIssuer: account.asset_issuer,
          buyingLiabilities: account.buying_liabilities,
          sellingLiabilities: account.selling_liabilities,
          lastModifiedLedger: account.last_modified_ledger,
          isAuthorized: account.is_authorized,
          isAuthorizedToMaintainLiabilities: account.is_authorized_to_maintain_liabilities,
          isClawbackEnabled: account.is_clawback_enabled,
          sequenceNumber: account.sequence_number,
          numSubentries: account.num_subentries,
          thresholds: account.thresholds,
          flags: account.flags,
          signers: account.signers,
          data: account.data,
          sponsor: account.sponsor,
          numSponsored: account.num_sponsored,
          numSponsoring: account.num_sponsoring,
          createdAt: account.created_at,
          updatedAt: account.updated_at,
        };
      }
    ),

    assets: withResolverLogging(
      'Query.assets',
      async (
        parent: unknown,
        args: {
          pagination?: PaginationArgs;
          filter?: {
            assetType?: string;
            assetCode?: string;
            assetIssuer?: string;
          };
          orderBy?: OrderByClause[];
        },
        _context: unknown,
        _info: GraphQLResolveInfo
      ): Promise<Connection<any>> => {
        if (args.pagination) {
          ValidationService.validatePagination(args.pagination);
        }
        if (args.filter) {
          ValidationService.validateAssetFilter(args.filter);
        }

        const { assetType, assetCode, assetIssuer } = args.filter || {};

        const cacheKey = buildCacheKey('assets', {
          assetType,
          assetCode,
          assetIssuer,
          orderBy: args.orderBy,
        });

        const assets = await cachedQuery(cacheKey, CACHE_TTL.ASSET_DATA, async () => {
          let whereClause = 'WHERE 1=1';
          const params: unknown[] = [];
          let paramIndex = 1;

          if (assetType) {
            whereClause += ` AND asset_type = $${paramIndex++}`;
            params.push(assetType);
          }
          if (assetCode) {
            whereClause += ` AND asset_code = $${paramIndex++}`;
            params.push(assetCode);
          }
          if (assetIssuer) {
            whereClause += ` AND asset_issuer = $${paramIndex++}`;
            params.push(assetIssuer);
          }

          const orderByClause = buildOrderByClause(
            args.orderBy,
            new Map<string, string>([
              ['assetType', 'asset_type'],
              ['assetCode', 'asset_code'],
              ['assetIssuer', 'asset_issuer'],
              ['createdAt', 'created_at'],
            ]),
            'ORDER BY id'
          );

          const query = `
            SELECT id, asset_type, asset_code, asset_issuer, native
            FROM assets 
            ${whereClause}
            ${orderByClause}
          `;

          return db.query(query, params);
        });

        const result = assets.map((asset) => ({
          assetType: asset.asset_type,
          assetCode: asset.asset_code,
          assetIssuer: asset.asset_issuer,
          native: asset.native,
        }));

        return createConnection(result, args.pagination || {}, (item) => item.assetCode || item.assetType);
      }
    ),

    asset: withResolverLogging(
      'Query.asset',
      async (
        parent: unknown,
        args: { assetType: string; assetCode?: string; assetIssuer?: string },
        _context: unknown,
        _info: GraphQLResolveInfo
      ) => {
        let whereClause = 'WHERE asset_type = $1';
        const params: unknown[] = [args.assetType];
        let paramIndex = 2;

        if (args.assetCode) {
          whereClause += ` AND asset_code = $${paramIndex++}`;
          params.push(args.assetCode);
        }
        if (args.assetIssuer) {
          whereClause += ` AND asset_issuer = $${paramIndex++}`;
          params.push(args.assetIssuer);
        }

        const asset = await db.queryOne(
          `SELECT id, asset_type, asset_code, asset_issuer, native
          FROM assets ${whereClause}`,
          params
        );

        if (!asset) {
          throw new GraphQLError('Asset not found', {
            extensions: { code: 'NOT_FOUND' },
          });
        }

      const query = `
        SELECT DISTINCT ON (a.id)
          a.asset_type, a.asset_code, a.asset_issuer, a.native,
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
        LIMIT $${paramIndex}
      `;
      params.push(first);

      const assets = await db.query(query, params);

      const result = assets.map(asset => ({
        asset: {
          assetType: asset.asset_type,
          assetCode: asset.asset_code,
          assetIssuer: asset.asset_issuer,
          native: asset.native,
        };
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
          orderBy?: OrderByClause[];
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
          orderBy: args.orderBy,
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

          const orderByClause = buildOrderByClause(
            args.orderBy,
            ASSET_METRICS_SORT_FIELDS,
            'ORDER BY a.id'
          );

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
            ${orderByClause}
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

        // Issue #220: aggregates are computed over the FULL matching result
        // set (before pagination slicing), not just the current page.
        const aggregates = {
          totalVolume24h: result
            .reduce((sum, a) => sum + BigInt(a.volume24h || '0'), 0n)
            .toString(),
          totalTrades24h: result.reduce((sum, a) => sum + (a.trades24h || 0), 0),
          averagePriceChange24h:
            result.length === 0
              ? 0
              : result.reduce((sum, a) => sum + a.priceChange24h, 0) / result.length,
          totalHolders: result.reduce((sum, a) => sum + (a.holders || 0), 0),
        };

        return {
          ...createConnection(result, args.pagination || {}, (item) => item.id),
          aggregates,
        };
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
          orderBy?: OrderByClause[];
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

        const cacheKey = buildCacheKey('account-metrics', {
          accountId,
          startTime,
          endTime,
          orderBy: args.orderBy,
        });

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

          const orderByClause = buildOrderByClause(
            args.orderBy,
            ACCOUNT_METRICS_SORT_FIELDS,
            'ORDER BY timestamp DESC'
          );

          return db.query(
            `
            SELECT 
              account_id, timestamp, balance_native, total_balance_usd,
              transaction_count_24h, transaction_count_7d, transaction_count_30d,
              first_transaction, last_transaction, is_active, trustlines, signers
            FROM account_metrics 
            ${whereClause}
            ${orderByClause}
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

    // Issue #247: top N assets by 24h trading volume.
    topAssets: withResolverLogging(
      'Query.topAssets',
      async (
        parent: unknown,
        args: { limit?: number },
        _context: unknown,
        _info: GraphQLResolveInfo
      ) => {
        const limit = Math.min(Math.max(args.limit ?? 5, 1), 50);
        const cacheKey = buildCacheKey('top-assets', { limit });

        const assets = await cachedQuery(cacheKey, CACHE_TTL.ASSET_DATA, async () => {
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
            WHERE am.volume_24h IS NOT NULL
            ORDER BY a.id, am.volume_24h DESC
          `;
          const rows = await db.query(query, []);
          return rows
            .sort((a, b) => Number(b.volume_24h ?? 0) - Number(a.volume_24h ?? 0))
            .slice(0, limit);
        });

        return assets.map((asset) => ({
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
      }
    ),

    // Issue #247: top N accounts by 24h transaction activity.
    topAccounts: withResolverLogging(
      'Query.topAccounts',
      async (
        parent: unknown,
        args: { limit?: number },
        _context: unknown,
        _info: GraphQLResolveInfo
      ) => {
        const limit = Math.min(Math.max(args.limit ?? 5, 1), 50);
        const cacheKey = buildCacheKey('top-accounts', { limit });

        const accounts = await cachedQuery(cacheKey, CACHE_TTL.ACCOUNT_STATS, async () => {
          const query = `
            SELECT DISTINCT ON (account_id)
              account_id, timestamp, balance_native, total_balance_usd,
              transaction_count_24h, transaction_count_7d, transaction_count_30d,
              first_transaction, last_transaction, is_active, trustlines, signers
            FROM account_metrics
            ORDER BY account_id, timestamp DESC
          `;
          const rows = await db.query(query, []);
          return rows
            .sort(
              (a, b) =>
                Number(b.transaction_count_24h ?? 0) - Number(a.transaction_count_24h ?? 0)
            )
            .slice(0, limit);
        });

        return accounts.map((metric) => ({
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

    serviceStatus: withResolverLogging(
      'Query.serviceStatus',
      async () => {
        const apiStatus = 'healthy';
        let indexerStatus = 'healthy';
        try {
          const latestLedger = await db.queryOne<{ closed_at: string | Date }>(
            'SELECT closed_at FROM ledgers ORDER BY sequence DESC LIMIT 1'
          );
          if (!latestLedger) {
            indexerStatus = 'unhealthy';
          } else {
            const lastTime = new Date(latestLedger.closed_at).getTime();
            const timeDiffMs = Date.now() - lastTime;
            if (timeDiffMs > 60_000) { // 1 minute
              indexerStatus = 'stalled';
            }
          }
        } catch (error) {
          indexerStatus = 'unhealthy';
        }

        let dataSourceStatus = 'healthy';
        const horizonUrl = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const res = await fetch(horizonUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!res.ok) {
            dataSourceStatus = 'unhealthy';
          }
        } catch (error) {
          dataSourceStatus = 'unhealthy';
        }

        return {
          api: apiStatus,
          indexer: indexerStatus,
          dataSource: dataSourceStatus,
        };
      }
    ),

    exportData: withResolverLogging(
      'Query.exportData',
      async (
        parent: unknown,
        args: {
          entityType: string;
          filter?: { successful?: boolean; minFee?: number; maxFee?: number; hasMemo?: boolean; memoType?: string };
          timeRange?: { startTime?: string; endTime?: string };
          format?: string;
        },
        _context: unknown,
        _info: GraphQLResolveInfo
      ): Promise<string> => {
        const { entityType, filter, timeRange, format = 'json' } = args;

        if (!['transactions', 'ledgers', 'operations'].includes(entityType)) {
          throw new GraphQLError(`Unsupported entity type: "${entityType}". Must be transactions, ledgers, or operations.`, {
            extensions: { code: 'VALIDATION_ERROR' },
          });
        }

        if (!['json', 'csv'].includes(format)) {
          throw new GraphQLError(`Unsupported format: "${format}". Must be json or csv.`, {
            extensions: { code: 'VALIDATION_ERROR' },
          });
        }

        let whereClause = 'WHERE 1=1';
        const params: unknown[] = [];
        let paramIndex = 1;
        const { startTime, endTime } = timeRange || {};

        if (startTime) {
          whereClause += ` AND created_at >= $${paramIndex++}`;
          params.push(startTime);
        }
        if (endTime) {
          whereClause += ` AND created_at <= $${paramIndex++}`;
          params.push(endTime);
        }

        let query = '';

        switch (entityType) {
          case 'transactions':
            if (filter) {
              if (filter.successful !== undefined) {
                whereClause += ` AND successful = $${paramIndex++}`;
                params.push(filter.successful);
              }
              if (filter.minFee) {
                whereClause += ` AND fee_charged >= $${paramIndex++}`;
                params.push(filter.minFee);
              }
              if (filter.maxFee) {
                whereClause += ` AND fee_charged <= $${paramIndex++}`;
                params.push(filter.maxFee);
              }
            }
            query = `
              SELECT hash, ledger_sequence, successful, fee_charged, operation_count,
                     source_account, created_at, memo_type, memo
              FROM transactions ${whereClause}
              ORDER BY created_at DESC
              LIMIT 10000
            `;
            break;
          case 'ledgers':
            query = `
              SELECT sequence, successful_transaction_count, failed_transaction_count,
                     operation_count, closed_at, base_fee_in_stroops, protocol_version
              FROM ledgers ${whereClause}
              ORDER BY sequence DESC
              LIMIT 10000
            `;
            break;
          case 'operations':
            query = `
              SELECT id, transaction_hash, type, source_account, ledger_sequence,
                     operation_index, details, created_at
              FROM operations ${whereClause}
              ORDER BY created_at DESC
              LIMIT 10000
            `;
            break;
        }

        const rows = await db.query(query, params);

        if (format === 'csv') {
          if (rows.length === 0) return '';
          const headers = Object.keys(rows[0]);
          const csvLines = [headers.join(',')];
          for (const row of rows) {
            const values = headers.map((h) => {
              const val = row[h];
              const str = val === null || val === undefined ? '' : String(val);
              return str.includes(',') || str.includes('"') || str.includes('\n')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
            });
            csvLines.push(values.join(','));
          }
          return csvLines.join('\n');
        }

        return JSON.stringify(rows);
      }
    ),
  },
};
