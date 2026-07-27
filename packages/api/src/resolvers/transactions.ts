import { GraphQLResolveInfo } from 'graphql';
import { db, CACHE_TTL } from '../database/connection';
import { mapOperation, mapTransaction } from '../utils/mappers';
import type { ApiLoaders } from '../loaders';
import { ValidationService } from '../services/validation';
import { withResolverLogging, NotFoundError } from '../utils/resolver-error';
import { createConnection, PaginationArgs } from '../utils/pagination';
import { buildCacheKey, cachedQuery } from '../database/cached-query';
import { Connection } from '@stellar-analytics/shared';
import { buildOrderByClause, OrderByClause } from '../utils/sorting';

export interface ResolverContext {
  loaders: ApiLoaders;
}

const TRANSACTION_SORT_FIELDS = new Map<string, string>([
  ['createdAt', 'created_at'],
  ['feeCharged', 'fee_charged'],
  ['maxFee', 'max_fee'],
  ['operationCount', 'operation_count'],
  ['ledger', 'ledger_sequence'],
  ['successful', 'successful'],
]);

export const transactionResolvers = {
  Query: {
    transactions: withResolverLogging(
      'Query.transactions',
      async (
        parent: unknown,
        args: {
          pagination?: PaginationArgs;
          timeRange?: { startTime?: string; endTime?: string };
          filter?: {
            successful?: boolean;
            minFee?: number;
            maxFee?: number;
            hasMemo?: boolean;
            memoType?: string;
          };
          orderBy?: OrderByClause[];
        },
        context: ResolverContext,
        _info: GraphQLResolveInfo
      ): Promise<Connection<any>> => {
        ValidationService.validatePagination(args.pagination || {});
        if (args.timeRange) {
          ValidationService.validateTimeRange(args.timeRange);
        }
        if (args.filter) {
          ValidationService.validateTransactionFilter(args.filter);
        }

        const { startTime, endTime } = args.timeRange || {};
        const { successful, minFee, maxFee, hasMemo, memoType } = args.filter || {};

        const orderByClause = buildOrderByClause(
          args.orderBy,
          TRANSACTION_SORT_FIELDS,
          'ORDER BY created_at DESC'
        );

        const cacheKey = buildCacheKey('transactions', {
          startTime,
          endTime,
          successful,
          minFee,
          maxFee,
          hasMemo,
          memoType,
          orderBy: args.orderBy,
        });

        const transactions = await cachedQuery(cacheKey, CACHE_TTL.LEDGER_DATA, async () => {
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

          const query = `
            SELECT 
              id, paging_token, successful, hash, ledger_sequence, created_at,
              source_account, source_account_sequence, fee_account, fee_charged,
              max_fee, operation_count, envelope_xdr, result_xdr, result_meta_xdr,
              fee_meta_xdr, memo_type, memo, signatures, valid_after, valid_before,
              fee_bump_transaction, inner_transaction_hash, inner_transaction_signatures
            FROM transactions 
            ${whereClause}
            ${orderByClause}
          `;

          return db.query(query, params);
        });

        const result = transactions.map(mapTransaction);

        return createConnection(result, args.pagination || {}, (item) => item.paging_token);
      }
    ),

    transaction: withResolverLogging(
      'Query.transaction',
      async (
        parent: unknown,
        args: { hash: string },
        context: ResolverContext,
        _info: GraphQLResolveInfo
      ) => {
        const cacheKey = `transaction:${args.hash}`;

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

        if (!transaction) {
          throw new NotFoundError('Transaction', args.hash);
        }

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

        await db.cacheSet(cacheKey, result, CACHE_TTL.LEDGER_DATA);
        await db.incrementCacheMetric('transaction');
        return result;
      }
    ),
  },

  Transaction: {
    operations: withResolverLogging(
      'Transaction.operations',
      async (
        parent: { hash: string },
        _args: unknown,
        context: ResolverContext,
        _info: GraphQLResolveInfo
      ) => {
        const operations = await context.loaders.transactionOperationsLoader.load(parent.hash);
        return operations.map((op) => mapOperation(op));
      }
    ),
  },
};
