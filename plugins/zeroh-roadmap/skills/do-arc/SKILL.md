---
name: "Do Arc"
description: "Supervise native phase workers, replenish a bounded planning window, and independently judge the original outcome."
user-invocable: true
---

# Do Arc

The **native supervising session** owns this loop. Read the arc, its approved-intent Git source, legitimate owner ratifications, phase progress and project guidance. Do not launch a workflow file or custom runtime. Native dispatch and fallback rules are in `../../MULTI-DRIVER.md`.

1. Acquire the arc's exclusive work claim using `roadmap claim --work <arc-id> --owner <stable-owner>`. Reuse the same owner only when resuming that owner's work. A foreign claim is a stop, not permission to bypass ownership. Select a clean branch/worktree using ordinary Git; preserve unrelated edits. Run strict `roadmap phase validate <arc-path>` before starting. Active legacy arcs must first establish their actual approved baseline.
2. Find a ready detailed phase from typed dependencies and progress, not chat memory. Dispatch one native `phase-executor` for that phase with its file, arc criteria, scope, worktree, permitted writes, check commands and budget. The supervisor keeps authority for queue edits, scope decisions and landing. Run phases serially unless their dependencies and file ownership demonstrate safe independence.
3. Supervise using the host's actual agent lifecycle and shell tools. If the worker cannot spawn an independent helper, dispatch that helper from the supervisor and relay the result. A worker's self-check is not independent review. If native dispatch is unavailable, implementation can run inline with honest attribution, but required independent acceptance remains pending.
4. Read the returned diff and check results. Complete phases only after meaningful checks and independent review. Diagnose failures before retrying. Continue in-scope repairs without repeatedly asking permission; never silently change original criteria. After an interruption, inspect Git, files and actual tool state before retrying. Unknown running work is not completed, and a cached result is not a fresh run.
5. At the window boundary, compare observed behavior and assumptions with the approved arc. If criteria remain deferred, use `plan-arc`/`plan-phase` to detail the next one or two phases within scope and budget, review and validate them, then continue. Exhausting the current queue does not finish the arc. An assumption change that exceeds a boundary requires a specific owner ruling before dependent work proceeds.
6. Once all phases are built and no criteria remain deferred, use `arc-sweep` and `validate-arc`. Keep one coherent independent acceptance review rather than redundant panels. Repair gaps within the authorized scope and remaining budget; validate changed records again. Never label the arc complete because the review budget ran out.
7. Present the actual diff/PR and checks. Merge, push or release only within existing user authorization and project policy, using native Git/provider tools. No mandatory scoring/evaluation phase follows landing. Release the work claim explicitly with the same owner when work is finished or a checked handoff has been agreed; do not automatically reclaim another owner's stale claim.

Review rounds are a **ceiling of three, not a target**. Close on a clean first review. Follow-up reviews focus on repairs and impacted behavior. An unresolved issue after the ceiling stays open with its evidence; further spend needs a new bounded decision. Do not restart identical expensive checks without a diagnosed change or unresolved concern.
