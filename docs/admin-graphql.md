# Admin GraphQL Endpoint

Privileged/internal operations (user management, system health, query performance
metrics) are served from a **dedicated GraphQL endpoint** at `/admin/graphql`,
separate from the public-facing analytics endpoint at `/graphql`.

## Why a separate endpoint instead of `@auth(requires: ADMIN)` fields?

The public schema already has field-level authorization via the `@auth` directive
(e.g. `generateApiKey: ApiKeyPayload! @auth(requires: ADMIN)`), which is fine for
gating individual fields that logically belong on the public schema. But mixing
admin-only operations into the public schema means:

- They show up in `/graphql`'s introspection (even if execution is blocked),
  leaking the existence/shape of internal operations to any client.
- They share the public endpoint's rate-limit tiers and query-complexity budget,
  tuned for analytics traffic, not admin tooling.
- A bug in field-level auth on one resolver can leak privileged data through the
  same schema/endpoint everything else uses.

Splitting them into their own `ApolloServer` instance, mounted at a different
path with a hard Express-level auth gate **in front of** GraphQL parsing, means
an unauthorized request never reaches the admin schema at all — not even to
introspect it.

## Endpoint

```
POST /admin/graphql
Authorization: Bearer <JWT with role=admin>
```

Non-admin or missing/invalid tokens get a `403` before Apollo is even invoked
(see `requireAdmin` middleware in `packages/api/src/admin/server.ts`).

## Schema

See `packages/api/src/admin/typeDefs.ts`. Currently exposes:

- `Query.me` — resolves the calling admin's identity
- `Query.systemHealth` — same underlying check as `GET /health`
- `Query.queryMetrics` — same underlying data as `GET /metrics/queries`
- `Query.users(limit, offset)` — paginated user list
- `Mutation.setUserRole(userId, role)` — change a user's role
- `Mutation.revokeUserApiKey(userId)` — force-revoke a user's API key

## Rate limiting

`/admin/graphql` has its own rate-limit tier (`RATE_LIMIT_ADMIN_WINDOW_MS` /
`RATE_LIMIT_ADMIN_MAX` env vars, same defaults as the public endpoint's admin
tier), keyed on the authenticated admin's user ID rather than IP.

## Extending it

Add new fields to `packages/api/src/admin/typeDefs.ts` and implement them in
`packages/api/src/admin/resolvers.ts`. Keep this schema self-contained (avoid
importing types/resolvers from the public schema) so it can evolve
independently — see `docs/api-versioning.md`.
