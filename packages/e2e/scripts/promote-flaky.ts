/**
 * promote-flaky.ts
 *
 * CLI utility that reads `test-results/flaky-report.json` produced by
 * FlakyReporter and appends newly discovered flaky tests to `flaky.json`.
 *
 * Usage (called by the flaky-tests CI job after a repeat-each run):
 *   npx ts-node scripts/promote-flaky.ts
 *
 * Options:
 *   --report   Path to the flaky report JSON  (default: test-results/flaky-report.json)
 *   --list     Path to the quarantine list    (default: flaky.json)
 *   --dry-run  Print changes without writing  (default: false)
 *
 * Exit codes:
 *   0  Nothing new to quarantine
 *   1  New flaky tests found — quarantine list updated (or would be in dry-run)
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface FlakyTestEntry {
  title: string;
  file: string;
  attempts: number;
  passed: number;
  failed: number;
  status: 'flaky' | 'always-failing' | 'always-passing';
}

interface FlakyReport {
  generatedAt: string;
  totalTests: number;
  flakyCount: number;
  alwaysFailingCount: number;
  tests: FlakyTestEntry[];
}

interface QuarantineEntry {
  title: string;
  file: string;
  reason: string;
  quarantinedAt: string;
  quarantinedBy: string;
  issueUrl: string;
  stabilisationDue: string;
}

interface QuarantineList {
  version: number;
  description: string;
  quarantined: QuarantineEntry[];
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (flag: string, def: string): string => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
};

const reportPath = path.resolve(getArg('--report', 'test-results/flaky-report.json'));
const listPath = path.resolve(getArg('--list', 'flaky.json'));
const dryRun = args.includes('--dry-run');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  if (!fs.existsSync(reportPath)) {
    console.error(`[promote-flaky] Report not found: ${reportPath}`);
    process.exit(0);
  }

  const report: FlakyReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const list: QuarantineList = fs.existsSync(listPath)
    ? JSON.parse(fs.readFileSync(listPath, 'utf8'))
    : { version: 1, description: '', quarantined: [] };

  const existingTitles = new Set(list.quarantined.map((e) => e.title));

  const newEntries: QuarantineEntry[] = report.tests
    .filter((t) => t.status === 'flaky')
    .filter((t) => !existingTitles.has(t.title))
    .map((t) => ({
      title: t.title,
      file: t.file,
      reason: `Auto-promoted: passed ${t.passed}/${t.attempts} times. Flake rate ${Math.round((t.failed / t.attempts) * 100)} %.`,
      quarantinedAt: new Date().toISOString().slice(0, 10),
      quarantinedBy: 'automation',
      issueUrl: '',
      stabilisationDue: '',
    }));

  if (newEntries.length === 0) {
    console.log('[promote-flaky] No new flaky tests detected.');
    process.exit(0);
  }

  console.log(`[promote-flaky] Found ${newEntries.length} new flaky test(s):`);
  newEntries.forEach((e) => console.log(`  • ${e.title}`));

  if (dryRun) {
    console.log('[promote-flaky] Dry run — no changes written.');
    process.exit(1);
  }

  list.quarantined.push(...newEntries);
  fs.writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n', 'utf8');
  console.log(`[promote-flaky] Updated ${listPath} with ${newEntries.length} new entry(ies).`);

  process.exit(1); // exit 1 so CI can tell the list was modified
}

main();
