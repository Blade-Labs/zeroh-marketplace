# GREENFIELD / NATIVEGREEN review repairs

Date: 2026-09-04. Scope: the six findings accepted by the user; this is not an arc-completion verdict.

## Changes

- GREENFIELD implementation worktree: replace literal placeholder gate commands with proposal bindings or explicit declared absence. Require actual tooling evidence, installation of promised runners, consumer cwd/exit records, and execution of every non-absent gate. Do not turn missing promised tests into absence to obtain green.
- Expand brownfield detection categories into individual required artifact gaps. The oracle now accounts separately for PRD, tech-stack ADR, design-system ADR, CODE-STYLE, architecture index and UX canon. Unselected optional tools do not generate setup proposals.
- Require zeroh-design only for the approved Blade handoff. Non-Blade gap repairs can proceed without it.
- Use the installed canonical root resolver, with an explicit read-only invocation, for docs/roadmap, overrides and ambiguity. A marked root missing config is partial and stops for recovery, not initialization.
- NATIVEGREEN planning worktree: replace the inverted rg -L verifier with scripts/check-roadmap-imports.mjs; require nonempty artifact sets, correct imports and an existing root-local schema. Migration includes active plan/config/script references, not just imports.
- Correct post-migration references in phases 42–45 and remove phase 42's obsolete exact producer-list assertion.
- Update GREENFIELD arc, execution prompt and phases 33/34 in primary, implementation and planning worktrees. Update NATIVEGREEN arc, design, execution prompt and relevant phase contracts in its planning worktree.

## Evidence

- GREENFIELD targeted tests reproduced four failures before the fixes.
- 75 focused tests passed: greenfield-review-regressions.test.mjs, slots.test.mjs and roadmap-root.test.mjs. Coverage includes slot resolution/declared absence, document-row deletion mutations, conditional Blade dependency, actual migrated-root resolution, override precedence and ambiguity refusal.
- Two NATIVEGREEN regression tests passed. A temporary migrated tree loaded all 48 real arc/phase artifacts through tsx and Zod. Incorrect relative imports, legacy aliases, missing schemas, empty arc sets and stale pending-phase paths are rejected.
- All typed artifacts imported successfully in the three working trees: primary 37, GREENFIELD implementation 37, NATIVEGREEN planning 48.
- git diff --check passed in all three worktrees.
- Validation reused locally installed dependencies. The temporary dependency link in the planning worktree was removed afterward. No network installs or product/provider mutations were performed.

## Remaining arc evidence

These tests prove the repaired contracts and root/slot behavior; they do not prove model compliance or execute all six ecosystem generators. Phase 34 remains responsible for fresh native-host runs, every generated gate's actual exit, changed-body skill regrading and final CI/release evidence. Its acceptance criteria now explicitly require the corrected scenarios and prohibit reusing earlier evidence for changed bodies. Historical grade measurements are marked pending for changed skills, not silently treated as fresh PASS.

NATIVEGREEN remains a plan. Its future migration and full lifecycle still require the execution evidence specified by its arc. No phase was marked complete by this repair pass.

Existing untracked dry-run work, CODEX-REPORT.md, live-evidence tests, review documents and pending lessons were preserved. No commits were created.
