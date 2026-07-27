# Database Migrations

Schema changes are managed with [node-pg-migrate](https://github.com/salsita/node-pg-migrate) in `packages/indexer`.

## Overview

- Migration files: `packages/indexer/migrations/`
- Version history table: `pgmigrations`
- Schema version table: `schema_version` (tracks logical schema version)
- Config: `packages/indexer/.node-pg-migraterc`
- Initial migration: `1738000000000_initial-schema.js`
- Schema version manager: `packages/indexer/src/database/schema-version.ts`

## Prerequisites

Set `DATABASE_URL` before running migrations:

```bash
export DATABASE_URL=postgresql://stellar:stellar@localhost:5432/stellar_analytics
```

## Commands

From repository root:

```bash
pnpm db:migrate
pnpm db:migrate:down
```

From `packages/indexer`:

```bash
pnpm db:migrate              # apply pending migrations
pnpm db:migrate:down         # rollback last migration
pnpm db:migrate:create add_feature_x   # scaffold new migration
pnpm db:migrate:redo         # rollback + re-apply last migration
```

The indexer also runs pending migrations automatically on startup.

## Creating a New Migration

1. Create migration file:

```bash
pnpm --filter @stellar-analytics/indexer db:migrate:create add_new_table
```

2. Implement `exports.up` and `exports.down` in the generated file.
3. Test locally:

```bash
pnpm db:migrate
pnpm db:migrate:down
pnpm db:migrate
```

4. Commit the migration file with application code that depends on it.

## Rollback

Rollback one migration:

```bash
pnpm db:migrate:down
```

Rollback multiple migrations:

```bash
pnpm --filter @stellar-analytics/indexer exec ts-node src/database/migrate.ts --down --count=2
```

Always implement `exports.down` for reversible changes.

## Existing Databases (Pre-Migration)

If your database was created from legacy `schema.sql` and already contains tables:

1. Verify schema matches the initial migration intent.
2. Mark the initial migration as applied without executing SQL:

```bash
cd packages/indexer
node-pg-migrate up 1738000000000_initial-schema --fake -f .node-pg-migraterc
```

3. Run future migrations normally with `pnpm db:migrate`.

For fresh environments, run `pnpm db:migrate` only.

## Schema Versioning

### What it does

The `schema_version` table tracks the **logical schema version** (semver) independently
of individual migration files. This enables **explicit compatibility checks** between
the application code and the database schema before any queries are executed.

### Version compatibility rules

| Condition | Result | What to do |
|---|---|---|
| DB major < code major | 🛑 FATAL | Database schema too old — run `pnpm db:migrate` |
| DB major > code major | 🛑 FATAL | Application code too old — deploy newer version |
| DB minor < code min minor | ⚠️ WARNING | Schema slightly behind — run `pnpm db:migrate` |
| Fully compatible | ✅ OK | Nothing |

PATCH differences are always non-breaking and produce no warnings.

### How it works

1. **Startup check**: The indexer calls `SchemaVersionManager.checkCompatibility()`
   after running migrations. If a fatal incompatibility is detected, the indexer
   refuses to start.
2. **Migration validation**: `SchemaVersionManager.validateMigrations()` checks
   that all expected migrations are applied, names follow conventions, timestamps
   are in order, and no unexpected migrations exist.
3. **Version recording**: After each successful `up` run, the migration runner
   records the current schema version defined in `CODE_SCHEMA_VERSION`.

### Schema version manager API

Located in `packages/indexer/src/database/schema-version.ts`:

```typescript
const versionManager = new SchemaVersionManager(pool);

// Read current schema version
const version = await versionManager.getCurrentVersion();

// Check compatibility
const result = await versionManager.checkCompatibility();
// { compatible: boolean, fatal: boolean, message: string }

// Validate all migrations are applied
const errors = await versionManager.validateMigrations([
  '1738000000000_initial-schema',
  '1738100000000_add-performance-indexes',
]);

// Record a new schema version
await versionManager.setVersion('1.1.0', 'Added new_table');

// Version history
const history = await versionManager.getVersionHistory();
```

### Bumping the schema version

When creating a new migration that changes the schema:

1. Determine the version bump:
   - **MAJOR** (`2.0.0`): Breaking schema change (table/column removal, rename)
   - **MINOR** (`1.1.0`): Additive change (new table, new column, new index)
   - **PATCH** (`1.0.1`): Non-schema change (comment update, index recreation)

2. Update `CODE_SCHEMA_VERSION` in `packages/indexer/src/database/schema-version.ts`.

3. Update `CODE_SCHEMA_DESCRIPTION` to describe the change.

4. The migration runner automatically records the new version after applying
   all pending migrations.

### Testing schema versioning

```bash
# Run schema version manager unit tests
pnpm --filter @stellar-analytics/indexer test -- --testPathPattern schema-version

# Run full migration tests (includes schema version checks)
pnpm --filter @stellar-analytics/indexer test:migrations
```

## CI/CD

GitHub Actions workflow `.github/workflows/database-migrations.yml` validates:

- `db:migrate` on empty Postgres
- migration history presence
- rollback (`db:migrate:down`)
- re-apply (`db:migrate`)
- schema_version table presence and version correctness

## Operational Notes

- Do not edit applied migration files in production; create a new migration instead.
- Prefer additive migrations (new columns/tables) over destructive changes.
- Take a backup before production migrations (see `docs/backup-disaster-recovery.md`).
- Keep `schema.sql` as a human-readable reference only; migrations are the source of truth.
- Bump `CODE_SCHEMA_VERSION` and `CODE_SCHEMA_DESCRIPTION` when creating a new migration.
- If a fatal schema version incompatibility is detected, the indexer will refuse to
  start with a clear error message explaining what needs to be done.
