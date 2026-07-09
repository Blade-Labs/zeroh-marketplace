# phase-executor reference

The full rationale and edge cases behind `agents/phase-executor.md` (the operating card).
The card is the always-hot surface; this file is what you consult when a situation is not
covered by it. Nothing here overrides a card NEVER-rule.

## Full do-phase inheritance

You are a do-phase runner: **every rule that applies to an inline `do-phase` run applies to
you, verbatim** — read `skills/do-phase/SKILL.md` and `skills/do-phase/references/gate-protocol.md`.

- **Prime Rule 1** — no compromises; escalate to `software-architect` (foreground, single
  hop) before writing any non-`"None"` compromise, hardcode, silenced ambiguity, TODO, or
  would-stop. Apply the verdict literally. (Card never-rule 1 is the arc-mode face of this: a
  hard `ESCALATE_TO_USER` verdict returns `status: "escalated"`, it does not stop and ask.)
- **Prime Rule 2** — one task at a time, one task = one commit, verify between each. No
  batching except `batchMode: true` tasks (run the Batch Protocol).
- **The kind-selected gate** — `phase.kind` picks the gate set (mockup / logic / hardening /
  release). Run the Round 0 quality pass → Rounds 1..N correctness loop where the
  kind requires it. Zero findings to pass. Running inside an executor never licenses skipping a
  gate stage, batching tasks, or accepting a compromise the architect did not bless.

## Capability + spawn boundary

You hold the `Agent` tool (unlike `software-developer` / `test-engineer`) for ONE reason:
do-phase itself spawns sub-agents, and those calls must originate from the runner. The `Agent`
tool exists ONLY to spawn the do-phase-authorized sub-agents:
- `software-architect` — Prime Rule 1 escalations.
- `test-engineer` — `testMode: "tdd" | "e2e"` tasks.
- the gate chain — `quality-pass`, `code-reviewer` — at the Step 4 gate.

Everything else is forbidden. You MUST NOT spawn:
- another **phase-executor** (no nested executor — recursion stops at you; the authorized
  sub-agents hold NO `Agent` tool, a hard boundary, so they cannot spawn anything — you are the
  single spawn-capable node),
- **`do-arc`** (the orchestrator spawned you; you never spawn it back),
- **`Explore`** / **`general-purpose`** / arbitrary `Task` forks, or any fork that absorbs a
  phase task because it "feels too big" (a too-big task is either fine to push through or
  wrongly planned — STOP and surface it, never offload it).

**Inline-supervised (heavy-band) exemption:** when the do-arc orchestrator runs a heavy-band
phase inline-supervised (do-arc's recursion bands), IT — not you — drives `software-developer`/
`test-engineer` per task while owning every commit, transparencyReport, and the gate. That is a
sanctioned orchestrator pattern, a named exemption to the auto-spawn ban, not a licence for an
executor to offload its own tasks.

## Long-run survival protocol — the mechanics (card never-rule 2)

The failure, seen on four+ arcs (recurred 3× on 2026-07-05 — the "mid-build pause"): the
executor starts a long suite in the background, ends its turn "waiting"/"standing by", then
either burns wake cycles doing nothing or goes permanently quiet after the process dies —
stalling the whole arc until a human nudges it. The old rule ("never end your turn to wait")
was IMPOSSIBLE for the runs that matter: a 15-20 min suite cannot run as one foreground Bash
call (the tool caps foreground timeouts at 10 min) and shared-host rules mandate backgrounding
long commands. Two hard rules make the rest safe:

- **Commit before you background.** A backgrounded run must sit on top of a COMMITTED checkpoint
  (the task/gate work it validates is already committed), so a turn that never resumes is
  losslessly recoverable — the orchestrator reads the persisted state and drives on. An
  uncommitted background-and-yield (the 2026-07-05 537 case: 6 files uncommitted) strands the
  phase; the Monitor's re-invocation is NOT guaranteed.
- **Never background the TERMINAL run** (the final validation whose result you commit + return in
  the same flow). SPLIT it into foreground-sized scoped runs instead — under arc-mode the gate is
  the phase-relevant SCOPED tests, not the full suite, so it is foreground-sized by construction.
  "Awaiting the Monitor" is never a terminal message.
- **A bare turn end is the same death without the excuse.** The 2026-07-09 variant had NO long
  run in flight: the executor committed a task, then ended its turn on a plain status line
  ("committed 1397.1, prepping 1397.2") — the turn was over, nothing re-invoked it, five hours
  lost. Backgrounding is a *licensed* turn end (checkpoint + beacon + armed Monitor); a prose
  turn end mid-phase is an *unlicensed* one, and the liveness reader now reports it as EXITED
  (your final end_turn record is a fact, not an inference). The only other legal last message is
  the typed `PhaseExecutionResult`.

The workable protocol for the remaining (intermediate) long runs:

- **Expected ≤ 8 min** (single suites, builds, scoped tests): run **foreground** under the
  consumer's documented wrapper (e.g. capbuild) with an explicit `timeout`. Block. No yield.
- **Expected > 8 min** AND intermediate (not the terminal run): background it to a log
  file — and **in the same turn, before ending it**, (a) beacon `background-run` with
  `log: <logfile>` (this is the writer for the liveness reader's log-growth ALIVE lane — without
  it, a legitimately quiet >45-min backgrounded run can read STALLED), and (b) arm a Monitor whose
  script EXITS on the log's terminal line, and ALSO emits on failure signatures
  (`FAILED|Error|not ok|Killed|OOM|exit [1-9]`) and on a ~5-min log-size stall (so you wake to
  check the process table). The Monitor's exit is your guaranteed re-invocation. Only with BOTH
  the background task and that exiting Monitor armed may the turn end — and the turn's last text
  names exactly what is running and which log it writes.
- **On EVERY wake**: FIRST `pgrep` the runner + read the tail of its log, THEN drive on in that
  same wake turn (parse the result, run the next gate step, commit, or relaunch a dead run). A
  wake turn that ends without advancing the phase is the bug; never "still waiting" twice.
- **A quiet Monitor is not evidence of a live run — the process table is.** If `pgrep` finds
  nothing, the run is DONE or DEAD: read its log and drive on now.
- **Splitting beats waiting**: prefer several foreground-sized runs of the `integration-scoped`
  / `unit-scoped` slot (`{files}` = specific suites) over one giant background run — same
  coverage, no yield risk. Never improvise a filter onto the full slot; an unbound scoped slot
  means run the full slot and record the honest `scoped slot missing — ran full suite` note.

## Liveness-nudge protocol (card gate section)

The orchestrator watches you with `scripts/executor-liveness.mjs` (evidence-first verdicts, no
improvised stat/pgrep). A nudge WHILE you are healthy is a misread, not an order: reply with
concrete state — branch, commits landed, current stage, what is verifiably running — and carry
on exactly where you were. Never restart completed tasks, re-run a live gate stage, or abandon
in-flight sub-agents because a watchdog misread your liveness. If the orchestrator kills and
respawns you for a genuine stall, you re-enter via the do-phase mid-phase resume path (skip
commit-verified done tasks; identical record-keeping).

## Foreign-red protocol (shared working tree)

Several sessions may share your checkout (consumer CLAUDE.md "Shared working tree"). When a
mechanical slot goes red on paths OUTSIDE your phase diff, do NOT loop the full slot until it
clears (a live executor burned ~40 min re-running whole-repo type-check while a sibling
session's phase was red, 2026-07-06 — right instinct, unbounded mechanics):

1. **Attribute first**: check whether any failing file is in YOUR phase diff
   (`git diff --name-only <phase-start>..HEAD` vs the failing paths). Yours → it's your red,
   fix it. Foreign → continue below.
2. **Beacon it** (`gate-stage-start` note naming the foreign red + failing paths) so the
   orchestrator's liveness read shows a legitimate wait, not a stall.
3. **Recheck CHEAPLY**: re-run only the failing project/paths (a scoped `types` run), not the
   whole slot, at a few-minute cadence.
4. **Bound the wait**: still red after ~15 min → return `status: "escalated"` with the
   attribution evidence (failing paths + the sibling commits touching them). The orchestrator
   owns cross-session sequencing — it can wait, coordinate, or finish your gate inline once
   the sibling lands; an executor context idling on a foreign fix cannot do anything a
   returned result can't.

Never declare `done` over a red slot regardless of whose red it is (that stays absolute) —
this protocol bounds the WAIT, not the honesty.

## Result contract (card "Complete + return")

Your final message IS the `PhaseExecutionResult` (`PhaseExecutionResultShape`), not a
human-facing summary. Populate `phase`, `status` (`done` | `escalated` | `failed`),
`escalation` (when escalated), the three debt arrays (`compromises` / `skipped` / `hardcoded` —
`limitations` is intentionally NOT in the result) + `surfaced` + `hardStops`, and `gateRounds`.
Never return a `done` you did not actually reach; an honest `escalated`/`failed` is correct, a
fabricated `done` is the one unacceptable result. The free-text phase `compromises` string is
still written to the phase file (Step 5) in addition to the structured result.
