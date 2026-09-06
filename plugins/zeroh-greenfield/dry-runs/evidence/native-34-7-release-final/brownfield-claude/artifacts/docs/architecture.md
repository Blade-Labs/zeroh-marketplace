# Architecture

This file indexes the authoritative architecture homes. Link each topic to its
owner instead of copying the content.

## Topic index

| Topic | Home |
| --- | --- |
| Boundaries | docs/architecture/boundaries.md |
| Workflow | docs/architecture/workflow.md |
| Project catalog | emitted/repo-catalog.json |
| Nx workspace and project targets | nx.json, apps/*/project.json, packages/*/project.json |
| Delivery lifecycle (CI and release) | .github/greenfield-delivery.json, .github/workflows/ci.yml, .github/workflows/release.yml |
| Delivery planner | scripts/ci-shard-plan.mjs |
| Roadmap gate bindings | roadmap/roadmap.config.json |
| Technology stack | docs/adr/0001-tech-stack.md |
| Design system | docs/adr/0002-design-system.md |

`docs/architecture/boundaries.md` still names `packages/legacy-widgets`, which has no catalog entry or directory. That statement is preserved as the owner's record and is not corrected here.
