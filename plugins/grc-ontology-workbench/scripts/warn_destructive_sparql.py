#!/usr/bin/env python3
# PostToolUse hook (JIT-injection) — detects destructive SPARQL or direct
# admitted-graph writes in a just-executed Bash command. Never blocks.
# Per AGENTS.md §6: hooks are JIT-injection, not blocking.
# Pairs with the repo-scoped shacl-gate-enforcer skill (which fires on
# Edit-tool graph-write code BEFORE execution).
import json, re, sys

payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
tool_input = payload.get("tool_input", {}) if isinstance(payload, dict) else {}
cmd = ""
if isinstance(tool_input, dict):
    cmd = tool_input.get("command") or tool_input.get("cmd") or ""

patterns = [
    (r"\bCLEAR\s+(SILENT\s+)?(GRAPH|DEFAULT|NAMED|ALL)\b", "CLEAR on graph(s)"),
    (r"\bDROP\s+(SILENT\s+)?(GRAPH|DEFAULT|NAMED|ALL)\b", "DROP on graph(s)"),
    (r"\bDELETE\s+WHERE\s*\{\s*\?s\s+\?p\s+\?o", "wildcard DELETE WHERE { ?s ?p ?o } (matches every triple)"),
    (r"\bINSERT\s+DATA[^;]*<urn:grc:qcb:graph:admitted-", "direct INSERT DATA to an admitted-* named graph (bypasses staging-graph admission per P12)"),
]
hits = [label for pat, label in patterns if re.search(pat, cmd, re.IGNORECASE)]
if not hits:
    sys.exit(0)

message = (
    "SPARQL destructive/admitted-graph op just executed: `" + cmd.strip() + "`. "
    "Matched: " + ", ".join(hits) + ". "
    "Under P12 (staging-graph admission per ADR-013) every write lands on a "
    "staging graph, validates via @grc/validation, and server-side-promotes. "
    "Direct writes or destructive ops on admitted graphs bypass the gate. "
    "If this was an admitted-graph CLEAR/DROP, the next turn should verify the "
    "snapshot restore plan before proceeding. Per AGENTS.md §6 this is a "
    "teaching reminder, not a revert."
)
out = {
    "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": message,
    }
}
print(json.dumps(out))
