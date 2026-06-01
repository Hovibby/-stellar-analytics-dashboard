import { GraphQLResolveInfo } from 'graphql';
import { db, CACHE_TTL } from '../database/connection';
import { Connection, Edge, PageInfo } from '@stellar-analytics/shared';
import { mapLedger } from '../utils/mappers';
import type { ApiLoaders } from '../loaders';
import { ValidationService } from '../services/validation';

export const ledgerResolvers = {
  Query: {
    ledgers: async (
      parent: any,
      args: {
        pagination?: { first?: number; after?: string; last?: number; before?: string };
        timeRange?: { startTime?: string; endTime?: string };
      },
      context: any,
      info: GraphQLResolveInfo
    ): Promise<Connection> => {
      const { first = 20, after, before } = args.pagination || {};

      // Issue #31 – Validate pagination with comprehensive checks
      const { first: validFirst } = ValidationService.validatePaginationFull(
        args.pagination || {}
      );

      const { startTime, endTime } = args.timeRange || {};

      const cacheKey = `ledgers:${validFirst}:${after || 'none'}:${before || 'none'}:${startTime || 'all'}:${endTime || 'all'}`;

      // Try cache first
      const cached = await db.cacheGet(cacheKey);
      if (cached) {
        return cached;
      }

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

      // Handle cursor pagination
      let cursorClause = '';
      if (after) {
        cursorClause = ` AND sequence < $${paramIndex++}`;
        params.push(parseInt(after));
      } else if (before) {
        cursorClause = ` AND sequence > $${paramIndex++}`;
        params.push(parseInt(before));
      }

      const limit = Math.min(validFirst || 20, 100);
      const orderBy = after || !before ? 'ORDER BY sequence DESC' : 'ORDER BY sequence ASC';

      const query = `
        SELECT 
          id, sequence, successful_transaction_count, failed_transaction_count,
          operation_count, tx_set_operation_count, closed_at, total_coins,
          fee_pool, base_fee_in_stroops, base_reserve_in_stroops,
          max_tx_set_size, protocol_version, header_xdr, created_at, updated_at
        FROM ledgers 
        ${whereClause}
        ${cursorClause}
        ${orderBy}
        LIMIT $${paramIndex}
      `;
      params.push(limit);

      const ledgers = await db.query(query, params);

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM ledgers 
        ${whereClause}
      `;
      const countResult = await db.queryOne(countQuery, params.slice(0, -1));
      const totalCount = parseInt(countResult.total);

      // Create edges
      const edges: Edge[] = ledgers.map((ledger) => ({
        cursor: ledger.sequence.toString(),
        node: mapLedger(ledger),
      }));

      // Create page info
      const startCursor = edges.length > 0 ? edges[0].cursor : null;
      const endCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
      
      const hasNextPage = edges.length === limit;
      const hasPreviousPage = after ? true : false;

      const result = {
        edges,
        pageInfo: {
          hasNextPage,
          hasPreviousPage,
          startCursor,
          endCursor,
        },
        totalCount,
      };

      // Cache the result
      await db.cacheSet(cacheKey, result, CACHE_TTL.LEDGER_DATA);
      return result;
    },

    ledger: async (
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

      if (!ledgerData) return null;

      const result = {
        ...mapLedger(ledgerData)
      };

      // Cache the result
      await db.cacheSet(cacheKey, result, CACHE_TTL.LEDGER_DATA);
      return result;
    },
  },
};