# Versioning & Release Process

This document explains how Stellar Analytics Dashboard is versioned, what belongs
in each type of release, and the step-by-step process for cutting a release.

---

## Versioning scheme

We follow **[Semantic Versioning 2.0.0](https://semver.org/)**: `MAJOR.MINOR.PATCH`.

| Version bump | When to use |
|---|---|
| **MAJOR** (`2.0.0`) | Breaking change in a public API, removal of a previously stable feature, or incompatible database schema change that requires manual intervention. |
| **MINOR** (`1.1.0`) | New backwards-compatible feature (new GraphQL field, new dashboard page, new component, new migration that only adds columns/tables). |
| **PATCH** (`1.0.1`) | Backwards-compatible bug fix, security patch, documentation-only change, or performance improvement with no API contract change. |

All packages in this monorepo are versioned **in lockstep** — every package
carries the same version number at release time. Individual packages are not
released independently.

---

## Commit message convention

Every commit **must** follow the
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
specification. This is enforced by `commitlint` via the `commit-msg` Husky
hook.

```
<type>(<optional scope>): <short summary>

[optional body]

[optional footer(s)]
```

### Allowed types

| Type | Maps to version bump | Description |
|---|---|---|
| `feat` | MINOR | New feature visible to users or API consumers |
| `fix` | PATCH | Bug fix |
| `perf` | PATCH | Performance improvement |
| `refactor` | — | Code restructuring with no behaviour change |
| `docs` | — | Documentation only |
| `style` | — | Formatting, whitespace (no logic change) |
| `test` | — | Adding or updating tests |
| `chore` | — | Tooling, build, CI changes |
| `ci` | — | CI/CD pipeline changes |
| `revert` | PATCH | Reverts a previous commit |

A **breaking change** is indicated by appending `!` after the type/scope
(`feat!:`, `fix!:`) **or** by adding a `BREAKING CHANGE:` footer. Either
triggers a MAJOR version bump.

### Examples

```
feat(api): add cursor-based pagination to ledgers query

fix(frontend): correct fee display locale formatting

feat!: remove legacy /rest endpoint — use /graphql instead

BREAKING CHANGE: The /rest/v1 endpoint has been removed.
Consumers must migrate to the GraphQL API.

chore(deps): update vite to 5.4.2

docs: add query-performance guide
```

---

## What belongs in each CHANGELOG section

Each release entry uses the following sections (omit any that are empty):

| Section | What goes here |
|---|---|
| **Added** | New features, new API fields, new pages/components, new config options, new migration files. |
| **Changed** | Modifications to existing behaviour that are backwards-compatible (e.g., updated default page size, adjusted rate-limit threshold). |
| **Deprecated** | Features that still work but will be removed in a future MAJOR release. Always include a migration path. |
| **Removed** | Features removed in this release (only allowed in MAJOR releases). |
| **Fixed** | Bug fixes. Reference the issue number where possible (`#123`). |
| **Security** | Any vulnerability fix, dependency update driven by a CVE, or tightening of auth/CORS/CSP rules. Always reference the CVE or advisory. |
| **Performance** | Measurable performance improvements (query optimisation, index addition, caching change). |
| **Migration** | Changes that require manual action from operators (schema migration, environment variable rename, config file format change). Include exact commands. |

### Writing good entries

- Write for the **reader consuming the change**, not the author making it.
- Be specific: "add `averageFee` field to `networkMetrics` query" beats "update GraphQL schema".
- Link to issues/PRs: `(#42)` or `([#42](https://github.com/…/pull/42))`.
- Entries under **Migration** must include the exact commands an operator must run.

---

## Branch strategy

```
main          ← production-ready code; protected; requires PR + CI green
  └─ develop  ← integration branch; feature branches merge here first
       ├─ feature/my-feature
       ├─ fix/login-bug
       └─ chore/update-deps
```

- `main` is tagged on every release.
- `develop` is the default base branch for new work.
- Hotfixes branch from `main` directly and merge back to both `main` and
  `develop`.

---

## Release checklist

Follow these steps to cut a release. All commands run from the repo root.

### 1 — Decide the version bump

Review commits since the last tag:

```bash
git log v1.0.0..HEAD --oneline
```

Apply the bump rules above. If any commit carries `BREAKING CHANGE` or a `!`
suffix, it is a MAJOR bump regardless of any other commits in the batch.

### 2 — Update CHANGELOG.md

1. Rename the `[Unreleased]` section to `[X.Y.Z] — YYYY-MM-DD`.
2. Add a fresh empty `[Unreleased]` section above it.
3. Update the comparison links at the bottom of the file.

### 3 — Bump the version

Update `version` in every `package.json` (root + all workspace packages):

```bash
# For a patch bump:
pnpm version patch --no-git-tag-version -r

# For a minor bump:
pnpm version minor --no-git-tag-version -r

# For a major bump:
pnpm version major --no-git-tag-version -r
```

### 4 — Run the full test suite

```bash
pnpm test:ci
```

CI must be green before proceeding. Fix any failures before tagging.

### 5 — Commit and tag

```bash
git add CHANGELOG.md packages/*/package.json package.json pnpm-lock.yaml
git commit -m "chore(release): v1.1.0"
git tag -a v1.1.0 -m "Release v1.1.0"
```

### 6 — Push

```bash
git push origin main --follow-tags
```

The `main` branch is protected. Open a PR from `develop` → `main` and merge it
before pushing the tag, or push directly if you have maintainer rights.

### 7 — Create a GitHub Release

```bash
gh release create v1.1.0 \
  --title "v1.1.0" \
  --notes-file <(sed -n '/## \[1\.1\.0\]/,/## \[/p' CHANGELOG.md | head -n -1)
```

Or create the release manually in the GitHub UI, pasting the relevant
CHANGELOG section into the release notes.

### 8 — Deploy

Follow the deployment runbook appropriate for your environment:

- **Docker Compose (production):** `docker compose pull && docker compose up -d`
- **Database migrations:** `pnpm db:migrate` (run **after** the new containers
  are up so the schema matches the running code)
- **Verify:** check `/healthz`, Prometheus metrics, and the Grafana dashboard
  for error spikes.

---

## Hotfix process

When a critical bug is found on `main`:

```bash
git checkout main
git checkout -b fix/critical-bug

# ... fix the bug, add a test ...

git commit -m "fix(api): prevent division by zero in fee calculation (#87)"

# Open PR → main (and cherry-pick onto develop after merge)
```

After the PR merges to `main`, follow the release checklist from step 1 with a
**PATCH** bump. Then cherry-pick the fix commit onto `develop`:

```bash
git checkout develop
git cherry-pick <commit-sha>
```

---

## Tooling summary

| Tool | Purpose |
|---|---|
| `commitlint` | Enforces Conventional Commits format on every commit message |
| `husky` | Runs `commitlint` via `commit-msg` hook; runs lint-staged via `pre-commit` |
| `lint-staged` | Lints and formats only staged files on pre-commit |
| `pnpm version` | Bumps `package.json` version across all workspace packages |
| `gh release create` | Creates a GitHub Release from the CLI |
| `node-pg-migrate` | Manages database schema migrations (see `docs/database-migrations.md`) |
