#!/usr/bin/env bash
# Pre-review automated checks — catches mechanical issues before agent review.
# Run: bash scripts/pre-review.sh <first-commit-sha>
#
# Eliminates 40-50% of typical agent findings (missing tests, banned patterns,
# duplicate utilities, orphaned @contract tags) at near-zero cost.

set -euo pipefail

BASE="${1:-HEAD~1}"
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

fail() { echo -e "${RED}FAIL:${NC} $1"; ERRORS=$((ERRORS+1)); }
warn() { echo -e "${YELLOW}WARN:${NC} $1"; WARNINGS=$((WARNINGS+1)); }
pass() { echo -e "${GREEN}  OK:${NC} $1"; }

echo "=== Pre-Review Checks (diff from $BASE) ==="
echo

# ── 1. New lib/services/ files must have test files ───────────────────────────
echo "--- New service files need tests ---"
for f in $(git diff --name-only --diff-filter=A "$BASE"..HEAD -- 'lib/services/*.ts' 'lib/business-rules/*.ts' | grep -v __tests__); do
  basename=$(basename "$f" .ts)
  dir=$(dirname "$f")
  test_file="$dir/__tests__/$basename.test.ts"
  if [ -f "$test_file" ]; then
    pass "$f → $test_file exists"
  else
    fail "$f has no test file at $test_file"
  fi
done

# ── 2. No fs.readFileSync in API routes ───────────────────────────────────────
echo "--- No fs.readFileSync in API routes ---"
if grep -rn "fs\.readFileSync\|fs\.readFile\b" app/api/ --include="*.ts" --include="*.tsx" 2>/dev/null; then
  fail "fs.readFileSync in API route — use import for JSON (standalone build won't bundle runtime reads)"
else
  pass "No fs.readFileSync in API routes"
fi

# ── 3. No toBeCloseTo on exact arithmetic ─────────────────────────────────────
echo "--- Check toBeCloseTo usage ---"
matches=$(grep -rn "toBeCloseTo" lib/**/__tests__/*.ts 2>/dev/null || true)
if [ -n "$matches" ]; then
  warn "toBeCloseTo found — verify these aren't masking rounding bugs on exact values:"
  echo "$matches" | head -5
else
  pass "No toBeCloseTo in service tests"
fi

# ── 4. @contract tags have @spec tests ────────────────────────────────────────
echo "--- @contract tags have @spec coverage ---"
if [ -f "compliance/scripts/check-contract-specs.ts" ]; then
  if npx tsx compliance/scripts/check-contract-specs.ts 2>/dev/null; then
    pass "@contract/@spec alignment verified"
  else
    fail "Orphaned @contract tags without @spec tests"
  fi
else
  pass "@contract spec check script not found (skipped)"
fi

# ── 5. New @contract tags in diff ─────────────────────────────────────────────
echo "--- New @contract tags ---"
new_tags=$(git diff "$BASE"..HEAD -- 'lib/' | grep "^+" | grep "@contract" | grep -v "^+++" || true)
if [ -n "$new_tags" ]; then
  warn "New @contract tags added — verify relationship and confidence:"
  echo "$new_tags" | head -10
fi

# ── 6. No duplicate utility functions ─────────────────────────────────────────
echo "--- Check for duplicate utilities ---"
for f in $(git diff --name-only --diff-filter=AM "$BASE"..HEAD -- '*.ts' '*.tsx' | grep -v __tests__ | grep -v node_modules); do
  # Extract new function names
  new_fns=$(git diff "$BASE"..HEAD -- "$f" | grep "^+.*function " | sed 's/.*function \([a-zA-Z_]*\).*/\1/' | grep -v "^$" || true)
  for fn in $new_fns; do
    # Check if function name exists elsewhere in lib/utils/ or lib/services/
    existing=$(grep -rn "function $fn\b" lib/utils/ lib/services/ --include="*.ts" 2>/dev/null | grep -v "$f" | head -1 || true)
    if [ -n "$existing" ]; then
      warn "Function '$fn' in $f may duplicate: $existing"
    fi
  done
done

# ── 7. DB queries outside try/catch in API routes ─────────────────────────────
echo "--- DB queries in API routes ---"
for f in $(git diff --name-only --diff-filter=AM "$BASE"..HEAD -- 'app/api/**/route.ts'); do
  if grep -q "await db\." "$f" 2>/dev/null; then
    # Check if there's a try/catch wrapping it
    if ! grep -q "try {" "$f" 2>/dev/null; then
      fail "$f has DB queries without try/catch"
    else
      pass "$f has DB queries with try/catch"
    fi
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo "=== Summary ==="
echo -e "Errors: ${RED}${ERRORS}${NC}  Warnings: ${YELLOW}${WARNINGS}${NC}"
if [ "$ERRORS" -gt 0 ]; then
  echo -e "${RED}Fix errors before running agent review.${NC}"
  exit 1
else
  echo -e "${GREEN}Pre-review checks passed.${NC}"
  exit 0
fi
