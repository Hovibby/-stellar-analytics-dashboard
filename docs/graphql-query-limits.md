# GraphQL Query Depth Limiting

The API enforces a maximum query depth to prevent deeply nested queries from causing excessive database load or stack overflows.

## Current Configuration

Depth limiting is applied via the [graphql-depth-limit](https://github.com/stems/graphql-depth-limit) package as a GraphQL validation rule:

```typescript
import depthLimit from 'graphql-depth-limit';

this.apolloServer = new ApolloServer({
  validationRules: [
    depthLimit(10) as any,
  ],
  // ...
});
```

The maximum allowed depth is **10 levels**.

## What Counts as Depth

Each nested selection set adds one level of depth. For example:

```graphql
# Depth: 1
query {
  ledgers {          # 1
    edges {          # 2
      node {         # 3
        sequence     # 4
      }
    }
  }
}
```

A query exceeding depth 10 is rejected before execution with a validation error.

## Error Response

When a query exceeds the depth limit, the API returns a 400-level response with a validation error:

```json
{
  "errors": [
    {
      "message": "'queryName' exceeds maximum operation depth of 10",
      "extensions": {
        "code": "GRAPHQL_VALIDATION_FAILED"
      }
    }
  ]
}
```

## Adjusting the Limit

The depth limit is hardcoded to `10` in `packages/api/src/index.ts`. To make it configurable via environment variable:

```typescript
const maxDepth = parseInt(process.env.GRAPHQL_MAX_DEPTH || '10', 10);

validationRules: [
  depthLimit(maxDepth) as any,
],
```

Then add to your `.env`:

```env
GRAPHQL_MAX_DEPTH=10
```

## Query Complexity

Depth limiting alone does not protect against wide queries (many fields at the same level) or queries that fan out through lists. For more comprehensive protection, consider adding [graphql-query-complexity](https://github.com/slicknode/graphql-query-complexity) alongside depth limiting.

## Introspection

Introspection is disabled in production (`introspection: !isProduction`), which prevents clients from discovering the full schema and crafting targeted deep queries.

## Logging Rejected Queries

Rejected queries are caught by Apollo's `didEncounterErrors` plugin hook and logged via Winston:

```typescript
didEncounterErrors(ctx) {
  logger.error('GraphQL operation errors', {
    operation: ctx.request.operationName,
    errors: ctx.errors,
  });
}
```

Check `logs/error.log` or console output for rejected query details.
