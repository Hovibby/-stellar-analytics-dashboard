# Flaky Test Management

Unstable tests are detected automatically, isolated from the release pipeline,
and tracked until they are fixed. The system has three moving parts:

1. **FlakyReporter** — a Playwright custom reporter that counts pass/fail
   attempts per test and writes `test-results/flaky-report.json`.
2. **Quarantine fixture** — a Playwright fixture that reads `flaky.json` and
   skips listed tests in the standard CI run so they cannot block a release.
3. **`flaky-tests` workflow** — a nightly (+ on-change) CI job that runs every
   test three times, detects new flaky tests, updates `flaky.json`, and opens
   an automated PR.

---

## Acceptance criteria

| # | Criterion |
|---|---|
| 1 | A test that passes on some attempts and fails on others is automatically identified as flaky |
| 2 | Flaky tests are skipped in the standard `ci.yml` run — they cannot block a release |
| 3 | Flaky tests still run in the nightly `flaky-tests` workflow under `QUARANTINE_MODE=run-quarantined` |
| 4 | `flaky.json` is the single source of truth; all entries are validated by the `quarantine-gate` CI job |
| 5 | New flaky tests are auto-added to `flaky.json` via an automated PR — no manual triage required |
| 6 | A PR comment summarises which tests are flaky and what their pass rate was |
| 7 | A test is "graduated" (un-quarantined) by removing its entry from `flaky.json` and proving it stable |

---

## flaky.json — quarantine list

```
packages/e2e/flaky.json
```

Each entry must include these fields:

| Field | Required | Description |
|---|---|---|
| `title` | yes | Full test title as it appears in Playwright output, e.g. `"Performance > should load dashboard within acceptable time"` |
| `file` | yes | Relative path to the spec file, e.g. `"tests/performance.spec.ts"` |
| `reason` | yes | Why the test is flaky — be specific so the fixer knows where to look |
| `quarantinedAt` | yes | ISO date the entry was added, e.g. `"2026-07-26"` |
| `quarantinedBy` | yes | `"automation"` for auto-promoted, or the GitHub username of the person who added it manually |
| `issueUrl` | no | Link to the GitHub issue tracking the fix |
| `stabilisationDue` | no | Target date to fix the test, e.g. `"2026-08-15"` |

Example:

```json
{
  "version": 1,
  "quarantined": [
    {
      "title": "Performance > should load dashboard within acceptable time",
      "file": "tests/performance.spec.ts",
      "reason": "Wall-clock assertion is sensitive to CI runner load. Flake rate ~25 %.",
      "quarantinedAt": "2026-07-26",
      "quarantinedBy": "automation",
      "issueUrl": "https://github.com/org/repo/issues/123",
      "stabilisationDue": "2026-08-15"
    }
  ]
}
```

---

## How quarantine works in tests

Specs import from the quarantine fixture instead of Playwright's base `test`:

```ts
// Before
import { test, expect } from '@playwright/test';

// After — gets automatic quarantine skip logic
import { test, expect } from './fixtures/quarantine';
```

The fixture is transparent — it adds no extra setup. When a test's full title
matches an entry in `flaky.json` and `QUARANTINE_MODE` is not set to
`run-quarantined`, the test is skipped with the reason from `flaky.json`.

The visual-regression and auth fixtures can be composed:

```ts
import { test as quarantineTest } from './fixtures/quarantine';
import { test as authTest } from './fixtures/auth';

// Compose if you need both auth + quarantine
const test = authTest.extend({ ...quarantineTest.info() });
```

---

## Running locally

```bash
# Standard run — quarantined tests skipped
pnpm test:e2e

# Flaky detection run — repeat each test 3 times, quarantine NOT applied
pnpm test:flaky

# Preview what promote-flaky would add (no writes)
pnpm flaky:promote -- --dry-run

# Apply newly detected entries to flaky.json
pnpm flaky:promote
```

---

## CI pipeline

### Standard pipeline (`ci.yml`)

Quarantined tests are **skipped** — `QUARANTINE_MODE` is not set, so the
quarantine fixture applies its skip logic. The build cannot be blocked by a
known-flaky test.

### Flaky-detection pipeline (`flaky-tests.yml`)

Runs nightly at 02:00 UTC and on every change to `tests/**` or `flaky.json`.

Steps:
1. Run all non-visual specs with `--repeat-each=3` under
   `QUARANTINE_MODE=run-quarantined` (quarantined tests are NOT skipped).
2. FlakyReporter writes `test-results/flaky-report.json`.
3. `promote-flaky.ts` compares the report against `flaky.json` and appends
   any newly detected flaky tests.
4. If new entries were added, an automated PR is opened on `chore/quarantine-flaky-tests`.
5. A PR comment is posted with the full flaky summary.

The `quarantine-gate` job (also in `flaky-tests.yml`) validates `flaky.json`
structure on every run to prevent malformed entries.

---

## Graduating a quarantined test

1. Fix the underlying source of flakiness (timing, test isolation, etc.).
2. Run `pnpm test:flaky` locally to confirm the test passes consistently.
3. Remove the entry from `flaky.json`.
4. Open a PR referencing the fix issue. The `quarantine-gate` job validates
   the updated list.
5. The `flaky-tests` nightly run will confirm stability over several nights
   before the PR is merged.
