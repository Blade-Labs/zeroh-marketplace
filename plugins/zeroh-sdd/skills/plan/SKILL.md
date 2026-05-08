---
name: plan
description: Convert clarified intent into a short execution plan and then compose execution-spec for the current proof gate.
---

# plan

Use this only for the planning layer above `execution-spec`.

Output:

- current slice
- why this slice is first
- surfaces expected to change
- proof command
- shape gate expectations
- risks that would trigger replan

Then compose `execution-spec`. The detailed machine contract belongs in the fenced `sdd` block, not scattered prose.
