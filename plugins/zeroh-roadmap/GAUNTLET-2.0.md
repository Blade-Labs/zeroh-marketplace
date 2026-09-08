> Historical investigation record. This describes an earlier implementation, not the current execution contract. See [README.md](README.md) and [MULTI-DRIVER.md](MULTI-DRIVER.md).

# Gauntlet 2.0 — Protocol diet with a ruler (2026-09-02/03, shipped as v0.38.0)

The second skill-quality campaign. Gauntlet 1.0 (`GAUNTLET-2026-08.md`, v0.30.0) ran blind
competitive rewrites and KEPT six originals — do-phase, do-arc, arc-sweep, validate-arc,
release-sweep, test-strategy — on the strength of trials; the agent cards were never in it.
Those originals were then the largest model-loaded bodies in the plugin. Gauntlet 2.0 asked a
different question: **not "which rewrite wins" but "which sentences carry weight"** — and
measured the answer with an execution trial instead of a judged comparison.

Primary records (all in this directory): `DIET-PLAN-2026-09.md` (the per-paragraph trim map and
its ratification), `DIET-LEDGER.md` (every deletion with disposition + evidence, and the trial
restores), `DIET-TRIAL-2026-09.md` (the two-driver execution trial). Phase record:
`roadmap/phases/phase-26.phase.ts`. Execution: codex lane, gpt-5.6-sol; architect ratification
by claude-fable-5; supervising session claude-fable-5-1.

## Method (how 2.0 differs from 1.0)

| | Gauntlet 1.0 (2026-08) | Gauntlet 2.0 (2026-09) |
|---|---|---|
| Question | Is a rewrite better than the original? | Which passages of a kept original are load-bearing? |
| Unit | whole skill body | one paragraph / bullet (158 rows) |
| Evidence for a cut | blind judge ranking of deliverables | a named command + implementation/test path that enforces the passage, or an on-demand home that holds it |
| Trial | frozen contracts, sealed held-out sets, anonymised contestants | real backlog phases executed end-to-end by two drivers on the trimmed protocol |
| Scorer | human-style blind judges | `roadmap eval adherence` — twelve mechanical checks on the phase's own records |
| Guard against over-cutting | losing rewrite discarded | restore rule: an adherence check that the driver's baseline passed but the arm fails → restore the passage, ledger row `reverted-with-evidence` |
| Ceiling | none | `PROTOCOL_LOAD_BUDGET_TOKENS` ratchets DOWN to the measured post-diet load (the only legal move) |

Lesson 1 of Gauntlet 1.0 ("looks better and is better diverge; ~40% of rewrites were regressions
only a trial caught") is why 2.0 refused to cut by taste and refused to skip the trial.

## Step 1 — the trim map (task 26.1)

Every paragraph of the nine biggest never-trimmed bodies got a class and a disposition:

| class | meaning | rows |
|---|---|---:|
| contract | routing, sequencing, or a judgment boundary no command initiates by itself | 115 |
| vocabulary | option names, triggers, enums the model must know to invoke correctly | 32 |
| decision | a ruling (e.g. "release does not gate on debt") that cannot be inferred from code | 5 |
| methodology | how-to the model would otherwise improvise | 3 |
| rationale | incident story / provenance | 1 |

| disposition | rows | rule |
|---|---:|---|
| keep | 138 | the row carries something no command enforces |
| relocate | 14 | an on-demand home already holds the passage in spirit; the body cites it at the firing point |
| enforced-by-code | 4 | valid only with a concrete command AND implementation/test path (generic "cli command and its tests" rows default to keep) |
| obsolete-with-evidence | 1 | the `136`/`1369` commit-parsing anecdote — the em-dash matcher and its tests carry the rule |

Per body:

| body | rows | keep | relocate | enforced-by-code |
|---|---:|---:|---:|---:|
| skills/do-phase/SKILL.md | 35 | 31 | 2 | 2 |
| skills/do-arc/SKILL.md | 16 | 14 | 2 | — |
| skills/arc-sweep/SKILL.md | 27 | 22 | 4 | — |
| skills/validate-arc/SKILL.md | 21 | 18 | 3 | — |
| skills/release-sweep/SKILL.md | 18 | 14 | 2 | 1 |
| agents/phase-executor.md | 13 | 12 | — | 1 |
| agents/quality-pass.md | 8 | 8 | — | — |
| agents/code-reviewer.md | 11 | 10 | 1 | — |
| agents/software-architect.md | 9 | 9 | — | — |

**87% of rows were KEEP.** The diet did not come from deleting paragraphs; it came from
rewriting kept paragraphs to their operative core (the "concise form") and pushing incident
narration and branch mechanics to the on-demand ladder.

### Architect ratification (the decisions)

The map went to `software-architect` (claude-fable-5, one firing over the whole map). Verdict
`PROCEED_WITH_FIX` with 14 binding amendments, the two rules that mattered most:

- **Rejected generic evidence.** Four rows said "enforced by cli command and its tests" without
  naming which; each had to name a command + path or default to keep.
- **Rejected the asserted 15% projection.** The plan had to derive its cut floor from bytes:
  pre-diet do-arc manifest 53,343 B ≈ 13,339 tokens; relocation rows remove 3,187 B; the
  terminal-handoff mechanics ≈ 3,500 B; the remaining clause splits must contribute ≥ 1,315 B
  → cut floor 8,002 B, projected ≤ 45,341 B ≈ 11,336 tokens. Estimates then had to be replaced
  by `roadmap measure` output.

Representative amended rows (full table in `DIET-PLAN-2026-09.md` §Ratification):

| row | ruling | why |
|---|---|---|
| do-phase 30, completion fields | keep | driver absence is SCORED, not refused — the instruction must stay loaded |
| do-phase 31, arc-mode return | keep | the skip-groom/emit/push boundary is what prevents shared-checkout mutation; no command refuses a violator |
| phase-executor 8, gate + return | keep | this paragraph produces the beacons, modeled rounds and typed return the adherence scorer consumes |
| do-arc 3, operating model + CLI fallback | keep | consulted on every run; relocating yields no flow saving |
| code-reviewer 6, later-round scope | keep | `gate round-brief` provides the delta, but only this card tells the reviewer to consume it |
| release-sweep 9, release does not gate on debt | keep (decision) | the anti-over-blocking half of the prime rule; not inferable from the census command |
| arc-sweep 21, ledger audit | relocate mechanics, keep trigger | the body must still say: when an arc trims prose, audit every deletion against the ledger |
| phase-executor 6, 11–12 incident stories | relocate story, keep rule | the 2026-08-17 stale-line-number and API-529 stories are provenance; the tripwire / empty-read rules stay |
| do-phase 20, `136`/`1369` example | obsolete | the em-dash boundary matcher and its tests carry the rule |

## Step 2 — the ruler (task 26.2)

`roadmap eval adherence <N> [--json] [--since <date>]` scores a landed phase from its own
records — twelve checks, driver-attributed, no LLM: tripwires-ran · one-commit-per-task ·
six-field-transparency-reports · gate-rounds-carry-model · rounds-carry-findings ·
guard-mutation-proofs-quoted · curation-evidence · verify-complete-passed · no-self-review-round ·
plan-verify-clauses-unchanged · lessons-flushed · execution-result-roles-recorded.

Baseline captured BEFORE any trim, last ten landed phases (16–25, all gpt-5.6-sol / codex):
**mean 0.542 (n=10)**, range 0.500–0.583. No claude-opus-5 phase existed in the slice, so the
opus baseline is recorded as absent rather than invented.

Known at the time and fixed since: the scorer read checkout-local evidence (gate reports,
executor beacon) that a codex lane's disposal deletes, so `tripwires-ran`, `curation-evidence`
and `verify-complete-passed` failed for every lane phase by construction, and
`one-commit-per-task` failed after curation squashed the subjects. Phase 28 (v0.39.0) made
`phase land` carry the evidence into the primary and the scorer fall back to the committed
record. **All 2.0 scores are therefore UNDER-estimates, uniformly across arms** — the comparison
holds, the absolute numbers do not.

## Step 3 — the trims (task 26.3)

Apply commit `4035877`: 10 files, 215 insertions, 449 deletions. No new reference file was
created — every relocate row pointed at an existing on-demand home (the 1658 ROADCODE diet's
`references/` and `DESIGN-NOTES.md`) that already held the passage in spirit. Ratchet commit
`4e49e82` moved the ceiling.

| body | before | after | Δ |
|---|---:|---:|---:|
| skills/do-phase/SKILL.md | 12,219 B / 184 lines | 7,507 B / 131 | −38.6% |
| skills/do-arc/SKILL.md | 10,350 B / 149 | 5,121 B / 87 | −50.5% |
| agents/phase-executor.md | 7,640 B / 108 | 3,070 B / 56 | −59.8% |
| agents/code-reviewer.md | 4,815 B / 67 | 2,960 B / 46 | −38.5% |
| agents/software-architect.md | 4,572 B / 60 | 3,471 B / 46 | −24.1% |
| agents/quality-pass.md | 5,543 B / 70 | 4,588 B / 57 | −17.2% |
| skills/arc-sweep/SKILL.md | 8,899 B / 129 | 8,969 B / 126 | +0.8% |
| skills/validate-arc/SKILL.md | 7,486 B / 106 | 7,700 B / 107 | +2.9% |
| skills/release-sweep/SKILL.md | 6,781 B / 105 | 7,341 B / 106 | +8.3% |
| **nine mapped bodies** | **68,305 B** | **50,727 B** | **−25.7%** |

(test-strategy, kept in 1.0, was not in the 2.0 map; unchanged at 3,906 B.)

The three sweep/validate bodies grew slightly: their rows were almost all keep, and the
concise forms re-cited the references they now lean on. The saving concentrated where the
narration was — the executor path (do-phase, do-arc, phase-executor) and the gate cards.

Measured flow load (`roadmap measure`, four-bytes-per-token bridge):

| flow | before | after | Δ |
|---|---:|---:|---:|
| do-arc (the always-loaded orchestration path) | 53,343 B / 13,339 tokens | 44,246 B / 11,065 tokens | **−17.1%** |
| do-phase | measured in-phase | 14,772 B / 3,694 tokens | — |
| plan-arc | measured in-phase | 68,223 B / 17,057 tokens | — |

`PROTOCOL_LOAD_BUDGET_TOKENS` 13,339 → **11,065** (`cli/lib/measure-budget.mjs`): the enforced
ceiling is the exact measured post-trial total, so any future prose growth on the do-arc path
reds the budget guard.

## Step 4 — the two-driver execution trial (task 26.4)

Protocol fixed before any run (`DIET-TRIAL-2026-09.md` §Protocol): two reviewed READY backlog
phases (27, curate range safety; 7, measured Graft spike), each executed once by
`claude-opus-5` (headless phase-executor in an isolated worktree, launched by the supervising
session) and once by `gpt-5.6-sol` (`roadmap codex run --worktree`), all four from one base
(`9272413`, the trimmed tree). First green arm per phase wins and is landed; the loser is
scored and discarded. Restore rule as above.

### What the trial caught

The first arm (27 / opus) went green on its tasks and then its mechanical gate exposed **three
regressions in untouched tests**: a duplicated export-declaration regex in the scorer, six
keep-marked do-phase execution anchors missing from the concise form, and the quality-pass
card's task-subject commit grammar cut. The architect classified all three as keep-marked
passages cut contrary to the ratified map. The restore rule fired once (commit `fbfb5d9`, three
`reverted-with-evidence` ledger rows naming gate `run-000003`) before any further arm launched.

That is the Gauntlet 1.0 lesson reproduced under a different method: a trim that read clean and
passed the map was still a regression only execution caught.

### Results

| phase | driver | adherence | failed checks | gate rounds | findings | min/task |
|---:|---|---:|---|---:|---|---:|
| 27 | claude-opus-5 | 0.583 | tripwires-ran, one-commit-per-task, gate-rounds-carry-model, curation-evidence, verify-complete-passed | 6 | HIGH 4 · MED 1 · LOW 1 | 45.7 |
| 27 | gpt-5.6-sol | 0.667 | tripwires-ran, one-commit-per-task, gate-rounds-carry-model, verify-complete-passed | 2 | MED 2 | 43.4 |
| 7 | claude-opus-5 | 0.750 | gate-rounds-carry-model, curation-evidence, verify-complete-passed | 6 | HIGH 4 · MED 1 · LOW 9 | 35.4 |
| 7 | gpt-5.6-sol | 0.667 | tripwires-ran, one-commit-per-task, gate-rounds-carry-model, verify-complete-passed | 2 | 0 typed; quality pass fixed 3 | 13.2 |

- Both sol arms (0.667) beat the sol baseline mean of 0.542 on the trimmed protocol — the diet
  did not degrade adherence for the driver with a baseline.
- Opus arms: 0.583 and 0.750, reported without a comparison (no baseline).
- Sol closed every gate in 2 rounds; opus took 6 on both phases (the round-cap mechanism was
  not yet enforced — see phase 28). Opus surfaced more typed findings; sol's quality pass
  absorbed them untyped. Both are consistent with the recorded gate-mining finding that
  rounds/phase had risen from 1.3 to 3.4–4.8 before the phase-25 cap.
- Winners landed: phase 27 → sol arm (`eb7fba9`/`cf6698e`), phase 7 → opus arm (14 uncurated
  commits, `edb0aec`/`6782866`). Losers kept as branches `trial/27-opus`, `codex/7`.

## Verdicts

| outcome | bodies |
|---|---|
| Trimmed, trial-confirmed | do-phase · do-arc · phase-executor · code-reviewer · software-architect · quality-pass |
| Mapped, kept whole (concise-form re-cites only) | arc-sweep · validate-arc · release-sweep |
| Restored after the trial | do-phase (six execution anchors) · quality-pass (commit grammar) · adherence.mjs (regex home) |
| Not in scope | test-strategy (kept in 1.0, not mapped); the five 1.0 rewrites; using-zeroh-roadmap (7,608 B, in the baseline but unmapped) |

Phase 26: 9 commits, +1,454 / −510 lines, 32 files, 25 tests added (1,838 → 1,863), one
halt (the trial's restore), gate 11 rounds (see lesson 6). Wall clock 2026-09-02 23:04Z →
2026-09-03 08:07Z including the four trial arms.

## Lessons (add to Gauntlet 1.0's six)

7. **Cut by evidence, not by taste — and 87% of the evidence says keep.** A paragraph earns
   deletion only when a named command + test path enforces it or an on-demand home holds it.
   Under that rule most of a mature skill survives; the saving comes from concise forms and
   moving narration down the ladder, not from removing rules.
8. **A map is not a trial.** Three keep-marked passages were cut anyway and read fine; the
   first execution arm's gate found them. Every future diet keeps the restore rule and runs at
   least one real phase per driver before the ceiling ratchets.
9. **Measure with a scorer that reads records, then fix the scorer's blind spots first.** The
   adherence checks made the trial comparable, but three of twelve scored checkout-local
   evidence the land deletes; a ruler that mis-scores uniformly still ranks correctly, but the
   absolute numbers were wrong for a week. Phase 28 fixed the retention; re-baseline before the
   next diet.
10. **Ratchet the ceiling to the measurement, never to the projection.** The architect refused
    the "15%" claim; the ceiling moved to the exact post-trial byte count (11,065) and only a
    diet may lower it again.
11. **Drivers differ in gate behaviour more than in adherence.** Sol closed in 2 rounds, opus in
    6 with more typed findings; the round cap and the delta-only review (phases 25, 28) exist
    because of this, not because of the diet.
12. **The reference clause can undo the cap.** Phase 26's own gate ran 11 rounds because one
    reference sentence said "rounds stay uncapped" (fixed `595d853`; enforced in phase 28 with
    `--cap-override`). Any prose that overrides a mechanism is a defect to lint for.

## Re-run kit

- **Visual report:** `GAUNTLET-2.0.html` (self-contained; open in a browser) — the per-body
  before/after diff, the per-passage trim map with dispositions and architect rulings, and the
  evaluation evidence (baseline, trial, restores, ceiling, caveats). Rebuild from the repo with
  `python3 scripts/gauntlet-2.0/build.py` (diffs `c1c4edf` → `189599e`; reads the DIET-* records).
- Map grammar and evidence rule: `DIET-PLAN-2026-09.md` §Evidence rule; ledger row grammar:
  `DIET-LEDGER.md`.
- Scorer: `roadmap eval adherence <N> --json`; baseline: `--since <date>` (re-baseline after
  v0.39.0 — the retention fix changes absolute scores).
- Load: `roadmap measure --flow do-arc|do-phase|plan-arc` (`--assert <N>` reds above the ceiling).
- Trial arms: session-run `claude -p` executor in a `git worktree` (phase 28 adds
  `executor-arm --worktree` so it journals and lands like a lane) and `roadmap codex run <N>
  --worktree <dir> --base <sha> [--label <l>]`.
- Evidence branches: `trial/27-opus`, `codex/7`; archived arm journals in the supervising
  session's scratchpad (`trial-journals/`); gate reports for the winners carried into the
  primary from v0.39.0 on.
