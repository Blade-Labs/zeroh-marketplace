# NATIVEGREEN: minimum Codex usability release

Owner direction, 2026-09-07: preserve the idea/interview/template → runnable prototype → reviewed PR purpose, use this repository's `codex-full` configuration, and stop spending a large weekly quota on the broad arc. The owner then authorized this reassessment. The old ten-phase execution order remains paused; this is the smaller release scope, not a completion claim for deferred criteria.

## What the next release must do

A Codex user can start an arc from an installed plugin in a consumer checkout, execute one phase at a time, resume the same work after an interruption, close a bounded independent review, and produce one open PR with checks verified at its current commit. Routine authorized actions reuse the session's permission scope. No consumer must author an orchestration script, predict a hash, retype generated programs, or install a new workflow engine.

## Three ordered work packets

| Priority | Change and existing owner | Required verification / stop rule |
|---|---|---|
| P0: supported arc entrypoint | `skills/do-arc/SKILL.md`, `workflows/arc-plane.workflow.mjs`, `cli/lib/workflow-steps.mjs`, existing `cli/commands/arc.mjs` and `bin/roadmap.mjs`. Provide a maintained CLI handoff for the existing Node workflow, with the session's native agent tool supplying execution. Resolve code from the loaded plugin and the consumer cwd separately. Expose the already-owned prepare/result-tail operations instead of copying them into a scratch driver; reuse existing arm/beacon/result records. Codex must not require Claude's Workflow tool. | An external consumer checkout can obtain the next executor handoff and submit its actual result without adding the entire marketplace to its tool roots or writing JavaScript. Missing runner capabilities fail before arming/spawning. A second call while an executor is live or unobserved waits/holds; it never creates another executor. An invalid result cannot groom or advance the phase. A real returned valid result advances once; repeat is a no-op. Use deterministic fixtures first. |
| P1: safe, small release candidate | Start release extraction from completed phases36–39 at `94b8afc`, retaining the separate `codex-full` owner change `f55e379`. Keep the phase40 history/GC implementation on its existing branch, outside this first release slice. Review this candidate's actual Codex start/resume/review paths and carry only essential fixes. In particular, automatic destructive cleanup must hold rather than reintroduce force-removal of uncertain worktrees; preserve previous review artifacts before reuse. | Excluding phase40 must also exclude its unresolved generation-replacement race; do not claim disabling GC configuration removes that code path. Verify candidate diffs and these safety properties before a native pilot. If retaining phase40 proves necessary, its recorded HIGH must be fixed and independently re-reviewed before it can ship. Do not spend on that optional subsystem merely because it is already written. |
| P2: one Codex intent-to-PR trial | Reuse Greenfield's shipped interview/templates, the existing bounded correction/review protocol, native Codex tools, and Git/GitHub CLI. One tiny consumer fixture, one branch, one non-draft PR. The supervising session looks up the existing branch PR before creating one, checks required CI against the current head, and leaves merge manual. Add only concise tested kickoff/resume instructions. No new provider, delivery-receipt, CI-monitor or telemetry framework. | Start with one actual Codex pilot and a 20-minute native-runtime ceiling; at most one targeted correction after an identified defect. Stop on timeout, unknown executor state, missing authority or repeated failure; preserve outputs and resume only missing work. A remaining material gap means no release, not a new automatic arc. Record wall/native time, known usage and unknown usage separately. One observation supports this tested path only. |

P0 and P1 are code preparation; P2 is the release acceptance check. One targeted independent correctness review follows the fixes; a HIGH repair gets one fresh bounded re-review. Run affected deterministic tests while changing code and one required final candidate gate after the implementation is stable. Do not duplicate whole suites or native comparisons merely to regenerate reports.

Existing authority remains reusable; this scope does not widen native/network/merge permissions. The native ceiling limits an authorized pilot; it is not a token or cost prediction.

## Deferred from this release

- Phase40's automatic whole-arc history normalization and general owned-worktree GC. Preserve the work and unresolved R1 finding; no completion or release claim.
- Phase41's stacked/grouped targets, provider abstraction, durable delivery engine, merge queues and auto-merge. Basic one-PR delivery remains in P2.
- Phase42's autonomous monitor/policy/failure-classification engine and broad repair matrix. Current-head CI and bounded owned corrections remain required, using existing tools.
- Phase43's four parent/child combinations, paired baselines, three concurrent arcs and broad live comparison. One Codex pilot replaces these as this release's support claim, not as evidence that those deferred cases pass.
- Phase44's whole-codebase comment/provenance ratchets and refactoring campaign.
- Phase45's visual orientation, comparison article, documentation projection engine and cross-host documentation certification. A short, accurate Codex kickoff/resume guide remains required.

The 37 unfinished task descriptions are retained as backlog material, not scheduled execution. Do not mark them done or silently treat the original broad arc acceptance as passed. Before executing this slice, align the existing pending plan with these three packets rather than creating another large arc.

## Atlas / Gandalf finding

Observed in Atlas session `b0ce437d-b0dc-49c6-8e64-c821a29c902f`, 2026-09-07 20:33:25Z. Consumer cwd was `/home/patrik/atlas`; the loaded skill's base was `/home/patrik/zeroh-marketplace/plugins/zeroh-roadmap/skills/do-arc`. The Workflow tool refused the marketplace script path before execution. A subsequent Read of that file succeeded: Bash/Read access did not establish Workflow script-path admission.

There is a second, independently verified mismatch. The loaded Workflow authoring reference says its JavaScript runtime has no filesystem or Node APIs; Roadmap's module imports `node:fs` and `node:child_process`, exports a Node function, and requires an injected `deps.agent`. Merely adding a directory cannot make that module executable in the Workflow tool. Gandalf then authored a 109-line session-side driver over the plugin's exported steps and launched phase84 with a watchdog. This is concrete evidence for P0, not evidence that the executor itself failed.

The owner authorized a direct Herdr message, delivered to the Atlas pane `w8:p1`: retain the existing executor/watchdog, never spawn again on an unknown/monitor outcome, check its arm identity, and require the real result plus review/verify-complete before advancement. No Atlas files, model policy or installed plugin were changed by this assessment.

## Current evidence and exclusions

Source `b11770b`: full mechanical gate000025 passed2474/2474 across108 suites plus schema in663071ms. Independent R1 found one unresolved HIGH journal compare-to-rename race. Pause checkpoint `6040308` preserves the finding. Mechanical green does not make phase40 ready to ship. Completed phases36–39 and the owner policy commit are candidate inputs, not a tested new release combination. No new native run, test suite, code repair, publication or release was performed during this reassessment.
