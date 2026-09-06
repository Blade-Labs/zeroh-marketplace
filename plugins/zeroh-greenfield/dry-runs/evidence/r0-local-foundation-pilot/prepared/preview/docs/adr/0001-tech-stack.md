# JavaScript CLI stack

## Rationale
Plain JavaScript ES modules on Node.js match the user's learning language. The built-in test runner avoids dependency installation, compilation and bundling.

## Alternatives considered
The installed Library/CLI matrix lists tsup + node:test (compact bundling, two tools), tsdown + vitest (rich tests, extra dependency), and unbuild (convention-led multi-format output, less explicit control). These package-distribution stacks add concepts outside this beginner prototype. This proposal adapts the library-cli archetype to the user's small JavaScript-only brief, omitting its Vite TypeScript generator.

## Consequences
Run source directly; there is no compilation or type-check gate. Keep the reusable function separate from terminal I/O. Revisit bundling when distribution requires built artifacts, and TypeScript when static contracts become a product requirement.

Sources: [Node test runner](https://nodejs.org/docs/latest-v22.x/api/test.html), [Node modules](https://nodejs.org/docs/latest-v22.x/api/esm.html). This is a proposed ruling pending foundation approval.
