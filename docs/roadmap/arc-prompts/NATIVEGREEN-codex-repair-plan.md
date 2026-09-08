# Codex usability repair plan

Status: corrected candidate87ec2d4 is mechanically green and independently reviewed, but the corrected native trial FAILED the10-minute runnable-code checkpoint. All pilot processes stopped. No further native run or release; task43.4 remains incomplete and broader work stays deferred.

## Review findings

The isolated pilot stopped after1000.321 seconds with a committed plan but no application source, tests or completed review. Roughly nine minutes preceded the reviewer launch; roughly seven minutes went to review. This is one failed observation, not a population benchmark. The parent and reviewer stopped; no PR exists.

1. **P0 — review spends work on actions it cannot perform.** `cli/commands/codex.mjs::buildReviewPrompt` disables repair/queue mutation but explicitly requires reasoning through both and recommending placement. `skills/review-phase/SKILL.md` points reviewers into the authoring protocol and demands queue probes. The log records repeated reference reads and placement probes before timeout. Retain independent judgment; remove redundant authoring and placement work from delegated report-only review.
2. **P0 — prerequisite discovered after native launch.** `reviewCodex` deliberately omits `installWorktree`, but review requires `phase validate`, whose consumer schema/tsx dependencies are absent in a fresh checkout. The parent repaired this with npm ci while the reviewer ran. This is a reproduced mismatch, not proof that installation caused most of the timeout.
3. **P1 — parent planning remains expensive.** The pilot already had one phase/one task, so task-count clarification alone cannot explain or fix its nine-minute setup. Avoid a new planning engine. Measure setup separately in the next trial and reject a result that never reaches working code.

The earlier candidate test run completed2728 checks:2726 passed, one failed, one skipped. The sole failure was the generated Astra enum; its64-test rerun and separate schema checks passed after repair. The original full gate remains RED. Usage/beacon/schema-resolution fixes already reviewed remain in the candidate; they are not evidence that usability is restored.

## Implementation order

### 1. Make delegated plan review focused

Change `buildReviewPrompt` and `skills/review-phase/SKILL.md` together. Use the existing REPORT-ONLY lane signal, without a new CLI flag, packet schema or workflow.

- Delegated Mode A reviews the stated intent, task coverage, feasibility, actual source seams, locked decisions, testability, metadata and material risks. It reads the phase, arc criteria and relevant source; missing or contradictory evidence is a finding.
- Point to the existing `skills/plan-phase/references/closure-checklist.md` directly rather than loading the entire authoring skill. Keep `review-phase/references/plan-adversary.md` for judgment. Apply only checks relevant to the reviewed change; report any genuinely required but unverified item.
- Skip Step F mutation and Step8 placement reasoning/probes in this lane. Emit the existing `Placement: NOT QUEUED — delegated report-only review` line. Standalone plan repair/queueing and Mode B behavior retain their existing ownership.
- Preserve one independent reviewer, existing verdict enums, own-model attribution and adverse findings. A supplied author summary is context, never approval. Do not duplicate the protocol in the CLI prompt or remove correctness review.

Verification: extend existing `cli/commands/codex.test.mjs` prompt/report coverage and inspect the rendered prompt; confirm the protocol is still delivered, queue analysis is absent for the delegated lane, standalone behavior is explicit, and the report parser still accepts both clean and adverse outcomes. Prompt assertions establish instructions only; the native trial establishes whether they help.

### 2. Resolve prerequisites before starting the reviewer

Change `reviewCodex`, reusing `detectInstaller`, the existing phase validator, authority envelope, worktree registration and launch/journal machinery. Keep the existing outer installation recipe; do not add installation to the report-only review command. Do not create a second dependency recipe or validation service.

- Validate in the detached review checkout at the resolved requested base, not the primary tree. A dirty primary or non-HEAD --base must not substitute different phase/schema/config bytes.
- After existing live-run/governance/ownership checks and exact checkout creation, run the existing phase validator once. A missing-toolchain result is distinct from an invalid phase: only the former offers an installation remedy; an invalid phase must be repaired. Surface the existing lockfile-selected remedy.
- A cold checkout returns before any model launch with the exact worktree path and existing lockfile-selected install command. The supervising session runs that command only within its already authorized dependency-install scope, then retries the same review command and worktree. No installer runs implicitly in `reviewCodex`; no new approval flag, envelope field or network permission is introduced. A read-only caller receives a concrete hold, not an authority upgrade.
- Invalid phase, unavailable recipe or failed validation means zero native children. Warm valid checkouts need no preparation. Preserve the failed checkout and useful output through existing allocation/unwind behavior; retry must accept the same clean Git-registered detached checkout at the requested base without allocating a second checkout. Do not mint a success journal before validation passes.
- Respect arbitrary --base and existing carry-in rules: validate requested tracked phase/schema/config before copying optional context, then perform existing carry checks. Recheck requested HEAD and tracked/extra loader-input cleanliness before launch; lane-owned carried context is allowed only through existing carry-in checks. Do not reset or delete foreign changes.
- Supply bounded validator output and its requested commit to the reviewer through the existing prompt. The reviewer still independently judges the plan; it does not rerun a dependency-blocked validator or install packages. Missing/truncated output is explicit. Native review remains report-only under the existing enforced authority.

Verification: in `codex.test.mjs`, replace review-launch fixtures that use `export default {}` with a shared minimal valid phase/schema and local toolchain fixture. Keep fixtures offline. Exercise warm/cold, read-only cold hold, invalid phase, outer install failure followed by retry, successful outer preparation followed by reuse of the same worktree, non-HEAD base with dirty primary, tracked/untracked target drift, carried context, and post-validation HEAD change. Failure cases must show zero model launches; existing live-run deduplication, archived review, authority and cleanup tests must continue to pass. Use existing test helpers and validator errors; do not add a permissive fallback merely to preserve invalid fixtures.

### 3. Check the whole usable path once, after the correction

First run configured task checks, packaging and one independent candidate review. Reuse the existing host admission pool. Run the full terminal gate once on the final candidate; retain the earlier RED report. Stop implementation expansion after these two corrections unless review finds a concrete defect.

The owner’s subsequent “do it” authorizes one corrected trial within the proposed20-minute cap; the failed earlier run stays recorded separately. An accessible disposable GitHub target must be verified before launch. Verify the target is readable and usable before spending model time; do not repeat the contradictory repository-creation attempts.

Use the same tiny Markdown-summary intent, installed candidate and normal Roadmap commands. Keep one phase/one task, no UI/design ceremony for a CLI, no new orchestration script and no predicted hashes. Prepare the seed and initial dependencies before launch, but do not pre-author the plan or implementation: intent-to-code setup remains measured. Preparation wall time is reported separately, not hidden as a performance gain.

Accepted corrected-trial budget:20 minutes total native wall time shared across parent/children/resume, with all setup/review/native stages timestamped. At10 minutes, if no runnable implementation exists, stop and report failure rather than consume the remainder on paperwork. At the total cap, terminate the process group/cgroup and preserve artifacts. Report overlapping child time separately rather than adding it twice. CI wait and preparation time are separate elapsed observations. Report uncached/cached input and output where known; unknown tail usage stays unknown.

Acceptance is runnable CLI output with meaningful pure-core and real-stdin tests; one completed independent correctness review; one open non-draft PR with required checks green on its current head; and one same-session resume without duplicate executor/PR. A plan-only result, unknown executor, incomplete review, provider failure or timeout is not a pass. Merge remains manual. If the corrected trial again fails before working code, stop this repair attempt: review the core planning protocol against the evidence before spending another pilot budget. Do not keep adding preparation infrastructure.

## Scope, ownership and readiness

Primary implementation files: `plugins/zeroh-roadmap/cli/commands/codex.mjs`, its `codex.test.mjs`, and `plugins/zeroh-roadmap/skills/review-phase/SKILL.md`. Update only directly contradicted comments/test titles in these owners. Existing phase43.4 owns carried candidate repairs; their files remain declared for configured tests. No new dependencies, engine, receipt type, cache, model-policy change or matrix is proposed.

Planning evidence: source functions and fixtures read at candidate849cabe plus existing uncommitted repairs; `roadmap status` confirms43 is active and existing43.4 covers the work. Existing assumptions and phase validation must pass. Future behavior tests do not exist yet and are not claimed RED or GREEN. Runtime improvement remains a hypothesis until the bounded native observation passes.

Plan review: one independent prospective review found an underspecified installation-authority path. The plan was repaired to remove implicit installation from reviewCodex. Phase validation and both existing assumptions pass; configured task selection includes codex.test.mjs alongside the retained regression suites. No new test suite or native run was executed during planning. Queue remains phase43 at tier0, task43.4 only; completion and deferred task states are unchanged.
Independent re-review of the repaired block returned READY, with no residual blocker. This is prospective plan readiness, not product or release approval.

Implementation review found a HIGH cold-retry ownership-unwind defect and a MEDIUM overbroad prompt test. Both were repaired; independent re-review of the HIGH fix returned no findings. Six targeted cases pass, including a newly allocated cold checkout retry and validation-time mutation refusal. Packaging passes. Final full mechanical gate run-000025-2026-09-08T11-43-29-036Z.json: 128/128 test files completed; 2732 passed, 1 skipped, zero failed/cancelled; schema checks passed. Unit-slot wall time1028.463s (17m08s). Packaging passed. This is one local verification run, not a performance comparison.


## Corrected-pilot access preflight — 2026-09-08

The corrected native trial has not started; its accepted20-minute budget remains unspent. Candidate87ec2d4 was installed through the actual Codex marketplace/plugin CLI into `.building/nativegreen-corrected-codex-home`; installed command, delegated-review skill and generated model-schema bytes match the reviewed source. Global plugin cache was not changed.

One explicit private sandbox creation returned repository ID1361333681 and `Blade-Labs/roadmap-codex-pilot-20260908`. Subsequent authenticated REST reads by name and ID returned404; GraphQL returned NOT_FOUND; HTTPS Git with the gh credential helper returned403. The same gh identity, kolesarp1, can read Blade-Labs/zeroh-marketplace. SSH `git ls-remote` for the new sandbox succeeded with exit0 and no refs, confirming an accessible empty repository. No seed push, PR or native model launch occurred.

This isolates the blocker to API/HTTPS credential access for the new repository; selected-repository token scope is a likely explanation, not a verified token setting. The owner must grant the existing fine-grained credential access to this specific sandbox (and the repository permissions needed for contents/workflows, pull requests and CI/status reads), or supply an already-authorized API identity. No token value should be posted in chat. Recheck REST access before preparing publication or launching the timed trial. Do not create further repositories or repeat the completed full gate.


## Corrected native trial — failed at the accepted stop rule

On2026-09-08 the owner added sandbox token access. REST access was verified, the fresh seed and CI workflow were pushed, and the corrected candidate87ec2d4 ran through the actual isolated Codex installation. No previous phase plan or product implementation was copied. Parent01a08103-0df3-7231-ad60-58a665d50e0a requestedgpt-5.6-sol with codex-full; the plugin-managed reviewer was01a0810b-8301-7601-b55c-5cf98a311869. Guardian sessions are separately identified in the accounting record.

The10-minute checkpoint found no src/cli.mjs in either consumer or reviewer checkout. The supervisor stopped the complete capbuild cgroup; the pool recorded600.000539s native wall time and exit125. Final reviewer status is dead-no-report/alivefalse; no pilot processes remain, no PR exists, no same-session resume was attempted and no release is authorized. Task43.4 remains incomplete. This is a failed usability observation, not a failure of the already-green2732-test mechanical gate.

The cold-checkout preflight path worked: the parent prepared dependencies before the reviewer launched at12:43:29.894Z, approximately9m15s after the12:34:15 start. There was too little reviewer runtime to judge the focused-review speed hypothesis. Initialization, reference/schema reading and planning consumed most of the budget. Concrete retries included a host bwrap patch failure, shell quoting in a verification command, missing --parent-authority, and --doc consuming the following option as a path. Do not attribute all elapsed time to any one retry or infer a population benchmark.

Decision: stop this repair attempt as agreed; no third native trial or broad arc expansion. Review the existing planning protocol for a minimal small-project path before authorizing further implementation. Preserve independent correctness/intent review, but move the next investigation to work required before runnable code. Current repairs remain mechanically valid; they did not establish usable intent-to-PR completion.

Evidence: NATIVEGREEN-corrected-pilot-20260908.json retains checkpoint, pool timing and last-observed usage (including separately labeled guardian overhead). Raw native logs and local consumer/worktree remain under /tmp/nativegreen-corrected-pilot-20260908. The owner will delete zeroh-roadmap-pilot, atlas-connector-proof-84 and roadmap-codex-pilot-20260908; this session deletes none. The completed pilot no longer needs its remote repository.
