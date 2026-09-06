# Baseline preparation regression — test-engineer

Read `plugins/zeroh-roadmap/agents/test-engineer.md`. `roadmap/roadmap.config.json` has no `testConventions`; inferred node:test, strict assertions, temporary fixtures, spawnSync and actual workflow snippets from greenfield-ci-release.test.mjs, greenfield-optional-gates.test.mjs, and greenfield-test-selection.test.mjs. Read public baseline contract and minimum prepare CLI wiring; no implementation plan used for initial tests.

RED means the production CLI accepted an unauthorized baseline change through prepare plan, plan, prepare run, run, prepare fanin and fanin. The fixture creates real Git previous/proposed commits and executes actual workflow snippets with fake inventory/test executables producing raw JUnit/LCOV. No direct planner helper constructs the production plan. Initial fixture supplied prior approved baseline in adapterConfig as well as Git history.

Initial RED command (before production changes):

```sh
cd /home/patrik/zeroh-marketplace-codex-29-30-31-32-33-34
capbuild node --test --test-name-pattern='prepared workflow preserves approved baselines' plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs
```

Exit 1. Exact summary:

```text
# tests 20
# suites 0
# pass 4
# fail 16
# cancelled 0
# skipped 0
# todo 0
# duration_ms 13243.563925
capbuild: command exited non-zero (code 1) — treat as a failure, do not proceed as if it passed.
```

15 negative subcases failed: missing approval, incorrect previousDigest, incorrect approvedDigest, empty owner, empty reason, separately for minTests/minUnits/coverageFloor. Parent subtest also failed. Unchanged valid baseline and all three explicitly approved change controls passed.

Representative exact failure (initial test line 264; assertion line 276):

```text
unapproved minTests change reached successful fan-in: [{"stage":"prepare plan","status":0,"stderr":""},{"stage":"plan","status":0,"stderr":""},{"stage":"prepare run","status":0,"stderr":""},{"stage":"run","status":0,"stderr":""},{"stage":"prepare fanin","status":0,"stderr":""},{"stage":"fanin","status":0,"stderr":""}]
```

Following architect direction, extended fixtures to bind approval.baseSha to the real prior commit, use BASE_SHA, reject wrong baseSha and caller-invented previous values, reject unavailable base objects, cover local first-parent fallback, and cover proven first adoption with explicit bootstrap approval (including invalid digest/owner/reason and bootstrap attempting to hide an existing baseline). These are new acceptance cases beyond initial RED. Initial valid unchanged baseline remains covered. A first-adoption fixture has a parent commit without a delivery config; no-parent adoption is not currently covered. Parent root owns production implementation and final green run.

Only modified greenfield-ci-release.test.mjs. No production files, acceptance docs, native validation, old evidence, commits, agents, or paid native runs were changed/run by this test-engineer.
