# Shell analysis

This package owns shell tokenization, program and destination analysis, settings protection, late binding, and exit-status wrapping. Its target contract allows Node built-ins and `zeroh-disclosure-core`; imports from `hooks/`, `commands/`, `bin/`, or `mcp/` are forbidden. The current settings-path import from `lib/` and shell-analysis-to-local-proxy import are measured transitional debt in `lint-budget.json`, preserved by this pure move, tracked for reduction in phase 46, and removed during the 1.2 host extraction; neither direction may gain new imports.
