# Bounded intent corrections

Use after validate-arc reports GAPS. The existing two-round and budget bounds cover both
small repairs and planned corrections together; switching routes or resuming does not reset them.

## Authority first

An explicit owner stop/hold wins. Otherwise applicable session authorization permits its
scoped, budgeted corrections even with configured `hold`; do not request it again. Without
session authorization, discovered `mergePolicy.gapsCorrection: autonomous` permits correction;
`hold` or absent mode requires concrete proposed fixes and owner approval. Never change config
to manufacture authority. Scope expansion, descope, budget extension or a new service boundary
requires the specific missing ruling. Correction grants no merge/release authority.

## Choose the repair route

Group gaps sharing one cause and affected component into one pass when the fix is understood,
fits existing phase/task ownership and acceptance criteria, and needs no new architecture,
public contract, dependency, migration or authorization. Describe the gap IDs, expected behavior,
files and affected checks briefly in the working response; this is execution preparation, not a
new phase or planning review. Size alone does not establish eligibility. Uncertain blast radius,
cross-component redesign or an unowned file takes the planned route.

Read any existing `<root>/.gate/arc-<id>/validate.json` and repair commits before replacing the
checkpoint. Resume its round and remaining budget. Before corrective writes, use
`roadmap arc record-validate <id> --verdict GAPS --note "<round/max, budget cap and remaining
allowance or fixed deadline, gap IDs, authority, repair scope>"`. This replaces older PASS.
Preserve and update the same budget accounting on later stamps; an interruption does not reset
its deadline. Inspect actual work before continuing, never replay blindly. Unknown prior
budget/round usage requires clarification, not a fresh allowance.

## Small repair pass

1. Repair the related gaps on the existing arc branch. Add or update meaningful regression
   checks for the promised behavior. Preserve completed phase/task records and immutable
   criteria; do not add a phase merely to host the repair. If eligibility changes, stop and
   take the planned route before expanding the change.
2. Commit the bounded repair with its owning phase and criterion IDs in the existing commit
   convention. Use `roadmap gate plan <phase> --task <task> --json` to inspect task coverage.
   `roadmap gate run <phase> --task <task> --slots unit` is appropriate only when its targets
   cover every changed runtime file. Otherwise run the owning phase gate; run the existing
   integration/type/build bindings when the affected behavior needs them. A task check is
   partial evidence, never phase or arc completion. Failed commands use the existing gate
   diagnosis/retry rules; a code fix is not a passing check.
3. Review the repair diff for correctness under the existing risk rules. Reuse focused
   verification of fixes; retain fresh independent review for HIGH/CRITICAL repairs.
   No clean record applies to a change it did not examine. Record repair completion with
   `roadmap arc record-validate <id> --correction-ready`; it preserves the existing GAPS
   budget and note and records the actual repair HEAD. Relaunch for the required sweep.
   The existing sweep recorder attaches the correction binding itself; no model-authored
   hash or new state file is needed. Evidence commits do not invalidate that sweep.
   Stop this sequence until the sweep is recorded and relaunch returns a fresh `validate`
   handoff. A repair-completion stamp alone does not permit Step 4.
4. After that handoff, send each affected criterion and the current running surface to a **fresh independent
   intent-validator** using validate-arc Steps 2–4. Give no builder reasoning, diffs or commit
   history. Deterministic criteria use one judge; subjective criteria require two agreeing
   judges. Recheck previously MET criteria whose behavior could change; uncertainty widens
   validation. Keep unaffected verdicts only with an explained unaffected scope.

Persist the complete current criterion panel with the existing `roadmap eval record-verdicts`
command; use its normal overwrite option only for the same arc's superseded panel. Retain the
actual judge models and ratified descopes. Record PASS only when every criterion is MET and
required mechanical checks passed. Missing, split, stale or unavailable judgment remains GAPS.
The arc landing gate retains its configured terminal suite/CI requirements; this pass never lands.

## Planned route and exhaustion

For work needing planning, group related gaps into a corrective phase via `plan-phase`, set its
`arcId` and append it to the owning plane, then execute with `do-phase`. Record
`--correction-ready` and follow Step 3 through the sweep and fresh `validate` handoff. Do not create one
phase per gap when one coherent plan covers them. Re-judge affected criteria with the same independence
and complete-panel rules above.

Stop at PASS or the shared round/budget bound. On exhaustion report GAPS, remaining criteria,
attempts and a concrete next action. Do not enter another corrective phase automatically to
escape the bound. Further work needs an explicit bounded extension; a descope needs owner
ratification. Keep unresolved gaps in the existing validation record, never mark them complete.
