/**
 * Retry configuration for Horizon API calls.
 *
 * Operators can tune retry behaviour via environment variables without
 * touching application code or rebuilding containers.
 *
 * | Env var                     | Default | Description                        |
 * |-----------------------------|---------|------------------------------------|
 * | `HORIZON_RETRY_MAX`         | 3       | Max retry attempts per request     |
 * | `HORIZON_RETRY_BASE_MS`     | 200     | Base delay in ms (doubles each try)|
 * | `HORIZON_RETRY_MAX_DELAY_MS`| 10_000  | Cap on single delay in ms          |
 * | `HORIZON_RETRY_JITTER`      | true    | Add random jitter to avoid thundering herd |
 */

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export type HorizonEndpoint =
  | 'root'
  | 'latest_ledger'
  | 'ledger'
  | 'ledgers'
  | 'transactions'
  | 'transaction'
  | 'operations'
  | 'account'
  | 'assets'
  | 'trades'
  | 'effects'
  | 'payments';

/** HTTP status codes considered _not_ worth retrying. */
const NON_RETRYABLE_STATUSES = new Set([
  400, // Bad Request – malformed syntax
  401, // Unauthorized – invalid credentials
  403, // Forbidden – no access
  404, // Not Found – resource doesn't exist
  405, // Method Not Allowed
  409, // Conflict – stale cursor / duplicate
  410, // Gone – resource removed
  413, // Payload Too Large
  422, // Unprocessable Entity – validation error
]);

/**
 * Determine whether an error is transient (worth retrying) or permanent.
 *
 * - Network / connection errors → transient
 * - 5xx server errors → transient
 * - 4xx client errors → permanent (except 429 Too Many Requests)
 * - 429 Too Many Requests → transient
 * - Everything else → permanent
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === 'fetch failed') {
    // Node.js 18+ throws TypeError for DNS / TCP failures
    return true;
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();

    // Network / connection errors
    if (
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      msg.includes('econnreset') ||
      msg.includes('network') ||
      msg.includes('socket') ||
      msg.includes('timeout') ||
      msg.includes('abort') ||
      msg.includes('dns')
    ) {
      return true;
    }
  }

  // Try to extract an HTTP status from the error
  const status = extractHttpStatus(err);
  if (status !== null) {
    // 429 – rate limited (transient)
    if (status === 429) return true;
    // Other 4xx – permanent
    if (status >= 400 && status < 500) return false;
    // 5xx – transient
    if (status >= 500) return true;
  }

  // Default to permanent for unknown errors
  return false;
}

/** Extract an HTTP status code from a variety of error shapes. */
function extractHttpStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;

  const e = err as Record<string, unknown>;

  // Stellar SDK errors often carry a `status` field
  if (typeof e.status === 'number') return e.status;
  if (typeof e.statusCode === 'number') return e.statusCode;
  if (typeof e.code === 'number') return e.code;

  // Axios-style errors
  if (e.response && typeof e.response === 'object') {
    const resp = e.response as Record<string, unknown>;
    if (typeof resp.status === 'number') return resp.status;
  }

  // Try to parse from message string
  if (typeof e.message === 'string') {
    const match = e.message.match(/\b(\d{3})\b/);
    if (match) return parseInt(match[1], 10);
  }

  return null;
}

/**
 * Calculate the next retry delay using exponential backoff with optional full
 * jitter.
 *
 * With jitter:
 *   delay = random(0, min(maxDelay, baseDelay * 2^attempt))
 *
 * Without jitter:
 *   delay = min(maxDelay, baseDelay * 2^attempt)
 */
export function calculateBackoffMs(
  attempt: number,
  config: RetryConfig,
): number {
  const exponential = config.baseDelayMs * 2 ** attempt;
  const capped = Math.min(exponential, config.maxDelayMs);

  if (!config.jitter) return capped;

  // Full jitter: random value between 0 and capped
  return Math.floor(Math.random() * (capped + 1));
}

// ---------------------------------------------------------------------------
// Read configuration from environment (once, then cache)
// ---------------------------------------------------------------------------

let _cachedConfig: RetryConfig | null = null;

function toPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function toBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const lower = raw.toLowerCase().trim();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  return fallback;
}

export function getRetryConfig(): RetryConfig {
  if (_cachedConfig) return _cachedConfig;

  _cachedConfig = {
    maxAttempts: toPositiveInt(process.env.HORIZON_RETRY_MAX, 3),
    baseDelayMs: toPositiveInt(process.env.HORIZON_RETRY_BASE_MS, 200),
    maxDelayMs: toPositiveInt(process.env.HORIZON_RETRY_MAX_DELAY_MS, 10_000),
    jitter: toBoolean(process.env.HORIZON_RETRY_JITTER, true),
  };

  return _cachedConfig;
}

/** Clear the cached config (useful in tests). */
export function resetRetryConfigCache(): void {
  _cachedConfig = null;
}
