---
name: "Do Arc"
description: "Execute a whole arc (a named, contiguous block of phases shipped as one unit) end to end: generate its execution-prompt, drive every member phase to completion in dependency order, serialize shared mutation, and finish with the pre-merge arc-sweep."
user-invocable: true
metadata:
  keywords: do arc, execute arc, run arc, arc
  aliases: run-arc
---

# Do Arc — Arc Orchestration Protocol

`do-arc` is "the command you call" to ship an Arc. It resolves the Arc entity, generates the execution-prompt doc, auto-picks orchestrator-inline vs recursion, drives each member phase to completion via `do-phase` (in arc-mode), serializes the shared-mutable backlog + changelog, and ends in the pre-merge `arc-sweep`. The human stop relocates here: routine compromises batch into the sweep, hard interrupts halt the arc.

## Trigger

User says: `do arc <id>`, `/do-arc <id>`, `execute arc <id>`, `run arc <id>`.

## Arguments

- **`<id>`** (required) — the Arc id, matching `Arc.id` in `roadmap/arcs/<id>.arc.ts` (a number or short string, e.g. `B`).
- **`--inline`** / **`--recursion`** (optional) — force the execution mode, overriding the sizing heuristic (Step 2). Default: auto-size.

## Step 0: Resolve the arc and verify its phases

1. Call `discoverArcs()` (the registry helper from phase 855 — returns `{ arcs, errors }` for ALL `roadmap/arcs/*.arc.ts`). If `errors` is non-empty, STOP and surface them — a malformed arc file is a hard stop.
2. **Select** the arc whose `id` equals the passed `<id>`. If none matches, STOP: `No arc with id <id> in roadmap/arcs/. Run /plan-arc first, or check the id.`
3. For every phase number across `arc.planes[].phases`, confirm `roadmap/phases/phase-<n>.phase.ts` exists. STOP listing any missing phase file.
4. Confirm each member phase has passed plan review (status `backlog` or `in-progress`, never `cancelled`; a phase already `done`/`historical` is skipped as complete, not re-run). STOP if a phase is in a state that can't be executed.

Do NOT proceed past any gap — a missing arc, a malformed arc file, a missing or unexecutable phase all halt here with a specific message. Once the arc resolves cleanly, continue to Step 1.

## Step 1: Generate the execution-prompt doc (always — before execution)

Deterministically emit `docs/arc-<id>-execution-prompt.md` from the resolved Arc entity, every run (overwrite if present). This is NOT optional and NOT hand-written — it is regenerated from the arc data so the same bar applies to every arc. Mirror the structure of the hand-written exemplars (reference shape: `docs/arc-810-814-execution-prompt.md`). Sections, in order:

1. `# Execution directive — <arc.name> (phases <first> → <last>)`
2. **`## The bar — non-negotiable`** — the reusable BAR preamble, written once here in the skill and copied verbatim into every generated doc:

   > Senior software architect. **No compromises or limitations disguised as shortcuts.** Every change must be **composable, reusable, maintainable, governed, and long-term correct**. Reason explicitly on EACH compromise, limitation, hardcode, or skipped item the moment it appears. At a fork between the convenient path and the proper path, invoke `zeroh-roadmap:software-architect` per the Prime-Rule-1 Decision Contract (in `do-phase`) and apply its verdict literally. Do not silently record debt to avoid an architect call.

3. `## What this arc delivers (the why)` — from `arc.name` and the member phases' `stakeholderDemo`.
4. `## Build sequence — one phase at a time, gate each` — the phases in dependency order, each with its `kind` (→ which gate) and task count.
5. **`## Pre-merge arc sweep (MANDATORY)`** — render `arc.singleSeams` here as the "hold these single" invariants the sweep judges (one bullet per seam — a prose checklist, not a bare array dump).
6. **`## Honesty rails specific to this arc`** — render `arc.honestyRails`, one bullet each.

The BAR preamble text is a constant in this skill — never re-typed per arc. `singleSeams` always land in the Pre-merge arc sweep section and `honestyRails` always land in the Honesty rails section, as prose bullets mirroring the exemplar.

## Step 2: Size the work and select the execution mode

Auto-pick **orchestrator-inline** (run `do-phase` in the main session) vs **recursion** (delegate each phase to a `phase-executor` sub-agent). The signal is context pressure, NOT `phase.kind`.

> **`phase.kind` is NOT a sizing input.** kind selects the *gate set* — and a `release` phase is precisely the one to keep WATCHED in the main session, so keying off kind would push exactly the wrong phases into a sub-agent. Size on the work-ahead instead.

Compute over the member phases:
- `phases` — count of member phases.
- `totalTasks` — sum of all tasks across them.
- `gateWeight` — count of phases whose `kind` is in {`logic`, `hardening`, `release`}.
- `tddTasks` — count of tasks whose `testMode` is in {`tdd`, `e2e`}.

**Choose RECURSION if `phases >= 3` AND (`totalTasks >= 10` OR `gateWeight >= 2` OR `tddTasks >= 4`); else ORCHESTRATOR-INLINE.**

Echo the four inputs and the decision to chat (e.g. `phases=5 totalTasks=14 gateWeight=4 tddTasks=2 → RECURSION`). Recursion keeps each phase's per-task tasks under the sub-agent, so the main task list shows only the arc-level phase checklist — surface that as the stated advantage in the echo.

`--inline` / `--recursion` override the heuristic; when an override is passed, still echo the computed inputs plus `(overridden → <mode>)` so the choice is visible.

## Step 3: Create the arc-level task progress (the phase checklist)

At arc start, `TaskCreate` ONE task per member phase so the user watches the arc tick down. Subject pattern: **`Phase N — Plane X`**, where `Plane X` is the `arc.planes[].name` the phase belongs to (855 `ArcShape.planes`). Lifecycle: set the phase's task `in_progress` at phase start, `completed` at phase done.

**Ownership is strict:** ONLY do-arc touches arc-level (phase) tasks. The per-task tasks inside a phase stay owned by `do-phase` (it creates and lifecycles them per Step 2 of do-phase). Two tiers, two owners:
- **Arc tier** — one task per phase, subject `Phase N — Plane X`, owned by do-arc.
- **Task tier** — one task per phase-task, owned by do-phase.

The `Phase N — Plane X` prefix keeps the two tiers visually distinct in the flat task list. In **recursion mode**, the per-task tasks live under the `phase-executor` sub-agent, so the main session's task list shows ONLY the arc-level phase checklist — the whole point of recursion's context isolation.

## Step 4: Execute the phases (dependency order, sequential in v1)

Iterate the member phases in **dependency order** (respect each phase's `dependsOn`; a phase runs only after its deps are `done`). **v1 is sequential** — one phase fully completes before the next starts. Parallel cross-Plane execution is deferred (see the plan's "Deferred to follow-up"). For each phase, set its arc-level task `in_progress`, then run it by the selected mode:

- **Orchestrator-inline mode** → run `do-phase` for the phase IN THE MAIN SESSION, in arc-mode (so do-phase skips backlog grooming + emit:phases per its Step-5 arc-mode override, and bounces escalations up as a `PhaseExecutionResult` instead of stopping to ask).
- **Recursion mode** → spawn ONE `phase-executor` sub-agent (857) for the phase. It runs do-phase end to end and returns the `PhaseExecutionResult`.

Either way, **collect the `PhaseExecutionResult`** and:
1. **Surface its compromise roll-up to chat AS the phase ends** (the per-phase headline). Routine compromises/skipped/hardcoded are noted and **batched into the final arc-sweep** for disposition — they do not stop the arc.
2. **HALT the arc immediately** on a hard interrupt: `status: "escalated"`, or a `hardStops` entry tagged `[MULTI-REPO]` or `[PRODUCT]`. Surface the architect's `escalation.question` + `options` and WAIT for the user — do not start the next phase.
3. On `status: "done"`, set the phase's arc-level task `completed` and continue to the next phase.
4. On `status: "failed"`, HALT and surface the blocking detail — the arc cannot proceed past a phase that could not be driven green.

After a phase returns `done`, run the serialized shared-mutation step (Step 5) before the next phase begins.
