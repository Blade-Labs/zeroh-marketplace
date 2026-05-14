---
name: mask-review
description: Scan a draft text passage for sensitive data (PII, credit cards, IBANs, secrets) before pasting it into a chat with an external model. Use when the user asks "is this safe to paste", "scan this for leaks", "what would zeroh mask in this", or supplies a block of text to review. Reports the categories and positions of detected items and provides a tokenized rewrite, without echoing the raw values back.
---

# mask-review

You are asked to identify sensitive content in a text passage and report what ZeroH Mask would redact, then provide a tokenized rewrite the user can paste into an external AI tool safely.

## How to run

1. Capture the passage the user gave you (do not paraphrase or echo it back yet).
2. Use the `Bash` tool to run the detector against the passage:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/mask-review/scan.js" <<'ZEROH_END_OF_INPUT'
<passage goes here verbatim>
ZEROH_END_OF_INPUT
```

3. Display the script's output verbatim inside a fenced code block. Do not add commentary or interpretation. The script returns a structured summary (categories, counts) and the tokenized rewrite.
4. If the user asks for the original back, refuse — the point is to keep them from echoing the raw values to the model.

## Notes

- The detector is the same one used by the auto-block hook, so what the skill reports is exactly what would have triggered a block on submission.
- The tokenized rewrite uses deterministic tokens, so the same value gets the same token across passages within the session.
