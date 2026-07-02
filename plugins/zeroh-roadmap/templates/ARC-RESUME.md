# Arc <ID> — RESUME HANDOFF (paused after phase <N>, <YYYY-MM-DD>, <why: user directive / blocker>)

A mid-execution `do-arc <ID>` run, deliberately paused. A fresh session reads this file,
then continues the do-arc protocol from phase **<NEXT>**. This file is the cold-start
contract: everything a session needs, zero archaeology. Delete it in the commit that
serializes the next completed phase (do-arc Step 0 resume path owns that).

## Where the work lives
- **Worktree:** `<absolute path>` (or "MAIN checkout — sibling sessions share it: stage explicit paths only")
- **Branch:** `<branch>` (off `<baseRef>` at `<base commit>`; do-arc baseRef is `<arc.baseRef>`)
- **HEAD at pause:** `<sha>`
- **node_modules / build state:** <e.g. "symlinked from the main checkout — do not reinstall; lint:boundaries baseline N==N here; type-check is authoritative"> 
- **Do ALL work in the worktree above.** Never touch sibling checkouts.

## Execution mode
<ORCHESTRATOR-INLINE | RECURSION> (sizing echo: phases=<..> totalTasks=<..> gateWeight=<..> tddTasks=<..>).
<Recursion: one `zeroh-roadmap:phase-executor` per phase, arc-mode; the orchestrator
serializes backlog-groom + emit + commit after each phase.>

## Phase state at pause
| Phase | State | Notes |
|---|---|---|
| <n1> | done (gate-clean, serialized) | |
| <n2> | done | <e.g. "gate R1 fix committed <sha>"> |
| <N> | done — PAUSE POINT | |
| <NEXT> | next | <preconditions if any> |
| <...> | queued | |
Then: arc-sweep → validate-arc → arc-end full suite → land per Step 8.

## Preconditions / operator steps before <NEXT>
- <e.g. "OPERATOR: provision X + run the baseline capture — BLOCKS <NEXT>"> (or "none")

## Known gotchas observed this run
- <e.g. "executors yield awaiting dead background test runs — pgrep first, then read the
  result file / re-run scoped in the foreground; never wait">
- <consumer-specific test/tooling quirks hit during this run>

## Resume command
`do-arc <ID> --resume` (or bare `do-arc <ID>` — Step 0 auto-detects this file).
