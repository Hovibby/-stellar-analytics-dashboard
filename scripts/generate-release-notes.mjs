#!/usr/bin/env node
/**
 * generate-release-notes.mjs
 *
 * Generates a Markdown release-notes entry from conventional commits between
 * two Git refs (tags, branches, or commit SHAs).
 *
 * Usage
 * -----
 *   node scripts/generate-release-notes.mjs [--from <ref>] [--to <ref>] [--version <semver>]
 *
 * Flags
 *   --from      Starting ref (exclusive). Defaults to the latest tag.
 *   --to        Ending ref (inclusive).   Defaults to HEAD.
 *   --version   Version label for the release.  Defaults to the value in the
 *               root package.json, or "Unreleased" if not set.
 *   --output    File to append/create (default: CHANGELOG.md).
 *               Pass --output stdout to print to stdout only.
 *   --dry-run   Print to stdout without writing to the file.
 *
 * Commit type mapping (conventional commits)
 * ------------------------------------------
 *   feat     → ✨ Features
 *   fix      → 🐛 Bug Fixes
 *   perf     → ⚡ Performance
 *   refactor → ♻️  Refactoring
 *   docs     → 📝 Documentation
 *   test     → 🧪 Tests
 *   chore    → 🔧 Chores
 *   ci       → 👷 CI
 *   build    → 📦 Build
 *   style    → 💄 Style
 *   revert   → ⏪ Reverts
 *   (other)  → 🔀 Other
 *
 * Breaking changes (BREAKING CHANGE footer or ! after type) are always
 * collected into a dedicated "⚠️ Breaking Changes" section at the top.
 *
 * Example
 * -------
 *   # Generate notes for everything since the last tag
 *   node scripts/generate-release-notes.mjs --version 1.2.0
 *
 *   # Diff between two specific tags
 *   node scripts/generate-release-notes.mjs --from v1.1.0 --to v1.2.0 --version 1.2.0
 *
 *   # Preview without writing
 *   node scripts/generate-release-notes.mjs --dry-run
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

function getLatestTag() {
  try {
    return git('describe --tags --abbrev=0');
  } catch {
    return null;
  }
}

function getRootVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Conventional commit parser
// ---------------------------------------------------------------------------

const TYPE_MAP = {
  feat:     { label: '✨ Features',       order: 1 },
  fix:      { label: '🐛 Bug Fixes',      order: 2 },
  perf:     { label: '⚡ Performance',    order: 3 },
  refactor: { label: '♻️  Refactoring',   order: 4 },
  docs:     { label: '📝 Documentation',  order: 5 },
  test:     { label: '🧪 Tests',          order: 6 },
  chore:    { label: '🔧 Chores',         order: 7 },
  ci:       { label: '👷 CI',             order: 8 },
  build:    { label: '📦 Build',          order: 9 },
  style:    { label: '💄 Style',          order: 10 },
  revert:   { label: '⏪ Reverts',        order: 11 },
};

function parseCommit(raw) {
  // Format: <hash> <subject>\n<body>
  const [firstLine, ...bodyLines] = raw.split('\n');
  const [hash, ...subjectParts] = firstLine.split(' ');
  const subject = subjectParts.join(' ').trim();
  const body = bodyLines.join('\n');

  // Match: type(scope)!: description  OR  type!: description
  const match = subject.match(/^(\w+)(\([^)]+\))?(!)?: (.+)$/);
  if (!match) return null;

  const [, type, scopeRaw, breakingBang, description] = match;
  const scope = scopeRaw ? scopeRaw.slice(1, -1) : null;
  const isBreaking =
    !!breakingBang || /BREAKING[ -]CHANGE/.test(body);
  const breakingNote = body.match(/BREAKING[ -]CHANGE:\s*(.+)/)?.[1] || null;

  return { hash: hash.slice(0, 8), type, scope, description, isBreaking, breakingNote };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const isDryRun = args['dry-run'] === true;
const outputFile = args.output === 'stdout' ? null : resolve(ROOT, args.output || 'CHANGELOG.md');

// Resolve from/to refs
const toRef = args.to || 'HEAD';
let fromRef = args.from;
if (!fromRef) {
  fromRef = getLatestTag();
  if (!fromRef) {
    console.warn('[release-notes] No previous tag found; including all commits.');
  }
}

const version = args.version || getRootVersion() || 'Unreleased';
const today = new Date().toISOString().split('T')[0];

// Fetch commit log
const range = fromRef ? `${fromRef}..${toRef}` : toRef;
let rawLog;
try {
  rawLog = git(`log ${range} --format="%H %s%n%b%n---COMMIT---" --no-merges`);
} catch (err) {
  console.error('[release-notes] git log failed:', err.message);
  process.exit(1);
}

// Parse commits
const sections = {};   // type → [entry]
const breaking = [];   // { description, note }

rawLog
  .split('---COMMIT---')
  .map((c) => c.trim())
  .filter(Boolean)
  .forEach((raw) => {
    const commit = parseCommit(raw);
    if (!commit) return;

    if (commit.isBreaking) {
      breaking.push({
        description: commit.scope
          ? `**${commit.scope}**: ${commit.description}`
          : commit.description,
        note: commit.breakingNote,
        hash: commit.hash,
      });
    }

    const meta = TYPE_MAP[commit.type] || { label: '🔀 Other', order: 99 };
    if (!sections[meta.label]) sections[meta.label] = { order: meta.order, entries: [] };
    const scopePrefix = commit.scope ? `**${commit.scope}**: ` : '';
    sections[meta.label].entries.push(`- ${scopePrefix}${commit.description} (\`${commit.hash}\`)`);
  });

// Build markdown
const lines = [];
lines.push(`## [${version}] – ${today}`);
lines.push('');

if (breaking.length > 0) {
  lines.push('### ⚠️ Breaking Changes');
  lines.push('');
  breaking.forEach(({ description, note, hash }) => {
    lines.push(`- ${description} (\`${hash}\`)`);
    if (note) lines.push(`  > ${note}`);
  });
  lines.push('');
}

const sortedSections = Object.entries(sections).sort((a, b) => a[1].order - b[1].order);
sortedSections.forEach(([label, { entries }]) => {
  lines.push(`### ${label}`);
  lines.push('');
  entries.forEach((e) => lines.push(e));
  lines.push('');
});

if (sortedSections.length === 0 && breaking.length === 0) {
  lines.push('_No notable changes in this release._');
  lines.push('');
}

const entry = lines.join('\n');

// Output
console.log(entry);

if (!isDryRun && outputFile) {
  let existing = '';
  if (existsSync(outputFile)) {
    existing = readFileSync(outputFile, 'utf8');
  }

  // Prepend new entry below the top-level heading (if present) or at the top
  const headingMatch = existing.match(/^(# .+\n(?:\n[^\n]*\n)*\n)/);
  let updated;
  if (headingMatch) {
    updated = headingMatch[1] + entry + '\n---\n\n' + existing.slice(headingMatch[1].length);
  } else {
    updated = entry + (existing ? '\n---\n\n' + existing : '');
  }

  writeFileSync(outputFile, updated, 'utf8');
  console.error(`\n[release-notes] Written to ${outputFile}`);
}
