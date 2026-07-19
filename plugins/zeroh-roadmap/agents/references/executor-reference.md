# phase-executor reference

What you consult when the card (`agents/phase-executor.md`) doesn't cover a situation; nothing here
overrides a card NEVER-rule. The do-phase rules are NOT restated — `skills/do-phase/SKILL.md` is
the single statement.

## Long-run survival protocol (card never-rule 2)

**Every BOUNDED run is FOREGROUND, regardless of duration** — tiers, type-checks, builds, docs
builds, reviewer chains: block to exit code. When one call would exceed the Bash foreground cap,
SPLIT into scoped foreground-sized runs (under arc-mode the gate is the phase-relevant SCOPED
tests, foreground-sized by construction) — never convert a bounded run into a background park.
There is no duration threshold that licenses backgrounding bounded work: the observed failure
class is precisely executors backgrounding 10–15 min tiers and going dark.

The ONLY legal exit for in-flight work is the typed **checkpoint** (`status: "checkpoint"` on the
PhaseExecutionResult), reserved for genuinely UNBOUNDED external work (datagen, training, ingest):

- **Commit before you checkpoint.** A checkpoint must sit on a COMMITTED sha (it is the
  `checkpoint.committedSha` field — the respawned executor and do-arc both verify it), so the
  hand-off is losslessly resumable from disk. An uncommitted checkpoint is refused by the schema's
  intent and strands the phase.
- **Never checkpoint the TERMINAL run** (the final validation you commit + return in one flow) —
  that is always foreground, split if needed.
- **Unbounded external work → launch DETACHED**: `nohup setsid <cmd> >> <log> 2>&1 &` so it lives
  in its OWN process session — a session-limit / account-refresh event reaps your whole harness
  session tree, and a plain backgrounded worker dies with you. End the command with a DONE marker
  (`[launcher] DONE rc=$?`); beacon `background-run` with `pid`+`sid`+`host`+`log`+marker (`host`
  because a remote worker is probed over ssh THERE); compose with the consumer's resource wrapper,
  never replace it. THEN return `status: "checkpoint"` with `committedSha`, `reason`, `resume`
  (the exact next command/step), and `watch` (the log/pid/doneMarker the respawned run verifies).
  do-arc respawns on a checkpoint UNCONDITIONALLY — the wake is owned by contract, not by a
  convenience watcher.
- **Proof-before-checkpoint**: never checkpoint on a launch that has not yet LOGGED REAL WORK
  (first chunk / first steps with loss ticking / first N rows) — process-up is not proof. For a
  FIRST-RUN launcher smoke the EXACT command in a bounded foreground run first (turns every
  launch-class bug into a same-turn fix), then launch detached and watch the log until real work
  ticks.
- **Version errors align in ONE pass**: on the first dependency/API mismatch from a fresh bootstrap,
  read the package's own pins and align the whole environment once; pin them in the committed
  launcher's bootstrap.
- **On EVERY respawn wake**: probe the runner (read the beacon's pid/host, check the process table
  THERE) + read its log tail, THEN drive on in the same turn (parse, next gate step, commit, or
  relaunch a dead run). A quiet log is not evidence of a live run — the process table is. Never
  "still waiting" twice: a second no-progress wake relaunches or escalates.

## Foreign-red protocol (shared working tree)

When a mechanical slot goes red on paths OUTSIDE your phase diff, do NOT loop the full slot until
it clears:

1. **Attribute first**: is any failing file in YOUR phase diff (`git diff --name-only
   <phase-start>..HEAD` vs the failing paths)? Yours → fix it. Foreign → continue.
2. **Beacon it** (a `gate-stage-start` note naming the foreign red) so the liveness read shows a
   legitimate wait, not a stall.
3. **Recheck CHEAPLY**: re-run only the failing paths (a scoped `types` run), never the whole slot.
4. **Bound the wait**: still red after ~15 min → return `status: "escalated"` with the attribution
   evidence (failing paths + the sibling commits touching them). The orchestrator owns
   cross-session sequencing.

Never declare `done` over a red slot regardless of whose red it is — this protocol bounds the
WAIT, not the honesty.
