# Step 5 self-verify list: judgment checks against the CURRENT tree

Run after `roadmap phase validate <N>` passes. Use inspected source at the current ref;
refresh affected evidence if inputs changed. Independent reviewers inspect source themselves.
Severity in parentheses is the verdict the check earns at review-phase Mode A if it fails.
**Run in listed order**: the BLOCKER members lead, so a time-boxed pass still catches the worst
defects; report any unrun member as unrun, never silently skip.

1. **Source confirms** (BLOCKER): open each function a task modifies; does the `problem` actually
   exist there, in the current tree? For additions, confirm the capability is absent and the task
   declares the new path and contract; do not require its future symbol to exist.

2. **Decision completeness** (BLOCKER): grep the phase prose (problems, steps, notes) for
   decision-deferral language: `decide`, `choose`, `either`, `or we could`, `as appropriate`,
   `as needed`, `TBD`. Any hit inside a task means a decision was left to execution-time judgment:
   make it now, or take it through Prime Rule 2. (EVALCORE: the same unmade decision escalated
   twice in one task, mid-execution.)

3. **Data flow** (BLOCKER): no task depends on a later task's output or assumes a file state an
   earlier task changes out from under it.

4. **No duplicate coverage** (BLOCKER at queue time): re-run Step 0's probe against the moved
   tree: `grep -rln -F '<central symbol>' <root>/phases <root>/backlog.ts`. Another phase or
   queued item already covering the work: STOP, do not queue, hand the ruling to the user; a
   third duplicate in the queue is strictly worse than no phase.

5. **Anchor freshness** (NEEDS WORK): every existing path and symbol greps clean; planned
   additions name their creating task and contract. Existing matches are checked
   case-exact, against the current tree; `line?` values are re-checked or dropped. Symbols are
   copy-pasted, never retyped. (FLUENTFRONT: a case-variant retype made a tripwire pass on the
   wrong claim.)

6. **Blast radius closed** (NEEDS WORK; the commonest review red): grep each changed
   pattern/symbol repo-wide; every other occurrence is either covered by a task in THIS phase or
   documented out-of-scope in the notes. A removal's radius includes what DESCRIBES the behavior:
   stale test titles, doc anchors, backlog keyFiles. An unclosed blast radius means the plan
   needs work, not a bigger disclaimer.

7. **Criteria verifiable** (NEEDS WORK): each acceptance criterion names a command or observable
   (a lane command or a grep counts; verifiable does NOT mean a test). Reject "works correctly" /
   "verified".

8. **Promise closure** (NEEDS WORK): list every artifact or behavior the docblock, `notes`,
   and `stakeholderDemo` promise; map each to the task id that produces it. No task = delete the
   promise or add the task. (FLUENTFRONT: every member phase's docblock claimed to append to a
   set that shipped EMPTY; only validate-arc caught it, arcs later and much more expensively.)

9. **State coverage** (NEEDS WORK): for each behavior with a lifecycle (first run vs re-run,
   empty vs populated, cold vs warm), at least one acceptance criterion exercises the non-initial
   state. (BRAINVIEW: cold-layout-only geometry criteria; the fix was inert at real prod density.)

10. **Verification status** (NEEDS WORK): apply `references/verify-rehearsal.md`. Distinguish
    observed current checks, retained behavior and future tests pending execution. Judge whether
    each changed behavior has a feasible discriminating test; do not demand product red/green
    during planning or treat missing future files as a behavioral test result.

11. **Probes encoded, vocabulary total** (NEEDS WORK): cheap load-bearing current-state probes
    have observed results. Future suites/builds remain explicitly pending. Every verdict vocabulary
    can express the outcomes its probe yields, including unknown or blocked evidence.

12. **Hypotheses refuted** (NEEDS WORK; `category:'fix'` / `kind:'hardening'` only): the
    `## Hypotheses` block exists per `references/phase-file-contract.md`: ≥2 ranked causes,
    exactly ONE `CONFIRMED` with concrete evidence, others `REFUTED` / `NOT TESTED`.

Fix everything found, re-run `roadmap phase validate <N>`, then proceed to commit.
