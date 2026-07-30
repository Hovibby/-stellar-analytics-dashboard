// Issue #174: Centralized logging correlation IDs
// Adds request and job correlation IDs across API, indexer, and frontend logs

import { randomUUID } from 'crypto';

const CORRELATION_ID_HEADER = 'x-correlation-id';
const CORRELATION_ID_LOG_KEY = 'correlationId';

/**
 * Generate a new correlation ID.
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Express middleware that attaches a correlation ID to each request.
 * If the incoming request has an x-correlation-id header, it's reused;
 * otherwise a new one is generated.
 */
export function correlationIdMiddleware() {
  return (req: any, res: any, next: any) => {
    const correlationId = req.headers[CORRELATION_ID_HEADER] || generateCorrelationId();
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    // Attach to response logging
    res.on('finish', () => {
      console.log(JSON.stringify({
        correlationId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - req.startTime,
      }));
    });

    req.startTime = Date.now();
    next();
  };
}

/**
 * Wrap a background job with a correlation ID for log tracing.
 */
export function withCorrelationId<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
  const correlationId = generateCorrelationId();
  console.log(JSON.stringify({ correlationId, job: jobName, status: 'started' }));
  return fn()
    .then(result => {
      console.log(JSON.stringify({ correlationId, job: jobName, status: 'completed' }));
      return result;
    })
    .catch(err => {
      console.error(JSON.stringify({ correlationId, job: jobName, status: 'failed', error: err.message }));
      throw err;
    });
}

export { CORRELATION_ID_HEADER, CORRELATION_ID_LOG_KEY };
