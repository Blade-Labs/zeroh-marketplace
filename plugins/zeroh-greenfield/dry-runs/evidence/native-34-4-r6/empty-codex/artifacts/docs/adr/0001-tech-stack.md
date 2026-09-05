# ADR 0001: Tech stack

## Context

A small private TypeScript greeting library and CLI for developers on Node22+ Linux. npm and tsup with node:test were explicitly selected. No network backend, web application, mobile application, or monorepo is required.

## Options: Library/CLI

Source: installed zeroh-greenfield skills/stack-decision/references/matrices.md, Library/CLI matrix. Rows preserved verbatim:

| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| tsup + node:test | Compact bundling with built-in tests | Two separate tools | Small TypeScript package values minimal test dependencies | Exported modules and fixtures | tsup |
| tsdown + vitest | Modern bundling and rich tests | Additional test dependency | Vite-aligned libraries need fast test ergonomics | Exported modules and test helpers | tsdown |
| unbuild | Convention-led library output | Less explicit build control | Multi-format package follows unjs conventions | Package presets and modules | unbuild |

## Ruling: 2026-09-05

Selected: tsup + node:test. Reason: the user selected a small TypeScript reusable greeting API plus CLI with minimal test dependencies. Use npm, ESM, strict TypeScript, tsup declarations, and built-in node:test.

The installed library-cli archetype selects create-vite ^8 vanilla-ts as the generator. Use the user-verified cached create-vite 8.3.0 and adapt its my-lib destination to this existing scratch root. Remove the generated web demo and Vite dependency. Vite/create-vite and tsup are MIT, Allowed anywhere; TypeScript is Apache-2.0; Node typings, TSX, and Zod are MIT development tooling. No framework runtime is retained.

## Consequences

API and CLI stay separate source entry points. Tests run against built public exports and CLI processes, so build precedes node:test. TSX and Zod support the copied roadmap emitter as development dependencies. npm writes a lockfile; npm state stays under .npm-cache and .npm-logs. The package remains private and UNLICENSED with no publishing.

## Revisit conditions

Revisit if a second output format is required, a browser or network backend becomes a committed requirement, or tests require capabilities unavailable in node:test. Future distribution and release policy remain unknown. Non-Blade and registry-none reasons are recorded in [ADR 0002](0002-design-system.md).
