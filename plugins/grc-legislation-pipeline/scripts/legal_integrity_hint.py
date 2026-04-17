#!/usr/bin/env python3
import json, pathlib, sys

payload = json.load(sys.stdin)
tool_input = payload.get("tool_input", {}) if isinstance(payload, dict) else {}
path = None
if isinstance(tool_input, dict):
    for key in ("file_path", "path", "target_file", "filename"):
        v = tool_input.get(key)
        if isinstance(v, str):
            p = pathlib.Path(v)
            if p.exists() and p.is_file():
                path = p
                break

if not path:
    print("{}")
    sys.exit(0)

text = path.read_text(encoding="utf-8", errors="ignore")
hits = []
if "normType" in text:
    hits.append("Do not reintroduce a flattened normType taxonomy. Keep statement class, deontic class, and routing class separate.")
for field in ("sourceProvision", "sourceText", "jurisdiction"):
    if "NormalizedLegalStatement" in text and field not in text:
        hits.append(f"Normalized legal statement work should preserve explicit {field}.")
if hits:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "Legislation pipeline reminder for {}:\\n- {}".format(path, "\\n- ".join(hits))
        }
    }))
else:
    print("{}")
