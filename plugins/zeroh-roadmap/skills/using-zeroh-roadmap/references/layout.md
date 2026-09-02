# Layout — where a consumer's roadmap lives

The router (`SKILL.md`) carries the operative rule: the root is DISCOVERED, so never state a
roadmap path as a fact. This file is the mechanics, for scaffolding a consumer, writing a phase
file's import, or diagnosing a refusal.

## The root

Two candidates, in precedence order: `roadmap/` at the git toplevel (what every existing consumer
has) and `docs/roadmap/` (for a repo that keeps its workflows as sibling doc folders).

- A candidate is the root when it carries a MARKER: `roadmap.config.json` or `phases/`. An
  existing but unmarked directory is not one — a repo with a prose `docs/roadmap/` folder keeps
  reading its real `roadmap/`.
- `ROADMAP_ROOT` overrides both, absolute or relative to the repo, and is NOT probed for
  existence — an override names where the root WILL be, so `roadmap init` can scaffold into it.
- BOTH marked is a REFUSAL that names both paths and the `ROADMAP_ROOT` remedy, never a silent
  pick: two roots means two backlogs, two claim registries and two gate directories, and guessing
  one is how half a consumer's records go quietly unread.
- Neither marked resolves to `roadmap/`, so a fresh or non-consumer tree answers what it always did.

One resolver owns this — `cli/lib/roadmap-root.mjs` (`roadmapRoot`, `roadmapRootRel`,
`consumerSchemaPath`), with a shell twin at `hooks/lib/roadmap-root.sh` for the hooks. A scan
tripwire in `cli/lib/roadmap-root.test.mjs` keeps every other source out of the business of
spelling the root.

## Records and the schema seam

`backlog.ts`, `ROADMAP.md`, `phases/`, `arcs/`, `archive/`, `.gate/` and `arc-evals/` all sit
under the root. The schema seam resolves root-first: `<root>/lib/schema.ts`, else the legacy
`<toplevel>/lib/roadmap/schema.ts` that existing consumers vendored. Both stay supported; a
missing seam is named with BOTH paths.

A phase file at `<root>/phases/` therefore imports `../lib/schema`, an arc file at `<root>/arcs/`
the same, and `<root>/backlog.ts` imports `./lib/schema`. Relative, so a consumer needs no
tsconfig `paths` alias.

## Scaffolding

`roadmap init [--root <dir>]` — `--root` is forwarded to `scripts/scaffold-roadmap.sh` and
defaults to `roadmap`. The scaffold refuses, naming both, rather than create a second root beside
an existing one. `--root` is deliberately NOT a config key: the config lives inside the root it
would have to name.
