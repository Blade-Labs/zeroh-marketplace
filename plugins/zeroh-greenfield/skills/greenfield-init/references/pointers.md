## Tool gate
The skill's first preflight must prove `scope-manifest-json-v1` plus scoped,
affected, and impacted slots before this reference is used.

## Config branch
Use the canonical discovery procedure in `skills/brownfield-audit/references/marker-table.md` to locate the resolved root before testing configuration presence. If its config is absent, propose `roadmap init`; if present, never run init. Merge only approved missing keys. Existing keys are preserved unless an individually approved stale/partial repair names the old value, replacement, and evidence. Never create a second config at the repository top level.

## Bind and prove commands
The tables are proposal inputs, not proof that a generator installed a runner.
Before approval, inspect the generated or existing package scripts, test files,
Gradle tasks, and tool availability. Propose installation/configuration of missing
promised runners and at least one meaningful test. Never bind `npm test` or
Playwright without that setup. A slot with no applicable tooling is explicitly
`none` (declared absent), with a recorded reason approved in the proposal; absence
is not a passing test. Never downgrade an existing or promised test to `none` to
make verification green. Replace candidate bindings with the repository's actual
commands where needed and retain their source evidence.
Execute every non-`none` gate from the consumer project root after approval and
record its command, cwd, and exit. STOP on failure or unavailable tooling; config
validation alone does not prove executability. Re-run after a binding changes.

## Merge manifest pointers
Copy only the selected manifest values into `designHomes.architecture.home`, `designHomes.architecture.extendProtocol`, `designHomes.ux.canon`, `designHomes.ux.qualityExemplar`, `designHomes.ux.copyRules`, `designHomes.ux.bindingDesignSystem`, and `testConventions`.
Map commands to `gateCommands.lint`, `gateCommands.types`, `gateCommands.unit`, `gateCommands.integration`, `gateCommands.build`, `gateCommands.e2e`, and `gateCommands.emit`.

### web
| slot | command | source |
| --- | --- | --- |
| lint | none | declared absent; propose a binding when tooling exists |
| types | none | declared absent; propose a binding when tooling exists |
| unit | npm test | ## testConventions |
| integration | none | declared absent; propose a binding when tooling exists |
| build | npm run build | approved package build script |
| e2e | npx playwright test | ## testConventions |
| emit | none | declared absent; propose a binding when tooling exists |

### flutter
| slot | command | source |
| --- | --- | --- |
| lint | none | declared absent; propose a binding when tooling exists |
| types | none | declared absent; propose a binding when tooling exists |
| unit | flutter test | ## testConventions |
| integration | flutter test integration_test | ## testConventions |
| build | none | declared absent; propose a binding when tooling exists |
| e2e | none | declared absent; propose a binding when tooling exists |
| emit | none | declared absent; propose a binding when tooling exists |

### android
| slot | command | source |
| --- | --- | --- |
| lint | none | declared absent; propose a binding when tooling exists |
| types | none | declared absent; propose a binding when tooling exists |
| unit | ./gradlew test | ## testConventions |
| integration | ./gradlew connectedAndroidTest | ## testConventions |
| build | none | declared absent; propose a binding when tooling exists |
| e2e | none | declared absent; propose a binding when tooling exists |
| emit | none | declared absent; propose a binding when tooling exists |

### expo
| slot | command | source |
| --- | --- | --- |
| lint | none | declared absent; propose a binding when tooling exists |
| types | none | declared absent; propose a binding when tooling exists |
| unit | npm test | ## testConventions |
| integration | none | declared absent; propose a binding when tooling exists |
| build | npx expo export | ## testConventions |
| e2e | none | declared absent; propose a binding when tooling exists |
| emit | none | declared absent; propose a binding when tooling exists |

### nx-monorepo
| slot | command | source |
| --- | --- | --- |
| lint | npx nx affected -t lint,typecheck,test,build | ## testConventions |
| types | npx nx affected -t lint,typecheck,test,build | ## testConventions |
| unit | npx nx run-many -t test | ## testConventions |
| integration | none | declared absent; propose a binding when tooling exists |
| build | npx nx affected -t lint,typecheck,test,build | ## testConventions |
| e2e | none | declared absent; propose a binding when tooling exists |
| emit | none | declared absent; propose a binding when tooling exists |

Add these optional Nx bindings only when selected, without replacing an
existing value: `unit-scoped` and `unit-affected` are `node
scripts/run-nx-test-tier.mjs '{manifest}'`; `unit-impacted` is `node
scripts/run-nx-test-tier.mjs '{range}'`. Copy the selector before `roadmap config
check`. Enable `testCadence.enabled` only with an actually selected full-suite backstop; preserve an existing configured backstop. The seven base rows remain required; only schema-supported optional rows may
be merged.

### library-cli
| slot | command | source |
| --- | --- | --- |
| lint | none | declared absent; propose a binding when tooling exists |
| types | none | declared absent; propose a binding when tooling exists |
| unit | node --test | ## testConventions |
| integration | node dist/cli.js --help | ## testConventions |
| build | none | declared absent; propose a binding when tooling exists |
| e2e | none | declared absent; propose a binding when tooling exists |
| emit | none | declared absent; propose a binding when tooling exists |

## Validate
Run `roadmap config check` after either branch and STOP on red.

## Delivery proposal, copy and validation

This section applies only when CI/release setup is selected. Local prototype setup omits the `delivery` object, workflows and planner; record the deferral and keep existing CI unchanged. Do not enable test cadence without a real selected backstop.

For selected delivery, before any consumer write load `references/ci-release-strategy.md` from the installed greenfield-init skill directory. Ask the CI provider and protected
release environment. The supplied workflows support GitHub Actions; another
provider is unavailable until its adapter is implemented and approved. Present
all commands, baselines, setup/cache roots and provider placeholders. Do not
select credentials, publish or deploy during initialization.

Add this concrete object to the same parser-bound proposal (replace every value):

```json
{"delivery":{"provider":"github-actions","adapter":"library-cli","configPath":".github/greenfield-delivery.json","workflowPaths":[".github/workflows/ci.yml",".github/workflows/release.yml"],"plannerPath":"scripts/ci-shard-plan.mjs","releaseEnvironment":"<approved-protected-environment>","collision":{"existingPaths":[],"decision":"create","preserveUntilApproval":true,"mergeManifests":{}},"validationCommands":[{"command":"<complete-installed-output-validation-command>","cwd":"<absolute-consumer-root>"}]}}
```

List every preexisting target workflow in `existingPaths`; choose `merge` when
any exists, otherwise `create`. Show the exact preserved job/marker blocks and
merged additions. STOP if no explicit merge decision is available. The complete
proposal followed by explicit host/user approval authorizes the listed merge;
native validation uses `APPROVE GREENFIELD PLAN` as its observed marker. No other collision is authorized. Existing workflow bytes remain untouched
before approval. For each existing workflow, `collision.mergeManifests[path]`
must bind `beforeSha256` to its original bytes, computed by a tool rather than predicted by the model; sorted `preservedJobs` names every
prior job; sorted `preservedTopLevel` names every unchanged non-jobs top-level key.
For each other prior key, `replacements[key]` gives its exact parsed YAML `before`
and `after` values. List every original full comment/marker line, with original
whitespace and order, in `preservedComments` and retain those lines byte-for-byte.
Show these precise deltas in the proposal; a generic file-level merge is insufficient.
Use an empty `mergeManifests` object when there are no existing workflows.
Brownfield audit consumes this same owner contract for its
missing/partial delivery rows; do not duplicate the interview or lifecycle.

After approval, copy `templates/scripts/ci-shard-plan.mjs` byte-for-byte to
`scripts/ci-shard-plan.mjs`, then copy/fill `templates/github/workflows/ci.yml`
and `release.yml` into `.github/workflows/`. Merge approved existing jobs and
preserve their exact content. Write `.github/greenfield-delivery.json` with the
selected adapter, complete runner/build bindings and approved baseline. Replace
the release workflow's environment placeholder with the approved protected
environment, retaining least privilege. Leave `release.provider` as `none` when
no deployment provider was selected; this explicitly blocks promotion without
claiming a deployment passed.

Set `testCadence.enabled: true` and `testCadence.backstop` to
`.github/workflows/ci.yml (authoritative full suite on main/manual runs)`; merge
existing values only with the approved exact delta. Keep scoped/affected/impacted
bindings where actual tooling supports them. Populate README commands with the
same affected/local/full lifecycle and exact `.github/workflows/ci.yml` and
`.github/workflows/release.yml` paths. README catalog reconciliation still applies.

Validate the four installed outputs, not just source templates. The plugin-owned
`greenfield-ci-release.test.mjs` supports `GREENFIELD_DELIVERY_ROOT=<consumer>`;
its mandatory pinned js-yaml parser reads the installed workflows and its
executable simulations import/copy the installed planner. Run its complete suite
(no test-name filter) and require terminal TAP totals with zero failure,
cancellation or skipped tests. Preserve the real native command ID/exit and
record the optional actionlint path/version or `ACTIONLINT_UNAVAILABLE`. A
passed simulation is not a published GitHub run or a live cloud deployment.

For phase validation, bind the exact host command in `delivery.validationCommands`:
`<bound-capbuild-executable> --env GREENFIELD_DELIVERY_ROOT=<consumer>
node --test <installed-roadmap>/test/fixture-consumer/greenfield-ci-release.test.mjs`.
The host wrapper is validation infrastructure; never embed its machine path in
portable consumer gateCommands. The suite creates isolated temporary fixtures
and simulates external SDK/provider boundaries, then cleans them up. Preserve
its inherited approval controls. A final read-only audit must propose no changes
and write nothing; it must not rerun mutation-producing tests during that audit.

## Native proof of optional Nx gates

The phase-validation proposal keeps its seven required base slots in `gates` and
adds the schema-supported slots in `optionalGates`. Nx installation includes
`unit-scoped`, `unit-affected` and `unit-impacted`; never omit them to fit a
seven-key evidence record. Generated `gateCommands` equals the exact union.

For each template slot, propose one `optionalGateRuns[slot]` record with
`substitutions: {manifest: "@<absolute-in-scratch-manifest>"}` or
`substitutions: {range: "<exact-base-SHA>..<exact-head-SHA>"}`, and `inputSha256`
hashing the raw manifest bytes or literal range. Use a separate approved regular
JSON file for each manifest: `{protocol:"scope-manifest-json-v1",paths:[...]}`
with sorted unique real repository-relative files. A scoped manifest contains
actual test files; an affected manifest includes a source file. List these inputs
as explicit proposal artifacts. The driver may prepare two real fixture commits
before observation; native initialization never changes fixture history.

Execute each optional slot separately using the literal single substitution in
its configured command. For Nx the command is `node scripts/run-nx-test-tier.mjs
'{manifest}'` or `'{range}'`, with `env NX_DAEMON=false` when daemon writes must
be disabled. For a range, also execute `git rev-parse HEAD` and
`git diff --name-only -z <exact-range>` plus
`git merge-base --is-ancestor <base-SHA> <head-SHA>` to prove the current commit,
changed files and ancestry. Record the configured template, exact native command, substitution, input
digest, cwd, native tool-call ID and numeric exit. Require the actual selector's
scoped/affected tier and real test success; an unavailable or full fallback is
reported honestly and cannot stand in for the requested scoped proof.
