# Brownfield marker table

Inspect every row. Evidence supports classification but absence never proves a stack.

| Artefact | Evidence glob | Interpretation |
| --- | --- | --- |
| Package managers | `package.json`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `uv.lock`, `pubspec.yaml`, `gradlew` | Present files identify installed package tooling; conflicting locks are partial or stale evidence. |
| Framework files | `next.config.*`, `app.json`, `android/`, `pubspec.yaml`, `vite.config.*` | Framework-owned configuration supports a candidate stack that stack-decision must confirm. |
| Monorepo tools | `nx.json`, `turbo.json`, `pnpm-workspace.yaml`, `lerna.json` | Existing workspace orchestration is preserved and linked. |
| Docs | `README.md`, `docs/**/*.md`, `CONTRIBUTING.md` | Existing fact homes are inventoried before proposing a missing index or canon. |
| Harness files | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/**`, `.codex/**`, `opencode.json` | Apply the harness inventory and generated-block preservation contract. |
| Roadmap config | `roadmap.config.json`, `roadmap.config.*`, `roadmap/` | Existing roadmap configuration is merged, never reinitialized. |
| Superpowers directory | `.superpowers/`, `docs/superpowers/` | Existing planning artifacts are linked rather than duplicated. |
| Design-system files | `components.json`, `**/components.json`, `tokens/**`, `**/*theme*`, `docs/**/*design*` | Registries and token homes are evidence for design reconciliation, not permission to invent values. |
