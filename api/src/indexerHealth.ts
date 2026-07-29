// Issue #173: Indexer health and readiness endpoints
// Exposes lightweight health checks for the ingestion service

import { Router } from 'express';

export interface IndexerHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  horizon: 'connected' | 'disconnected';
  postgres: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  lastIndexedLedger: number | null;
  lag: number;  // ledgers behind
  timestamp: string;
}

export function createIndexerHealthRouter(checks: {
  checkHorizon: () => Promise<boolean>;
  checkPostgres: () => Promise<boolean>;
  checkRedis: () => Promise<boolean>;
  getLastIndexedLedger: () => number | null;
  getCurrentLedger: () => number | null;
}): Router {
  const router = Router();

  // Liveness probe — is the process running?
  router.get('/live', (_req, res) => {
    res.json({ status: 'alive', timestamp: new Date().toISOString() });
  });

  // Readiness probe — is the indexer ready to serve traffic?
  router.get('/ready', async (_req, res) => {
    try {
      const [horizon, postgres, redis] = await Promise.all([
        checks.checkHorizon(),
        checks.checkPostgres(),
        checks.checkRedis(),
      ]);

      const allHealthy = horizon && postgres && redis;
      const status: IndexerHealthStatus = {
        status: allHealthy ? 'healthy' : 'degraded',
        horizon: horizon ? 'connected' : 'disconnected',
        postgres: postgres ? 'connected' : 'disconnected',
        redis: redis ? 'connected' : 'disconnected',
        lastIndexedLedger: checks.getLastIndexedLedger(),
        lag: 0,
        timestamp: new Date().toISOString(),
      };

      // Calculate lag
      const currentLedger = checks.getCurrentLedger();
      if (currentLedger != null && status.lastIndexedLedger != null) {
        status.lag = currentLedger - status.lastIndexedLedger;
        if (status.lag > 100) status.status = 'degraded';
      }

      res.status(allHealthy ? 200 : 503).json(status);
    } catch (err) {
      res.status(503).json({
        status: 'unhealthy',
        error: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}
