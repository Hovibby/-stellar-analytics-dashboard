import { ledgerResolvers } from './ledgers';
import { transactionResolvers } from './transactions';
import { analyticsResolvers } from './analytics';
import { pubsub, EVENTS } from '../pubsub';
import { authService } from '../services/auth';
import { db } from '../database/connection';
import { ValidationService } from '../services/validation';

export const resolvers = {
  Query: {
    ...ledgerResolvers.Query,
    ...transactionResolvers.Query,
    ...analyticsResolvers.Query,
    me: async (_: any, __: any, context: any) => {
      if (!context.user) {
        return null;
      }
      return context.user;
    },
  },
  Mutation: {
    register: async (_: any, args: { input: unknown }) => {
      // Issue #125 – Validate mutation input with Zod before processing
      const { email, password, name } = ValidationService.validateRegisterInput(args.input);

      const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', [email]);
      if (existing) {
        throw new Error('User with this email already exists');
      }

      const hashedPassword = await authService.hashPassword(password);
      const apiKey = authService.generateApiKey();

      const user = await db.queryOne(
        `INSERT INTO users (email, password_hash, name, role, api_key, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id, email, name, role, api_key, created_at`,
        [email, hashedPassword, name, 'viewer', apiKey]
      );

      const token = authService.generateToken({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.created_at,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.created_at,
        },
        token,
      };
    },
    login: async (_: any, args: { input: unknown }) => {
      // Issue #125 – Validate mutation input with Zod before processing
      const { email, password } = ValidationService.validateLoginInput(args.input);

      const user = await db.queryOne(
        'SELECT id, email, password_hash, name, role, api_key, created_at FROM users WHERE email = $1',
        [email]
      );

      if (!user) {
        throw new Error('Invalid email or password');
      }

      const valid = await authService.verifyPassword(password, user.password_hash);
      if (!valid) {
        throw new Error('Invalid email or password');
      }

      const token = authService.generateToken({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.created_at,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.created_at,
        },
        token,
      };
    },
    generateApiKey: async (_: any, __: any, context: any) => {
      // Issue #125 – Authentication guard (no user-supplied input to validate here)
      if (!context.user) {
        throw new Error('Authentication required');
      }

      const apiKey = authService.generateApiKey();
      await db.query('UPDATE users SET api_key = $1 WHERE id = $2', [apiKey, context.user.id]);

      return {
        apiKey,
        user: context.user,
      };
    },
    revokeApiKey: async (_: any, __: any, context: any) => {
      // Issue #125 – Authentication guard (no user-supplied input to validate here)
      if (!context.user) {
        throw new Error('Authentication required');
      }

      await db.query('UPDATE users SET api_key = NULL WHERE id = $1', [context.user.id]);
      return true;
    },
  },
  Subscription: {
    ledgerAdded: {
      subscribe: () => pubsub.asyncIterator([EVENTS.LEDGER_ADDED]),
      resolve: (payload: any) => payload.ledgerAdded,
    },
    transactionAdded: {
      subscribe: () => pubsub.asyncIterator([EVENTS.TRANSACTION_ADDED]),
      resolve: (payload: any) => payload.transactionAdded,
    },
    operationAdded: {
      subscribe: () => pubsub.asyncIterator([EVENTS.OPERATION_ADDED]),
      resolve: (payload: any) => payload.operationAdded,
    },
    networkMetricsUpdated: {
      subscribe: () => pubsub.asyncIterator([EVENTS.NETWORK_METRICS_UPDATED]),
      resolve: (payload: any) => payload.networkMetricsUpdated,
    },
    transactionsForAccount: {
      subscribe: (_: any, { accountId }: { accountId: string }) =>
        pubsub.asyncIterator([`${EVENTS.TRANSACTION_ADDED}.${accountId}`]),
      resolve: (payload: any) => payload.transactionAdded,
    },
    operationsForAccount: {
      subscribe: (_: any, { accountId }: { accountId: string }) =>
        pubsub.asyncIterator([`${EVENTS.OPERATION_ADDED}.account.${accountId}`]),
      resolve: (payload: any) => payload.operationAdded,
    },
    operationsForType: {
      subscribe: (_: any, { type }: { type: string }) =>
        pubsub.asyncIterator([`${EVENTS.OPERATION_ADDED}.type.${type}`]),
      resolve: (payload: any) => payload.operationAdded,
    },
  },
  Transaction: transactionResolvers.Transaction,
};
