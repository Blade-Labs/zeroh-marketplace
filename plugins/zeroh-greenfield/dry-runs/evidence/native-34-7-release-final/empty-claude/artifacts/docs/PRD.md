# Product requirements

## Product

greenfield-proof: a small TypeScript reusable greeting API plus CLI for developers. `greet(name?: string)` returns `Hello, <name>!`, defaults to `world`, and rejects blank names with `TypeError`. The CLI prints the greeting, `--help` exits 0, and unknown options exit 1 with usage (even when `--help` is also present).

## Audience

Developers importing a greeting function and invoking its CLI.

## Platforms

Node 22+ on Linux (library and CLI). Mobile: none. Web: none.

## Constraints

- Package manager npm; build tsup with TypeScript; tests node:test (ADR 0001).
- Private, UNLICENSED fixture: no publishing; registry absent/none (recorded reason: the fixture is never distributed).
- No framework runtime, external service, authentication, mobile target, deployment or product remote.
- Non-Blade; no design system or tokens (ADR 0002).
- Delivery: GitHub Actions with the protected release environment `greenfield-validation`; deployment provider `none` (explicitly unavailable; never deploy or publish).
- Unknowns preserved: no version or release cadence decided; no performance or size targets; no success metric beyond passing gates.

## Non-goals

Web or mobile UI, HTTP or network API, authentication, external services, publishing to a registry, deployment.

## Success signals

The first release exports a typed greeting and CLI with passing tests: build, typecheck, unit, integration (built CLI `--help`) and emit gates green from the consumer root; README catalog check and `roadmap config check` exit 0. Further signals: don't know yet.

## Brand

Non-Blade. No branding, theme or tokens; the only surface is CLI text.

## Decisions

| Date | Ruling | Reason |
| --- | --- | --- |
| 2026-09-05 | Stack: tsup + node:test (Library/CLI matrix; docs/adr/0001-tech-stack.md) | Small TypeScript package values minimal test dependencies; Node 22+ ships the runner and the coverage, junit and lcov reporters the delivery adapter binds |
| 2026-09-05 | Design system: none (docs/adr/0002-design-system.md) | No graphical surface; the CLI contract lives in docs/ux-canon.md and no tokens are invented |
| 2026-09-05 | Archetype library-cli via the cached create-vite 8.3.0 vanilla-ts generator, generated into this repository root and adapted to a library (demo page, assets and the `vite` devDependency removed) | Manifest generator; the generated demo page is not part of the product |
| 2026-09-05 | Registry: absent (none) | Private UNLICENSED fixture is never distributed |
| 2026-09-05 | Delivery: GitHub Actions, adapter library-cli, protected environment greenfield-validation, release.provider none, collision decision create (no prior workflows existed) | Only supported provider; deployment explicitly unavailable |
| 2026-09-05 | Delivery baseline bootstrap: minTests 13, minUnits 2, coverageFloor 80, with `baselineApproval` bootstrap true, baseSha null, previous null, previousDigest 74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b, approvedDigest 5374467fe217b0eb0e7b810b86c55112c592bca63fce55a1d6f02d0905af47e7, owner fixture-owner | No prior delivery config exists in Git; the first main push proves the absent base, so the initial floor needs an explicit bootstrap approval presented with this plan |
| 2026-09-05 | Gates: lint none, types `npm run typecheck`, unit `node --test test/greet.test.ts test/cli.test.ts`, integration `node dist/cli.js --help`, build `npm run build`, e2e none, emit `env TSX_DISABLE_CACHE=1 node --import tsx roadmap/lib/emit.ts` | Bound to the installed tooling with the test files named explicitly; lint and e2e have no tooling yet, so absence is declared, not passed |
| 2026-09-05 | Roadmap config `$schema` points at the consumer-local copy roadmap/roadmap.config.schema.json (digest-guarded copy of the installed plugin schema) | Consumer files must not reference plugin-internal paths |
| 2026-09-05 | Approval: the complete Artifact/Target/Reason proposal was followed by the separate exact response `APPROVE GREENFIELD PLAN`; only the proposed rows were executed | greenfield-init approval gate |
