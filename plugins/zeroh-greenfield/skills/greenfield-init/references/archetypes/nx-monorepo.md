## Generator
```sh
npx create-nx-workspace@^23 my-workspace --preset=ts --workspaceType=integrated --packageManager=npm --nxCloud=skip --interactive=false
```

Source: https://nx.dev/getting-started/installation. create-nx-workspace is
MIT, tier `Allowed anywhere` as repository tooling.

## Post-steps
Create `packages/`, then add `generators.json` for first-party generators and
`emitted/repo-catalog.json`; the README consumes emitted/repo-catalog.json.
Adopt five Nx tag axes (`type:`, `scope:`, `domain:`, `kind:`, `stability:`),
encode them in `depConstraints`, keep `compilerOptions.paths absent` (no base paths),
and use an Nx-synced solution tsconfig. Preserve `nx:noop` for
intentionally empty targets.

| language option | workspace contract |
| --- | --- |
| TypeScript only | npm workspace packages |
| TypeScript + Python (uv) | npm packages plus uv-managed Python projects |

Not generalized from zeroh: `CODEOWNERS`, `tsdown`, three test runners,
`radix-nova`, and `.building/` coordination state.

## File tree
```text
my-workspace/
my-workspace/nx.json
my-workspace/package.json
my-workspace/tsconfig.base.json
my-workspace/packages/
```

The generated root keeps `libs/` absent until the consumer selects a project.

## Conventions delta
Projects live in `packages/`; boundary tags and `depConstraints` make permitted
dependencies explicit. Repository metadata is emitted, and the README checks
the catalog rather than duplicating it.

## testConventions
Run `npx nx affected -t lint,typecheck,test,build` for changed projects and
`npx nx run-many -t test` for the explicit workspace unit sweep.

## designHomes
Set `designHomes.architecture.home` to `docs/architecture.md` and
`designHomes.ux.canon` to `docs/ux-canon.md`.

## Verify
```sh
test -f my-workspace/nx.json && test -f my-workspace/package.json && test -f my-workspace/tsconfig.base.json && test -d my-workspace/packages/ && (cd my-workspace && test ! -e libs)
```
