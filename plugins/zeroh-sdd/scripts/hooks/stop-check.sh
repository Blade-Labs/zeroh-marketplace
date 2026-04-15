#!/usr/bin/env bash
# stop-check.sh — Stop hook: block premature completion
# Fires when Claude is about to stop. Blocks if tracked files have uncommitted changes.
# Ignores untracked files — those aren't agent work product.
set -euo pipefail

# Discard stdin (Stop hook sends event metadata, not tool input)
cat > /dev/null

# Skip in CI
[[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

# Count uncommitted TRACKED files only (exclude untracked ?? lines)
uncommitted=$(git status --porcelain 2>/dev/null \
  | grep -v '^??' \
  | wc -l | tr -d ' ')
[[ "$uncommitted" -eq 0 ]] && exit 0

# Allow stopping on main/master (no feature work expected)
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
[[ "$branch" == "main" || "$branch" == "master" || "$branch" == "HEAD" ]] && exit 0

# Block with actionable reason
cat <<STOP_JSON
{"decision":"block","reason":"${uncommitted} uncommitted file(s) on branch '${branch}'. Commit or stash before stopping."}
STOP_JSON
