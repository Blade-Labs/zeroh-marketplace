# Architecture

This file indexes the authoritative architecture homes. Link each topic to its
owner instead of copying the content.

## Topic index

| Topic | Home |
| --- | --- |
| Product requirements and decisions | docs/PRD.md |
| Stack ruling (tsup + node:test) | docs/adr/0001-tech-stack.md |
| Design-system ruling (none) | docs/adr/0002-design-system.md |
| CLI contract | docs/ux-canon.md |
| Reusable API | src/index.ts |
| CLI adapter | src/cli.ts |
| Build and package surface | tsup.config.ts, package.json (`exports`, `bin`, `files`) |
| Tests | test/greet.test.ts, test/cli.test.ts |
| Code style | docs/CODE-STYLE.md |
| Conventions | AGENTS.md |
| Delivery lifecycle | .github/greenfield-delivery.json, scripts/ci-shard-plan.mjs, .github/workflows/ci.yml, .github/workflows/release.yml |
| Roadmap | roadmap/ROADMAP.md, roadmap/roadmap.config.json (schema: roadmap/roadmap.config.schema.json) |
