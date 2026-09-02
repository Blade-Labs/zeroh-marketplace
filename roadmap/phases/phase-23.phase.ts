import { definePhase } from '@/lib/roadmap/schema'

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
  status: 'in-progress',
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
      done: false,
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
      done: false,
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
            'Execution homes (do-phase, do-arc, arc-sweep, release-sweep, handoff + evals.json, full-code-review + remediation-phase, both agent cards, templates/ROADMAP.md): same substitution and cite. Then the measures: `roadmap measure --flow do-arc --assert 13257` exits 0; plan-arc and do-phase totals recorded before/after in the transparencyReport, any growth DIET-funded in-file with a ledger row → verify: bash -c "test \\"$(grep -rE \'roadmap/(phases|backlog|arcs)|lib/roadmap\' plugins/zeroh-roadmap/skills plugins/zeroh-roadmap/agents plugins/zeroh-roadmap/templates/ROADMAP.md | wc -l)\\" = \\"0\\" && cd plugins/zeroh-roadmap && node bin/roadmap.mjs measure --flow do-arc --assert 13257 >/dev/null 2>&1"',
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
      done: false,
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
      done: false,
    },
  ],
  notes:
    'interview: conducted in-session 2026-09-02 — scope ruled by the owner: two sibling homes under docs/ (docs/superpowers/ stays superpowers\' own, untouched; docs/roadmap/ is the roadmap\'s), discovery rather than a config key (the config lives inside the root it would name), default layout unchanged for every existing consumer. Technical decisions made here, not deferred: candidate order roadmap → docs/roadmap; markers = roadmap.config.json or phases/; ambiguity is a refusal, never a silent pick; schema seam root-first then legacy; new consumers import the schema relatively so no tsconfig alias is required (zeroh\'s tsconfig.base.json has none). ' +
    'userFacing false: plugin/CLI internals, no product surface, no flag. testScope/reviewScope undeclared (diff-derived; 23.2 and 23.5 are batchMode by file count, mechanical substitutions under a guard). Version bump to 0.36.0 is the next release act, not a task here. ' +
    'Out of scope, recorded: migrating THIS repo from lib/roadmap to roadmap/lib (legacy seam stays recognized; a later chore); zeroh-side adoption (un-ignore docs/superpowers, add tsx+zod devDeps at the workspace root, map gateCommands to Nx targets) belongs to the zeroh repo, not the plugin; scripts/migrate/audit.ts and scripts/debt-census.mts keep their literals (migration/estate tooling run against this repo\'s legacy layout, outside the guard\'s scan scope by design). ' +
    'Verify rehearsal attestation: assumption probes executed 2026-09-02 at plan time — ROADMAP_ROOT 0 files; config.mjs join literal present; tsx-bridge join literal present; both template alias imports present; beacon registry literal present (all exit 0). Step verifies red-now via their grep halves (no roadmap-root.mjs, no --root in scaffold, alias imports present, registry literal present, path claims present in skills); runner clauses inherit polarity from the grep representatives. Mode A review EXECUTED 2026-09-02 (claude-fable-5-1, standalone inline): READY after two [FIXED] repairs — status.mjs anchor trued 346→347; the consumerSchemaPath importer list completed (gate, eval, result, eval-collect, landing). Ratified: batchMode on 23.2/23.5 (mechanical substitutions under a guard), testMode none on 23.5 (prose), userFacing false. Placement: HIGH with no deps ahead of the two LOW entries → 1 of 3.',
})
