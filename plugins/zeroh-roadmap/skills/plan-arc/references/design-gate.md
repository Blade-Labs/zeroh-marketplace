# Design-first gate — reference

The criteria and contracts behind `plan-arc` **Step 1b**. The gate runs ONCE, at the head of the arc, before any phase is planned; implementation phases plan AGAINST its confirmed output, never re-invent it inline. It is **proportionate** — triggered by what the arc introduces, honestly skipped (and recorded) for a mechanical arc.

## 1. The classifier — does the gate fire?

Two independent questions. Either one firing turns the gate on; neither firing means an explicit, recorded skip.

### New pattern? (→ architecture sub-gate)
Fires when the arc introduces something the codebase has no shape for yet:
- a **new tool** / connector / external capability (a new governed action class, a new egress);
- a **new architectural pattern** — a way of structuring code/state/flow that no existing module demonstrates;
- a **new cross-module seam** — a contract, factory, or shared type that two or more areas will depend on.

Does NOT fire for **mechanical extension** of an existing pattern: adding the Nth instance of an established shape (one more tool on an existing registry, one more field on an existing contract, one more card mirroring the established card pattern), a rename/move, a config/threshold change, a docs/test-only change. The test: *would a reviewer say "this follows the existing X pattern" — or "there is no X pattern here yet"?* The former is mechanical; the latter trips the gate.

### UX surface? (→ UX sub-gate)
Fires when the arc adds or materially changes a **user-facing surface** — a new view/page/pane, a new interaction flow, a new card type, a visibly restructured layout. Does NOT fire for a copy tweak, a non-visual fix, or a backend-only change with no rendered delta. *(The UX sub-gate contract is documented in §3, wired into Step 1b by the UX plane.)*

### Recording a skip
If NEITHER fires, write the skip explicitly where the arc's reasoning lives (a comment in the `.arc.ts`, or the planning chat): `design gate: skipped — no new pattern / no surface (mechanical arc)`. The skip is never silent — proportionality is a recorded decision, not an absence.

## 2. The architecture reuse-or-design contract

Split the roles: the `software-architect` agent ADVISES (the gate tasks it to search the docs and recommend reuse-or-design — a search-and-recommend role, distinct from its compromise-breaking Decision Contract); the **plan-arc orchestrator** WRITES (extends the doc, records the designRef). Keep that split by gate design — the architect's output is a recommendation, the orchestrator owns every file write.

**Reuse-first is the honest default.** The architect SEARCHES the consumer's architecture doc set BEFORE designing anything:
1. **Search** the doc home (see §4 — read it from the consumer binding) for a pattern that already fits the new capability.
2. **If one fits → reuse.** The architect cites it; the orchestrator records `{ kind: 'architecture', ref: '<doc section path/anchor>', status: 'reused', summary: '<one line: what the pattern is>' }`. No new pattern is invented when one already exists. Prefer the closest-fitting existing pattern over a marginally-nicer new one — a single pattern reused beats two patterns that do almost the same thing.
3. **If none fits → design.** The architect designs the long-term-correct pattern (composable, reusable, maintainable, governed); the orchestrator then **extends the arch doc set** through the consumer's own doc governance (e.g. its canon-sync flow) so the new pattern becomes part of the canon, not a one-off, and records `{ …, status: 'designed', summary }` plus the justification for why no existing pattern fit.

**Extend a doc vs author a new section.** Extend an existing pattern's doc when the new capability is a variant/special-case of it; author a new pattern section only when the capability is genuinely new (the same reuse-vs-new judgment, one level down).

**Confirm.** The architecture design PAUSES for the user's explicit go before phase-planning continues. An unconfirmed design is not a spec — the user is the design gate.

The orchestrator writes every confirmed designRef onto the Arc entity (`roadmap/arcs/<id>.arc.ts` → `designRefs`) — the design spec that, once their planes wire it, Step 2b plans each member phase against and `arc-sweep` judges the build's conformance to per-ref.

## 3. The UX reuse-or-design contract

*(Stub — filled by the UX plane, which adds the senior UX role consulted when the classifier finds a surface, the prose-vs-preview decision, and how the UX designRef is recorded + confirmed. Until then the UX sub-gate is not yet wired into Step 1b.)*

## 4. Consumer-agnostic — the design HOMES

The plugin owns the **gate**; the consumer owns the **homes**. Neither the architecture doc set nor the UX canon path is hardcoded here — both are read from the consumer's `CLAUDE.md` "## Design homes" block (the same consumer-agnostic seam the `validate-arc` tier bindings use). A consumer that documents its design homes gets the gate for free; the plugin stays portable across repos.

**Absent block → fail loud, don't guess.** If the gate fires (new pattern / surface) but the consumer's `CLAUDE.md` has no "## Design homes" block, surface that and STOP — the sub-gate has no home to search and MUST NOT guess a doc path (guessing is exactly what the consumer-agnostic seam exists to prevent). The consumer documents its design homes first. This mirrors `validate-arc`'s missing-binding rule (an absent "## Validation tiers" block comes back as a gap, never a silent pass).
