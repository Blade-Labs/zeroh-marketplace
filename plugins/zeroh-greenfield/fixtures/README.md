# Brownfield fixture oracle

This small repository is structural test data. It contains no source prose from the prior-art repository.

| Artefact | State | Evidence path | Proposed action | Existing home to LINK |
| --- | --- | --- | --- | --- |
| Package managers | present | `zeroh-shaped/package.json`; six existing project roots | none | zeroh-shaped/package.json |
| Framework files | present | `zeroh-shaped/{next.config.*,app.json,pubspec.yaml,vite.config.*}` absent; no framework required by fixture | none | none |
| Monorepo tools | present | `zeroh-shaped/nx.json`; `zeroh-shaped/emitted/repo-catalog.json` | none | zeroh-shaped/nx.json |
| Docs | stale | `zeroh-shaped/README.md` (four README data rows; orphan README row; catalog project omitted from README); `zeroh-shaped/docs/architecture/boundaries.md` (removed-package architecture reference to packages/legacy-widgets) | reconcile only approved catalog and stale-reference gaps | zeroh-shaped/README.md |
| Harness files | partial | `zeroh-shaped/{AGENTS.md,GEMINI.md,CLAUDE.md}`; duplicate harness guidance | reduce approved duplicates to pointers and preserve the Nx block | zeroh-shaped/AGENTS.md |
| Roadmap config | missing | `zeroh-shaped/roadmap.config.json` absent; configuration absent | propose the missing configuration at the resolved root | none |
| Superpowers directory | present | `zeroh-shaped/{.superpowers,docs/superpowers}` absent; optional tool not selected | none | none |
| Design-system files | partial | `zeroh-shaped/{apps/web,packages/ui}/components.json`; components registries absent | ask for a registry decision; do not invent one | both existing components.json files |
| PRD | missing | `zeroh-shaped/docs/PRD.md` absent; gap homes absent; no alternate canonical home | interview for unknown product facts, then propose PRD | none |
| Tech-stack ADR | missing | `zeroh-shaped/docs/adr/0001-tech-stack.md` absent; no alternate canonical home | record evidenced current stack and unresolved decisions; no replacement stack | zeroh-shaped/package.json |
| Design-system ADR | missing | `zeroh-shaped/docs/adr/0002-design-system.md` absent; no alternate canonical home | record existing design decisions and approved gaps | existing components.json files |
| CODE-STYLE | missing | `zeroh-shaped/docs/CODE-STYLE.md` absent; no alternate canonical home | derive conventions from existing lint configuration | zeroh-shaped/eslint.config.mjs |
| Architecture index | missing | `zeroh-shaped/docs/architecture.md` absent; no alternate canonical home | index existing architecture topics without restating them | zeroh-shaped/docs/architecture/ |
| UX canon | missing | `zeroh-shaped/docs/ux-canon.md` absent; no alternate canonical home | index evidenced design homes; ask for missing decisions | existing components.json files |

The absent optional framework/Superpowers rows use `present` to mean the current
not-selected requirement is satisfied; they yield no proposal. Marker presence
and requirement satisfaction are separate facts. Every required document above
has its own approval and verification; a README repair cannot satisfy those rows.
Run a second fixture variant after moving the config/records to `docs/roadmap`:
canonical discovery must retain that root, propose no initialization, and preserve
existing bindings. A dual-marked variant must stop until explicitly resolved.
