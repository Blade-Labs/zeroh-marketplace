# Architecture

## Topic index

| Topic | Home |
| --- | --- |
| Product scope and unknowns | [PRD](PRD.md) |
| Stack alternatives and ruling | [ADR 0001](adr/0001-tech-stack.md) |
| Non-UI design ruling | [ADR 0002](adr/0002-design-system.md) |
| CLI contract | [UX canon](ux-canon.md) |
| Compiler and style tooling | [Code style](CODE-STYLE.md) |
| Repository conventions | [AGENTS](../AGENTS.md) |

## Boundaries

src/index.ts owns the pure greeting API. src/cli.ts is the executable adapter and owns argument handling and process output. Both compile to dist through tsup.config.ts. Tests consume the built package export and invoke the built CLI. There is no service, persistence, authentication, or framework runtime.

roadmap/lib contains copied consumer tooling with relative imports; application code does not import plugin-internal paths. Roadmap phase planning remains owned by zeroh-roadmap. The empty backlog introduces no phases.
