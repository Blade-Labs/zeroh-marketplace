---
name: greenfield-init
description: Turn a new project idea into an approved, runnable first prototype with a short PRD and an appropriate foundation.
---

# From idea to first useful behavior

Read the request and existing project guidance first. Reuse supplied answers and approved scope. Inspect any existing files before proposing changes; route an established application to `brownfield-audit`.

Use [the short interview](references/prd-interview.md) only for consequential unknowns. Establish the first user journey, platforms needed now, constraints and non-goals. Keep unresolved product questions visible; resolve tooling prerequisites needed to run the chosen prototype.

Reuse an approved stack. If a real choice remains, use `stack-decision`; then read only the applicable [project recipe](references/archetypes/README.md). Recipes are examples, not universal defaults. Verify current generator/version instructions from the selected tool's official documentation before running them. Do not substitute the recipe's example stack for the user's selection.

Present the concrete small foundation: first behavior, intended files, architecture rationale, test strategy, generator commands and local run command. Adapt [standards](references/standards.md) to the project. A short README may contain the PRD, architecture and test guidance; do not create empty documents to satisfy a template list. Read [design guidance](references/design-system.md) only for a UI decision and [CI guidance](references/ci-release-strategy.md) only when delivery is in scope.

Obtain approval once before consumer writes if the concrete scope is not already authorized. Reuse existing approval; no magic phrase or fixture protocol. Resolve overwrites explicitly, preserve unrelated content and stop only the operation whose scope changed. Do not run generators in the consumer before required approval.

Use native edits, copies and simple commands to build the approved foundation. The [prepared-program helper](references/prepared-program.md) is optional for an exceptional bulk executable program, not required for ordinary edits. It does not grant authorization or replace native controls.

Run the documented local command and observe the promised behavior, then run a meaningful test of that behavior. Verify generated paths and commands against actual output. Missing tools, failed commands and an unavailable target platform are incomplete or unverified, never a pass. A build or file-existence check alone does not establish a runnable user journey. Fix within approved scope; report an external blocker honestly.

Leave concise product intent, architecture rationale, real run/test commands and known limitations. Link their canonical homes using [pointers](references/pointers.md). Report what ran, its outcome and which platforms remain unverified. If requested, hand the next outcome to Roadmap; installation of Roadmap, CI, publishing and deployment are not prerequisites for a local prototype.
