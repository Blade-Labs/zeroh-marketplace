## Generator
```sh
npx create-expo-app@^4 my-app --yes
```

Source: https://docs.expo.dev/get-started/create-a-project/. The generator
targets SDK 57 and is BSD-3-Clause, tier `Allowed anywhere`.

## Post-steps
From `my-app`, run `npx @react-native-reusables/cli@^0.7 init`, sourced from
https://github.com/mrzachnugent/react-native-reusables. The CLI is MIT and
`Allowed anywhere`. Apply only the mobile projection from
`references/design-system.md`. Move the generated `src/app` directory to `app`
so the project matches the contract below.

## File tree
```text
my-app/
my-app/package.json
my-app/app.json
my-app/app/
my-app/assets/
```

## Conventions delta
Keep routes in `my-app/app/` and platform integrations behind typed modules.

## testConventions
Use `npm test` for units and `npx expo export` as the bundle smoke check.

## designHomes
Set `designHomes.architecture.home` to `docs/architecture.md` and
`designHomes.ux.canon` to `docs/ux-canon.md`.

## Verify
```sh
test -f my-app/package.json && test -f my-app/app.json && test -d my-app/app && (cd my-app && node scripts/check-readme-catalog.mjs --project-root .)
```

## CI and release adapter

Select `expo` in `.github/greenfield-delivery.json` and follow
[the shared CI/release strategy](../ci-release-strategy.md) for its exact inventory,
executor, raw report, coverage merge and build contract. Bind runner/build argv
into the shard manifest before execution; require exact-once leaf/file selection.
Generate `scripts/ci-shard-plan.mjs`, `.github/workflows/ci.yml` and
`.github/workflows/release.yml` only from the approved preservation plan.
Missing tooling/reporters are unavailable with the adapter install remedy.
Affected PR checks backstop into authoritative full shards on main/manual runs;
release promotes the same verified artifact bytes without rebuilding.
