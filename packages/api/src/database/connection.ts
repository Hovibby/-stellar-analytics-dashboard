import { Pool, PoolClient } from 'pg';
import { createClient } from 'redis';
import winston from 'winston';
import { recordQueryExecution, getQueryMetrics } from './query-monitor';
import { startSpan, endSpan, TraceContext } from '../utils/tracer';

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  NETWORK_STATS: 60,
  LEDGER_DATA: 300,
  ACCOUNT_STATS: 300,
  ASSET_DATA: 300,
} as const;

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
  max: number;
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  postgres: {
    status: 'connected' | 'disconnected' | 'error';
    latencyMs: number;
    poolStats: PoolStats;
  };
  redis: {
    status: 'connected' | 'disconnected' | 'error';
    latencyMs: number;
  };
  database: {
    sizeBytes: number;
    sizeFormatted: string;
  };
  replication: {
    isReplica: boolean;
    lagMs: number | null;
  };
  queryMetrics: {
    totalQueries: number;
    slowQueries: number;
    averageDurationMs: number;
  };
  timestamp: string;
}

export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private pool: Pool;
  private redis: ReturnType<typeof createClient>;
  private logger: winston.Logger;
  private currentTrace: TraceContext | null = null;

  private constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
      ],
    });

    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.redis = createClient({
      url: process.env.REDIS_URL,
    });

    this.setupErrorHandling();
  }

  public static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  private setupErrorHandling(): void {
    this.pool.on('error', (err) => {
      this.logger.error('PostgreSQL pool error:', err);
    });

    this.redis.on('error', (err) => {
      this.logger.error('Redis client error:', err);
    });
  }

  /**
   * Set the trace context for the current request.
   * This enables tracing of database and cache operations.
   */
  public setTraceContext(trace: TraceContext | null): void {
    this.currentTrace = trace;
  }

  /**
   * Get the current trace context.
   */
  public getTraceContext(): TraceContext | null {
    return this.currentTrace;
  }

  public async connect(): Promise<void> {
    try {
      await this.pool.connect();
      await this.redis.connect();
      this.logger.info('Database connections established');
    } catch (error) {
      this.logger.error('Failed to connect to databases:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      await this.redis.disconnect();
      this.logger.info('Database connections closed');
    } catch (error) {
      this.logger.error('Error closing database connections:', error);
      throw error;
    }
  }

  public getPool(): Pool {
    return this.pool;
  }

  public async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  public getRedis(): ReturnType<typeof createClient> {
    return this.redis;
  }

  public async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const startedAt = performance.now();

    // Emit trace span if a trace context is active
    const span = this.currentTrace
      ? startSpan(this.currentTrace, 'database', 'query', { sql: text.substring(0, 200) })
      : null;

    const client = await this.getClient();
    try {
      const result = await client.query(text, params);
      const duration = performance.now() - startedAt;
      recordQueryExecution(text, duration, result.rowCount, this.logger);

      if (span) {
        span.metadata = { ...span.metadata, rowCount: result.rowCount, durationMs: Math.round(duration * 100) / 100 };
        endSpan(span);
      }

      return result.rows;
    } catch (err) {
      if (span) {
        endSpan(span, err instanceof Error ? err : new Error(String(err)));
      }
      throw err;
    } finally {
      client.release();
    }
  }

  public async queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows.length > 0 ? rows[0] : null;
  }

  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Redis helper methods
  public async cacheSet(key: string, value: any, ttl?: number): Promise<void> {
    const span = this.currentTrace
      ? startSpan(this.currentTrace, 'cache', 'set', { cacheKey: key })
      : null;

    try {
      const serializedValue = JSON.stringify(value);
      if (ttl) {
        await this.redis.setEx(key, ttl, serializedValue);
      } else {
        await this.redis.set(key, serializedValue);
      }
      if (span) endSpan(span);
    } catch (err) {
      if (span) endSpan(span, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  public async cacheGet<T = any>(key: string): Promise<T | null> {
    const span = this.currentTrace
      ? startSpan(this.currentTrace, 'cache', 'get', { cacheKey: key })
      : null;

    try {
      const value = await this.redis.get(key);
      const result = value ? JSON.parse(value) : null;
      if (span) {
        span.metadata = { ...span.metadata, cacheHit: result !== null };
        endSpan(span);
      }
      return result;
    } catch (err) {
      if (span) endSpan(span, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  public async cacheDel(key: string): Promise<void> {
    await this.redis.del(key);
  }

  public async cacheExists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  // Cache monitoring
  public async getCacheStats(): Promise<{ keys: number; memory: string }> {
    const keys = await this.redis.dbsize();
    const info = await this.redis.info('memory');
    return { keys, memory: info || 'unknown' };
  }

  public async incrementCacheMetric(metric: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const key = `cache:${metric}:${today}`;
    await this.redis.incr(key);
    await this.redis.expire(key, 86400 * 7); // Keep for 7 days
  }

  public async getCacheMetrics(metric: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const key = `cache:${metric}:${today}`;
    const value = await this.redis.get(key);
    return value ? parseInt(value) : 0;
  }

  public async healthCheck(): Promise<HealthCheckResult> {
    const pgResult = await this.checkPostgresHealth();
    const redisResult = await this.checkRedisHealth();
    const dbSize = await this.getDatabaseSize();
    const replLag = await this.getReplicationLag();
    const queryMetrics = await this.getQueryMetricsSnapshot();

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (pgResult.status === 'error' || redisResult.status === 'error') {
      status = 'unhealthy';
    } else if (pgResult.latencyMs > 500 || redisResult.latencyMs > 100) {
      status = 'degraded';
    }

    return {
      status,
      postgres: {
        status: pgResult.status,
        latencyMs: pgResult.latencyMs,
        poolStats: pgResult.poolStats,
      },
      redis: {
        status: redisResult.status,
        latencyMs: redisResult.latencyMs,
      },
      database: dbSize,
      replication: replLag,
      queryMetrics,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkPostgresHealth(): Promise<{
    status: 'connected' | 'disconnected' | 'error';
    latencyMs: number;
    poolStats: PoolStats;
  }> {
    const start = performance.now();
    try {
      await this.pool.query('SELECT 1 AS health_check');
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      return {
        status: 'connected',
        latencyMs,
        poolStats: {
          total: this.pool.totalCount,
          idle: this.pool.idleCount,
          waiting: this.pool.waitingCount,
          max: 20,
        },
      };
    } catch {
      return {
        status: 'error',
        latencyMs: Math.round((performance.now() - start) * 100) / 100,
        poolStats: {
          total: this.pool.totalCount,
          idle: this.pool.idleCount,
          waiting: this.pool.waitingCount,
          max: 20,
        },
      };
    }
  }

  private async checkRedisHealth(): Promise<{
    status: 'connected' | 'disconnected' | 'error';
    latencyMs: number;
  }> {
    const start = performance.now();
    try {
      await this.redis.ping();
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      return { status: 'connected', latencyMs };
    } catch {
      return {
        status: 'error',
        latencyMs: Math.round((performance.now() - start) * 100) / 100,
      };
    }
  }

  private async getDatabaseSize(): Promise<{
    sizeBytes: number;
    sizeFormatted: string;
  }> {
    try {
      const result = await this.pool.query(`
        SELECT pg_database_size(current_database()) AS size_bytes
      `);
      const sizeBytes = parseInt(result.rows[0]?.size_bytes ?? '0', 10);
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let size = sizeBytes;
      let unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
      }
      return {
        sizeBytes,
        sizeFormatted: `${Math.round(size * 100) / 100} ${units[unitIndex]}`,
      };
    } catch {
      return { sizeBytes: 0, sizeFormatted: 'unknown' };
    }
  }

  private async getReplicationLag(): Promise<{
    isReplica: boolean;
    lagMs: number | null;
  }> {
    try {
      const result = await this.pool.query(
        `SELECT
          CASE WHEN pg_is_in_recovery() THEN true ELSE false END AS is_replica,
          COALESCE(
            EXTRACT(EPOCH FROM (pg_last_wal_receive_lsn() - pg_last_wal_replay_lsn())) * 1000,
            0
          ) AS lag_ms`
      );
      const row = result.rows[0] ?? { is_replica: false, lag_ms: 0 };
      return {
        isReplica: row.is_replica,
        lagMs: row.is_replica ? Number(row.lag_ms) : null,
      };
    } catch {
      return { isReplica: false, lagMs: null };
    }
  }

  private async getQueryMetricsSnapshot(): Promise<{
    totalQueries: number;
    slowQueries: number;
    averageDurationMs: number;
  }> {
    const metrics = getQueryMetrics();
    return {
      totalQueries: metrics.totalQueries,
      slowQueries: metrics.slowQueries,
      averageDurationMs: metrics.averageDurationMs,
    };
  }
}

export const db = DatabaseConnection.getInstance();
