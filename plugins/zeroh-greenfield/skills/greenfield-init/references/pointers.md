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

Add `testCadence.enabled: true` and these optional Nx bindings without replacing an
existing value: `unit-scoped` and `unit-affected` are `node
scripts/run-nx-test-tier.mjs '{manifest}'`; `unit-impacted` is `node
scripts/run-nx-test-tier.mjs '{range}'`. Copy the selector before `roadmap config
check`. The seven base rows remain required; only schema-supported optional rows may
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
