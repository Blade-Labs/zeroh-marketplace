# Phase 34 pre-release quality pass

Reviewer: native gpt-6-astra; 2026-09-05. Scope: `29e0ded..HEAD` plus current dirty phase-34 source in `/home/patrik/zeroh-marketplace-codex-29-30-31-32-33-34`; Roadmap 0.40.0 / Greenfield 1.0.0 release preparation. Read the quality-pass agent card, phase 34 scope/transparency reports, and roadmap.config.json. No root CLAUDE.md/AGENTS.md or configured testConventions were present; inferred node:test/assert conventions from adjacent fixture-consumer tests. One pass; no recursion.

LINES −2/+2 across 2 files (ten unused import bindings removed; net zero lines).

FIXED (architect): none.

FIXED (simplify):
- `plugins/zeroh-greenfield/templates/scripts/ci-shard-plan.mjs:6`: removed unused `relative` and `isAbsolute` imports.
- `plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs:10`: removed unused `safeArtifactPath`, `sessionSuffix`, `readBoundFile`, `MUTATIONS`, `STAGE_FILES`, `REQUIRED_HOMES`, `rows`, and `treeHash` imports. No assertions, cases, or validation rules changed.
- Evidence: each removed binding occurred exactly once in its importing file, on the import declaration. No exports deleted; whole-repository export-deletion search requirement is not triggered.

SURFACED: none.

HARD-STOPS: none.

SKIPPED: historical dry-run evidence and unrelated files preserved. Native proof refresh is already required under incomplete task 34.7; no commit made.

BUGS NOTED: none. Typed unresolved issues: `[]`.

Validation:
- `node plugins/zeroh-roadmap/bin/roadmap.mjs gate run 34 --base 29e0ded --slots types --json`: green; types is explicitly configured `none`, not an executed type checker. No filtered peval was written.
- `capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-*.test.mjs plugins/zeroh-roadmap/cli/commands/init.test.mjs plugins/zeroh-roadmap/cli/commands/role.test.mjs plugins/zeroh-roadmap/cli/lib/drivers.test.mjs plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs plugins/zeroh-roadmap/test/collect-phase-metrics.test.mjs`: 195 tests, 193 pass, 2 fail, 0 cancelled/skipped. Exit 1. Both failures are the explicitly expected pre-refresh native proof state: stale source snapshot and historical pre-delivery receipts. All remaining tests, including all 27 delivery CI/release cases, pass. Full output: `quality-pre-release-tests.log` beside this report. This is not a full green phase gate.
- `git diff --check`: passed. Roadmap package/JSON manifests agree on 0.40.0; Greenfield Claude/Codex manifests agree on 1.0.0.

Disposition: quality sweep has no remaining blocker. Source can freeze after the required correctness review and any resulting fixes; then regenerate all four final native arms against that frozen source and satisfy task 34.7/full gates before committing completion. The two import-only fixes are retained because the two known receipt failures predate cleanup and are unrelated to runtime semantics.
