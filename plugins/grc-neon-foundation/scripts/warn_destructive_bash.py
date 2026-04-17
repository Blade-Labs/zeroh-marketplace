#!/usr/bin/env python3
# PostToolUse hook (JIT-injection) — detects destructive Bash commands AFTER
# they execute and injects a warning into the next-turn system reminder.
# Does NOT block. Per AGENTS.md §6: hooks are JIT-injection, not blocking.
import json, re, sys

payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
tool_input = payload.get("tool_input", {}) if isinstance(payload, dict) else {}
cmd = ""
if isinstance(tool_input, dict):
    cmd = tool_input.get("command") or tool_input.get("cmd") or ""

patterns = [
    (r"\brm\s+-rf\s+/", "rm -rf on an absolute path"),
    (r"\bgit\s+push\s+--force(-with-lease)?\s+origin\s+(main|master)\b", "git push --force to main/master"),
    (r"\bgit\s+reset\s+--hard\b", "git reset --hard (discards uncommitted changes)"),
    (r"\bgit\s+clean\s+-f.*d\b", "git clean -fd (removes untracked files)"),
    (r"\bDROP\s+DATABASE\b", "SQL DROP DATABASE"),
    (r"\bTRUNCATE\s+TABLE\b", "SQL TRUNCATE TABLE"),
    (r"\bcurl\b.*\|\s*(sh|bash)\b", "curl | sh (remote-script execution)"),
]
hits = [label for pat, label in patterns if re.search(pat, cmd)]
if not hits:
    sys.exit(0)

message = (
    "Destructive Bash command just executed: `" + cmd.strip() + "`. "
    "Matched: " + ", ".join(hits) + ". "
    "This class of op is irreversible; verify intent before the next turn. "
    "If the effect was wrong, stop and reach for `git reflog` / backup restore "
    "BEFORE any further work. Per AGENTS.md §6 hooks do not block — this is a "
    "teaching reminder, not a revert."
)
out = {
    "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": message,
    }
}
print(json.dumps(out))
