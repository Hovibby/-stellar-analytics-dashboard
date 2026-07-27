import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';

/**
 * Trace span representing a single operation within a traced request.
 * Tracks timing and metadata through schema -> resolver -> cache -> database layers.
 */
export interface TraceSpan {
  /** Unique span identifier */
  id: string;
  /** Parent span ID (null for root span) */
  parentId: string | null;
  /** Layer name: 'schema', 'resolver', 'cache', 'database' */
  layer: 'schema' | 'resolver' | 'cache' | 'database';
  /** Operation name (e.g. resolver name, query type) */
  operation: string;
  /** High-resolution start time */
  startTime: number;
  /** Duration in milliseconds (set when span ends) */
  durationMs: number;
  /** Additional metadata */
  metadata: Record<string, unknown>;
  /** Whether the span completed successfully */
  success: boolean;
  /** Error message if the span failed */
  error?: string;
}

/**
 * Trace context carrying a unique request ID and all spans for a single request.
 */
export interface TraceContext {
  /** Unique request identifier */
  requestId: string;
  /** All spans collected during this request */
  spans: TraceSpan[];
  /** Request start time (ms since epoch) */
  startTime: number;
  /** Optional user ID if authenticated */
  userId?: string;
  /** Optional operation name */
  operationName?: string;
}

const TRACE_HEADER = 'x-trace-id';
const TRACE_RESPONSE_HEADER = 'x-trace-id';

/**
 * Create a new trace context for a request.
 * Generates a unique request ID (or uses provided one) for distributed tracing.
 */
export function createTraceContext(
  requestId?: string,
  userId?: string,
  operationName?: string
): TraceContext {
  return {
    requestId: requestId || uuidv4(),
    spans: [],
    startTime: performance.now(),
    userId,
    operationName,
  };
}

/**
 * Start a new span within a trace context.
 * Tracks the start of an operation at a specific layer.
 *
 * @param context - The current trace context
 * @param layer - The layer being traced (schema, resolver, cache, database)
 * @param operation - Description of the operation
 * @param metadata - Additional metadata to attach to the span
 * @param parentId - Optional parent span ID
 * @returns The created span (in-progress, not yet ended)
 */
export function startSpan(
  context: TraceContext,
  layer: TraceSpan['layer'],
  operation: string,
  metadata: Record<string, unknown> = {},
  parentId?: string
): TraceSpan {
  const span: TraceSpan = {
    id: uuidv4(),
    parentId: parentId || null,
    layer,
    operation,
    startTime: performance.now(),
    durationMs: 0,
    metadata,
    success: true,
  };
  context.spans.push(span);
  return span;
}

/**
 * End a span, recording its duration and success/failure.
 *
 * @param span - The span to end
 * @param error - Optional error if the operation failed
 */
export function endSpan(span: TraceSpan, error?: Error): void {
  span.durationMs = Math.round((performance.now() - span.startTime) * 100) / 100;
  if (error) {
    span.success = false;
    span.error = error.message;
  }
}

/**
 * Wrap an async function with tracing, automatically creating and ending a span.
 *
 * @param context - The current trace context
 * @param layer - The layer being traced
 * @param operation - Description of the operation
 * @param fn - Async function to trace
 * @param metadata - Additional metadata
 * @returns The result of the wrapped function
 */
export async function trace<T>(
  context: TraceContext,
  layer: TraceSpan['layer'],
  operation: string,
  fn: () => Promise<T>,
  metadata: Record<string, unknown> = {}
): Promise<T> {
  const span = startSpan(context, layer, operation, metadata);
  try {
    const result = await fn();
    endSpan(span);
    return result;
  } catch (err) {
    endSpan(span, err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}

/**
 * Get the total duration of a traced request.
 */
export function getTraceDuration(context: TraceContext): number {
  return Math.round((performance.now() - context.startTime) * 100) / 100;
}

/**
 * Get a summary of all spans grouped by layer.
 */
export function getTraceSummary(context: TraceContext): Record<string, { count: number; totalDurationMs: number; errors: number }> {
  const summary: Record<string, { count: number; totalDurationMs: number; errors: number }> = {};
  for (const span of context.spans) {
    if (!summary[span.layer]) {
      summary[span.layer] = { count: 0, totalDurationMs: 0, errors: 0 };
    }
    summary[span.layer].count++;
    summary[span.layer].totalDurationMs += span.durationMs;
    if (!span.success) {
      summary[span.layer].errors++;
    }
  }
  return summary;
}

/**
 * Log the trace context to a winston logger.
 * Outputs structured log with request ID, total duration, and span breakdown.
 */
export function logTrace(context: TraceContext, logger: winston.Logger): void {
  const duration = getTraceDuration(context);
  const summary = getTraceSummary(context);
  const slowSpans = context.spans.filter((s) => s.durationMs > 500);

  logger.info('Request trace', {
    requestId: context.requestId,
    operationName: context.operationName || 'unknown',
    userId: context.userId || 'anonymous',
    totalDurationMs: duration,
    spanCount: context.spans.length,
    layerSummary: summary,
    slowSpans: slowSpans.map((s) => ({
      id: s.id,
      layer: s.layer,
      operation: s.operation,
      durationMs: s.durationMs,
    })),
  });
}

/**
 * Extract trace ID from request headers for distributed tracing.
 */
export function extractTraceId(headers: Record<string, string | string[] | undefined>): string | undefined {
  const header = headers[TRACE_HEADER];
  if (typeof header === 'string') return header;
  if (Array.isArray(header)) return header[0];
  return undefined;
}

/**
 * Get the trace response header name for propagating trace IDs.
 */
export function getTraceResponseHeader(): string {
  return TRACE_RESPONSE_HEADER;
}
