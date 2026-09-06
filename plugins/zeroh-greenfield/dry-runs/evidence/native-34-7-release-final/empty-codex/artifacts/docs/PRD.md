# Product requirements

## Product

greenfield-proof is a small TypeScript reusable greeting API plus CLI for developers. [UX canon](ux-canon.md) specifies its behavior.

## Audience

Developers importing a typed greeting function and invoking its CLI.

## Platforms

Node 22+ on Linux; use Node 22.12 or later on that runtime line for the selected generator.

## Constraints

Use npm, TypeScript, tsup and node:test. Private UNLICENSED fixture, no publishing or fixture commits. Adapt cached create-vite 8.3.0 vanilla-ts directly in this scratch repository. Preserve any present home byte-identically; stop if unexpected homes appear.

## Non-goals

No framework runtime, external service, HTTP backend, authentication, mobile, deployment, product remote or publishing. The reusable API is an imported function, not a network service.

## Success signals

Pass meaningful API and CLI tests, typecheck, build, built CLI smoke, the selected catalog comparison, roadmap config check, actual emission and the complete installed delivery suite. Simulations do not prove a hosted CI run or deployment. Execution ends before a separate read-only brownfield re-audit.

## Brand

Non-Blade; no graphical UI. Registry absent/none because there are no UI components. Do not invent tokens, fonts or palette.

## Decisions

| Date | Ruling | Reason |
| --- | --- | --- |
| 2026-09-05 | Separate exact APPROVE GREENFIELD PLAN input authorizes the preceding complete plan | This document is created only after that input; the candidate was not approval. |
| 2026-09-05 | [Technology stack](adr/0001-tech-stack.md) | Explicit user selection of the library-cli archetype and minimal test dependencies. |
| 2026-09-05 | [Non-UI design](adr/0002-design-system.md) | Imported API and terminal CLI only. |
| 2026-09-05 | GitHub Actions; protected release environment greenfield-validation; deployment provider none | Supplied choices; deployment is unavailable and unauthorized. |
| 2026-09-05 | Bootstrap the delivery baseline at 10 tests, 2 units and 80 percent line coverage | Initial delivery baseline presented for approval with fixture setup; owner fixture-owner. The exact baselineApproval is in .github/greenfield-delivery.json. |

## Unknowns

Distribution, graphical surfaces, HTTP services, credentials and release date remain unselected. The initial fixture has no commits and an unborn master branch. Delivery assumes the supplied future first root/new-main push with no previous baseline; this setup does not create history or run CI. Live GitHub evidence is unavailable. Revisit through an approved scope change.
