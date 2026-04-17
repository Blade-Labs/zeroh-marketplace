#!/usr/bin/env python3
import json, pathlib, sys

payload = json.load(sys.stdin)
tool_input = payload.get("tool_input", {}) if isinstance(payload, dict) else {}

candidates = []
if isinstance(tool_input, dict):
    for key in ("file_path", "path", "target_file", "filename"):
        v = tool_input.get(key)
        if isinstance(v, str):
            candidates.append(v)

path = None
for c in candidates:
    p = pathlib.Path(c)
    if p.exists() and p.is_file():
        path = p
        break

if not path:
    print("{}")
    sys.exit(0)

text = path.read_text(encoding="utf-8", errors="ignore")
hits = []
checks = {
    ".catchall(": "Avoid Zod catchalls in this repo's CWA posture.",
    '"additionalProperties": true': "Avoid permissive JSON Schema; CWA requires closed objects.",
    "mix:": "The old mix: namespace is superseded; prefer standards and the minimal local vocab only when justified.",
    "oscalm:PairwiseMapping": "Operational pairwise mappings should use sssom:Mapping, not a custom pairwise class.",
}
for needle, msg in checks.items():
    if needle in text:
        hits.append(msg)

if hits:
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "CWA review warning for {}:\\n- {}".format(path, "\\n- ".join(hits))
        }
    }
    print(json.dumps(out))
else:
    print("{}")
