# Product requirements

## Product

greenfield-proof: a small TypeScript reusable greeting API plus a CLI for developers. `greet(name?: string)` returns `Hello, <name>!`, defaults to `world`, and rejects blank names with a `TypeError`. The CLI prints the greeting, `--help` exits 0, and an unknown option exits 1 with usage even when a help option is also present.

## Audience

Developers importing a greeting function and invoking its CLI.

## Platforms

Node 22+ on Linux. Mobile: none. No browser surface.

## Constraints

- npm is the package manager; the stack is tsup with TypeScript and node:test (ADR 0001).
- Private, UNLICENSED fixture; no publishing.
- No framework runtime, external service, authentication, mobile target, deployment, or product remote.
- Non-Blade; design registry absent (ADR 0002).
- Generated with the cached public create-vite 8.3.0 `vanilla-ts` generator and adapted to the library-cli archetype.

## Non-goals

- Publishing to a registry.
- A UI, theme, or design tokens.
- Any network, service, or authentication behaviour.

## Success signals

The first release exports a typed greeting and CLI with passing tests: build, type check, unit tests, and the built CLI smoke check all exit 0. Adoption or usage measures: Don't know yet.

## Brand

Non-Blade. No brand values exist and none are invented.

## Decisions

| Date | Ruling | Reason |
| --- | --- | --- |
| 2026-09-05 | Stack: tsup + node:test from the Library/CLI matrix | Small TypeScript package that values minimal test dependencies; see ADR 0001 |
| 2026-09-05 | Design system: none; registry absent | Library plus CLI with no UI surface; see ADR 0002 |
| 2026-09-05 | `APPROVE GREENFIELD PLAN` accepted for the greenfield-init proposal: create-vite generation, library-cli adaptation, six documentation homes, harness adapters, README catalog, roadmap init with bound gates, and the copied catalog checker | The complete Artifact/Target/Reason proposal was reviewed before any consumer write |

## Unknowns

- Adoption and usage measures beyond passing gates: Don't know yet.
- Lint and format tooling: none selected; the compiler flags in `docs/CODE-STYLE.md` are the only enforced style.
- End-to-end gate: none; there is no external surface to drive.
