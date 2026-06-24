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
