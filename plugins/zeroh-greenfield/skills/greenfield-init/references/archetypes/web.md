## Generator
```sh
npx create-next-app@^16 my-app --typescript --tailwind --eslint --app --src-dir --import-alias '@/*' --use-npm --yes
```

Sources: https://nextjs.org/docs/app/api-reference/cli/create-next-app,
https://ui.shadcn.com/docs/installation/next, and
https://tailwindcss.com/docs/installation/framework-guides/nextjs. The generator,
shadcn/ui, Tailwind v4, and selected Magic UI registry are MIT, tier
`Allowed anywhere`.

## Post-steps
Apply `references/design-system.md`: retain CSS-first Tailwind v4 output, run
shadcn init, and set the concrete registry mapping
`@magicui: https://magicui.design/r/{name}.json` in `components.json` under
`registries`. Cite beautifului.dev as an approved source when selected.

## File tree
```text
my-app/
  package.json
  components.json
  src/app/page.tsx
  src/app/globals.css
```

## Conventions delta
Extend `Flag-first delivery` for user-visible routes and components.

## testConventions
Use `npm test` for units and `npx playwright test` for Playwright flows.

## designHomes
Set `designHomes.architecture.home` to `docs/architecture.md` and
`designHomes.ux.canon` to `docs/ux-canon.md`.

## Verify
```sh
test -f my-app/package.json && test -f my-app/src/app/page.tsx && test -f my-app/src/app/globals.css && (cd my-app && node scripts/check-readme-catalog.mjs --project-root .)
```

## CI and release adapter

Select `web` in `.github/greenfield-delivery.json` and follow
[the shared CI/release strategy](../ci-release-strategy.md) for its exact inventory,
executor, raw report, coverage merge and build contract. Bind runner/build argv
into the shard manifest before execution; require exact-once leaf/file selection.
Generate `scripts/ci-shard-plan.mjs`, `.github/workflows/ci.yml` and
`.github/workflows/release.yml` only from the approved preservation plan.
Missing tooling/reporters are unavailable with the adapter install remedy.
Affected PR checks backstop into authoritative full shards on main/manual runs;
release promotes the same verified artifact bytes without rebuilding.
