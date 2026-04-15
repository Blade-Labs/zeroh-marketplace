#!/usr/bin/env bash
# PostToolUse hook: commit hygiene reminder
#
# Counts uncommitted files via git status --porcelain and injects a reminder
# when the count exceeds THRESHOLD.  Exits 0 silently when below threshold or
# when git is unavailable.  Never exits 2 (non-blocking PostToolUse hook).

set -euo pipefail

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THRESHOLD=3

# ---------------------------------------------------------------------------
# 1. Read and discard stdin (required by hook protocol; input not needed here)
# ---------------------------------------------------------------------------
cat > /dev/null

# ---------------------------------------------------------------------------
# 2. Count uncommitted files
# ---------------------------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  exit 0
fi

uncommitted_count=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

(( uncommitted_count < THRESHOLD )) && exit 0

# ---------------------------------------------------------------------------
# 3. Load template and substitute placeholders
# ---------------------------------------------------------------------------
template_file="$SCRIPT_DIR/context/commit-hygiene.md"

if [[ ! -f "$template_file" ]]; then
  exit 0
fi

template=$(cat "$template_file")
message="${template//\{\{uncommittedCount\}\}/$uncommitted_count}"
message="${message//\{\{threshold\}\}/$THRESHOLD}"

# ---------------------------------------------------------------------------
# 4. JSON-escape and emit hookSpecificOutput
# ---------------------------------------------------------------------------
escaped=$(printf '%s' "$message" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")

printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' "$escaped"
