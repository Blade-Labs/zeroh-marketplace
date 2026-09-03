# Protocol diet execution trial — September 2026

This protocol was fixed before any trial run. It exercises the trimmed protocol on the two reviewed READY backlog phases selected by the supervising session: phase 27 (curation range safety) and phase 7 (measured Graft spike). Each phase runs once with `claude-opus-5` and once with `gpt-5.6-sol`, with both arms starting from the same `feat/roadmap-arcs` base SHA recorded below.

## Protocol

- Driver arms: invoke `claude-opus-5` as the `phase-executor` in an isolated worktree; invoke `gpt-5.6-sol` through `roadmap codex run <N> --worktree <tmp> --base 9272413fa0e9d0c49b2bb0fd1067ffec393712e9`.
- Readiness: phase 27 carries a 2026-09-02 READY review record. Phase 7 is the pre-record-era reviewed backlog phase whose notes preserve its Mode A ratifications; the supervising session selected it as the second READY trial target.
- Isolation: all four arms start from the exact base below. An arm owns only its temporary worktree and branch. No trial arm merges or pushes.
- Scoring: for every arm record `roadmap eval adherence`, failed check IDs, gate rounds, findings by severity, and elapsed minutes per task.
- Winner: the first green run for each phase is handed to the supervising session for landing. The losing green arm is scored and discarded only after the winner is selected.
- Restore rule: when an arm fails an adherence check that its driver baseline passed, restore the map passage covering that behavior and add one `reverted-with-evidence` row to `DIET-LEDGER.md` naming the run. Otherwise the trim stands.
- Completion barrier: phase 26 remains in progress until both winning phase commits are observable on the integration ref. The observer then records exact post-trial flow measurements and completes phase 26.

Base ref: `codex/26` (whose parent integration ref is `feat/roadmap-arcs`)

Base SHA: `9272413fa0e9d0c49b2bb0fd1067ffec393712e9`

## Amendment (2026-09-02, pre-execution)

The supervising resolution named `feat/roadmap-arcs` at `66b51c8` as the launch base, but launcher inspection proved that it would load the 184-line pre-diet do-phase protocol: the launcher creates a worktree directly at the base and carries no protocol files into it. The shared base is therefore `9272413`, which is `66b51c8` plus only the six Phase 26 commits through the completed diet tasks and their state records; its do-phase body is the 111-line trimmed version under test. All four arms still share exactly one SHA. No trial run had started when this amendment was recorded. The `claude-fable-5` software-architect returned `PROCEED_WITH_FIX` for this correction.

## Results

The Phase 27 `claude-opus-5` arm reached `trial/27-opus @ 7b237a9`, completing both tasks and
independent gate rounds. Its mechanical gate then exposed three Phase 26 regressions in untouched
tests: duplicate export-regex ownership, six missing do-phase body anchors, and the missing
quality-pass task-subject grammar. The software architect classified all three as keep-marked
passages cut contrary to the ratified map. The restore rule was therefore applied before another
arm launched, with one ledger row per restore naming gate `run-000003`.

All four arms subsequently reached a green gate. Minutes/task is total recorded execution span
divided by task count; it is a comparison statistic, not a claim that tasks were equal.

| phase | driver | adherence | failed checks | rounds | findings by severity | minutes/task |
|---:|---|---:|---|---:|---|---:|
| 27 | claude-opus-5 | 0.583 | tripwires-ran, one-commit-per-task, gate-rounds-carry-model, curation-evidence, verify-complete-passed | 6 | HIGH 4 · MEDIUM 1 · LOW 1 | 45.7 |
| 27 | gpt-5.6-sol | 0.667 | tripwires-ran, one-commit-per-task, gate-rounds-carry-model, verify-complete-passed | 2 | MEDIUM 2 | 43.4 |
| 7 | claude-opus-5 | 0.750 | gate-rounds-carry-model, curation-evidence, verify-complete-passed | 6 | HIGH 4 · MEDIUM 1 · LOW 9 | 35.4 |
| 7 | gpt-5.6-sol | 0.667 | tripwires-ran, one-commit-per-task, gate-rounds-carry-model, verify-complete-passed | 2 | typed severity findings 0; quality pass fixed 3 concerns | 13.2 |

## Verdict

The four-run execution and scoring requirement is satisfied. Both Sol arms exceed the historical
Sol mean of 0.542. No historical Opus mean exists, so the Opus arms are reported without inventing
a comparison; no further restore is required. The first observed green candidates are phase 27
Sol (`39032b1`, completion `858cac2`) and phase 7 Opus (`95059e2`, completion `f281d8b`).

The supervising session landed both selected green candidates on the integration ref at `ee96ec3`;
that clears the phase-26 completion barrier without this lane merging, landing, or pushing them.

Post-restore measurement: do-arc **44,246 B / 11,065 tokens**; do-phase **14,772 B / 3,694
tokens**; plan-arc **68,223 B / 17,057 tokens**. The do-arc flow remains 17.1% below its
13,339-token pre-diet baseline, and the enforced ceiling is the exact measured total.
