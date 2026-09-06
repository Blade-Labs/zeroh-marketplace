# Test strategy

Use Node's built-in test runner and strict assertions, with tests in `test/*.test.js`. Run `node --test`. The single test checks supplied-name substitution, spaces and Unicode. A red test means greeting behavior has changed; a hard-coded greeting fails the distinct-name cases. No mocks or fixture files are needed.

The pure function is the unit boundary. Run `node src/cli.js --help` separately for CLI wiring, and `node src/cli.js Ada` for the documented success signal. These smoke commands do not claim full CLI branch coverage.

Lint, static types, compilation, browser E2E and phase emission are absent because the local JavaScript prototype needs none of those toolchains. Validate the README catalog with its supplied checker. Configuration validation belongs to the Roadmap CLI after its generated config is inspected and bound.
