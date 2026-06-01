import { Pool, PoolClient } from 'pg';
import { createClient } from 'redis';
import winston from 'winston';

export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private pool: Pool;
  private redis: ReturnType<typeof createClient>;
  private logger: winston.Logger;

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

    // Database connection pooling configuration (Issue #137)
    const maxConnections = parseInt(process.env.DB_POOL_MAX || process.env.DB_MAX_CONNECTIONS || '20', 10);
    const minConnections = parseInt(process.env.DB_POOL_MIN || '5', 10);
    const idleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10);
    const connectionTimeout = parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '2000', 10);
    const maxUses = parseInt(process.env.DB_POOL_MAX_USES || '10000', 10);

    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: maxConnections,
      min: minConnections,
      idleTimeoutMillis: idleTimeout,
      connectionTimeoutMillis: connectionTimeout,
      maxUses: maxUses,
      keepalive: true,
    });

    this.redis = createClient({
      url: process.env.REDIS_URL,
    });

    this.setupErrorHandling();
    this.setupPoolMonitoring();
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

  // Issue #29 – Pool size monitoring with metrics endpoint
  private setupPoolMonitoring(): void {
    setInterval(() => {
      const poolStats = {
        total: this.pool.totalCount,
        idle: this.pool.idleCount,
        waiting: this.pool.waitingCount,
        min: this.pool.options.min || 0,
      };
      this.logger.info('Database pool stats:', poolStats);
    }, 30000); // Log every 30 seconds

    this.pool.on('connect', () => {
      this.logger.debug('Database pool: new connection created');
    });

    this.pool.on('acquire', () => {
      this.logger.debug('Database pool: connection acquired');
    });

    this.pool.on('release', () => {
      this.logger.debug('Database pool: connection released');
    });
  }

  // Issue #29 – Get pool stats for monitoring
  public getPoolStats(): {
    total: number;
    idle: number;
    waiting: number;
    max: number;
    min: number;
  } {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      max: this.pool.options.max || 0,
      min: this.pool.options.min || 0,
    };
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
    const client = await this.getClient();
    try {
      const result = await client.query(text, params);
      return result.rows;
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
    const serializedValue = JSON.stringify(value);
    if (ttl) {
      await this.redis.setEx(key, ttl, serializedValue);
    } else {
      await this.redis.set(key, serializedValue);
    }
  }

  public async cacheGet<T = any>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  public async cacheDel(key: string): Promise<void> {
    await this.redis.del(key);
  }

  public async cacheExists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }
}

export const db = DatabaseConnection.getInstance();
