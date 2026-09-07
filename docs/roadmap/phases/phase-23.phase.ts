import { definePhase } from '../lib/schema'

/**
 * Roadmap root discovery — the plugin stops pinning its two roots to the repo top level.
 *
 * Today every consumer must carry `roadmap/` (records) and `lib/roadmap/schema.ts` (the
 * schema seam) at the git toplevel: the config loader reads `<toplevel>/roadmap/roadmap.config.json`,
 * the tsx bridge validates through `<toplevel>/lib/roadmap/schema.ts`, and 25 non-test source files
 * across cli/ and hooks/ join the literal `'roadmap'` onto whatever root they hold (106 sites).
 * The zeroh Nx monorepo wants the roadmap under `docs/roadmap/` beside `docs/superpowers/`
 * (two workflows, two sibling homes — ruled 2026-09-02), with no root-level `lib/` and no
 * `@/` tsconfig alias. This phase makes the root DISCOVERABLE (default unchanged, `docs/roadmap/`
 * the second candidate, `ROADMAP_ROOT` the override) and moves the schema seam under the root for
 * new consumers while the legacy seam stays recognized.
 *
 * ## Hypotheses
 * 1. CONFIRMED — no discovery exists: `ROADMAP_ROOT` has 0 hits under cli/, hooks/, bin/;
 *    config.mjs:211 joins `'roadmap'` onto the toplevel; tsx-bridge.mjs:448 joins
 *    `'lib', 'roadmap', 'schema.ts'` onto the consumer root; status.mjs:347 defaults its root
 *    argument to the bare string `'roadmap'`.
 * 2. CONFIRMED — the literal is spread, not centralized: 10 files under cli/lib, 15 under
 *    cli/commands, 2 hooks (executor-result-guard.mjs:334, session-lane-check.mjs:28), 1 shell
 *    hook (beacon-stamp.sh:70), plus cli/audit-checks.mts:36-39 and 2 testdata builders; the
 *    dominant shape is `join(<dir>, 'roadmap', …)` (25× phases, 8× arcs, 7× arc-evals, 11× config).
 * 3. REFUTED — "the templates are root-agnostic": templates/backlog.ts:42 and
 *    templates/example.arc.ts:19 import `@/lib/roadmap/schema` (a tsconfig `paths` alias this
 *    repo defines and zeroh's tsconfig.base.json does not), and templates/registry.ts:49 defaults
 *    to `process.cwd()/roadmap/phases`.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 23,
  name: 'Roadmap root discovery: docs/roadmap as a second home, schema seam under the root, ROADMAP_ROOT override',
  status: 'done',
  completedDate: '2026-09-02',
  gate: {
    lint: 'clean', typeCheck: 'clean',
    unitTests: { passed: 1766, total: 1766, notes: 'Post-review full gate roadmap/.gate/23/run-000006-2026-09-02T17-08-39-420Z.json — GREEN; lint-diff and history-comments exited 0.' },
    integrationTests: { passed: 0, total: 0, notes: 'declared-none; hardening closure used the post-review full unit gate.' },
    e2eTests: { passed: 0, total: 0, notes: 'declared-none; no rendered surface.' }, build: 'clean',
  },
  gateRounds: [
    { round: 0, agent: 'quality-pass', model: 'claude-opus-5', verdict: 'findings-fixed', summary: 'Simplified touched code and corrected the schema-seam remedy.' },
    { round: 1, agent: 'code-reviewer', model: 'claude-fable-5', verdict: 'findings-fixed', summary: 'Closed six discovered-root gaps and mutation-proved the exclusion guard.' },
    { round: 2, agent: 'code-reviewer', model: 'claude-fable-5', verdict: 'findings-fixed', summary: 'Aligned metrics markers, ambiguity and overrides with tests.' },
    { round: 3, agent: 'code-reviewer', model: 'claude-fable-5', verdict: 'findings-fixed', summary: 'Normalized an empty ROADMAP_ROOT and pinned discovery.' },
    { round: 4, agent: 'code-reviewer', model: 'claude-fable-5', verdict: 'clean', summary: 'All findings resolved; final independent review clean.' },
  ],
  metrics: { commits: 1, linesAdded: 2714, linesRemoved: 375, filesChanged: 91, testsAtStart: 1693, testsAtEnd: 1766, testsAdded: 73, startedAt: '2026-09-02T10:07:01.000Z', completedAt: '2026-09-02T17:09:01.000Z' },
  compromises: 'Task 23.5 plan edits were explicitly authorized by the recorded operator and software-architect rulings; no unratified implementation compromise remains.',
  executionResult: {
    phase: 23, status: 'done', driver: { model: 'gpt-5.6-sol', lane: 'codex' },
    roles: [
      { role: 'quality-pass', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'quality-pass', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
    ],
    compromises: [], skipped: [], hardcoded: [],
    surfaced: ['An unauthorized quality-role full suite was interrupted and the role rerun with a no-test constraint.', 'A lockless install selected Zod 4.5.4; aligning to the primary lockfile pin 4.4.3 made the schema check and full gate green.', 'The required curator emitted its generic Claude trailer, which cannot be overridden through phase curate.'],
    hardStops: [], gateRounds: 5,
  },
  plannedBy: { model: 'claude-fable-5-1' },
  reviewRecord: { date: '2026-09-02', model: 'claude-fable-5-1', verdict: 'READY', via: 'executed' },
  category: 'refactor',
  kind: 'hardening',
  source:
    'Owner request 2026-09-02: adopt zeroh-roadmap in the zeroh Nx monorepo with the roadmap under docs/roadmap/ beside docs/superpowers/ (two workflows, two sibling homes; superpowers untouched). Discovery, not a config key: the config lives inside the root it would have to name.',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs',
    'plugins/zeroh-roadmap/cli/lib/roadmap-root.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/config.mjs',
    'plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs',
    'plugins/zeroh-roadmap/cli/lib/derive.mjs',
    'plugins/zeroh-roadmap/cli/commands/status.mjs',
    'plugins/zeroh-roadmap/cli/commands/init.mjs',
    'plugins/zeroh-roadmap/cli/audit-checks.mts',
    'plugins/zeroh-roadmap/hooks/beacon-stamp.sh',
    'plugins/zeroh-roadmap/scripts/scaffold-roadmap.sh',
    'plugins/zeroh-roadmap/templates/backlog.ts',
    'plugins/zeroh-roadmap/templates/registry.ts',
    'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md',
    'plugins/zeroh-roadmap/README.md',
    'plugins/zeroh-roadmap/test/fixture-consumer/harness.mjs',
  ],
  stakeholderDemo:
    'A repo laid out as docs/roadmap/{roadmap.config.json,backlog.ts,phases/,arcs/} with the schema at <root>/lib/schema.ts runs roadmap status, phase validate, audit, gate plan and claim unchanged; every existing consumer (roadmap/ + lib/roadmap/) is untouched; ROADMAP_ROOT overrides both; a repo carrying both candidates is refused by name instead of silently picking one.',
  userFacing: false,
  assumptions: [
    {
      claim: 'No root discovery exists anywhere in the plugin runtime (ROADMAP_ROOT is unknown to cli/, hooks/, bin/).',
      verify:
        'bash -c "test \\"$(grep -rl ROADMAP_ROOT plugins/zeroh-roadmap/cli plugins/zeroh-roadmap/hooks plugins/zeroh-roadmap/bin | wc -l)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The config loader pins the data root to <toplevel>/roadmap.',
      verify: 'bash -c "grep -qF \\"join(toplevel, \'roadmap\', \'roadmap.config.json\')\\" plugins/zeroh-roadmap/cli/lib/config.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The tsx bridge pins the schema seam to <consumerRoot>/lib/roadmap/schema.ts.',
      verify: 'bash -c "grep -qF \\"join(consumerRoot, \'lib\', \'roadmap\', \'schema.ts\')\\" plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The templates import the schema through the @/ tsconfig alias.',
      verify: 'bash -c "grep -qF \'@/lib/roadmap/schema\' plugins/zeroh-roadmap/templates/backlog.ts && grep -qF \'@/lib/roadmap/schema\' plugins/zeroh-roadmap/templates/example.arc.ts"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The beacon hook pins the arc registry under $main/roadmap/arcs/.building.',
      verify: 'bash -c "grep -qF \'registry=\\"$main/roadmap/arcs/.building\\"\' plugins/zeroh-roadmap/hooks/beacon-stamp.sh"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '23.1',
      title: 'roadmapRoot + consumerSchemaPath: one resolver, two candidates, one override',
      problem:
        'config.mjs:211 and tsx-bridge.mjs:448 each pin their root with a join literal; nothing can answer "where is this consumer\'s roadmap?" for a layout other than the toplevel one.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs',
          description:
            "New module. `ROOT_CANDIDATES = ['roadmap', 'docs/roadmap']` (precedence order). `roadmapRoot(dir)`: `ROADMAP_ROOT` env (absolute or dir-relative) wins; else candidates carrying a marker (`roadmap.config.json` OR `phases/`); one → it; two → RoadmapRootError('ambiguous') naming both + the env remedy; none → `<dir>/roadmap`. `consumerSchemaPath(dir)`: `<root>/lib/schema.ts`, else legacy `<dir>/lib/roadmap/schema.ts`, else BridgeError('schema-missing') naming BOTH. Pure fs probes, memoized → verify: bash -c \"grep -qF 'export function roadmapRoot' plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/roadmap-root.test.mjs >/dev/null 2>&1\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs',
          description:
            'consumerSchemaPath (tsx-bridge.mjs:447-455) delegates to roadmap-root.mjs and stays exported from here (gate.mjs, eval.mjs, result.mjs, eval-collect.mjs and landing.mjs import it from this module — no caller edits) → verify: bash -c "! grep -qF \\"join(consumerRoot, \'lib\', \'roadmap\', \'schema\\" plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/tsx-bridge.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/config.mjs',
          description:
            'loadConfig (config.mjs:209-225): `ROADMAP_CONFIG` still wins; else `join(roadmapRoot(toplevel), \'roadmap.config.json\')`; the absent-config message names the RESOLVED path and the `roadmap init --config` remedy; an ambiguous root surfaces as ConfigError(\'ambiguous\') carrying the resolver\'s text → verify: bash -c "! grep -qF \\"join(toplevel, \'roadmap\', \'roadmap.config.json\')\\" plugins/zeroh-roadmap/cli/lib/config.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/config.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'roadmap-root.test.mjs covers six directions: default when only roadmap/ exists; docs/roadmap when only it exists; neither → the default path; both → ambiguous refusal naming both; ROADMAP_ROOT absolute and relative override; schema seam root-first then legacy then schema-missing naming both',
        'config.test.mjs and tsx-bridge.test.mjs stay green; loadConfig on a docs/roadmap fixture returns the parsed config',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs',
        'plugins/zeroh-roadmap/cli/lib/roadmap-root.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs',
        'plugins/zeroh-roadmap/cli/lib/config.mjs',
        'plugins/zeroh-roadmap/cli/lib/config.test.mjs',
      ],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['roadmapRoot(dir)', 'consumerSchemaPath(dir)', 'ROOT_CANDIDATES', 'RoadmapRootError'] },
      done: true,
      doneDate: '2026-09-02',
      transparencyReport: {
        whatWasDone:
          'New cli/lib/roadmap-root.mjs is the one resolver: ROOT_CANDIDATES = [roadmap, docs/roadmap], roadmapRoot(dir) (ROADMAP_ROOT override -> marked candidate -> ambiguous refusal -> default first candidate), consumerSchemaPath(dir) (root-first <root>/lib/schema.ts, then the legacy <dir>/lib/roadmap/schema.ts, else BridgeError schema-missing naming BOTH), RoadmapRootError and resetRoadmapRootCache. tsx-bridge.mjs now delegates consumerSchemaPath and keeps exporting it (gate, eval, result, eval-collect and landing import it from there unchanged); its typed-cache dir and consumer probe ride roadmapRoot too. config.mjs resolves roadmap.config.json under roadmapRoot(toplevel), maps an ambiguous root to ConfigError(ambiguous) carrying the resolver text, and names the RESOLVED path in the absent message.',
        how:
          'TDD: zeroh-roadmap:test-engineer authored cli/lib/roadmap-root.test.mjs first from the acceptance criteria and type signatures only (never the steps) - 15 tests, RED at 0 pass / 1 fail with ERR_MODULE_NOT_FOUND on cli/lib/roadmap-root.mjs. Then the implementation, GREEN at 94/94 across roadmap-root + tsx-bridge + config (lib and commands) suites. The override is checked BEFORE the ambiguity probe so the remedy the refusal advertises is actually takeable, and an existing-but-unmarked directory is deliberately not a marker (markers are roadmap.config.json or phases/) so a repo with a prose docs/roadmap/ folder keeps reading its real roadmap/. Resolutions memoize on (dir, ROADMAP_ROOT) - keying on dir alone would hand a later caller an answer the current override never authorized.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Two files outside the planned files[] were touched, both forced by the plan and neither a scope change. (1) cli/lib/bridge-error.mjs is NEW: consumerSchemaPath must throw BridgeError (every caller tests `e instanceof BridgeError`) while tsx-bridge.mjs must consume roadmapRoot, so declaring the class in either module would make the two import each other; the class moved to its own dependency-free module and tsx-bridge.mjs re-exports it unchanged, so no importer or instanceof check moved. (2) cli/commands/config.test.mjs asserts the same absent-config line verbatim as cli/lib/config.test.mjs, so naming the RESOLVED path (a step-3 requirement) had to update both. Under TDD the test file cli/lib/roadmap-root.test.mjs is part of the diff and was already planned in files[].',
      },
    },
    {
      id: '23.2',
      title: 'Every join(<dir>, \'roadmap\', …) in cli/ and hooks/ rides the resolver',
      problem:
        'The data root is a literal in two forms — the argv form `\'roadmap\'` (25× `join(<dir>, \'roadmap\', \'phases\')` alone) and the path form `\'roadmap/<name>\'` (8× `\'roadmap/backlog.ts\'`, 8× `\'roadmap/arc-evals/lessons.jsonl\'`) — across 14 cli/lib files, 15 cli/commands files, 2 mjs hooks and audit-checks.mts; a docs/roadmap consumer reads as "no roadmap" everywhere the resolver is not consulted.',
      batchMode: true,
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/roadmap-root.test.mjs',
          description:
            'Guard FIRST (the 21.1 scan-tripwire pattern, worktree.test.mjs pluginSources): every non-test .mjs/.mts under cli/ and hooks/ is scanned for BOTH literal forms — argv (`\'roadmap\'` followed by `,` or `)`) and path (`\'roadmap/` + a known root member: backlog.ts, phases, arcs, arc-evals, archive, .gate, roadmap.config.json) plus `\'docs/roadmap\'`; prose examples (the codex usage line\'s `--doc roadmap/<name>.md`) fall outside the member list by construction. Only roadmap-root.mjs may hit; the scan asserts ≥30 sources reached (vacuity guard). RED now against 32 files → verify: bash -c "grep -qF \'ONLY home\' plugins/zeroh-roadmap/cli/lib/roadmap-root.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/derive.mjs',
          description:
            'cli/lib group (12 files the guard names: capacity, executor-arm, eval-collect, sidecar, gate-report, liveness, slots, eval-propose, derive, eval-score, landing, phasescan): `join(X, \'roadmap\', …)` → `join(roadmapRoot(X), …)`, `\'roadmap/<member>\'` → `join(roadmapRoot(X), \'<member>\')`; a `(dir) => join(dir, \'roadmap\')` helper becomes `roadmapRoot`. Default layout: no behavior change → verify: bash -c "test \\"$(grep -lE \\"\'roadmap[\'/]\\" plugins/zeroh-roadmap/cli/lib/*.mjs | grep -v test | grep -v roadmap-root | wc -l)\\" = \\"0\\" && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/derive.test.mjs cli/lib/landing.test.mjs cli/lib/eval-collect.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/status.mjs',
          description:
            'cli/commands group (15 files: audit, arm, disarm, init, watch, eval, arc, claim, codex, executor-disarm, gate, status, config, followups, phase): same substitution, both forms; status.mjs:347 defaults its root ARGUMENT to `roadmapRoot(gitToplevel(cwd))` (bare candidate when cwd is not a repo) so `roadmap status` with no argument finds docs/roadmap; init.mjs:44 writes the config under the resolved root → verify: bash -c "test \\"$(grep -lE \\"\'roadmap[\'/]\\" plugins/zeroh-roadmap/cli/commands/*.mjs | grep -v test | wc -l)\\" = \\"0\\" && cd plugins/zeroh-roadmap && capbuild node --test cli/commands/status.test.mjs cli/commands/init.test.mjs cli/commands/audit.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/audit-checks.mts',
          description:
            'The typed tier + hooks + testdata: audit-checks.mts:36-39 derives `roadmap`, `phasesDir`, `archiveDir` from the resolver and `registryPath` from `dirname(consumerSchemaPath(repo))/registry.ts`; config.mjs:45,55 + audit.mjs:238,247 name the resolved schema path (check 16 drift reads the new seam); hooks/executor-result-guard.mjs:334 and hooks/session-lane-check.mjs:28 import the resolver; the two cli/testdata builders take the root from it → verify: bash -c "cd plugins/zeroh-roadmap && capbuild node --test cli/lib/roadmap-root.test.mjs hooks/executor-result-guard.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The guard is GREEN: roadmap-root.mjs is the only non-test home of the root literals under cli/ and hooks/; three quoted mutations (a literal re-added to derive.mjs → RED; the guard\'s scan directory list emptied → its own vacuity assertion REDs; the literal inside roadmap-root.mjs → stays GREEN)',
        'The full plugin suite stays green with the default layout (`roadmap/` + `lib/roadmap/`) — this repo is the regression pin',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/roadmap-root.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/capacity.mjs',
        'plugins/zeroh-roadmap/cli/lib/executor-arm.mjs',
        'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
        'plugins/zeroh-roadmap/cli/lib/sidecar.mjs',
        'plugins/zeroh-roadmap/cli/lib/gate-report.mjs',
        'plugins/zeroh-roadmap/cli/lib/liveness.mjs',
        'plugins/zeroh-roadmap/cli/lib/slots.mjs',
        'plugins/zeroh-roadmap/cli/lib/eval-propose.mjs',
        'plugins/zeroh-roadmap/cli/lib/derive.mjs',
        'plugins/zeroh-roadmap/cli/lib/eval-score.mjs',
        'plugins/zeroh-roadmap/cli/lib/landing.mjs',
        'plugins/zeroh-roadmap/cli/lib/phasescan.mjs',
        'plugins/zeroh-roadmap/cli/commands/audit.mjs',
        'plugins/zeroh-roadmap/cli/commands/arm.mjs',
        'plugins/zeroh-roadmap/cli/commands/disarm.mjs',
        'plugins/zeroh-roadmap/cli/commands/init.mjs',
        'plugins/zeroh-roadmap/cli/commands/watch.mjs',
        'plugins/zeroh-roadmap/cli/commands/eval.mjs',
        'plugins/zeroh-roadmap/cli/commands/arc.mjs',
        'plugins/zeroh-roadmap/cli/commands/claim.mjs',
        'plugins/zeroh-roadmap/cli/commands/codex.mjs',
        'plugins/zeroh-roadmap/cli/commands/executor-disarm.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.mjs',
        'plugins/zeroh-roadmap/cli/commands/status.mjs',
        'plugins/zeroh-roadmap/cli/commands/config.mjs',
        'plugins/zeroh-roadmap/cli/commands/followups.mjs',
        'plugins/zeroh-roadmap/cli/commands/phase.mjs',
        'plugins/zeroh-roadmap/cli/audit-checks.mts',
        'plugins/zeroh-roadmap/hooks/executor-result-guard.mjs',
        'plugins/zeroh-roadmap/hooks/session-lane-check.mjs',
        'plugins/zeroh-roadmap/cli/testdata/eval-arc/build-fixture.mjs',
        'plugins/zeroh-roadmap/cli/testdata/arc-status-legacy.mjs',
      ],
      testMode: 'tdd',
      dependsOn: ['23.1'],
      interfaces: { consumes: ['roadmapRoot(dir) from 23.1', 'consumerSchemaPath(dir) from 23.1'], produces: [] },
      done: true,
      doneDate: '2026-09-02',
      decisionRef:
        'Two PRIME RULE 1 software-architect calls, both PROCEED_WITH_FIX, 2026-09-02. (1) The guard home anchor: the test-engineer required roadmap-root.mjs to carry a quoted roadmap/<member> path-form literal, which no correct implementation can satisfy (the module returns a ROOT and callers join members onto it), so it was replaceable only by a planted dead literal; ruled to replace it with a stronger behavioural anchor asserting every member is rebuildable from the module under BOTH layouts. (2) cli/testdata: ruled OUT of the scan rather than converted - arc-status-legacy.mjs is a frozen parity oracle whose independence is the mechanism (status.mjs:154 and its own :119 are the same site, so converting both would compare the resolver against itself), and build-fixture.mjs spells module-level paths it creates by cpSync, which honours no ROADMAP_ROOT and would make its rmSync omit-cases silently no-op. Both rulings confirmed acceptance criterion 1 is NOT narrowed: its three quoted mutations live outside cli/testdata and all three still behave exactly as specified.',
      transparencyReport: {
        whatWasDone:
          'Batch of four commits. (1/4) the scan tripwire, committed RED: it walks every non-test .mjs/.mts under cli/ and hooks/, flags the argv form and the path form plus a quoted docs/roadmap, and asserts roadmap-root.mjs is their ONLY home, behind a vacuity guard (>=30 sources, four known files by name). (2/4) twelve cli/lib modules; roadmapRootRel(dir) added for git pathspecs and repo-relative citations. (3/4) fifteen cli/commands; status and claim now default their root ARGUMENT through the resolver, audit and config read the schema seam through consumerSchemaPath, eval passes the resolved root into the scorer and proposer. (4/4) audit-checks.mts (registryPath derived from dirname(consumerSchemaPath(repo))), both mjs hooks, and the ruled cli/testdata exclusion with its proof test. The guard is GREEN at 23/23 and the scan now covers 65 shipped sources.',
        how:
          'The guard came first and RED, naming all 33 files, and that failure output was the conversion worklist. Mechanical join(X, roadmap, ...) -> join(roadmapRoot(X), ...) covered most sites; the rest needed real threading, because a literal with no directory in scope cannot be joined onto anything. eval-score and eval-propose take a rootRel argument for the provenance strings a sentinel cites, defaulted to ROOT_CANDIDATES[0] - the resolver own answer for an unmarked tree, not a second spelling of it - with the command layer passing the resolved root. slots takes the diff-path prefix and the vacuity-probe target the same way; phasescan and audit build git pathspecs from roadmapRootRel. The trace was NOT stamped with the root: it is validated against ArcTraceShape in the consumer schema, so a new field there would be a contract change this phase did not plan. Two amendments to the committed guard, both under architect ruling and both recorded in decisionRef: the unsatisfiable path-form home anchor was replaced by a per-member behavioural one, and cli/testdata was excluded with a four-assertion proof standing in place of the conversion. Guard mutation proof, all four run: a root literal re-added to derive.mjs -> RED, "1 file(s) under cli/ or hooks/ still spell it themselves: cli/lib/derive.mjs"; the walk directory list emptied -> the vacuity assertion REDs with "it enumerated 0 non-test files and did not see cli/lib/derive.mjs, cli/commands/status.mjs, hooks/session-lane-check.mjs, cli/audit-checks.mts"; the literal inside roadmap-root.mjs left in place -> GREEN, 23 pass 0 fail; and, for the new anchor, a trailing slash on roadmapRootRel -> RED at "the path form roadmap/backlog.ts must respell as roadmapRootRel(dir) + /backlog.ts". Scoped evidence: 518/519 on the cli/lib suites at 2/4 (the sole failure the still-RED tripwire), 627/627 on the commands suites at 3/4, 194/194 at 4/4 including status.parity.',
        compromises: 'None',
        skipped:
          'The plan step-4 clause "the two cli/testdata builders take the root from it" was NOT executed. Ruled out of scope by the second architect call (see decisionRef): converting arc-status-legacy.mjs would destroy the parity oracle independence that is the whole mechanism of status.parity.test.mjs, and build-fixture.mjs line 84 sits in a module-level FIXTURE_COMMITS with no dir in scope while its rmSync omit-cases would silently no-op if the resolver and cpSync ever disagreed. A four-assertion proof test replaces the conversion, so the exclusion cannot rot into an allow-list. The ruling also exposed a plan-authoring slip: arc-status-legacy.mjs is not a builder, it is a frozen oracle, and step 4 called it one.',
        hardcoded: 'None',
        limitations:
          'Files touched outside the planned files[]: cli/lib/landing.test.mjs (it imported the eval ARC_EVALS_DIR constant that became arcEvalsDir(toplevel)); cli/commands/result.mjs was not touched but is a consumerSchemaPath importer that keeps working through the tsx-bridge re-export. cli/testdata/arc-status-legacy.mjs was edited in its HEADER ONLY - the two comment lines added by ROADCODE 1655, which are outside the freeze (verified byte-identical against the pre-shim body) and whose claim that it was deleted with the shims had gone false. The default layout is the regression pin here: no test in this repo drives a docs/roadmap consumer through these sites, which is exactly what task 23.6 exists to add.',
      },
    },
    {
      id: '23.3',
      title: 'beacon-stamp.sh discovers the root the same way, fail-soft',
      problem:
        'beacon-stamp.sh:70 pins `registry="$main/roadmap/arcs/.building"`; a docs/roadmap consumer\'s executors would stamp beacons into a directory nothing reads, and the lane-liveness rows would read every arc as silent.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/hooks/lib/roadmap-root.sh',
          description:
            'New sourced helper `roadmap_root <dir>`: `$ROADMAP_ROOT` (absolute or dir-relative) wins; else the candidates `roadmap` then `docs/roadmap` carrying `roadmap.config.json` or `phases/`; both → one stderr line and exit 0 (hooks fail soft, never block a session); none → `<dir>/roadmap`. Same order and markers as roadmap-root.mjs — the mjs docblock names this file as its shell twin → verify: bash -c "grep -qF \'roadmap_root()\' plugins/zeroh-roadmap/hooks/lib/roadmap-root.sh && grep -qF \'roadmap-root.sh\' plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/hooks/beacon-stamp.sh',
          description:
            'Source the helper; `registry="$(roadmap_root "$main")/arcs/.building"`. hooks/beacon-stamp.test.mjs is NEW (the hook has executor-result-guard/heartbeat-stamp/fail-soft siblings but no suite of its own — the test-engineer writes it, both layouts): a beacon stamped in that layout lands under `<toplevel>/docs/roadmap/arcs/.building` and the default layout is byte-identical → verify: bash -c "! grep -qF \'registry=\\"$main/roadmap/arcs/.building\\"\' plugins/zeroh-roadmap/hooks/beacon-stamp.sh && cd plugins/zeroh-roadmap && capbuild node --test hooks/beacon-stamp.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'A beacon stamped from a docs/roadmap consumer lands under `<toplevel>/docs/roadmap/arcs/.building`; the default layout stamps exactly where it did; an ambiguous layout prints one line and exits 0',
      ],
      files: ['plugins/zeroh-roadmap/hooks/lib/roadmap-root.sh', 'plugins/zeroh-roadmap/hooks/beacon-stamp.sh', 'plugins/zeroh-roadmap/hooks/beacon-stamp.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-02',
      transparencyReport: {
        whatWasDone:
          'New hooks/lib/roadmap-root.sh defines roadmap_root <dir>: ROADMAP_ROOT wins (absolute as-is, relative against <dir>, never probed), else the candidates roadmap then docs/roadmap taking the first that carries roadmap.config.json or phases/, else <dir>/roadmap. beacon-stamp.sh sources it and builds registry from the resolved root instead of the pinned $main/roadmap/arcs/.building. hooks/beacon-stamp.test.mjs is new — the hook had no suite of its own.',
        how:
          'TDD: zeroh-roadmap:test-engineer wrote the 9 tests first against the contract only, driving the REAL hook via bash with the JSON payload on stdin and asserting on exit codes and files. RED was 5 pass / 4 fail — the four failures being the docs layout, the ambiguity refusal and both ROADMAP_ROOT forms; the five that passed are today behaviour and the fail-soft guarantees, kept deliberately as regression pins. GREEN is 9/9, and 134/134 across all four hook suites plus roadmap-root and liveness. The one difference in FORM from the mjs twin is the ambiguity path: the CLI throws, the hook returns non-zero after one stderr line and the caller maps that to a silent exit 0, because a beacon failure must never fail the commit that carried it. Neither twin guesses a root. The docblock in cli/lib/roadmap-root.mjs now names the shell twin, so a reader changing one is told about the other.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The candidate order and markers are stated TWICE — once in cli/lib/roadmap-root.mjs, once in the shell twin — because a PostToolUse hook that fires on every Bash call cannot afford to spawn node to ask. Both docblocks say so and point at each other, but nothing MECHANICALLY pins them together: a candidate added to ROOT_CANDIDATES without the same edit in roadmap-root.sh would leave hooks resolving a root the CLI does not. A cross-twin ratchet (parse the shell candidate list, compare with ROOT_CANDIDATES) is the honest fix and is not in this phase.',
      },
    },
    {
      id: '23.4',
      title: 'Templates, scaffold and init: schema under the root, relative imports, --root',
      problem:
        'templates/backlog.ts:42 and example.arc.ts:19 import `@/lib/roadmap/schema` (an alias zeroh\'s tsconfig.base.json lacks), registry.ts:49 defaults to cwd/roadmap/phases, and scaffold-roadmap.sh writes lib/roadmap/ at the toplevel — a new consumer cannot be scaffolded into docs/roadmap at all.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/scaffold-roadmap.sh',
          description:
            'Accept `--root <dir>` (default `roadmap`); write schema/registry/emit to `<root>/lib/` (the new-consumer seam 23.1 resolves first), ROADMAP.md/backlog.ts/phases/arcs under `<root>`; refuse (exit 1, named) when `<root>` already exists under a different candidate. `reviews/` and `scripts/` copies unchanged → verify: bash -c "grep -qF -- \'--root\' plugins/zeroh-roadmap/scripts/scaffold-roadmap.sh && ! grep -qF \'mkdir -p \\"$PROJECT_DIR/lib/roadmap\\"\' plugins/zeroh-roadmap/scripts/scaffold-roadmap.sh"',
        },
        {
          file: 'plugins/zeroh-roadmap/templates/backlog.ts',
          description:
            'Relative imports: backlog.ts `./lib/schema`, example.arc.ts `../lib/schema`; registry.ts default root = `process.env.ROADMAP_ROOT ?? first of [\'roadmap\', \'docs/roadmap\'] carrying phases/ ?? \'roadmap\'` then `/phases` (the resolver\'s order restated in the one file that cannot import it); emit.ts unchanged. Phase-file import convention for new consumers is `../lib/schema` (23.5 teaches it) → verify: bash -c "! grep -rqF \'@/lib/roadmap/schema\' plugins/zeroh-roadmap/templates && grep -qF \'docs/roadmap\' plugins/zeroh-roadmap/templates/registry.ts"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/init.mjs',
          description:
            '`roadmap init [--root <dir>]` forwards `--root` to the scaffold and writes the config under `roadmapRoot(toplevel)` after scaffolding (so `--root docs/roadmap` lands the config there); init.test.mjs gains the direction: init --root docs/roadmap in a tmp repo, then `roadmap phase validate` of a phase file written there (importing `../lib/schema` with NO tsconfig) exits 0 → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'docs/roadmap\' cli/commands/init.test.mjs && capbuild node --test cli/commands/init.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'init --root docs/roadmap on a bare repo yields `<toplevel>/docs/roadmap/{ROADMAP.md,backlog.ts,roadmap.config.json,phases/,arcs/}` plus `<root>/lib/schema.ts`; a phase file there validates through the tsx bridge with no tsconfig alias; default init is byte-identical to today except lib/ lives under roadmap/lib/ (the legacy toplevel seam stays recognized for existing consumers)',
      ],
      files: [
        'plugins/zeroh-roadmap/scripts/scaffold-roadmap.sh',
        'plugins/zeroh-roadmap/templates/backlog.ts',
        'plugins/zeroh-roadmap/templates/example.arc.ts',
        'plugins/zeroh-roadmap/templates/registry.ts',
        'plugins/zeroh-roadmap/cli/commands/init.mjs',
        'plugins/zeroh-roadmap/cli/commands/init.test.mjs',
      ],
      testMode: 'tdd',
      dependsOn: ['23.1'],
      interfaces: { consumes: ['roadmapRoot(dir) from 23.1'], produces: [] },
      done: true,
      doneDate: '2026-09-02',
      transparencyReport: {
        whatWasDone:
          'scaffold-roadmap.sh takes --root <dir> (default roadmap) and writes schema/registry/emit to <root>/lib/ plus ROADMAP.md, backlog.ts, phases/ and arcs/ under <root>; it REFUSES (exit 1, naming both) when the project already carries a marked root under the other candidate. templates/backlog.ts imports ./lib/schema and example.arc.ts ../lib/schema, so no tsconfig paths alias is required of a consumer; templates/registry.ts discovers its own root (ROADMAP_ROOT, else the first candidate carrying phases/, else the default). roadmap init [--root <dir>] forwards it and writes the config under roadmapRoot(toplevel), resolved AFTER scaffolding.',
        how:
          'TDD: zeroh-roadmap:test-engineer wrote 8 new tests plus three forced adjustments to existing ones, RED at 4 pass / 9 fail against the untouched tree. The load-bearing pair is 8 and 9: a phase file importing ../lib/schema validates through the tsx bridge in a repo with no alias, AND a phase file importing @/lib/roadmap/schema in that SAME repo does not — without the negative control the first would also pass in a repo that happened to have an alias configured. Test 10 is the regression guard that matters most: a repo carrying only the legacy lib/roadmap/schema.ts still validates, because every existing consumer is that repo. GREEN 13/13, and 58/58 across init, the fixture-consumer lifecycle, harness smoke, contract drift, emit-manifests and config; the tsx typed tier (scripts/schema.test.ts) passes with 0 failures. registry.ts is the ONE file that restates the resolver rules instead of importing them — it is consumer-side scaffolded code that cannot reach into the plugin — and its docblock says so. init resets the resolver memo after scaffolding, because a root resolved before the scaffold created it would send the config to the pre-scaffold answer.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'bin/roadmap.mjs\'s TREE entry for init was updated so --root appears in --help; it is outside the planned files[] and is one line of help text. The scaffold refusal probes the OTHER candidate only, not an arbitrary --root value: `--root ops/roadmap` into a repo that already has roadmap/ is allowed, and that repo is then unresolvable by discovery without ROADMAP_ROOT. Accepting an off-candidate root at all is what the ROADMAP_ROOT override exists for, so this is a real edge the resolver already answers, but the scaffold does not warn about it. templates/registry.ts now restates the candidate order and the phases/ marker; nothing mechanically pins that restatement to ROOT_CANDIDATES — the same twin-drift limitation 23.3 records for the shell helper, now with a third copy.',
      },
    },
    {
      id: '23.5',
      title: 'One layout paragraph; every skill, agent and doc cites it instead of a path',
      problem:
        '26 prose homes (skills, agents, templates/ROADMAP.md, README, CLAUDE.md) state `roadmap/phases`, `roadmap/backlog.ts`, `roadmap/arcs` or `lib/roadmap/schema.ts` as facts; an executor in a docs/roadmap consumer would read paths that do not exist there and a planner would write the `@/lib/roadmap/schema` import into a repo with no alias.',
      batchMode: true,
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md',
          description:
            'ONE "Layout" paragraph here (the always-active router): the root is `roadmap/` or `docs/roadmap/` (first with a marker; `ROADMAP_ROOT` overrides; both = refused), records live under it, the schema at `<root>/lib/schema.ts` (the legacy `<toplevel>/lib/roadmap/schema.ts` seam still recognized), new phase files import `../lib/schema`. README.md "What gets created" table and CLAUDE.md say the same by citation. DIET: the paragraph is funded by trimming the router\'s own restated path list → verify: bash -c "grep -qF \'ROADMAP_ROOT\' plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md && grep -qF \'docs/roadmap\' plugins/zeroh-roadmap/README.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/plan-phase/references/phase-file-contract.md',
          description:
            'Planning homes (plan-phase SKILL + contract + closure-checklist, plan-arc SKILL + design-gate + arc-integrity, review-phase SKILL + queue-placement): a path claim becomes "<root>/phases/…" with one cite of the router paragraph; arc-integrity.md:16\'s `@/lib/roadmap/schema` example becomes `../lib/schema`. Grep-bounded: `roadmap/phases|roadmap/backlog|roadmap/arcs|lib/roadmap` → 0 in these files except commit-grammar strings (`docs(roadmap):` is a scope token, untouched) → verify: bash -c "test \\"$(grep -rE \'roadmap/(phases|backlog|arcs)|lib/roadmap\' plugins/zeroh-roadmap/skills/plan-phase plugins/zeroh-roadmap/skills/plan-arc plugins/zeroh-roadmap/skills/review-phase | wc -l)\\" = \\"0\\""',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
          description:
            'Execution homes (do-phase, do-arc, arc-sweep, release-sweep, handoff + evals.json, full-code-review + remediation-phase, both agent cards, templates/ROADMAP.md): same substitution and cite — except the resolver’s own module names (`lib/roadmap-root…`), the `<toplevel>/`-qualified LEGACY seam inside the rule’s own home (references/layout.md), and eval-harness `files` inputs (skills/handoff/evals/evals.json). VERIFY AMENDED 2026-09-02 under the operator re-ratchet ruling + a software-architect PROCEED_WITH_FIX: the original grep over-matched three things that are not root-path facts, so each carve-out is a TOKEN substitution (never a dropped line) backed by an anchor — the home still carries the seam, the router still cites the home, both resolver files exist, and every evals.json `files` entry resolves on disk while no prose field states a root path. Then the measures: `roadmap measure --flow do-arc --assert 13339` exits 0 (budget re-ratcheted 13257→13339 by operator ruling 2026-09-02); plan-arc and do-phase totals recorded before/after in the transparencyReport, any growth DIET-funded in-file with a ledger row → verify: bash -c "test \\"$(grep -rE \'roadmap/(phases|backlog|arcs)|lib/roadmap\' plugins/zeroh-roadmap/skills plugins/zeroh-roadmap/agents plugins/zeroh-roadmap/templates/ROADMAP.md | grep -vF \'handoff/evals/evals.json:\' | sed -e \'s#lib/roadmap-root#RESOLVER-MODULE#g\' -e \'s#<toplevel>/lib/roadmap/schema.ts#LEGACY-SEAM#g\' | grep -cE \'roadmap/(phases|backlog|arcs)|lib/roadmap\')\\" = \\"0\\" && grep -qF \'<toplevel>/lib/roadmap/schema.ts\' plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/layout.md && grep -qF \'references/layout.md\' plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md && test -f plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs && test -f plugins/zeroh-roadmap/hooks/lib/roadmap-root.sh && node -e \'const fs=require(\\"fs\\");const e=JSON.parse(fs.readFileSync(\\"plugins/zeroh-roadmap/skills/handoff/evals/evals.json\\",\\"utf8\\"));const re=/roadmap\\/(phases|backlog|arcs)|lib\\/roadmap/;const inputs=e.flatMap(s=>s.files);process.exit(inputs.length>0 && inputs.every(f=>fs.existsSync(f)) && e.every(s=>!re.test([s.query,...s.expected_behavior].join(\\" \\")))?0:1)\' && cd plugins/zeroh-roadmap && node bin/roadmap.mjs measure --flow do-arc --assert 13339 >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'One paragraph owns the layout rule; no skill, agent or template restates a root path as a fact; the do-arc measure assert holds and the other two flow totals are recorded; every changed skill still passes its own evals.json where one exists',
      ],
      files: [
        'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md',
        'plugins/zeroh-roadmap/README.md',
        'plugins/zeroh-roadmap/CLAUDE.md',
        'plugins/zeroh-roadmap/skills/plan-phase/SKILL.md',
        'plugins/zeroh-roadmap/skills/plan-phase/references/phase-file-contract.md',
        'plugins/zeroh-roadmap/skills/plan-phase/references/closure-checklist.md',
        'plugins/zeroh-roadmap/skills/plan-arc/SKILL.md',
        'plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md',
        'plugins/zeroh-roadmap/skills/plan-arc/references/arc-integrity.md',
        'plugins/zeroh-roadmap/skills/review-phase/SKILL.md',
        'plugins/zeroh-roadmap/skills/review-phase/references/queue-placement.md',
        'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
        'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
        'plugins/zeroh-roadmap/skills/arc-sweep/SKILL.md',
        'plugins/zeroh-roadmap/skills/release-sweep/SKILL.md',
        'plugins/zeroh-roadmap/skills/handoff/SKILL.md',
        'plugins/zeroh-roadmap/skills/handoff/evals/evals.json',
        'plugins/zeroh-roadmap/skills/full-code-review/SKILL.md',
        'plugins/zeroh-roadmap/skills/full-code-review/references/remediation-phase.md',
        'plugins/zeroh-roadmap/agents/phase-executor.md',
        'plugins/zeroh-roadmap/agents/software-architect.md',
        'plugins/zeroh-roadmap/templates/ROADMAP.md',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
      ],
      testMode: 'none',
      done: true,
      doneDate: '2026-09-02',
      decisionRef:
        'OPERATOR RULING 2026-09-02 (verbatim): "Re-ratchet the budget to 13,339." Option 1 of this task\'s escalation and the software-architect\'s recommendation — a one-off that treats the router\'s Layout rule as a CORRECTNESS fix, not accretion (without it every docs/roadmap consumer reads paths that do not exist there). Applied as the escalation enumerated it, in SIX artifacts, not one. ' +
        'Plus one PRIME RULE 1 software-architect call, PROCEED_WITH_FIX, 2026-09-02: the plan\'s step-3 grep proxy returned 7 hits in two files it could not have anticipated, and every available conversion would have made the tree WORSE — renaming cli/lib/roadmap-root.mjs is false, dropping <toplevel>/lib/roadmap/schema.ts deletes the operative fact 23.1 shipped ("a missing seam is named with BOTH paths"), and rewriting skills/handoff/evals/evals.json\'s `files` inputs to <root>/… hands the eval harness paths that do not resolve, breaking clause 4 of this task\'s OWN criterion. Ruled: keep the scan universal, carve out exactly the non-root-path TOKENS (never whole files where a token will do), and back each carve-out with an anchor — the 23.2 pattern applied to prose. The architect confirmed explicitly that criterion 1 is NOT narrowed: the replacement proves strictly more, since each carve-out gains an assertion the original grep lacked.',
      transparencyReport: {
        whatWasDone:
          'Four commits. The first three (10f315b, b69cb84, 4021a3c) put ONE Layout rule in the always-active router — the root is DISCOVERED (roadmap/ or docs/roadmap/, ROADMAP_ROOT overrides, both = refused), write <root>/…, `roadmap init [--root <dir>]` is the only sanctioned init — decomposed its mechanics into the on-demand skills/using-zeroh-roadmap/references/layout.md, and converted every path claim in the planning homes (plan-phase + contract + closure-checklist, plan-arc + design-gate + arc-integrity, review-phase + queue-placement) and the execution homes (do-phase, do-arc, arc-sweep, release-sweep, handoff, full-code-review + remediation-phase, eval-arc, three agent cards, templates/ROADMAP.md, README.md, CLAUDE.md) to a cite of that rule. This fourth commit lands the operator ruling in six artifacts: (1) PROTOCOL_LOAD_BUDGET_TOKENS 13257 -> 13339 with the ruling and date in its docblock; (2) the pinned literal at cli/lib/eval-propose.test.mjs:368; (3) the four budget-coupled fixtures re-based by +82 (ALPHA 13258->13340, BRAVO 13957->14039, CHARLIE 15757->15839, DELTA 13257->13339) plus both load-fixture.mjs docblock lines, following the 2026-08-24 +757 precedent\'s shape so every boundary property survives; (4) this plan\'s own `--assert 13257` -> 13339; (5) a DIET-LEDGER.md ruling block plus the header budget line, which measure-budget.mjs\'s docblock names as a reader and which would otherwise have half-landed; (6) the measurement gap: skills/using-zeroh-roadmap/references/layout.md is now cited from plan-phase, plan-arc, review-phase and phase-file-contract, and writing a phase file\'s import IS a plan-arc act, so it gained a cli/measure-manifest.json plan-arc row. The repayment lane also landed: the <root>/… cite sentence was restated VERBATIM in four planning files and is now one short imperative form (232 B -> 164 B x4).',
        how:
          'MEASURED, before (pre-23.5) -> after: do-arc 13,256 -> 13,339 (+83), `roadmap measure --flow do-arc --assert 13339` exits 0 sitting EXACTLY on the ceiling; do-phase 5,990 -> 5,989 (-1); plan-arc 16,335 -> 16,452 over its five previously-metered files, and 17,059 with layout.md metered honestly. The budget moves +82 and the FLOW moves +83 because the tree sat one token under its ceiling before this phase — both numbers are real and they are not the same number, so the fixtures take +82 (they are budget-coupled) and the ledger records both. The repayment lane is recorded with its LIMIT: none of the four folded files is in the do-arc flow, so no amount of folding there could ever have funded the +82 — which is part of why the ruling was the right instrument rather than a diet. plan-arc carries no assert; disclosing 17,059 is exactly what the phase-2422 metering error (a genuine conditional load missing from the manifest, so the no-growth assert passed over unmetered load) exists to prevent repeating. VERIFIED: all three step verifies exit 0 (the third re-extracted from the PARSED phase file and executed, so the stored string is proven to round-trip, not just the one I typed); cli/lib/eval-propose.test.mjs + cli/commands/measure.test.mjs + cli/commands/eval.test.mjs 151/151; `roadmap audit` finds 0 CRITICAL/HIGH/MEDIUM (its 1 LOW is the pre-existing stray rebuild/roadcode worktree, untouched by this phase); `roadmap phase validate 23` OK. The amended verify was mutation-checked in four directions, quoted: planting "The plan lives at roadmap/phases/phase-N.phase.ts." into the already-converted skills/do-phase/SKILL.md -> RED (exit 1); planting "Writes roadmap/phases/phase-9.phase.ts" into an evals.json expected_behavior (a PROSE field, not a `files` input) -> RED (exit 1) via the node proof; replacing layout.md\'s `<toplevel>/lib/roadmap/schema.ts` with the words "the legacy seam" -> RED (exit 1) on the home-carries-the-seam anchor; and, as the honest negative, lowering PROTOCOL_LOAD_BUDGET_TOKENS back to 13257 leaves the verify GREEN, because the verify pins the FLOW against a literal while the CONSTANT is pinned by cli/commands/measure.test.mjs over the real tree — two halves, both present, neither redundant.',
        compromises:
          'Two plan edits, both authorized and both recorded rather than silent. (1) The `--assert 13257` literal in this task\'s step 3 became 13339 — a plan edit made under the operator ruling, which is the artifact the escalation itself enumerated as item 4. (2) The step-3 grep proxy was AMENDED under the architect\'s PROCEED_WITH_FIX (see decisionRef) after it returned 7 hits in two files: skills/using-zeroh-roadmap/references/layout.md (which 23.5 itself created, and whose four hits are the plugin\'s own resolver filenames matching only on the substring `lib/roadmap-root`, plus the deliberately non-root `<toplevel>/`-qualified legacy seam) and skills/handoff/evals/evals.json. Each carve-out is a TOKEN substitution, never a dropped line, so a line that names the resolver AND states a root path as a fact still reds; and each is backed by an anchor the original grep lacked.',
        skipped:
          'skills/handoff/evals/evals.json is listed in files[] and was left BYTE-UNCHANGED. Its three matches are inside eval-scenario `files` arrays — `claude plugin eval` harness INPUTS that are seeded into the scenario context and that resolve to real files at those exact paths in this repo. Converting them to `<root>/phases/…` would hand the harness paths that do not exist, failing clause 4 of this task\'s own acceptance criterion ("every changed skill still passes its own evals.json"). Ruled fixture data by the architect, on the same reasoning that ruled cli/testdata out of 23.2\'s scan: literalness IS the mechanism. A three-assertion proof stands in place of the conversion, inside the verify itself, so the exemption cannot rot into an allow-list: every `files` entry must exist on disk, the exemption must be non-empty, and no `query` or `expected_behavior` prose field may state a root path. The handoff eval SUITE was not EXECUTED — this repo binds no eval runner in its gateCommands, so the criterion\'s clause 4 is discharged structurally (inputs resolve, prose fields clean, no expected_behavior text changed by this phase) rather than by a run; recorded here as evidence of a lesser kind, not as a pass.',
        hardcoded: 'None',
        limitations:
          'The do-arc flow now sits at 13,339/13,339 — ZERO headroom, one byte from a silent assert breach, the same standing condition the tree has carried since 2026-08-24 and which phase 3 already had to take a PRIME RULE 1 stop over. The next prose addition to any of those eight files is a diet or an escalation, by construction. Surfaced and deliberately NOT acted on: skills/using-zeroh-roadmap/SKILL.md is ALWAYS ACTIVE and therefore loads in a planning session too, yet it appears only in the do-arc flow\'s manifest list; metering it into plan-arc as well would be honest, but that is a manifest-scoping decision the operator\'s ruling did not cover and it would change no assert. Recorded in DIET-LEDGER.md for the next diet lane. Files touched outside the planned files[]: cli/lib/measure-budget.mjs, cli/lib/eval-propose.test.mjs, cli/measure-manifest.json and the five cli/testdata/eval-proposals artifacts — all six ruling artifacts by name, none a scope change; and skills/eval-arc/SKILL.md, skills/full-code-review/references/{audit-dimensions,report-and-record}.md and agents/arc-eval-judge.md, which carried the same path claims the criterion forbids and which the plan\'s files[] simply under-enumerated. templates/registry.ts, hooks/lib/roadmap-root.sh and the router now make THREE prose/code restatements of the candidate order with nothing mechanically pinning them together — the twin-drift limitation 23.3 and 23.4 each recorded, now with layout.md as a fourth statement of the same rule; the cross-twin ratchet remains the honest fix and remains outside this phase.',
      },
    },
    {
      id: '23.6',
      title: 'End to end: a docs/roadmap consumer through status, validate, audit, gate plan, claim',
      problem:
        'Unit routing proves each site individually; nothing proves the whole CLI agrees on one root for a consumer laid out the zeroh way, nor that a both-candidates repo is refused at every door instead of read two ways.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/test/fixture-consumer/harness.mjs',
          description:
            'The harness builds a consumer under a `layout` option: `\'toplevel\'` (today, unchanged default) or `\'docs\'` (`<toplevel>/docs/roadmap/{roadmap.config.json,backlog.ts,phases/,arcs/}` plus `<root>/lib/schema.ts` re-exporting the plugin template; no toplevel lib/, no tsconfig paths) → verify: bash -c "grep -qF \\"layout\\" plugins/zeroh-roadmap/test/fixture-consumer/harness.mjs && grep -qF \'docs/roadmap\' plugins/zeroh-roadmap/test/fixture-consumer/harness.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/test/fixture-consumer/layout-docs.test.mjs',
          description:
            'Directions over the docs layout: `roadmap status` (no argument) lists the phase; `phase validate` exits 0 for a phase importing `../lib/schema`; `audit` is CLEAN and check 16 reads `<root>/lib/schema.ts` in that layout (a drifted re-export there fires HIGH naming that path); `gate plan N` resolves; `claim` reserves the next number; `ROADMAP_ROOT=<abs>` pointed at a third directory wins over both candidates; a repo carrying BOTH roadmap/ and docs/roadmap/ is refused by status, validate and audit with the same named message → verify: bash -c "cd plugins/zeroh-roadmap && capbuild node --test test/fixture-consumer/layout-docs.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'All seven directions green against the real bin/roadmap.mjs; the toplevel-layout fixture tests are untouched and green; the ambiguity refusal is one message at every door (observed: status, phase validate, audit)',
      ],
      files: ['plugins/zeroh-roadmap/test/fixture-consumer/harness.mjs', 'plugins/zeroh-roadmap/test/fixture-consumer/layout-docs.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['23.1', '23.2', '23.3', '23.4'],
      interfaces: { consumes: ['roadmapRoot(dir) from 23.1', 'scaffold --root from 23.4'], produces: [] },
      done: true,
      doneDate: '2026-09-02',
      transparencyReport: {
        whatWasDone:
          'test/fixture-consumer/harness.mjs takes an `opts.layout` — \'toplevel\' (the unchanged default every sibling suite gets), \'docs\' (<repo>/docs/roadmap/{roadmap.config.json,phases/,arcs/} plus the ROOT-FIRST seam <root>/lib/schema.ts vendored VERBATIM from templates/schema.ts, and NO <repo>/lib/ and no tsconfig at all) and \'both\' (both candidates MARKED, the ambiguity fixture). The layout is remembered per repo, so roadmapDir(root), writePhaseFile, writeArcFile, writePhaseRaw, makeIsolatedArc\'s .building registry and definePhaseSrc\'s import specifier all read it back instead of being handed it; roadmapDir THROWS under \'both\' rather than pick one, because that fixture exists precisely to prove two marked roots have no single answer. runCli defaults ROADMAP_CONFIG only for \'toplevel\' (it WINS over discovery in loadConfig, so defaulting it in a docs fixture would test the harness instead of the resolver) and gained a `cwd` option. test/fixture-consumer/layout-docs.test.mjs is new: eight directions, 10 tests, driving the REAL bin/roadmap.mjs. THREE production fixes fell out of it, each pinned by a direction: (1) bin/roadmap.mjs now treats RoadmapRootError like ConfigError — an ambiguous root reached through status, audit, claim or gate printed its message AND a full stack trace, which is a crash, not the refusal the criterion demands; (2) cli/commands/claim.mjs called an UNIMPORTED gitToplevel inside a bare try/catch, so the ReferenceError was swallowed, the toplevel branch was DEAD, and a flagless `roadmap claim` from any subdirectory resolved <cwd>/roadmap; (3) that same swallowing catch — duplicated verbatim in status.mjs and claim.mjs — also swallowed the AMBIGUITY refusal and re-resolved against the cwd, inventing a root in a repo the resolver had just refused. Both copies are replaced by one defaultRoadmapRoot(cwd) in cli/lib/roadmap-root.mjs that falls back ONLY when the tree is not a git repo.',
        how:
          'TDD: zeroh-roadmap:test-engineer wrote layout-docs.test.mjs first, from the acceptance criterion and the harness contract only, and it was RED at 0 pass / 9 fail — seven on `typeof harness.roadmapDir === undefined`, two on makeFixtureRepo silently ignoring `layout: \'both\'`. It reaches the new surface through a NAMESPACE import on purpose: a named import of a not-yet-existing export fails the module link and would have collapsed eight independent directions into one unreadable error. After the harness landed, 7/9 passed and the two remaining failures were both real: D3a red because the suite\'s own fullPhase() omitted `kind` (a fixture defect — the audit was demonstrably reading the docs root, its finding LOCATED at docs/roadmap/phases/phase-9604.phase.ts), and D7 red on the stack trace, which is fix (1). GREEN is 10/10, 86/86 across the whole fixture-consumer tier (the nine toplevel-layout suites untouched and green — the regression pin), and 280/280 across roadmap-root, status, status.parity, claim, init, audit, followups and gate. The 23.2 scan tripwire stays green at 23/23. '
          + 'D8 is MINE, not the test-engineer\'s, and is recorded as such: fixes (2) and (3) are invisible from the repo root (cwd == toplevel makes the wrong branch give the right answer), so without it I would have shipped two changes nothing pins. It drives status and claim from <repo>/src/spine in both a docs consumer and an ambiguous one. '
          + 'MUTATION PROOF, five drives, each mutated → run → quoted → reverted from a pristine copy taken first. PLANTED VIOLATION 1, the bin RoadmapRootError arm reverted → RED 8 pass / 1 fail: "`roadmap status` must refuse with a MESSAGE, not a stack: roadmap: RoadmapRootError: … at probe (…/cli/lib/roadmap-root.mjs:92:11)". PLANTED VIOLATION 2, defaultRoadmapRoot restored to the swallowing form → RED 9 pass / 1 fail: "the subdirectory refusal still names BOTH roots: arc-status: no roadmap at /tmp/zr-fx-Ar9ypu/src/spine/roadmap (pass the roadmap root as arg)" — the silent pick, caught. PLANTED VIOLATION 3, claim.mjs\'s original dead branch restored → RED 9 pass / 1 fail: "claim from a subdirectory must resolve the toplevel\'s docs root; stderr: roadmap claim: no such dir: /tmp/zr-fx-6yJVUj/src/spine/roadmap/phases". ANCHOR DRIFT, LAYOUT_ROOTS.docs renamed to docs/roadmaps → RED LOUDLY at 2 pass / 8 fail naming what it could not find: "layout \'docs\' must root the roadmap at <repo>/docs/roadmap + actual \'/tmp/zr-fx-R5VWsF/docs/roadmaps\'" — never a silent pass. DECOY, the nearest LEGAL pattern: an UNMARKED <repo>/roadmap/ prose folder (roadmap/notes/README.md, neither marker) beside a marked docs root → GREEN, "exit: 0 | rows: [\"DECOYFX\"] | stderr: (empty)" — a same-named directory is not a root and must not cry wolf.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Files touched outside the planned files[], all three forced by directions the plan\'s own criterion demands and none a scope change: bin/roadmap.mjs (the RoadmapRootError arm — "one message at every door" is unreachable while the dispatcher prints a stack), cli/lib/roadmap-root.mjs (the shared defaultRoadmapRoot) and cli/commands/{status,claim}.mjs (both deleting their local copy of it). The suite\'s own fullPhase() also gained `kind: \'logic\'`, a fixture correction. Under layout \'both\' the harness vendors ONE schema seam, the toplevel one: every door refuses before it reaches a seam, so a second copy would be scaffolding nothing reads — if a later direction drives an ambiguous repo PAST the refusal (with ROADMAP_ROOT), it must vendor the seam that override needs. D6 already does exactly that by hand for its third root. The docs fixture\'s registry stub now also exports crossValidate and DUPLICATE_PHASE_NUMBER_PREFIX because cli/audit-checks.mts destructures them; the toplevel stub had shipped without crossValidate since audit-checks gained it, so `roadmap audit` over ANY fixture consumer was exiting 1 with "crossValidate is not a function" and no suite noticed — this task is the first to run audit against a fixture at all. The three flow measures are unaffected (no model-loaded file changed).',
      },
    },
  ],
  notes:
    'interview: conducted in-session 2026-09-02 — scope ruled by the owner: two sibling homes under docs/ (docs/superpowers/ stays superpowers\' own, untouched; docs/roadmap/ is the roadmap\'s), discovery rather than a config key (the config lives inside the root it would name), default layout unchanged for every existing consumer. Technical decisions made here, not deferred: candidate order roadmap → docs/roadmap; markers = roadmap.config.json or phases/; ambiguity is a refusal, never a silent pick; schema seam root-first then legacy; new consumers import the schema relatively so no tsconfig alias is required (zeroh\'s tsconfig.base.json has none). ' +
    'userFacing false: plugin/CLI internals, no product surface, no flag. testScope/reviewScope undeclared (diff-derived; 23.2 and 23.5 are batchMode by file count, mechanical substitutions under a guard). Version bump to 0.36.0 is the next release act, not a task here. ' +
    'Out of scope, recorded: migrating THIS repo from lib/roadmap to roadmap/lib (legacy seam stays recognized; a later chore); zeroh-side adoption (un-ignore docs/superpowers, add tsx+zod devDeps at the workspace root, map gateCommands to Nx targets) belongs to the zeroh repo, not the plugin; scripts/migrate/audit.ts and scripts/debt-census.mts keep their literals (migration/estate tooling run against this repo\'s legacy layout, outside the guard\'s scan scope by design). ' +
    'Verify rehearsal attestation: assumption probes executed 2026-09-02 at plan time — ROADMAP_ROOT 0 files; config.mjs join literal present; tsx-bridge join literal present; both template alias imports present; beacon registry literal present (all exit 0). Step verifies red-now via their grep halves (no roadmap-root.mjs, no --root in scaffold, alias imports present, registry literal present, path claims present in skills); runner clauses inherit polarity from the grep representatives. Mode A review EXECUTED 2026-09-02 (claude-fable-5-1, standalone inline): READY after two [FIXED] repairs — status.mjs anchor trued 346→347; the consumerSchemaPath importer list completed (gate, eval, result, eval-collect, landing). Ratified: batchMode on 23.2/23.5 (mechanical substitutions under a guard), testMode none on 23.5 (prose), userFacing false. Placement: HIGH with no deps ahead of the two LOW entries → 1 of 3.',
})
