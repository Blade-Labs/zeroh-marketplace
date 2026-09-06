# CI and exact-artifact release

Load this reference only for explicitly selected CI/release setup. A local first
prototype does not require these workflows, sharding or cloud configuration.

Use the consumer-owned `scripts/ci-shard-plan.mjs` as the sole lifecycle engine.
Copy its two workflows to `.github/workflows/ci.yml` and `release.yml` only after
approval. Configure `.github/greenfield-delivery.json`; missing configuration,
runner, report parser, baseline, credential or provider is unavailable and exits
nonzero with an install/configuration remedy. A template is not a successful run.

## Approval and configuration

Present the selected adapter, exact inventory/test/build argv, setup commands,
report paths, coverage roots, shard count, count/coverage baselines, affected PR
command, main branch, retention, protected environment and provider placeholders.
Pin dependency versions in the consumer lockfile. Preserve existing workflows;
collisions require an explicit reviewed merge. Never invent credentials or a
working deployment. Provider defaults to unavailable; no arbitrary promotion hook
is accepted. The optional selected provider is `aws-s3-v1`, configured with
`environment`, `bucket`, `region`, `keyPrefix` and an approved OIDC `roleArn`.
The bucket must support versioning and SHA-256 checksums. Other providers require
a separately implemented and verified adapter before use.

Configuration version 1 has `archetype`, `setupArgv` (array of exact argv arrays),
`affectedArgv` (an argv array with a standalone `{base}` token), `shardCount`,
`evidenceDays` (1 through 7), `baseline: {minTests,minUnits,coverageFloor}`,
`adapterConfig: {maxInfraRetries,coverageRoots,leafTasks}`, `runners`, `build`
and `release`. `operationalRoots` explicitly lists dependency/cache/report roots
(defaults `.ci` and `node_modules`); it is also bound in the plan. Each runner binds `inventoryArgv`, `inventoryFormat`, optional
`filePattern`/`pathPrefix`/`targetSuffix`, `shardArgv`, optional reporter `env`,
and `rawReports: [{path,format,from?}]`. Vitest/Playwright also require
`selectionArgv` and `selectionFormat`: the actual pre-run selected file inventory
must equal the single requested unit, or execution stops. `from: stdout` retains the actual process
output as a raw report. Substitutions are whole argv data, never shell evaluation:
`{unit}`, `{reportDir}`, `{junit}`, `{coverage}`. Build binds `argv` and explicit
`outputs` roots; symlinks and overlapping output roots are rejected. The planner
binds the complete runner/build execution contract into `adapterConfigDigest`.
Changing a runner, reporter, output or build command after planning fails.
Production preparation and run/build boundaries verify the exact Git SHA/tree and
an unchanged source snapshot, including ignored/untracked files. Setup/tests may
change only the declared operational roots; build may additionally change its
declared output roots. Other tracked or untracked changes fail.

## Six adapters

Atomic identity is exactly `{runner,canonicalPathOrLeafTask}`. Keep distinct runner
populations disjoint even if two runners reference the same filename. The adapter
owns inventory argv, execution argv, raw formats, canonical coverage merge and
build. The following argv are baseline contracts to fill with the consumer's
approved reporter configuration; missing reporter output is a hard failure.

| Archetype | Identity / exact inventory | Executor / raw reports / build |
| --- | --- | --- |
| web | `vitest` canonical files from `npm exec -- vitest list --filesOnly`; independently `playwright` canonical files from `npm exec -- playwright test --list --reporter=json` | Vitest run with the approved exact-file selector, `--reporter=junit --outputFile={junit} --coverage --coverage.reporter=lcov --coverage.reportsDirectory={reportDir}`; Playwright exact-file selection with `--retries=0 --reporter=junit`, `PLAYWRIGHT_JUNIT_OUTPUT_FILE={junit}` and approved LCOV collection. JUnit + LCOV; canonical line merge; `npm run build`. |
| expo | `jest` canonical files from `npm exec -- jest --listTests --json`; separately the same Playwright inventory as web | `npm exec -- jest --runInBand --runTestsByPath {unit} --reporters=default --reporters=jest-junit --coverage --coverageReporters=lcov --coverageDirectory={reportDir}`; `JEST_JUNIT_OUTPUT_FILE={junit}`. Independent Playwright runner as above. JUnit + LCOV; canonical merge; `npm exec -- expo export`. |
| flutter | `flutter` canonical `_test.dart` files from `git ls-files -z -- test`, filtered by `_test\\.dart$` | `flutter test --machine --coverage --coverage-path={coverage} {unit}`; retain stdout as `flutter-machine`, plus LCOV. Canonical merge; approved `flutter build web` or the selected platform's exact build argv. |
| android | `gradle` leaf tasks such as `:app:testDebugUnitTest`, discovered from the actual Gradle task inventory and dependency graph | `./gradlew {unit} --no-daemon --console=plain` with selected JUnit XML and JaCoCo XML outputs. Configure the actual leaf `Test` task/report output and coverage finalizer; declare its dependencies in `leafTasks`. Reject aggregate tasks and overlapping task dependency sets. Canonical merge; approved `./gradlew :app:assembleRelease --no-daemon`. |
| nx-monorepo | `nx` leaf project-target identities such as `package-a:test`, inventory `npm exec -- nx show projects --withTarget=test --json` plus configured target suffix; inspect actual target/dependency metadata | `npm exec -- nx run {unit} --excludeTaskDependencies --skipNxCache`; each approved leaf runner emits JUnit + LCOV (or explicitly selected supported raw formats). Never infer one reporter from another executor. Reject aggregates/dependency overlap. Canonical merge; `npm exec -- nx run-many -t build` with approved explicit artifact roots. |
| library-cli | `node:test` canonical files from `git ls-files -z -- test tests`, filtered by the selected test filename convention | `node --test --experimental-test-coverage --test-reporter=junit --test-reporter-destination={junit} --test-reporter=lcov --test-reporter-destination={coverage} {unit}`. JUnit + LCOV; canonical merge; `npm run build`. |

Vitest/Playwright positional filters can match more than one file. The approved
runner binding must use an exact selector and prove its selected inventory equals
the one requested identity before execution; a broad pattern is not an exact
selector. Playwright browser coverage is not automatic: install and configure the
approved instrumented coverage reporter, or report the adapter unavailable. Do
not substitute an empty coverage file. For Gradle/Nx, the inventory command must
produce an unambiguous leaf list; unsupported inventory/report formats require an
approved converter that consumes actual tool output, never a hand-maintained
success list. SDK/JDK/browser setup belongs in reviewed `setupArgv`, with pinned
versions and no secret defaults. `ADAPTERS` in the engine names install remedies.

## Determinism and completeness

Versioned manifests bind source SHA, tree, normalized sorted unique identities,
runner/build contract digest and inventory digest. Normalize Windows separators
to `/`; reject traversal, absolute paths and duplicate identities. Generate the
inventory afresh: renamed identities replace old names, deleted tests disappear
and therefore face the approved count baseline. Default weight is exactly 1;
round-robin count balancing is deterministic. One shard and more requested shards
than units are valid; clamp the latter to units and emit no empty shard. Input
permutation cannot change the manifest, shards or digest. Fan-in requires every
planned shard exactly once and its executed identity union exactly equal to the
inventory. Report paths/digests are retained, not accepted from a summary alone.

The engine parses JUnit XML, Flutter machine JSON lines, LCOV and JaCoCo XML with
separate parsers. Truncated/contradictory summaries, duplicate cases, hidden failed
or skipped cases, malformed coverage, unknown formats and missing outputs fail.
Coverage paths are remapped only through approved roots, then merged once by
canonical file/line (maximum hit count, never summing percentages). Coverage is a
line-coverage floor in version 1; branch/function percentages are not asserted.

Keep every attempt. The generated runner disables test retries. Bounded external
infrastructure retry allows at most `maxInfraRetries` (0 by default, at most 2),
requires explicit infrastructure code/reason and retains first-attempt evidence.
A required test failure remains blocking even if a rerun passes (flaky).
Quarantine requires owner, reason and unexpired expiry, and still blocks an
authoritative release. Missing first attempts or gaps in numbering fail. Upload
compact reports and raw failure diagnostics under `always()`, even on failed jobs.

`minTests`, `minUnits` and `coverageFloor` are approved baselines. During preparation,
the engine reads the previous baseline from the tracked delivery config at `BASE_SHA`:
push uses the event's previous-main SHA; manual full requires an explicit approved
`base_sha` input. Scheduled/local validation uses the current commit's first parent.
A nonempty base must be an exact ancestor preceding HEAD. Missing history fails;
a root commit or new-branch push can prove that no prior branch baseline exists.
The plan binds `{baseSha,baseline,baselineDigest,requestedDigest}` as
`adapterConfig.baselineReference`, carried through fan-in and release verification.
A changed baseline requires
`baselineApproval: {baseSha,previous,previousDigest,approvedDigest,owner,reason}`,
matching the derived previous baseline and proposed values. The approval's `previous`
value never supplies the source of truth. First installation requires the same
approval with `bootstrap:true`, `previous:null`, and the digest of null as
`previousDigest`, bound to the proven absent config/base and approved current floor.
Record that bootstrap decision in the init proposal; it is not advance write approval.
Never lower a floor to hide a regression. Review baseline changes like code; a digest
is a binding, not an independent human authorization mechanism.

## Lifecycle and release proof

PRs run the configured affected command using the exact base SHA. Main and manual
full runs inventory, plan, execute shards, fan in, build once and attest. Nightly
runs diagnose with the same full tests/build but do not publish authoritative
release evidence. PR cancellation is enabled; full/release runs never cancel one
another. The authoritative artifact name includes source SHA and producer run ID.

The manifest is `{schemaVersion,authoritative,sha,tree,suiteManifestDigest,
shardReports,coverageDigest,buildDigest,producerRunId,expiresAt,baselineDigest,
testCount,coveragePercent}`. Each raw shard report has a digest. Build files are
regular files encoded in a canonical content-addressed bundle; the build digest
binds paths and exact bytes. The attestation signs the manifest, transitively
binding all test, coverage and build evidence. GitHub's signature verification is
separate from the local digest checks.

Release resolves a tag/manual reference to an exact commit and tree, enumerates
successful full producers, downloads evidence and requires exactly one unexpired
same-SHA authoritative producer. It verifies the signed manifest against the
repository, signer workflow and source digest, then recomputes every local link.
Missing/expired/ambiguous evidence, changed tags, report/inventory/coverage/build
or producer drift is red. The verification handoff retains SHA, tree, suite digest and complete build-record
digest. Protected promotion re-verifies expiry/tag/tree and
uploads only the already-verified bundle; no build or consumer command runs there.
The fixed AWS adapter obtains an OIDC token, assumes the approved role, uploads
with a SHA-256 checksum, and checks the versioned provider readback checksum and
size. Missing credentials, unsupported provider, skipped upload or mismatched
readback is red.

All actions use immutable full commit pins with version comments. Workflow-level
permissions are empty; test/build jobs get contents-read only. The isolated
non-PR, non-nightly CI signing job alone gets attestations-write and OIDC for
signing. In release, only the protected deployment job gets OIDC. Forks receive no
secrets. Artifacts expire within 7 days (raw diagnostics 3; verified promotion 1).
Replace the environment placeholder only with the approved protected environment.

## Validation and sources

Mandatory: repository-pinned js-yaml 3.15.2 parses both workflows, then executable
workflow simulations invoke the shipped CLI through actual YAML `run` snippets.
Mocks exist only at external executable/artifact/provider boundaries. Mutation
checks cover missing/duplicate/red/retried/quarantined/malformed evidence,
stale/expired/ambiguous producers, count/coverage floors, every digest link, moved
tags, changed argv and rebuild attempts. Optional actionlint was absent on the
phase-34 validation host; it cannot replace these checks. That host's older `gh`
also lacks attestation commands; a real release runner must have current GitHub
CLI support, otherwise release stops with its tool error.

Commands and pins checked 2026-09-05 against official sources:
[Node test runner](https://nodejs.org/api/test.html),
[Vitest CLI](https://vitest.dev/guide/cli.html),
[Playwright CLI](https://playwright.dev/docs/test-cli),
[Flutter testing](https://docs.flutter.dev/testing/overview),
[Gradle test reports](https://docs.gradle.org/current/userguide/java_testing.html),
[Nx CLI](https://nx.dev/docs/reference/nx-commands),
[GitHub attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations),
[gh attestation verification](https://cli.github.com/manual/gh_attestation_verify).
Action SHA/version pairs were resolved with `git ls-remote --tags` against the
corresponding official `github.com/actions/<action>` repositories, including the
peeled commit for annotated attestation tags.
