typescript
import {
  Pool,
  PoolClient,
  QueryResult,
  QueryResultRow,
} from 'pg';
import { Logger } from 'pino';
import { createLogger } from '../utils/logger';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TUNING = {
  max: 20,
  min: 2,
  idleTimeoutMillis: 30000,
  acquireTimeoutMillis: 10000,
  createTimeoutMillis: 5000,
  destroyTimeoutMillis: 5000,
  reapIntervalMillis: 1000,
  maxUses: 7500,
  statementTimeout: 30000,
  queryTimeout: 30000,
} as const;

const ENV_META: Record<keyof PoolTuningConfig, { default: number; min: number; max: number }> = {
  max: { default: 20, min: 1, max: 500 },
  min: { default: 2, min: 0, max: 100 },
  idleTimeoutMillis: { default: 30000, min: 1000, max: 600000 },
  acquireTimeoutMillis: { default: 10000, min: 1000, max: 120000 },
  createTimeoutMillis: { default: 5000, min: 1000, max: 60000 },
  destroyTimeoutMillis: { default: 5000, min: 1000, max: 60000 },
  reapIntervalMillis: { default: 1000, min: 100, max: 60000 },
  maxUses: { default: 7500, min: 1, max: 100000 },
  statementTimeout: { default: 30000, min: 0, max: 600000 },
  queryTimeout: { default: 30000, min: 0, max: 600000 },
};

const ENV_PREFIX = 'PGPOOL_';
const DEFAULT_DATABASE_URL = 'postgresql://localhost:5432/indexer';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger: Logger = createLogger('database:connection');

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

export class PoolInitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoolInitializationError';
  }
}

export class PoolNotInitializedError extends Error {
  constructor() {
    super('Connection pool has not been initialized. Call init() first.');
    this.name = 'PoolNotInitializedError';
  }
}

export class PoolQueryError extends Error {
  public readonly queryText: string;
  public readonly params?: unknown[];

  constructor(message: string, queryText: string, params?: unknown[]) {
    super(message);
    this.name = 'PoolQueryError';
    this.queryText = queryText;
    this.params = params;
  }
}

// ---------------------------------------------------------------------------
// Interfaces & types
// ---------------------------------------------------------------------------

/** Pool tuning configuration (all parameters are immutable after construction). */
export interface PoolTuningConfig {
  readonly max: number;
  readonly min: number;
  readonly idleTimeoutMillis: number;
  readonly acquireTimeoutMillis: number;
  readonly createTimeoutMillis: number;
  readonly destroyTimeoutMillis: number;
  readonly reapIntervalMillis: number;
  readonly maxUses: number;
  readonly statementTimeout: number;
  readonly queryTimeout: number;
}

/** Snapshot of pool health metrics. */
export interface PoolHealth {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  acquiringCount: number;
  isReady: boolean;
}

// ---------------------------------------------------------------------------
// Prometheus metrics (singleton instances)
// ---------------------------------------------------------------------------

const register = new Registry();
collectDefaultMetrics({ register });

const poolTotalGauge = new Gauge({
  name: 'pg_pool_total_connections',
  help: 'Total number of connections in the pool (idle + active).',
  registers: [register],
});

const poolIdleGauge = new Gauge({
  name: 'pg_pool_idle_connections',
  help: 'Number of idle connections in the pool.',
  registers: [register],
});

const poolWaitingGauge = new Gauge({
  name: 'pg_pool_waiting_requests',
  help: 'Number of requests waiting for a connection.',
  registers: [register],
});

const poolAcquireHistogram = new Histogram({
  name: 'pg_pool_acquire_seconds',
  help: 'Time taken to acquire a connection from the pool (seconds).',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

const poolQueryHistogram = new Histogram({
  name: 'pg_pool_query_seconds',
  help: 'Time taken to execute a query (seconds).',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

const poolErrorCounter = new Counter({
  name: 'pg_pool_errors_total',
  help: 'Total number of pool errors, labeled by type.',
  labelNames: ['error_type'] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

/**
 * Parses a numeric environment variable with range validation.
 * @param key - Full environment variable name.
 * @param meta - Metadata including default, min, and max constraints.
 * @returns The parsed integer, or the default if the variable is unset/empty.
 * @throws {PoolInitializationError} if the value is present but invalid.
 */
function parseEnvNumber(key: string, meta: { default: number; min: number; max: number }): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return meta.default;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || !Number.isInteger(parsed)) {
    throw new PoolInitializationError(
      `Environment variable ${key} must be an integer, got "${raw}"`,
    );
  }
  if (parsed < meta.min || parsed > meta.max) {
    throw new PoolInitializationError(
      `Environment variable ${key} must be between ${meta.min} and ${meta.max}, got ${parsed}`,
    );
  }
  return parsed;
}

/**
 * Reads the DATABASE_URL from environment and validates the scheme.
 * @returns A validated connection string.
 * @throws {PoolInitializationError} if the URL is invalid.
 */
function parseDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new PoolInitializationError(
      `DATABASE_URL must start with postgresql:// or postgres://, got invalid prefix`,
    );
  }
  return url;
}

/**
 * Loads the pool tuning configuration from environment variables using
 * predefined metadata and defaults.
 * @returns A validated {@link PoolTuningConfig} object.
 */
function loadTuningFromEnv(): PoolTuningConfig {
  return {
    max: parseEnvNumber(`${ENV_PREFIX}MAX`, ENV_META.max),
    min: parseEnvNumber(`${ENV_PREFIX}MIN`, ENV_META.min),
    idleTimeoutMillis: parseEnvNumber(`${ENV_PREFIX}IDLE_TIMEOUT`, ENV_META.idleTimeoutMillis),
    acquireTimeoutMillis: parseEnvNumber(`${ENV_PREFIX}ACQUIRE_TIMEOUT`, ENV_META.acquireTimeoutMillis),
    createTimeoutMillis: parseEnvNumber(`${ENV_PREFIX}CREATE_TIMEOUT`, ENV_META.createTimeoutMillis),
    destroyTimeoutMillis: parseEnvNumber(`${ENV_PREFIX}DESTROY_TIMEOUT`, ENV_META.destroyTimeoutMillis),
    reapIntervalMillis: parseEnvNumber(`${ENV_PREFIX}REAP_INTERVAL`, ENV_META.reapIntervalMillis),
    maxUses: parseEnvNumber(`${ENV_PREFIX}MAX_USES`, ENV_META.maxUses),
    statementTimeout: parseEnvNumber(`${ENV_PREFIX}STATEMENT_TIMEOUT`, ENV_META.statementTimeout),
    queryTimeout: parseEnvNumber(`${ENV_PREFIX}QUERY_TIMEOUT`, ENV_META.queryTimeout),
  };
}

// ---------------------------------------------------------------------------
// PoolManager class
// ---------------------------------------------------------------------------

/**
 * Singleton manager for PostgreSQL connection pool with production-grade
 * tuning, monitoring, and graceful lifecycle management.
 */
export class PoolManager {
  private static instance: PoolManager;

  private pool: Pool | null = null;
  private tuning: PoolTuningConfig;
  private readonly connectionString: string;
  private initialized = false;

  // -------------------------------------------------------------------------
  // Constructor (private – use getInstance)
  // -------------------------------------------------------------------------

  private constructor() {
    this.tuning = loadTuningFromEnv();
    this.connectionString = parseDatabaseUrl();

    logger.info(
      {
        tuning: { ...this.tuning, connectionString: '***' }, // redact connection string
      },
      'PoolManager configuration loaded',
    );
  }

  // -------------------------------------------------------------------------
  // Singleton access
  // -------------------------------------------------------------------------

  /**
   * Returns the singleton PoolManager instance (lazy creation).
   */
  public static getInstance(): PoolManager {
    if (!PoolManager.instance) {
      PoolManager.instance = new PoolManager();
    }
    return PoolManager.instance;
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /**
   * Initializes the underlying PostgreSQL connection pool using the loaded
   * tuning configuration. This method is idempotent – it will not re-create
   * the pool if already initialized.
   *
   * @throws {PoolInitializationError} if the pool fails to create.
   */
  public init(): void {
    if (this.initialized) {
      logger.warn('PoolManager.init() called but pool is already initialized');
      return;
    }

    try {
      const poolConfig = this.buildPoolConfig();
      this.pool = new Pool(poolConfig);

      // Attach event listeners for monitoring
      this.pool.on('connect', (client: PoolClient) => {
        logger.debug({ pid: client.processID }, 'New client connected to pool');
      });

      this.pool.on('acquire', (client: PoolClient) => {
        logger.trace({ pid: client.processID }, 'Client acquired from pool');
      });

      this.pool.on('remove', (client: PoolClient) => {
        logger.debug({ pid: client.processID }, 'Client removed from pool');
      });

      this.pool.on('error', (err: Error, client: PoolClient | undefined) => {
        logger.error({ err, pid: client?.processID }, 'Unhandled pool error');
        poolErrorCounter.inc({ error_type: 'unhandled_pool_error' });
      });

      this.initialized = true;
      logger.info('Connection pool initialized successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error }, 'Failed to initialize connection pool');
      poolErrorCounter.inc({ error_type: 'initialization_failure' });
      throw new PoolInitializationError(`Pool initialization failed: ${message}`);
    }
  }

  /**
   * Builds the pg.PoolConfig from the internal tuning and connection string.
   * Redacts sensitive fields from logs.
   *
   * @returns A validated PoolConfig object.
   */
  private buildPoolConfig(): import('pg').PoolConfig {
    return {
      connectionString: this.connectionString,
      max: this.tuning.max,
      min: this.tuning.min,
      idleTimeoutMillis: this.tuning.idleTimeoutMillis,
      acquireTimeoutMillis: this.tuning.acquireTimeoutMillis,
      createTimeoutMillis: this.tuning.createTimeoutMillis,
      destroyTimeoutMillis: this.tuning.destroyTimeoutMillis,
      reapIntervalMillis: this.tuning.reapIntervalMillis,
      maxUses: this.tuning.maxUses,
      statementTimeout: this.tuning.statementTimeout,
      queryTimeout: this.tuning.queryTimeout,
      // Ensure SSL support if connection string demands it
      ssl: this.connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------

  /**
   * Executes a single SQL query against the pool.
   *
   * @typeParam T - Row type (defaults to `any` for flexibility).
   * @param text - The SQL query string (use $1, $2 etc. placeholders).
   * @param params - Optional array of parameter values.
   * @returns A Promise resolving to the query result.
   * @throws {PoolNotInitializedError} if the pool is not yet initialized.
   * @throws {PoolQueryError} if the query execution fails.
   */
  public async query<T extends QueryResultRow = any>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    this.ensureInitialized();

    const endAcquire = poolAcquireHistogram.startTimer();
    let client: PoolClient;

    try {
      client = await this.pool!.connect();
      endAcquire();
    } catch (error) {
      endAcquire();
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, queryText: text }, 'Failed to acquire connection from pool');
      poolErrorCounter.inc({ error_type: 'acquire_failure' });
      throw new PoolQueryError(
        `Failed to acquire connection: ${message}`,
        text,
        params,
      );
    }

    const endQuery = poolQueryHistogram.startTimer();
    try {
      const result = await client.query<T>(text, params);
      endQuery();

      // Update pool metrics after each query
      this.updateMetrics();
      return result;
    } catch (error) {
      endQuery();
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        { error, queryText: text, params: this.sanitizeParams(params) },
        'Query execution failed',
      );
      poolErrorCounter.inc({ error_type: 'query_execution_failure' });
      throw new PoolQueryError(
        `Query execution failed: ${message}`,
        text,
        params,
      );
    } finally {
      try {
        client.release();
      } catch (releaseError) {
        logger.warn(
          { releaseError, pid: client.processID },
          'Error releasing client back to pool',
        );
      }
    }
  }

  /**
   * Acquires a dedicated client from the pool for transaction or multi-step
   * operations. **Must** be released by the caller via `client.release()`.
   *
   * @returns A Promise resolving to a PoolClient.
   * @throws {PoolNotInitializedError} if the pool is not initialized.
   * @throws {PoolQueryError} if client acquisition fails.
   */
  public async getClient(): Promise<PoolClient> {
    this.ensureInitialized();

    const endAcquire = poolAcquireHistogram.startTimer();
    try {
      const client = await this.pool!.connect();
      endAcquire();
      this.updateMetrics();
      return client;
    } catch (error) {
      endAcquire();
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error }, 'Failed to acquire dedicated client from pool');
      poolErrorCounter.inc({ error_type: 'client_acquire_failure' });
      throw new PoolQueryError(
        `Failed to acquire client: ${message}`,
        '',
        undefined,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Health & status
  // -------------------------------------------------------------------------

  /**
   * Returns a snapshot of the pool's current health metrics.
   *
   * @throws {PoolNotInitializedError} if the pool is not initialized.
   */
  public health(): PoolHealth {
    this.ensureInitialized();
    return {
      totalCount: this.pool!.totalCount,
      idleCount: this.pool!.idleCount,
      waitingCount: this.pool!.waitingCount,
      acquiringCount: this.pool!.acquiringCount,
      isReady: this.pool!.totalCount >= this.tuning.min,
    };
  }

  /**
   * Returns the Prometheus registry for metric collection.
   */
  public getMetricsRegistry(): Registry {
    return register;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Gracefully shuts down the connection pool, waiting for all idle clients
   * to drain. After shutdown, the pool must be re-initialized.
   *
   * @param timeout - Maximum time (ms) to wait for pool drain (default 30s).
   */
  public async shutdown(timeout: number = 30000): Promise<void> {
    if (!this.initialized || !this.pool) {
      logger.warn('PoolManager.shutdown() called but pool is not initialized');
      return;
    }

    logger.info('Shutting down connection pool');
    try {
      await this.pool.end({ timeout });
      this.initialized = false;
      this.pool = null;
      logger.info('Connection pool shut down successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error }, 'Error during pool shutdown');
      poolErrorCounter.inc({ error_type: 'shutdown_failure' });
      throw new PoolInitializationError(`Pool shutdown failed: ${message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Ensures the pool has been initialized. Throws if not.
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.pool) {
      throw new PoolNotInitializedError();
    }
  }

  /**
   * Updates Prometheus gauge metrics with current pool status.
   */
  private updateMetrics(): void {
    if (this.pool) {
      poolTotalGauge.set(this.pool.totalCount);
      poolIdleGauge.set(this.pool.idleCount);
      poolWaitingGauge.set(this.pool.waitingCount);
    }
  }

  /**
   * Sanitizes query parameters for logging to prevent sensitive data exposure.
   * Truncates long strings and replaces objects with their type.
   *
   * @param params - The original parameter array.
   * @returns A sanitized copy safe for logging.
   */
  private sanitizeParams(params?: unknown[]): unknown[] | undefined {
    if (!params) return undefined;
    return params.map((p) => {
      if (typeof p === 'string') {
        return p.length > 100 ? p.substring(0, 100) + '...' : p;
      }
      if (typeof p === 'object' && p !== null) {
        return `[${(p as object).constructor.name}]`;
      }
      return p;
    });
  }
}

// ---------------------------------------------------------------------------
// Default export for convenience
// ---------------------------------------------------------------------------

export default PoolManager;