# Product requirements

## Product

Unknown. The repository is a structural Nx workspace; no product statement exists in any inventoried home (`README.md`, `AGENTS.md`, `docs/architecture/`). The unknown is preserved, not invented.

## Audience

Unknown. No audience statement exists in the repository.

## Platforms

Web-shaped Nx workspace only: `apps/web`, `apps/api` and `apps/admin` are structural project directories whose `project.json` files declare no runnable targets. Mobile: none.

## Constraints

- Private, unlicensed repository; non-Blade; no product remote, runtime or deployment.
- The existing Nx workspace (`nx.json`, `package.json`, six `project.json` files) is retained and linked, never reselected.
- Design registry: none selected.
- No dependency installation, lockfile or `node_modules` is introduced for apps that have no runnable targets.

## Non-goals

- Selecting or installing a runtime stack, test runner or build tooling for the structural apps.
- Replacing existing homes (`AGENTS.md`, `docs/architecture/boundaries.md`, `docs/architecture/workflow.md`, `emitted/repo-catalog.json`).

## Success signals

Unknown. No measurable signals are recorded in the repository.

## Brand

Unknown. Non-Blade; no brand values exist and none are invented.

## Decisions

| Date | Ruling | Reason |
| --- | --- | --- |
| 2026-09-05 | `APPROVE GREENFIELD PLAN` accepted for the brownfield-audit proposal: six documentation homes, README catalog reconciliation (three added library rows, one approval-gated orphan removal), CLAUDE.md and GEMINI.md pointer reduction, config-only `roadmap init --config` rebound to seven `none` gates with design-home pointers, and the copied README catalog checker. | Fills only missing, partial or stale homes; preserves present homes byte-identically; invents no runtime stack, dependency or test for a workspace without runnable targets. |
