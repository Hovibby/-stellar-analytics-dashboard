# Code Ownership

This document defines which teams and individuals are responsible for each service area in the monorepo. It is the human-readable companion to [`.github/CODEOWNERS`](../.github/CODEOWNERS), which GitHub uses to automatically request reviews.

---

## Teams

| Team | Responsibilities |
|------|-----------------|
| `@stellar-analytics/maintainers` | Repo-level config, shared package, documentation, cross-cutting decisions |
| `@stellar-analytics/indexer-team` | Data ingestion, Horizon polling, backfill, database schema and migrations |
| `@stellar-analytics/api-team` | GraphQL API, resolvers, DataLoader, caching, rate limiting |
| `@stellar-analytics/frontend-team` | React dashboard, Apollo Client, i18n, theming, unit tests |
| `@stellar-analytics/qa-team` | E2E test suite, Playwright configuration, test data fixtures |
| `@stellar-analytics/platform-infra` | CI/CD workflows, Docker Compose, backup scripts, infrastructure config |

---

## Service Area Ownership

### Shared (`shared/`, `packages/shared/`)

**Owner:** `@stellar-analytics/maintainers`

Contains TypeScript types, network configuration, and utilities used by every other package. Changes here affect the entire monorepo.

**Acceptance criteria:**
- All exported types are documented with JSDoc comments.
- No runtime dependency on Node.js built-ins (must be importable in browser contexts).
- Every breaking change to an exported interface increments the shared package version and updates all consumers in the same PR.
- CI passes with no type errors across all packages after the change.

---

### Indexer (`indexer/`, `packages/indexer/`)

**Owner:** `@stellar-analytics/indexer-team`

**Co-owner (database migrations only):** `@stellar-analytics/platform-infra`

Polls the Stellar Horizon API, normalizes ledger/transaction/operation/payment records, writes them to PostgreSQL in bulk, and broadcasts real-time updates over WebSocket.

**Acceptance criteria:**
- New ingestion logic has corresponding unit tests in `indexer/tests/`.
- Config changes update `indexer/.env.example` and `indexer/src/config.ts` with validation.
- Database schema changes include both an `up` and a `down` migration in `packages/indexer/migrations/`.
- Health check endpoint (`GET /health`) reflects the status of any new external dependency added.
- No raw `process.env` access outside `indexer/src/config.ts`.

---

### API (`api/`, `packages/api/`)

**Owner:** `@stellar-analytics/api-team`

Express + GraphQL server. Serves dashboard data from PostgreSQL, applies Redis caching, enforces rate limits, and exposes DataLoader-batched resolvers.

**Acceptance criteria:**
- New queries and mutations are added to the GraphQL schema in `api/src/schema.ts` with matching resolver implementation and JSDoc.
- All new resolvers have DataLoader batching for any relation that can trigger N+1 queries.
- Cache TTL choices are documented in `CACHING.md` with rationale.
- Rate-limit and security-header behaviour is covered by at least one integration test.
- Schema changes do not break the frontend's existing queries without a coordinated update.

---

### Frontend (`frontend/`, `packages/frontend/`)

**Owner:** `@stellar-analytics/frontend-team`

React 18 + Vite dashboard. Uses Apollo Client for GraphQL, i18next for localisation, and a custom theme context for dark/light mode.

**Acceptance criteria:**
- New components have a corresponding unit test using Vitest + Testing Library.
- User-facing strings are added to all six locale files (`en`, `de`, `es`, `fr`, `ja`, `zh`) in `frontend/src/i18n/locales/`.
- Components are accessible: interactive elements have ARIA labels; colour contrast meets WCAG 2.1 AA.
- `pnpm --filter @stellar-analytics/frontend build` produces no TypeScript errors.
- New GraphQL queries are co-located in `frontend/src/graphql/queries.ts` and match the API schema.

---

### E2E Tests (`packages/e2e/`)

**Owner:** `@stellar-analytics/qa-team`  
**Co-owner:** `@stellar-analytics/frontend-team`

Playwright test suite covering all major user workflows across Chromium, Firefox, WebKit, and mobile viewports.

**Acceptance criteria:**
- New user-facing features have a corresponding E2E test added in `packages/e2e/tests/`.
- Tests use the shared helper utilities in `tests/helpers.ts` rather than duplicating selectors.
- All tests pass locally with `pnpm --filter @stellar-analytics/e2e test` before a PR is opened.
- Flaky tests are either fixed or filed as a tracked issue before merging.

---

### Infrastructure & CI/CD (`.github/workflows/`, `scripts/`, `docker-compose*.yml`)

**Owner:** `@stellar-analytics/platform-infra`  
**Co-owner (workflows):** `@stellar-analytics/maintainers`

GitHub Actions pipelines, Docker Compose definitions, backup scripts, and deployment tooling.

**Acceptance criteria:**
- Workflow changes are tested on a feature branch before merging to `main`.
- New workflow jobs have a `timeout-minutes` set to prevent runaway billing.
- Docker base image pins include a specific digest or version tag — no bare `latest`.
- Backup script changes include a dry-run verification step.
- Secrets and credentials are never hard-coded; environment variables or GitHub Secrets are used exclusively.

---

## Review Escalation

If a PR touches multiple service areas, all relevant owners are requested automatically by GitHub via `CODEOWNERS`. When owners disagree on an approach, escalate to `@stellar-analytics/maintainers` for a decision.

For urgent hotfixes targeting `main`, any single owner from the relevant team may approve, but a follow-up review is required within one business day.

---

## Updating This Document

When a team is renamed, a new service area is added, or ownership changes:

1. Update `.github/CODEOWNERS` with the new path patterns and owners.
2. Update the table and service sections in this file.
3. Open a PR and request review from `@stellar-analytics/maintainers`.
