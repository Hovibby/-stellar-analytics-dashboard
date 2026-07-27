#!/bin/sh
# check-sync.sh
#
# Verifies that generated/derived artefacts stay in sync with their sources
# before a commit lands.  Called from .husky/pre-commit.
#
# Exit codes:
#   0 – all checks passed
#   1 – at least one out-of-sync condition detected (commit is blocked)
#
# ---------------------------------------------------------------------------
# Checks performed
# ---------------------------------------------------------------------------
#
# 1. SNAPSHOT CONSISTENCY
#    If any Vitest / Jest snapshot file (*.snap) is staged, the corresponding
#    source test file must also be staged.  Snapshots that drift from their
#    tests silently introduce false-green CI.
#
# 2. MIGRATION ↔ SCHEMA CONSISTENCY
#    If a migration file under packages/indexer/migrations/ is staged, the
#    operator must acknowledge that they have run `pnpm db:migrate` locally.
#    We cannot execute the migration here (no DB in the git hook environment)
#    but we can detect the common mistake of committing a migration without
#    also updating the human-readable schema snapshot
#    (packages/indexer/src/database/schema.sql, if it exists).
#
# 3. LOCKFILE FRESHNESS
#    If any package.json file is staged but pnpm-lock.yaml is NOT staged, warn
#    that the lockfile may be stale.  This catches the "I added a dep but
#    didn't run pnpm install" mistake before CI fails.
#
# 4. GRAPHQL SCHEMA ↔ TYPE DEFINITIONS
#    If the hand-written GraphQL SDL (packages/api/src/schema/typeDefs.ts) is
#    staged, the corresponding top-level api/src/schema.ts must also be staged,
#    and vice-versa.  The two files are kept in sync manually; this check
#    surfaces a mismatch before it reaches review.
# ---------------------------------------------------------------------------

set -e

PASS=0
FAIL=1
result=$PASS

STAGED=$(git diff --cached --name-only)

# ── Colours (no-op when stdout is not a tty) ────────────────────────────────
if [ -t 1 ]; then
  RED='\033[0;31m'
  YEL='\033[0;33m'
  GRN='\033[0;32m'
  BOLD='\033[1m'
  RST='\033[0m'
else
  RED='' YEL='' GRN='' BOLD='' RST=''
fi

warn()  { printf "${YEL}[sync-check] WARNING: %s${RST}\n" "$*" >&2; }
error() { printf "${RED}[sync-check] ERROR:   %s${RST}\n" "$*" >&2; result=$FAIL; }
info()  { printf "${GRN}[sync-check] OK:      %s${RST}\n" "$*"; }

# ── 1. Snapshot consistency ─────────────────────────────────────────────────
snapshots_staged=$(echo "$STAGED" | grep -E '__snapshots__/.*\.snap$' || true)

if [ -n "$snapshots_staged" ]; then
  echo "$snapshots_staged" | while IFS= read -r snap; do
    # Derive the expected source test path:
    #   foo/bar/__snapshots__/baz.test.ts.snap → foo/bar/baz.test.ts
    dir=$(dirname "$(dirname "$snap")")
    base=$(basename "$snap" .snap)          # baz.test.ts
    test_file="$dir/$base"

    if ! echo "$STAGED" | grep -qF "$test_file"; then
      error "Snapshot staged without its source test file."
      error "  Snapshot:  $snap"
      error "  Expected:  $test_file"
      error "  Run the tests, then stage the test file alongside the snapshot."
    fi
  done
fi

# ── 2. Migration ↔ schema.sql consistency ───────────────────────────────────
migrations_staged=$(echo "$STAGED" | grep -E '^packages/indexer/migrations/.*\.js$' || true)
schema_sql="packages/indexer/src/database/schema.sql"

if [ -n "$migrations_staged" ]; then
  # Only enforce if the schema.sql reference file actually exists in the repo.
  if [ -f "$schema_sql" ]; then
    if ! echo "$STAGED" | grep -qF "$schema_sql"; then
      error "Migration file(s) staged but $schema_sql was not updated."
      error "  Staged migration(s):"
      echo "$migrations_staged" | while IFS= read -r m; do
        error "    $m"
      done
      error "  Update $schema_sql to reflect the new schema, then stage it."
      error "  (schema.sql is a human-readable reference; migrations are the source of truth.)"
    else
      info "Migration files and schema.sql are both staged."
    fi
  else
    warn "Migration file(s) staged but $schema_sql does not exist."
    warn "  Consider adding a schema.sql snapshot for human reference."
    warn "  See docs/database-migrations.md for guidance."
  fi
fi

# ── 3. Lockfile freshness ────────────────────────────────────────────────────
pkg_json_staged=$(echo "$STAGED" | grep -E '(^|/)package\.json$' || true)
lockfile_staged=$(echo "$STAGED" | grep -E '^pnpm-lock\.yaml$' || true)

if [ -n "$pkg_json_staged" ] && [ -z "$lockfile_staged" ]; then
  # Only warn (don't hard-fail) — there are legitimate cases where package.json
  # changes (description, scripts) don't need a lockfile update.
  warn "package.json file(s) staged but pnpm-lock.yaml is NOT staged."
  warn "  If you added or changed dependencies, run: pnpm install"
  warn "  Then: git add pnpm-lock.yaml"
fi

# ── 4. GraphQL schema ↔ typeDefs sync ───────────────────────────────────────
packages_api_schema="packages/api/src/schema/typeDefs.ts"
toplevel_api_schema="api/src/schema.ts"

schema_a_staged=$(echo "$STAGED" | grep -qF "$packages_api_schema" && echo yes || true)
schema_b_staged=$(echo "$STAGED" | grep -qF "$toplevel_api_schema" && echo yes || true)

# Only enforce when both files exist (one might not be present in all checkouts)
if [ -f "$packages_api_schema" ] && [ -f "$toplevel_api_schema" ]; then
  if [ "$schema_a_staged" = "yes" ] && [ -z "$schema_b_staged" ]; then
    error "$packages_api_schema was staged but $toplevel_api_schema was not."
    error "  Keep the two GraphQL schema files in sync."
  elif [ -n "$schema_b_staged" ] && [ "$schema_b_staged" = "yes" ] && [ -z "$schema_a_staged" ]; then
    error "$toplevel_api_schema was staged but $packages_api_schema was not."
    error "  Keep the two GraphQL schema files in sync."
  elif [ "$schema_a_staged" = "yes" ] && [ "$schema_b_staged" = "yes" ]; then
    info "Both GraphQL schema files staged together."
  fi
fi

# ── Result ───────────────────────────────────────────────────────────────────
if [ "$result" -ne 0 ]; then
  printf "\n${BOLD}${RED}[sync-check] Commit blocked — fix the issues above and try again.${RST}\n\n" >&2
  exit 1
fi

exit 0
