# ADR 0001: Technology stack

## Status

Accepted

## Date

2026-09-05

## Context

greenfield-proof is a small TypeScript greeting library with a CLI for developers on Node 22+ / Linux, managed with npm, private and UNLICENSED, with no framework runtime, external service, authentication, mobile target, deployment or product remote. Only the Library/CLI matrix applies. Not presented: Web and Mobile (no UI surface), Monorepo (single package), Backend (the "API" is an exported function, not a network service).

## Options

### Library/CLI
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| tsup + node:test | Compact bundling with built-in tests | Two separate tools | Small TypeScript package values minimal test dependencies | Exported modules and fixtures | tsup |
| tsdown + vitest | Modern bundling and rich tests | Additional test dependency | Vite-aligned libraries need fast test ergonomics | Exported modules and test helpers | tsdown |
| unbuild | Convention-led library output | Less explicit build control | Multi-format package follows unjs conventions | Package presets and modules | unbuild |

## Ruling

2026-09-05: tsup + node:test — Small TypeScript package values minimal test dependencies; Node 22+ ships the test runner plus the coverage, junit and lcov reporters the delivery adapter binds, and tsup emits ESM with declarations for both entries.

## Consequences

- Positive: no test-framework dependency; one MIT build tool (tsup) with declaration output; tests import `src/*.ts` directly through Node type stripping.
- Negative: node:test has no watch UI and no dependency-graph affected selection, so pull requests run the full (small) suite; the unit command names each test file explicitly, so a new test file must be added to `package.json`, `roadmap/roadmap.config.json` and `.github/greenfield-delivery.json`; two tools to keep versioned.
- Generator: the cached create-vite 8.3.0 (`^8`, MIT, tier Allowed anywhere) vanilla-ts template was generated into this repository root and adapted to a library: the demo page and assets and the `vite` devDependency were removed; tsup, @types/node, tsx and zod were added.

## Revisit when

The package needs a second output format, a browser target, or more than 200 tests needing watch mode or richer reporting; or Node type stripping cannot run a needed TypeScript feature.
