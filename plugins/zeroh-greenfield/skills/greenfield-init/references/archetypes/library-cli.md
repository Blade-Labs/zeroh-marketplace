# Library / CLI

Define the smallest public API or command, supported runtime, inputs/outputs and packaging boundary.

## Prerequisites and creation

The approved language/runtime and its ordinary package/test tools.

Create a minimal package directly or use the selected tool generator; Node/TypeScript is an example, not a requirement.

## Minimal shape and rationale

src/ with exported API or CLI entry, test/ with an input/output behavior, package metadata and README example.

Keep CLI argument/I/O handling separate from reusable behavior when useful.

## Run and test

Run the documented example and one meaningful success/failure test. Test distributable output if packaging is in scope; do not publish without authorization.

Record concrete commands after inspecting generated output. This recipe is guidance, not an observed platform acceptance result. Missing tooling or an unrun target remains unverified. Canonical architecture and test homes can be README sections.

Sources to check when selecting tooling: https://nodejs.org/api/test.html · https://docs.npmjs.com/cli/configuring-npm/package-json
