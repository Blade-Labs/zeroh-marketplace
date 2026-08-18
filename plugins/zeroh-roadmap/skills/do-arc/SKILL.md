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
   status` shows live lanes. TaskCreate one task per member phase (`Phase <N> — <plane>`),
   ticked in_progress/completed as each phase runs — the user's arc progress view.
2. **The loop** (repeat until the plane's phases are exhausted):
   1. `roadmap arc next <id> --json` → the ONE next action. `complete` → done. `blocked` /
      `sweep` / `validate` / `land` → the matching branch below. `run-phase`/`resume-phase` →
      continue.
   2. `roadmap gate plan <phase> --json` — echo the band + scopes to the user.
   3. Band `trivial`/`heavy` (or `--inline`) → the inline handoff below. Band `mid` → spawn
      ONE `phase-executor` subagent: prompt = the phase file + the gate plan + the arc's
      execution-prompt doc; result schema from `roadmap contract show --json-schema`. BEFORE
      the spawn, arm the Stop-hook guard: `roadmap executor-arm <phase> --session <YOUR
      SESSION ID> --executor-id <the id of the subagent you are about to spawn>` (the
      session-scoped dir name in your transcript/scratchpad paths) — the CLI refuses an
      unbound arm, and a foreign session is never guarded. `--executor-id` is what makes the
      arm EXCLUSIVE: one session spawns many executors, so a session id alone cannot tell a
      respawn from a second executor onto a live phase. READ the cross-repo preflight line the
      arm prints (the product repos this phase's keyFiles point into, and the newest declared
      keyFile age) before spawning: a keyFile fresher than a few minutes means someone is
      already writing there. Liveness =
      `roadmap watch <id> --once --json` SPOT-CHECKS on each executor notification and before
      every resume decision — never a long-lived background `watch` daemon (every daemon
      instance to date was reaped by a session event before its arc finished).
   4. On return: `roadmap result check --phase <phase>` over the returned JSON (parse or
      die — never trust prose), then `roadmap executor-disarm <phase>` (`roadmap
      executor-disarm --sweep` at arc start clears stale leftovers). When NO
      result came back the disarm REFUSES (exit 2) and prints the beacon evidence.
      `--force` is a deliberate act taken only after READING that evidence, never on a
      STALLED verdict alone: on 2026-08-17 a STALLED verdict on a healthy cross-repo executor
      is exactly what put two executors on one working tree and one branch.
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
  - `checkpoint` → the executor's honest unbounded-work hand-off (the two-exit turn contract):
    verify `checkpoint.committedSha` resolves on disk (`git cat-file -t <sha>`), then respawn the
    phase-executor UNCONDITIONALLY with the checkpoint verbatim in the spawn prompt — resume is
    lossless from disk, and the respawned executor's first act is the on-wake drill over
    `checkpoint.watch`. No SendMessage negotiation, no judgment call: the wake is owned by this
    contract. Bound: THREE consecutive checkpoints with no new commit between them → escalate to
    the user with the beacon trail (a progress ratchet, not a leash). A committedSha that does
    not resolve → treat as `failed` (the lossless precondition is broken).
  - `blocked` → surface the reason (unmet dep, foreign lane), resolve it, relaunch.
  - `stalled` / `exited` → the evidence IS the `roadmap watch --once` verdict JSON. If the executor
    is addressable, `SendMessage` it once with that evidence; otherwise respawn it mid-phase
    (resume is free — re-derivation from disk makes a respawn lossless). Still stuck after a
    bounded wait → escalate to the user. Never restart committed work.
  - `unobserved` (watch exit 5, verdict UNOBSERVED) → no life signal could be PROBED, which is not
    death: never respawn on it — supply `--transcript-dir` or check the executor's own
    task-notification channel first. An executor
    expected to run past ~30min gets periodic `roadmap watch --once` spot-checks, and forensics read
    that verdict evidence, never `ls` on a tasks symlink (whose own mtime is not the transcript's).

## Terminal handoffs (in-session)

1. **sweep** → run the `arc-sweep` skill (disposes the batched per-phase debt, judges the arc
   against its `singleSeams` / `honestyRails` / `designRefs`). If it authors an IN-ARC
   follow-up phase, re-enter the loop — `arc next` re-resolves the plane from disk and picks
   it up automatically. A SECOND sweep over a loop-back phase may only
   ACCEPT / DESCOPE / OPERATOR-PENDING — never author again.
2. **validate** → run `validate-arc <id>`, then `roadmap arc record-validate <id> --verdict
   <PASS|GAPS|no-op>` (stamps the verdict artifact `arc land` reads). GAPS → per
   `mergePolicy.gapsCorrection`: `autonomous` → run validate-arc's corrective loop UNATTENDED
   (plan → do → re-validate until PASS; the judge's PASS is the approval; re-record the
   verdict), then land; `hold`/absent → surface the gaps and PAUSE for the user's go. Bound
   exhaustion or a descope-shaped gap ALWAYS stops for the user.
3. **land** → `roadmap arc land <id>` — the ONE landing engine (cheap blockers first, then
   the arc-end suite, the final blocker check, backlog regroom, RunnerSummary, and the
   autonomous push per the consumer's `mergePolicy`). Exit 0 = landed · 3 = held-for-user ·
   2 = blocker; surface the blocker JSON on any non-zero exit — a `roadmap arc land: <id> —
   <verdict> (exit N)` line also lands on stderr, so a piped stdout can never mask the
   outcome (never trust a pipeline's exit code over that line). `baseRef → master` is NEVER
   part of landing — a release is a held human act. A user instruction to
   review-before-merge always overrides autonomy.
   **Suite scope**: `mergePolicy.arcEndSuite` applies to EVERY integration model —
   `impacted` = the arc's own touched-file scope; `defer-ci` (or `--defer-suite`) skips
   local suites; CI is the full-suite gate. Both are recorded honestly in the RunnerSummary
   (`fullSuiteGreen: false` + reason) — never claim a green you did not run.
   **Already landed** (hand-land): an arc tip already an ancestor of `baseRef` with every
   member done → `arc land` completes the BOOKKEEPING only (cleanup, RunnerSummary, push
   policy), exit 0, no suite. Re-run `arc land` after any hand-land so the books never rot.
   **Contended primary**: parked off `baseRef` no longer refuses a fast-forward arc — ref
   surgery (`git fetch . <arc>:<baseRef>`; git itself refuses non-FF/checked-out targets)
   lands it without touching the sibling's tree. A true (non-FF) merge still waits.
   **Base drift**: a moved `baseRef` whose incoming delta overlaps NONE of the arc's files is
   auto-reconciled (baseRef merged into the arc branch) before anything expensive — no
   blocker, no re-run. Overlapping files hold blocker 7/8 honestly. A stale base beyond
   `mergePolicy.staleBaseCeiling` commits (default 100) with overlap is refused (exit 2) with
   the both-sides-changed file list as the mandatory reconciliation output; `--force-stale`
   ACKNOWLEDGES it (clears that blocker alone, never a conflict) after you have read and
   reconciled that list — which is still emitted under the acknowledgment.
   **`--detach` for a long land** (the arc-end suite can outlive a session): the CLI
   self-daemonizes, records `{pid, step, exitCode}` in `.building/<ID>-land.json`, and returns
   immediately with the journal + log paths. Re-running `arc land` (or `arc next`) reads that
   journal instead of starting a duplicate: a LIVE run reports its step and refuses to double-run,
   a FINISHED one reports its exit and clears, a dead-pid-no-exit journal is named STALE and
   cleared before retrying. Never hand-roll setsid/sentinel/Monitor for a land again.
4. **eval (Step 9)** — `roadmap eval <id>`, spawn `arc-eval-judge`, pipe its verdict to
   `roadmap eval merge-judge --arc <id>`; echo REGRESSION rows in the close-out. Never un-lands.

## Pause & resume

Pause is free — stop anywhere; no state lives in the loop. Resume is always the same act:
re-enter the loop. `roadmap arc next` fast-forwards from disk. A
`roadmap/arcs/<ID>-RESUME.md` is optional human notes, never load-bearing.

## Execution-prompt doc

`roadmap/arc-prompts/<id>-execution-prompt.md` is authored at arc-planning time, not here — read
it for the arc's bar, honesty rails, and design refs before driving. Filename drift: glob
`roadmap/arc-prompts/*<id>*` before concluding it is missing; truly absent, drive from the Arc
entity's `honestyRails` / `designRefs` / `acceptanceCriteria` instead.
