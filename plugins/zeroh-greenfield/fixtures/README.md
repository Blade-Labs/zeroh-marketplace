# Brownfield fixture oracle

This small repository is structural test data. It contains no source prose from the prior-art repository.

| Artefact | State | Evidence path | Proposed action | Existing home to LINK |
| --- | --- | --- | --- | --- |
| Package managers | present | `zeroh-shaped/package.json`; six existing project roots | none | zeroh-shaped/package.json |
| Framework files | missing | `zeroh-shaped/{next.config.*,app.json,pubspec.yaml,vite.config.*}` absent | propose only after stack-decision | none |
| Monorepo tools | present | `zeroh-shaped/nx.json`; `zeroh-shaped/emitted/repo-catalog.json` | none | zeroh-shaped/nx.json |
| Docs | stale | `zeroh-shaped/README.md` (four README data rows; orphan README row; catalog project omitted from README); `zeroh-shaped/docs/architecture/boundaries.md` (removed-package architecture reference to packages/legacy-widgets) | reconcile only approved catalog and stale-reference gaps | zeroh-shaped/README.md |
| Harness files | partial | `zeroh-shaped/{AGENTS.md,GEMINI.md,CLAUDE.md}`; duplicate harness guidance | reduce approved duplicates to pointers and preserve the Nx block | zeroh-shaped/AGENTS.md |
| Roadmap config | missing | `zeroh-shaped/roadmap.config.json` absent; gap homes absent | propose the missing configuration | none |
| Superpowers directory | missing | `zeroh-shaped/{.superpowers,docs/superpowers}` absent | propose only if approved | none |
| Design-system files | partial | `zeroh-shaped/{apps/web,packages/ui}/components.json`; components registries absent | ask for a registry decision; do not invent one | both existing components.json files |
