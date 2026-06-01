typescript
// packages/indexer/src/database/connection.ts

/**
 * Production‑grade PostgreSQL connection pool with exhaustive error handling,
 * structured logging, automatic health checks, and graceful shutdown.
 *
 * @module DatabaseConnection
 */

import { Pool, PoolConfig, PoolClient, QueryResult, QueryConfig } from 'pg';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Logging utility (lightweight, no external dependencies)
// ---------------------------------------------------------------------------

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

interface LogEntry {
  level: string;
  timestamp: string;
  message: string;
  traceId?: string;
  [key: string]: unknown;
}

interface Logger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  fatal: (msg: string, meta?: Record<string, unknown>) => void;
  child: (meta: Record<string, unknown>) => Logger;
}

function resolveLogLevel(): LogLevel {
  const env = process.env.DB_LOG_LEVEL?.toLowerCase() ?? 'info';
  const mapping: Record<string, LogLevel> = {
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
    fatal: LogLevel.FATAL,
  };
  return mapping[env] ?? LogLevel.INFO;
}

function formatLogEntry(level: string, message: string, meta?: Record<string, unknown>): LogEntry {
  return {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...(meta && Object.keys(meta).length > 0 ? meta : {}),
  };
}

class ConsoleLogger implements Logger {
  private readonly minLevel: LogLevel;
  private readonly baseMeta: Record<string, unknown>;

  constructor(minLevel: LogLevel = resolveLogLevel(), baseMeta: Record<string, unknown> = {}) {
    this.minLevel = minLevel;
    this.baseMeta = baseMeta;
  }

  private log(level: LogLevel, levelName: string, msg: string, meta?: Record<string, unknown>): void {
    if (level < this.minLevel) {
      return;
    }
    const entry = formatLogEntry(levelName, msg, { ...this.baseMeta, ...meta });
    const output = JSON.stringify(entry);
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(output);
        break;
      case LogLevel.INFO:
        console.info(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        break;
      case LogLevel.ERROR:
        console.error(output);
        break;
      case LogLevel.FATAL:
        console.error(output);
        break;
    }
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, 'debug', msg, meta);
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, 'info', msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, 'warn', msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, 'error', msg, meta);
  }

  fatal(msg: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.FATAL, 'fatal', msg, meta);
  }

  child(meta: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.minLevel, { ...this.baseMeta, ...meta });
  }
}

const logger: Logger = new ConsoleLogger();

// ---------------------------------------------------------------------------
// Configuration types and defaults
// ---------------------------------------------------------------------------

export interface PoolSettings {
  min: number;
  max: number;
  idleTimeoutMillis: number;
  acquireTimeoutMillis: number;
  connectionTimeoutMillis: number;
  reapIntervalMillis: number;
}

export interface RetrySettings {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface DatabaseConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | { rejectUnauthorized: boolean; ca?: string };
  pool: PoolSettings;
  retry: RetrySettings;
  healthCheckIntervalMs: number;
}

export interface DatabasePoolStatus {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  max: number;
  healthy: boolean;
  lastChecked: Date;
}

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

export class DatabaseConnectionError extends Error {
  public readonly code: string;
  public readonly context: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'DatabaseConnectionError';
    this.code = code;
    this.context = context ?? {};
    Object.setPrototypeOf(this, DatabaseConnectionError.prototype);
  }
}

export class DatabasePoolExhaustedError extends DatabaseConnectionError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Connection pool exhausted. No idle connection available.',
      'POOL_EXHAUSTED',
      context,
    );
    this.name = 'DatabasePoolExhaustedError';
    Object.setPrototypeOf(this, DatabasePoolExhaustedError.prototype);
  }
}

export class DatabaseAcquireTimeoutError extends DatabaseConnectionError {
  constructor(timeoutMs: number, context?: Record<string, unknown>) {
    super(
      `Connection acquire timed out after ${timeoutMs}ms.`,
      'ACQUIRE_TIMEOUT',
      context,
    );
    this.name = 'DatabaseAcquireTimeoutError';
    Object.setPrototypeOf(this, DatabaseAcquireTimeoutError.prototype);
  }
}

export class DatabaseRetryExhaustedError extends DatabaseConnectionError {
  constructor(attempts: number, cause?: unknown) {
    super(
      `Failed to acquire connection after ${attempts} retry attempts.`,
      'RETRY_EXHAUSTED',
      { attempts, cause },
    );
    this.name = 'DatabaseRetryExhaustedError';
    Object.setPrototypeOf(this, DatabaseRetryExhaustedError.prototype);
  }
}

export class DatabaseHealthCheckError extends DatabaseConnectionError {
  constructor(cause?: unknown) {
    super('Health check query failed.', 'HEALTH_CHECK_FAILED', { cause });
    this.name = 'DatabaseHealthCheckError';
    Object.setPrototypeOf(this, DatabaseHealthCheckError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

function parseIntSafe(value: string | undefined | null, defaultVal: number): number {
  if (value == null || value.trim() === '') {
    return defaultVal;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) {
    logger.warn(`Invalid integer value "${value}", using default ${defaultVal}`);
    return defaultVal;
  }
  return parsed;
}

function parseBoolSafe(value: string | undefined | null, defaultVal: boolean): boolean {
  if (value == null) {
    return defaultVal;
  }
  const lower = value.trim().toLowerCase();
  if (lower === 'true' || lower === '1') {
    return true;
  }
  if (lower === 'false' || lower === '0') {
    return false;
  }
  logger.warn(`Invalid boolean value "${value}", using default ${defaultVal}`);
  return defaultVal;
}

function loadConfig(): DatabaseConnectionConfig {
  return {
    host: process.env.DB_HOST?.trim() || 'localhost',
    port: parseIntSafe(process.env.DB_PORT, 5432),
    database: process.env.DB_NAME?.trim() || 'indexer',
    user: process.env.DB_USER?.trim() || 'indexer',
    password: process.env.DB_PASSWORD || 'secret',
    ssl: process.env.DB_SSL
      ? parseBoolSafe(process.env.DB_SSL, false)
      : false,
    pool: {
      min: parseIntSafe(process.env.DB_POOL_MIN, 2),
      max: parseIntSafe(process.env.DB_POOL_MAX, 20),
      idleTimeoutMillis: parseIntSafe(process.env.DB_POOL_IDLE_TIMEOUT, 10000),
      acquireTimeoutMillis: parseIntSafe(process.env.DB_POOL_ACQUIRE_TIMEOUT, 5000),
      connectionTimeoutMillis: parseIntSafe(process.env.DB_CONNECTION_TIMEOUT, 2000),
      reapIntervalMillis: parseIntSafe(process.env.DB_POOL_REAP_INTERVAL, 1000),
    },
    retry: {
      maxAttempts: parseIntSafe(process.env.DB_RETRY_MAX_ATTEMPTS, 5),
      baseDelayMs: parseIntSafe(process.env.DB_RETRY_BASE_DELAY, 100),
      maxDelayMs: parseIntSafe(process.env.DB_RETRY_MAX_DELAY, 3000),
    },
    healthCheckIntervalMs: parseIntSafe(process.env.DB_HEALTH_CHECK_INTERVAL, 30000),
  };
}

function validateConfig(config: DatabaseConnectionConfig): void {
  const errors: string[] = [];

  if (config.port < 1 || config.port > 65535) {
    errors.push(`Invalid port: ${config.port}. Must be 1-65535.`);
  }
  if (!config.host) {
    errors.push('DB_HOST cannot be empty.');
  }
  if (!config.database) {
    errors.push('DB_NAME cannot be empty.');
  }
  if (!config.user) {
    errors.push('DB_USER cannot be empty.');
  }
  if (!config.password) {
    errors.push('DB_PASSWORD cannot be empty.');
  }
  if (config.pool.min < 0) {
    errors.push('Pool min must be >= 0.');
  }
  if (config.pool.max < 1) {
    errors.push('Pool max must be >= 1.');
  }
  if (config.pool.min > config.pool.max) {
    errors.push('Pool min cannot exceed pool max.');
  }
  if (config.pool.acquireTimeoutMillis < 0) {
    errors.push('Acquire timeout must be >= 0.');
  }
  if (config.retry.maxAttempts < 1) {
    errors.push('Retry maxAttempts must be >= 1.');
  }
  if (config.retry.baseDelayMs < 0) {
    errors.push('Retry baseDelayMs must be >= 0.');
  }
  if (config.retry.maxDelayMs < config.retry.baseDelayMs) {
    errors.push('Retry maxDelayMs must be >= baseDelayMs.');
  }
  if (config.healthCheckIntervalMs < 1000) {
    errors.push('Health check interval must be at least 1000ms.');
  }

  if (errors.length > 0) {
    const errorMsg = `Invalid database configuration:\n  - ${errors.join('\n  - ')}`;
    logger.error(errorMsg, { config });
    throw new DatabaseConnectionError(errorMsg, 'INVALID_CONFIG', { config, errors });
  }
}

// ---------------------------------------------------------------------------
// Retry helper with exponential backoff and jitter
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  const jitter = exponential * 0.2 * Math.random(); // ±20% jitter
  return Math.min(exponential + jitter, maxDelayMs);
}

// ---------------------------------------------------------------------------
// DatabasePool class
// ---------------------------------------------------------------------------

type PoolEvent = 'healthy' | 'unhealthy' | 'acquire' | 'release' | 'error' | 'shutdown';

export class DatabasePool extends EventEmitter {
  private pool: Pool;
  private readonly config: DatabaseConnectionConfig;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private healthy: boolean = false;
  private lastHealthCheck: Date = new Date(0);
  private isShuttingDown: boolean = false;
  private readonly poolLogger: Logger;

  constructor(config?: Partial<DatabaseConnectionConfig>) {
    super({ captureRejections: true });
    const fullConfig = loadConfig();
    if (config) {
      // Merge partial config with defaults – do not allow overriding via constructor if env var exists?
      // For security, we use env as authoritative; here we simply merge.
      Object.assign(fullConfig, config);
    }
    validateConfig(fullConfig);
    this.config = fullConfig;
    this.poolLogger = logger.child({ component: 'DatabasePool', poolId: randomUUID().slice(0, 8) });
    this.pool = this.createPool();
    this.initializePoolEvents();
    this.startHealthCheck();
    this.poolLogger.info('Database pool initialized', {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      poolMin: this.config.pool.min,
      poolMax: this.config.pool.max,
    });
  }

  // -----------------------------------------------------------------------
  // Pool creation
  // -----------------------------------------------------------------------

  private createPool(): Pool {
    const poolConfig: PoolConfig = {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl,
      min: this.config.pool.min,
      max: this.config.pool.max,
      idleTimeoutMillis: this.config.pool.idleTimeoutMillis,
      connectionTimeoutMillis: this.config.pool.connectionTimeoutMillis,
      reapIntervalMillis: this.config.pool.reapIntervalMillis,
      // Do not log connection strings to avoid secret exposure
      log: (...args: unknown[]) => this.poolLogger.debug('pg log', { args }),
    };
    return new Pool(poolConfig);
  }

  private initializePoolEvents(): void {
    this.pool.on('error', (err: Error, client: PoolClient) => {
      this.poolLogger.error('Pool error', {
        error: err.message,
        clientId: client.processID,
      });
      this.emit('error', err);
    });

    this.pool.on('acquire', (client: PoolClient) => {
      this.poolLogger.debug('Connection acquired', { clientId: client.processID });
      this.emit('acquire', client);
    });

    this.pool.on('release', (client: PoolClient) => {
      this.poolLogger.debug('Connection released', { clientId: client.processID });
      this.emit('release', client);
    });

    this.pool.on('remove', (client: PoolClient) => {
      this.poolLogger.debug('Connection removed from pool', { clientId: client.processID });
    });
  }

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  private async performHealthCheck(): Promise<void> {
    const traceId = randomUUID().slice(0, 8);
    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1 AS health');
        this.healthy = true;
        this.lastHealthCheck = new Date();
        this.poolLogger.debug('Health check passed', { traceId });
        if (!this.healthy) {
          this.emit('healthy');
        }
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      this.healthy = false;
      const error = err instanceof Error ? err : new Error(String(err));
      this.poolLogger.error('Health check failed', {
        traceId,
        error: error.message,
        healthy: this.healthy,
      });
      this.emit('unhealthy', error);
    }
  }

  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    // Perform immediate first check
    setImmediate(() => this.performHealthCheck());
    this.healthCheckTimer = setInterval(
      () => this.performHealthCheck(),
      this.config.healthCheckIntervalMs,
    );
    this.healthCheckTimer.unref();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Acquires a connection from the pool with retry and timeout.
   *
   * @param timeoutMs - optional override for acquire timeout
   * @returns PoolClient
   * @throws DatabaseAcquireTimeoutError, DatabaseRetryExhaustedError, DatabasePoolExhaustedError
   */
  async acquire(timeoutMs?: number): Promise<PoolClient> {
    if (this.isShuttingDown) {
      throw new DatabaseConnectionError(
        'Pool is shutting down, no new connections allowed.',
        'SHUTDOWN_IN_PROGRESS',
      );
    }

    const effectiveTimeout = timeoutMs ?? this.config.pool.acquireTimeoutMillis;
    const maxAttempts = this.config.retry.maxAttempts;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const client = await this.connectWithTimeout(effectiveTimeout);
        return client;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof DatabaseAcquireTimeoutError) {
          // Do not retry on timeout, as it's usually not recoverable without waiting
          throw err;
        }
        if (attempt < maxAttempts - 1) {
          const delayMs = calculateDelay(
            attempt,
            this.config.retry.baseDelayMs,
            this.config.retry.maxDelayMs,
          );
          this.poolLogger.warn('Connection acquire failed, retrying', {
            attempt: attempt + 1,
            delayMs,
            error: lastError.message,
          });
          await sleep(delayMs);
        }
      }
    }

    throw new DatabaseRetryExhaustedError(maxAttempts, lastError);
  }

  private connectWithTimeout(timeoutMs: number): Promise<PoolClient> {
    return new Promise<PoolClient>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new DatabaseAcquireTimeoutError(timeoutMs, {
            poolTotal: this.pool.totalCount,
            poolIdle: this.pool.idleCount,
            poolWaiting: this.pool.waitingCount,
          }),
        );
      }, timeoutMs);

      this.pool
        .connect()
        .then((client) => {
          clearTimeout(timeout);
          resolve(client);
        })
        .catch((err: unknown) => {
          clearTimeout(timeout);
          const error = err instanceof Error ? err : new Error(String(err));
          reject(
            new DatabaseConnectionError(
              `Failed to connect: ${error.message}`,
              'CONNECT_FAILED',
              { error: error.message },
            ),
          );
        });
    });
  }

  /**
   * Executes a query with automatic connection management.
   *
   * @param queryTextOrConfig - SQL string or QueryConfig object
   * @param values - optional parameter values
   * @returns QueryResult
   */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    queryTextOrConfig: string | QueryConfig,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    const client = await this.acquire();
    try {
      return await client.query<T>(queryTextOrConfig, values);
    } finally {
      client.release();
    }
  }

  /**
   * Provides current pool status.
   */
  getStatus(): DatabasePoolStatus {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      max: this.config.pool.max,
      healthy: this.healthy,
      lastChecked: this.lastHealthCheck,
    };
  }

  /**
   * Gracefully shuts down the pool, waiting for active connections to drain.
   * @param timeout - maximum milliseconds to wait for drain
   */
  async shutdown(timeout: number = 10000): Promise<void> {
    if (this.isShuttingDown) {
      this.poolLogger.warn('Shutdown already in progress');
      return;
    }
    this.isShuttingDown = true;
    this.poolLogger.info('Initiating pool shutdown');

    // Stop health checks
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    return new Promise<void>((resolve, reject) => {
      const forceTimeout = setTimeout(() => {
        this.poolLogger.warn('Pool drain timeout exceeded, forcefully ending pool');
        this.pool.end().then(resolve).catch(reject);
      }, timeout);

      this.pool
        .end()
        .then(() => {
          clearTimeout(forceTimeout);
          this.poolLogger.info('Pool gracefully shut down');
          this.emit('shutdown');
          resolve();
        })
        .catch((err: unknown) => {
          clearTimeout(forceTimeout);
          const error = err instanceof Error ? err : new Error(String(err));
          this.poolLogger.error('Error during pool shutdown', { error: error.message });
          reject(
            new DatabaseConnectionError(
              `Pool shutdown failed: ${error.message}`,
              'SHUTDOWN_ERROR',
              { error: error.message },
            ),
          );
        });
    });
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Replaces the underlying pool (e.g., after config change).
   * This is a destructive operation; all existing connections will be drained.
   */
  async recycle(newConfig?: Partial<DatabaseConnectionConfig>): Promise<void> {
    this.poolLogger.info('Recycling pool with new configuration');
    await this.shutdown(5000);
    if (newConfig) {
      Object.assign(this.config, newConfig);
      validateConfig(this.config);
    }
    this.pool = this.createPool();
    this.initializePoolEvents();
    this.startHealthCheck();
    this.isShuttingDown = false;
    this.poolLogger.info('Pool recycled successfully');
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let defaultPool: DatabasePool | null = null;

/**
 * Returns the default singleton database pool.
 * Creates it on first call.
 */
export function getDefaultPool(config?: Partial<DatabaseConnectionConfig>): DatabasePool {
  if (!defaultPool) {
    defaultPool = new DatabasePool(config);
  }
  return defaultPool;
}

/**
 * Resets the default pool (useful for testing or hot-reload).
 */
export function resetDefaultPool(): void {
  if (defaultPool) {
    defaultPool.shutdown().catch((err) => {
      logger.error('Error during default pool reset', { error: (err as Error).message });
    });
    defaultPool = null;
  }
}