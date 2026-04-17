#!/usr/bin/env python3
# PostToolUse hook (JIT-injection) — detects destructive Fuseki / Jena /
# TDB2 admin commands in a just-executed Bash command. Never blocks.
# Per AGENTS.md §6: hooks are JIT-injection, not blocking.
# Pairs with the repo-scoped fuseki-jena skill (which refuses Oxigraph /
# in-memory / pyshacl reaching BEFORE execution).
import json, re, sys

payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
tool_input = payload.get("tool_input", {}) if isinstance(payload, dict) else {}
cmd = ""
if isinstance(tool_input, dict):
    cmd = tool_input.get("command") or tool_input.get("cmd") or ""

patterns = [
    (r"/\$/datasets/[^\s/]+\b.*\b(DELETE|curl.*-X\s+DELETE)\b", "Graph Store DELETE on a Fuseki dataset (drops the whole dataset)"),
    (r"\btdb2\.[a-z]+\b.*\b(delete|drop|compact|xloader)\b", "TDB2 admin op (delete/drop/compact/xloader)"),
    (r"\brm\s+-rf\b.*(fuseki|tdb|dataset)", "filesystem removal of Fuseki / TDB / dataset dir"),
    (r"fuseki-server\b.*--delete\b", "fuseki-server --delete (removes persistent dataset)"),
    (r"curl\b.*-X\s+(DELETE|POST).*/\$/datasets", "Fuseki /$/datasets admin endpoint op (create/delete/reset)"),
]
hits = [label for pat, label in patterns if re.search(pat, cmd, re.IGNORECASE)]
if not hits:
    sys.exit(0)

message = (
    "Fuseki / Jena / TDB2 admin-level op just executed: `" + cmd.strip() + "`. "
    "Matched: " + ", ".join(hits) + ". "
    "Dataset-level DELETE / DROP / reset affects the whole admitted corpus. "
    "If this was part of a dev-reset, verify the next `pnpm fuseki:bootstrap` "
    "replays cleanly before doing any phase work. Per AGENTS.md §6 this is a "
    "teaching reminder, not a revert."
)
out = {
    "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": message,
    }
}
print(json.dumps(out))
