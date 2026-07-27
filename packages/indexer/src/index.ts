import dotenv from 'dotenv';
import { Pool } from 'pg';
import { StellarService } from './services/stellar-service';
import { IndexerService } from './services/indexer-service';
import { db } from './database/connection';
import { runMigrations } from './database/migrate';
import { SchemaVersionManager } from './database/schema-version';
import { STELLAR_NETWORKS, HORIZON_URLS } from '@stellar-analytics/shared';

// Load environment variables
dotenv.config();

class IndexerApp {
  private stellarService: StellarService;
  private indexerService: IndexerService;
  private isShuttingDown: boolean = false;

  constructor() {
    const network = process.env.STELLAR_NETWORK || STELLAR_NETWORKS.PUBLIC;
    const horizonUrl = process.env.STELLAR_HORIZON_URL || HORIZON_URLS[network];
    
    this.stellarService = new StellarService(horizonUrl);
    this.indexerService = new IndexerService(this.stellarService);
    
    this.setupGracefulShutdown();
  }

  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Stellar Analytics Indexer...');
      
      // Validate environment
      this.validateEnvironment();
      
      // Connect to databases
      await db.connect();
      console.log('✅ Database connections established');
      
      // Run migrations (includes schema-version check)
      await runMigrations();
      console.log('✅ Database migrations completed');

      // Post-migration schema version validation
      await this.validateSchemaCompatibility();
      
      // Test Horizon connection
      const isConnected = await this.stellarService.testConnection();
      if (!isConnected) {
        throw new Error('Failed to connect to Stellar Horizon');
      }
      console.log('✅ Connected to Stellar Horizon');
      
      // Start the indexer
      await this.indexerService.start();
      console.log('✅ Indexer started successfully');
      
      // Start health check server
      this.startHealthCheckServer();
      
      console.log('🎉 Stellar Analytics Indexer is running!');
      
    } catch (error) {
      console.error('❌ Failed to start indexer:', error);
      process.exit(1);
    }
  }

  private validateEnvironment(): void {
    const requiredEnvVars = [
      'DATABASE_URL',
      'REDIS_URL',
      'STELLAR_NETWORK',
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }

  /**
   * Validate that the running database schema is compatible with this code.
   * This is a safety net – runMigrations() should already ensure compatibility,
   * but this double-checks even if migrations were skipped (e.g. read-replica).
   */
  private async validateSchemaCompatibility(): Promise<void> {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
      });

      const versionManager = new SchemaVersionManager(pool);
      const result = await versionManager.checkCompatibility();

      if (!result.compatible) {
        const level = result.fatal ? '❌ FATAL' : '⚠️  WARNING';
        console.error(`${level}: ${result.message}`);
        if (result.fatal) {
          await pool.end();
          throw new Error(result.message);
        }
      } else {
        console.log(`✅ ${result.message}`);
      }

      await pool.end();
    } catch (err) {
      // Only re-throw fatal errors; non-fatal warnings are logged
      if (err instanceof Error && err.message.includes('FATAL')) {
        throw err;
      }
      // If the schema_version table doesn't exist yet (fresh DB before migrations),
      // that's expected and handled by runMigrations().
      console.warn(
        `⚠️  Schema version check skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private startHealthCheckServer(): void {
    const http = require('http');
    // Import metrics lazily to avoid circular-init issues
    const { metrics } = require('./metrics/IndexerMetrics');

    const server = http.createServer(async (req: any, res: any) => {
      // ── GET /health ──────────────────────────────────────────────────────
      if (req.url === '/health') {
        try {
          const status = await this.indexerService.getStatus();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            ...status,
          }));
        } catch (error: any) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message,
          }));
        }

      // ── GET /metrics  (Issue #43 – Prometheus) ───────────────────────────
      } else if (req.url === '/metrics') {
        try {
          const metricsText = await metrics.getMetricsText();
          res.writeHead(200, { 'Content-Type': metrics.contentType() });
          res.end(metricsText);
        } catch (error: any) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`Error collecting metrics: ${error.message}`);
        }

      // ── POST /circuit-breaker/reset  (Issue #41 – manual reset) ─────────
      } else if (req.url === '/circuit-breaker/reset' && req.method === 'POST') {
        this.indexerService.resetCircuitBreaker();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Circuit breaker reset to CLOSED', timestamp: new Date().toISOString() }));

      // ── POST /backfill (manual backfill from sequence) ───────────────────
      } else if (req.url === '/backfill' && req.method === 'POST') {
        try {
          const adminToken = process.env.BACKFILL_ADMIN_TOKEN;

          let body = '';
          req.on('data', (chunk: any) => { body += chunk; });
          req.on('end', async () => {
            try {
              const payload = body ? JSON.parse(body) : {};
              const startSequence = Number(payload.startSequence ?? payload.start ?? payload.sequence);
              const endSequence = payload.endSequence !== undefined ? Number(payload.endSequence) : undefined;

              // If an admin token is configured, require it in the Authorization header or payload
              if (adminToken) {
                const authHeader = req.headers['authorization'] || req.headers['Authorization'];
                const provided = authHeader && String(authHeader).startsWith('Bearer ')
                  ? String(authHeader).slice(7)
                  : payload.token || payload.adminToken;

                if (!provided || provided !== adminToken) {
                  res.writeHead(401, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'unauthorized' }));
                  return;
                }
              }

              if (!Number.isFinite(startSequence) || startSequence <= 0) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'startSequence must be a positive integer' }));
                return;
              }

              // Fire-and-forget: start backfill but respond immediately
              this.indexerService.backfillFromSequence(startSequence, endSequence).catch((err: any) => {
                console.error('[indexer] manual backfill failed:', err);
              });

              res.writeHead(202, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Backfill started', startSequence, endSequence, timestamp: new Date().toISOString() }));
            } catch (err: any) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'invalid JSON payload', detail: err.message }));
            }
          });
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }

      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const port = process.env.PORT || 3001;
    server.listen(port, () => {
      console.log(`📊 Health check server listening on port ${port}`);
      console.log(`   GET  http://localhost:${port}/health`);
      console.log(`   GET  http://localhost:${port}/metrics`);
      console.log(`   POST http://localhost:${port}/circuit-breaker/reset`);
    });
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      
      console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
      this.isShuttingDown = true;
      
      try {
        await this.indexerService.stop();
        await db.disconnect();
        console.log('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // For nodemon
  }
}

// Start the application
if (require.main === module) {
  const app = new IndexerApp();
  app.start().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { IndexerApp };
