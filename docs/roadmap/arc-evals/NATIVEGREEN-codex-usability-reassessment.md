# NATIVEGREEN: one Codex usability pilot

Owner ratification, 2026-09-08: “yes, I want one real Codex end to end run, necessary fixes and review.” This supersedes the full-arc resumption. Task43.4 is the only active release work;43.5–43.8 and phases44–45 remain deferred and not done. Completed36–42 and43.1–43.3 are preserved.

## Release bar

Use one installed candidate in an isolated ordinary consumer. A real Codex session must produce runnable tested output, bounded independent review, one non-draft open PR whose required checks pass on the current head, and a resume without duplicate executor/PR creation. No session-authored workflow driver or predicted hashes. The existing CLI/session handoff is the entrypoint.

Reuse the previously ratified 20-minute native-runtime ceiling, shared capbuild admission, one targeted correction and one independent review. A HIGH repair gets one bounded re-review. Preserve incomplete work on timeout, unknown executor state, missing authority, repeated failure or material gaps. Known token usage and unknown usage remain separate; the native CLI has no hard token ceiling. Merge stays manual. One observation supports only the exercised Codex path.

Keep necessary repairs and already shipped0.40.4/0.40.5 fixes. The uncommitted matrix-preflight extension has been saved to `.building/nativegreen-deferred/43.4-matrix-preflight.patch` and removed from this candidate; native usage preservation remains active. Original broad task text remains in the phase and Git.

## Consumer feedback, requested through Herdr

Read-only requests sent to existing ZeroH Codex (wY:p1), Viky supervisor (w2:p1), and Atlas supervisor (w8:p1). They were asked to use existing observations only, preserve their current work, and avoid tests or model runs. These reports are inputs, not fresh acceptance evidence.

| Consumer | Report and verification | Disposition |
|---|---|---|
| ZeroH | Session read cache0.40.3 after stale catalog0.39.1 path failed. Native collaboration reviews worked; the session did not execute a Roadmap arc. Broken bwrap RTM_NEWADDR required shell escalations. | Stale-session/cache guidance and host issue; do not claim a Codex end-to-end success. |
| Viky | Claude supervisor reports native Codex builders/review/plan lanes and real journals. Append-only guard phantom comment element was fixed in7186476 (0.40.4); Astra alias supplied by95255dd (0.40.5). Kotlin task tests expanded to npm tests; fresh review worktrees lacked node_modules. Xvfb reaping and login failures were host/auth issues. | Carry shipped fixes. Check custom test mapping and review bootstrap; fix only reproduced release blockers. Native Codex child usage is corroborating evidence, not a Codex-parent pilot. |
| Atlas | Claude supervisor used a scratch plane driver; phase84 itself executed on Claude. Codex was used directly for architecture/review. Real84-executor.jsonl contains17 `at` records and8 canonical `ts` records; reader produces NaN for `at`. Contract schema script imports zod from consumer eval cwd rather than the schema dependency home. | Candidate already has maintained CLI plane entry. Repair timestamp refusal/compatibility and schema-local dependency resolution. Consumer schema migration remains separate from changing parser expectations. |

Atlas’s current push403 is a GitHub App permission issue, not Roadmap failure. Viky’s four-round design reviews found real problems; do not remove required review because the round count is high. Both reports describe foreign/supervisor commits blocking cosmetic curation; preserve those commits.

## Current checkpoint

Scope commit709b3f1 narrows execution to43.4. Shipped fixes7186476 and95255dd are carried as05ce8c3 and849cabe; generated manifests align with package0.40.5. Native-usage preservation, legacy/invalid beacon timestamp handling and schema-local Zod resolution pass62/62 configured task checks (run000021,84.390s). Independent narrowed product review is clean; packaging passes.

Full mechanical run000022 completed128 test files in30m16s:2726 passed, one failed and one skipped. Its only failure was the stale generated config schema for the carried Astra alias. Regenerating the schema added Astra to three enums; all64 owning config tests then passed and the separate schema suite passed. The recorded full gate remains RED; these repair checks are not a second full green gate.

The installed-candidate native pilot FAILED its1000-second local-leg deadline (observed1000.321s;20m09s including admission wait). Real Codex initialized Roadmap and committed a validated one-phase plan, then launched an independent plugin-managed plan reviewer. At termination there was no src/ directory, no test/ directory, no completed review report and no PR. No end-to-end pass, resume proof or release readiness is claimed. Parent thread01a0807e-d9ed-7b13-be94-b3f6a857a956; reviewer01a08087-6075-7192-bb12-cff7b349ffcd; requested modelgpt-5.6-sol. The installed cache predates only the three generated Astra enum additions; this pilot exercised codex-full/Sol. Shared admission stopped the parent and child processes; the review status is incomplete.

About nine minutes went to initialization/planning and seven to plan review. The fresh reviewer worktree lacked node_modules; the parent installed the committed lockfile dependencies while the same reviewer continued. The reviewer then spent time traversing the full review/plan references and queue/placement probes without emitting its typed report. Broken host bwrap also caused two apply_patch failures recovered through shell. The bounded independent architect diagnosis is STOP_WITH_FAILED_PILOT: protocol overhead is the main evidenced issue; bootstrap alone is not established as the cause. Preserve the remaining native budget, do not retry unchanged, and keep43.4 incomplete. A future correction should scope the existing review input and prepare its dependencies before launch while retaining independent correctness review; it requires validation before any usability claim.

Last observed native accounting: parent4066664 input tokens (3963136 cached) and15931 output; reviewer473784 input (424192 cached) and4428 output. These are interrupted-run observations, not complete-turn totals or billed cost; cached input is included, not added again. Missing tail usage remains unknown. Raw evidence and outcome.json are preserved under /tmp/nativegreen-codex-pilot-20260908-j3vkcnom/evidence; the reviewer journal/log remain in that consumer’s .building directory.

GitHub setup is unresolved: gh create produced an invalid https://github.com//.git remote. REST and GraphQL reads of Blade-Labs/zeroh-roadmap-pilot return404/not-found; REST and explicit-owner GraphQL create both return name-already-exists. The owner reports no such repository. Existence and permission cause are not established, so no further creation attempts or token-change claims are justified. The invalid origin was removed before native execution, which prohibited external publication. An existing disposable target was requested; the failed local pilot is an independent blocker. Earlier wording implying a verified created repository was incorrect. Full-arc completion, broad parity and performance improvement remain unclaimed.

## Implemented repair checkpoint

Final full mechanical gate run-000025-2026-09-08T11-43-29-036Z.json: 128/128 test files completed; 2732 passed, 1 skipped, zero failed/cancelled; schema checks passed. Unit-slot wall time1028.463s (17m08s). Packaging passed. This is one local verification run, not a performance comparison.

Delegated report-only review now skips authoring/queue work while preserving independent intent, feasibility, source and verifier judgment. reviewCodex validates the exact target checkout before native launch, returns a lockfile-derived remedy for a cold toolchain without installing, and preserves owned cold checkouts for external preparation and retry. Requested-head or checkout mutation refuses; carried inputs are revalidated before launch. Six targeted behavior cases pass. The first task run000023 had only the overbroad prompt assertion failure, repaired before the full green run.

Independent implementation review found one HIGH ownership-unwind defect and one MEDIUM test assertion defect. Both were repaired; bounded independent HIGH re-review returned no findings. Candidate native usage/beacon/schema-resolution repairs and shipped version alignment are retained. Actual collaboration reviewer model identity is unverified.

The owner’s do-it instruction accepts one corrected trial with the proposed20-minute cap. The GitHub target still returns404; no corrected native session has launched. Task43.4 remains in progress, with no PR/resume/release success claimed. Deferred work remains deferred.
