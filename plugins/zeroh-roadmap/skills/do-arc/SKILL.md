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

Resolve `arc-eval-judge`, `phase-executor`, `software-developer`, and `test-engineer`
through the role resolver; `MULTI-DRIVER.md` owns pins and substitutions.

Run one plane at a time; the CLI owns transitions.
Invoke `roadmap <cmd>` (fallback `node ${CLAUDE_PLUGIN_ROOT}/bin/roadmap.mjs <cmd>`).

## Trigger

`do arc <id>`, `/do-arc <id>`, `execute arc <id>`, `run arc <id>`. Optional `--inline` /
`--recursion` force every phase's band; `--pause-after <N>` stops after phase N.

## Run it

1. `roadmap arm <id>` — claim the lane (refuses a lane a sibling already holds); `roadmap
   status` shows live lanes.
2. For each plane in the arc's `planes`, in order, run
   `roadmap arc plane <arcId> <planeName> --json` (add `--inline` when requested).
   This Node entry runs `workflows/arc-plane.workflow.mjs` until a plane boundary or handoff.
   Never substitute a host Workflow sandbox or session-written driver.
3. Handle its return; continue to the next plane or terminal.

Every call re-derives position with `roadmap arc next`, skipping committed work.

## What the workflow hands back — you own it

- **`{ planeDone }`** → launch the next plane.
- **`{ handoffInline }`** (a trivial/heavy band phase, or `--inline`) → run THAT phase inline
  yourself via `do-phase` in arc-mode under the **inline-supervised** rules: you drive
  `software-developer`/`test-engineer` per task while owning every commit, `transparencyReport`,
  and the gate (the one sanctioned per-task fork — an executor never offloads its own tasks).
  Rerun `roadmap arc plane`: its committed `executionResult` drives result validation,
  completion verification, backlog grooming and emit. No copied JSON or predicted hashes.
- **`{ handoff: sweep | validate | deliver | awaiting-ci | evaluate }`** → the judgment-heavy terminals run in-session
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
3. **deliver** → finish the existing pre-publication history normalization, then run
   `roadmap deliver <arcId> --json`; add `--resume` when its receipt already exists.
   Publish one authorized non-draft arc/group PR; preserve worktree and journals without
   local landing or cleanup. Completion requires configured checks green on its exact head.
   `awaiting-ci` is a handoff to the CI monitor, not completion. Queue/merge requires its
   exact policy, capability, allowed ref, current green evidence and already-recorded
   terminal authority. A config value or local `mergePolicy` cannot grant that authority.
   Normal CLI-created receipts have no queue/merge grant; report the named hold instead
   of inventing one. `roadmap arc land` remains only the separately authorized local
   integration command, and cannot replace an active PR delivery receipt.
4. **awaiting-ci** → run the configured CI-monitor flow against that same delivery receipt.
   Preserve current-head/check-set binding and existing correction bounds. Until its
   monitor is available, retain the named awaiting-CI handoff; do not narrate green.
5. **evaluate** → `eval-arc <id>` collects the PR receipt, independently judges and persists.
   If delivery evidence is unsupported, name the missing bridge once and hold; never invent
   local landing evidence. Re-derive afterward. Pending/unbound reports cannot complete;
   retry only failed evaluation. `{ done: true }` ends the arc.

## Pause & resume

`pauseAfter` stops after the selected phase's result tail. Reconcile any halt, then relaunch.
`roadmap arc next` reconstructs position; `<ID>-RESUME.md` is optional human context.

## Execution-prompt doc

Read the **plan-arc**-generated `roadmap/arc-prompts/<id>-execution-prompt.md` for the bar,
honesty rails and design refs; do not regenerate it here.
