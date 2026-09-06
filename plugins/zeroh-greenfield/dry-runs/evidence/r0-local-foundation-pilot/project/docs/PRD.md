# Product requirements

## Product
Create a small command-line greeter that takes a name and prints a greeting.

## Audience
A beginner learning JavaScript.

## Platforms
Local command line with Node.js.

## Constraints
Keep the foundation small, runnable and understandable.

## Non-goals
UI, cloud hosting, CI and release workflows.

## Success signals
The documented command in [README](../README.md) runs the prototype; one meaningful automated test passes.

## Brand
No UI or Blade branding.

## Decisions
The product packet supplies the scope. Stack rationale is in [the stack record](adr/0001-tech-stack.md).

### Foundation approval
The fixture owner responded:

> APPROVE GREENFIELD PLAN
>
> Fixture-owner ruling: approve the plain-JavaScript adaptation and exactly the listed foundation scope.

Approved scope: package.json, src/index.js, src/cli.js, test/greet.test.js, README.md, docs/PRD.md, docs/adr/0001-tech-stack.md, docs/adr/0002-design-system.md, docs/architecture.md, docs/ux-canon.md, docs/TEST-STRATEGY.md, AGENTS.md, CLAUDE.md, scripts/check-readme-catalog.mjs and roadmap/roadmap.config.json.

The ruling authorizes config-only initialization, the reviewed foundation writer, the checker copy and prototype/test/help/catalog checks. The dependent config merge and this approval-record update require separate review before execution. Config validation follows application of the reviewed bindings. This record does not grant that dependent execution approval.

CI/release setup and cloud delivery remain deferred. No plugin-source edits, commits, deployments, subagents or other external product writes are authorized.
