#!/usr/bin/env bash
# phase-context.sh — PreToolUse hook: file-type-specific JIT context injection
# Detects file type from tool_input.file_path, injects relevant checklist.
# Supports allow/deny/ask modes per file type via hook-overrides.json.
set -euo pipefail

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$SCRIPT_DIR")")}"

# ---------------------------------------------------------------------------
# 1. Parse stdin: extract file_path
# ---------------------------------------------------------------------------
input=$(cat)
file_path=$(echo "$input" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf-8'));
  console.log(d.tool_input?.file_path || d.tool_input?.content?.substring(0,0) || '');
" 2>/dev/null || echo "")

[[ -z "$file_path" ]] && exit 0

# ---------------------------------------------------------------------------
# 2. Detect file type from path
# ---------------------------------------------------------------------------
file_type=""
case "$file_path" in
  *.shape.ts)                          file_type="shape" ;;
  *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) file_type="test" ;;
  *route*.ts|*handler*.ts|*/api/*)     file_type="route" ;;
  *store*.ts|*Store*.ts)               file_type="store" ;;
  */components/*|*.tsx)                 file_type="component" ;;
esac

# No matching type — exit silently
[[ -z "$file_type" ]] && exit 0

# ---------------------------------------------------------------------------
# 3. Load checklist for this file type
# ---------------------------------------------------------------------------
checklist_file="$SCRIPT_DIR/context/checklist-${file_type}.md"
[[ ! -f "$checklist_file" ]] && exit 0

checklist=$(cat "$checklist_file")

# ---------------------------------------------------------------------------
# 4. Read override mode for this file type (default: allow)
# ---------------------------------------------------------------------------
mode="allow"

# Check project-local overrides first, then plugin default
for override_file in \
  "${CLAUDE_PROJECT_DIR:-$(pwd)}/hook-overrides.json" \
  "$PLUGIN_ROOT/hook-overrides.json"; do
  if [[ -f "$override_file" ]]; then
    override_mode=$(node -e "
      const d = JSON.parse(require('fs').readFileSync('$override_file','utf-8'));
      const pc = d['phase-context'];
      if (pc && pc.modes && pc.modes['${file_type}']) {
        console.log(pc.modes['${file_type}']);
      } else if (pc && pc.enabled === false) {
        console.log('disabled');
      }
    " 2>/dev/null || echo "")
    [[ -n "$override_mode" ]] && mode="$override_mode" && break
  fi
done

# Disabled — exit silently
[[ "$mode" == "disabled" ]] && exit 0

# ---------------------------------------------------------------------------
# 5. Output JSON based on mode
# ---------------------------------------------------------------------------
escaped=$(echo "$checklist" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null)

case "$mode" in
  deny)
    echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"additionalContext\":$escaped}}"
    ;;
  ask)
    echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"ask\",\"additionalContext\":$escaped}}"
    ;;
  *)
    # allow (default) — inject context, don't block
    echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"additionalContext\":$escaped}}"
    ;;
esac
