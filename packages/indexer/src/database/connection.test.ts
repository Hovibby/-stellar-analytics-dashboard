typescript
// packages/indexer/src/database/connection.ts
import { Pool, PoolConfig, PoolClient } from 'pg';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Custom Error Types
// ---------------------------------------------------------------------------
export class PoolNotInitializedError extends Error {
  constructor(message = 'Pool is not initialized. Call createPool() first.') {
    super(message);
    this.name = 'PoolNotInitializedError';
  }
}

export class PoolCreationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PoolCreationError';
  }
}

export class PoolShutdownError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PoolShutdownError';
  }
}

export class PoolQueryError extends Error {
  constructor(
    message: string,
    public readonly query?: string,
    public readonly parameters?: unknown[],
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PoolQueryError';
  }
}

export class PoolConnectionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PoolConnectionError';
  }
}

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------
export interface PoolOptions {
  /** Maximum number of clients in the pool (1-1000) */
  max?: number;
  /** Close idle clients after this many milliseconds (>=100) */
  idleTimeoutMillis?: number;
  /** Wait for a connection for this many milliseconds (>=100) */
  connectionTimeoutMillis?: number;
  /** Allow the pool to exit when all clients are idle */
  allowExitOnIdle?: boolean;
  [key: string]: unknown;
}

export interface PoolStatus {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  max: number;
  utilizationPercent: number;
}

export interface PoolHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  max: number;
  lastError?: string;
  uptimeMs: number;
}

// Allowed keys for PoolOptions to prevent injection of unknown properties
const ALLOWED_POOL_OPTION_KEYS: ReadonlySet<string> = new Set([
  'max',
  'idleTimeoutMillis',
  'connectionTimeoutMillis',
  'allowExitOnIdle',
]);

// ---------------------------------------------------------------------------
// Logger (production grade – replace with a proper logging library if needed)
// ---------------------------------------------------------------------------
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
} as const;

type LogLevel = keyof typeof logLevels;

class Logger {
  private level: LogLevel = 'info';

  setLevel(level: LogLevel): void {
    if (!(level in logLevels)) {
      throw new Error(
        `Invalid log level: '${level}'. Must be one of ${Object.keys(logLevels).join(', ')}.`,
      );
    }
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return logLevels[level] <= logLevels[this.level];
  }

  private format(level: LogLevel, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [PoolManager] ${message}${metaStr}`;
  }

  error(message: string, meta?: unknown): void {
    if (this.shouldLog('error')) console.error(this.format('error', message, meta));
  }

  warn(message: string, meta?: unknown): void {
    if (this.shouldLog('warn')) console.warn(this.format('warn', message, meta));
  }

  info(message: string, meta?: unknown): void {
    if (this.shouldLog('info')) console.log(this.format('info', message, meta));
  }

  debug(message: string, meta?: unknown): void {
    if (this.shouldLog('debug')) console.log(this.format('debug', message, meta));
  }

  trace(message: string, meta?: unknown): void {
    if (this.shouldLog('trace')) console.log(this.format('trace', message, meta));
  }
}

const logger = new Logger();

// Configure from environment at startup
if (process.env.LOG_LEVEL) {
  try {
    logger.setLevel(process.env.LOG_LEVEL as LogLevel);
  } catch {
    logger.warn('Invalid LOG_LEVEL environment variable, using default "info"', {
      provided: process.env.LOG_LEVEL,
    });
  }
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------
const DEFAULT_POOL_CONFIG: Readonly<PoolConfig> = {
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  allowExitOnIdle: true,
};

/**
 * Reads environment variables for pool configuration and returns a sanitized partial config.
 * Skips invalid or out-of-range values with a warning.
 *
 * @returns A partial pool configuration derived from environment variables.
 */
function getEnvBasedConfig(): Partial<PoolConfig> {
  const config: Partial<PoolConfig> = {};

  const maxRaw = process.env.DB_POOL_MAX;
  if (maxRaw !== undefined) {
    const max = Number(maxRaw);
    if (Number.isInteger(max) && max > 0 && max <= 1000) {
      config.max = max;
    } else {
      logger.warn('Invalid DB_POOL_MAX value, using default', { provided: maxRaw });
    }
  }

  const idleRaw = process.env.DB_IDLE_TIMEOUT;
  if (idleRaw !== undefined) {
    const idle = Number(idleRaw);
    if (Number.isInteger(idle) && idle >= 100) {
      config.idleTimeoutMillis = idle;
    } else {
      logger.warn('Invalid DB_IDLE_TIMEOUT value, using default', { provided: idleRaw });
    }
  }

  const connRaw = process.env.DB_CONNECTION_TIMEOUT;
  if (connRaw !== undefined) {
    const conn = Number(connRaw);
    if (Number.isInteger(conn) && conn >= 100) {
      config.connectionTimeoutMillis = conn;
    } else {
      logger.warn('Invalid DB_CONNECTION_TIMEOUT value, using default', { provided: connRaw });
    }
  }

  return config;
}

/**
 * Builds a validated PoolConfig by merging defaults, environment variables, and user options.
 * User options take highest precedence. Final safety clamps ensure values stay within range.
 *
 * @param options - Optional manual overrides for pool configuration.
 * @returns A fully resolved PoolConfig.
 * @throws {PoolCreationError} If configuration is invalid after clamping.
 */
function buildPoolConfig(options?: PoolOptions): PoolConfig {
  // Validate user-provided options to prevent unknown property injection
  if (options) {
    for (const key of Object.keys(options)) {
      if (!ALLOWED_POOL_OPTION_KEYS.has(key)) {
        logger.warn('Unexpected option key in PoolOptions, ignoring', { key });
        delete (options as Record<string, unknown>)[key];
      }
    }
  }

  const envConfig = getEnvBasedConfig();
  const merged: PoolConfig = {
    ...DEFAULT_POOL_CONFIG,
    ...envConfig,
    ...(options as PoolConfig),
  };

  // Clamp critical values
  if (merged.max !== undefined) {
    if (merged.max < 1 || merged.max > 1000) {
      logger.warn('Pool max out of range, reset to default', { attempted: merged.max });
      merged.max = DEFAULT_POOL_CONFIG.max;
    } else if (!Number.isInteger(merged.max)) {
      logger.warn('Pool max is not an integer, reset to default', { attempted: merged.max });
      merged.max = DEFAULT_POOL_CONFIG.max;
    }
  }

  if (merged.idleTimeoutMillis !== undefined) {
    if (merged.idleTimeoutMillis < 100) {
      logger.warn('idleTimeoutMillis too low, reset to default', {
        attempted: merged.idleTimeoutMillis,
      });
      merged.idleTimeoutMillis = DEFAULT_POOL_CONFIG.idleTimeoutMillis;
    } else if (!Number.isInteger(merged.idleTimeoutMillis)) {
      logger.warn('idleTimeoutMillis is not an integer, reset to default', {
        attempted: merged.idleTimeoutMillis,
      });
      merged.idleTimeoutMillis = DEFAULT_POOL_CONFIG.idleTimeoutMillis;
    }
  }

  if (merged.connectionTimeoutMillis !== undefined) {
    if (merged.connectionTimeoutMillis < 100) {
      logger.warn('connectionTimeoutMillis too low, reset to default', {
        attempted: merged.connectionTimeoutMillis,
      });
      merged.connectionTimeoutMillis = DEFAULT_POOL_CONFIG.connectionTimeoutMillis;
    } else if (!Number.isInteger(merged.connectionTimeoutMillis)) {
      logger.warn('connectionTimeoutMillis is not an integer, reset to default', {
        attempted: merged.connectionTimeoutMillis,
      });
      merged.connectionTimeoutMillis = DEFAULT_POOL_CONFIG.connectionTimeoutMillis;
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// PoolManager
// ---------------------------------------------------------------------------
/**
 * Manages a PostgreSQL connection pool with lifecycle control, health monitoring,
 * and graceful shutdown.
 *
 * @example
 *