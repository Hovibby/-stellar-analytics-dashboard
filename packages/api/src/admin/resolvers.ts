import { db } from '../database/connection';
import { getQueryMetrics } from '../database/query-monitor';
import type { AdminContext } from './server';

const VALID_ROLES = new Set(['admin', 'user', 'viewer']);

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

function mapUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
  };
}

export const adminResolvers = {
  Query: {
    me: (_: unknown, __: unknown, context: AdminContext) => {
      const { user } = context;
      return {
        id: user.userId,
        email: user.email,
        name: user.email,
        role: user.role,
        createdAt: new Date().toISOString(),
      };
    },

    systemHealth: async () => {
      const health = await db.healthCheck();
      return {
        status: health.status,
        postgres: health.postgres.status,
        redis: health.redis.status,
        timestamp: new Date().toISOString(),
      };
    },

    queryMetrics: () => getQueryMetrics(),

    users: async (_: unknown, args: { limit?: number; offset?: number }) => {
      const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
      const offset = Math.max(args.offset ?? 0, 0);

      const [rows, countRow] = await Promise.all([
        db.query<UserRow>(
          'SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
          [limit, offset]
        ),
        db.queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM users'),
      ]);

      return {
        users: rows.map(mapUser),
        totalCount: countRow ? parseInt(countRow.count, 10) : 0,
      };
    },
  },

  Mutation: {
    setUserRole: async (_: unknown, args: { userId: string; role: string }) => {
      if (!VALID_ROLES.has(args.role)) {
        throw new Error(`Invalid role "${args.role}". Must be one of: ${[...VALID_ROLES].join(', ')}`);
      }

      const row = await db.queryOne<UserRow>(
        'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, name, role, created_at',
        [args.role, args.userId]
      );

      if (!row) {
        throw new Error(`User ${args.userId} not found`);
      }

      return mapUser(row);
    },

    revokeUserApiKey: async (_: unknown, args: { userId: string }) => {
      const result = await db.query('UPDATE users SET api_key = NULL WHERE id = $1 RETURNING id', [
        args.userId,
      ]);
      return result.length > 0;
    },
  },
};
