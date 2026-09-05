# Product requirements

## Product

greenfield-proof is a small TypeScript reusable greeting API plus CLI for developers.

## Audience

Developers importing a greeting function and invoking its CLI.

## Platforms

Node22+ Linux. The cached setup generator requires Node 22.12+ within the Node 22 line; the observed host is 22.23.2. Mobile: none.

## Constraints

npm; tsup with TypeScript and node:test; private UNLICENSED fixture, no publishing. No framework runtime or runtime dependency. Development tooling includes TSX and Zod for copied roadmap helpers. All npm cache and logs stay in this scratch repository. No product remote, deployment, or commit is authorized.

## Non-goals

No external service, authentication, mobile application, web UI, deployment, or publishing. The API is an imported function, not a network backend.

## Success signals

The public export greet(name?: string) returns Hello, <name>!, defaults to world, and rejects blank names with TypeError. Nonblank names are preserved verbatim. The CLI contract is owned by [UX canon](ux-canon.md). Meaningful API and CLI tests, typecheck, build, config validation, catalog validation, and roadmap emission must pass.

## Brand

Non-Blade. Component registry: absent/none because this is a text CLI and reusable library. No visual tokens, fonts, palette, spacing system, or UI assets are needed.

## Decisions

| Date | Ruling | Reason |
| --- | --- | --- |
| 2026-09-05 | APPROVE GREENFIELD PLAN received as a separate input after the complete proposal | Authorizes only the proposed scratch artifacts and ordered commands; this record is written only during approved execution |
| 2026-09-05 | library-cli; tsup + node:test; npm | Small reusable TypeScript API and thin CLI with minimal test dependencies |
| 2026-09-05 | Adapt cached create-vite 8.3.0 vanilla-ts output in the existing scratch root | User selected the verified cached public generator; avoid another repository and remove the web demo |
| 2026-09-05 | Non-UI design; registry none | No rendered UI or Blade branding |

The approved operation scope is generation, guarded adaptation of the exact files, source checker copy, one roadmap init/config adaptation, scratch-local dependency installation, and the individually proposed verification commands. The seven gate bindings live in roadmap/roadmap.config.json. Lint is absent because no linter is selected; E2E is absent because there is no separate browser/service runner. CLI process behavior remains tested.

## Unknowns

Future distribution, release cadence, support policy, localization, and any future UI or backend requirements are unknown. Do not infer them. A separate read-only brownfield re-audit remains required after execution; no idempotence claim is made.
