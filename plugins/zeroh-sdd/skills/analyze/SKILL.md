---
name: analyze
description: Audit a plan, active stage, or implementation slice for SDD contract drift.
---

# analyze

Start with deterministic checks:

```bash
zeroh-sdd check --plan <plan>
zeroh-sdd doctor --plan <plan>
zeroh-sdd stage status
```

Then inspect:

- stage surfaces vs changed files
- proof command vs claimed proof
- shape_gate vs discovered shapes and parse boundaries
- AP envelopes that were ignored
- receipt rows and next-step adjustments

Report P0/P1 findings first, with concrete file paths and the smallest repair loop.
