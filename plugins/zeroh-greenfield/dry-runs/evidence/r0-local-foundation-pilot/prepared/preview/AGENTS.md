# Contributor guide

## Conventions
Use plain JavaScript ES modules. Keep terminal I/O in `src/cli.js` and reusable greeting behavior in `src/index.js`. Follow [the test strategy](docs/TEST-STRATEGY.md). Use [the architecture index](docs/architecture.md) for rationale. Future development uses the Roadmap phase system after foundation initialization.

## Don’t
Do not add frameworks, dependencies, UI, cloud or CI/release workflows without a new requirement. Never replace an existing home silently.

## Generalize-forward
Extract a module when a new responsibility exists. Keep the beginner's runnable path simple. Flag-first delivery applies if delivery is later selected; keep release-only work in `hold[]` until then.
