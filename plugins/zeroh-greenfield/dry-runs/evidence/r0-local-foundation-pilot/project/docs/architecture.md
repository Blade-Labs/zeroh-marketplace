# Architecture

`src/cli.js` reads arguments, validates one nonblank name, trims surrounding whitespace and prints the result of `greet` from `src/index.js`. The greeting function has no I/O. This split keeps JavaScript string interpolation easy to learn and test.

Canonical records: [stack rationale](adr/0001-tech-stack.md), [design decision](adr/0002-design-system.md), [test strategy](TEST-STRATEGY.md). Extend by keeping terminal I/O in the adapter and reusable behavior in the function; add another module only when a distinct responsibility emerges.
