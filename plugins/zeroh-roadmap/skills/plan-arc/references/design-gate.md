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
Fires when the arc adds or materially changes a **user-facing surface** — a new view/page/pane, a new interaction flow, a new card type, a visibly restructured layout. Does NOT fire for a copy tweak, a non-visual fix, or a backend-only change with no rendered delta. *(The UX sub-gate contract is documented in §3.)*

### Recording a skip
If NEITHER fires, write the skip explicitly where the arc's reasoning lives (a comment in the `.arc.ts`, or the planning chat): `design gate: skipped — no new pattern / no surface (mechanical arc)`. The skip is never silent — proportionality is a recorded decision, not an absence.

## 2. The architecture reuse-or-design contract

Split the roles: the `software-architect` agent ADVISES (the gate tasks it to search the docs and recommend reuse-or-design — a search-and-recommend role, distinct from its compromise-breaking Decision Contract); the **plan-arc orchestrator** WRITES (extends the doc, records the designRef). Keep that split by gate design — the architect's output is a recommendation, the orchestrator owns every file write.

**Reuse-first is the honest default.** The architect SEARCHES the consumer's architecture doc set BEFORE designing anything:
1. **Search** the doc home (see §4 — read it from the consumer binding) for a pattern that already fits the new capability.
2. **If one fits → reuse.** The architect cites it; the orchestrator records `{ kind: 'architecture', ref: '<doc section path/anchor>', status: 'reused', summary: '<one line: what the pattern is>' }`. No new pattern is invented when one already exists. Prefer the closest-fitting existing pattern over a marginally-nicer new one — a single pattern reused beats two patterns that do almost the same thing.
3. **If none fits → design.** The architect designs the long-term-correct pattern (composable, reusable, maintainable, governed); the orchestrator then **extends the arch doc set** through the consumer's own doc governance (e.g. its canon-sync flow) so the new pattern becomes part of the canon, not a one-off, and records `{ …, status: 'designed', summary }` plus the justification for why no existing pattern fit.

**Extend a doc vs author a new section.** Extend an existing pattern's doc when the new capability is a variant/special-case of it; author a new pattern section only when the capability is genuinely new (the same reuse-vs-new judgment, one level down).

**Generalize-forward — the inverse question (asked for every new/designed pattern).** Reuse-first asks "does a pattern already exist to reuse?"; generalize-forward asks the inverse: "is what I'm building a special case of a capability that SHOULD exist for others?" The architect answers BOTH — when it is about to record a `status: 'designed'` pattern, it also asks: *if the general seam were built, what else would consume it?*
- **Discipline — the rule of three (the guard against speculative generality the `simplifier` exists to kill): generalize ONLY with ≥2 concrete near-term consumers.** With exactly one consumer, build the vertical and record the generalization as a **named backlog follow-up** (so the next similar feature folds into it instead of forking) — never abstract on speculation.
- **When ≥2 consumers earn it**, the architect designs the GENERAL seam (not the one-off), the arc's `singleSeams` widen to "this seam is consumed beyond this arc", and the member phases plan against the general seam. The architect names the concrete consumers in the recommendation so the ≥2 bar is evidenced, not asserted.
- **Consumer bias knob.** A consumer whose product thesis IS a generic substrate (e.g. "any workflow / any agent / any RAG") should bias harder toward generic — if the consumer's `CLAUDE.md` states such a bias (a "generalize-forward" / substrate note), the architect weights toward the general seam accordingly. Reuse-backward + generalize-forward (≥2-consumer-gated) are the two halves of "build a substrate, not features".

**Confirm.** The architecture design PAUSES for the user's explicit go before phase-planning continues. An unconfirmed design is not a spec — the user is the design gate. (The generalize-forward verdict — general seam vs vertical+follow-up — is part of what the user confirms here.)

The orchestrator writes every confirmed designRef onto the Arc entity (`roadmap/arcs/<id>.arc.ts` → `designRefs`) — the design spec that Step 2b plans each member phase against and `arc-sweep` judges the build's conformance to per-ref.

## 3. The UX reuse-or-design contract

Run by the `ux-designer` agent when the classifier finds a **surface**. Same advise/record split as §2: the designer ADVISES + produces the artifact; the **orchestrator** records the designRef; the **user** confirms.

**Reuse-first, within the consumer's UX canon.** The designer reads the consumer's UX standards (from the "## Design homes" binding — §4) and designs **inside** them, never a parallel design language:
1. **Search** the canon for an existing surface pattern + components that fit.
2. **If they fit → reuse.** Record `{ kind: 'ux', ref: '<layout-note path>', status: 'reused', summary }`; the layout cites the canonical pattern and reuses existing components.
3. **If none fits → design.** The designer creates the new layout (structure, hierarchy, the honest empty/loading/error/not-yet-measured states, accessibility) within the canon's idiom, and records `{ …, status: 'designed', summary }`.

**Prose layout note vs static HTML preview vs interactive prototype — the designer's call, per arc:**
- **Prose layout note** for a tweak or an extension of an existing surface — the user can picture it from what exists.
- **Static HTML preview** for a **net-new single-state** surface, where seeing it beats reading about it (produced with the `frontend-design` skill where available). `ref` then points at the preview file.
- **Interactive prototype** for a net-new surface with 2+ sequential states (funnel, wizard, stepper) — one live click-through page with real transitions and a designer rail for the failure states.

Pick the lightest option that lets the user actually judge the design. The UX designRef is then **confirmed by the user** (Step 1b pauses) and **recorded by the orchestrator** onto the arc — same as the architecture designRef.

**The craft bar.** Whatever the form, the artifact must meet `references/ux-craft.md` (same directory as this file) — identity fidelity (REAL webfonts loaded, the consumer's real logo/icon assets, tokens verbatim, type roles honored), the say-it-once restraint doctrine with an explicit declutter pass, the consumer's copy rules, honest-artifact rules (no fake screenshots, no placeholder blocks), demonstrated accessibility, and exemplar conformance. **The orchestrator passes the ux-craft.md absolute path to the `ux-designer` agent in its spawn prompt** (the agent's §3b requires it), and — when the consumer's Design homes name a **quality exemplar** — names that exemplar path too.

## 4. Consumer-agnostic — the design HOMES

The plugin owns the **gate**; the consumer owns the **homes**. Neither the architecture doc set nor the UX canon path is hardcoded here — both are read from the consumer's `CLAUDE.md` "## Design homes" block (the same consumer-agnostic seam the `validate-arc` tier bindings use). A consumer that documents its design homes gets the gate for free; the plugin stays portable across repos.

**Absent block → fail loud, don't guess.** If the gate fires (new pattern / surface) but the consumer's `CLAUDE.md` has no "## Design homes" block, surface that and STOP — the sub-gate has no home to search and MUST NOT guess a doc path (guessing is exactly what the consumer-agnostic seam exists to prevent). The consumer documents its design homes first. This mirrors `validate-arc`'s missing-binding rule (an absent "## Validation tiers" block comes back as a gap, never a silent pass).
