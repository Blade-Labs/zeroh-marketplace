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
- **`--inline`** / **`--recursion`** (optional) — force EVERY phase into that band (inline / executor), overriding the per-phase classification (Step 2). Default: per-phase auto-classify.
- **`--pause-after <N>`** (optional) — run up to and including phase `<N>`, then execute the Pause protocol (Step 4c) instead of starting the next phase. A mid-run user message ("pause after this phase", "pause the arc") arms the same protocol.
- **`--resume`** (optional) — continue a previously paused arc from its `roadmap/arcs/<ID>-RESUME.md`. Step 0 also auto-detects the file, so a bare `do-arc <id>` on a paused arc resumes rather than restarting.

## Step 0: Resolve the arc and verify its phases

**Resume detection first:** if `roadmap/arcs/<ID>-RESUME.md` exists, this is a RESUME, not a fresh start — read it, `cd` to its recorded worktree, verify its recorded HEAD is an ancestor of the current branch tip (a mismatch means another session moved it: STOP and report), re-verify any recorded preconditions (e.g. operator steps), then re-enter the protocol at the phase it names — skipping Steps 1–3 except re-registering the build sidecar (Step 3b) and re-creating the arc-level task list for the REMAINING phases only. Delete the RESUME file in the same commit that serializes the next completed phase (it describes a state that no longer exists once execution moves).

1. Call `discoverArcs()` (the registry helper in `templates/registry.ts` — returns `{ arcs, errors }` for ALL `roadmap/arcs/*.arc.ts`). If `errors` is non-empty, STOP and surface them — a malformed arc file is a hard stop.
2. **Select** the arc whose `id` equals the passed `<id>`. If none matches, STOP: `No arc with id <id> in roadmap/arcs/. Run /plan-arc first, or check the id.`
3. For every phase number across `arc.planes[].phases`, confirm `roadmap/phases/phase-<n>.phase.ts` exists. STOP listing any missing phase file.
4. Confirm each member phase has passed plan review (status `backlog` or `in-progress`, never `cancelled`; a phase already `done`/`historical` is skipped as complete, not re-run). STOP if a phase is in a state that can't be executed.

Do NOT proceed past any gap — a missing arc, a malformed arc file, a missing or unexecutable phase all halt here with a specific message. Once the arc resolves cleanly, continue to Step 1.

## Step 1: Generate the execution-prompt doc (always — before execution)

Deterministically emit `roadmap/arc-prompts/arc-<id>-execution-prompt.md` from the resolved Arc entity, every run (overwrite if present). This is NOT optional and NOT hand-written — it is regenerated from the arc data so the same bar applies to every arc. **It is a regenerable artifact, not documentation** — its source of truth is the `.arc.ts`; it belongs in `roadmap/arc-prompts/` (co-located with the roadmap, NOT in `docs/`), and consumers should gitignore that directory. Create the directory if absent. Sections, in order:

1. `# Execution directive — <arc.name> (phases <first> → <last>)`
2. **`## The bar — non-negotiable`** — the reusable BAR preamble, written once here in the skill and copied verbatim into every generated doc:

   > Senior software architect. **No compromises or limitations disguised as shortcuts.** Every change must be **composable, reusable, maintainable, governed, and long-term correct**. Reason explicitly on EACH compromise, limitation, hardcode, or skipped item the moment it appears. At a fork between the convenient path and the proper path, invoke `zeroh-roadmap:software-architect` per the Prime-Rule-1 Decision Contract (in `do-phase`) and apply its verdict literally. Do not silently record debt to avoid an architect call.

3. `## What this arc delivers (the why)` — from `arc.name` and the member phases' `stakeholderDemo`.
4. `## Build sequence — one phase at a time, gate each` — the phases in dependency order, each with its `kind` (→ which gate) and task count.
5. **`## Pre-merge arc sweep (MANDATORY)`** — render `arc.singleSeams` here as the "hold these single" invariants the sweep judges (one bullet per seam — a prose checklist, not a bare array dump).
6. **`## Honesty rails specific to this arc`** — render `arc.honestyRails`, one bullet each.
7. **`## Design spec — build against these`** — render `arc.designRefs`, one bullet per ref as `**<kind>/<status>** \`<ref>\` — <summary>`. This is the confirmed design the design-first gate produced (plan-arc Step 1b): each phase is planned and built AGAINST it, and `arc-sweep` judges the build's conformance to it. If `arc.designRefs` is empty, render the explicit line `_None — design gate skipped (mechanical arc), or no design recorded._` so the absence is honest, never a silently missing section.
8. **`## Acceptance criteria — the intent to validate`** — render `arc.acceptanceCriteria`, one bullet per criterion as `**<job>** — signal: <signal> · tier: <tier> · bar: <bar>` (surfaces in parens). This is the experience-level Definition of Done the terminal `validate-arc` stage (Step 7) drives the real flow and judges against, so the directive ends on what "done for a user" means. If `arc.acceptanceCriteria` is empty, render the explicit line `_None declared — the validate-arc stage will be a no-op for this arc._` so the absence is honest, never a silently missing section.

## Step 2: Classify each phase into an execution band

The decision is **PER-PHASE**, not one mode for the whole arc (a mixed arc is normal). The
signal is context pressure + reliability, NOT `phase.kind`. For each member phase compute its
`taskCount`, its count of `tdd`/`e2e` tasks, and whether it touches a **contended path**
(mechanical definition: any path matched by the consumer's `## Gate specialists` block — the
same anchor the gate uses). Then assign a band:

- **HEAVY → inline-supervised** — `taskCount >= 10` OR (`tdd/e2e tasks >= 4` AND it touches a
  contended path). The orchestrator drives `software-developer`/`test-engineer` sub-agents per
  task **WHILE OWNING** every commit, `transparencyReport`, and the gate itself — the
  field-proven RAGUNIFY recovery shape. This INVERTS the old heuristic, which pushed exactly
  the heaviest phases into the least-reliable pure-executor mode. (Named exemption to
  do-phase's auto-spawn ban — see do-phase Step 4.)
- **MID → executor** — a gate-weighty phase that is neither heavy nor trivial (`kind` in
  {logic, hardening, release} and `taskCount >= 3`, and not caught by the TRIVIAL rule's
  light-gated branch below — check TRIVIAL before MID). Spawn ONE `phase-executor` sub-agent
  for it (Step 4).
- **TRIVIAL → inline** — a small phase runs inline in the main session as today: `taskCount <= 2`,
  a `mockup`/docs-only phase, **or `taskCount <= 4` with a plan-declared `reviewScope` of
  `light`/`none`** — a light-gated phase doesn't need a fresh full-context executor; the
  executor's value is context isolation for gate-heavy phases, and spawning one to run a
  single-reviewer gate costs more than the phase itself.

Echo the per-phase band assignments to chat (e.g. `1367:heavy 1368:mid 1369:trivial`), NOT one
arc-level mode. **The thresholds (`10`, `4`, `3`, `2`, and the light-gated `4`) are the tunable
knobs.** `--inline` / `--recursion` FORCE every phase into that band (inline / executor
respectively), overriding the classification — echo `(forced → <band>)`.

## Step 3: Create the arc-level task progress (the phase checklist)

At arc start, `TaskCreate` ONE task per member phase so the user watches the arc tick down. Subject pattern: **`Phase N — Plane X`**, where `Plane X` is the `arc.planes[].name` the phase belongs to (`ArcShape.planes`, `templates/schema.ts`). Lifecycle: set the phase's task `in_progress` at phase start, `completed` at phase done.

**Ownership is strict:** ONLY do-arc touches arc-level (phase) tasks. The per-task tasks inside a phase stay owned by `do-phase` (it creates and lifecycles them per Step 2 of do-phase). Two tiers, two owners:
- **Arc tier** — one task per phase, subject `Phase N — Plane X`, owned by do-arc.
- **Task tier** — one task per phase-task, owned by do-phase.

The `Phase N — Plane X` prefix keeps the two tiers visually distinct in the flat task list. For an **executor-band phase** the task tier lives under the `phase-executor` sub-agent, so the main session shows only the arc tier (the context-isolation advantage); an inline / inline-supervised phase's task tier shows in the main session.

## Step 3b: Register the build (worktree + branch, machine-readable)

Before the first phase starts, write **`roadmap/arcs/.building/<ID>.json`** (create the dir; consumers gitignore `roadmap/arcs/.building/`):

```json
{ "arcId": "<id>", "worktree": "<absolute cwd>", "branch": "<git branch --show-current>", "baseRef": "<arc.baseRef>", "mode": "<uniform band, or 'mixed' for a mixed-band arc>" }
```

This is the lane registry a coordinating session reads instead of reverse-engineering `git worktree list` + commit forensics. Lifecycle mirrors `.arc-mode`: written at build start, **removed at EVERY arc exit** — Step 8 landing/holding, the Step-4 halt branches, and the Step-4c pause (the pause rewrites it with `"paused": true` instead of removing it, so the lane stays visibly claimed). If the sidecar already exists for this arc with a DIFFERENT worktree, STOP — another session is building this arc.

## Step 4: Execute the phases (dependency order, sequential in v1)

Iterate the member phases in **dependency order** (respect each phase's `dependsOn`; a phase runs only after its deps are `done`). **v1 is sequential** — one phase fully completes before the next starts. Parallel cross-Plane execution is deferred (see the plan's "Deferred to follow-up"). For each phase, set its arc-level task `in_progress`, then run it by the selected mode:

- **Executor-band phase** → spawn ONE `phase-executor` sub-agent for the phase. It runs do-phase end to end and **returns** the `PhaseExecutionResult` — a real return channel: the sub-agent stops and you read its result.

  **Stalled/exited-executor watchdog + recovery ladder (executor-band phases only — an inline /
  inline-supervised phase has no executor to probe).** Two field failures define this section:
  an executor backgrounds a long gate run, its turn ends, the run finishes or dies, and it never
  resumes (2026-07-05); and an executor ends a turn on a plain status line between tasks — the
  turn is simply OVER, nothing will ever re-invoke it (2026-07-09: five hours lost because a
  hand-rolled watcher read the corpse as alive). The orchestrator watches with the plugin's
  scripts — never hand-improvised forensics (both field failures were hand-rolled watchers; the
  2026-07-03 false positive came from hand-probing a symlinked transcript stub).

  **Arm the fallback wake in the SAME turn you spawn the executor** (the executor's own return
  stays the primary wake) — background this and let its EXIT re-invoke you:

  ```bash
  node <plugin>/scripts/executor-watch.mjs roadmap/arcs/.building/<ID>.json   # run_in_background
  ```

  It loops the liveness read and exits on the first actionable state: **exit 3 = STALLED,
  exit 4 = EXITED, exit 0 = sidecar gone / max-duration** (final verdict JSON on stdout). For a
  point-in-time read on any other wake:

  ```bash
  node <plugin>/scripts/executor-liveness.mjs roadmap/arcs/.building/<ID>.json --json
  ```

  Verdicts are **ALIVE / QUIET / EXITED / STALLED** with an evidence block (final-transcript-
  record state, beacon age + event, realpath-resolved transcript growth, self-match-proofed
  pgrep, worktree commit + file activity — the symlink-stat, pgrep-self-match, beacon-path
  (reader scans BOTH `roadmap/arcs/.building/` and `<worktree>/.building/`, any `*-executor.jsonl`
  key), just-spawned-executor (pre-beacon grace window, default 15 min), and beacon-idle-inside-
  one-big-task (worktree commit/file-activity rows) traps are all handled inside the script, so
  those false-verdict classes are structurally gone; executor-watch additionally debounces —
  two consecutive STALLED reads before exit 3).

  **When the executor yields on a beacon'd EXTERNAL run, arm a second sentinel — on the RUN,
  not the executor.** `executor-watch` reads executor liveness; an executor legitimately parked
  awaiting a detached external run (datagen, training, ingest) reads STALLED there while the
  real question — is the RUN alive? — goes unwatched. And the executor's own completion poller
  is session-bound: account/login events reap it silently, so its exit-wake is best-effort
  (2026-07-12, arc RAGFID 1537: four poller deaths in one phase — a completed 90-min run sat
  unnoticed for 37 min, a failed training launch for 3 h, until an orchestrator probe caught
  each). So when a wake (or a STALLED verdict) shows the executor parked on a `background-run`
  beacon: background a small orchestrator sentinel loop built FROM THE BEACON's fields —
  `kill -0 <pid>` + log mtime + the DONE marker + failure signatures
  (`FAILED|Error|Traceback|OOM|Killed`), debounced, exiting on the first actionable state —
  and let its exit re-invoke you. On ITS wake: verify the state yourself, then SendMessage the
  executor the evidence (completed → "proceed", failed → the root-cause line from the log,
  wedged → the kill/relaunch directive). Treat REPEATED STALLED exits while a beacon'd run is
  live as "watch the run" — never as grounds to kill a healthy executor (rung 2 is for a run
  that is NOT parked on external work).

  **On ANY wake, check the return channel BEFORE liveness:** an executor task that already
  completed is not a liveness question. A completed return that parses → the normal
  collect-and-branch. A completed return that is prose with the phase not done → the parse
  ladder above (re-ask ONCE for the typed result), not the stall ladder. Only a task still
  RUNNING is a liveness question. Then:

  - **ALIVE / QUIET → wait.** Mid-gate quiet is normal and the verdict says so — do NOT nudge a
    QUIET executor (a mid-gate "re-engage NOW" interrupt can derail a healthy run).
  - **EXITED → resume-with-directive (rung 0 — this is a fact, not a suspicion).** The final
    transcript record is a completed assistant turn: the executor ended on prose without the
    typed `PhaseExecutionResult` and will never self-resume — waiting is pointless and a
    "nudge and re-probe" is theater. SendMessage the SAME executor (its context is intact):
    cite the evidence block + its own final message, name the next open task, and direct it to
    finish the remaining tasks → gate → end ONLY on the typed `PhaseExecutionResult`. If it
    exits on prose AGAIN, go straight to rung 2 (respawn-with-resume).
  - **EXITED via session-limit / account-refresh (a sub-case of EXITED, seen 4× on 2026-07-11/12):**
    a limit event kills the executor's API loop mid-turn AND reaps its session-bound background
    children — including the Monitor/poller whose exit was its wake source, and any long worker
    it did NOT launch detached. The executor is a corpse through no fault of its own, and
    resume-from-transcript (`SendMessage`) is lossless. Before resuming, VERIFY the external
    state yourself from the executor's `background-run` beacon (worker `pid` via `kill -0` +
    log freshness + the DONE marker — never a pattern `pgrep`), then resume WITH that verified
    state in the message: a detached worker frequently SURVIVES the event (the executor-reference
    long-run protocol makes `nohup setsid` the default for >30-min external workers), so
    poller-dead ≠ run-failed and worker-alive must never be relaunched over. A worker that died
    with the session is relaunch territory for the resumed executor, not a phase failure.
  - **STALLED → the recovery ladder (human rescue is the LAST rung, not the first):**
    1. **Nudge once** — SendMessage the standard nudge, citing the script's evidence block so a
       healthy executor can refute a misread. Re-probe after ~10 min.
    2. **Still STALLED → respawn-with-resume.** Kill the executor and spawn ONE fresh
       `phase-executor` told to resume phase N mid-phase — it re-enters via do-phase's **Step 1b
       resume path** (verify done flags against commits, re-derive the phase-start SHA, identical
       record-keeping). The durable checkpoint (`done:true` + one-commit-per-task in the
       worktree) makes the respawn lossless — the same commit-per-task record as an unstalled run.
    3. **The respawn also STALLES, or the phase fails again → NOW `status: "failed"` + human
       escalation** (branch 4 below, unchanged from there on). Human rescue moves from rung 1 to
       rung 3.

  When a phase completes normally, the watcher exits on its own soon after (a returned executor
  reads EXITED — that is the expected shape once you hold the parsed result; ignore it) or when
  the sidecar is removed at arc exit. Re-arm a fresh watcher when you spawn the next executor.

- **Inline-band phase** (a TRIVIAL phase run inline, or a HEAVY phase run inline-supervised — the orchestrator driving software-developer/test-engineer per task while owning commits, transparencyReports, and the gate) → run `do-phase` for the phase IN THE MAIN SESSION, in arc-mode (so do-phase skips backlog grooming + emit:phases per its Step-5 arc-mode override, and produces a `PhaseExecutionResult` instead of stopping to ask the user). **There is no separate return channel here — you are both do-phase and do-arc.** So the collect-and-branch below is YOUR control flow: after do-phase produces the result, you MUST evaluate it (step 2) before doing anything else. Do not let do-phase's "continue immediately to the next task" momentum (Prime Rule 1) carry the session past an `escalated`/`failed` result into Step 5 or the next phase.

**Arc-mode is an artifact, not a memory (inline mode).** On entering Step 4 in inline mode,
write **`roadmap/.arc-mode`** (content: `{"arcId": <arc.id>, "mode": "inline"}`; gitignored)
and remove it at EVERY arc exit — Step 8 landing/holding AND the Step-4 halt branches (2 and 4 below). `do-phase` re-derives "am I in
arc-mode?" from that marker (or from BEING a phase-executor) at its Steps 4b/5 — never from
remembered conversation state, which decays over an hours-long arc. An executor-band phase needs
no marker: the phase-executor's agent card is the explicit signal (the `.arc-mode` marker is
written whenever ANY member phase runs in an inline band).

**Parse the return — never trust it raw.** Validate the executor's returned
`PhaseExecutionResult` with `PhaseExecutionResultShape.parse(...)` (the validate-arc judge
pattern). On a parse failure: (1) re-read `phase.executionResult` from the phase file via
`discoverResults()` — the persisted field is the declared system of record and usually has
the well-formed copy; (2) if the field is absent/also malformed, re-ask the executor ONCE
for the typed result; (3) still malformed → treat as `status: "failed"` and HALT per branch
4 below — never guess a phase's outcome from prose.

Either way, the **collect-and-branch is a mandatory control gate, not a logging step.** Read the parsed `PhaseExecutionResult` and:
1. **Surface its compromise roll-up to chat AS the phase ends** (the per-phase headline). A ROUTINE compromise/skipped/hardcoded (a genuinely boundary-respecting trade-off, `decisionRef` present per the 1367 validator) is noted and **batched into the final arc-sweep** for disposition — it does not stop the arc. **The criterion-narrowing exception:** a result whose `compromises`/`skipped` narrows a task's `acceptanceCriteria` or an arc `acceptanceCriterion` is NOT routine — it is a self-descope. **Bounce the phase** (redo with the criterion honored) OR surface it for user ratification (a typed `Arc.descopes` item); never wave it through. (E.g. routine: "used the injected fetcher instead of a live call, decisionRef: architect PROCEED_WITH_FIX" → batched. Criterion-narrowing: "shipped 3 of the 5 promised masking categories" → bounce/ratify.) This is the do-arc face of the executor card's never-rule 1.
2. **HALT the arc immediately** on a hard interrupt: `status: "escalated"`, or a `hardStops` entry tagged `[MULTI-REPO]` or `[PRODUCT]`. Surface the architect's `escalation.question` + `options` and WAIT for the user — do not run Step 5, do not start the next phase. (In inline mode this means the same session stops here; in recursion mode the spawn already returned.) **Inline mode: remove `roadmap/.arc-mode` before stopping** — every arc exit clears the marker, or the next standalone do-phase run enters phantom arc-mode.
3. On `status: "done"`, set the phase's arc-level task `completed` and continue to the next phase.
4. On `status: "failed"`, HALT and surface the blocking detail — the arc cannot proceed past a phase that could not be driven green. **Inline mode: remove `roadmap/.arc-mode` here too** (same rule as branch 2).

After a phase returns `done`, run the serialized shared-mutation step (Step 5) before the next phase begins.

## Step 5: Serialize the shared mutation (orchestrator-owned)

`roadmap/backlog.ts` and `reviews/changelog.json` are shared-mutable. The phase-executor and arc-mode do-phase deliberately SKIP them (per do-phase Step-5 arc-mode override). **do-arc owns them, run serially after each phase returns `done`** — never inside a parallel or sub-agent context:
1. Groom `roadmap/backlog.ts` — remove the just-completed phase's entry (and any narrative naming only that phase).
2. Run the `emit` slot to regenerate `reviews/changelog.json`.

Doing this in the orchestrator, one phase at a time, is what keeps concurrent phase completions from racing those two files.

### Context-pressure guidance

Bake this into how you pace the arc: **don't rush.** Auto-compact handles a long arc's context for you — proceed phase-by-phase and let it. Delegation IS the context strategy: recursion mode hands each phase to a `phase-executor` so the main session stays light over a long arc. A calm phase-by-phase cadence beats trying to hold the whole arc in working memory at once.

## Step 4c: Pause protocol (user-directed — a first-class exit, not an abandonment)

Armed by `--pause-after <N>` or a mid-run user pause directive. A pause happens ONLY at a
phase boundary: finish the in-flight phase completely — its collect-and-branch (Step 4) AND
its serialized groom/emit/commit tail (Step 5) — never mid-phase. Then:

1. **Write `roadmap/arcs/<ID>-RESUME.md`** from `templates/ARC-RESUME.md` (copy the template
   shape, fill every field — worktree, branch, HEAD, baseRef, execution mode + sizing echo,
   per-phase state table, remaining sequence, known gotchas observed THIS run, operator
   preconditions, and the exact resume command). The file is the cold-start contract: a
   fresh session must be able to continue from it with zero archaeology.
2. **Update the consumer's backlog tier label** for this arc with `PAUSED after <N>` + the
   resume pointer (respect the label length cap), and groom out any phases that completed —
   **in YOUR working tree only**. Direct-on-`baseRef` model: that IS the shared queue, done.
   Isolated worktree model: the label lands on the ARC BRANCH (it merges with the arc);
   NEVER write to the main checkout or `baseRef` from a worktree session — instead END your
   pause report with the ready-to-paste one-line label update so the user/coordinator can
   apply it to `baseRef`'s board (which already names your worktree in its lane map).
3. **Commit** the RESUME file + backlog label on the arc's branch (isolated model) or
   `baseRef` (direct model): `docs(roadmap): <ID> pause handoff after <N>`.
4. Mark the build sidecar paused (Step 3b: rewrite with `"paused": true`) and, in inline
   mode, remove `roadmap/.arc-mode` (every arc exit clears it).
5. Report the pause state + remaining queue to the user and STOP. Do not start the next
   phase, the sweep, or validate-arc.

Resume is Step 0's detection path (or explicit `--resume`).

## Step 6: Arc-sweep

When every member phase is `done`, the arc is built but NOT merged. Invoke the **`arc-sweep`** skill — the pre-merge consolidated debt sweep + whole-arc cross-phase review (it disposes the batched per-phase compromises and judges the arc against `arc.singleSeams`, `arc.honestyRails`, and `arc.designRefs` — design-conformance: did the build follow the confirmed design?). The sweep judges **code coherence**; the next step judges **fulfilled intent**.

**Deferred-test reminder.** Under arc-mode the per-phase gates ran only the tests *relevant* to each phase's diff (the fast inner loop — see `do-phase` gate-protocol's arc-mode test scope); the **full unit + integration suite (+ e2e for a release-kind arc) is deferred to the single arc-end run in Step 8**, AFTER this sweep and validate-arc, because both of those can still land code (a sweep RESOLVE-NOW fix, a validate-arc corrective phase) and an earlier full-suite run would be stale. Do not run the full suite here.

## Step 7: Validate the arc against its intent

After the sweep, run **`validate-arc <id>`** — the terminal intent gate. It drives the arc's real shipped flow against its `acceptanceCriteria` with an independent judge and returns **PASS** or **GAPS**. Two gates, in this order: sweep first (cheap, no live driving — is the code coherent and the debt disposed?), then validate (is the job done for a user, at the bar?). A code-clean arc that misses its intent is not merge-ready; neither is a fulfilled arc with undisposed debt.

- **PASS** → proceed to merge-readiness below.
- **GAPS** → surface them + the proposed corrective phases and **PAUSE for the user's go** — do NOT auto-correct unattended (mirroring the merge-hold; an arc's intent gaps are a bigger commitment than a per-task gate fix). On the user's go, run validate-arc's corrective loop (Step 5 there), then re-report.
- **No `acceptanceCriteria`** → validate-arc is an explicit no-op; record that in the merge-readiness report (the arc declared no intent to validate), never a silent skip.

## Step 8: Land the arc — arc-end full suite, then auto-integrate on a clean PASS

Report **merge-readiness** to the user — the arc-sweep disposition AND the validate-arc verdict (PASS / GAPS / no-op).

**IN-ARC follow-up loop-back (before the arc-end gate).** If the arc-sweep (Step 6) took any **IN-ARC** PLAN-PHASE disposition, it authored the phase and appended a `'planned'` `debtResolutions` entry — but authoring is NOT execution. **Loop back to Step 4 and EXECUTE each authored IN-ARC phase** (the mechanics validate-arc's corrective loop documents), then FLIP its entry `'planned'` → `'fixed'` via `'phase-<N>'` (now truthful — the work exists). Then re-run the arc-end gate below over the EXTENDED diff. **Loop-termination rule:** a second sweep over the loop-back phase(s) may only ACCEPT / DESCOPE / OPERATOR-PENDING — it may NOT author another IN-ARC phase, so authoring cannot loop forever (OPERATOR-PENDING stays available because a loop-back phase can legitimately surface a deploy action, which must not be mislabeled ACCEPT).

**First, the arc-end full-suite gate.** The sweep (Step 6) and validate-arc's corrective loop (Step 7) can both land code, so the deferred full suite is the **last** thing run, here, after them — never earlier (an earlier run would be stale). Run the consumer's full suite once — the `unit` + `integration` slots plus the `kind`-appropriate top tier (the `e2e` slot if any member phase was `release`-kind), resolved from its `CLAUDE.md` `## Gate commands` block. For an arc that touched no runtime code (a docs/config-only arc), there is no runtime suite to run — say so honestly; the arc's relevant doc/lint/type checks already ran per phase.

A non-green result is a **blocker** — but what "blocker" means differs by integration model (below), and this asymmetry is the reason to prefer isolation for risky arcs: on the **isolated-branch** model the suite genuinely *gates* the merge (red → don't merge, the bad code never reaches `baseRef`); on the **direct-on-`baseRef`** model the deferred code is *already* on `baseRef`, so a red suite is a **fix-forward** signal, not a gate (the regression is already integrated — surface it loudly and fix it forward on `baseRef`, do not pretend it was held). An arc whose phases carry real regression risk should therefore run on an isolated branch so the arc-end suite can actually gate.

**Read the consumer `## Merge policy` block, then auto-integrate.** Parse `^## Merge policy$` from the consumer's CLAUDE.md (same fail-loud discipline as `## Gate commands`): keys `arc-integration: autonomous | hold` and `max-open-followups: <int>`. **An ABSENT block, or `arc-integration: hold`, = HOLD for the user** — today's behavior, the fail-safe honesty rail (the plugin never guesses a consumer default). Under `arc-integration: autonomous`, a clean arc LANDS without waiting on a manual go (the landing decision is THIS step's, not arc-sweep's — the sweep reports merge-readiness and hands back). Two invariants the block can NEVER override: **push is never autonomous** (coordinated-push stays manual) and **`baseRef → master` is never autonomous** (a release is a held human act, RELEASE.md §3; GARUN is its own separately-ratified release actor — reference, not extend). HOW a clean arc lands depends on its **integration model** (do-arc does not create a branch; it runs the phases on whatever the session set up):

- **Direct-on-`baseRef`** (the working tree was already on `arc.baseRef` and phases committed straight to it — the common case): the arc is **already integrated** — every phase commit is on `baseRef`. There is no merge to perform. On a clean PASS + no blocker, report it as landed-and-integrated; nothing else to do.
- **Isolated branch/worktree off `baseRef`** (the session ran the arc on its own branch — recommended when other sessions share the checkout): on a clean PASS + no blocker, run the **landing mechanics**: (1) re-fetch `baseRef`; (2) overlap-aware contention check — never clobber a concurrent session's dirty tree (the consumer's shared-master procedure, referenced not restated); (3) merge the worktree branch → `baseRef` (ff when possible, else a `--no-ff` merge commit); (4) **regroom `roadmap/backlog.ts` against the LANDED `baseRef`** (discard worktree-local grooming conflicts — the queue that matters is baseRef's); (5) remove the worktree + `.building/<ID>.json` sidecar + `<ID>-RESUME.md` + the claims; (6) write the RunnerSummary (outcome + openFollowups). **NO push** (coordinated-push stays manual). Report what landed.

Auto-integration fires only when ALL hold: the `## Merge policy` block says `arc-integration: autonomous`; validate-arc returned **PASS** (or a no-op with no `acceptanceCriteria`); the arc-sweep is clean (every batched debt item disposed — RESOLVE-NOW applied + re-gated, PLAN-PHASE authored, or ACCEPT/OPERATOR-PENDING recorded); the arc-end full suite is green; and there is **no blocker**.

Whatever the outcome (landed, held, or halted), **remove `roadmap/.arc-mode`** here — a stale marker would put the NEXT standalone do-phase run into phantom arc-mode. **Remove `roadmap/arcs/.building/<ID>.json` too** (Step 3b — the lane is free once the arc lands or halts), and delete a leftover `roadmap/arcs/<ID>-RESUME.md` if this run was a resume that reached the end.

**`baseRef → master` is NEVER part of auto-integration** — promoting to `master` is a deliberate *release* (branch protection + a version bump per RELEASE.md), so it stays a held release PR.

**Authority override (sits ABOVE the list):** an explicit user instruction in THIS session ALWAYS supersedes the consumer block — if the user asked to review before merge, HOLD regardless of `arc-integration: autonomous`; the block can never silence the user.

**The blocker list (exactly seven — autonomous landing proceeds iff NONE hold):**
1. a member phase returned `failed` or `escalated` unresolved;
2. any unresolved `[MULTI-REPO]` / `[PRODUCT]` / `[SCOPED-OUT]` hard-stop from a phase or the sweep;
3. validate-arc returned **GAPS** not yet dispositioned (per Step 7), OR was not run while the arc HAS `acceptanceCriteria`;
4. the arc-end full suite is not green (isolated-branch: halts the merge; direct-on-`baseRef`: the arc is not cleanly landed — fix forward before declaring done, never report a green landing over a red suite);
5. `openFollowups > max-open-followups`;
6. a merge conflict against `baseRef` (isolated-branch model);
7. `baseRef` moved under the arc and the reconciliation build/tests are not green after re-merge.

**An item NOT on this list is NOT a blocker.**

**openFollowups** is computed from PERSISTED state only (never chat memory — context compacts). After the loop-back flips executed `'planned'` entries to `'fixed'`, `openFollowups` = the count of `debtResolutions[]` entries STILL status `'planned'` (an authored-but-unexecuted IN-ARC follow-up) + the count of UNDISPOSED debt items (aggregated `PhaseExecutionResult` `compromises`/`skipped`/`hardcoded` with NO matching entry — this durably covers would-be descopes the user has not ratified, which by design write nothing until ratified). `'operator-pending'` entries are EXEMPT (counted + reported separately in the RunnerSummary notes). Step 8 writes `openFollowups` into the RunnerSummary and **refuses outcome `'shipped'`** (writes `'halted'` + the open list) AND blocks autonomous landing (blocker 5) when `openFollowups > max-open-followups`. Unable to count ⇒ over budget ⇒ hold. With the consumer at `0`, every code follow-up either executes in-arc or is user-ratified away.

**A blocker HALTS autonomous landing and falls back to hold-and-ask** — report the blocker + what's needed, then wait for the user's go. A held arc sits built-swept-and-validated on its branch until the user's go.

## Step 8b: Emit the runner summary (`roadmap/arc-summary.json`)

After the merge-readiness report, **serialize the converged arc result** to `roadmap/arc-summary.json` so a governed-coding runner (arc GARUN) has ONE typed artifact to read its terminal outcome from — never reconstructed from prose. This is a **serialize of the report you already computed** in Steps 6–8, NOT new logic: it duplicates no decision, it just writes the in-hand result in a machine-readable shape.

Write the file via **`RunnerSummaryShape.parse(...)`** (from the roadmap schema) so the artifact is validated at the write boundary — a malformed summary fails loud here rather than handing the runner a bad file. Field → source mapping:

- `arcId` ← `arc.id`.
- `outcome` ← the merge-readiness verdict: `shipped` on a clean PASS that landed; `halted` on a blocker / red arc-end suite; `blocked` on validate-arc **GAPS** or a phase escalation.
- `reason` (optional) ← a short, secret-free line stating WHY a non-`shipped` arc ended where it did (the blocker / the gap). Omit on a clean ship.
- `compromiseDisposition[]` ← the **Step-6 arc-sweep** batched debt items, each as `{ item, disposition }` using the four `CompromiseDisposition` tokens (ACCEPT / OPERATOR-PENDING / RESOLVE-NOW / PLAN-PHASE). An empty array = a clean arc (kept, not omitted).
- `gateSignals` ← `{ arcSweepClean: <Step 6 clean>, validateArcPassed: <Step 7 PASS or no-op>, fullSuiteGreen: <Step 8 suite green> }`. The runner feeds this straight into its own fail-closed gate normalizer — so write the three booleans honestly (a deferred/unrun suite is **not** green).
- `receiptRef` ← the governance-receipt reference for the arc (required, min length 1 — a missing receipt must fail `.parse()`, never be faked).
- `screenshotUrl` / `prUrl` / `releaseUrl` (optional) ← present only when the artifact actually exists (a live-ui capture / the merged PR / the cut release); omit otherwise — never fabricate a URL.

**Write it twice — keyed history + latest pointer:**
1. `roadmap/arc-summaries/<arcId>-<completion date YYYY-MM-DD>.json` — **keyed, never
   overwritten**: the durable per-arc history (a History surface reads all of them; before
   this existed, each run overwrote the single file and every prior arc's outcome was lost).
2. Copy the same content to `roadmap/arc-summary.json` — the **latest pointer** the
   governed-coding runner reads; existing single-file consumers keep working unchanged.

**Both are regenerable artifacts, exactly like the Step-1 `arc-prompts/` doc:** written
**every run** (the keyed file created, the pointer overwritten), source of truth is the
Steps 6–8 result, and both paths should be **gitignored** (create the dirs if absent).

**This does NOT contradict arc-sweep's "no summary file" rule.** That rule forbids arc-sweep from persisting its *ephemeral debt report* as a tracked deliverable (the debt disposition is consumed inline, not filed). Step 8b is a *different concern*: a **terminal converged-result artifact** a downstream runner reads — regenerable + gitignored, never a tracked hand-authored report. The two coexist; the rule is not read as contradicted.
