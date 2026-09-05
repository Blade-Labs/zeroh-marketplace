# ADR 0001: Technology stack

## Status

Accepted

## Date

2026-09-05

## Context

The repository is an existing npm-managed Nx workspace: `package.json` declares `nx ^23` with no lockfile and no installed `node_modules`; `nx.json` has empty `targetDefaults`; `apps/web`, `apps/api`, `apps/admin`, `packages/shared`, `packages/ui`, and `packages/generators` each carry a `project.json` without targets. The workspace is structural; no runtime, test runner, or build tooling is present. Private, non-Blade, no mobile, no product remote or deployment.

## Options
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| Retain the existing Nx workspace as-is | Preserves evidenced structure and boundaries; no invented tooling | Apps remain non-runnable until a runtime is chosen | The repository is structural and the product runtime is undecided | Shared packages already modelled as Nx libraries | `nx.json`, `package.json` |
| Select a runtime stack now | Enables runnable targets and gates | Requires product facts that are unknown; would replace a proven existing choice | Product runtime requirements are known | Depends on the selected stack | not evidenced |

## Ruling

2026-09-05: Retain the existing Nx workspace — it is the proven evidenced choice; a runtime stack is not selected because the fixture provides no product facts and no runnable targets, and stack-decision is deferred until requirements exist.

## Consequences

- Positive: existing homes and boundaries are preserved; the architecture index links them.
- Negative: every quality gate is declared absent (`none`) in `roadmap/roadmap.config.json` until tooling is actually installed.

## Revisit when

A runtime is selected for any app, a lockfile or `node_modules` appears, or any `project.json` gains an executable target.
