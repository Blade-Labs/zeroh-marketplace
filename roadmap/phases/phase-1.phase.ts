import { definePhase } from '@/lib/roadmap/schema'

/**
 * POLYSEAT plane 1 of 4 — fill the measurement pipe.
 *
 * The scorecard (cli/lib/eval-scorecard.mjs computeScorecard) renders driver /
 * planner / reviewer cells ONLY from arc traces — re-collected per arc holding a
 * dated report (`<ARCID>-<YYYY-MM-DD>.json`) in roadmap/arc-evals/.
 * Ordinary phases executed outside eval-arc leave nothing — measured in the
 * flagship-adjacent consumer mudarabah2 on 2026-08-23: ZERO eval records, so
 * every scorecard family renders 0 cells against SCORECARD_N_FLOOR = 5, and the
 * question "which model is best for planning vs executing" is unanswerable.
 * Every phase executed before this lands is an unrecoverable lost sample.
 *
 * Ruling (2026-08-23): records are DETERMINISTIC + ATTRIBUTION ONLY — gate slot
 * results, metrics, plannedBy/driver snapshot. Zero judge tokens per phase;
 * judge-scored dimensions stay arc-level.
 */
export default definePhase({
  phase: 1,
  name: 'Per-phase eval records — the gate emits, the scorecard ingests',
  status: 'in-progress',
  arcId: 'POLYSEAT',
  plannedBy: { model: 'claude-opus-5[1m]' },
  category: 'feature',
  kind: 'logic',
  source:
    'Arc POLYSEAT plane 1 — designRef MULTI-DRIVER.md (measurement pipe); rationale in roadmap/arc-prompts/POLYSEAT-execution-prompt.md.',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/templates/schema.ts',
    'plugins/zeroh-roadmap/cli/commands/gate.mjs',
    'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
    'plugins/zeroh-roadmap/cli/lib/eval-scorecard.mjs',
    'plugins/zeroh-roadmap/cli/commands/eval.mjs',
    'lib/roadmap/schema.ts',
  ],
  stakeholderDemo:
    'Running any phase gate now leaves a per-phase eval record on disk, and the model scorecard counts it — model comparison accumulates from ordinary work instead of only from full arcs.',
  assumptions: [
    {
      claim:
        'The scorecard still reads only arc-eval traces, so per-phase records are genuinely absent as an input class.',
      verify:
        "bash -c \"grep -qF 'arc-evals' plugins/zeroh-roadmap/cli/lib/eval-collect.mjs && ! grep -rqF 'peval' plugins/zeroh-roadmap/cli/lib/eval-collect.mjs\"",
      onFalse: 'ESCALATE',
    },
    {
      claim:
        "templates/schema.ts and this repo's lib/roadmap/schema.ts are currently byte-identical, so a shape addition is a two-file copy edit here. The sync is HAND discipline pinned by cmp — scripts/schema.test.ts deliberately cannot read a consumer tree (its MIRROR INVARIANT comments: 'trust the sync, rather than fake a cross-repo diff').",
      verify: 'bash -c "cmp -s plugins/zeroh-roadmap/templates/schema.ts lib/roadmap/schema.ts"',
      onFalse: 'ESCALATE',
    },
  ],
  notes:
    "DESIGN (locked): file class is `roadmap/arc-evals/phase-<N>.peval.json` — a DISTINCT, date-free name. There is no `*.eval.json` class on disk; every arc-side scan of that dir is anchored on `<ARCID>-<YYYY-MM-DD>[-sweep|-verdicts].json` (newestArtifact/newestArtifactDated in cli/lib/eval-collect.mjs; REPORT_NAME_RE + arcsWithReports in cli/commands/eval.mjs), so a date-free peval name can never be read as an arc report, and the peval reader matches only the `.peval.json` tail, which no dated artifact carries. The record shape (PhaseEvalRecordShape in templates/schema.ts) carries: phase number, consumer fingerprint (reuse assembleConsumerFingerprint), ISO date supplied by the caller (the recorder never mints wall-clock silently — same discipline as SweepReportShape's `date`), taskCount and keyFiles (the COHORT KEYS — computeScorecard cells key on bandFor(taskCount) and surfaceOf(keyFiles) from eval-score.mjs; omit them and every record mis-cohorts into the smallest band, non-surface cell), gate slot results as run, metrics if present on the phase file, and an attribution snapshot { plannedBy?, driver?, roles? } read from the parsed phase file at emit time. NO judge fields — the ruling is deterministic-only; a record requiring a judge call fails the arc's acceptance criterion per-phase-eval-records.\n\nEMIT SEAM: inside runGate (cli/commands/gate.mjs — `export default async function run(argv)` merely dispatches `run` to it), at the TWO completions where slot results exist: (a) the default execute path, after the GateRunReport write, before `return green ? 0 : 2` — fresh slot rows in hand; buildPlan parses the phase file but returns only { plan, refused }, so it must additionally surface the parsed phase (or the emitter re-imports) for the attribution/taskCount/keyFiles snapshot; (b) the --verify-complete path before its 0/2 returns — slot results from latestReport, attribution + metrics from imp.parsed, which by THEN carries executionResult.driver and metrics (this refresh is what fills driver cells; at execute time only plannedBy exists). --record-round does not emit: it changes only agent rounds, which the record does not carry. Latest-run-wins overwrite; history lives in git if the consumer commits them. The emitter mkdirs roadmap/arc-evals if absent. Emission must never FAIL a gate: a write error is reported loudly on stderr but the exit code stays the slots' (or consistency) verdict — measurement must not block delivery.\n\nINGESTION: eval-collect gains a reader for the .peval.json class; runScorecard (cli/commands/eval.mjs) calls it beside its arc-trace loop and hands computeScorecard the merged per-phase samples feeding the SAME drivers/planners cells (cohort keys unchanged — model, lane, taskCountBand, surface). Phase-record samples carry NO escape scan, so they enter their cells scanDegraded — escapeFixesPerPhase reads 'scan-unavailable', never a minted 0 (the anti-zero rail). Reviewer cells are NOT fed from phase records (no gateRounds parsing in v1 — arc traces keep owning reviewer attribution; recorded as a named follow-up rather than half-built). The scorecard's `notes` output names both source counts (arc traces vs phase records) so a reader can see what fed the cells — the no-silent-caps rule.\n\nCONSUMER SYNC OBLIGATION: templates/schema.ts edits are copied byte-identical into THIS repo's lib/roadmap/schema.ts in the same commit, pinned by cmp (scripts/schema.test.ts deliberately cannot read a consumer tree — its MIRROR INVARIANT comments say the sync is hand discipline); other consumers (azure_private_agent, mudarabah2, viki-agent) receive it at their next plugin bump — named here so the executor does not chase them now.\n\nGATE BLOCKER (2026-08-24, ESCALATED — all three tasks are complete, reviewed and regression-free): the phase cannot reach a mechanically green gate. The consumer's only gate slot is `unit` = the whole plugin suite, and one test in it is a STANDING REPO-STATE RED unrelated to this diff: `real tree: measure --flow do-arc --assert 12500` measures 14917 tokens across 8 model-loaded protocol files this phase never touches. It is NOT environmental (it fails on any host) — the arc prompt's Shared-host rules mis-classify it as one of three host failures. The other two WERE real and are FIXED in-seam here (cli/lib/tsx-bridge.mjs is in this phase's diff): node_modules/.bin/tsx carries a `#!/usr/bin/env node` shebang, so under a PATH-scrubbed test the exec SUCCEEDS and env exits 127 with `env: 'node': No such file or directory`, which matched neither the ENOENT branch nor the 'not found' wording — a fail-OPEN tsx-absent contract was being classified as a blocking eval-error. Suite went 1089/1092 → 1091/1092.\n\nThe architect (Decision Contract, 2026-08-24) returned ESCALATE_TO_USER and refuted the scoped-slot escape hypothesis twice: the ladder is OFF in this consumer (no `testCadence` key ⇒ ladder.mjs short-circuits to testScope full before arc-mode is consulted), and `unit-scoped` is unbound so resolveScopedOrFallback returns the same full command anyway. There is no known-failure mechanism by design — green is arithmetic over slot exit codes (gate.mjs), checkPhaseConsistency refuses a non-green done flip, and PassingGateResultShape refuses passed!==total. DIET-LEDGER.md already records the exact figure 14,917 and assigns recovery to the diet lane; phases 2420 and 2422 shipped rounds with this red standing. Precedent for the number is a USER RULING (measure-budget.mjs: re-ratcheted 12000 → 12500 by user ruling 2026-07-27, phase 1995 escalation). This phase therefore stops at in-progress rather than record a narrated green.\n\nMECHANICAL EVIDENCE (2026-08-24): the re-run on the FIXED tree is roadmap/.gate/1/run-000002 — 1093 tests, 1092 pass, 1 fail, the ratchet alone. `roadmap gate run 1 --verify-complete` then exits 2 with EXACTLY ONE problem, 'the latest gate report is not green (a done flip needs a green gate run)': the recorded round count matches (1 vs 1) and both scopes match, so the non-green report is the sole blocker and nothing else about this phase is inconsistent. The acceptance criterion is nevertheless demonstrated end-to-end on real data: roadmap/arc-evals/phase-1.peval.json carries attribution { plannedBy claude-opus-5[1m], driver claude-opus-5/session } plus metrics and the corrected slot projection (declared-absent slots carry NO exitCode), and `roadmap eval scorecard` renders a driver cell claude-opus-5 [session] and a planner cell claude-opus-5[1m], both abstaining honestly at n=1 against the floor of 5, with notes naming '0 arc trace(s) and 1 phase record(s)'. Before this phase this repo produced ZERO cells. One behaviour-neutral rename (a shadowed local `reason` in readPhaseEvalSamples) landed after run-000002; eval-collect.test.mjs re-run 30/30 green.\n\nREVIEW RATIFICATIONS (Mode A, 2026-08-23): testMode tdd on all three tasks ratified (plugin library logic under node:test; `capbuild node --test <file>` is the house scoped runner — phase 3 uses the same idiom, and the consumer's unit gateCommand is the same capbuild-wrapped suite). testScope/reviewScope derived, no relaxations. No user-facing surface (CLI + JSON artifacts) — the arc's recorded UX sub-gate skip applies.",
  gateRounds: [
    {
      round: 0,
      verdict: 'skipped',
      summary:
        'Round 0 (quality-pass) skipped — reviewScope resolved to light, plan-ratified. `roadmap gate plan 1` printed "Round 0 skipped — reviewScope light".',
    },
    {
      round: 1,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Six real findings, all fixed in 5b1d324. HIGH: (1) computeScorecard merged phase records without de-duplicating against arc traces, so a phase present in both contributed two samples to one cell and phantom samples could carry a cell over the N-floor it should have abstained under; (2) the assembler copied the gate\'s exitCode 0 from declared-absent and skipped rows, recording a PASS for commands that never ran — visible in this repo\'s own first emitted record. MEDIUM: the record\'s "strict at every level" claim was false for metrics (it reuses PhaseMetricsShape, which strips) — doc corrected and the exception pinned by test. LOW: an orphaned JSDoc left by the DriverShape hoist; one warning per zod issue instead of per file; a task-1.2 limitation that overclaimed what the --verify-complete refresh mechanically corrects.',
    },
  ],
  metrics: {
    commits: 6,
    linesAdded: 2020,
    linesRemoved: 82,
    filesChanged: 16,
    testsAtStart: 1069,
    testsAtEnd: 1093,
    testsAdded: 24,
    startedAt: '2026-08-23T22:21:06.000Z',
    completedAt: '2026-08-24T00:05:21.000Z',
    haltCount: 1,
  },
  executionResult: {
    phase: 1,
    status: 'escalated',
    driver: { model: 'claude-opus-5', lane: 'session' },
    escalation: {
      question:
        'Phase 1 is code-complete, reviewed and regression-free, but its gate cannot go green: the consumer\'s only slot is the whole plugin suite, and `roadmap measure --flow do-arc --assert 12500` is a standing repo-state red at 14917 tokens that this phase never touched and DIET-LEDGER.md already assigns to the diet lane. The gate has no known-failure mechanism by design. Which resolution do you rule?',
      options: [
        'A — Re-ratchet the budget (the phase-1995 precedent, repeated exactly): set PROTOCOL_LOAD_BUDGET_TOKENS to 14917 in cli/lib/measure-budget.mjs (a hold-the-line number permitting zero growth, since sitting exactly on the budget is within it), extend its docblock with the dated ruling, and add a DIET-LEDGER paragraph naming the reset and re-affirming that the diet lane owns winning the bytes back. Suite goes green and phase 1 completes honestly. Cost: a named, dated baseline reset from 12500 to 14917.',
        'B — Queue a diet phase and block phase 1 behind it: trim ~2417 tokens across the 8 model-loaded files with one DIET-LEDGER disposition row per trim (the designHomes.architecture.extendProtocol contract). Permanent, no baseline reset, restores the 12500 guarantee. Cost: phase 1 stays in-progress for a full extra phase and the arc stalls.',
        'C — Ship phase 1 with an operator-authorized red: leave the report RED, do not flip to done, and let the arc carry the phase to the arc-end sweep where the ratchet is resolved once for all members. Cost: needs an explicit call on how `roadmap arc next` advances past an unverified phase.',
        'REJECTED by the architect — enabling testCadence and binding unit-scoped to narrow the slot: it does not resolve the ratchet (the arc-end full suite is still red) and it would permanently narrow every future phase gate in this repo to dodge one number.',
      ],
    },
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      'The arc prompt (POLYSEAT-execution-prompt.md, Shared-host rules) mis-classifies the do-arc protocol-load ratchet as one of three ENVIRONMENTAL host failures. It is a repo-state standing red that fails on any host and is already dispositioned in DIET-LEDGER.md. The other two were genuine and are fixed here.',
      'Every task commit subject in this phase reads `phase 1 task 1.N — ...`, but gate.mjs phaseOwnFiles greps the literal `phase 1 —`, so all 12 source files are classified foreignCommitsInRange and the gate derived its scope from an almost-empty phase-own set. Unrecoverable without rebasing sibling sessions commits interleaved in the range. Recorded as an eval lesson.',
      'cli/commands/eval.test.mjs test 71 ("nothing rendered or persisted claims a cross-cohort total") failed once and passed on two subsequent runs of the same tree — a flake worth watching, not diagnosed here.',
      'roadmap audit reports this repo BROKEN on a PRE-EXISTING finding unrelated to this phase: the shipped scaffold roadmap/arcs/example.arc.ts (id A) claims phases: [1], colliding with POLYSEAT plane 1. Present at this phase\'s base commit; the template arc should be renumbered or removed.',
      'The independent review was a single code-reviewer round (reviewScope light). No quality-pass ran, and reviewScope was derived from the under-populated phase-own set described above, so the review scope is weaker evidence than the diff size warrants.',
    ],
    hardStops: [],
    gateRounds: 1,
  },
  tasks: [
    {
      id: '1.1',
      title: 'PhaseEvalRecordShape lands in the schema, byte-synced to the consumer copy',
      problem:
        'No typed shape exists for a per-phase eval record, and every downstream (emit, ingest, scorecard) needs one contract to parse against rather than three ad-hoc JSON layouts.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            "Add PhaseEvalRecordShape (zod strictObject: phase, consumerFingerprint, date, taskCount, keyFiles — the cohort keys bandFor/surfaceOf read — gate: slot results as recorded, metrics optional, attribution { plannedBy?, driver?, roles? } optional-additive) beside SweepReportShape, mirroring its caller-supplied-date discipline; export the type → verify: grep -qF 'export const PhaseEvalRecordShape' plugins/zeroh-roadmap/templates/schema.ts",
        },
        {
          file: 'lib/roadmap/schema.ts',
          description:
            'Copy the templates edit byte-identical into this consumer copy in the same commit (hand-sync discipline — the schema test cannot see this tree) → verify: cmp -s plugins/zeroh-roadmap/templates/schema.ts lib/roadmap/schema.ts',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/schema.test.ts',
          description:
            'Extend the plugin schema test: PhaseEvalRecordShape parses a full record fixture and rejects an unknown key (strictObject) → verify: cd plugins/zeroh-roadmap && capbuild npx tsx scripts/schema.test.ts',
        },
      ],
      acceptanceCriteria: [
        'PhaseEvalRecordShape parses a full record and rejects an unknown key (strictObject), asserted in scripts/schema.test.ts',
        'templates/schema.ts and lib/roadmap/schema.ts are byte-identical (cmp) after the edit',
      ],
      files: [
        'plugins/zeroh-roadmap/templates/schema.ts',
        'lib/roadmap/schema.ts',
        'plugins/zeroh-roadmap/scripts/schema.test.ts',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-23',
      transparencyReport: {
        whatWasDone:
          'PhaseEvalRecordShape + PhaseEvalRecordListShape landed in plugins/zeroh-roadmap/templates/schema.ts and were copied byte-identical into lib/roadmap/schema.ts (cmp clean). scripts/schema.test.ts gained a PhaseEvalRecordShape section: 8 check() cases covering a full round-trip, a minimal record with defaults, root and NESTED unknown-key rejection, the date/phase/taskCount floors, the closed driver.lane vocabulary, and index-named element failures under the list shape.',
        how:
          'TDD: test-engineer wrote the 8 cases blind to the implementation and ran them RED (all 8 failed with "PhaseEvalRecordShape is not exported from templates/schema.ts"), then the shape landed and they went GREEN (capbuild npx tsx scripts/schema.test.ts — PASS, 0 failures). The RED round found a real gap the plan did not name: with driver reusing the shared shape as a plain z.object, an unknown key inside attribution.driver was SILENTLY STRIPPED rather than rejected, so strictness was root-only. Fixed with DriverShape.strict() at the record use site — a strict CLONE, verified empirically (base shape still strips, clone rejects with code unrecognized_keys) — because making the SHARED DriverShape strict would retroactively reject any consumer phase file whose executionResult.driver carries an extra key that parses today, a cross-consumer tightening this phase cannot verify. DriverShape itself was hoisted out of PhaseExecutionResultShape so the record and the execution result cannot drift into two spellings of an actor id (and so plane 2 lane widening is a one-line edit, not two).',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The record shape carries an optional attribution.roles snapshot that nothing populates yet — the role resolver that fills it lands in POLYSEAT plane 4. It is in the shape because the arc locked the record layout, not because plane 1 can exercise it; today every emitted record omits the key. The gate slot projection deliberately drops the GateRunReport row fields no measurement reads (command, files, logPath, note): the record keeps slot / exitCode / durationMs / declaredAbsent only.',
      },
    },
    {
      id: '1.2',
      title: 'The gate emits the record on every run, and never fails a gate doing it',
      problem:
        "gate run completes with slot results in hand and phase metadata parsed, then discards everything measurement needs. The emit must ride that completion without ever changing a gate's verdict.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            "Inside runGate, emit roadmap/arc-evals/phase-<N>.peval.json (PhaseEvalRecordShape-validated, mkdir if absent) at both completions where slot results exist: the default path after the GateRunReport write, before `return green ? 0 : 2` (surface the parsed phase from buildPlan — it returns only { plan, refused } today), and the --verify-complete path before its 0/2 returns (slots from latestReport, attribution + metrics from imp.parsed — the refresh that captures executionResult.driver). An emit failure prints a loud stderr line, never alters the exit code → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
          description:
            "Hermetic tmp-repo tests: a green run writes a parseable record carrying the phase's plannedBy; --verify-complete over a done fixture refreshes the record with executionResult.driver + metrics; a run in a repo with an unwritable arc-evals dir still exits with the slots' verdict and prints the emit failure; a re-run overwrites (latest-run-wins) → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs",
        },
      ],
      acceptanceCriteria: [
        'A gate run in a fixture repo leaves phase-<N>.peval.json whose attribution matches the phase file',
        'After --verify-complete on a done fixture, the record carries executionResult.driver and metrics',
        "An emit failure never changes the gate's exit code, asserted by test",
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/gate.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-23',
      transparencyReport: {
        whatWasDone:
          'runGate now emits roadmap/arc-evals/phase-<N>.peval.json at both completions that hold slot results: the default execute path (after the GateRunReport write) and --verify-complete (the refresh that captures executionResult.driver + metrics). buildPlan additionally returns the phase it already parsed, so the attribution/cohort snapshot costs no second tsx bridge read. --record-round emits nothing. Emission is fail-soft by construction: every failure mode prints one stderr line naming the record path and returns null, and the exit code stays the slots\' (or the consistency check\'s).',
        how:
          'TDD: test-engineer wrote 7 hermetic tmp-repo tests blind to the implementation and ran them RED (35 pre-existing pass, 7 new fail), then the emitter landed and the file went 42/42 GREEN. Naming + assembly live in cli/lib/eval-collect.mjs (PEVAL_NAME_RE, phaseEvalRecordPath, assemblePhaseEvalRecord) rather than in gate.mjs, because that module already owns the arc-evals filename axis the record must stay disjoint from — one home, so the writer and the plane-1.3 reader cannot drift into two spellings. Validation routes through the CONSUMER schema over the tsx bridge via a new shared cli/lib/tsx-bridge.mjs bridgeParseShape(), hoisted from the copy eval.mjs carried; seam 3 holds (the plugin still carries no second copy of a consumer contract, only the spawn moved). The record\'s date is the run report\'s own startedAt, never a fresh clock read. The RED round exposed a PRE-EXISTING fixture bug: runGateCmd used execFileSync, which surfaces stderr only through the thrown error, so a green run reported stderr as the empty string and any warning printed beside a green verdict was invisible to every assertion in the file. Switched to spawnSync — a strengthening, no assertion weakened.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Two files outside this task\'s planned files[] were touched, both to avoid duplicating something: cli/lib/eval-collect.mjs (the record naming + pure assembler, so the arc-evals name classes have ONE home) and cli/lib/tsx-bridge.mjs (bridgeParseShape). cli/commands/result.mjs still carries its own specialised two-argument PARSE_SCRIPT hardcoded to PhaseExecutionResultShape; it was left alone because its argv contract is pinned by its own tests and it is outside this arc — a named residual, not a silent one. The emit adds one tsx spawn (~2s) to every gate run, including scoped per-task runs; latest-run-wins means a narrow --slots run overwrites a fuller one; the --verify-complete refresh re-emits from latestReport, which is simply the newest run file, so a full gate run BEFORE --verify-complete is what restores the fuller sample — a workflow convention, not a mechanism the refresh enforces.',
      },
    },
    {
      id: '1.3',
      title: 'The scorecard ingests phase records beside arc traces, naming both sources',
      problem:
        'computeScorecard only ever receives arc-eval traces, so driver/planner cells starve in consumers that execute phases without arcs — the measured 0-cell state.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
          description:
            "Add a reader for roadmap/arc-evals/*.peval.json (validated via PhaseEvalRecordShape; unparseable file = named warning, never a silent skip) feeding the same per-phase sample shape collectArcTrace produces for the scorecard's driver/planner slicing; samples carry no escape scan and must enter their cells scanDegraded (escapeFixesPerPhase reads 'scan-unavailable', never a minted 0); reviewer cells stay arc-fed (named follow-up) → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-scorecard.mjs',
          description:
            "Accept the merged sample set; add both source counts to the output `notes` (arc traces vs phase records) so no cell claims coverage it did not get; N-floor abstention unchanged → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/eval-scorecard.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/eval.mjs',
          description:
            "runScorecard wires the seam: call the peval reader beside its arc-trace loop and pass the merged samples + both source counts into computeScorecard — without this the reader is dead code and `roadmap eval scorecard` never ingests → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/eval.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs',
          description:
            "Collision-proof BOTH directions against the real name classes (there is no `*.eval.json` class — arc artifacts are `<ARCID>-<YYYY-MM-DD>[-sweep|-verdicts].json`): the dated scans (newestArtifactDated) over a dir containing .peval.json files return none of them, and the peval reader ignores dated arc artifacts; falsify each by renaming a fixture the wrong way (e.g. `phase-3-2026-08-23.json`, which the dated scans WOULD claim) and asserting the named failure → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs",
        },
      ],
      acceptanceCriteria: [
        "A fixture with 5 phase records and no arc traces produces a non-abstained driver cell (N-floor met), with notes naming 5 phase records and 0 arc traces, and its escapeFixesPerPhase reads 'scan-unavailable', never 0",
        'Both collision tests red under their renamed-fixture falsification and green restored, recorded in the transparencyReport',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
        'plugins/zeroh-roadmap/cli/lib/eval-scorecard.mjs',
        'plugins/zeroh-roadmap/cli/commands/eval.mjs',
        'plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/eval-scorecard.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/eval.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-23',
      transparencyReport: {
        whatWasDone:
          "eval-collect gained readPhaseEvalSamples + phaseEvalValidator: it reads roadmap/arc-evals/*.peval.json in phase-number order and lifts each record into the same per-phase entry shape collectArcTrace produces. computeScorecard takes a phaseSamples option, wraps those samples as a DEGRADED source (escapeScan 'unavailable') so every cell they touch reads escapeFixesPerPhase 'scan-unavailable' and never a minted 0, reads the driver from the flat sample field beside executionResult, and names BOTH source counts in notes. runScorecard calls the reader beside its arc-trace loop and surfaces every reader warning on the say channel.",
        how:
          "TDD: test-engineer wrote 16 tests across the three suites blind to the implementation (RED: 12 failures, plus an ESM link-time refusal proving the exports were genuinely absent), then the implementation landed. Final: eval-collect + eval-scorecard 75/75, eval.test.mjs 94/95 (the single failure is the KNOWN pre-existing environmental one — 'eval propose — an UNRESOLVABLE tsx bridge', which scrubs PATH so this host's node cannot be found; the test-engineer independently reproduced it on the HEAD copy of the file). The RED round caught one real defect: the reader sorted by FILENAME, which is lexical, so phase 8801 came before phase 99 — fixed to sort on the phase number captured by PEVAL_NAME_RE. Two test-side errors were repaired without weakening intent: a notes assertion whose PROXY (note-count + 1) presumed the source line was conditional, rewritten to compare against the standing rails so the unconditional line still proves 'added, not swapped in'; and a control fixture built from 3 arc phases against an N-floor of 5, so the control cell abstained and asserted nothing — widened to 5 phases (rate 1/5). GUARD MUTATION PROOF for the peval/dated-artifact collision guard: planted violation — widened PEVAL_NAME_RE to /^phase-(\\d+)[-.].*\\.json$/ so the two name classes collide → RED ('the renamed file has left the record class', true !== false, test 28). Anchor drift — renamed the export PEVAL_NAME_RE to PEVAL_NAME_RX → LOUD link-time failure ('SyntaxError: The requested module ./eval-collect.mjs does not provide an export named PEVAL_NAME_RE', 0 of 30 tests able to run). Decoy — phase-880.peval.json (a strict phase-number PREFIX of phase-8801.peval.json, the nearest legal neighbour to the falsification's phase-8801-2026-08-23.json) beside real dated arc artifacts and both undated projections → GREEN, both records loaded in phase order, zero warnings, and the real sweep still resolved. All three mutations reverted from a pristine copy; the suite is 75/75 after restore and git diff on that path shows only the intended change.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "Reviewer cells stay arc-fed: a phase record carries slot results, not agent rounds, so records seat no reviewer. That is the plan's v1 ruling, and the follow-up (parsing gateRounds into records) is named here rather than half-built. Validating the archive costs ONE tsx spawn for the whole directory (PhaseEvalRecordListShape) rather than one per file; on the error path a second spawn re-validates the survivors after the offenders are named and dropped. cli/commands/eval.mjs's local PARSE_SCRIPT was deleted and its three call sites routed through the shared tsx-bridge helper (a bridgeParseShapeJson form was added for the stdin lanes), so the plugin no longer carries three copies of one idiom — cli/commands/result.mjs still has its own two-argument variant hardcoded to PhaseExecutionResultShape, left alone as a named residual outside this arc.",
      },
    },
  ],
})
