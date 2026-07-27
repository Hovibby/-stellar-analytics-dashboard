# Requirements Document

## Introduction

This feature adds comprehensive documentation to the Stellar Analytics Dashboard monorepo across four markdown files. The work is purely documentation — no CI tooling, no automated scanning pipelines. The four files are:

- `docs/database.md` — database schema, ER diagram, data dictionary, query examples
- `docs/deployment.md` — production setup, environment variables, troubleshooting
- `docs/architecture.md` — system and deployment architecture diagrams
- `docs/security.md` — security best practices, secrets management, input validation, and a guide for running security scans manually

The project is a TypeScript monorepo using pnpm workspaces with three services: an indexer (Stellar blockchain data pipeline), a GraphQL API (Node.js/PostgreSQL), and a React frontend (Vite). Infrastructure uses PostgreSQL 16, Redis 7, and Docker Compose.

## Glossary

- **Dashboard**: The Stellar Analytics Dashboard monorepo as a whole
- **Indexer**: The `@stellar-analytics/indexer` service that ingests Stellar blockchain data
- **API**: The `@stellar-analytics/api` GraphQL service backed by PostgreSQL
- **Frontend**: The `@stellar-analytics/frontend` React/Vite application
- **Database**: The PostgreSQL 16 instance storing ledgers, transactions, operations, and payments
- **ER_Diagram**: Entity-Relationship diagram showing tables, columns, and foreign key relationships
- **Data_Dictionary**: A structured reference listing every table column with its type, constraints, and description
- **Archive_Table**: A PostgreSQL table (e.g., `ledgers_archive`) that stores data past its retention period
- **Deployment_Guide**: A document describing the end-to-end process for deploying the Dashboard to a production environment
- **Rollback_Procedure**: A documented sequence of steps to revert a failed deployment to the previous stable state

---

## Requirements

### Requirement 1: Database ER Diagram

**User Story:** As a developer, I want an ER diagram of the database schema, so that I can quickly understand the data model and table relationships without reading raw SQL.

#### Acceptance Criteria

1. THE Documentation SHALL include an ER diagram covering all active tables: `ledgers`, `transactions`, `operations`, `payments`, and their corresponding `_archive` tables.
2. THE ER_Diagram SHALL show each table's primary key, foreign key relationships, column names, and data types.
3. THE ER_Diagram SHALL be embedded in `docs/database.md` in a format renderable by GitHub (Mermaid `erDiagram` syntax).
4. WHEN the database schema changes, THE Documentation SHALL include instructions in `docs/database.md` for regenerating or updating the ER diagram to reflect the new schema.

---

### Requirement 2: Database Table and Column Documentation

**User Story:** As a developer, I want every table and column documented with descriptions, constraints, and examples, so that I can understand the data model without reverse-engineering the SQL.

#### Acceptance Criteria

1. THE Data_Dictionary SHALL document every column in `ledgers`, `transactions`, `operations`, and `payments` with: column name, data type, nullable status, constraints, and a plain-English description.
2. THE Data_Dictionary SHALL document all indexes defined in `schema.sql`, including the indexed columns, index type, and the query pattern each index is intended to accelerate.
3. THE Data_Dictionary SHALL document the data retention policy for each table: `ledgers` (365 days), `transactions` (180 days), `operations` (180 days), `payments` (90 days).
4. THE Data_Dictionary SHALL document the purpose and usage of each `_archive` table and its relationship to the corresponding active table.
5. THE Data_Dictionary SHALL be located in `docs/database.md`.

---

### Requirement 3: Database Query Examples

**User Story:** As a developer, I want documented query examples for common data access patterns, so that I can write correct and performant queries without trial and error.

#### Acceptance Criteria

1. THE Documentation SHALL include at least one SQL query example for each of the following patterns: fetching a ledger by sequence, fetching transactions by source account, fetching operations by type, fetching payments by sender or receiver, and fetching daily transaction counts.
2. WHEN a query example uses a JOIN across multiple tables, THE Documentation SHALL annotate which indexes are used and why.
3. THE Documentation SHALL include query examples for accessing archive tables and explain when to query archive vs. active tables.
4. THE Documentation SHALL be located in `docs/database.md`.

---

### Requirement 4: Deployment Guide

**User Story:** As a DevOps engineer, I want a complete deployment guide, so that I can deploy the Dashboard to a production environment without relying on tribal knowledge.

#### Acceptance Criteria

1. THE Deployment_Guide SHALL document all prerequisites: required software versions (Node.js, pnpm, Docker, Docker Compose), required environment variables, and required external services.
2. THE Deployment_Guide SHALL provide a step-by-step production setup procedure covering: cloning the repository, installing dependencies, configuring environment variables, initializing the database, running migrations, building all services, and starting the stack.
3. THE Deployment_Guide SHALL include a deployment checklist with verifiable pass/fail items covering: database connectivity, Redis connectivity, API health endpoint (`/graphql`), and frontend reachability.
4. THE Deployment_Guide SHALL document the Rollback_Procedure: steps to revert to the previous Docker image tag, revert the last database migration, and verify system health after rollback.
5. THE Deployment_Guide SHALL be located in `docs/deployment.md`.

---

### Requirement 5: Environment Configuration Guide

**User Story:** As a developer, I want a reference for all environment variables, so that I can configure any service correctly for local, staging, or production environments.

#### Acceptance Criteria

1. THE Documentation SHALL list every environment variable consumed by the Indexer, API, and Frontend, with: variable name, description, required/optional status, default value (if any), and an example value.
2. THE Documentation SHALL document the differences in configuration between local development (using `docker-compose.dev.yml`), staging, and production environments.
3. IF a required environment variable is missing at startup, THEN THE Documentation SHALL describe the expected failure behavior for each service.
4. THE Documentation SHALL be located in `docs/deployment.md`.

---

### Requirement 6: Deployment Troubleshooting Guide

**User Story:** As a DevOps engineer, I want a troubleshooting guide for common deployment failures, so that I can resolve issues quickly without escalating to the development team.

#### Acceptance Criteria

1. THE Documentation SHALL document troubleshooting steps for at least the following failure scenarios: database connection failure, Redis connection failure, migration failure, Indexer failing to connect to the Stellar Horizon API, and the API returning 500 errors.
2. FOR EACH failure scenario, THE Documentation SHALL provide: symptoms, probable causes, diagnostic commands, and resolution steps.
3. THE Documentation SHALL be located in `docs/deployment.md`.

---

### Requirement 7: Architecture Overview Documentation

**User Story:** As a new developer, I want architecture documentation with diagrams, so that I can understand how the system components interact before making changes.

#### Acceptance Criteria

1. THE Documentation SHALL include a system architecture diagram showing all components: Indexer, API, Frontend, PostgreSQL, Redis, and the Stellar Horizon API, with labeled data flow arrows between them.
2. THE Documentation SHALL describe the technology choices for each component and the rationale: TypeScript monorepo (pnpm workspaces), PostgreSQL 16 for persistence, Redis 7 for caching, GraphQL for the API layer, and React/Vite for the frontend.
3. THE Documentation SHALL document the data flow from Stellar network ingestion through the Indexer, into PostgreSQL, through the GraphQL API, to the Frontend.
4. THE Documentation SHALL use Mermaid diagram syntax so diagrams render natively on GitHub.
5. THE Documentation SHALL be located in `docs/architecture.md`.

---

### Requirement 8: Deployment Architecture Documentation

**User Story:** As a DevOps engineer, I want deployment architecture documentation, so that I can understand the infrastructure topology and plan capacity or scaling changes.

#### Acceptance Criteria

1. THE Documentation SHALL include a deployment architecture diagram showing the Docker Compose service topology: `postgres`, `redis`, `postgres-backup`, and the three application services, with port mappings and volume mounts labeled.
2. THE Documentation SHALL document the backup architecture: WAL archiving configuration, the `postgres-backup` service schedule (daily, configurable via `BACKUP_INTERVAL_SECONDS`), retention policy (90 days, configurable via `BACKUP_RETENTION_DAYS`), and backup storage paths.
3. THE Documentation SHALL document the scaling strategy for each service tier: horizontal scaling considerations for the API and Frontend, and vertical scaling considerations for the Database.
4. THE Documentation SHALL be located in `docs/architecture.md`.

---

### Requirement 9: Security Best Practices Documentation

**User Story:** As a developer, I want a security best practices guide, so that the team follows consistent security standards during development and code review.

#### Acceptance Criteria

1. THE Documentation SHALL document security best practices applicable to the Dashboard: parameterized queries for all database access, input validation on all GraphQL resolver arguments, secrets management (no secrets in source control, use of environment variables), and HTTPS enforcement in production.
2. THE Documentation SHALL document secrets management guidelines: which values must never be committed to source control, how to use `.env` files locally, and how to supply secrets via environment variables in production.
3. THE Documentation SHALL document input validation guidelines for GraphQL resolvers: required field checks, type coercion rules, and rejection of unexpected input shapes.
4. THE Documentation SHALL provide a guide for running security scans manually, including: how to run `pnpm audit` to check for dependency vulnerabilities, how to run a local OWASP ZAP baseline scan against the API, and how to interpret and triage the results.
5. THE Documentation SHALL be located in `docs/security.md`.
