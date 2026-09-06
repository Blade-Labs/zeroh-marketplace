# ADR 0001: Retain the established technology stack

## Status

Accepted for preservation; no replacement stack is selected.

## Context and evidence

[package.json](../../package.json) and [package-lock.json](../../package-lock.json) own exact dependency versions. [nx.json](../../nx.json) and existing project files own orchestration. Shared and ui use JavaScript ES modules, Vitest tests with JUnit and LCOV, and copy-based build scripts.

## Ruling

Retain npm, Nx, the existing Vitest targets and build scripts. Keep dependency direction explicit through the existing [architecture topics](../architecture.md).

## Consequences and revisit condition

The lockfile remains authoritative. Linting, type checking, integration and end-to-end tooling have no configured runnable gates. Revisit when concrete product requirements require an approved tooling or platform change.
