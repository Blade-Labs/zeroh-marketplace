#!/usr/bin/env bash
# pre-compact.sh — PreCompact hook: save context before memory loss
set -uo pipefail

cat > /dev/null  # discard stdin

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

snapshot="$PROJECT_DIR/.vibe/context-snapshot.md"
mkdir -p "$PROJECT_DIR/.vibe" 2>/dev/null || true

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

cat > "$snapshot" <<SNAPSHOT
# Context Snapshot
Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Branch: $branch

## Recent Commits
$(git log --oneline -10 2>/dev/null || echo "no commits")

## Uncommitted Changes
$(git status --short 2>/dev/null || echo "clean")

## Current Task
$(if [ -d specs ]; then
  latest=$(ls -td specs/*/ 2>/dev/null | head -1)
  if [ -n "$latest" ] && [ -f "${latest}tasks.md" ]; then
    grep -m 1 '^\- \[ \]' "${latest}tasks.md" 2>/dev/null || echo "no unchecked tasks"
  else
    echo "no tasks.md"
  fi
else
  echo "no specs directory"
fi)

## Active Spec
$(if [ -d specs ]; then
  ls -td specs/*/ 2>/dev/null | head -1 || echo "none"
else
  echo "none"
fi)
SNAPSHOT

exit 0
