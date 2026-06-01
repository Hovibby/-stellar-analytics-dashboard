import { GraphQLResolveInfo } from 'graphql';
import { db, CACHE_TTL } from '../database/connection';
import { mapOperation, mapTransaction } from '../utils/mappers';
import type { ApiLoaders } from '../loaders';
import { ValidationService } from '../services/validation';

export interface ResolverContext {
  loaders: ApiLoaders;
}

export const transactionResolvers = {
  Query: {
    transactions: async (
      parent: unknown,
      args: {
        pagination?: { first?: number; after?: string; last?: number; before?: string };
        timeRange?: { startTime?: string; endTime?: string };
        filter?: {
          successful?: boolean;
          minFee?: number;
          maxFee?: number;
          hasMemo?: boolean;
          memoType?: string;
        };
      },
      context: ResolverContext,
      _info: GraphQLResolveInfo
    ) => {
      const { first = 20, after, before } = args.pagination || {};

      // Issue #31 – Validate pagination with comprehensive checks
      const { first: validFirst } = ValidationService.validatePaginationFull(
        args.pagination || {}
      );

      if (args.timeRange) {
        ValidationService.validateTimeRange(args.timeRange);
      }
      if (args.filter) {
        ValidationService.validateTransactionFilter(args.filter);
      }

      const { startTime, endTime } = args.timeRange || {};
      const { successful, minFee, maxFee, hasMemo, memoType } = args.filter || {};

      const cacheKey = `transactions:${validFirst}:${after || 'none'}:${before || 'none'}:${startTime || 'all'}:${endTime || 'all'}:${successful ?? 'all'}:${minFee ?? 'none'}:${maxFee ?? 'none'}`;

      // Try cache first
      const cached = await db.cacheGet(cacheKey);
      if (cached) {
        await db.incrementCacheMetric('transactions');
        return cached;
      }

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
      if (successful !== undefined) {
        whereClause += ` AND successful = $${paramIndex++}`;
        params.push(successful);
      }
      if (minFee) {
        whereClause += ` AND fee_charged >= $${paramIndex++}`;
        params.push(minFee);
      }
      if (maxFee) {
        whereClause += ` AND fee_charged <= $${paramIndex++}`;
        params.push(maxFee);
      }
      if (hasMemo !== undefined) {
        whereClause += ` AND memo_type ${hasMemo ? '!=' : '='} $${paramIndex++}`;
        params.push('none');
      }
      if (memoType) {
        whereClause += ` AND memo_type = $${paramIndex++}`;
        params.push(memoType);
      }

      let cursorClause = '';
      if (after) {
        cursorClause = ` AND created_at < $${paramIndex++}`;
        params.push(after);
      } else if (before) {
        cursorClause = ` AND created_at > $${paramIndex++}`;
        params.push(before);
      }

      const limit = Math.min(validFirst || 20, 100);
      const orderBy = after || !before ? 'ORDER BY created_at DESC' : 'ORDER BY created_at ASC';

      const query = `
        SELECT 
          id, paging_token, successful, hash, ledger_sequence, created_at,
          source_account, source_account_sequence, fee_account, fee_charged,
          max_fee, operation_count, envelope_xdr, result_xdr, result_meta_xdr,
          fee_meta_xdr, memo_type, memo, signatures, valid_after, valid_before,
          fee_bump_transaction, inner_transaction_hash, inner_transaction_signatures
        FROM transactions 
        ${whereClause}
        ${cursorClause}
        ${orderBy}
        LIMIT $${paramIndex}
      `;
      params.push(limit);

      const transactions = await db.query(query, params);

      const countQuery = `
        SELECT COUNT(*) as total
        FROM transactions 
        ${whereClause}
      `;
      const countResult = await db.queryOne<{ total: string }>(countQuery, params.slice(0, -1));
      const totalCount = parseInt(countResult?.total ?? '0', 10);

      const edges = transactions.map((tx) => ({
        cursor: tx.paging_token,
        node: mapTransaction(tx),
      }));

      const startCursor = edges.length > 0 ? edges[0].cursor : null;
      const endCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;

      const result = {
        edges,
        pageInfo: {
          hasNextPage: edges.length === limit,
          hasPreviousPage: Boolean(after),
          startCursor,
          endCursor,
        },
        totalCount,
      };

      // Cache the result
      await db.cacheSet(cacheKey, result, CACHE_TTL.LEDGER_DATA);
      await db.incrementCacheMetric('transactions');
      return result;
    },

    transaction: async (
      parent: unknown,
      args: { hash: string },
      context: ResolverContext,
      _info: GraphQLResolveInfo
    ) => {
      const cacheKey = `transaction:${args.hash}`;

      // Try cache first
      const cached = await db.cacheGet(cacheKey);
      if (cached) {
        await db.incrementCacheMetric('transaction');
        return cached;
      }

      const transaction = await db.queryOne(
        `SELECT 
          id, paging_token, successful, hash, ledger_sequence, created_at,
          source_account, source_account_sequence, fee_account, fee_charged,
          max_fee, operation_count, envelope_xdr, result_xdr, result_meta_xdr,
          fee_meta_xdr, memo_type, memo, signatures, valid_after, valid_before,
          fee_bump_transaction, inner_transaction_hash, inner_transaction_signatures
        FROM transactions WHERE hash = $1`,
        [args.hash]
      );

      if (!transaction) return null;

      const result = {
        ...transaction,
        createdAt: transaction.created_at,
        sourceAccount: transaction.source_account,
        sourceAccountSequence: transaction.source_account_sequence,
        feeAccount: transaction.fee_account,
        feeCharged: transaction.fee_charged,
        maxFee: transaction.max_fee,
        operationCount: transaction.operation_count,
        envelopeXdr: transaction.envelope_xdr,
        resultXdr: transaction.result_xdr,
        resultMetaXdr: transaction.result_meta_xdr,
        feeMetaXdr: transaction.fee_meta_xdr,
        memoType: transaction.memo_type,
        validAfter: transaction.valid_after,
        validBefore: transaction.valid_before,
        feeBumpTransaction: transaction.fee_bump_transaction,
        innerTransactionHash: transaction.inner_transaction_hash,
        innerTransactionSignatures: transaction.inner_transaction_signatures,
      };

      // Cache the result
      await db.cacheSet(cacheKey, result, CACHE_TTL.LEDGER_DATA);
      await db.incrementCacheMetric('transaction');
      return result;
    },
  },

  Transaction: {
    operations: async (
      parent: { hash: string },
      _args: unknown,
      context: ResolverContext,
      _info: GraphQLResolveInfo
    ) => {
      const operations = await context.loaders.transactionOperationsLoader.load(parent.hash);
      return operations.map((op) => mapOperation(op));
    },
  },
};