import { gql } from 'apollo-server-express';

/**
 * Schema for the admin-only GraphQL endpoint (mounted at /admin/graphql,
 * separate from the public-facing /graphql analytics endpoint — see
 * docs/admin-graphql.md). Kept intentionally small and self-contained
 * (no shared scalars/types with the public schema) so this endpoint can
 * evolve independently of public analytics queries.
 */
export const adminTypeDefs = gql`
  type AdminUser {
    id: ID!
    email: String!
    name: String!
    role: String!
    createdAt: String!
  }

  type UserConnection {
    users: [AdminUser!]!
    totalCount: Int!
  }

  type SlowQueryRecord {
    sql: String!
    durationMs: Float!
    timestamp: String!
    rowCount: Int
  }

  type QueryMetrics {
    totalQueries: Int!
    slowQueries: Int!
    totalDurationMs: Float!
    averageDurationMs: Float!
    recentSlowQueries: [SlowQueryRecord!]!
  }

  type SystemHealth {
    status: String!
    postgres: String!
    redis: String!
    timestamp: String!
  }

  type Query {
    "Current caller's admin identity (whoever the auth gate resolved)."
    me: AdminUser

    "Database + cache health, same underlying check as the public /health route."
    systemHealth: SystemHealth!

    "Query performance metrics, same underlying data as GET /metrics/queries."
    queryMetrics: QueryMetrics!

    "List registered users, newest first."
    users(limit: Int = 50, offset: Int = 0): UserConnection!
  }

  type Mutation {
    "Change a user's role (admin, user, or viewer)."
    setUserRole(userId: ID!, role: String!): AdminUser!

    "Revoke a user's API key, forcing them to generate a new one."
    revokeUserApiKey(userId: ID!): Boolean!
  }
`;
