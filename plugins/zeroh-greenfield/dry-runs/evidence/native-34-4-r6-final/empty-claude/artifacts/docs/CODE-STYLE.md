# Code style

## Lint

`none` (no linter is installed or configured; the archetype generator adds none and none was proposed)

## Format

`none` (no formatter is installed or configured; source follows the generated style: two-space indentation, single quotes, no semicolons, trailing commas in multi-line literals)

## Compiler-enforced rules

`tsconfig.json` is the only enforced style source: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, and explicit `.ts` import extensions so Node runs source unbuilt. The types gate is `npm run typecheck`.
