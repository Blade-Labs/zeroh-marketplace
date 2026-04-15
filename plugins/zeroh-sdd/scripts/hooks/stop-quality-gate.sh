#!/usr/bin/env bash
# stop-quality-gate.sh — Stop hook: cross-file quality scan
# Scans modified files for quality violations. Configurable severity (warn/block).
# Runs alongside stop-check.sh — any block = merged block.
set -uo pipefail

cat > /dev/null  # discard stdin

# Skip in CI
[[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"
SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read severity config
CONFIG_FILE="$SCRIPT_DIR/context/stop-gate-config.md"
get_severity() {
  local check="$1"
  if [[ -f "$CONFIG_FILE" ]]; then
    grep -E "^\| *${check} *\|" "$CONFIG_FILE" 2>/dev/null | sed 's/.*| *\(warn\|block\) *|.*/\1/' | head -1
  fi
  echo "warn"  # default
}

warnings=""
blocks=""

# Get files modified in this session (committed + uncommitted on feature branch)
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
[[ "$branch" == "main" || "$branch" == "master" || "$branch" == "HEAD" ]] && exit 0

# Collect modified .shape.ts files
shape_files=$(git diff --name-only HEAD~10..HEAD 2>/dev/null | grep '\.shape\.ts$' || true)
shape_files="$shape_files
$(git diff --name-only 2>/dev/null | grep '\.shape\.ts$' || true)"
shape_files=$(echo "$shape_files" | sort -u | grep -v '^$')

# Check: shapes without .meta()
if [[ -n "$shape_files" ]]; then
  missing_meta=""
  while IFS= read -r f; do
    [[ -f "$f" ]] && ! grep -q '\.meta(' "$f" 2>/dev/null && missing_meta="$missing_meta\n  - $f"
  done <<< "$shape_files"

  if [[ -n "$missing_meta" ]]; then
    severity=$(get_severity "missing-meta")
    msg="Shape files without .meta():$missing_meta"
    if [[ "$severity" == "block" ]]; then
      blocks="$blocks\n$msg"
    else
      warnings="$warnings\n$msg"
    fi
  fi
fi

# Collect modified .ts files that import shapes
ts_files=$(git diff --name-only HEAD~10..HEAD 2>/dev/null | grep '\.ts$' | grep -v '\.shape\.ts$' | grep -v '\.test\.' | grep -v '\.spec\.' || true)

# Check: files importing shapes without safeParse
if [[ -n "$ts_files" ]]; then
  unwired=""
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    if grep -q 'Schema.*from\|from.*shapes' "$f" 2>/dev/null; then
      if ! grep -qE 'safeParse|\.parse\(|validatedParse' "$f" 2>/dev/null; then
        unwired="$unwired\n  - $f"
      fi
    fi
  done <<< "$ts_files"

  if [[ -n "$unwired" ]]; then
    severity=$(get_severity "unwired-shapes")
    msg="Files importing shapes without validation:$unwired"
    if [[ "$severity" == "block" ]]; then
      blocks="$blocks\n$msg"
    else
      warnings="$warnings\n$msg"
    fi
  fi
fi

# Collect modified test files
test_files=$(git diff --name-only HEAD~10..HEAD 2>/dev/null | grep -E '\.(test|spec)\.' || true)

# Check: tests without @covers/@spec
if [[ -n "$test_files" ]]; then
  missing_covers=""
  while IFS= read -r f; do
    [[ -f "$f" ]] && ! grep -qE '@covers|@spec' "$f" 2>/dev/null && missing_covers="$missing_covers\n  - $f"
  done <<< "$test_files"

  if [[ -n "$missing_covers" ]]; then
    severity=$(get_severity "missing-covers")
    msg="Test files without @covers/@spec:$missing_covers"
    if [[ "$severity" == "block" ]]; then
      blocks="$blocks\n$msg"
    else
      warnings="$warnings\n$msg"
    fi
  fi
fi

# No issues found
[[ -z "$warnings" && -z "$blocks" ]] && exit 0

# Build output
if [[ -n "$blocks" ]]; then
  reason="Quality gate BLOCKED:$(printf "$blocks")"
  [[ -n "$warnings" ]] && reason="$reason\n\nAdditional warnings:$(printf "$warnings")"
  printf '{"decision":"block","reason":"%s"}' "$(printf "$reason" | sed 's/"/\\"/g' | tr '\n' ' ')"
else
  # Warnings only — inject as context, don't block
  context="Quality gate warnings:$(printf "$warnings")\n\nEdit scripts/hooks/context/stop-gate-config.md to promote warnings to blocks."
  escaped=$(printf "$context" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null)
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"Stop\",\"additionalContext\":$escaped}}"
fi
