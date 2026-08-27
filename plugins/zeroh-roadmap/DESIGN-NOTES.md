# zeroh-roadmap — Design Notes (relocation archive)

**Contract.** This file is the relocation home for every dated incident narration and
retired-experiment rationale removed from a model-loaded skill or agent card during the
ROADCODE prose diet (arc ROADCODE, phase 1659; staged by 1658). It is **never model-loaded**:
no skill, agent card, hook, or CLI reads it as an instruction — it carries no operative rule,
only the history behind rules that now live in code (the `roadmap` CLI + hooks) or in the thin
judgment skills. A rule the model must still follow lives in a skill or card, never here.

The incidents below are preserved verbatim in spirit so the *why* survives the byte cut. Each
section names the origin file; the DIET-LEDGER.md `relocated(DESIGN-NOTES.md §<anchor>)`
dispositions point here.

---

## do-arc — watchdog & recovery-ladder incidents

The mechanics these stories taught are now enforced by `roadmap watch` (exit 3 STALLED / 4
EXITED / 5 UNOBSERVED) and `hooks/executor-result-guard.mjs` (Stop/SubagentStop). The narrations:

- **2026-07-05 — the mid-build pause (backgrounded run, no resume).** An executor backgrounded
  a long gate run, its turn ended, the run finished or died, and it never resumed — the arc
  stalled until a human nudged it. Root cause: a hand-rolled watcher. The fix that stuck:
  commit before you background; never background the terminal run; arm the plugin watcher, never
  hand-improvised forensics.
- **2026-07-09 — five hours lost to a bare prose turn end.** An executor ended a turn on a plain
  status line between tasks. Nothing re-invokes a finished turn; the phase died where it stood.
  A hand-rolled watcher read the corpse as ALIVE for five hours. The `executor-result-guard`
  hook now BLOCKS a bare-prose mid-phase turn end structurally.
- **2026-07-03 — false-positive from a symlinked transcript stub.** Hand-probing a symlinked
  transcript stub produced a false ALIVE verdict. The liveness reader now realpath-resolves
  transcript growth, so the symlink-stat trap is structurally gone.
- **2026-07-11/12, arc RAGFID phase 1537 — four poller deaths in one phase.** An executor parked
  awaiting a detached external run; its session-bound completion poller was reaped by
  account/login events four times. A completed 90-min run sat unnoticed for 37 min, a failed
  training launch for 3 h, until an orchestrator probe caught each. Lesson: an executor's own
  poller is best-effort; the durable wake chain is the orchestrator watchdog + resume-from-disk,
  and the `background-run` beacon (pid + sid + host + log + DONE marker) is what makes the resume
  lossless. Probe with `kill -0` + fresh log, never a pattern `pgrep`, and ON THE BEACON'S HOST.

The full recovery-ladder prose (nudge → respawn-with-resume → fail+escalate) is now the thin
do-arc's ~4-line reaction over the `roadmap watch` verdict; the sentinel/beacon probing
mechanics live in the executor-reference long-run protocol (kept as behavior code cannot perform
it for the model).

## do-arc — execution-prompt generation spec

The full deterministic emit spec for `roadmap/arc-prompts/arc-<id>-execution-prompt.md` (the
BAR preamble, the eight rendered sections mapping `arc.name` / `stakeholderDemo` / `singleSeams`
/ `honestyRails` / `designRefs` / `acceptanceCriteria`) was staged out of do-arc. plan-arc owns
the generator (§5 row 7); the thin do-arc keeps only a one-line pointer. The section renderings,
preserved for the generator's authoring reference: (1) title with phase range; (2) the reusable
senior-architect BAR preamble verbatim; (3) *What this arc delivers* from `arc.name` + member
`stakeholderDemo`; (4) *Build sequence* — phases in dependency order with `kind` + task count;
(5) *Pre-merge arc sweep* — `singleSeams` as "hold these single" bullets; (6) *Honesty rails* —
`honestyRails` one bullet each; (7) *Design spec* — `designRefs` as `**<kind>/<status>** \`ref\`
— summary`, empty → the explicit "None — design gate skipped" line; (8) *Acceptance criteria* —
`acceptanceCriteria` as `**<job>** — signal · tier · bar`, empty → the explicit no-op line.

---

## phase-executor — turn-end incidents

The three-legal-turn-ends rule is kept verbatim on the card; the hook enforces it. The stories:

- **2026-07-05 — a backgrounded terminal run stranded the phase.** A backgrounded final
  validation run is a stall the executor caused, not a handoff: the Monitor's re-invocation is
  not guaranteed for a terminal run. Hence "never background the TERMINAL run."
- **2026-07-09 — five hours, ended mid-phase on "committed 1397.1, prepping 1397.2".** A bare
  status line between tasks is not a legal turn end: the turn is simply OVER, nothing re-invokes
  the executor, and the phase dies where it stood.

---

## executor-reference — long-run survival & foreign-red incidents

The long-run protocol (commit-before-background, never background the terminal run, detached
>30-min workers, DONE markers, beacons, proof-before-yield) is KEPT on the card because it
directs behavior code cannot perform for the model. The dated stories behind it are relocated
here:

- **2026-07-05, phase 537 — uncommitted background-and-yield.** The executor backgrounded a run
  on top of 6 uncommitted files and yielded; the turn never resumed and the work was stranded. A
  backgrounded run must sit on a COMMITTED checkpoint so a non-resuming turn is losslessly
  recoverable.
- **2026-07-09 — a bare turn end is the same death without the excuse.** No long run was in
  flight; the executor committed a task then ended its turn on a plain status line. The liveness
  reader now reports that as EXITED.
- **2026-07-11/12, arc RAGFID phase 1537 — two ~90-min generation runs lost to session-limit
  reaping; the one detached run survived.** A session-limit / account-refresh event kills the API
  loop AND reaps every process in the harness session tree. Hence: launch >30-min external
  workers DETACHED (`nohup setsid`), by default. Poller-dead + worker-alive is a NORMAL state
  after an account refresh, never evidence the run failed.
- **2026-07-11 — pattern `pgrep` misreads (both directions).** A pattern match on the launcher
  script name read a live detached worker as terminal once the launcher shell exited, and can
  self-match the poller. Trust `kill -0` + a fresh log only.
- **2026-07-12, RAGFID 1537 — the five-bug launcher loop.** Yielding on a launch that had not yet
  logged real work turned four serial first-run launcher bugs (a bootstrap install failure,
  flash-attn build order, an unsupported CLI flag, a transformers API rename) into a full
  wake-cycle each — ~4 h of wall clock for ~4 min of fixes. The fix: a bounded foreground smoke
  of the EXACT command before the real detached launch, and align all version/API-mismatch errors
  in ONE pass, not serially.
- **2026-07-06 — foreign-red, right instinct / unbounded mechanics.** A session correctly noticed
  a sibling session's phase was red but chased it with unbounded mechanics. Foreign-red conduct is
  now a bounded rule on the card.

---

## Design-parity origin incident (relocated from plan-arc / arc-sweep / validate-arc)

**2026-07 — Ask Ali web, the Studio builder, and Agent HQ each shipped OFF their confirmed
previews.** Each arc had a user-ratified UX preview at the design gate, but the delivered surface
drifted because nothing downstream re-opened the design artifact: the per-phase gate judged code,
arc-sweep judged the diff, and nobody put the rendered pixels next to the design until the user did
it in production. The closure (now enforced in code + thin skills, so the story no longer needs to
ride in the model-loaded prose):
- plan-arc Step 1b(4) MINTS a paired `ux-parity:*` acceptance criterion for every confirmed `ux`
  designRef (a confirmed design is a 1:1 CONTRACT, not "inspiration");
- validate-arc DERIVES that criterion as a fail-safe when an arc has `ux` designRefs but no
  `ux-parity:*` criterion (the drifted-arc shape);
- the per-phase design-parity gate stage (thin do-phase) re-opens the artifact and compares
  layout + states + interaction/motion against the parity rubric;
- arc-sweep's design-conformance check judges the built surface against the confirmed designRefs.

## Measure scoping (rationale for cli/measure-manifest.json)

`roadmap measure --flow F` sums `bytes/4` over the files the model actually loads into flow
`F`'s driving context. The scoping decision — which files belong to which flow — is derived, not
asserted, and each manifest entry carries a `why` naming the instruction site (skill file + line)
that causes the load.

- **`--flow do-arc` = the ORCHESTRATING session's context.** It loads: `using-zeroh-roadmap`
  (the always-active router), `do-arc` (the orchestration skill), `do-phase` (the inline
  arc-mode worst case — an inline/inline-supervised band runs do-phase in the main session),
  `arc-sweep` (the pre-merge sweep runs in-session), and `validate-arc` + its `driving-tiers.md`
  reference (the terminal intent gate runs in-session). This is the ≤12k-token budget the arc's
  protocol-load-cut criterion measures against the audited ~49k baseline.
- **Subagent cards are EXCLUDED from do-arc.** `phase-executor`, `executor-reference`,
  `code-reviewer`, `quality-pass`, `software-architect`, `intent-validator`, etc. load in FRESH
  subagent contexts, not the orchestrator's — spending orchestrator tokens on them would
  double-count. They are covered by `--flow do-phase` (do-phase + phase-executor +
  executor-reference — the executor subagent's own context).
- **`--flow plan-arc`** covers the planning session: plan-arc + design-gate + ux-craft +
  plan-phase + review-phase.

If a flow's derived set exceeds its budget at target sizes, the fix is to DEEPEN the trims
(deletion-with-disposition), never to drop a genuinely-loaded file from the manifest — hiding a
file the model still loads would make the meter lie. A renamed skill breaks the meter loudly
(exit 1 on a missing manifest path) rather than silently shrinking the total.

## Non-Claude executor lane (CODEX / Gemini / other CLIs)

The `roadmap` CLI is the portable seam: a non-Claude executor drives it directly with its own
loop — no Agent-SDK workflow, no Claude hooks. Boot with `roadmap config check`, then loop
`roadmap arc next <arcId> --json` → run the returned action (`roadmap gate plan/run <N>`,
implement, commit) → `roadmap result check` the typed PhaseExecutionResult → repeat until
`complete`. The CODEX handoff template MUST poll `roadmap watch --once` for liveness between
steps (there is no Stop-hook enforcing the typed-return contract off the Claude harness, so the
runner self-checks). `gemini-extension.json` (version tracked in step with the plugin — 0.18.0)
points a Gemini CLI at `CLAUDE.md` + `skills/`; the same CLI-direct loop applies.

## 2026-07-17 — the per-plane workflow is a LIBRARY, not a hosted workflow script

First live do-arc under the rebuilt plugin (arc MEASURE) hit: the harness Workflow runtime
requires `export const meta` as the first statement and gives scripts no imports, no
filesystem, and no Bash primitive — `workflows/arc-plane.workflow.mjs` is a Node ES module
(imports, fs, child_process, injectable deps) and can never be hosted there. The DESIGN §4
"Agent-SDK workflow" vehicle assumption was wrong for this harness; the 1658 result and
rehearsal finding D4 both recorded that the nested launch was never exercisable pre-cutover.
Disposition: the sequencing loop is driven INLINE by the do-arc skill via the same CLI calls
(decisions stay code; only the vehicle changed — do-arc SKILL.md §Run it); the module stays
as the loop's tested library form (fixture tier + non-Claude runners per locked decision 2).

## 2026-07-18 — the sidecar disk-state CONTRACT (phase 1737; the SEATS dispatcher reads this as its spec)

The `.building/<N>-executor.*` files are a machine-read dispatch substrate, not a scratch log
— the SEATS dispatcher (arc 1727-1730) selects and verifies work FROM them. Phase 1737 closed
the drift lanes:

- **Beacon events are a CLOSED vocabulary** (`cli/lib/beacon.mjs` `EXECUTOR_EVENTS`):
  executor-start · task-start · commit · gate-stage-start · gate-stage-end · background-run ·
  escalated · resume · result-returned · **phase-complete** (the ONE terminal name). The only
  writers are `roadmap beacon <event> --phase <N>` / `appendExecutorEvent` (throw on an unknown
  event; `phase` always a JSON number) and the bash `beacon-stamp.sh` hook (the `commit` event,
  conforming by convention). Pre-1737 sidecars are NEVER rewritten — the three legacy terminal
  names (phase-done / executor-complete / executor-done) normalize to `phase-complete` at READ
  time in `readBeaconLine`, so consumers (status, watch, liveness, SEATS) must read through it,
  never raw-match event strings.
- **The liveness ACTIVITY row reads the PRODUCT repositories too** (`cli/lib/product-repos.mjs`,
  derived from the phase's own `keyFiles`): a phase whose bookkeeping and product code live in
  different repositories had no signal at all, so a working executor read STALLED. Foreignness is
  git-COMMON-DIR, not toplevel — a linked worktree of the same repo shares the common dir and is
  ours. A product repo is shared with the whole world, so its commits count only when the subject
  names a phase this arc owns (the task-commit grammar); the keyFile-mtime arm is phase-scoped and
  therefore survives a shared checkout. No other verdict row widened, and the derivation is always
  reported as `evidence.crossRepo` because "no product repo" and "a product repo with no
  attributable commit" are different diagnoses.
- **The unit of exclusivity is the EXECUTOR, not the session**: one session spawns many
  executors, so a session-bound arm cannot tell a respawn from a second executor onto a live
  phase. `disarmExecutor` REFUSES unless the phase beacon's last event is `phase-complete` or
  `result-returned` (the allow-set = "this executor handed something back", the latter stamped by
  the result-guard hook only on a valid typed result); `armExecutor` REFUSES over an arm naming a
  different `executorId`. Age is never a rule input — a 93-minute-quiet beacon belonged to a
  healthy cross-repo executor — and a MISSING beacon still disarms, because no evidence is not
  proof. `--force` is the deliberate override, and `--sweep` passes it because `staleArms` has
  already made the judgement. BOTH doors route through `cli/lib/executor-arm.mjs` — the CLI verbs
  and `workflows/arc-plane.workflow.mjs`, which until 2376 kept private copies that wrote an
  unbound body and rmSynced it unconditionally, so the contract held for one lane only. The
  workflow mints one `executorId` per spawn and calls `liveArm` UNCONDITIONALLY before spawning (a
  lane with no session id may not WRITE an arm, but it may never spawn over an incumbent either),
  returning a typed `blocked` halt. The CHECK door is deliberately stricter than the WRITE door:
  `armExecutor` overwrites an arm carrying no `executorId` so nothing on disk breaks, while
  `liveArm` counts that same arm as live whenever the beacon says work is in flight — only a
  beacon-QUIET unnamed arm is a fossil, and fossils are `staleArms`' call. The workflow stamps
  `result-returned` ITSELF once `roadmap result check` exits 0, because its harness may run no
  hooks and a green result check is the same proof the hook encodes. It disarms only the arm it
  wrote, and only once its own executor handed something back (even an unparseable result: it
  returned, so it is gone, and its arm would otherwise strand where `staleArms` cannot reach it),
  swallowing a refusal to stderr rather than forcing. Every watchdog exit therefore leaves the arm
  STANDING on purpose, since that standing arm is what blocks the next spawn. A missing beacon is
  never read as permission there — `disarmExecutor` lets one through (no evidence is not proof),
  which would clear the arm of an executor that died before writing its first beacon.
- **Arm files are CLI-owned and session-bound**: `roadmap executor-arm <N> --session <id>
  [--executor-id <id>]` writes JSON `{ sessionId, executorId?, armedAt }` (an unbound arm is
  REFUSED — the 2026-07-17 fabrication hazard); `roadmap executor-disarm <N> [--force]` removes it
  under the allow-set above (a live beacon refuses; `--force` is the override);
  `--sweep` removes exactly the STALE set. Staleness classes: terminal phase status, terminal
  beacon, or an UNBOUND body (empty / phase-number fossil / JSON without sessionId). A raw
  session-id string is the old BOUND prose format the guard honors — never swept on a live
  phase (the 2026-07-18 near-miss: an early sweep draft disarmed the live 1703 lane; the env
  channel covered it, and the corrected contract is regression-locked).
- **The status flip is a CLI verb**: `roadmap phase start <N>` — first-match-only regex flip,
  the exact `docs(roadmap): phase N — move to in-progress` subject (feeds gitscan's
  newest-move-commit base preference), executor-start beacon. `roadmap status` flags the
  divergence class (`DIVERGED?` — done tasks under status backlog) and leaked arms
  (`STALE-ARM`) as advisory row flags, typed in `--json` (`row.diverged` / `row.staleArms`).

## The guard mutation proof — falsifiability moves from review time to authoring time

- **The rule bound the wrong artifact.** `skills/plan-phase/references/verify-rehearsal.md` makes a
  PLANNER rehearse every verify clause both directions. Nothing bound the guards an EXECUTOR writes
  mid-build (ratchets, tripwires, scan assertions), so reviewers carried them to falsifiability one
  serial round at a time. Cost on record: azure_private_agent phase 2374 built 5 tasks in 38 minutes
  and then spent a 3h39m gate in which 8 of 9 rounds debugged the executor's OWN ratchet (vacuous,
  then crying wolf at R2/R6/R7) rather than product code; phase 2334 repeats the shape. The
  PAYLOADCMS arc eval independently found "reviewer mutation-testing across four gate rounds carried
  the guards to falsifiability rather than the initial design arriving there", and mudarabah2 phase
  703 shows the correct practice ("every new guard falsified by reintroducing its defect") happening
  at review time, after every task was already committed. Three executors, two consumer repos, one
  undeclared obligation — not carelessness.
- **The contract**: a NEW guard is driven through three mutations before its commit —
  planted violation RED, anchor drift RED-or-loud, decoy GREEN — and the three one-line results
  land in the task's `transparencyReport`. Scratch mutations, always reverted, never committed.
  The body lives in `skills/do-phase/references/guard-mutation-proof.md`, deliberately OUTSIDE
  `cli/measure-manifest.json`: it is loaded on demand, so it costs the protocol-load budget nothing,
  and the two measured docs carry pointer lines only.
- **Guard, not every test.** A TDD behavior test proven red against its own missing implementation
  already carries its proof by construction. The obligation binds checks whose subject is the TREE'S
  SHAPE, where red-first-against-implementation has no meaning.
- **The carrier is one UNCONDITIONAL gate-plan notes row** (`cli/commands/gate.mjs`, beside the
  standing decision-2b row), pinned by a test in `cli/commands/gate.test.mjs`. Keying it to `kind`
  or `reviewScope` was rejected: guards get authored under any kind, and the row is a harmless no-op
  for a phase that authors none.
  **Reach, stated exactly** (the plan's own claim that "both lanes read the notes" was FALSE and the
  gate caught it): the row reaches the do-arc session, which echoes the plan verbatim. It does NOT
  reach the workflow-lane executor prompt — `renderGatePlan` (`cli/lib/workflow-steps.mjs`) renders
  slots, scopes, floors and agents, never `plan.notes`. What carries the obligation into BOTH lanes
  is `agents/phase-executor.md` + `skills/do-phase/SKILL.md`, which every executor loads whatever the
  lane; the notes row is the supplementary carrier, not the only one. Whether `renderGatePlan` should
  render notes at all is a SEPARATE decision (it would add every note to every executor prompt, on a
  protocol-load budget already red) and is deliberately not taken here.
- **The reviewer flips from discoverer to auditor** (`agents/code-reviewer.md`, and one stage
  earlier in `agents/quality-pass.md` as a round-0 fix-now item): a missing proof is itself a
  finding, a present proof is audited by re-running exactly ONE mutation of the reviewer's choosing.
- **Rounds are deliberately NOT capped.** Round 1 in both azure phases found real product bugs. The
  fix moves guard-debugging into the build window; it does not buy latency back by cutting review.

## Liveness observes the EXECUTOR, not the arm-time pointers (2026-08-18 incident)

**Provenance.** During arc PUCKCANVAS phase 2335, `roadmap watch` returned STALLED on the evidence
"beacon: last event task-start, age 135.9min" while the executor was ALIVE mid-task — 18 transcript
entries in the minute the verdict was read; task 2335.4 was one long live-estate drive that
legitimately emits no beacon for hours. The orchestrator was one step from respawning a second
executor onto a live phase during an authorized production deploy on a shared branch, and only a
manual forensic check stopped it. The same run exposed a second defect: with TWO phases armed in one
session, the Stop guard woke executor pe-2335 with the 2164 arm and demanded work on a phase that
was not its own; the agent refused correctly and burned two ~500k-token turns doing it.

Four contracts came out of it, and they hold together — each closes one link of that chain.

- **Liveness DISCOVERS the executor's transcript by phase, never by an arm-time pointer**
  (`cli/lib/liveness.mjs`). The growth row existed but its only input was `sidecar.transcriptDir`,
  which nothing in the plugin has ever written, so it was dormant in every call that did not pass
  `--transcript-dir`. The engine now derives the harness tasks root from the PRIMARY checkout and
  attributes a transcript by the `phase-<N>.phase.ts` its spawn prompt names AND the
  `attributionAgent` that says it is the executor's. An arm-time stamp was rejected outright: it
  goes stale the moment an arc is re-driven by a new session, which is the vintage-pointer class the
  estate has already paid for once.
  **Naming the phase file is not identity** (gate R2, found by the round-1 review with live
  evidence): the gate's own reviewers are spawned WITH the phase file path in their prompt, so three
  live transcripts named `phase-2384.phase.ts` and not one was the executor. The needle alone let a
  running reviewer vouch QUIET for a dead executor, and a finished flat one "corroborate" its
  STALLED. `cli/lib/agent-transcript.mjs` is now the one reader for both questions, and the two
  consumer classes take OPPOSITE defaults on a missing attribution: a signal that VOUCHES FOR LIFE
  (liveness discovery, the heartbeat) refuses an unattributed transcript, while the Stop guard,
  which demands work rather than vouching for it, keeps treating one as before.
- **STALLED requires a PROBED-negative signal; anything else is UNOBSERVED.** The transcript is the
  only true liveness probe — it grows continuously while an agent runs, so measuring it flat is
  evidence of death. Every other row is evidence of LIFE whose absence proves nothing: a long task
  legitimately produces no commit and no keyFile write, and pgrep is structurally blind to a
  subagent executor. UNOBSERVED never claims life; it refuses to claim death. `watch` exits 5 on it
  (same 2-consecutive debounce as STALLED's 3), `HALT_KINDS` carries `unobserved`, and arc-plane maps
  the exit to that typed halt rather than letting `stalled` absorb it.
- **The beacon stays truthful through a long task via a THROTTLED heartbeat**
  (`hooks/heartbeat-stamp.mjs`, matcher-less PostToolUse — the incident executor drove a browser for
  hours, so a Bash-only hook would have missed exactly that shape). One `heartbeat` per armed phase
  per 10 quiet minutes, never over a terminal event, always exit 0. It is a WORK event: liveness
  reads it like any fresh beacon, and disarm correctly refuses on it.
  **Only the EXECUTOR's own tool calls stamp it** (`hooks/spawn-phase.mjs`, shared with the Stop
  guard, gate R1). Session id cannot carry that: an arm records the ORCHESTRATING session and every
  subagent of that session reports the same id, so a session-only match let any orchestrator tool
  call refresh a quiet executor's beacon — and since the orchestrator is now told to spot-check long
  executors with `watch --once`, polling would have manufactured the life signal the poll then read.
  A self-fulfilling ALIVE is the one direction the verdict must never fail in, so identity uses the
  same two channels the guard does: `ROADMAP_EXECUTOR_PHASE`, else the phase named in the AGENT's
  own transcript head. Neither resolving means no stamp — and it makes the hook free (no git spawn,
  no readdir) for every main-session tool call on the box.
- **The Stop guard is EXECUTOR-MATCHED by the spawn-prompt phase**
  (`hooks/executor-result-guard.mjs`). Channels (b)/(c) now arm only for the phase the stopping agent
  was itself spawned for, read from its own transcript head; the env channel keeps absolute
  precedence, and an agent that names no phase is SILENT — which retires the standing
  misfires-on-unrelated-subagents class and the per-arc armor prompt with it. Residual, accepted and
  named: a non-executor agent whose prompt quotes an armed phase's file path and which ends on bare
  prose gets one demand, then fails open on `stop_hook_active`.

**Deliberately not done.** No beacon-age threshold tuning — age stays evidence, never permission
(the 2375 scar line). No orchestrator-side scheduling inside the plugin: an executor expected past
~30min gets periodic `roadmap watch --once` spot-checks, and that is one documented line in do-arc,
not machinery. STALLED itself was not renamed; consumers keep their meaning and the new member
carries the new one.

## driving-tiers — worked example (azure_private_agent)

Relocated from `skills/validate-arc/references/driving-tiers.md` by phase 1 task 1.4 (the
protocol-load diet). It is an example consumer's own `validationTiers` bindings, **NOT a plugin
default** — the plugin ships none of these commands, and each consumer documents its own.

- `wired` → in-process wired turn through `integration/harness.ts` `driveTurn` (`app.run` with external boundaries faked) — run ONE suite via the consumer's `integration-scoped` Gate-commands slot (scoped-slot resolution rule); never `-- <suite>`, which appends after the inline glob and runs the whole tier.
- `live-ui` → the Playwright projects in `e2e/playwright.config.ts` (`deployed` = the console, loginless; `office-pane`; `sharepoint`) + a screenshot — `E2E_PROJECT=<project> npx playwright test …` (storageState auth via `npm run e2e:auth` where needed).
- `live-host` → real model + masking against a running host — `npm run test:live`.

## Parallel dispatch investigation (phase 10)

The user asked how the roadmap system could execute genuinely parallel work, given that
dependency edges already exist at both levels (`PhaseTask.dependsOn`, phase-level `dependsOn`)
but execution only ever picks THE one next item. Investigation only — no code moved; the ruling
on what (if anything) to build is user-owned and recorded at the end.

### Where sequentiality is enforced today (verified 2026-08-26)

- `cli/lib/derive.mjs:230-268` — RUN-PHASE returns the FIRST backlog member in plane order whose
  deps are done; the selection loop `return`s on the first runnable candidate. One next action by
  construction, never a runnable set.
- `skills/do-phase/SKILL.md:30` — PRIME RULE 2: one task at a time; never batch tasks or launch
  parallel agents for tasks.
- `agents/phase-executor.md:70-71` — the sub-agent rule: NEVER another phase-executor or a fork
  for a "too-big" task; one executor = one whole phase.
- `templates/schema.ts:999-1001` — the `planes` docblock: v1 executes phases in `dependsOn`
  order; a plane is presentational; "a future version will run separate planes in parallel."
- `templates/schema.ts:740` — `executionMode`: RESERVED, consulted by nothing (docblock trued by
  phase 10 task 10.6; the field was REMOVED in phase 11 — see the resolution below, so this
  line is inventory-of-record, not a live cite).
- `skills/using-zeroh-roadmap/SKILL.md:40-47` — the one SANCTIONED parallelism that already
  works: multi-session lane coordination (`roadmap claim`, `roadmap arm`, the backlog header
  board) — different sessions drive different arcs/lanes concurrently, CLI-enforced lane locks.

### Three candidate architectures, priced against the shared host (31 GB / 16 cores, ~6 sessions)

**(a) Plane-level do-arc fan-out.** do-arc asks derive for the runnable SET (all dep-satisfied
backlog members), spawns one phase-executor per member, each in its OWN worktree on its own
branch; `arc land` merges in plane order. Change surface: derive.mjs (set-valued RUN-PHASE),
do-arc SKILL (fan-out + join + per-lane halt handling), arc land (N-branch integration),
liveness/beacons (today they watch ONE executor). Costs that are real on this box: each worktree
needs its own `npm ci` (no shared node_modules — proven again this session); each gate run is a
capbuild cgroup up to 6G, so two concurrent gates + ~6 sessions can exhaust 31 GB; same-file
contention between phases becomes merge conflicts at land time (`conflictsWith` models it but
nothing schedules around it today). Verdict: buildable, medium-size arc of its own, worth it only
when a real arc actually has independent planes AND the host has headroom.

**(b) Cross-arc lane parallelism — exists today, zero build.** Two sessions arm two different
arcs (or one arc + standalone phases in another lane) and run concurrently; the claim/arm locks
and the backlog board already serialize the shared state. This is the dependency-graph-worked-
by-several-agents shape at ARC granularity, and it is the honest match for a ~6-session shared
box: parallelism across coarse, disjoint units, not inside one arc.

**(c) Task-level batching inside a phase.** Rejected: it dissolves one-task-one-commit, the
per-task transparencyReport, and the gate discipline (do-phase PRIME RULE 2); `batchMode` is
already the sanctioned escape for the mechanical case and it batches COMMITS, not agents.

### executionMode's fate

The field models (c), which is rejected — recommend REMOVING it in a follow-up schema change
(keep the enum parse-compatible until then; the docblock already warns against authoring it).
Wiring it to mean (a) would misplace the knob: (a) is an arc/do-arc property, not a per-phase one.

### Options for the user (ruling owned by the user, not this phase)

1. **Ratify (b) as the sanctioned parallel path now** (document it as such in
   using-zeroh-roadmap's coordination section) + queue a small follow-up phase to REMOVE
   `executionMode`. Zero build, immediate. ← RECOMMENDED
2. **Additionally plan arc "PARDISPATCH"** for (a) plane-level fan-out (derive set-valued
   next, do-arc fan-out/join, N-branch land, per-lane liveness) — defer until an arc with
   genuinely independent planes exists and host headroom is proven.
3. **Do nothing further** — keep the field reserved, revisit when a concrete arc needs (a).

**Resolution (2026-08-26, phase 11, user-ratified via AskUserQuestion):** OPTION 1 of the
list above ratified (scope phrasing at ratification: "check + wire today's spawn sites").
CORRECTION (2026-08-27, closure audit): its documentation half — one line in
using-zeroh-roadmap's coordination section naming cross-arc lanes the sanctioned parallel
path — did NOT land in phase 13.5 as first recorded. LANDED later the same day, diet-funded
(two coordination-bullet compressions paid for the line; DIET-LEDGER §using-zeroh-roadmap
2026-08-27). The standing architecture statement remains (b) above. `executionMode` REMOVED from both schema copies (it modeled
the rejected task-level batching; old files carrying the key keep parsing — Zod strips unknown
keys on the non-strict PhaseShape). `roadmap capacity` is the mandatory admission gate any
future parallel fan-out (PARDISPATCH) must consult; today it already gates `arc next` run-phase
dispatch (override: `--ignore-capacity`) and surfaces on `status --json` and `arm`.
