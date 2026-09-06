# ADR 0001: Technology stack

## Status and date

Accepted after separate greenfield plan approval; 2026-09-05.

## Context

See [PRD](../PRD.md). The API is an imported function, so the backend, web, mobile and monorepo matrices do not apply.

## Options: Library/CLI

Source: installed zeroh-greenfield skills/stack-decision/references/matrices.md. Exact applicable rows:

| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| tsup + node:test | Compact bundling with built-in tests | Two separate tools | Small TypeScript package values minimal test dependencies | Exported modules and fixtures | tsup |
| tsdown + vitest | Modern bundling and rich tests | Additional test dependency | Vite-aligned libraries need fast test ergonomics | Exported modules and test helpers | tsdown |
| unbuild | Convention-led library output | Less explicit build control | Multi-format package follows unjs conventions | Package presets and modules | unbuild |

## Ruling

2026-09-05: tsup + node:test, explicitly selected for this small TypeScript greeting API and CLI with minimal test dependencies. Use npm and Node 22+ Linux. Adapt the library-cli manifest's my-lib destination to this scratch root using the approved cached create-vite entry. Remove the browser demo and Vite dependency.

## Consequences

Keep reusable logic in src/index.ts and process I/O in src/cli.ts. tsup and node:test are separate tools. tsx loads TypeScript tests and copied roadmap tooling with transform caching disabled. Pin direct versions and retain the npm lock. No framework runtime; private UNLICENSED fixture.

## Revisit when

A second package requires workspace coordination, a supported runtime cannot consume ESM, or an approved requirement adds a web, mobile or HTTP surface. Distribution and service requirements remain unknown.
