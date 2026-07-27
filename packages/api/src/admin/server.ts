import { ApolloServer } from 'apollo-server-express';
import { ApolloServerPluginLandingPageDisabled } from 'apollo-server-core';
import type express from 'express';
import rateLimit from 'express-rate-limit';
import type winston from 'winston';
import { adminTypeDefs } from './typeDefs';
import { adminResolvers } from './resolvers';
import { authService, type JwtPayload } from '../services/auth';

export interface AdminContext {
  user: JwtPayload;
}

/**
 * Express middleware gating /admin/graphql: requires a valid JWT whose role
 * is "admin". Runs BEFORE Apollo even parses the request, so unauthorized
 * callers never reach the admin schema/resolvers at all — this is a
 * separate endpoint (not just field-level @auth on the public schema) so
 * privileged operations are never exposed on /graphql's introspection or
 * schema surface either. See docs/admin-graphql.md.
 */
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const token = authService.extractToken(req.headers.authorization);
  const payload = token ? authService.verifyToken(token) : null;

  if (!payload || payload.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  (req as express.Request & { adminUser: JwtPayload }).adminUser = payload;
  next();
}

/**
 * Mounts the admin-only GraphQL endpoint at /admin/graphql. Separate
 * ApolloServer instance from the public /graphql endpoint (separate schema,
 * separate rate-limit tier, hard auth gate) rather than just marking fields
 * @auth(requires: ADMIN) on the public schema.
 */
export async function mountAdminGraphQL(
  app: express.Application,
  logger: winston.Logger
): Promise<ApolloServer> {
  const isProduction = process.env.NODE_ENV === 'production';

  const adminRateLimitWindowMs = parseInt(process.env.RATE_LIMIT_ADMIN_WINDOW_MS || '60000', 10);
  const adminRateLimitMax = parseInt(process.env.RATE_LIMIT_ADMIN_MAX || '2000', 10);

  const adminGraphqlLimiter = rateLimit({
    windowMs: adminRateLimitWindowMs,
    max: adminRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const adminUser = (req as express.Request & { adminUser?: JwtPayload }).adminUser;
      return adminUser ? `admin:${adminUser.userId}` : req.ip || 'unknown';
    },
    message: { error: 'Admin rate limit exceeded. Please reduce your request rate.' },
  });

  const server = new ApolloServer({
    typeDefs: adminTypeDefs,
    resolvers: adminResolvers,
    introspection: !isProduction,
    plugins: isProduction ? [ApolloServerPluginLandingPageDisabled()] : [],
    context: ({ req }): AdminContext => ({
      user: (req as express.Request & { adminUser: JwtPayload }).adminUser,
    }),
  });

  await server.start();

  app.use('/admin/graphql', requireAdmin, adminGraphqlLimiter);
  server.applyMiddleware({ app: app as any, path: '/admin/graphql', cors: false });

  logger.info('Admin GraphQL endpoint mounted at /admin/graphql (admin role required)');

  return server;
}
