# Static Analysis — API & Indexer

Risky patterns in the API and indexer are detected automatically by a
combination of TypeScript strict-mode type-checking and three custom ESLint
rules that ship as the `@stellar-analytics/eslint-plugin` workspace package.

---

## Acceptance criteria

| # | What is detected | Mechanism | Severity |
|---|---|---|---|
| 1 | Raw SQL inside a resolver (should be in database layer) | `no-raw-sql-in-resolver` | warn |
| 2 | SQL template literals with `${}` interpolation (injection risk) | `no-raw-sql-in-resolver` | error |
| 3 | Mutation resolver missing `context.user` guard | `require-auth-check` | error |
| 4 | Unawaited async call inside a resolver or indexer function | `no-unhandled-promise-in-resolver` | error |
| 5 | Unused variables / parameters in API and indexer | TypeScript `noUnusedLocals` | error |
| 6 | Unsafe index access on arrays/objects | TypeScript `noUncheckedIndexedAccess` | error |
| 7 | Missing `override` keyword on subclass methods | TypeScript `noImplicitOverride` | error |
| 8 | Fall-through in switch blocks | TypeScript `noFallthroughCasesInSwitch` | error |

---

## Custom ESLint rules

All three rules live in `tools/eslint-rules/src/` and are published as the
`@stellar-analytics/eslint-plugin` pnpm workspace package.

### `no-raw-sql-in-resolver`

**Why:** SQL scattered across resolver files makes it impossible to test
queries in isolation, easy to drift, and prone to SQL injection when
string concatenation creeps in.

**Pattern flagged:**
```ts
// ❌ Raw string literal with SQL keywords inside a resolver file
const rows = await db.query('SELECT * FROM ledgers WHERE sequence = $1', [seq]);

// ❌ Template literal with expression interpolation — SQL injection risk
const rows = await db.query(`SELECT * FROM ledgers WHERE id = ${id}`, []);
```

**Safe pattern:**
```ts
// ✅ Import a typed query helper from the database layer
import { getLedgerBySequence } from '../database/ledger-queries';
const ledger = await getLedgerBySequence(seq);
```

---

### `require-auth-check`

**Why:** Every mutation that modifies data must verify the caller is
authenticated before touching the database. One missing guard exposes a
write endpoint to unauthenticated callers.

**Pattern flagged:**
```ts
// ❌ Mutation with no context.user check
Mutation: {
  deleteAccount: async (_, args, context) => {
    await db.query('DELETE FROM accounts WHERE id = $1', [args.id]);
  }
}
```

**Safe pattern:**
```ts
// ✅ Guard is the first statement
Mutation: {
  deleteAccount: async (_, args, context) => {
    if (!context.user) throw new AuthError();
    await db.query('DELETE FROM accounts WHERE id = $1', [args.id]);
  }
}
```

The rule also recognises the `withResolverLogging` wrapper pattern used
throughout the API:

```ts
// ✅ Inner function has the guard — withResolverLogging wrapper is transparent
generateApiKey: withResolverLogging('Mutation.generateApiKey',
  async (_, __, context) => {
    if (!context.user) throw new AuthError();
    return authService.generateApiKey();
  }
)
```

---

### `no-unhandled-promise-in-resolver`

**Why:** When a resolver fires a side-effect (cache write, pub/sub publish,
alert) without `await` and without `.catch()`, any rejection from that call
is silently swallowed — or, worse, crashes the Node.js process via
`unhandledRejection`.

**Pattern flagged:**
```ts
// ❌ Floating cacheSet — rejection swallowed
async function resolver() {
  const result = await db.query(sql, params);
  db.cacheSet(cacheKey, result, TTL);   // ← no await
  return result;
}
```

**Safe patterns:**
```ts
// ✅ Awaited
await db.cacheSet(cacheKey, result, TTL);

// ✅ Chained .catch — rejection handled explicitly
db.cacheSet(cacheKey, result, TTL).catch(logger.error);

// ✅ Explicit discard with void — signals intentional fire-and-forget
void db.incrementCacheMetric('ledgers');
```

The rule applies to: `resolvers/`, `indexer/src/`, `loader.ts`, `ingester.ts`.

---

## TypeScript strict flags

Both `packages/api/tsconfig.json` and `indexer/tsconfig.json` extend the root
`tsconfig.json` (which already sets `"strict": true`) and add:

| Flag | Package | Why |
|---|---|---|
| `noUnusedLocals` | API, Indexer | Dead code accumulates in resolver files |
| `noUnusedParameters` | API, Indexer | Unused resolver arguments (_, __, context) hide bugs |
| `noFallthroughCasesInSwitch` | API, Indexer | Switch fall-through causes incorrect resolver dispatch |
| `noUncheckedIndexedAccess` | API, Indexer | Horizon API records are typed as arrays; unsafe index access is common |
| `noImplicitOverride` | API | ApiServer subclass methods need explicit `override` |
| `exactOptionalPropertyTypes` | API | Forces explicit handling of optional vs undefined in resolver args |

---

## Running locally

```bash
# Custom rules + TypeScript strict checks for API and indexer only
pnpm lint:api
pnpm type-check:api
pnpm type-check:indexer

# Full lint (all packages, including custom rules)
pnpm lint

# Auto-fix what can be fixed
pnpm lint:api:fix

# Build and test the custom ESLint plugin
pnpm --filter @stellar-analytics/eslint-plugin build
pnpm --filter @stellar-analytics/eslint-plugin test
```

---

## CI pipeline

The `static-analysis` workflow (`.github/workflows/static-analysis.yml`)
runs on every PR or push that changes API, indexer, or ESLint plugin files.

Jobs:
1. **build-plugin** — compiles the TypeScript plugin and runs its Jest tests.
2. **typecheck** — runs `tsc --noEmit` with the strict tsconfig for API and
   indexer; uploads a SARIF report on failure for inline PR annotations.
3. **eslint-custom** — runs the three custom rules against `packages/api/src`
   and `indexer/src`; uploads SARIF on failure.
4. **lint-all** — runs the full `pnpm lint` against every package to catch
   regressions in other rules.

---

## Adding a new rule

1. Create `tools/eslint-rules/src/your-rule-name.ts`.
2. Export it from `tools/eslint-rules/src/index.ts`.
3. Add tests in `tools/eslint-rules/src/__tests__/your-rule-name.test.ts`.
4. Register it in `.eslintrc.js` under the appropriate `overrides` block.
5. Document the pattern and safe alternative in this file.
