## [1.0.0] – 2026-07-26

### ✨ Features

- implement request timeouts for Express server, DB queries, and GraphQL (`49e4bc0d`)
- **metrics**: expand Prometheus metrics with ingestion, error, and latency tracking (`586a03f3`)
- cursor-based pagination schema and transaction CSV/JSON export (`b493518a`)
- **indexer**: add exponential backoff retry for Horizon requests (`05be5e58`)
- add Zod validation for GraphQL mutations and Login form (#124, #125) (`446ef227`)
- **api**: add API key rate limits and consistent resolver error handling (`f06668b0`)
- **indexer**: implement circuit breaker for Horizon calls (`3dcd6eb5`)
- implement query complexity analysis on GraphQL API (`94b199ed`)
- add pagination to RecentTransactions component (`e1797003`)
- implement error boundaries around route components (`26e9dc8a`)
- add realistic loading skeletons to data tables (`ac67e8a1`)
- **metrics**: add ingestion, error rate, and latency metrics (`e8db94e9`)
- **indexer**: implement historical ledger backfilling (`198e787d`)
- **indexer**: add alerting system for critical errors (`26d199c9`)
- **api**: add liveness and readiness health check endpoints (`9874e7be`)
- **indexer**: implement full data retention policy service (`954abc6e`)
- **api**: add per-query debug logging with timing info (`8cc2d7c7`)
- add component tests for packages/frontend/src/components (`ed977838`)
- **frontend**: add internationalization and fix lint errors (`fbacd399`)
- **indexer**: add comprehensive operational metrics to IndexerMetrics (`d9af4d6f`)
- **frontend**: bundle size optimizations via code splitting and chunking (`f35701a8`)
- **frontend**: add keyboard navigation to GlobalSearch (`27e2a751`)
- **cache**: improve Redis query caching with ttl and invalidation (`5bfcb0d0`)
- implement full idempotency protection for database operations ## Overview Implement a comprehensive, production-grade idempotency tracking system for all database write operations in the Stellar Analytics Indexer. (`af347c3b`)
- implement full idempotency protection for database operations (`d3b12576`)
- **testing**: add frontend testing infrastructure with Vitest, RTL, and coverage (`53c6cad3`)
- implement dark mode with theme toggle and persistence (`2e4ca07a`)
- add requirements spec for project documentation and security (`a61223d0`)
- implement fixes for issues #26, #29, #34, #37 (`f6b00f24`)
- implement comprehensive E2E testing suite with Playwright (#81) (`72075931`)
- **indexer**: add backfill, parallel processing, config validation, and logging (#38 #45 #46 #47) (`fa4a121a`)
- **indexer**: add validation, circuit breaker, metrics, idempotency (#39 #41 #43 #44) (`8d1936a3`)
- complete GraphQL API for Stellar analytics (Issue #4) (`24bc3cb7`)
- implement stellar horizon indexer with postgres storage and realtime updates (#13) (`3b013b0d`)
- scaffold stellar analytics monorepo architecture (`9d5ebc0f`)

### 🐛 Bug Fixes

- implement db pooling #137 and graphql integration tests #134 (`4ba3dd88`)
- **indexer**: add database connection pooling configuration #137 (`23296c8c`)
- **api**: improve websocket authentication and remove duplicate handlers (`c540cabf`)
- resolve all monorepo compilation and typescript blockers (`0677423d`)
- resolve TypeScript errors in API packages (`69176941`)
- resolve pre-commit hook issues (`666d32b2`)
- **websocket**: add JWT auth, rate limiting, and message validation (Issues #33, #35) (`90c69539`)
- **api**: add real database health checks to /health endpoint (`ffad4d6a`)
- resolve unreachable code and duplicate imports in ledgers resolvers (`663be008`)
- improve date handling in dailyTransactionCount resolver (`bc1f3365`)
- add operation subscriptions and unify graphql error handling (`d35d1737`)
- **#40,#42,#48,#49**: indexer batching, health check, graceful shutdown, GraphQL client (`b3fc3d7b`)
- resolve issues #12, #13, #14, #17 - security & infrastructure improvements (`f035f7fb`)
- **indexer**: resolve import and query placeholder errors (`0f7a2d83`)

### 📝 Documentation

- add security headers, CORS, query limits, and error handling docs (`3ddf2f11`)
- add spec for project documentation and security (`33cdc860`)
- add dashboard screenshot for PR (`1a178e01`)

### 🧪 Tests

- **indexer**: add unit tests for StellarService, IndexerService, RetentionService (`b801f81a`)

### 🔧 Chores

- update lockfile to match package.json (`c5a42c39`)
- add Husky pre-commit hooks, lint-staged, and commitlint (`ddba050a`)
- update frontend dependencies (`ff4168ba`)

### 🔀 Other

- Solution for #137 - Add database connection pooling configuration (`c22e0674`)
- Solution for #137 - Add database connection pooling configuration (`779d5d85`)
- Solution for #137 - Add database connection pooling configuration (`59506751`)

---

# Changelog

All notable changes to the Stellar Analytics Dashboard are documented here.

Entries are generated automatically from conventional commits using
`scripts/generate-release-notes.mjs`. See [RELEASE_NOTES.md](./docs/release-notes-process.md)
for the full process.

<!-- New entries are prepended automatically by the release-notes script -->
