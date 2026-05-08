---
name: implement
description: Execute the active SDD stage without escaping its allowed surface.
---

# implement

Implementation is execution of the active proof gate, not free-form cleanup. Stay inside `.specify/workflows/active-stage.json` and let the proof command decide whether the slice is complete.

## Before Editing

1. Confirm `.specify/workflows/active-stage.json` exists.
2. Read the active plan and proof command.
3. Re-run Step N.0 mentally against the repo: do the files exist, which findings close, is the proof runnable, and does this slice prove behavior rather than a checker-only placeholder?
4. Stay inside `allowedPaths`.

## During Implementation

- preserve RED evidence; do not weaken tests or shapes
- parse untrusted inputs with the declared shape at the declared boundary
- keep shape imports value-level only where runtime parsing occurs
- preserve `.describe()`, `.meta()`, provenance, acceptance criteria, and refinements unless the receipt explains why they changed
- use AP envelopes as local repair prompts; `_fix.prompt` is the canonical minimal repair payload
- keep AP, shape, and error-chain warnings advisory unless the active stage declares them as proof gates
- separate current-edit findings from branch-baseline findings; do not treat pre-existing branch noise as caused by this edit
- if an AP finding changes scope, stop and record it as opened in the receipt or replan
- run the active proof command before finishing

## Error And Boundary Discipline

When editing API, CLI, file, or integration boundaries:

- do not cast unknown data with `as T` when a shape exists
- do not turn upstream errors into generic strings
- preserve RFC-style problem details, trace/correlation identifiers, and remediation text when the repo has that convention
- prefer a structured `_fix.prompt` remediation over vague "handle error" prose

## After Proof

```bash
zeroh-sdd stage finish --status passed \
  --proof-result "<command => pass>" \
  --changed "<path>" \
  --closed "<finding-id>" \
  --next-adjustment "<next slice from receipt>"
```

If proof fails, finish with `--status failed` or `--status blocked` only when the receipt names the failure scope and next adjustment. Use `branch-health-followup` language for branch-baseline findings that are unrelated to the current edit. Do not move to another gate from memory; the receipt is the handoff to the next execution spec.
