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
if "mix:" in text:
    hits.append("mix: is superseded; prefer standards or the minimal local vocab only.")
if "oscalm:PairwiseMapping" in text:
    hits.append("Use sssom:Mapping for the pairwise operational layer.")
if "skos:exactMatch" in text:
    hits.append("Confirm exact-match semantics carefully before using skos:exactMatch; do not use it as a casual synonym.")
if hits:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "Ontology/mapping review warning for {}:\\n- {}".format(path, "\\n- ".join(hits))
        }
    }))
else:
    print("{}")
