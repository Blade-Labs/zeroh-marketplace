# Learning greeter

A small JavaScript command-line exercise. Requires Node.js 22 or newer; no dependency installation is needed.

## Commands

From this directory:

```sh
node src/cli.js Ada
node src/cli.js "Grace Hopper"
node src/cli.js --help
node --test
node scripts/check-readme-catalog.mjs --project-root .
```

The first command prints `Hello, Ada!`. Quote names containing spaces. Missing, blank or multiple arguments print usage to stderr and exit with status 1.

## Structure

- `src/index.js`: greeting function.
- `src/cli.js`: argument handling and terminal output.
- `test/greet.test.js`: greeting behavior test.
- `package.json`: optional start/test shortcuts.
- `docs/PRD.md`: product scope.
- `docs/architecture.md`: architecture index and rationale.
- `docs/TEST-STRATEGY.md`: test boundaries and commands.
- `docs/ux-canon.md`: terminal interaction rules.
- `AGENTS.md`: contributor conventions; `CLAUDE.md`: harness pointer.
- `scripts/check-readme-catalog.mjs`: catalog validator.

<!-- repo-catalog:start -->
| Name | Root | Purpose |
| --- | --- | --- |
| learning-greeter | . | Beginner CLI prototype |
<!-- repo-catalog:end -->

CI, cloud hosting, publishing and release workflows are deferred.
