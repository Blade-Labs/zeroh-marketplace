#!/usr/bin/env bash
# PreToolUse hook: stage-write-guard
#
# Enforces per-stage path allowlists declared in the consuming repo's
# .specify/workflows/active-stage.json. If a Write|Edit tool call targets
# a path outside the active stage's allowlist, the hook returns
# permissionDecision="deny" so Claude Code blocks the write.
#
# Reads .specify/workflows/active-stage.json from the repo root (resolved
# via CLAUDE_PROJECT_DIR). If the file is absent, the hook exits silently
# (no active stage → no guard applies).
#
# Ported 2026-04-24 from Blade-Labs/grc-zod-alpha-audit .claude/hooks/
# stage-write-guard.sh per Phase C of the hook-consolidation sprint.
# Rewrites common.sh helpers inline per plugin convention (node for JSON
# parse, inline python3 for shape + escape).
#
# Non-blocking on parse errors: if the JSON is malformed, the hook emits
# deny with a diagnostic reason so the user can fix it.

set -euo pipefail

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STAGE_FILE="$PROJECT_DIR/.specify/workflows/active-stage.json"
TEMPLATE_PATH="$SCRIPT_DIR/context/stage-write-guard.md"

# No active stage → nothing to guard → silent exit.
[[ -f "$STAGE_FILE" ]] || exit 0

# ---------------------------------------------------------------------------
# 1. Parse stdin: extract file_path from Claude Code hook JSON
# ---------------------------------------------------------------------------
input=$(cat)
file_path=$(echo "$input" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf-8'));
  console.log(d.tool_input?.file_path || '');
" 2>/dev/null || echo "")

# No file_path → silent exit (hook called for a non-path tool).
[[ -n "$file_path" ]] || exit 0

# ---------------------------------------------------------------------------
# 2. Python allowlist check (exact or prefix match against state.allowedPaths)
# ---------------------------------------------------------------------------
guard_output=$(python3 - "$PROJECT_DIR" "$STAGE_FILE" "$file_path" <<'PY'
import json, pathlib, sys

repo_root = pathlib.Path(sys.argv[1]).resolve()
stage_path = pathlib.Path(sys.argv[2]).resolve()
file_path = pathlib.Path(sys.argv[3]).resolve()

try:
    state = json.loads(stage_path.read_text())
except Exception:
    print("DENY")
    print("unknown")
    print(str(file_path).replace("\\", "/"))
    print("- invalid .specify/workflows/active-stage.json")
    sys.exit(0)

try:
    rel = file_path.relative_to(repo_root).as_posix()
except ValueError:
    rel = file_path.as_posix()

allowed = state.get("allowedPaths", [])
stage = state.get("stage", "unknown")

def allows(rule):
    path = str(rule.get("path", "")).replace("\\", "/")
    mode = rule.get("mode", "exact")
    if not path:
        return False
    if mode == "prefix":
        prefix = path if path.endswith("/") else path + "/"
        return rel == prefix[:-1] or rel.startswith(prefix)
    return rel == path

if any(allows(rule) for rule in allowed):
    print("ALLOW")
    sys.exit(0)

rendered = []
for rule in allowed:
    path = str(rule.get("path", "")).replace("\\", "/")
    mode = str(rule.get("mode", "exact"))
    rendered.append(f"- {mode}: {path}")

if not rendered:
    rendered = ["- (none)"]

print("DENY")
print(stage)
print(rel)
print("\n".join(rendered))
PY
)

# ---------------------------------------------------------------------------
# 3. Dispatch on decision
# ---------------------------------------------------------------------------
decision=$(printf '%s\n' "$guard_output" | sed -n '1p')
[[ "$decision" == "ALLOW" ]] && exit 0

stage_name=$(printf '%s\n' "$guard_output" | sed -n '2p')
attempted_path=$(printf '%s\n' "$guard_output" | sed -n '3p')
allowed_block=$(printf '%s\n' "$guard_output" | tail -n +4)

# ---------------------------------------------------------------------------
# 4. Render template (inline — no common.sh dependency)
# ---------------------------------------------------------------------------
if [[ -f "$TEMPLATE_PATH" ]]; then
  message=$(python3 -c "
import sys, pathlib
tmpl = pathlib.Path(sys.argv[1]).read_text()
for kv in sys.argv[2:]:
    if '=' not in kv:
        continue
    k, _, v = kv.partition('=')
    tmpl = tmpl.replace('{{' + k + '}}', v)
print(tmpl)
" "$TEMPLATE_PATH" \
    "STAGE=$stage_name" \
    "ATTEMPTED=$attempted_path" \
    "ALLOWED=$allowed_block")
else
  message="Stage guard blocked a write to $attempted_path during stage $stage_name."
fi

# ---------------------------------------------------------------------------
# 5. Emit hookSpecificOutput with permissionDecision="deny"
# ---------------------------------------------------------------------------
escaped_message=$(printf '%s' "$message" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
reason_text="Write blocked by active stage guard ($stage_name)."
escaped_reason=$(printf '%s' "$reason_text" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s,"additionalContext":%s}}\n' \
  "$escaped_reason" "$escaped_message"
