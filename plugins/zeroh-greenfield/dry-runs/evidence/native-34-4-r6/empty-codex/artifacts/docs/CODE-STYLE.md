# Code style

## Lint

None: no lint configuration or linter is selected. This is an explicit absent gate, not a passing lint result.

## Format

None: no formatter configuration is installed. Do not claim automated formatting enforcement.

## Compiler enforcement

[tsconfig.json](../tsconfig.json) is authoritative for strict typing, unused locals and parameters, switch fallthrough checks, and Node types. Run npm run typecheck. Repository conventions live only in [AGENTS.md](../AGENTS.md).
