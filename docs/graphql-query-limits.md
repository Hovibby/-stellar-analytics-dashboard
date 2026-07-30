# GraphQL Query Depth Limiting and Cost Estimation

The API enforces both a maximum query **depth** and a maximum query **complexity score** to prevent expensive queries from causing excessive database load or service abuse.

## Depth Limiting

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

### What Counts as Depth

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

### Error Response

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

---

## Query Cost Estimation

In addition to depth limiting, the API calculates a **complexity score** for every incoming query in the `didResolveOperation` Apollo plugin hook — before any resolvers execute. Queries exceeding the configured ceiling are rejected immediately.

### How Complexity is Calculated

The cost calculation is implemented in `calculateQueryComplexity()` in `packages/api/src/index.ts`:

- Each selected field contributes **1 point** (multiplied by the current list multiplier).
- Fields that resolve to **paginated collections** (`transactions`, `ledgers`, `accounts`, `operations`, `assets`, `edges`, `nodes`, `networkMetrics`, `assetMetrics`) scale the cost by the requested page size (defaults to 10 when no pagination argument is supplied).
- The multiplier accumulates as the query nests deeper into list fields — `accounts { transactions { ... } }` compounds the cost.

### Configuration

| Parameter | Default | Environment Variable |
|-----------|---------|----------------------|
| Maximum complexity | `1000` | _(hardcoded; see `MAX_QUERY_COMPLEXITY`)_ |

### `X-Query-Complexity` Response Header

Every GraphQL response includes an `X-Query-Complexity` header so API clients can inspect the score of their queries and tune them proactively before reaching the hard limit:

```
X-Query-Complexity: 42
```

### Error Response

When a query exceeds the complexity limit, the API returns a `400`-level GraphQL error:

```json
{
  "errors": [
    {
      "message": "Query complexity 1200 exceeds the maximum allowed complexity of 1000. Reduce the number of requested fields or lower the pagination limit.",
      "extensions": {
        "code": "INTERNAL_SERVER_ERROR"
      }
    }
  ]
}
```

### Reducing Query Complexity

- Request only the fields you need — unused fields still contribute to the score.
- Lower the `first`/`pagination.first` argument on list fields.
- Avoid deeply nested list-within-list queries (e.g. accounts → transactions → operations).

---

## Adjusting the Depth Limit

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
