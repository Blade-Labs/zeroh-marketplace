# NATIVEGREEN restart and completion ownership

2026-09-07 — VERDICT: PROCEED_WITH_FIX. Independent software-architect, native fallback requested gpt-5.6-sol; runtime model unverified.

Task 37.4 keeps `classifyJournal` as the read-only reset/relaunch decision. Unique commits always refuse reset. It validates ownership, liveness, actual Git state and existing completion bindings without changing files.

Task 37.5 separately validates whether a completed plan/review report may be served. A plan may legitimately have an authored commit descending from its requested HEAD; this does not permit reset. A review must remain at its requested HEAD. Both require current request, actual working HEAD/report bytes, and matching owner, governance, authority and completion bindings. A moved request invalidates reuse.

The existing `archivePlanLane` remains the sole owner of the one-file invariant, committed blob and path-history harvest proof, copy-before-delete and disposal. Serving a valid unharvested plan returns the existing harvest instruction and preserves its worktree. No new journal, scheduler or disposal engine is introduced.

Verification must distinguish a valid authored plan from a resettable lane, reject stale or mismatched completion, and retain the existing harvest/disposal tests.

## Automatic completion capture (task 37.5 refinement)

The independent architect ratified a hidden supervisor inside the existing Codex command. It runs one native child, captures its actual exit and final files, and stamps the existing journal once. Status validates those bytes; it never creates or refreshes a completion hash. The model receives no new proof-writing instruction.

The parent publishes the initial journal atomically before acknowledging the ready supervisor to start native work. The supervisor starts behind an IPC handshake, so its process-group identity is known before publication and no native work can race that write. The supervisor is the process-group leader, so existing liveness/disposal checks cover its native child. It recomputes native argv through the existing authority/driver owner, binds the launch identity, and alone publishes final exit and completion evidence after the initial record. The parent must not overwrite a fast child's final record with a late PID patch. Starting, spawn failures, signals and failed finalization remain explicit preserving outcomes; only successful terminal execution receives a reusable completion binding.

The supervisor is one existing-command process, with no new journal, service, scheduler or retry mechanism. Tests cover immediate exit, actual final-byte binding, repeated reads, later report mutation, liveness and preserving failures. Existing plan harvest and review archival remain their current owners and run only after valid completion and group exit.

The restart implementation uses `git reset --keep` only after the existing classifier proves ownership, inactivity, cleanliness and no private commits; primary and provisioned worktrees refuse. Automatic approval review rejected the earlier proposed `--hard` source patch for potential data loss, then approved this preserving alternative. No reset of the execution or primary checkout was performed by this task.

Request identity includes actual prompt and carried input bytes. A changed question may start fresh in a clean owned lane with no private commits. A completed authored plan remains protected from reset. Both decisions share journal/worktree identity and cleanliness inspection; archived completion remains bound to its canonical report and actual bytes.

## Historical plan harvest

The full compatibility gate exposed a lifecycle distinction: harvesting an authored plan advances its requested branch. Current-ref completion correctly refuses reuse of the old result, but must not strand the harvested worktree. The architect ratified a separate `validatePlanArchiveCandidate` API backed by the same private immutable-binding checks. It validates the original requested commit solely for the existing `archivePlanLane` harvest owner. Normal completion validation has no permissive mode.

Only an actual successful harvest and disposal may return `historical-plan-consumed`, with `freshForRequestedHead: false`, the original and current requested commits, and the archived report. It cannot answer a new plan request. Unharvested or tampered historical plans preserve every byte; moved review requests remain strict refusals. No new persistence or cleanup engine is introduced.

Parent review of 37.5 also found unconditional carry-in copying after stale reset. Both plan and review now preflight the requested input before reset: a tracked target must already contain identical bytes and is never copied over; refreshing an existing untracked input requires its prior lane path and actual digest to match. Incompatible input preserves the old HEAD, journal and files. This extends the existing carry owner and adds no permission gate. Verification belongs to the fresh configured 37.5 task report.
