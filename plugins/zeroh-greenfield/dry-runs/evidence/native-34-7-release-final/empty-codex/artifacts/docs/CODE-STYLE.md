# Code style

## Lint

None: no lint configuration or runner is selected. This is an approved absence, not a passing result.

## Format

None: no formatter is configured. Follow nearby TypeScript formatting and the sole conventions home, [AGENTS.md](../AGENTS.md).

## Types and tests

[tsconfig.json](../tsconfig.json) enables strict checking. Tests use node:test and node:assert/strict, with real CLI subprocesses. [README](../README.md) owns runnable commands.
