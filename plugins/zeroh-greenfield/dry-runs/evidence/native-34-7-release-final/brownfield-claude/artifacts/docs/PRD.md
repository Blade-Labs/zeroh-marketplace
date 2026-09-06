# Product requirements

## Product

Established Nx workspace `zeroh-shaped-fixture` (private, npm, ESM). Applications `web`, `api` and `admin` live under `apps/`; libraries `shared`, `ui` and `generators` live under `packages/`. `shared` and `ui` each export a `label` function covered by one Vitest test and built into `dist/`.

## Audience

Unknown: the repository records no audience. Retained as an explicit unknown; do not infer one.

## Platforms

Node.js 22 workspace tooling: Nx 23.2.0, Vitest 5.0.0 and @vitest/coverage-v8 5.0.0 under npm. Runtime platforms of `web`, `api` and `admin` are not recorded and are retained as unknown. Mobile: none.

## Constraints

- Package identity, `package-lock.json`, Nx project evidence, `AGENTS.md` conventions, the Nx generated block in `CLAUDE.md` and `emitted/repo-catalog.json` are preserved byte-identically.
- Existing architecture homes under `docs/architecture/` are linked from `docs/architecture.md`, never replaced.
- No deployment provider is available: `release.provider` is `none`, so promotion is explicitly unavailable.
- No product remotes, registries, Blade branding or mobile targets are recorded.

## Non-goals

- Replacing existing runtime scaffolding or selecting a new stack.
- Publishing or deploying artifacts.
- Binding lint, type-check, integration or end-to-end gates before their tooling is installed and locked.

## Success signals

- `env NX_DAEMON=false npm test` and `env NX_DAEMON=false npm run build` exit 0 from the workspace root.
- `node scripts/check-readme-catalog.mjs --catalog emitted/repo-catalog.json` exits 0.
- `roadmap config check` exits 0 against `roadmap/roadmap.config.json`.
- The installed delivery outputs pass the plugin-owned `greenfield-ci-release.test.mjs` suite.

## Brand

Non-Blade. No brand tokens or theme home are recorded; retained as unknown.

## Decisions

| Date | Ruling | Reason |
| --- | --- | --- |
| 2026-09-05 | Brownfield gap plan approved with the exact response `APPROVE GREENFIELD PLAN`; only proposed gap rows were written and existing homes stayed byte-identical. | The brownfield-audit workflow requires explicit approval of the complete Artifact / Target / Reason proposal before any write. |
| 2026-09-05 | Gates: unit `env NX_DAEMON=false npm test`, build `env NX_DAEMON=false npm run build`; lint, types, integration, e2e and emit declared `none`; optional Nx slots unit-scoped, unit-affected and unit-impacted bound to `scripts/run-nx-test-tier.mjs`. | Only Nx, Vitest and coverage-v8 are locked; ESLint, TypeScript, integration, Playwright and roadmap emit tooling are absent and absence is declared, not faked. |
| 2026-09-05 | Delivery: GitHub Actions, adapter `nx-monorepo`, protected release environment `greenfield-validation`, provider `none`; existing `.github/workflows/ci.yml` merged with its `existing-check` job, comment line and `env` policy preserved. | The CI/release strategy owner requires an explicit reviewed merge for workflow collisions and forbids inventing a deployment. |
| 2026-09-05 | Initial delivery baseline minTests 2, minUnits 2, coverageFloor 100 bootstrapped in `.github/greenfield-delivery.json` with `baselineApproval` bound to base `5978aece5090694125b255ee7772be83ef1d61d4`, previous `null` and owner `fixture-owner`. | No prior delivery config exists at the pre-init HEAD, so first adoption needs an explicit bootstrap approval; the planner derives the previous baseline from Git and never accepts a caller-supplied history. |
