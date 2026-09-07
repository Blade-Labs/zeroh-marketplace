---
name: "Do Arc"
description: "Execute a whole arc end to end: launch one per-plane workflow at a time, own the halts it hands back, sweep + validate in-session, and land via the CLI."
user-invocable: true
metadata:
  keywords: do arc, execute arc, run arc, arc
  aliases: run-arc
---

# Do Arc — Arc Orchestration

Child launches resolve their actual checkout governance per
`../using-zeroh-roadmap/references/governance.md` before work.

The terminal evaluation uses the resolved `arc-eval-judge`; its pin and substitutions come from
`MULTI-DRIVER.md` through the role resolver.
Phase work resolves `phase-executor`, `software-developer`, and `test-engineer` through that same home.

Run one plane workflow at a time; the session owns judgment and the CLI owns transitions.
Invoke `roadmap <cmd>` (fallback `node ${CLAUDE_PLUGIN_ROOT}/bin/roadmap.mjs <cmd>`).

## Trigger

`do arc <id>`, `/do-arc <id>`, `execute arc <id>`, `run arc <id>`. Optional `--inline` /
`--recursion` force every phase's band; `--pause-after <N>` stops after phase N.

## Run it

1. `roadmap arm <id>` — claim the lane (refuses a lane a sibling already holds); `roadmap
   status` shows live lanes.
2. For each plane in the arc's `planes`, in order: launch `workflows/arc-plane.workflow.mjs`
   with `{ arcId, planeName, force?, pauseAfter? }` (`force` from `--inline`/`--recursion`,
   `pauseAfter` from `--pause-after`). The workflow
   drives every member phase of that plane through the CLI and RETURNS at the plane boundary
   or the moment anything needs you. **Control returns to you between planes** — checkpoints,
   pauses, and user rulings live there.
3. Act on the return, then launch the next plane (or run the terminal handoff).

The workflow re-derives position from disk on every call (`roadmap arc next`), so relaunching
it always fast-forwards past committed work — it never re-runs a completed phase.

## What the workflow hands back — you own it

- **`{ planeDone }`** → launch the next plane.
- **`{ handoffInline }`** (a trivial/heavy band phase, or `--inline`) → run THAT phase inline
  yourself via `do-phase` in arc-mode under the **inline-supervised** rules: you drive
  `software-developer`/`test-engineer` per task while owning every commit, `transparencyReport`,
  and the gate (the one sanctioned per-task fork — an executor never offloads its own tasks).
  Then relaunch the plane workflow to continue.
- **`{ handoff: sweep | validate | land | evaluate }`** → the judgment-heavy terminals run in-session
  (below).
- **A typed halt** — use its `reduceArcTransition` receipt and safe resume action:
  - `escalated` / `self-descope` / `permission` / `auth` / `review-exhausted` → resolve the
    named missing ruling. Reuse applicable session authority; never request it again or
    silently widen scope. A descope still requires owner ratification.
  - `blocked` → inspect the named dependency or owner and reconcile before relaunch.
  - `stalled` / `exited` / `unobserved` → reconcile the arm and actual executor liveness.
    Contact an addressable executor with the watchdog evidence and await the same executor.
    Missing observation does not prove death; never spawn onto a live or unresolved arm.
  - `failed` → inspect the failure and completed actions before resuming. A claimed result
    without its completion beacon requires reconciliation, never automatic result replay.
  - `gaps` → use validate-arc's bounded correction route below.
  - `pause-after` → the selected phase and result tail are complete; relaunch when continuing.
  - `land-unproven` → a live landing journal means wait; launch neither land nor evaluation.
    If evidence proves the distinct arc branch is already merged but its summary is missing,
    use `roadmap arc land <id>` for its existing bookkeeping recovery. Unproven ancestry
    requires inspection before mutation. A shipped summary with no live landing process
    resumes evaluation even if cleanup left a sidecar or stale journal.

## Terminal handoffs (in-session)

1. **sweep** → run the `arc-sweep` skill (disposes the batched per-phase debt, judges the arc
   against its `singleSeams` / `honestyRails` / `designRefs`). If it authors an IN-ARC
   follow-up phase, relaunch a plane workflow covering it — the workflow's per-iteration plane
   re-resolution picks it up automatically. A SECOND sweep over a loop-back phase may only
   ACCEPT / DESCOPE / OPERATOR-PENDING — never author again.
2. **validate** → run `validate-arc <id>` and record its current verdict with
   `roadmap arc record-validate <id> --verdict <PASS|GAPS|no-op>`. On GAPS, preserve the
   round/budget and authority checkpoint in `--note`; follow
   `validate-arc/references/corrections.md`. After authorized repairs and checks, that owner
   records `roadmap arc record-validate <id> --correction-ready`. Relaunch: the CLI routes through sweep, then fresh validation.
   Sweep recording binds the correction automatically; never type a predicted hash.
3. **land** → `roadmap arc land <id>` — the ONE landing engine (preconditions, arc-end suite,
   the blocker check, backlog regroom, RunnerSummary, and the autonomous push per the
   consumer's `mergePolicy`). Exit 0 = landed · 3 = held-for-user · 2 = blocker; surface the
   blocker JSON on any non-zero exit. `baseRef → master` is NEVER part of landing — a release
   is a held human act. A user instruction to review-before-merge always overrides autonomy.
4. **evaluate** → run `eval-arc <id>`, which owns collection, independent judgment, and
   persistence. Re-derive afterward. A pending or unbound report is not completion; an
   evaluation failure retries only that missing action. `{ done: true }` ends the arc.

## Pause & resume

`pauseAfter` stops after the selected phase's successful result tail. Resume by relaunching
the plane workflow after the halt's required inspection or reconciliation. `roadmap arc next`
reconstructs position from existing records. A
`roadmap/arcs/<ID>-RESUME.md` is optional human notes, never load-bearing.

## Execution-prompt doc

`roadmap/arc-prompts/<id>-execution-prompt.md` is generated by **`plan-arc`**, not here — read
it for the arc's bar, honesty rails, and design refs before driving.
