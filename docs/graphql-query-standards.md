# GraphQL Query Document Standards

Every GraphQL operation in `packages/frontend/src/graphql/queries.ts` (and any
future `.graphql` files) is automatically linted by
[`@graphql-eslint`](https://github.com/B2o5T/graphql-eslint) as part of both
the local pre-commit hook and the `graphql-lint` CI job.

---

## Acceptance criteria

| # | Rule | Enforced by | Severity |
|---|------|-------------|----------|
| 1 | Every operation has a unique, explicit name | `unique-operation-name` | error |
| 2 | Queries start with `Get` or `Search` | `naming-convention` | error |
| 3 | Mutations start with a mutating verb (`Create`, `Update`, `Delete`, `Add`, `Remove`, `Set`, `Revoke`, `Generate`, `Register`, `Login`) | `naming-convention` | error |
| 4 | Subscriptions start with `On` | `naming-convention` | error |
| 5 | Fragment names end with `Fragment` | `naming-convention` | error |
| 6 | Variables are camelCase | `naming-convention` | error |
| 7 | No `@deprecated` fields are selected | `no-deprecated` | error |
| 8 | Every object-typed field must have a sub-selection set | `require-selections` | error |
| 9 | No unused variables | `no-unused-variables` | error |
| 10 | No unused fragments | `no-unused-fragments` | error |
| 11 | Prefer selecting `id` when the type exposes it | `require-id-when-available` | warn |
| 12 | No duplicate field selections | `no-duplicate-fields` | warn |
| 13 | Selection sets are alphabetically sorted | `alphabetize` | warn (autofix) |

---

## Quick reference

### Running the linter locally

```bash
# Check only
pnpm lint:graphql

# Check + autofix (alphabetize, remove duplicate fields, etc.)
pnpm lint:graphql:fix
```

### Naming examples

```graphql
# ✅ Query — starts with "Get"
query GetLedgers($first: Int, $after: String) { … }

# ✅ Query — starts with "Search"
query SearchAccounts($filter: AccountFilterInput) { … }

# ✅ Mutation — starts with a mutating verb
mutation CreateApiKey { … }

# ✅ Subscription — starts with "On"
subscription OnNewLedger { … }

# ✅ Fragment — ends with "Fragment"
fragment LedgerBaseFragment on Ledger { … }

# ❌ Anonymous operation — always give a name
query { ledgers { … } }

# ❌ Wrong prefix
query FetchLedgers { … }   # must start with Get/Search
subscription NewLedger { … } # must start with On
```

### No deprecated fields

When the schema marks a field `@deprecated`, the linter raises an **error**:

```graphql
# Assuming `transactionCount` is deprecated in favour of `successfulTransactionCount`
query GetLedgers {
  ledgers {
    edges {
      node {
        transactionCount   # ❌ @graphql-eslint/no-deprecated
      }
    }
  }
}
```

Remove the field or switch to the replacement field listed in the deprecation
reason.

### Sub-selections required

Every object type must have a `{ … }` selection set:

```graphql
# ❌ returns the whole Account object as an opaque scalar
query GetAccount($id: String!) {
  account(accountId: $id)  # ❌ @graphql-eslint/require-selections
}

# ✅
query GetAccount($id: String!) {
  account(accountId: $id) {
    accountId
    balance
  }
}
```

---

## CI pipeline

The `graphql-lint` workflow (`.github/workflows/graphql-lint.yml`) runs two jobs:

1. **Lint GraphQL Documents** — fails the build on any `error`-level rule
   violation and uploads a SARIF report so GitHub shows inline annotations on
   the PR diff.
2. **GraphQL Format Check** — applies autofix and fails if a diff is produced,
   reminding the author to run `pnpm lint:graphql:fix` locally.

The workflow is triggered only when query files, the schema, or the lint config
itself changes, keeping CI fast for unrelated PRs.

---

## Adding a new query

1. Add the `gql` constant to `packages/frontend/src/graphql/queries.ts`.
2. Follow the naming table above.
3. Run `pnpm lint:graphql` to verify; run `pnpm lint:graphql:fix` to
   auto-sort the selection set.
4. Export the constant and import it in the component or hook that needs it.
