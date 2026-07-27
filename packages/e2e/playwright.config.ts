import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['list'],
    // FlakyReporter is always enabled; it only produces output when tests are
    // not perfectly stable.  The output file is written even on clean runs so
    // CI can confirm there are zero flaky tests.
    ['./reporters/flaky-reporter', { outputFile: 'test-results/flaky-report.json' }],
  ],

  /**
   * Visual-regression snapshot options.
   *
   * Snapshots are stored alongside the test file under:
   *   tests/__snapshots__/<spec-name>-snapshots/
   *
   * The `snapshotPathTemplate` keeps them together and makes the path
   * predictable for CI diffing and artifact uploads.
   */
  snapshotPathTemplate:
    '{testDir}/__snapshots__/{testFilePath}/{projectName}/{arg}{ext}',

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    /* Video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    // ── Standard functional tests ──────────────────────────────────────────
    {
      name: 'chromium',
      testIgnore: '**/visual-regression.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      testIgnore: '**/visual-regression.spec.ts',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      testIgnore: '**/visual-regression.spec.ts',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    {
      name: 'Mobile Chrome',
      testIgnore: '**/visual-regression.spec.ts',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      testIgnore: '**/visual-regression.spec.ts',
      use: { ...devices['iPhone 12'] },
    },

    // ── Visual regression — Chromium only ─────────────────────────────────
    //
    // Visual snapshots are intentionally limited to a single, fixed-size
    // Chromium context.  Running across all browsers / viewports would
    // produce too many false positives from font-rendering differences.
    //
    // Separate viewport-specific tests (mobile / tablet) are handled
    // inside visual-regression.spec.ts via page.setViewportSize().
    {
      name: 'visual-regression',
      testMatch: '**/visual-regression.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Fixed viewport so snapshots are deterministic across machines
        viewport: { width: 1440, height: 900 },
        // Disable animations at the browser level — specs also pass
        // animations: 'disabled' per-assertion, but this acts as a backstop.
        launchOptions: {
          args: ['--disable-web-animations'],
        },
      },
    },

    // ── Flaky test detection ───────────────────────────────────────────────
    //
    // Runs all non-visual specs with --repeat-each=3 (set in the CI command)
    // under QUARANTINE_MODE=run-quarantined so:
    //   a) quarantined tests are NOT skipped — they run and are tracked
    //   b) the FlakyReporter captures per-attempt pass/fail counts
    //
    // Used exclusively by the `flaky-tests` CI workflow.
    // Standard `pnpm test:e2e` never targets this project.
    {
      name: 'flaky-detection',
      testIgnore: '**/visual-regression.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: process.env.CI
    ? undefined
    : [
        {
          command: 'pnpm --filter @stellar-analytics/frontend dev',
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 120 * 1000,
        },
        {
          command: 'pnpm --filter @stellar-analytics/api dev',
          url: 'http://localhost:4000/graphql',
          reuseExistingServer: !process.env.CI,
          timeout: 120 * 1000,
        },
      ],
});
