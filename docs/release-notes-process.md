# Release Notes Process

This document describes how release notes and the CHANGELOG are generated, reviewed, and published for the Stellar Analytics Dashboard.

---

## Overview

Release notes are generated automatically from [conventional commits](https://www.conventionalcommits.org/) using `scripts/generate-release-notes.mjs`. No manual editing of `CHANGELOG.md` is required for routine releases.

```
conventional commits  →  generate-release-notes.mjs  →  CHANGELOG.md
                                                       →  GitHub PR comment (preview)
                                                       →  GitHub Release body
```

---

## Commit message format

Every commit merged to `main` must follow the conventional commit format enforced by commitlint:

```
<type>(<scope>): <description>

[optional body]

[optional footer: BREAKING CHANGE: ...]
```

### Types and their CHANGELOG sections

| Type | Section |
|------|---------|
| `feat` | ✨ Features |
| `fix` | 🐛 Bug Fixes |
| `perf` | ⚡ Performance |
| `refactor` | ♻️ Refactoring |
| `docs` | 📝 Documentation |
| `test` | 🧪 Tests |
| `chore` | 🔧 Chores |
| `ci` | 👷 CI |
| `build` | 📦 Build |
| `style` | 💄 Style |
| `revert` | ⏪ Reverts |

### Breaking changes

Add `!` after the type, or include a `BREAKING CHANGE:` footer. These always appear at the top of the release notes under **⚠️ Breaking Changes**:

```
feat(api)!: remove deprecated /v1/stats endpoint

BREAKING CHANGE: Clients using /v1/stats must migrate to /graphql query stats{}
```

---

## Generating release notes locally

```bash
# Preview since the last tag (no file changes)
pnpm release:notes:preview

# Write CHANGELOG.md for a specific version
pnpm release:notes -- --version 1.3.0

# Diff between two specific tags
pnpm release:notes -- --from v1.2.0 --to v1.3.0 --version 1.3.0

# Output to stdout only
node scripts/generate-release-notes.mjs --output stdout
```

---

## Release workflow

### 1. Prepare a release

```bash
# Update version in root package.json
npm version minor   # or patch / major

# This creates a commit and a local tag:
#   chore(release): v1.3.0
#   tag: v1.3.0
```

### 2. Push the tag

```bash
git push origin main --follow-tags
```

Pushing a `v*` tag triggers the `release-notes.yml` workflow, which:
1. Runs `generate-release-notes.mjs` for the new version.
2. Prepends the new entry to `CHANGELOG.md`.
3. Commits and pushes the updated CHANGELOG to `main` (skipping CI).

### 3. Create a GitHub Release

```bash
gh release create v1.3.0 \
  --title "v1.3.0" \
  --notes-file <(node scripts/generate-release-notes.mjs --dry-run --output stdout)
```

Or in the GitHub UI: use the tag, paste the output of `pnpm release:notes:preview` into the body.

---

## PR preview comments

Every pull request targeting `main` automatically receives a **Release Notes Preview** comment from the `release-notes.yml` workflow. The comment is updated (not re-posted) on each new push to the PR branch. This lets reviewers verify that commit messages will produce sensible release notes before merge.

---

## CHANGELOG format

`CHANGELOG.md` is an append-at-top file. Each entry has the structure:

```markdown
## [1.3.0] – 2026-07-26

### ⚠️ Breaking Changes

- **api**: remove deprecated /v1/stats endpoint (`abc12345`)
  > Clients using /v1/stats must migrate to /graphql query stats{}

### ✨ Features

- **frontend**: add performance alert toasts (`def67890`)
- **api**: performance alerting service for GraphQL and HTTP (`fed43210`)

### 🐛 Bug Fixes

- **indexer**: fix DLQ threshold not resetting after drain (`bcd89012`)

---
```

---

## Acceptance criteria

- [ ] `pnpm release:notes:preview` prints a correctly formatted Markdown entry to stdout.
- [ ] `pnpm release:notes` prepends the entry to `CHANGELOG.md`.
- [ ] Pushing a `v*` tag triggers the GitHub Actions workflow and updates `CHANGELOG.md`.
- [ ] Every PR to `main` receives a release notes preview comment.
- [ ] Breaking changes (`!` or `BREAKING CHANGE:` footer) appear in a dedicated top section.
- [ ] Commits that do not match the conventional format are silently skipped (not errors).

---

## See Also

- [Contributing Guide](../CONTRIBUTING.md) – commit message requirements and PR process
- `scripts/generate-release-notes.mjs` – script source with inline documentation
- `.github/workflows/release-notes.yml` – CI automation
