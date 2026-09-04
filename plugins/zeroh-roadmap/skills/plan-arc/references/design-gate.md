# Design-first gate - reference

The criteria and contracts behind `plan-arc` Step 1b. Run the gate ONCE, at the head of the arc, before any phase is planned; implementation phases plan AGAINST its confirmed output, never re-invent it inline. Keep it proportionate - triggered by what the arc introduces, honestly skipped (and recorded) for a mechanical arc.

## 0. Gate conduct - arm preservation at every user PAUSE (cited from Step 1b)

The user is the gate, so the ask is itself an artifact with a bar. At every PAUSE in this file (§2 confirm, §3 confirm, canonical naming, supersession):

- **Present EVERY viable arm**, including the ones you recommend against, each priced with fresh verified evidence (the command and its pasted output). The best ask contributes at least one NEW verified fact that reprices the decision, not a restatement of what the user already knows.
- **Evidence-gathering is READ-ONLY until the ruling lands.** Never commit an edit to a gate artifact, layout note, or arch doc that removes, resolves, or forecloses an arm before the user answers. Committing the elimination of an option pre-answer is self-resolution even when mechanically well-evidenced - narrowing the user's decision space is the failure, not the evidence quality.
- **Enumerate sibling artifacts at DIRECTORY level** - every variant listed by name in the ask - and put the canonical-naming question explicitly (ux-craft.md §0); never infer canon from mtime or polish.
- **User unreachable (batch/offline run):** run the sub-gate anyway and record the verdict `UNRATIFIED - user go pending` on the designRef - a recorded unratified verdict beats a skip. An UNRATIFIED ref is a named hold: no dependent phase queues (plan-arc Step 4) until the go lands.

## 1. The classifier - does the gate fire?

Ask two independent questions. Either one firing turns the gate on; neither firing means an explicit, recorded skip.

### New pattern? (→ architecture sub-gate, §2)
Fires when the arc introduces something the codebase has no shape for yet:
- a **new tool** / connector / external capability (a new governed action class, a new egress);
- a **new architectural pattern** - a way of structuring code/state/flow no existing module demonstrates;
- a **new cross-module seam** - a contract, factory, or shared type two or more areas will depend on.

Does NOT fire for **mechanical extension** of an existing pattern: the Nth instance of an established shape (one more tool on a registry, one more field on a contract, one more card mirroring the pattern), a rename/move, a config/threshold change, a docs/test-only change. The test: *would a reviewer say "this follows the existing X pattern" - or "there is no X pattern here yet"?* The former is mechanical; the latter trips the gate.

### UX surface? (→ UX sub-gate, §3)
Fires when the arc adds or materially changes a **user-facing surface** - a new view/page/pane, a new interaction flow, a new card type, a visibly restructured layout. Does NOT fire for a copy tweak, a non-visual fix, or a backend-only change with no rendered delta.

### Recording a skip
If NEITHER fires, write the skip where the arc's reasoning lives (a comment in the `.arc.ts`): `design gate: skipped - no new pattern / no surface (mechanical arc)`. The skip is never silent - proportionality is a recorded decision, not an absence (honor-system; validate-arc and arc-sweep read the `.arc.ts` and treat an ungated new surface as a finding).

## 2. The architecture reuse-or-design contract

Split the roles: the `software-architect` agent ADVISES (search, recommend); the plan-arc orchestrator WRITES (extends the doc, records the designRef, stamps supersessions). The architect's output is a recommendation; the orchestrator owns every file write.

**Reuse-first is the honest default.** The architect SEARCHES before designing anything:
1. **Search TWO homes.** (a) The doc home (§4 - read from the consumer binding) for a pattern that already fits. (b) The **prior-arc record**, read BOUNDED (grep by seam keywords, newest-first, cap ~10 files - the shared-host grep discipline): `<root>/arcs/*.arc.ts` designRefs (SKIP entries carrying `supersededBy` - a stamped ref is history) + their `rejectedAlternatives` (a rejected option is prior art AGAINST, never a reuse candidate), `<root>/arc-evals/<ARC>-<date>.json` evidence for arcs touching the same area, `<root>/arc-summaries/*.json` compromiseDisposition + openFollowups, `<root>/followups/*.md`. The recommendation MUST carry a named **"prior art:"** line listing the refs consulted or the literal `none found` - silence is not a search (honor-system; the orchestrator rejects a recommendation without the line).
2. **If one fits → reuse.** The architect cites it; the orchestrator records `{ kind: 'architecture', ref: '<doc section>', status: 'reused', summary }`. Prefer the closest-fitting existing pattern over a marginally nicer new one - one pattern reused beats two that do almost the same thing.
3. **If none fits → design.** The architect designs the long-term-correct pattern (composable, reusable, governed); the orchestrator **extends the arch doc set through the consumer's own doc governance** (the `extendProtocol` field of `designHomes.architecture`) so it becomes searchable canon, not a one-off, and records `{ …, status: 'designed', summary }` + the justification. **Supersession check before recording:** does the new design replace or contradict a designRef already in `<root>/arcs/*.arc.ts` (the step-1 search surfaces candidates)? If so the ORCHESTRATOR stamps the old entry's `supersededBy` (`{ byArc, reason, date }` - the shape lives on `DesignRefShape` in `<root>/lib/schema.ts`) in the same planning commit, and the recommendation names the supersession so the user confirms it together with the design. A design and the design it replaced both reading as current to the next reuse-first search is the failure this closes - flag and stamp, never silently overwrite.

**Extend a doc vs author a new section.** Extend an existing pattern's doc when the new capability is a variant of it; author a new section only when genuinely new - the same reuse-vs-new judgment, one level down.

**Generalize-forward - the inverse question, asked of every `designed` pattern.** Reuse-first asks "does a pattern already exist?"; generalize-forward asks "is this a special case of a capability others should have?". The binding statement of the discipline is the consumer's own - cite the consumer CLAUDE.md's "Generalize-forward" section where one exists (azure_private_agent has one); do not restate it. This gate adds the enforcement details that section leaves open:
- The ≥2 concrete consumers must be **NAMED in the architect's recommendation**, so the bar is evidenced, not asserted; with one consumer, the named follow-up goes to the backlog so the next similar feature folds into it instead of forking.
- When earned, the architect designs the GENERAL seam and the arc's `singleSeams` widen to "this seam is consumed beyond this arc"; member phases plan against the general seam.
- **Consumer bias knob:** a consumer whose stated product thesis is a generic substrate ("any workflow / any agent / any RAG") weights harder toward the general seam - still inside the two-consumer gate.

**Confirm (conduct: §0).** PAUSE for the user's explicit go before phase-planning. An unconfirmed design is not a spec - the user is the design gate, and the generalize-forward verdict is part of what they confirm. The orchestrator then writes every confirmed designRef onto `<root>/arcs/<id>.arc.ts` → `designRefs`, and records each LOSING arm as a `rejectedAlternatives` entry in the same write (`{ option, why, decidedBy, decidedAt }` - the shape lives on `ArcShape` in `<root>/lib/schema.ts`).

## 3. The UX reuse-or-design contract

Run by the `ux-designer` agent when the classifier finds a surface. Same advise/record split as §2: the designer ADVISES + produces the artifact; the orchestrator records the designRef; the user confirms.

**Reuse-first, within the consumer's UX canon.** The designer reads the consumer's UX standards (from the `designHomes` binding - §4) and designs **inside** them, never a parallel design language: search the canon for an existing surface pattern + components; if they fit, record `{ kind: 'ux', ref, status: 'reused', summary }` citing the canonical pattern; if none fits, design the new layout (structure, hierarchy, honest empty/loading/error/not-yet-measured states, accessibility) within the canon's idiom and record `{ …, status: 'designed', summary }`.

**Artifact form - one decision table.** Pick the lightest form that lets the user actually judge the design, EXCEPT that a net-new or regrouped app surface takes the design-locked default:

| Arc introduces | Form | `ref` points at |
|---|---|---|
| A tweak / extension of an existing surface | **Prose layout note** | the note (`docs/ux-previews/<surface>-ux-layout-note.md` convention) |
| Net-new single-state, non-app surface | **Static HTML preview** (via the `frontend-design` skill where available) | the preview file |
| Net-new flow with 2+ sequential states, non-app | **Interactive prototype** - one click-through page, real transitions, a designer rail for failure states | the prototype page |
| Net-new or regrouped APP surface (**the DEFAULT here - not "lightest"**) | **Design-locked prototype** - a data-driven prototype directory (page + guidelines + mock DB) whose mock-data field names align to the consumer's contract shapes; the prototype IS the final UI, implementation is transcription | the prototype directory |

**The craft bar.** Whatever the form, the artifact must meet `references/ux-craft.md` - enumerate-before-designing (§0), identity fidelity (real webfonts, real brand assets, tokens verbatim, type roles honored), the say-it-once restraint doctrine + an explicit declutter pass, the consumer's copy rules, honest-artifact rules, demonstrated accessibility, exemplar conformance, and handover as a reachable LINK (§5b), never a bare path. The orchestrator passes ux-craft.md's absolute path to the `ux-designer` agent (its §3b requires it) and, when `designHomes` names a **quality exemplar**, that exemplar path too.

**Confirm (conduct: §0).** The user confirms the artifact (Step 1b pauses); the orchestrator records the designRef, and each LOSING arm as a `rejectedAlternatives` entry in the same write.

## 3b. The paired conformance criterion - minted at confirm time (MANDATORY)

A confirmed `ux` designRef is a CONTRACT, not inspiration. The criterion's form depends on the artifact class; user-ratified descopes are the only exemption either way.

**Design-locked prototype → objective transcription acceptance.** Every member phase implementing one of its surfaces carries acceptance criteria of the form "Playwright visual-diff of `<surface route>` app-vs-prototype under the declared threshold, seeded with the shared fixtures" plus the wired itest - and carries NO free-form "matches the design" criterion (subjective parity is exactly what the doctrine retires). Live-only behavior (streaming, auth, latency) keeps wired-itest discipline, with the prototype documenting the intended states. The consumer's transcription protocol governs the mechanics (this consumer's: `docs/ux-previews/TRANSCRIPTION-PROTOCOL.md`).

**Any other confirmed UX design → the 1:1 parity criterion**, added to the arc's `acceptanceCriteria` verbatim:

```typescript
{
  id: 'ux-parity:<short-ref-slug>',
  job: 'The shipped <surface> matches the confirmed design (<ref>) 1:1 - the design the user signed off is what ships.',
  surfaces: [<the surface>],
  signal: 'Side-by-side comparison (shipped surface vs the rendered design artifact - every state the design shows AND every interaction it defines, driven live: hover/focus effects, transitions, animations) judged against skills/validate-arc/references/parity-rubric.md with no material deviation.',
  tier: 'live-ui',
  bar: 'Layout structure, component presence/hierarchy, states, interaction & motion (hover/focus effects, transitions/animations - same or unambiguously better, never flattened or inert), copy, and visual tokens all match; judged-equivalent allowed, missing/moved/renamed/degraded is a deviation. Ratified descopes are the only exemption.',
}
```

An arc with `ux` designRefs but no conformance criteria is malformed - validate-arc DERIVES the criterion anyway (its fail-safe), but minting it here is what lets member phases carry the per-phase design-parity gate stage instead of discovering drift at arc end.

## 4. Consumer-agnostic - the design HOMES

The plugin owns the **gate**; the consumer owns the **homes**. Neither the architecture doc set nor the UX canon path is hardcoded here - read both from the `designHomes` key in the consumer's `roadmap.config.json` (the same consumer-agnostic seam the `validationTiers` bindings use). Two optional `ux` fields shape the canon further: `bindingDesignSystem` names the consumer's binding design system + its prototype-transcription doctrine pointer, which the `ux-designer` must honor as the identity to match; `superseded` names an exemplar kept as history only - never a judge.

**Absent key → fail loud, don't guess.** If the gate fires but `designHomes` is absent, surface that and STOP - no home to search, and guessing a doc path is exactly what the seam exists to prevent (mirrors the absent-`validationTiers` gap rule - never a silent pass). Honor-system stop: nothing blocks the guess mechanically, which is why the STOP is written here. (remedy: using-zeroh-roadmap/references/layout.md §Missing homes)

## 5. Apply-arc template - implementing a RATIFIED prototype

When an arc implements a ratified design-locked prototype, the design gate is **ALREADY SATISFIED** - cite the ratification + the prototype directory as the designRef; run NO new UX sub-gate. Plan the arc mechanically:

- **Phase 1** - the parity harness + shared fixtures + token wiring (the consumer's theme token source).
- **Then one phase per surface group, in prototype-nav order** - each phase = transcribe + fixture-swap + visual-diff + wired itest, per the consumer's transcription protocol (`docs/ux-previews/TRANSCRIPTION-PROTOCOL.md` here).

**Deviations from the prototype are DEFECTS, never judgment calls** - route them back through the prototype + re-ratification, keeping the mock and the product in lockstep.
