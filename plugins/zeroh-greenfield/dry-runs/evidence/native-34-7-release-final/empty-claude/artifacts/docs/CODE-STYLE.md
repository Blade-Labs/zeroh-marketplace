# Code style

## Lint

`none` — no linter is configured and the `lint` gate is declared absent in `roadmap/roadmap.config.json`. Enforced style comes from `tsconfig.json` (`strict`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`), checked by `npm run typecheck`.

## Format

`none` — no formatter is configured; match the existing files (ES modules, two-space indentation, single quotes, no semicolons, explicit `.ts` import extensions) until a formatter is adopted through an approved proposal.
