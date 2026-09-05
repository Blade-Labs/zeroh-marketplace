# Brownfield marker table

Inspect every row. Evidence supports classification but absence never proves a stack.

| Artefact | Evidence glob | Interpretation |
| --- | --- | --- |
| Package managers | `package.json`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `uv.lock`, `pubspec.yaml`, `gradlew` | Present files identify installed package tooling; conflicting locks are partial or stale evidence. |
| Framework files | `next.config.*`, `app.json`, `android/`, `pubspec.yaml`, `vite.config.*` | Framework-owned configuration supports a candidate stack that stack-decision must confirm. |
| Monorepo tools | `nx.json`, `turbo.json`, `pnpm-workspace.yaml`, `lerna.json` | Existing workspace orchestration is preserved and linked. |
| Docs | `README.md`, `docs/**/*.md`, `CONTRIBUTING.md` | Existing fact homes are inventoried before proposing a missing index or canon. |
| Harness files | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/**`, `.codex/**`, `opencode.json` | Apply the harness inventory and generated-block preservation contract. |
| Roadmap config | `roadmap/roadmap.config.json`, `roadmap/phases/`, `docs/roadmap/roadmap.config.json`, `docs/roadmap/phases/`, the explicit `ROADMAP_ROOT` path | Existing roadmap configuration is merged, never reinitialized. |
| Superpowers directory | `.superpowers/`, `docs/superpowers/` | Existing planning artifacts are linked rather than duplicated. |
| Design-system files | `components.json`, `**/components.json`, `tokens/**`, `**/*theme*`, `docs/**/*design*` | Registries and token homes are evidence for design reconciliation, not permission to invent values. |

## Canonical roadmap discovery
Resolve the consumer Git toplevel first. Use `roadmapRoot(consumerRoot)` from the
installed zeroh-roadmap `cli/lib/roadmap-root.mjs`; resolve that module from the
installed plugin, never from an assumed consumer-relative plugin directory.
Pass the consumer root explicitly, retain `ROADMAP_ROOT`, and inspect
`<resolved root>/roadmap.config.json`. Do not infer absence from a top-level glob.
A marked root without a config is partial: STOP for an approved recovery proposal,
not fresh initialization. Ambiguous roots STOP with the resolver's remedy; an
explicit override retains the resolver's precedence. If the module cannot be
resolved, STOP the config branch with the sibling installation remedy rather than
implementing another candidate-order algorithm. An unmarked default destination
is not an existing configuration. Record the resolved path as gap-table evidence.

Use this read-only invocation after resolving the two absolute paths from the
installed plugin inventory and consumer Git toplevel:

```sh
node --input-type=module -e 'import { pathToFileURL } from "node:url"; import { join } from "node:path"; const { roadmapRoot } = await import(pathToFileURL(join(process.argv[1], "cli/lib/roadmap-root.mjs"))); console.log(roadmapRoot(process.argv[2]));' <roadmap-plugin-root> <consumer-root>
```

`<roadmap-plugin-root>` is the installed zeroh-roadmap plugin directory;
`<consumer-root>` is the consumer Git toplevel. A nonzero exit stops this branch.
