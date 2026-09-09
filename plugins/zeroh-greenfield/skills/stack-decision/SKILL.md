---
name: stack-decision
description: Resolve a project stack choice from product constraints and existing decisions without imposing a default framework.
---

# Resolve the decision that matters

Reuse an explicit approved choice. Do not ask for a comparison or rationale the owner has already supplied.

Establish only constraints that change the choice: target platforms now, first behavior, native or offline needs, team/tool constraints and distribution. Read the relevant [examples](references/matrices.md), not every category. Recommend a fitting option with reasons; give a short alternative only for a material tradeoff. Verify changing tool support, licensing and generator instructions against current official sources when selecting them. Distinguish facts from assumptions.

Record the decision and meaningful tradeoffs in the project's existing PRD, README or ADR home. Create a separate ADR only when its value warrants one. Preserve unknowns; do not claim an example recipe proves current platform support. Return the selected stack and prerequisites to initialization or the existing project's task.
