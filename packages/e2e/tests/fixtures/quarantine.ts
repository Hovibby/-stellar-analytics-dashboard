/**
 * Quarantine fixture
 *
 * Reads `flaky.json` at the root of the e2e package and automatically skips
 * any test whose full title matches a quarantined entry.
 *
 * Tests are skipped only in the standard CI run (when QUARANTINE_MODE is NOT
 * set to "run-quarantined").  The flaky-tests workflow sets
 * QUARANTINE_MODE=run-quarantined so the quarantined tests execute and get
 * tracked by the FlakyReporter.
 *
 * Usage — extend from this fixture instead of the base `test`:
 *
 *   import { test, expect } from './fixtures/quarantine';
 *
 *   test('my test', async ({ page }) => { … });
 *
 * The fixture is transparent: it adds no extra setup beyond the automatic
 * skip logic, so existing specs work without modification when they switch
 * their import.
 */

import { test as base, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Load the quarantine list once per worker process
// ---------------------------------------------------------------------------

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
  quarantined: QuarantineEntry[];
}

function loadQuarantineList(): QuarantineEntry[] {
  const listPath = path.resolve(__dirname, '../../flaky.json');
  if (!fs.existsSync(listPath)) return [];
  try {
    const raw = fs.readFileSync(listPath, 'utf8');
    const parsed: QuarantineList = JSON.parse(raw);
    return parsed.quarantined ?? [];
  } catch {
    console.warn('[quarantine] Failed to parse flaky.json — no tests will be quarantined.');
    return [];
  }
}

const quarantinedEntries = loadQuarantineList();
const runQuarantined = process.env.QUARANTINE_MODE === 'run-quarantined';

// ---------------------------------------------------------------------------
// Extended test fixture
// ---------------------------------------------------------------------------

/**
 * Returns true when a test's full title matches a quarantined entry title.
 * The matching is substring-based so partial paths (e.g. "Performance >")
 * can match the stored title without needing an exact full path.
 */
function isQuarantined(testTitle: string): QuarantineEntry | undefined {
  return quarantinedEntries.find(
    (e) => testTitle.includes(e.title) || e.title.includes(testTitle)
  );
}

const test = base.extend<{
  /**
   * Automatically skips tests listed in flaky.json unless QUARANTINE_MODE
   * is set to "run-quarantined".
   */
  _quarantineGuard: void;
}>({
  _quarantineGuard: [
    async ({}, use, testInfo) => {
      if (!runQuarantined) {
        const fullTitle = testInfo.titlePath.join(' > ');
        const entry = isQuarantined(fullTitle);
        if (entry) {
          const reason = entry.reason
            ? `Quarantined: ${entry.reason}`
            : 'Quarantined test — skipped in standard CI run';
          const issueNote = entry.issueUrl ? ` (${entry.issueUrl})` : '';
          test.skip(true, `${reason}${issueNote}`);
        }
      }
      await use();
    },
    { auto: true }, // applies to every test automatically
  ],
});

export { test, expect };
