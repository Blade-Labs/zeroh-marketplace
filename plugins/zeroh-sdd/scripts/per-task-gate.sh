#!/usr/bin/env bash
# per-task-gate.sh — Run lint + typecheck on files modified since last commit
# Called by speckit-implement after each task completion.
# Non-blocking: reports results but doesn't prevent continuation.
set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

# Get files modified since last commit
modified=$(git diff --name-only HEAD 2>/dev/null || git diff --name-only 2>/dev/null || echo "")
if [[ -z "$modified" ]]; then
  echo "✅ No modified files to check."
  exit 0
fi

# Filter to checkable files
ts_files=$(echo "$modified" | grep -E '\.(ts|tsx|js|jsx)$' || true)
if [[ -z "$ts_files" ]]; then
  echo "✅ No TypeScript/JavaScript files modified."
  exit 0
fi

echo "🔍 Per-task gate: checking $(echo "$ts_files" | wc -l | tr -d ' ') file(s)..."

errors=0

# Try biome first (fastest)
if command -v biome &>/dev/null || [[ -f "node_modules/.bin/biome" ]]; then
  echo ""
  echo "── Biome check ──"
  echo "$ts_files" | xargs npx biome check --no-errors-on-unmatched 2>&1 || errors=$((errors + 1))

# Fall back to eslint
elif command -v eslint &>/dev/null || [[ -f "node_modules/.bin/eslint" ]]; then
  echo ""
  echo "── ESLint check ──"
  echo "$ts_files" | xargs npx eslint --no-error-on-unmatched-pattern 2>&1 || errors=$((errors + 1))
fi

# TypeScript check (if tsconfig exists)
if [[ -f "tsconfig.json" ]]; then
  echo ""
  echo "── TypeScript check ──"
  npx tsc --noEmit 2>&1 | head -30 || errors=$((errors + 1))
fi

echo ""
if [[ $errors -eq 0 ]]; then
  echo "✅ Per-task gate passed."
else
  echo "❌ Per-task gate found $errors issue(s). Fix before proceeding to next task."
fi

exit 0
