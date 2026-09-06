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

`do-arc` ships an Arc by launching ONE small workflow per plane. Every transition is a
`roadmap` CLI call and every non-done path a TYPED halt the workflow hands back: you own the
conversation and the judgment, the CLI owns the mechanics. Invoke the CLI as `roadmap <cmd>`
(fallback `node ${CLAUDE_PLUGIN_ROOT}/bin/roadmap.mjs <cmd>`).

## Trigger

`do arc <id>`, `/do-arc <id>`, `execute arc <id>`, `run arc <id>`. Optional `--inline` /
`--recursion` force every phase's band; `--pause-after <N>` stops after phase N.

## Run it

1. `roadmap arm <id>` — claim the lane (refuses a lane a sibling already holds); `roadmap
   status` shows live lanes.
2. For each plane in the arc's `planes`, in order: launch `workflows/arc-plane.workflow.mjs`
   with `{ arcId, planeName, force? }` (`force` from `--inline`/`--recursion`). The workflow
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
- **`{ handoff: sweep | validate | land }`** → the judgment-heavy terminals run in-session
  (below).
- **A typed halt** — surface it, never narrate past it:
  - `escalated` → post the architect's `question` + `options` to the user and WAIT.
  - `self-descope` → the evidence names a compromise/skipped that NARROWS a task or arc
    acceptanceCriterion. The bounce-vs-ratify call is yours with the user: **bounce** the phase
    (redo with the criterion honored) or record a user-ratified `Arc.descopes` item. Never wave
    it through — this is the arc face of the executor's never-rule 1.
  - `blocked` → surface the reason (unmet dep, foreign lane), resolve it, relaunch.
  - `stalled` / `exited` → the evidence IS the `roadmap watch` verdict JSON. If the executor
    session is addressable, `SendMessage` it once with that evidence; otherwise relaunch the
    plane workflow (resume is free — re-derivation from disk makes a respawn lossless). Still
    stuck after a bounded wait → escalate to the user. Never restart committed work.

## Terminal handoffs (in-session)

1. **sweep** → run the `arc-sweep` skill (disposes the batched per-phase debt, judges the arc
   against its `singleSeams` / `honestyRails` / `designRefs`). If it authors an IN-ARC
   follow-up phase, relaunch a plane workflow covering it — the workflow's per-iteration plane
   re-resolution picks it up automatically. A SECOND sweep over a loop-back phase may only
   ACCEPT / DESCOPE / OPERATOR-PENDING — never author again.
2. **validate** → run `validate-arc <id>`, then `roadmap arc record-validate <id> --verdict
   <PASS|GAPS|no-op>` (stamps the verdict artifact `arc land` reads). On GAPS, retain Step 5’s
   round/budget checkpoint with `--note` so this stamp cannot erase resume state. Follow
   validate-arc Step 5's authority rules: reuse existing session authorization, otherwise honor
   `mergePolicy.gapsCorrection`. Group eligible small gaps into the existing arc’s repair pass;
   plan larger corrections. Independently re-judge within the shared bound;
   missing authority or scope expansion requires a ruling. Correction does not authorize landing.
3. **land** → `roadmap arc land <id>` — the ONE landing engine (preconditions, arc-end suite,
   the blocker check, backlog regroom, RunnerSummary, and the autonomous push per the
   consumer's `mergePolicy`). Exit 0 = landed · 3 = held-for-user · 2 = blocker; surface the
   blocker JSON on any non-zero exit. `baseRef → master` is NEVER part of landing — a release
   is a held human act. A user instruction to review-before-merge always overrides autonomy.

## Pause & resume

Pause is free — stop anywhere; no state lives in the workflow. Resume is always the same act:
relaunch the plane workflow. `roadmap arc next` fast-forwards from disk. A
`roadmap/arcs/<ID>-RESUME.md` is optional human notes, never load-bearing.

## Execution-prompt doc

`roadmap/arc-prompts/<id>-execution-prompt.md` is generated by **`plan-arc`**, not here — read
it for the arc's bar, honesty rails, and design refs before driving.
