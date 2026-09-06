# ADR 0001: Technology stack

## Status

Accepted

## Date

2026-09-05

## Context

The repository is an established Nx workspace. `nx.json`, the `package.json` scripts (`nx run-many -t test` and `nx run-many -t build`, both with `--excludeTaskDependencies --skipNxCache`) and `package-lock.json` pin Nx 23.2.0, Vitest 5.0.0 and @vitest/coverage-v8 5.0.0 under npm. Projects are declared by `project.json` files under `apps/` and `packages/`; `shared` and `ui` carry uncached `test` and `build` targets whose Vitest configs emit JUnit and LCOV under `.ci/nx/<project>` or `GREENFIELD_REPORT_DIR`. Sources are ESM JavaScript (`.mjs`); no TypeScript configuration exists. This record documents the proven existing choice. stack-decision was not invoked because the stack evidence is consistent, and a brownfield audit never replaces a proven stack.

## Options
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| Nx 23 integrated workspace (existing) | Locked and proven by present project targets, tests and builds | Daemon and cache need explicit control in CI and wrappers | Several applications and libraries share one project graph | Libraries are consumed through workspace targets | https://nx.dev/docs/reference/nx-commands |
| Plain npm workspaces without Nx | Fewer moving parts | Loses the project graph, affected selection and target orchestration already in use | Very small single-package repositories | Manual | https://docs.npmjs.com/cli/using-npm/workspaces |

## Ruling

2026-09-05: Nx 23.2.0 integrated workspace with Vitest 5.0.0 under npm (existing). Reason: the lockfile, project targets and test/build evidence already prove it, and replacing a proven stack is outside a brownfield audit.

## Consequences

- Positive: gates bind to the existing `npm test` and `npm run build` scripts with `NX_DAEMON=false` for deterministic wrapper and CI execution; scoped, affected and impacted test tiers use `scripts/run-nx-test-tier.mjs`; delivery uses the `nx-monorepo` adapter with leaf identities `shared:test` and `ui:test`.
- Negative: lint, type-check, integration and e2e slots stay `none` until their tooling is installed and locked.

## Revisit when

A project adds TypeScript, ESLint, Playwright or integration tests to `package-lock.json`, or the Nx major version changes.
