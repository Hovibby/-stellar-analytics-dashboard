import { GraphQLResolveInfo } from 'graphql';
import { db, CACHE_TTL } from '../database/connection';
import { Connection, PaginationArgs } from '@stellar-analytics/shared';
import { mapLedger } from '../utils/mappers';
import type { ApiLoaders } from '../loaders';
import { ValidationService } from '../services/validation';
import { withResolverLogging, NotFoundError } from '../utils/resolver-error';
import { createConnection } from '../utils/pagination';
import { buildCacheKey, cachedQuery } from '../database/cached-query';

export const ledgerResolvers = {
  Query: {
    ledgers: withResolverLogging(
      'Query.ledgers',
      async (
        parent: any,
        args: {
          pagination?: PaginationArgs;
          timeRange?: { startTime?: string; endTime?: string };
        },
        context: any,
        info: GraphQLResolveInfo
      ): Promise<Connection<any>> => {
        ValidationService.validatePagination(args.pagination || {});
        const { startTime, endTime } = args.timeRange || {};

        const cacheKey = buildCacheKey('ledgers', { startTime, endTime });

        const ledgers = await cachedQuery(cacheKey, CACHE_TTL.LEDGER_DATA, async () => {
          let whereClause = 'WHERE 1=1';
          const params: any[] = [];
          let paramIndex = 1;

          if (startTime) {
            whereClause += ` AND closed_at >= $${paramIndex++}`;
            params.push(startTime);
          }
          if (endTime) {
            whereClause += ` AND closed_at <= $${paramIndex++}`;
            params.push(endTime);
          }

          const query = `
            SELECT 
              id, sequence, successful_transaction_count, failed_transaction_count,
              operation_count, tx_set_operation_count, closed_at, total_coins,
              fee_pool, base_fee_in_stroops, base_reserve_in_stroops,
              max_tx_set_size, protocol_version, header_xdr, created_at, updated_at
            FROM ledgers 
            ${whereClause}
            ORDER BY sequence DESC
          `;

          return db.query(query, params);
        });

        const result = ledgers.map(mapLedger);

        return createConnection(result, args.pagination || {}, (item) => item.sequence.toString());
      }
    ),

    ledger: withResolverLogging(
      'Query.ledger',
      async (
        parent: unknown,
        args: { sequence: number },
        context: { loaders: ApiLoaders },
        _info: GraphQLResolveInfo
      ) => {
        const cacheKey = `ledger:${args.sequence}`;

        // Try cache first
        const cached = await db.cacheGet(cacheKey);
        if (cached) {
          return cached;
        }

        const ledgerData = await db.queryOne(
          `SELECT 
            id, sequence, successful_transaction_count, failed_transaction_count,
            operation_count, tx_set_operation_count, closed_at, total_coins,
            fee_pool, base_fee_in_stroops, base_reserve_in_stroops,
            max_tx_set_size, protocol_version, header_xdr, created_at, updated_at
          FROM ledgers WHERE sequence = $1`,
          [args.sequence]
        );

        if (!ledgerData) {
          throw new NotFoundError('Ledger', args.sequence);
        }

        const result = {
          ...mapLedger(ledgerData),
        };

        // Cache the result
        await db.cacheSet(cacheKey, result, CACHE_TTL.LEDGER_DATA);
        return result;
      }
    ),
  },
};
