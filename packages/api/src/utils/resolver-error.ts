/**
 * Consistent error formatting and logging utilities for GraphQL resolvers.
 *
 * Usage:
 *   import { withResolverLogging, ResolverError, NotFoundError, AuthError } from '../utils/resolver-error';
 *
 *   myResolver: withResolverLogging('Query.myResolver', async (parent, args, context) => {
 *     // resolver body — throw ResolverError subclasses for known error cases
 *   }),
 */

import { GraphQLError } from 'graphql';
import type winston from 'winston';

// ── Error codes ───────────────────────────────────────────────────────────────

export const ErrorCode = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_USER_INPUT: 'BAD_USER_INPUT',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── Typed error classes ───────────────────────────────────────────────────────

/**
 * Base class for all resolver-level errors.
 * Extends GraphQLError so Apollo Server serialises it correctly.
 */
export class ResolverError extends GraphQLError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    extensions?: Record<string, unknown>
  ) {
    super(message, {
      extensions: {
        code,
        timestamp: new Date().toISOString(),
        ...extensions,
      },
    });
    this.name = 'ResolverError';
  }
}

/** Resource could not be found (maps to NOT_FOUND). */
export class NotFoundError extends ResolverError {
  constructor(resource: string, identifier?: string | number) {
    const detail = identifier !== undefined ? ` (${identifier})` : '';
    super(`${resource}${detail} not found`, ErrorCode.NOT_FOUND);
    this.name = 'NotFoundError';
  }
}

/** Request requires authentication (maps to UNAUTHENTICATED). */
export class AuthError extends ResolverError {
  constructor(message = 'Authentication required') {
    super(message, ErrorCode.UNAUTHENTICATED);
    this.name = 'AuthError';
  }
}

/** Authenticated user lacks permission (maps to FORBIDDEN). */
export class ForbiddenError extends ResolverError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, ErrorCode.FORBIDDEN);
    this.name = 'ForbiddenError';
  }
}

/** Client supplied invalid input (maps to BAD_USER_INPUT). */
export class BadInputError extends ResolverError {
  constructor(message: string, field?: string) {
    super(message, ErrorCode.BAD_USER_INPUT, field ? { field } : undefined);
    this.name = 'BadInputError';
  }
}

// ── Logging helpers ───────────────────────────────────────────────────────────

/**
 * Classify an error for logging purposes.
 * Known resolver errors are "expected" and logged at warn level.
 * Everything else is an unexpected server error logged at error level.
 */
function classifyError(err: unknown): { level: 'warn' | 'error'; isOperational: boolean } {
  if (err instanceof ResolverError) {
    // Operational errors — expected, no stack trace needed
    return { level: 'warn', isOperational: true };
  }
  if (err instanceof GraphQLError) {
    // Validation / depth-limit errors from Apollo — expected
    return { level: 'warn', isOperational: true };
  }
  // Unexpected errors (DB failures, programming errors, etc.)
  return { level: 'error', isOperational: false };
}

/**
 * Format an error into a structured log payload.
 */
function formatErrorPayload(
  resolverName: string,
  err: unknown,
  args: unknown,
  userId?: string
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    resolver: resolverName,
    userId: userId ?? 'anonymous',
    args: sanitiseArgs(args),
  };

  if (err instanceof GraphQLError) {
    return {
      ...base,
      errorCode: err.extensions?.code ?? ErrorCode.INTERNAL_ERROR,
      message: err.message,
    };
  }

  if (err instanceof Error) {
    return {
      ...base,
      errorCode: ErrorCode.INTERNAL_ERROR,
      message: err.message,
      // Only include stack for unexpected errors — stripped in production by log level
      stack: err.stack,
    };
  }

  return {
    ...base,
    errorCode: ErrorCode.INTERNAL_ERROR,
    message: String(err),
  };
}

/**
 * Strip sensitive fields from resolver args before logging.
 */
function sanitiseArgs(args: unknown): unknown {
  if (!args || typeof args !== 'object') return args;
  const sensitive = new Set(['password', 'token', 'apiKey', 'api_key', 'secret']);
  return Object.fromEntries(
    Object.entries(args as Record<string, unknown>).map(([k, v]) => [
      k,
      sensitive.has(k) ? '[REDACTED]' : v,
    ])
  );
}

/**
 * Re-throw an unknown error as a ResolverError so the client always receives
 * a consistent GraphQL error shape. Internal details are hidden in production.
 */
function normaliseError(err: unknown): GraphQLError {
  if (err instanceof GraphQLError) return err;

  const isProduction = process.env.NODE_ENV === 'production';
  const message = isProduction
    ? 'An unexpected error occurred. Please try again later.'
    : err instanceof Error
    ? err.message
    : String(err);

  return new ResolverError(message, ErrorCode.INTERNAL_ERROR);
}

// ── withResolverLogging wrapper ───────────────────────────────────────────────

type ResolverFn<TParent, TArgs, TContext, TReturn> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: any
) => Promise<TReturn> | TReturn;

/**
 * Wraps a resolver function with:
 * - Structured error logging (warn for operational, error for unexpected)
 * - Consistent error normalisation (unknown errors → ResolverError)
 * - Performance timing logged at debug level
 *
 * @param resolverName  Human-readable name, e.g. "Query.ledgers"
 * @param fn            The resolver implementation
 */
export function withResolverLogging<TParent = any, TArgs = any, TContext extends { logger?: winston.Logger; user?: { id: string } | null } = any, TReturn = any>(
  resolverName: string,
  fn: ResolverFn<TParent, TArgs, TContext, TReturn>
): ResolverFn<TParent, TArgs, TContext, TReturn> {
  return async (parent, args, context, info) => {
    const start = Date.now();
    const userId = context.user?.id;

    try {
      const result = await fn(parent, args, context, info);

      const duration = Date.now() - start;
      context.logger?.debug('Resolver completed', {
        resolver: resolverName,
        userId: userId ?? 'anonymous',
        durationMs: duration,
      });

      return result;
    } catch (err: unknown) {
      const duration = Date.now() - start;
      const { level, isOperational } = classifyError(err);
      const payload = formatErrorPayload(resolverName, err, args, userId);

      if (level === 'error') {
        context.logger?.error('Resolver unexpected error', { ...payload, durationMs: duration });
      } else {
        context.logger?.warn('Resolver operational error', { ...payload, durationMs: duration });
      }

      // Re-throw operational errors as-is (already GraphQLErrors with correct codes)
      if (isOperational) throw err;

      // Normalise unexpected errors so clients never see raw DB/system messages
      throw normaliseError(err);
    }
  };
}
