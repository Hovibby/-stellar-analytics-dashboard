import dotenv from 'dotenv';
import express from 'express';
import { ApolloServer } from 'apollo-server-express';
import { ApolloServerPluginLandingPageDisabled } from 'apollo-server-core';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import depthLimit from 'graphql-depth-limit';

import { typeDefs } from './schema/typeDefs';
import { resolvers } from './resolvers';
import { db } from './database/connection';
import { createLoaders } from './loaders';
import { formatQueryMetricsPrometheus, getQueryMetrics } from './database/query-monitor';
import type { HealthCheckResult } from './database/connection';
import { RealtimePublisher } from './services/realtime-publisher';
import { 
  checkSubscriptionRateLimit, 
  checkEventRateLimit, 
  cleanupRateLimits 
} from './pubsub';
import { authService } from './services/auth';
import { initPerfAlerting, getPerfAlerting } from './services/performance-alerting';

dotenv.config();

const MAX_QUERY_COMPLEXITY = 1000;

// List field names that resolve to paginated collections — cost scaled by requested size
const LIST_FIELD_NAMES = new Set([
  'transactions', 'ledgers', 'accounts', 'operations', 'assets',
  'edges', 'nodes', 'networkMetrics', 'assetMetrics',
]);

function timeoutMiddleware(timeoutMs: number, logger: winston.Logger) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.error('Request timeout reached', {
          path: req.path,
          method: req.method,
          ip: req.ip,
          timeoutMs,
        });
        res.status(503).json({
          error: 'Request timeout',
          message: `The request took too long to process and was timed out after ${timeoutMs}ms`,
        });
      }
    }, timeoutMs);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}

function calculateQueryComplexity(document: any, variables?: Record<string, any>): number {
  let complexity = 0;

  function scoreSelections(selections: any[], multiplier: number): void {
    for (const selection of selections) {
      if (selection.kind !== 'Field') continue;

      const fieldName: string = selection.name.value;
      if (fieldName.startsWith('__')) continue;

      let fieldMultiplier = multiplier;

      if (LIST_FIELD_NAMES.has(fieldName)) {
        let listSize = 10;

        // Extract list size from inline `pagination: { first: N }` argument
        const paginationArg = selection.arguments?.find((a: any) => a.name.value === 'pagination');
        if (paginationArg?.value?.fields) {
          const firstField = paginationArg.value.fields.find((f: any) => f.name.value === 'first');
          if (firstField?.value?.kind === 'IntValue') {
            listSize = parseInt(firstField.value.value, 10);
          } else if (firstField?.value?.kind === 'Variable' && variables) {
            const v = variables[firstField.value.name.value];
            if (typeof v === 'number') listSize = v;
          }
        }

        // Also check a bare `first` argument
        const firstArg = selection.arguments?.find((a: any) => a.name.value === 'first');
        if (firstArg?.value?.kind === 'IntValue') {
          listSize = parseInt(firstArg.value.value, 10);
        } else if (firstArg?.value?.kind === 'Variable' && variables) {
          const v = variables[firstArg.value.name.value];
          if (typeof v === 'number') listSize = v;
        }

        fieldMultiplier = multiplier * Math.max(1, listSize);
      }

      complexity += fieldMultiplier;

      if (selection.selectionSet?.selections) {
        scoreSelections(selection.selectionSet.selections, fieldMultiplier);
      }
    }
  }

  for (const def of document.definitions ?? []) {
    if (def.kind === 'OperationDefinition' && def.selectionSet?.selections) {
      scoreSelections(def.selectionSet.selections, 1);
    }
  }

  return complexity;
}

class ApiServer {
  private apolloServer!: ApolloServer;
  private app: express.Application;
  private httpServer: any;
  private logger!: winston.Logger;
  private realtimePublisher: RealtimePublisher;

  constructor() {
    this.app = express();
    this.setupLogger();
    this.setupMiddleware();
    this.setupApolloServer();
    this.realtimePublisher = new RealtimePublisher(3000);
  }

  private setupLogger(): void {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
      ],
    });
  }

  private setupMiddleware(): void {
    this.app.use(helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }));

    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    }));

    this.app.use(compression());

    // ── Request Timeout ────────────────────────────────────────────────────────────
    this.app.use(timeoutMiddleware(30000, this.logger));

    // ── HTTP performance tracking middleware ──────────────────────────────────────
    this.app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      const start = Date.now();
      res.on('finish', () => {
        getPerfAlerting()?.onHttpRequest(req.method, req.path, res.statusCode, Date.now() - start);
      });
      next();
    });

    // ── Rate limiting ─────────────────────────────────────────────────────────
    //
    // Three tiers, applied in order. The first limiter that matches a request
    // key is the one that counts against it.
    //
    // Tier 1 – API key clients  (x-api-key header present)
    //   Lower ceiling than JWT users because API keys are long-lived credentials
    //   that may be shared or scripted. Keyed on the raw API key value so each
    //   key has its own independent bucket.
    //
    // Tier 2 – Authenticated JWT users  (Bearer token present and valid)
    //   Higher ceiling than anonymous callers. Keyed on user ID so the limit
    //   follows the user regardless of IP.
    //
    // Tier 3 – Anonymous / IP fallback
    //   Lowest ceiling. Keyed on IP address.

    const API_KEY_WINDOW_MS   = parseInt(process.env.RATE_LIMIT_API_KEY_WINDOW_MS   || '60000',  10);
    const API_KEY_MAX         = parseInt(process.env.RATE_LIMIT_API_KEY_MAX         || '300',    10);
    const JWT_USER_WINDOW_MS  = parseInt(process.env.RATE_LIMIT_JWT_USER_WINDOW_MS  || '60000',  10);
    const JWT_USER_MAX        = parseInt(process.env.RATE_LIMIT_JWT_USER_MAX        || '1000',   10);
    const ANON_WINDOW_MS      = parseInt(process.env.RATE_LIMIT_ANON_WINDOW_MS      || '60000',  10);
    const ANON_MAX            = parseInt(process.env.RATE_LIMIT_ANON_MAX            || '100',    10);

    // Tier 1 – API key limiter
    const apiKeyLimiter = rateLimit({
      windowMs: API_KEY_WINDOW_MS,
      max: API_KEY_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      // Skip requests that are NOT using an API key — let the next limiter handle them
      skip: (req) => {
        const apiKey = req.headers['x-api-key'] as string | undefined;
        return !apiKey || !authService.validateApiKey(apiKey);
      },
      keyGenerator: (req) => {
        // Key on the API key itself so each issued key has its own bucket
        return `apikey:${req.headers['x-api-key']}`;
      },
      message: {
        error: 'API key rate limit exceeded. Please reduce your request rate or contact support to increase your quota.',
      },
      handler: (req, res, next, options) => {
        this.logger.warn('API key rate limit exceeded', {
          apiKey: (req.headers['x-api-key'] as string)?.substring(0, 12) + '…',
          ip: req.ip,
          limit: options.max,
          windowMs: options.windowMs,
        });
        res.status(429).json(options.message);
      },
    });

    // Tier 2 – JWT user limiter
    const jwtUserLimiter = rateLimit({
      windowMs: JWT_USER_WINDOW_MS,
      max: JWT_USER_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      // Skip API key requests (already handled above) and anonymous requests
      skip: (req) => {
        const apiKey = req.headers['x-api-key'] as string | undefined;
        if (apiKey && authService.validateApiKey(apiKey)) return true;
        const token = authService.extractToken(req.headers.authorization);
        if (!token) return true;
        return !authService.verifyToken(token);
      },
      keyGenerator: (req) => {
        const token = authService.extractToken(req.headers.authorization);
        if (token) {
          const payload = authService.verifyToken(token);
          if (payload) return `user:${payload.userId}`;
        }
        return req.ip || req.socket.remoteAddress || 'unknown';
      },
      message: {
        error: 'Too many requests. Please slow down and try again later.',
      },
      handler: (req, res, next, options) => {
        const token = authService.extractToken(req.headers.authorization);
        const payload = token ? authService.verifyToken(token) : null;
        this.logger.warn('JWT user rate limit exceeded', {
          userId: payload?.userId ?? 'unknown',
          ip: req.ip,
          limit: options.max,
          windowMs: options.windowMs,
        });
        res.status(429).json(options.message);
      },
    });

    // Tier 3 – Anonymous / IP fallback limiter
    const anonLimiter = rateLimit({
      windowMs: ANON_WINDOW_MS,
      max: ANON_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      // Skip authenticated requests — they are handled by the tiers above
      skip: (req) => {
        const apiKey = req.headers['x-api-key'] as string | undefined;
        if (apiKey && authService.validateApiKey(apiKey)) return true;
        const token = authService.extractToken(req.headers.authorization);
        if (token && authService.verifyToken(token)) return true;
        return false;
      },
      keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
      message: {
        error: 'Too many requests from this IP, please try again later.',
      },
      handler: (req, res, next, options) => {
        this.logger.warn('Anonymous rate limit exceeded', {
          ip: req.ip,
          limit: options.max,
          windowMs: options.windowMs,
        });
        res.status(429).json(options.message);
      },
    });

    // Apply all three limiters to the GraphQL endpoint
    this.app.use('/graphql', apiKeyLimiter, jwtUserLimiter, anonLimiter);

    this.app.get('/health/live', (_req, res) => {
      res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
    });

    this.app.get('/health/ready', async (_req, res) => {
      try {
        const health: HealthCheckResult = await db.healthCheck();
        const pgDown = health.postgres.status === 'error';
        const redisDown = health.redis.status === 'error';

        if (pgDown || redisDown) {
          return res.status(503).json({
            status: 'not_ready',
            postgres: health.postgres.status,
            redis: health.redis.status,
            timestamp: new Date().toISOString(),
          });
        }

        res.status(200).json({
          status: 'ready',
          postgres: health.postgres.status,
          redis: health.redis.status,
          timestamp: new Date().toISOString(),
        });
      } catch (error: any) {
        res.status(503).json({
          status: 'not_ready',
          timestamp: new Date().toISOString(),
          error: error?.message ?? 'Readiness check failed',
        });
      }
    });

    this.app.get('/health', async (_req, res) => {
      try {
        const health: HealthCheckResult = await db.healthCheck();
        const statusCode = health.status === 'unhealthy' ? 503
          : health.status === 'degraded' ? 200
          : 200;
        res.status(statusCode).json(health);
      } catch (error: any) {
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error?.message ?? 'Health check failed',
        });
      }
    });

    this.app.get('/metrics', (_req, res) => {
      res.set('Content-Type', 'text/plain');
      res.send(
        [
          '# HELP graphql_server_status Status of the GraphQL server',
          '# TYPE graphql_server_status gauge',
          'graphql_server_status 1',
          formatQueryMetricsPrometheus(),
        ].join('\n')
      );
    });

    this.app.get('/metrics/queries', (_req, res) => {
      res.json(getQueryMetrics());
    });
  }

  private setupApolloServer(): void {
    const isProduction = process.env.NODE_ENV === 'production';
    const logger = this.logger;

    const plugins: any[] = [
      {
        requestDidStart() {
          const startTime = Date.now();
          return {
            didResolveOperation(ctx: any) {
              const operation = ctx.request.operationName || 'anonymous';
              const user = ctx.context.user;
              const userId = user ? user.id : 'anonymous';

              // Query complexity analysis
              const complexity = calculateQueryComplexity(ctx.document, ctx.request.variables);
              logger.info('GraphQL operation resolved', {
                operation,
                userId,
                complexity,
                variables: ctx.request.variables,
              });

              if (complexity > MAX_QUERY_COMPLEXITY) {
                throw new Error(
                  `Query complexity ${complexity} exceeds the maximum allowed complexity of ${MAX_QUERY_COMPLEXITY}. ` +
                  `Reduce the number of requested fields or lower the pagination limit.`
                );
              }
            },
            didEncounterErrors(ctx: any) {
              logger.error('GraphQL operation errors', {
                operation: ctx.request.operationName,
                errors: ctx.errors,
              });
            },
             willSendResponse(ctx: any) {
               const duration = Date.now() - startTime;
               const operationName = ctx.request.operationName || 'anonymous';
               if (duration > 30000) {
                 logger.error('GraphQL query timeout exceeded', {
                   operation: operationName,
                   duration,
                 });
               } else if (duration > 1000) {
                 logger.warn('Slow GraphQL query detected', {
                   operation: operationName,
                   duration,
                 });
               }
               // Performance alerting
               getPerfAlerting()?.onGraphQLOperation(operationName, duration);
             },

          };
        },
      },
    ];

    if (isProduction) {
      plugins.push(ApolloServerPluginLandingPageDisabled());
    }

    this.apolloServer = new ApolloServer({
      typeDefs,
      resolvers,
      context: ({ req }) => {
        let user = null;
        const token = authService.extractToken(req.headers.authorization);
        if (token) {
          const payload = authService.verifyToken(token);
          if (payload) {
            user = {
              id: payload.userId,
              email: payload.email,
              role: payload.role,
            };
          } else {
            const apiKey = req.headers['x-api-key'] as string;
            if (apiKey && authService.validateApiKey(apiKey)) {
              user = { id: 'api-user', email: 'api@stellar-analytics', role: 'user' };
            }
          }
        } else {
          const apiKey = req.headers['x-api-key'] as string;
          if (apiKey && authService.validateApiKey(apiKey)) {
            user = { id: 'api-user', email: 'api@stellar-analytics', role: 'user' };
          }
        }

        return {
          req,
          user,
          db,
          loaders: createLoaders(),
          logger: this.logger,
          authService,
        };
      },
      introspection: !isProduction,
      validationRules: [
        depthLimit(10) as any,
      ],
      plugins,
    });
  }

  async start(): Promise<void> {
    try {
      this.logger.info('Starting Stellar Analytics API Server...');

      this.validateEnvironment();
      await db.connect();
      this.logger.info('Database connections established');

      // Initialise performance alerting (reads env vars automatically)
      const perfAlerting = initPerfAlerting(this.logger);
      perfAlerting.startHealthPolling(() => db.healthCheck());

      await this.apolloServer.start();
      this.logger.info('Apollo Server started');

      this.apolloServer.applyMiddleware({
        app: this.app as any,
        path: '/graphql',
        cors: false,
      });

      this.httpServer = createServer(this.app);
      this.httpServer.timeout = 30000; // 30s default timeout
      this.setupWebSocketServer();
      await this.realtimePublisher.start();

      const port = process.env.PORT || 4000;
      this.httpServer.listen(port, () => {
        this.logger.info(`Server ready at http://localhost:${port}/graphql`);
        this.logger.info(`Subscriptions ready at ws://localhost:${port}/graphql`);
      });
    } catch (error) {
      this.logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  private setupWebSocketServer(): void {
    const wsServer = new WebSocketServer({
      server: this.httpServer,
      path: '/graphql',
    });

    const schema = (this.apolloServer as any).schema;

    // Cleanup rate limits periodically
    setInterval(cleanupRateLimits, 60000);

    useServer(
      {
        schema,
        context: async (ctx: any, msg: any, args: any) => {
          const connectionParams = ctx?.connectionParams || {};
          const authorization = connectionParams?.authorization || msg?.payload?.headers?.authorization;
          const apiKey = connectionParams?.['x-api-key'] || msg?.payload?.headers?.['x-api-key'];
          
          let user = null;
          
          // Try JWT token authentication
          const token = authService.extractToken(authorization);
          if (token) {
            const payload = authService.verifyToken(token);
            if (payload) {
              user = {
                id: payload.userId,
                email: payload.email,
                role: payload.role,
              };
            }
          }
          
          // Try API key authentication if JWT failed
          if (!user && apiKey && authService.validateApiKey(apiKey)) {
            user = { id: 'api-user', email: 'api@stellar-analytics', role: 'user' };
          }
          
          return {
            db,
            loaders: createLoaders(),
            logger: this.logger,
            user,
            authService,
          };
        },
        onConnect: (ctx: any) => {
          const ip = ctx?.request?.socket?.remoteAddress || 'unknown';
          const connectionParams = ctx?.connectionParams || {};
          
          if (!checkSubscriptionRateLimit(ip)) {
            throw new Error('Subscription rate limit exceeded');
          }
          
          const hasToken = !!connectionParams?.token || !!connectionParams?.authorization;
          const hasApiKey = !!connectionParams?.['x-api-key'];
          const authenticated = hasToken || hasApiKey;
          
          this.logger.info('WebSocket client connected', { 
            ip, 
            authenticated,
            authMethod: hasToken ? 'jwt' : hasApiKey ? 'api-key' : 'none',
          });
          return { ip, authenticated };
        },
        onSubscribe: (ctx: any, msg: any) => {
          const ip = ctx?.ip || 'unknown';
          
          if (!checkEventRateLimit(ip)) {
            throw new Error('Event rate limit exceeded');
          }
          
          this.logger.info('WebSocket subscription started', { 
            ip, 
            query: msg?.payload?.query?.substring(0, 100),
          });
        },
        onDisconnect: (ctx: any, code?: number, reason?: string) => {
          this.logger.info('WebSocket client disconnected', { code, reason });
        },
        onError: (ctx: any, msg: any, errors: any) => {
          const ip = ctx?.ip || 'unknown';
          this.logger.warn('WebSocket error', { ip, errors });
        },
      },
      wsServer
    );
  }

  private validateEnvironment(): void {
    const requiredEnvVars = [
      'DATABASE_URL',
      'REDIS_URL',
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Shutting down server...');

    try {
      getPerfAlerting()?.stopHealthPolling();
      this.realtimePublisher.stop();
      await this.apolloServer.stop();
      await db.disconnect();

      if (this.httpServer) {
        this.httpServer.close();
      }

      this.logger.info('Server shut down successfully');
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
      throw error;
    }
  }
}

if (require.main === module) {
  const server = new ApiServer();

  const gracefulShutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  server.start().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { ApiServer };
