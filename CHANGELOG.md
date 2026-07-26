# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).  
Commit messages follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification enforced by `commitlint`.

> **Tip:** See `docs/versioning.md` for the full release workflow, branching strategy, and guidance on what belongs in each section.

---

## [Unreleased]

### Added
- Storybook 8 in `packages/frontend` — all presentational components now have
  isolated stories covering every visual state (loading, data, error, empty).
  Run with `pnpm storybook`. (#component-isolation)
- `docs/versioning.md` — documents the conventional-commits → semver release
  process, branch strategy, and release checklist. (#versioning-docs)
- Pre-commit sync check (`scripts/check-sync.sh`) — blocks commits where
  migration files, GraphQL schema, or Vitest snapshots are modified without
  their derived artefacts also being staged. (#sync-check)
- Migration integration test suite
  (`packages/indexer/src/tests/migrations.test.ts`) — exercises the full
  up/down/redo paths against a real Postgres instance. (#migration-tests)

---

## [1.0.0] — 2025-01-28

### Added
- Full monorepo scaffold: `packages/frontend`, `packages/api`,
  `packages/indexer`, `packages/shared`, `packages/e2e`.
- React 18 + Vite 5 dashboard with Apollo Client 3, dark/light theming,
  i18n (EN / ES / FR / DE / ZH / JA), and CSV/JSON export.
- Express 5 + GraphQL API with DataLoader batching, rate limiting (100 req/min
  per IP), and a dev playground.
- PostgreSQL schema with ledgers, transactions, operations, accounts, assets,
  trustlines, network metrics, asset metrics, and account metrics tables.
- Versioned migrations via `node-pg-migrate`; three initial migrations:
  `1738000000000_initial-schema`, `1738100000000_add-performance-indexes`,
  `1738200000000_add-foreign-key-constraints`.
- Playwright E2E suite across Chromium, Firefox, WebKit, Mobile Chrome, and
  Mobile Safari.
- Vitest unit tests with 80 % coverage thresholds on all packages.
- GitHub Actions CI: unit tests + E2E matrix with Postgres/Redis services.
- Nightly cross-browser E2E workflow.
- Husky git hooks: `pre-commit` (lint-staged + conditional unit tests),
  `commit-msg` (commitlint conventional-commits validation).
- Cursor-based pagination (`PageInfo`, `edges`, `totalCount`) on ledgers and
  transactions endpoints.
- `TransactionsChart` — real-time 24-hour bar chart with polling every 30 s.
- `ExportControls` — CSV/JSON export with date-range filtering and progress
  indicator.
- Docker Compose dev and production configurations, including a
  `postgres-backup` service.
- Comprehensive documentation: `CACHING.md`, `CONTRIBUTING.md`,
  `docs/backup-disaster-recovery.md`, `docs/cors.md`,
  `docs/database-migrations.md`, `docs/error-handling-and-logging.md`,
  `docs/graphql-query-limits.md`, `docs/query-performance.md`,
  `docs/security-headers.md`.

---

[Unreleased]: https://github.com/your-org/stellar-analytics-dashboard/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/your-org/stellar-analytics-dashboard/releases/tag/v1.0.0
