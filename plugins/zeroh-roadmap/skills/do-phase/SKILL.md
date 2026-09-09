---
name: "Do Phase"
description: "Implement one phase with native tools, meaningful checks and proportional independent review."
user-invocable: true
---

# Do Phase

Read the phase, parent arc, approved intent and consumer conventions. For an arc-owned phase, coordinate through its supervisor and existing work claim; do not reacquire with a different owner. Standalone execution acquires `roadmap claim --work phase-<N> --owner <stable-owner>`. Validate the typed file before execution using `roadmap phase validate <path>`.

Check load-bearing assumptions before mutation. A failed assumption triggers investigation and an in-scope plan correction; a scope or acceptance change requires an owner decision. Preserve unrelated work; use the project's branch/worktree practices. A file-access refusal is a real tool boundary, not a reason to fabricate a workflow adapter.

For each ready task:

1. Inspect the relevant code and implement the agreed behavior. Use a native developer or test helper only when independent work justifies its overhead. If a child cannot spawn, ask the supervising session to dispatch the helper.
2. Run the consumer's documented focused checks through the native shell. Honor the host's resource admission (for example its installed capbuild wrapper); do not guess concurrency limits or invent a plugin scheduler. Observe exit codes and interrupted results. Validate syntax/inputs before expensive or mutating work when possible; save an exceptional large program once rather than retyping executable bytes.
3. Inspect the diff, fix actionable failures, and persist concise typed progress with commands/results and remaining gaps. Commit coherent units according to the consumer's policy; no fixed commit grammar or one-commit-per-task ritual. A task is not done while its required work or check is unresolved.

After tasks, run required checks not already covered by current evidence. Request an independent `code-reviewer` for substantive behavior changes, providing the diff, original requirements, commands/results and known limits. A docs-only phase still gets a brief independent review of its claims and links; it does not need a new test suite or review panel. Never claim independent review that did not occur. See `review-phase` for the early-close three-round ceiling.

For a standalone user outcome, independently drive its acceptance as `validate-arc` describes. In an arc, the final whole-outcome intent check remains the supervisor's responsibility. Set completion only when required checks and review are resolved, then run `roadmap phase validate <path>` again. A fail-soft hook is not this strict check.

Return what changed, observed checks and exits, independent review result, and any unresolved work or blocker. An unavailable check, permission refusal, timeout or interrupted process remains unresolved. Do not return success just because implementation commits exist. Release a standalone claim with the same owner on completion or an explicit checked handoff.

Completion records must satisfy the typed done shape: independent review, completed tasks, and successful required checks or `checks: []` with a justified `checksNotApplicable` reason. Run the consumer’s combined typecheck and `roadmap phase validate --all` command before final closure. Do not invent check results or weaken requirements to satisfy the schema. Runtime refinements remain necessary; a clean `tsc` alone does not verify relationships or original intent.

For migrated records, also read `extensions.roadmapMigration.original` and its preserved source for task steps, acceptance details and owner rulings. Those requirements remain relevant; legacy execution-engine settings are historical metadata.
