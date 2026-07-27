# Stellar Analytics Dashboard

Monorepo scaffold for a Stellar blockchain analytics platform with a data pipeline, GraphQL API, React dashboard, and shared TypeScript package.

## Project Structure

```text
.
+-- indexer/
�   +-- src/
�       +-- ingester.ts
�       +-- transformer.ts
�       +-- loader.ts
�       +-- websocket.ts
�       +-- index.ts
�       +-- database/schema.sql
+-- api/
�   +-- src/
�       +-- schema.ts
�       +-- resolvers/
�       +-- index.ts
+-- frontend/
�   +-- src/
�       +-- components/
�       +-- hooks/
�       +-- pages/
�       +-- App.tsx
�       +-- main.tsx
+-- shared/
�   +-- src/
�       +-- config/networks.ts
�       +-- types/
�       +-- utils/
+-- docker-compose.yml
+-- package.json
+-- pnpm-workspace.yaml
```

## Stellar Network Config

Shared network configuration is in `shared/src/config/networks.ts`:
- `mainnet` Horizon: `https://horizon.stellar.org`
- `testnet` Horizon: `https://horizon-testnet.stellar.org`

## Database Schema

`indexer/src/database/schema.sql` initializes these tables:
- `blocks`
- `transactions`
- `operations`
- `ledgers`

## Local Setup

1. Install dependencies:

```bash
pnpm install
```

2. Start PostgreSQL and Redis:

```bash
docker compose up -d postgres redis
```

### CI/CD

This repository includes GitHub Actions workflows for:
- PR validation with lint and build checks
- automated E2E testing for feature branches
- staging and production container deployment pipelines
- manual rollback via workflow dispatch

Backups are automated by the `postgres-backup` service when running full compose (`docker compose up -d`), and you can run backup operations manually:

```bash
pnpm backup:run
pnpm backup:verify
pnpm backup:health
```

3. Run services in separate terminals:

```bash
pnpm --filter @stellar-analytics/indexer dev
pnpm --filter @stellar-analytics/api dev
pnpm --filter @stellar-analytics/frontend dev
```

## Endpoints

- API GraphQL + playground: `http://localhost:4000/graphql`
- Frontend (Vite): `http://localhost:5173`

## API Examples

Ready-to-run GraphQL examples for the **dashboard**, **account** and
**network analytics** endpoint families (with cURL invocations and
expected responses) live in [`docs/api-examples.md`](docs/api-examples.md).

See also:

- [`docs/graphql-query-standards.md`](docs/graphql-query-standards.md) — naming & linting rules
- [`docs/graphql-query-limits.md`](docs/graphql-query-limits.md) — depth and complexity limits
- [`docs/query-performance.md`](docs/query-performance.md) — DataLoader batching & slow-query monitoring


## Database Migrations

Schema changes are managed with `node-pg-migrate`:

```bash
pnpm db:migrate
pnpm db:migrate:down
```

See `docs/database-migrations.md` for the full migration workflow.

## Query Performance

Slow-query monitoring, DataLoader batching, Redis caching, and index review guidance are documented in `docs/query-performance.md`.

## Backup and Disaster Recovery

Backup/restore/PITR runbook is documented in `docs/backup-disaster-recovery.md`.
