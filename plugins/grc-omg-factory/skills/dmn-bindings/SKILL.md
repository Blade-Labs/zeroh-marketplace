---
name: dmn-bindings
description: Bind normalized statements and routing outputs into deterministic DMN population targets and decision-table structure.
when_to_use: Use for evaluative rules, thresholds, gating logic, or admissibility questions that belong in DMN.
allowed-tools: Read Grep Glob Bash
---
Create or review DMN bindings.

Rules:
- do not invent DMN targets not named by policy
- preserve traceability to source statements and mappings
- keep FEEL expressions explicit and checkable
- prefer deterministic inputs and outputs over vague prose
