import { definePhase } from '../lib/schema'

/**
 * MINESWEEP plane 1 — codex lane bootstrap + envelope hardening.
 *
 * The lane's operational record is the weak spot, not its judgment: it cannot bootstrap a
 * pnpm consumer (`npm ci` hardcoded — atlas phase-25 "plugin fix owed upstream in
 * zeroh-marketplace" verbatim; mudarabah2 HANDOFF.md same), both azure lane reports hit
 * `roadmap` exit-127 (not on PATH), a plan lane that authored a non-entity would be caught
 * only by a human reading CODEX-PLAN.md, and `codex plan --arc` dies with a raw stack
 * trace that never mentions --arc (probe 2026-08-31, observed exit 1 + loader traceback).
 * Evidence: roadmap/arc-prompts/MINESWEEP-execution-prompt.md §codex.
 *
 * ## Hypotheses (why delegated runs die or mislead)
 * 1. CONFIRMED — the launcher assumes an npm world and a PATH-visible CLI: ensureWorktree
 *    spawns `npm ci` unconditionally (codex.mjs, no lockfile inspection — probe:
 *    grep pnpm-lock.yaml = 0 hits) and no envelope names an absolute CLI path (azure
 *    2422/2423 CODEX-REPORT deviations: "Bare `roadmap` was absent from PATH").
 * 2. REFUTED — "codex misplans": both recorded plan-lane runs authored real entities
 *    (atlas phase-22 400-line file, azure phase-2186); the arc's rejectedAlternatives
 *    records this, and the post-run validation here is a guard, not a distrust verdict.
 * 3. NOT TESTED — model-side quota behavior (9/9 atlas deaths): out of plugin control;
 *    mitigated by phase 14's next-step hints + the journalled RESUME RULE.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 15,
  name: 'Codex lane hardening: lockfile-keyed bootstrap, absolute CLI + grammar in envelopes, plan post-run validation, plan --arc refusal',
  status: 'done',
  completedDate: '2026-09-01',
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1515,
      total: 1515,
      notes:
        'Authoritative full gate: roadmap/.gate/15/run-000017-2026-09-01T11-59Z — GREEN, 1,515/1,515, on the tree REBASED onto the integration ref (phases 14 and 17 landed underneath). Two earlier RED runs are superseded and neither was a defect in this phase: the first measured a half-rebased tree (the rebase had stalled on a conflict), and both inherited the box\'s ambient capacity — `arc next` correctly answers blocked once executors busy >= maxExecutors, so the fixture tests asserting run-phase red on a busy host (24/26 unpinned vs 26/26 with the capacity seam pinned through CAPBUILD_PASS_ENV, same tree). lint/types/build/integration declared-none; lint-diff and history-comments exit 0.',
    },
    integrationTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — the wired subprocess suites in the unit tier drive the real CLI against tmp git repos and real worktrees.',
    },
    e2eTests: { passed: 0, total: 0, notes: 'declared-none in gateCommands — no rendered surface.' },
    build: 'clean',
  },
  gateRounds: [
    {
      round: 0,
      agent: 'quality-pass',
      verdict: 'findings-fixed',
      summary:
        'Envelope-overhead budget breached by the new CLI-path and commit-grammar lines, plus stale historical comments; closed by compacting envelope restatement rather than deleting rules (d28de84, e7de5a2).',
    },
    {
      round: 1,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'SUBSTITUTED reviewer (claude-fable-5 hit its limit; ran on claude-opus-5 at unreduced rigor). Eight findings, one HIGH: the envelope ratchet was green in the lane and would red ON MERGE, because the integration ref had advanced underneath it. Also: every non-zero validator exit read as a bad authored entity when exit 1 means toolchain-missing; the plan --arc refusal sat below a throw that still printed the traceback it replaces; the remedy named a bare `roadmap` in the very release that teaches it may be absent from PATH; the installer precedence reason reached no operator; validation.error was dropped; the post-creation refusal had no test (8b167d0).',
    },
  ],
  metrics: {
    commits: 9,
    linesAdded: 1309,
    linesRemoved: 34,
    filesChanged: 7,
    testsAtStart: 1485,
    testsAtEnd: 1515,
    testsAdded: 30,
    startedAt: '2026-08-31T22:10:36.000Z',
    completedAt: '2026-09-01T11:59:37.000Z',
    haltCount: 1,
  },
  executionResult: {
    phase: 15,
    status: 'done',
    driver: { model: 'gpt-5.6-sol', lane: 'codex' },
    roles: [
      { role: 'quality-pass', model: 'claude-opus-5', via: 'child-cli' },
      {
        role: 'code-reviewer',
        model: 'claude-opus-5',
        via: 'child-cli',
        substituted: { from: 'claude-fable-5', to: 'claude-opus-5', reason: 'unavailable: the claude-fable-5 firing exited with "You have reached your Fable 5 limit" before reviewing — re-run at UNREDUCED rigor on claude-opus-5' },
      },
    ],
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      'The lane BLOCKED at its correctness round rather than self-judging: its configured code-reviewer resolved to claude-fable-5 and that firing died on its model limit. The supervising session ran the same role on claude-opus-5 at unreduced rigor and recorded the substitution — no round was skipped and none was filled by the driver itself.',
      'The reviewer HIGH would have escaped a lane-local gate entirely: the envelope-overhead ratchet was green in the lane and red ON MERGE, because the integration ref advanced underneath it. Fixed by deleting envelope restatement (never a rule); two assertions pinned wording the cuts touched, and both rules survive relocated into the bullet that owns them.',
      'Two RED gates preceded the green one and NEITHER was a defect in this phase: one ran against a half-rebased tree after the rebase stalled on a conflict, and both inherited ambient box capacity — `arc next` answers blocked once executors busy >= maxExecutors, so fixture tests asserting run-phase red on a busy host. Proven, not assumed: 24/26 unpinned vs 26/26 with the capacity seam pinned, same tree. The pin only lands through CAPBUILD_PASS_ENV, because capbuild runs a sanitized unit that strips the variable.',
      'The rebase onto the landed integration ref took three conflicts, each resolved on its merits: lessons.jsonl is append-only so both sides kept (deduped); the envelope docblock had been compacted independently by phase 17, so both meanings were merged; and the prompt bullets took 17\'s landed wording, with all three of this phase\'s semantic fixes verified present afterwards.',
    ],
    hardStops: [],
    gateRounds: 2,
  },
  plannedBy: { model: 'claude-fable-5' },
  category: 'fix',
  kind: 'hardening',
  arcId: 'MINESWEEP',
  source:
    'MINESWEEP plane "Lane lifecycle" — 2026-08-31 mining §Q2; user asks quoted in arc ledger: "if codex lane is used good? so that codex can properly plan phases/arcs too?" and "it created a file not phase I believe?".',
  priority: 'HIGH',
  dependsOn: [14],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/worktree.mjs',
    'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
  ],
  stakeholderDemo:
    'A codex lane launched into a pnpm consumer installs with pnpm (or refuses loudly before creating anything), every envelope names the absolute CLI and the binding commit grammar, a plan lane whose authored file does not validate can never close as consumed, and `codex plan --arc` explains the supervised flow instead of stack-tracing.',
  userFacing: false,
  assumptions: [
    {
      claim: 'ensureWorktree in codex.mjs hardcodes `npm ci` with no lockfile inspection (the atlas phase-25 recorded upstream debt).',
      verify:
        'bash -c "grep -qF \\"spawnSync(\'npm\', [\'ci\', \'--no-audit\', \'--no-fund\']\\" plugins/zeroh-roadmap/cli/commands/codex.mjs && test \\"$(grep -cF pnpm-lock.yaml plugins/zeroh-roadmap/cli/commands/codex.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'planCodex validates pre-launch only — no post-run `phase validate` of the authored entity exists anywhere in codex.mjs.',
      verify: 'bash -c "test \\"$(grep -cF \'phase validate\' plugins/zeroh-roadmap/cli/commands/codex.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: '`codex plan --arc <ID>` currently reaches planCodex with the arc\'s member ids and dies on buildPlanPrompt\'s one-number throw as an uncaught stack trace (probed 2026-08-31: exit 1, raw traceback via planCodex codex.mjs:469).',
      verify:
        'bash -c "cd /home/patrik/zeroh-marketplace && node plugins/zeroh-roadmap/bin/roadmap.mjs codex plan --arc MINESWEEP 2>&1 | grep -qF \'at planCodex\'"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The three envelope builders (buildPrompt, buildReviewPrompt, buildPlanPrompt) are the only prompt composition sites for the lane.',
      verify:
        'bash -c "test \\"$(grep -cE \'^(export )?function build(Prompt|ReviewPrompt|PlanPrompt)\' plugins/zeroh-roadmap/cli/commands/codex.mjs)\\" = \\"3\\""',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '15.1',
      title: 'detectInstaller: lockfile-keyed package-manager selection (pure, unit-tested)',
      problem:
        'The install decision is buried inline in ensureWorktree as a hardcoded npm ci, so it can neither be tested without a network install nor extended per-manager — and in a pnpm consumer it fails after the worktree and branch already exist.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            "Export detectInstaller(dir): pnpm-lock.yaml → { bin: 'pnpm', args: ['install', '--frozen-lockfile'] }; package-lock.json → { bin: 'npm', args: ['ci', '--no-audit', '--no-fund'] }; package.json with NEITHER lockfile → null (the caller refuses); no package.json → undefined (skip dir). Pure filesystem reads, no spawns — the LOCKED lockfile-keyed decision, never a which-probe of installed binaries → verify: bash -c \"grep -qF 'export function detectInstaller' plugins/zeroh-roadmap/cli/commands/codex.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Unit tests over tmp dirs: each lockfile maps to its manager verbatim (bin + args asserted exactly); both lockfiles present → pnpm wins with a recorded reason (pnpm-lock is the stricter claim); neither → null; no package.json → undefined → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'detectInstaller\' cli/commands/codex.test.mjs && capbuild node --test cli/commands/codex.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'detectInstaller returns the exact spawn recipe per lockfile, null on an undecidable dir, undefined on a non-package dir — every branch has a test',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['detectInstaller(dir) from cli/commands/codex.mjs'] },
      done: true,
      doneDate: '2026-08-31',
      transparencyReport: {
        whatWasDone:
          'Added the pure detectInstaller(dir) export with immutable pnpm and npm recipes, package-manifest gating, pnpm precedence when both supported lockfiles exist, an explicit precedence reason, and distinct null versus undefined outcomes. Added behavioral coverage for every branch, both lockfile creation orders, the non-package boundary, and read-only repeatability.',
        how:
          'The test-engineer role (claude-opus-5 via child-cli) authored six RED cases; the first launcher firing hit the Fable quota before completion, then the direct Opus retry completed. RED was 6 expected failures with 87 pre-existing tests green because detectInstaller was absent. After implementation, the mandated scoped command `bash scripts/test/run-tier.sh unit-scoped plugins/zeroh-roadmap/cli/commands/codex.test.mjs` could not run because this checkout has no scripts/test/run-tier.sh; the types slot was GREEN as declared-none. The full gate remains the authoritative executable verification.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The envelope-mandated scoped runner is absent from this repository, so no protocol-compliant scoped GREEN run was possible. The test-engineer RED command used direct `capbuild node --test` before the missing helper was confirmed; that deviation is recorded and is not repeated.',
      },
    },
    {
      id: '15.2',
      title: 'ensureWorktree consumes detectInstaller; undecidable consumers refuse BEFORE any state',
      problem:
        'ensureWorktree creates the worktree and branch, then runs the doomed npm ci — so a pnpm consumer pays a checkout + orphan branch per attempt (atlas worked around it by pre-creating worktrees by hand).',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            "In ensureWorktree with install:true: BEFORE `git worktree add`, probe detectInstaller on the primary root (and root/web when web/package.json exists); any null → stderr refusal naming the dir, both supported lockfiles, and that nothing was created; return 1. After creation, per package dir RE-RUN detectInstaller against the WORKTREE dir and spawn its recipe (capbuild-wrapped exactly as today when capbuild resolves) — the created tree is the truth, and a null there (base ref differing from the primary checkout) still refuses loudly, never falls back to a guessed manager. Retire the now-stale `npm ci` prose mentions in codex.mjs (module docblock, ensureWorktree/review-lane/planCodex comments) to manager-neutral wording. The refusal costs no worktree, no branch, no journal (launch() runs after ensureWorktree) → verify: bash -c \"grep -qF 'detectInstaller' plugins/zeroh-roadmap/cli/commands/codex.mjs && ! grep -qF \\\"spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir\\\" plugins/zeroh-roadmap/cli/commands/codex.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/worktree.mjs',
          description:
            "Blast radius (singleSeam 3: no per-call-site install logic): installDeps() here is the SECOND hardcoded npm-ci site — self-described 'the codex-lane install pattern' (worktree.mjs:30) — and provisions the very slots `codex run --worktree` reuses, so a pnpm consumer's `worktree up` hits the identical doomed npm ci. Import detectInstaller from codex.mjs, key each subdir's recipe on it (npm recipe byte-identical to today), refuse null with the same both-lockfiles message (a thrown Error — the execFileSync throw posture this function already has); export installDeps and pin the refusal + both recipes at unit level in cli/commands/worktree.test.mjs → verify: bash -c \"grep -qF 'detectInstaller' plugins/zeroh-roadmap/cli/commands/worktree.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'End-to-end refusal test in a lockfile-less fixture repo: `codex run <N>` exits 1, names both lockfiles, and afterwards `git worktree list` has one entry, the codex branch does not exist, and no journal file was written (the pre-state criterion); a package-lock fixture proceeds past the probe (install itself may be stubbed by pointing PATH at a recording shim so no network runs) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'names both lockfiles\' cli/commands/codex.test.mjs && capbuild node --test cli/commands/codex.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'A lockfile-less consumer refuses before any worktree/branch/journal exists (asserted on all three); a pnpm consumer spawns pnpm install --frozen-lockfile (shim-recorded argv asserted); an npm consumer keeps byte-identical npm ci argv',
        'The nested web/ package dir takes its OWN detected manager (state coverage: mixed-manager fixture)',
        'The worktree-up provisioner (commands/worktree.mjs installDeps) keys on the same detector with the same refusal — no second call-site install decision survives (singleSeam 3)',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/codex.mjs',
        'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/worktree.mjs',
        'plugins/zeroh-roadmap/cli/commands/worktree.test.mjs',
      ],
      testMode: 'tdd',
      dependsOn: ['15.1'],
      interfaces: { consumes: ['detectInstaller(dir) from 15.1'], produces: [] },
      done: true,
      doneDate: '2026-08-31',
      transparencyReport: {
        whatWasDone:
          'Rewired codex lane and session-worktree dependency provisioning through detectInstaller. Codex preflights package directories before git state exists, re-detects from each created worktree directory, preserves exact npm argv, supports pnpm and mixed root/web managers, and refuses undecidable package directories. worktree installDeps now exports the same shared decision path.',
        how:
          'The test-engineer role (claude-opus-5 via child-cli) added pre-state refusal, exact shim-recorded argv, mixed-manager, non-package, and shared-seam cases. The mandated scoped runner was absent (exit 127), so the architect Decision Contract fired: claude-fable-5 was quota-unavailable and gpt-5.6-sol substituted natively, verdict PROCEED_WITH_FIX via the named unit gate. singleSeam guard mutation proof: planted hardcoded npm recipe → RED (`not ok 575`, restated-recipe assertion); changed the named import to namespace access → RED (`not ok 575`, must import detectInstaller); renamed only the local installer binding → GREEN (`ok 575`). Restored tree then passed the unit slot: 1,489 tests and schema checks, exit 0.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The repository lacks scripts/test/run-tier.sh, so its mandated scoped command exits 127. Mutation and GREEN proof therefore used the architect-approved named full unit gate; plugin-local test dependencies were pinned to repository Zod 4.4.3 after a caret install exposed schema-output drift.',
      },
    },
    {
      id: '15.3',
      title: 'Envelopes name the absolute CLI and the binding commit grammar',
      problem:
        'Both azure lane reports record `roadmap` exit-127 deviations, and three repos\' curation breakage traces to executors never being told the commit grammar (mudarabah2: 11 phases whose curation never ran) — the envelope is the one channel that reaches every delegated driver, and envelope lines are not metered protocol load.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            'Add to all three builders one CLI line: `THE ROADMAP CLI: node <abs bin/roadmap.mjs path> (bare `roadmap` may be absent from PATH — never assume it)` with the path resolved from import.meta.url like RUN_SKILL; add to buildPrompt and buildPlanPrompt one grammar line naming the binding subject forms verbatim: task `type(scope): phase N — N.X: <what>`, gate fix `fix(scope): phase N gate RX — <what>`, state `docs(roadmap): phase N — <desc>` — em dash directly after the number, and why (attribution binds on `phase N —`) → verify: bash -c "grep -qF \'absent from PATH\' plugins/zeroh-roadmap/cli/commands/codex.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'The existing prompt-content tests gain assertions: all three built prompts contain the absolute bin/roadmap.mjs path; run and plan prompts contain `phase N —` grammar text; review prompt does NOT carry the grammar line (it never commits) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'absent from PATH\' cli/commands/codex.test.mjs && capbuild node --test cli/commands/codex.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'Every lane prompt names the absolute CLI; committing lanes (run, plan) carry the grammar line and the read-only lane does not — asserted in the prompt tests both directions',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-31',
      transparencyReport: {
        whatWasDone:
          'Added one import-meta-resolved absolute roadmap CLI path to every run, review, and plan envelope. Added the binding task, gate-fix, and roadmap-state subject grammar—with its attribution reason—to the two committing envelopes only.',
        how:
          'The test-engineer role (claude-opus-5 via child-cli) added launcher-level assertions against the prompt files actually delivered for all three lanes, including positive and negative grammar direction. The exact scoped runner command exited 127 because scripts/test/run-tier.sh is absent; syntax and step greps passed, and the types slot was GREEN as declared-none. The phase full gate owns executable confirmation.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'No protocol-compliant scoped test execution was possible because the mandated scripts/test/run-tier.sh helper is absent; the full phase gate will execute these tests.',
      },
    },
    {
      id: '15.4',
      title: 'Plan-lane close validates the authored entity through the consumer bridge',
      problem:
        'A plan lane that wrote a malformed or absent phase file still reports CODEX-RUN-COMPLETE, and nothing downstream would catch it mechanically (`roadmap status` hides parse errors — azure lesson 2329; the hook-adapter validator no-ops as a CLI — azure lesson 2333). The consume-the-plan close (14.6) is the right choke point: an invalid plan must never close as consumed.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            "In archivePlanLane, before the harvest byte-proof guard: spawn the plugin's own CLI `phase validate <phaseFile>` with cwd = the plan worktree (its install:true toolchain serves the tsx bridge); non-zero → refusal `plan lane authored a file that does not validate as a phase entity` carrying the validator's stderr verbatim (errors are the debugging interface) and the lane is KEPT for inspection → verify: bash -c \"grep -qF 'does not validate as a phase entity' plugins/zeroh-roadmap/cli/commands/codex.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Fixture pair on the 14.6 harness: a plan worktree whose committed phase file is syntactically broken refuses the close with the validator stderr present in the refusal and the worktree kept; the valid twin still closes (regression pin on 14.6 test a) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'does not validate as a phase entity\' cli/commands/codex.test.mjs && capbuild node --test cli/commands/codex.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'An invalid authored entity can never close as consumed: the refusal carries the real validator error and keeps the lane; the valid path is unchanged (both directions tested)',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'archivePlanLane now runs the plugin CLI phase validator from the plan worktree before any harvest proof. Invalid authored entities keep their lane and surface validator diagnostics verbatim; valid plans retain the existing consume path.',
        how:
          'The test-engineer role (claude-opus-5 via child-cli) extended the real consume-the-plan harness with syntax-invalid, rule-invalid, valid-twin, and invalid-plus-unharvested cases, including exact diagnostic-line propagation and validation-before-harvest ordering. The exact scoped runner exited 127 because scripts/test/run-tier.sh is absent; syntax and step greps passed, and the types slot was GREEN as declared-none. The full phase gate owns executable confirmation.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'No protocol-compliant scoped test execution was possible because the mandated scripts/test/run-tier.sh helper is absent; the full phase gate will execute these tests.',
      },
    },
    {
      id: '15.5',
      title: '`codex plan --arc` refuses with the supervised flow, never a stack trace',
      problem:
        'Probed 2026-08-31: `roadmap codex plan --arc MINESWEEP` exits 1 via an uncaught buildPlanPrompt throw whose traceback never mentions --arc — the operator learns nothing about WHY arc planning is not a lane mission (the design-first gate needs the user; the lane is no-reachable-user by contract).',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            'In run() dispatch, before planCodex: `sub === \'plan\' && arcId` → stderr refusal: arc planning is a supervised act (the plan-arc skill owns the design-first gate, which needs the user); delegate per member instead — reserve each number, write each brief, and run `roadmap codex plan <N> --brief <path>` per phase; exit 1, nothing created. The one-number throw in buildPlanPrompt stays as the backstop for a multi-id non-arc call → verify: bash -c "grep -qF \'plan-arc\' plugins/zeroh-roadmap/cli/commands/codex.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Test: plan --arc against a fixture arc exits 1, stderr names plan-arc and the per-member `codex plan <N> --brief` form, no stack trace (doesNotMatch /at planCodex/), and no worktree/journal is created; `codex run --arc` stays untouched (regression pin) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'plan --arc\' cli/commands/codex.test.mjs && capbuild node --test cli/commands/codex.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'plan --arc yields the teaching refusal (supervised flow + per-member delegation form) with zero state created and zero traceback; run --arc behavior is pinned unchanged',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Added an early plan-plus-arc refusal after arc/member validation and before any lane state. It explains the supervised plan-arc design gate, prints one per-member codex plan command with a brief placeholder, exits 1, and leaves run --arc unchanged. Also corrected task 15.4 validator placement to preserve the earlier one-file-invariant diagnostic while still validating before harvest advice.',
        how:
          'The test-engineer role (claude-opus-5 via child-cli) added real-CLI cases for multi-member and single-member arc refusal, zero worktree/branch/journal/prompt/log state, no traceback, the non-arc count backstop, and run --arc regression. Its direct capbuild node test run was a lane deviation and found two intended REDs plus a 15.4 empty-diff regression. That regression was re-derived and fixed by moving validation from before the one-file invariant to immediately before harvest; the durable lesson was recorded. The exact scoped runner still exits 127; types was GREEN declared-none and the full gate owns executable confirmation.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The mandated scripts/test/run-tier.sh helper is absent. The test-engineer substituted a direct capbuild test despite instructions; this deviation is recorded and the authoritative full gate remains required.',
      },
    },
  ],
  notes:
    'interview: skipped — arc member; scope from the MINESWEEP arc record (LOCKED: lockfile-keyed detection, never a silent fallback; DEFERRED: a real codex arc-planning lane, owner user — 15.5 ships the loud refusal that keeps the gap honest). ' +
    'reviewScope full (launch-path changes in a lane that creates git state). ' +
    'Cross-phase dependency: 15.4 extends archivePlanLane from 14.6 (phase dependsOn [14]); interfaces consumed are grep-checked by the executor per contract. ' +
    'drivers.mjs is in keyFiles for the ratchet only: drivers.test.mjs fails on model-specific argv outside the registry — 15.2 must keep install argv OUT of the registry (an installer is toolchain, not a model launch; decision recorded here so the executor does not "fix" the ratchet). ' +
    'Verify rehearsal attestation: red-now probes executed 2026-08-31 — detectInstaller 0 hits (codex.mjs AND commands/worktree.mjs), `phase validate` 0 hits in codex.mjs, \'absent from PATH\' 0 hits (codex.mjs AND codex.test.mjs), \'plan-arc\' 0 hits (each step-verify red for exactly the symbol/text its diff adds); the 15.2 negative grep (npm-ci literal removed) dry-run: the pattern anchors on the exact current spawn line including `{ cwd: dir` which no task re-writes — self-collision checked against all task texts (the 15.1 recipe line writes args only, not the spawn call); assumption probes all exit 0 including the live plan --arc traceback observation; runner clauses inherit polarity from their grep representatives. ' +
    'review-phase Mode A 2026-08-31 [FIXED]: blast-radius addition — commands/worktree.mjs installDeps() is the second hardcoded npm-ci site (it provisions the slots `codex run --worktree` reuses), now consumed into 15.2 as its own step per singleSeam 3; 15.3 test-step verify gained the red-now \'absent from PATH\' grep anchor (was runner-only, no achievable red); 15.2 step 1 made explicit that post-creation install RE-detects per worktree dir (primary-root probe is only the cheap pre-state refusal) and that the stale npm-ci prose mentions in codex.mjs are retired.',
})
