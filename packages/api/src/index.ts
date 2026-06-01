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

dotenv.config();

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

    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests from this IP, please try again later.' },
      keyGenerator: (req) => {
        const token = authService.extractToken(req.headers.authorization);
        if (token) {
          const payload = authService.verifyToken(token);
          if (payload) {
            return `user:${payload.userId}`;
          }
        }
        return req.ip || req.socket.remoteAddress || 'unknown';
      },
    });
    this.app.use('/graphql', limiter);

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
              logger.info('GraphQL operation resolved', {
                operation,
                userId,
                variables: ctx.request.variables,
              });
            },
            didEncounterErrors(ctx: any) {
              logger.error('GraphQL operation errors', {
                operation: ctx.request.operationName,
                errors: ctx.errors,
              });
            },
            willSendResponse(ctx: any) {
              const duration = Date.now() - startTime;
              if (duration > 1000) {
                logger.warn('Slow GraphQL query detected', {
                  operation: ctx.request.operationName,
                  duration,
                });
              }
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

      await this.apolloServer.start();
      this.logger.info('Apollo Server started');

      this.apolloServer.applyMiddleware({
        app: this.app as any,
        path: '/graphql',
        cors: false,
      });

      this.httpServer = createServer(this.app);
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
