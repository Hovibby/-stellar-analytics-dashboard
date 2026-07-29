# Dependency Management

This document describes how third-party packages are kept current in the monorepo, with minimal manual maintenance overhead.

---

## Strategy

Dependencies are updated automatically by **GitHub Dependabot**, configured in [`.github/dependabot.yml`](../.github/dependabot.yml). Dependabot opens pull requests on a weekly cadence every Monday at 06:00 UTC.

Updates are grouped by logical concern (e.g. all React packages in one PR, all Playwright packages in one PR) to reduce review noise. Each PR follows the project's [conventional commit](../commitlint.config.js) format and is labelled for easy filtering.

---

## Covered Ecosystems

| Ecosystem | Directories covered |
|-----------|-------------------|
| npm (pnpm workspaces) | `/`, `/shared`, `/indexer`, `/api`, `/frontend`, `/packages/api`, `/packages/frontend`, `/packages/indexer`, `/packages/shared`, `/packages/e2e` |
| Docker base images | `/packages/api`, `/packages/frontend` |
| GitHub Actions | `/` (all workflow files) |

---

## Update Schedule

All ecosystems run on the same schedule: **weekly, every Monday at 06:00 UTC**.

Keeping everything on the same day means dependency PRs batch together and can be reviewed in a single sitting rather than trickling in throughout the week.

---

## Grouping Strategy

Packages in the same concern group are bundled into a single PR. The groups per workspace are:

### Root workspace
| Group | Packages |
|-------|---------|
| `root-tooling` | eslint, @typescript-eslint/\*, prettier, husky, lint-staged, @commitlint/\*, concurrently, typescript |

### `indexer/`
| Group | Packages |
|-------|---------|
| `stellar-sdk` | @stellar/\* |
| `logging` | pino\*, winston\* |
| `testing` | jest, @types/jest, ts-jest, tsx, typescript |

### `frontend/`
| Group | Packages |
|-------|---------|
| `react` | react, react-dom, @types/react, @types/react-dom |
| `apollo` | @apollo/\*, graphql\* |
| `i18n` | i18next\*, react-i18next |
| `vite-build` | vite, @vitejs/\*, typescript |
| `vitest-testing` | vitest\*, @vitest/\*, @testing-library/\*, jsdom |

### `api/`
| Group | Packages |
|-------|---------|
| `graphql` | graphql\*, @apollo/\* |
| `express` | express\*, cors, @types/cors, @types/express\* |

### `packages/api/`
| Group | Packages |
|-------|---------|
| `graphql-server` | graphql\*, apollo-server\*, @apollo/\* |
| `security` | helmet, jsonwebtoken, bcryptjs, express-rate-limit, @types/jsonwebtoken, @types/bcryptjs |

### `packages/frontend/`
| Group | Packages |
|-------|---------|
| `pkg-react` | react, react-dom, @types/react\* |
| `pkg-ui-libs` | recharts, framer-motion, @headlessui/\*, lucide-react, tailwindcss, autoprefixer, postcss |
| `pkg-state` | zustand, react-query, react-hook-form, @hookform/\*, zod |

### `packages/e2e/`
| Group | Packages |
|-------|---------|
| `playwright` | @playwright/\*, playwright\* |

### GitHub Actions
| Group | Packages |
|-------|---------|
| `actions-core` | actions/\* |
| `actions-third-party` | pnpm/\*, EnricoMi/\* |

---

## Reviewing Dependabot PRs

### Who reviews what

Dependabot PRs are labelled with the relevant scope (e.g. `scope: frontend`, `scope: indexer`). The CODEOWNERS rules in [`.github/CODEOWNERS`](../.github/CODEOWNERS) automatically assign the right team for review.

| Label | Reviewing team |
|-------|---------------|
| `scope: shared`, `scope: packages/shared` | `@stellar-analytics/maintainers` |
| `scope: indexer`, `scope: packages/indexer` | `@stellar-analytics/indexer-team` |
| `scope: api`, `scope: packages/api` | `@stellar-analytics/api-team` |
| `scope: frontend`, `scope: packages/frontend` | `@stellar-analytics/frontend-team` |
| `scope: e2e` | `@stellar-analytics/qa-team` |
| `scope: docker`, `scope: github-actions` | `@stellar-analytics/platform-infra` |

### Review checklist

Before merging a Dependabot PR:

- [ ] CI is green (unit tests + E2E tests pass).
- [ ] Check the package's changelog or release notes for breaking changes.
- [ ] For **major version bumps**: read the migration guide and update consuming code before merging. Tag with `breaking-change` if it requires coordinated changes across packages.
- [ ] For **security advisories** (Dependabot Security PRs): merge promptly — within one business day. No grouping delay applies.
- [ ] Docker image updates: confirm the new image tag is a specific version, not `latest`.

---

## Security Advisories

Dependabot also monitors the GitHub Advisory Database and opens **Security PRs** independently of the weekly schedule. These are not grouped and carry a `security` label.

Security PRs take priority over all other dependency work. The on-call owner of the affected service area is responsible for reviewing and merging within one business day.

---

## Manual Dependency Updates

When a package needs updating outside the weekly cycle (e.g. a zero-day vulnerability or a feature your team needs immediately):

```bash
# Update a single package in a workspace
pnpm --filter @stellar-analytics/api update graphql

# Update all packages in a workspace to their latest allowed version
pnpm --filter @stellar-analytics/frontend update

# Check what is outdated across the whole monorepo
pnpm outdated -r
```

Open a PR with the title format: `chore(deps): manually bump <package> to <version>` and explain the reason in the PR description.

---

## Pinning Policy

- **Patch and minor** updates: allowed automatically (uses `^` ranges in `package.json`).
- **Major** updates: Dependabot opens a PR but a human must review and merge manually.
- **Docker images**: pin to a specific minor version tag (e.g. `postgres:16-alpine`, not `postgres:latest`). Dependabot will open PRs when a new patch is available.
- **GitHub Actions**: pin to a specific version tag (e.g. `actions/checkout@v4`).

---

## Adding New Dependencies

When you add a new `npm` dependency:

1. Use an exact or caret range:
   ```bash
   pnpm --filter @stellar-analytics/frontend add react-virtuoso
   ```
2. Prefer packages that are actively maintained (recent commits, no open CVEs).
3. Avoid packages with unusual names that could be typosquatting variants — verify the npm page and GitHub repo before installing.
4. After adding, Dependabot picks it up automatically in the next weekly run.

---

## Removing Stale Dependencies

Run the following periodically to identify unused packages:

```bash
# Check for unused dependencies (requires depcheck)
pnpm dlx depcheck
```

Remove confirmed stale packages with `pnpm --filter <package> remove <dep>` and open a PR labelled `chore(deps): remove unused dependency`.
