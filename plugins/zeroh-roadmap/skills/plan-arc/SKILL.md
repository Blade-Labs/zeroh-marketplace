---
name: "Plan Arc"
description: "Agree outcomes, assumptions and scope; detail the next two phases and defer later criteria explicitly."
user-invocable: true
---

# Plan Arc

Read the repository and existing product/design decisions first. Reuse the selected architect and developer/phase-executor harness/model choices; preserve their canonical reference with the arc so fresh workers keep the intended split. Follow `../../MULTI-DRIVER.md` for native versus explicitly authorized cross-harness dispatch; do not infer all roles inherit the current session model. Reuse supplied intent and authorization. Ask only consequential unknowns: first useful behavior, platforms now, non-goals, constraints and acceptance. Do not repeat a PRD interview already answered in Greenfield or project guidance.

1. Record the arc's observable acceptance criteria, scope boundaries, assumptions, budget and canonical design/PRD references in its typed record. Use the installed consumer schema and examples; do not invent fields. In the small schema, put budget boundaries and canonical document paths in `intent`/`scope` rather than adding bespoke fields. Preserve the user's outcome language. Cross-check the original request and referenced designs for promises omitted from the proposed criteria; internal ID coverage alone cannot detect a missing promise. A proxy or narrowed promise needs an explicit owner ruling.
2. Choose the smallest user journeys that deliver independently testable value. Detail **two phases at most by default**; one is sufficient for a small arc. Existing fully planned arcs remain valid. Keep later criteria as deferred outcomes with stable IDs, not speculative tasks or reserved phase numbers. Every original criterion has visible coverage through one or more phases' `criteria` and/or explicit `planning.deferredCriteria`. Deferred IDs are unique; multiple phases may contribute, and partial implementation is not final acceptance. `planning.windowSize` controls the window; do not silently omit original IDs.
3. Resolve only load-bearing choices needed for the next window. Inspect and reuse existing architecture/design. Consult an architect for a material new seam and a designer for a substantive new user flow; ordinary implementation choices do not require another user approval. An unresolved choice outside scope stays blocked rather than becoming invented consent.
4. Reserve numbers for the detailed window only using `roadmap claim --count <N>`. Use `plan-phase` for each, naming dependencies and creating tasks for future symbols. Review the window independently with `review-phase`; one reviewer can cover the small window. Avoid duplicate mechanical and judgment lanes.
5. Commit the agreed criteria and legitimate owner ratifications before starting execution. Record the immutable approved-intent Git reference required by the schema. It must point to the actual approved record, not a baseline reconstructed from already edited implementation. Validate both arc and phases with `roadmap phase validate <path>` before queueing. A missing loader or invalid baseline blocks queueing; a hook message does not replace this check.
6. Queue only ready detailed phases and report deferred outcomes plainly. Do not write an execution-prompt document duplicating the arc. The typed arc and linked canonical decisions are the handoff.

After executing the window, `do-arc` replans the next window from observed results inside these same boundaries. An empty detailed queue with deferred criteria is still executing. Changing scope, acceptance or the spending boundary requires an owner decision; implementation tactics within approved scope do not.

For an authorized sequence of arcs, agree the delivery target and per-arc, stacked or batch PR grouping once; preserve that decision in the plan or linked guidance. Follow `../../MULTI-DRIVER.md` for worktree ownership and landing order. Delivery grouping does not change product scope or allow unfinished acceptance to be marked done.

For migrated records, also read `extensions.roadmapMigration.original` and its preserved source for task steps, acceptance details and owner rulings. Those requirements remain relevant; legacy execution-engine settings are historical metadata.

Consult relevant recent notes in `<root>/arc-evals/` for recurring execution problems and useful lessons; apply only lessons that fit this arc.
