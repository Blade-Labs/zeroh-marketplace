# ADR 0001: Technology stack

## Status

Accepted

## Date

2026-09-05

## Context

greenfield-proof is a small TypeScript reusable greeting API plus a CLI for developers, managed with npm, targeting Node 22+ on Linux, private and UNLICENSED with no publishing. It needs a bundler for `dist/` exports and a `bin`, a type check, and a test runner with minimal dependencies. No framework runtime, external service, authentication, mobile target, deployment, or product remote applies. The greeting API is an in-process library export, not a network API, so the Backend matrix was not presented.

## Options

### Library/CLI
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| tsup + node:test | Compact bundling with built-in tests | Two separate tools | Small TypeScript package values minimal test dependencies | Exported modules and fixtures | tsup |
| tsdown + vitest | Modern bundling and rich tests | Additional test dependency | Vite-aligned libraries need fast test ergonomics | Exported modules and test helpers | tsdown |
| unbuild | Convention-led library output | Less explicit build control | Multi-format package follows unjs conventions | Package presets and modules | unbuild |

## Ruling

2026-09-05: tsup + node:test — selected for a small TypeScript package that values minimal test dependencies; tsup (https://tsup.egoist.dev/, MIT, Allowed anywhere) builds `src/index.ts` and `src/cli.ts` to ESM with declarations, and node:test (https://nodejs.org/api/test.html) runs behaviour tests without a test dependency.

Generator: the library-cli archetype's create-vite (https://vite.dev/guide/, MIT, Allowed anywhere), version 8.3.0 from the local npx cache and byte-verified against the published archive, template `vanilla-ts`, run into the repository root. Its web demo files were removed and `vite` was dropped from devDependencies because the package has no browser surface.

## Consequences

- Positive: one build tool, no test framework dependency, ESM-only output published through `exports`, `bin`, and `files`.
- Positive: source and tests run unbuilt under Node 22 type stripping, so `node --test` does not depend on `dist/`.
- Negative: no linter or formatter is installed; style is enforced only by the strict compiler flags recorded in `docs/CODE-STYLE.md`.
- Negative: `tsx` and `zod` are development dependencies solely for the roadmap emit tooling.

## Revisit when

A second output format, a browser target, or a test need beyond node:test assertions appears, or the package is scheduled for publishing.
