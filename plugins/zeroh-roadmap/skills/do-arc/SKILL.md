---
name: "Do Arc"
description: "Execute a whole arc end to end: drive the per-plane CLI loop, own the halts it hands back, sweep + validate in-session, and land via the CLI."
user-invocable: true
metadata:
  keywords: do arc, execute arc, run arc, arc
  aliases: run-arc
---

# Do Arc — Arc Orchestration

`do-arc` ships an Arc by driving ONE deterministic loop per plane. Every transition is a
`roadmap` CLI call and every non-done path a TYPED halt: you own the conversation and the
judgment, the CLI owns the mechanics. Invoke the CLI as `roadmap <cmd>`
(fallback `node ${CLAUDE_PLUGIN_ROOT}/bin/roadmap.mjs <cmd>`).

You drive the loop INLINE with Bash CLI calls + one subagent spawn per executor-band phase —
do NOT hand `workflows/arc-plane.workflow.mjs` to a workflow runtime (it is the loop's
tested LIBRARY form, a Node module for the fixture tier and non-Claude runners; a sandboxed
workflow engine cannot host its imports).

## Trigger

`do arc <id>`, `/do-arc <id>`, `execute arc <id>`, `run arc <id>`. Optional `--inline` /
`--recursion` force every phase's band; `--pause-after <N>` stops after phase N.

## Run it

1. `roadmap arm <id>` — claim the lane (refuses a lane a sibling already holds); `roadmap
   status` shows live lanes.
2. **The loop** (repeat until the plane's phases are exhausted):
   1. `roadmap arc next <id> --json` → the ONE next action. `complete` → done. `blocked` /
      `sweep` / `validate` / `land` → the matching branch below. `run-phase`/`resume-phase` →
      continue.
   2. `roadmap gate plan <phase> --json` — echo the band + scopes to the user.
   3. Band `trivial`/`heavy` (or `--inline`) → the inline handoff below. Band `mid` → spawn
      ONE `phase-executor` subagent: prompt = the phase file + the gate plan + the arc's
      execution-prompt doc; result schema from `roadmap contract show --json-schema`. BEFORE
      the spawn, arm the Stop-hook guard: write `<worktree>/.building/<phase>-executor.armed`;
      background `roadmap watch <id>` as its watchdog (exit 3 STALLED / 4 EXITED).
   4. On return: `roadmap result check --phase <phase>` over the returned JSON (parse or
      die — never trust prose), then REMOVE the `.armed` file (always, even on a halt).
      `status` ≠ `done` → the halt branch below. Criterion-narrowing compromise → the
      self-descope branch. Else `roadmap gate run <phase> --verify-complete`, groom the
      backlog entry, run the `emit` slot, and loop.
   **Control returns to you between planes** — checkpoints, pauses, and user rulings live
   there. Position re-derives from disk on every `arc next`, so resuming always
   fast-forwards past committed work — a completed phase never re-runs.

## The loop's non-done exits — you own them

- **Inline handoff** (a trivial/heavy band phase, or `--inline`) → run THAT phase inline
  yourself via `do-phase` in arc-mode under the **inline-supervised** rules: you drive
  `software-developer`/`test-engineer` per task while owning every commit, `transparencyReport`,
  and the gate (the one sanctioned per-task fork — an executor never offloads its own tasks).
  Then continue the loop.
- **`sweep` / `validate` / `land` from `arc next`** → the judgment-heavy terminals run
  in-session (below).
- **A typed halt** — surface it, never narrate past it:
  - `escalated` → post the architect's `question` + `options` to the user and WAIT.
  - `self-descope` → the evidence names a compromise/skipped that NARROWS a task or arc
    acceptanceCriterion. The bounce-vs-ratify call is yours with the user: **bounce** the phase
    (redo with the criterion honored) or record a user-ratified `Arc.descopes` item. Never wave
    it through — this is the arc face of the executor's never-rule 1.
  - `blocked` → surface the reason (unmet dep, foreign lane), resolve it, relaunch.
  - `stalled` / `exited` → the evidence IS the `roadmap watch` verdict JSON. If the executor
    is addressable, `SendMessage` it once with that evidence; otherwise respawn it mid-phase
    (resume is free — re-derivation from disk makes a respawn lossless). Still stuck after a
    bounded wait → escalate to the user. Never restart committed work.

## Terminal handoffs (in-session)

1. **sweep** → run the `arc-sweep` skill (disposes the batched per-phase debt, judges the arc
   against its `singleSeams` / `honestyRails` / `designRefs`). If it authors an IN-ARC
   follow-up phase, re-enter the loop — `arc next` re-resolves the plane from disk and picks
   it up automatically. A SECOND sweep over a loop-back phase may only
   ACCEPT / DESCOPE / OPERATOR-PENDING — never author again.
2. **validate** → run `validate-arc <id>`, then `roadmap arc record-validate <id> --verdict
   <PASS|GAPS|no-op>` (stamps the verdict artifact `arc land` reads). GAPS → surface the gaps
   and PAUSE for the user's go before any corrective phase.
3. **land** → `roadmap arc land <id>` — the ONE landing engine (preconditions, arc-end suite,
   the blocker check, backlog regroom, RunnerSummary, and the autonomous push per the
   consumer's `mergePolicy`). Exit 0 = landed · 3 = held-for-user · 2 = blocker; surface the
   blocker JSON on any non-zero exit. `baseRef → master` is NEVER part of landing — a release
   is a held human act. A user instruction to review-before-merge always overrides autonomy.

## Pause & resume

Pause is free — stop anywhere; no state lives in the loop. Resume is always the same act:
re-enter the loop. `roadmap arc next` fast-forwards from disk. A
`roadmap/arcs/<ID>-RESUME.md` is optional human notes, never load-bearing.

## Execution-prompt doc

`roadmap/arc-prompts/<id>-execution-prompt.md` is generated by **`plan-arc`**, not here — read
it for the arc's bar, honesty rails, and design refs before driving.
