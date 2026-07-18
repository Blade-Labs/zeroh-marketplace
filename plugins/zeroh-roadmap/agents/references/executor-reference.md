# phase-executor reference

What you consult when the card (`agents/phase-executor.md`) doesn't cover a situation; nothing here
overrides a card NEVER-rule. The do-phase rules are NOT restated — `skills/do-phase/SKILL.md` is
the single statement.

## Long-run survival protocol (card never-rule 2)

A long run cannot always be one foreground Bash call (the tool caps foreground timeouts at ~10
min; shared-host rules mandate backgrounding long commands). Two hard rules make it safe:

- **Commit before you background.** A backgrounded run must sit on a COMMITTED checkpoint, so a
  turn that never resumes is losslessly recoverable — the orchestrator reads the persisted state
  and drives on. An uncommitted background-and-yield strands the phase; the Monitor's
  re-invocation is NOT guaranteed.
- **Never background the TERMINAL run** (the final validation you commit + return in one flow).
  SPLIT it into foreground-sized scoped runs — under arc-mode the gate is the phase-relevant SCOPED
  tests, foreground-sized by construction. A bare prose turn end mid-phase is unlicensed and reads
  as EXITED.

The protocol for the remaining (intermediate) long runs:

- **≤ ~8 min** (single suites, builds, scoped tests): run FOREGROUND under the consumer's
  documented wrapper (e.g. capbuild) with an explicit `timeout`. Block. No yield.
- **> ~8 min AND intermediate**: background it to a log file ENDING in a terminal marker the run
  writes itself (`; echo "DONE rc=$?" >> <log>`) — and in the SAME turn, before ending it,
  (a) beacon `background-run` with `log: <logfile>` (without it a quiet >45-min run reads
  STALLED), and (b) arm a Monitor whose script EXITS on the log's terminal line, on failure
  signatures (`FAILED|Error|not ok|Killed|OOM|exit [1-9]`), and on a ~5-min log-size stall — its
  exit is your guaranteed re-invocation. Only with BOTH armed may the turn end. **The Monitor is
  a convenience wake, not the contract**: a session-limit / account-refresh event kills it
  silently (4× on 2026-07-17) while the run itself survives — the beacon + the in-log DONE
  marker are what let ANY watcher (the orchestrator, or you resumed) verify the outcome
  mechanically. Never park on a Monitor for a run a bounded foreground block could cover.
- **> ~30 min external worker (datagen, training, ingest) → launch DETACHED**: `nohup setsid <cmd>
  >> <log> 2>&1 &` so it lives in its OWN process session — a session-limit / account-refresh event
  reaps your whole harness session tree, and a plain backgrounded worker dies with you. End the
  command with a DONE marker (`[launcher] DONE rc=$?`); beacon its `pid`+`sid`+`host`+`log`+marker
  (`host` because a remote worker is probed over ssh THERE); compose with the consumer's resource
  wrapper, never replace it.
- **Proof-before-yield**: never yield on a launch that has not yet LOGGED REAL WORK (first chunk /
  first steps with loss ticking / first N rows) — process-up is not proof. For a FIRST-RUN launcher
  smoke the EXACT command in a bounded foreground run first (turns every launch-class bug into a
  same-turn fix), then launch detached and watch the log until real work ticks.
- **Version errors align in ONE pass**: on the first dependency/API mismatch from a fresh bootstrap,
  read the package's own pins and align the whole environment once; pin them in the committed
  launcher's bootstrap.
- **On EVERY wake**: `pgrep` the runner + read its log tail, THEN drive on in the same turn (parse,
  next gate step, commit, or relaunch a dead run). A quiet Monitor is not evidence of a live run —
  the process table is. Never "still waiting" twice.

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
