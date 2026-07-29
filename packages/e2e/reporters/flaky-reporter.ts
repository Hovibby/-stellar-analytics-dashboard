/**
 * FlakyReporter — Playwright custom reporter
 *
 * Tracks which tests pass and fail across multiple retries / repeat-each runs
 * and writes a machine-readable report to `test-results/flaky-report.json`.
 *
 * A test is considered flaky when it both passes AND fails within the same run
 * (i.e. it succeeded on at least one attempt but failed on at least one other).
 *
 * The report is consumed by:
 *   - The `flaky-tests` CI job to post a PR comment listing newly detected flaky tests.
 *   - The optional `flaky:promote` script to auto-add tests to flaky.json.
 *
 * Usage (playwright.config.ts):
 *   reporter: [
 *     ['./reporters/flaky-reporter', { outputFile: 'test-results/flaky-report.json' }],
 *   ]
 */

import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import fs from 'fs';
import path from 'path';

export interface FlakyTestEntry {
  title: string;
  file: string;
  attempts: number;
  passed: number;
  failed: number;
  status: 'flaky' | 'always-failing' | 'always-passing';
}

export interface FlakyReport {
  generatedAt: string;
  totalTests: number;
  flakyCount: number;
  alwaysFailingCount: number;
  tests: FlakyTestEntry[];
}

interface TestAttemptTracker {
  title: string;
  file: string;
  passed: number;
  failed: number;
}

class FlakyReporter implements Reporter {
  private readonly outputFile: string;
  private readonly tracker = new Map<string, TestAttemptTracker>();

  constructor(options: { outputFile?: string } = {}) {
    this.outputFile =
      options.outputFile ?? path.join('test-results', 'flaky-report.json');
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const key = `${test.location.file}::${test.titlePath().join(' > ')}`;

    if (!this.tracker.has(key)) {
      this.tracker.set(key, {
        title: test.titlePath().join(' > '),
        file: path.relative(process.cwd(), test.location.file),
        passed: 0,
        failed: 0,
      });
    }

    const entry = this.tracker.get(key)!;

    if (result.status === 'passed') {
      entry.passed += 1;
    } else if (result.status === 'failed' || result.status === 'timedOut') {
      entry.failed += 1;
    }
    // 'skipped' and 'interrupted' are ignored intentionally.
  }

  onEnd(_result: FullResult): void {
    const tests: FlakyTestEntry[] = [];

    for (const [, entry] of this.tracker) {
      const attempts = entry.passed + entry.failed;
      if (attempts === 0) continue;

      let status: FlakyTestEntry['status'];
      if (entry.passed > 0 && entry.failed > 0) {
        status = 'flaky';
      } else if (entry.failed > 0) {
        status = 'always-failing';
      } else {
        status = 'always-passing';
      }

      // Only include tests that aren't perfectly stable
      if (status !== 'always-passing') {
        tests.push({ ...entry, attempts, status });
      }
    }

    const flakyCount = tests.filter((t) => t.status === 'flaky').length;
    const alwaysFailingCount = tests.filter((t) => t.status === 'always-failing').length;

    const report: FlakyReport = {
      generatedAt: new Date().toISOString(),
      totalTests: this.tracker.size,
      flakyCount,
      alwaysFailingCount,
      tests,
    };

    // Ensure output directory exists
    const dir = path.dirname(this.outputFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.outputFile, JSON.stringify(report, null, 2), 'utf8');

    // Print a short summary to stdout so it appears in CI logs
    if (flakyCount > 0 || alwaysFailingCount > 0) {
      console.log('\n=== Flaky Test Report ===');
      if (flakyCount > 0) {
        console.log(`\n⚠️  Flaky tests (${flakyCount}):`);
        tests
          .filter((t) => t.status === 'flaky')
          .forEach((t) =>
            console.log(`   • ${t.title}  (passed ${t.passed}/${t.attempts})`)
          );
      }
      if (alwaysFailingCount > 0) {
        console.log(`\n❌  Always-failing tests (${alwaysFailingCount}):`);
        tests
          .filter((t) => t.status === 'always-failing')
          .forEach((t) => console.log(`   • ${t.title}`));
      }
      console.log(`\nFull report → ${this.outputFile}\n`);
    }
  }
}

export default FlakyReporter;
