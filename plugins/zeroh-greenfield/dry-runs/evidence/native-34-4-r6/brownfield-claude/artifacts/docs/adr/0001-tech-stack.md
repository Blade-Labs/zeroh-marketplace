# ADR 0001: Technology stack

## Status

Accepted

## Date

2026-09-05

## Context

The repository is an existing npm-managed Nx workspace: `package.json` (`zeroh-shaped-fixture`, private) declares only `nx ^23.0.0` as a devDependency, with no lockfile and no installed `node_modules`; `nx.json` has empty `targetDefaults`; `apps/web`, `apps/api`, `apps/admin`, `packages/shared`, `packages/ui` and `packages/generators` each carry a `project.json` naming only `name`, `root` and `projectType`, with no targets. No framework configuration (`next.config.*`, `vite.config.*`, `app.json`, `android/`, `pubspec.yaml`) exists. The workspace is structural; no runtime, test runner or build tooling is present. Private, unlicensed, non-Blade, no mobile, no product remote or deployment.

## Options
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| Retain the existing Nx workspace as-is | Preserves the evidenced structure and boundaries; invents no tooling | Apps stay non-runnable until a runtime is chosen | The repository is structural and the product runtime is undecided | Shared packages are already modelled as Nx libraries | `nx.json`, `package.json`, `apps/*/project.json`, `packages/*/project.json` |
| Select a runtime stack now via stack-decision | Enables runnable targets and real gates | Requires product facts that are unknown and would replace a proven existing choice | Product runtime requirements are known | Depends on the selected stack | not evidenced |

## Ruling

2026-09-05: Retain the existing Nx workspace. It is the proven evidenced choice; no runtime stack is selected because the repository provides no product facts and no runnable targets, and `stack-decision` is deferred until requirements exist.

## Consequences

- Positive: existing homes and boundaries are preserved; `docs/architecture.md` links them.
- Negative: every quality gate is declared absent (`none`) in `roadmap/roadmap.config.json` until tooling is actually installed and bound.

## Revisit when

A runtime is selected for any app, a lockfile or `node_modules` appears, or any `project.json` gains an executable target.
