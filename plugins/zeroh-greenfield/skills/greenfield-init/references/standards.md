## Proposal and approval
Before writing, present `file | source facts | planned sections` for every target and wait for approval. The approved interview, selected archetype, and `design-gate.md` are the only source facts.

## AGENTS.md
AGENTS.md is the sole conventions home. Fill `## Conventions`, `## Don’t`, and `## Generalize-forward`; require Flag-first delivery and keep release-only work in `hold[]`.

## Harness pointers
CLAUDE.md contains `@AGENTS.md` plus harness-only lines. Other harness files point to AGENTS.md and never copy conventions.

## Generated blocks
Preserve generated blocks byte-for-byte, including everything from `<!-- nx configuration start -->` through `<!-- nx configuration end -->`.

## CODE-STYLE.md
Derive code style from the repository's lint and format configuration; do not invent another standard.

## Architecture index
Index the approved architecture records and link to their canonical homes.

## UX canon
Link the UX canon to its design token home from `references/design-system.md`.
