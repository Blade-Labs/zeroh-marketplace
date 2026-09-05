## Generator
```sh
npx create-vite@^8 my-lib --template vanilla-ts
```

Source: https://vite.dev/guide/. Vite is MIT, tier `Allowed anywhere`.

## Post-steps
Install `tsup: ^8.5` and `@types/node`, and include `node` in the TypeScript
`types` list. tsup is sourced from https://tsup.egoist.dev/; it is MIT and
`Allowed anywhere`. Set package.json `exports` to `./dist/index.js`, `bin` to
`./dist/cli.js`, and `files` to `dist`. Configure `tsup.config.ts` with
`entry: ['src/index.ts', 'src/cli.ts']`, `format: ['esm']`, and `dts: true`.
Set the package.json `build` script to `tsup`.
Give the CLI a Node shebang and a stable `--help` path. Add at least one
`node:test` file for the public API, then run the tsup build before Verify.

## File tree
```text
my-lib/
my-lib/package.json
my-lib/src/index.ts
my-lib/src/cli.ts
my-lib/tsup.config.ts
```

## Conventions delta
Keep the reusable API in `src/index.ts` and the thin executable adapter in
`src/cli.ts`; publish only built artifacts through `exports`, `bin`, and `files`.

## testConventions
Use `node --test` for behavior and `node dist/cli.js --help` as the built CLI
smoke check. Test runner source: https://nodejs.org/api/test.html.

## designHomes
Set `designHomes.architecture.home` to `docs/architecture.md` and
`designHomes.ux.canon` to `docs/ux-canon.md`.

## Verify
```sh
test -f my-lib/package.json && test -f my-lib/src/index.ts && test -f my-lib/src/cli.ts && test -f my-lib/tsup.config.ts && (cd my-lib && npm run build && node --test && node dist/cli.js --help && node scripts/check-readme-catalog.mjs --project-root .)
```

## CI and release adapter

Select `library-cli` in `.github/greenfield-delivery.json` and follow
[the shared CI/release strategy](../ci-release-strategy.md) for its exact inventory,
executor, raw report, coverage merge and build contract. Bind runner/build argv
into the shard manifest before execution; require exact-once leaf/file selection.
Generate `scripts/ci-shard-plan.mjs`, `.github/workflows/ci.yml` and
`.github/workflows/release.yml` only from the approved preservation plan.
Missing tooling/reporters are unavailable with the adapter install remedy.
Affected PR checks backstop into authoritative full shards on main/manual runs;
release promotes the same verified artifact bytes without rebuilding.
