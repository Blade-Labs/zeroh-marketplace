# Architecture

## Topic index

| Topic | Home |
| --- | --- |
| Requirements and unknowns | [PRD](PRD.md) |
| Package boundary | [Technology ADR](adr/0001-tech-stack.md) |
| Non-UI ruling | [Design ADR](adr/0002-design-system.md) |
| API and terminal behavior | [UX canon](ux-canon.md) |
| Reusable logic | [src/index.ts](../src/index.ts) |
| Process adapter | [src/cli.ts](../src/cli.ts) |
| Build boundary | [tsup.config.ts](../tsup.config.ts) |
| Delivery execution | [Delivery config](../.github/greenfield-delivery.json) |
| Gates and pointers | [Roadmap config](../roadmap/roadmap.config.json) |

## Extend protocol

Keep reusable logic independent of process I/O. Extend the public contract and behavior tests together. Record approved boundary changes in the owning ADR before introducing another package or service. Consumer tooling resolves local homes without assuming plugin-internal paths.
