# Visual Regression Testing

Pixel-level screenshot comparisons that detect unexpected UI changes in
dashboard and card components before they reach production.

---

## What is covered

| Component / page | Snapshots |
|---|---|
| Full Dashboard page | light, dark, mobile (375 px), tablet (768 px) |
| Metric cards grid | default, percentage, currency, trending indicator, dark |
| TransactionsChart | default (24h), 7-day range, dark mode |
| LedgerTimelineChart | stacked, total, operations view modes |
| Loading skeleton | full-page skeleton while API is pending |
| Error state | full-page error banner when API returns 500 |
| Layout / Header | light and dark modes |

All tests use **mocked GraphQL responses** so they produce the same pixel output
regardless of whether the real API is running.

---

## Acceptance criteria

| # | Criterion |
|---|---|
| 1 | A pixel diff > 3 % on any baseline causes a CI failure |
| 2 | Dark-mode and light-mode snapshots are independent (theme changes are not false positives) |
| 3 | Tests run only on Chromium at 1440 × 900 to avoid cross-browser font-rendering noise |
| 4 | CSS animations are disabled at both the browser level and per-assertion for determinism |
| 5 | CI uploads diff / actual / expected PNGs as artefacts on failure |
| 6 | A `workflow_dispatch` trigger regenerates baselines and opens a PR automatically |

---

## Baseline snapshots

Baseline images live in:

```
packages/e2e/tests/__snapshots__/
```

They are committed to git. The `-actual.png` and `-diff.png` artefacts
produced by a *failing* run are git-ignored.

---

## Running locally

```bash
# Run all visual regression tests (compare against committed baselines)
pnpm test:visual

# Update ALL baselines (run after intentional UI changes)
pnpm test:visual:update

# Open the Playwright HTML report after a run
pnpm --filter @stellar-analytics/e2e exec playwright show-report
```

> **First run (no baselines yet):** `pnpm test:visual:update` to generate the
> initial set of `.png` baselines, then commit them.

---

## Updating baselines after intentional changes

1. Make your UI change.
2. Run `pnpm test:visual:update` locally to regenerate all snapshots.
3. Review the diff with `git diff --stat packages/e2e/tests/__snapshots__/`.
4. Commit the updated `.png` files alongside your UI change.

On CI you can also trigger the `visual-regression` workflow with the
`update_snapshots: true` input — it will regenerate and open an automated PR.

---

## CI pipeline

The `visual-regression` workflow (`.github/workflows/visual-regression.yml`)
runs when any file under `packages/frontend/src/` changes, or when the test
spec / Playwright config changes.

On failure:
- The `visual-regression-diffs` artefact contains `-expected.png`,
  `-actual.png`, and `-diff.png` for every failed assertion.
- A PR comment is posted summarising the snapshot count and failure count.

---

## Threshold tuning

The default tolerance is intentionally low to catch real regressions, but
antialiasing and sub-pixel rendering can cause minor differences across
machines:

| Option | Value | Meaning |
|---|---|---|
| `maxDiffPixelRatio` | `0.03` | Up to 3 % of pixels may differ |
| `threshold` | `0.2` | Per-pixel colour-channel tolerance (0–1) |

To relax a single assertion (e.g. a chart with many floating-point values):

```ts
await expect(element).toHaveScreenshot('my-chart.png', {
  maxDiffPixelRatio: 0.05,
  threshold: 0.3,
  animations: 'disabled',
});
```

Do **not** raise the global defaults — fix the underlying source of noise
instead.
