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
  status: 'done',
  completedDate: '2026-08-24',
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
    "DESIGN (locked): file class is `roadmap/arc-evals/phase-<N>.peval.json` — a DISTINCT, date-free name. There is no `*.eval.json` class on disk; every arc-side scan of that dir is anchored on `<ARCID>-<YYYY-MM-DD>[-sweep|-verdicts].json` (newestArtifact/newestArtifactDated in cli/lib/eval-collect.mjs; REPORT_NAME_RE + arcsWithReports in cli/commands/eval.mjs), so a date-free peval name can never be read as an arc report, and the peval reader matches only the `.peval.json` tail, which no dated artifact carries. The record shape (PhaseEvalRecordShape in templates/schema.ts) carries: phase number, consumer fingerprint (reuse assembleConsumerFingerprint), ISO date supplied by the caller (the recorder never mints wall-clock silently — same discipline as SweepReportShape's `date`), taskCount and keyFiles (the COHORT KEYS — computeScorecard cells key on bandFor(taskCount) and surfaceOf(keyFiles) from eval-score.mjs; omit them and every record mis-cohorts into the smallest band, non-surface cell), gate slot results as run, metrics if present on the phase file, and an attribution snapshot { plannedBy?, driver?, roles? } read from the parsed phase file at emit time. NO judge fields — the ruling is deterministic-only; a record requiring a judge call fails the arc's acceptance criterion per-phase-eval-records.\n\nEMIT SEAM: inside runGate (cli/commands/gate.mjs — `export default async function run(argv)` merely dispatches `run` to it), at the TWO completions where slot results exist: (a) the default execute path, after the GateRunReport write, before `return green ? 0 : 2` — fresh slot rows in hand; buildPlan parses the phase file but returns only { plan, refused }, so it must additionally surface the parsed phase (or the emitter re-imports) for the attribution/taskCount/keyFiles snapshot; (b) the --verify-complete path before its 0/2 returns — slot results from latestReport, attribution + metrics from imp.parsed, which by THEN carries executionResult.driver and metrics (this refresh is what fills driver cells; at execute time only plannedBy exists). --record-round does not emit: it changes only agent rounds, which the record does not carry. Latest-run-wins overwrite; history lives in git if the consumer commits them. The emitter mkdirs roadmap/arc-evals if absent. Emission must never FAIL a gate: a write error is reported loudly on stderr but the exit code stays the slots' (or consistency) verdict — measurement must not block delivery.\n\nINGESTION: eval-collect gains a reader for the .peval.json class; runScorecard (cli/commands/eval.mjs) calls it beside its arc-trace loop and hands computeScorecard the merged per-phase samples feeding the SAME drivers/planners cells (cohort keys unchanged — model, lane, taskCountBand, surface). Phase-record samples carry NO escape scan, so they enter their cells scanDegraded — escapeFixesPerPhase reads 'scan-unavailable', never a minted 0 (the anti-zero rail). Reviewer cells are NOT fed from phase records (no gateRounds parsing in v1 — arc traces keep owning reviewer attribution; recorded as a named follow-up rather than half-built). The scorecard's `notes` output names both source counts (arc traces vs phase records) so a reader can see what fed the cells — the no-silent-caps rule.\n\nCONSUMER SYNC OBLIGATION: templates/schema.ts edits are copied byte-identical into THIS repo's lib/roadmap/schema.ts in the same commit, pinned by cmp (scripts/schema.test.ts deliberately cannot read a consumer tree — its MIRROR INVARIANT comments say the sync is hand discipline); other consumers (azure_private_agent, mudarabah2, viki-agent) receive it at their next plugin bump — named here so the executor does not chase them now.\n\nGATE BLOCKER (2026-08-24) — RESOLVED the same day by task 1.4 under the operator's ruling (see RESOLUTION below). The paragraph is kept verbatim as the escalation stood, because a ruling is only legible against the question it answered. As escalated: the phase cannot reach a mechanically green gate. The consumer's only gate slot is `unit` = the whole plugin suite, and one test in it is a STANDING REPO-STATE RED unrelated to this diff: `real tree: measure --flow do-arc --assert 12500` measures 14917 tokens across 8 model-loaded protocol files this phase never touches. It is NOT environmental (it fails on any host) — the arc prompt's Shared-host rules mis-classify it as one of three host failures. The other two WERE real and are FIXED in-seam here (cli/lib/tsx-bridge.mjs is in this phase's diff): node_modules/.bin/tsx carries a `#!/usr/bin/env node` shebang, so under a PATH-scrubbed test the exec SUCCEEDS and env exits 127 with `env: 'node': No such file or directory`, which matched neither the ENOENT branch nor the 'not found' wording — a fail-OPEN tsx-absent contract was being classified as a blocking eval-error. Suite went 1089/1092 → 1091/1092.\n\nThe architect (Decision Contract, 2026-08-24) returned ESCALATE_TO_USER and refuted the scoped-slot escape hypothesis twice: the ladder is OFF in this consumer (no `testCadence` key ⇒ ladder.mjs short-circuits to testScope full before arc-mode is consulted), and `unit-scoped` is unbound so resolveScopedOrFallback returns the same full command anyway. There is no known-failure mechanism by design — green is arithmetic over slot exit codes (gate.mjs), checkPhaseConsistency refuses a non-green done flip, and PassingGateResultShape refuses passed!==total. DIET-LEDGER.md already records the exact figure 14,917 and assigns recovery to the diet lane; phases 2420 and 2422 shipped rounds with this red standing. Precedent for the number is a USER RULING (measure-budget.mjs: re-ratcheted 12000 → 12500 by user ruling 2026-07-27, phase 1995 escalation). This phase therefore stops at in-progress rather than record a narrated green.\n\nMECHANICAL EVIDENCE (2026-08-24): the re-run on the FIXED tree is roadmap/.gate/1/run-000002 — 1093 tests, 1092 pass, 1 fail, the ratchet alone. `roadmap gate run 1 --verify-complete` then exits 2 with EXACTLY ONE problem, 'the latest gate report is not green (a done flip needs a green gate run)': the recorded round count matches (1 vs 1) and both scopes match, so the non-green report is the sole blocker and nothing else about this phase is inconsistent. The acceptance criterion is nevertheless demonstrated end-to-end on real data: roadmap/arc-evals/phase-1.peval.json carries attribution { plannedBy claude-opus-5[1m], driver claude-opus-5/session } plus metrics and the corrected slot projection (declared-absent slots carry NO exitCode), and `roadmap eval scorecard` renders a driver cell claude-opus-5 [session] and a planner cell claude-opus-5[1m], both abstaining honestly at n=1 against the floor of 5, with notes naming '0 arc trace(s) and 1 phase record(s)'. Before this phase this repo produced ZERO cells. One behaviour-neutral rename (a shadowed local `reason` in readPhaseEvalSamples) landed after run-000002; eval-collect.test.mjs re-run 30/30 green.\n\nRESOLUTION (operator ruling, 2026-08-24). The budget number was aspirational. The real goals: limit what is model-loaded, keep the bytes stable, decompose when it makes sense. Protocol bodies therefore carry OPERATIVE RULES ONLY — incident archeology and why-a-rule-exists live in git history (the commits carry WHY: blocks), at most ONE clause of rationale survives where judgment genuinely depends on it, and rarely-consulted detail decomposes into an on-demand reference. The budget becomes the MEASURED load at the last ratification, zero growth. Task 1.4 executed it: a DELETION-focused diet took `roadmap measure --flow do-arc` from 14,917 tokens / 59,656 B to 13,257 / 53,018 (-1,660, -11.1%) over the 8 model-loaded files; PROTOCOL_LOAD_BUDGET_TOKENS was re-ratcheted 12500 -> 13257, so the tree sits EXACTLY on its budget and any byte added to those files reds the gate; DIET-LEDGER.md carries the ruling in its header plus one summary row per dieted file and one disposition row per removed passage. NO operative rule was reworded — after the round-0 audit the diff is deletions and one relocation only. The other two 'environmental' failures were genuine and were fixed in task 1.3; the arc prompt's three-environmental-failures claim is corrected.\n\nREVIEW HISTORY (2026-08-24). The round recorded against run-000002 — one code-reviewer pass, six real defects, all fixed in 5b1d324 — ran under a MIS-DERIVED reviewScope: every task commit used a `phase 1 task 1.N` subject, which gate.mjs's phaseOwnFiles grep cannot match, so the scope came from an almost-empty phase-own set and resolved to light. This session corrected the grammar, the gate re-derived reviewScope FULL, and the whole phase was re-reviewed from scratch across six rounds (quality-pass + five code-reviewer). That re-review found what the light round could not: a --slots run silently overwriting the eval record, and then a fabricated-pass path through --verify-complete where a green filtered run landing after a RED full run rewrote the record to green:true. The same grammar bug also kept five files in foreignCommitsInRange and therefore outside the history-comment ratchet; their dated comments were cleared once a full-diff scan exposed them.\n\nREVIEW RATIFICATIONS (Mode A, 2026-08-23): testMode tdd on all three tasks ratified (plugin library logic under node:test; `capbuild node --test <file>` is the house scoped runner — phase 3 uses the same idiom, and the consumer's unit gateCommand is the same capbuild-wrapped suite). testScope/reviewScope derived, no relaxations. No user-facing surface (CLI + JSON artifacts) — the arc's recorded UX sub-gate skip applies.",
  gateRounds: [
    {
      round: 0,
      agent: 'quality-pass',
      verdict: 'findings-fixed',
      summary:
        'Audited all ~41 protocol hunks against task 1.4\'s binding contract (deletions and moves only, never a reworded operative rule). Verdict: no operative rule weakened or lost — every deletion is rationale, dated archeology, or a verbatim self-duplicate whose surviving twin it located. Enumerated the diff against the ledger (do-arc 9/9, do-phase 8/8, arc-sweep 7/7, validate-arc 8/8, release-sweep 5/5, using-zeroh-roadmap 4 removals under 3 rows, driving-tiers 2/2, followup-contract 3/3 — no orphan trim); both `relocated` targets and the `enforced-by-code(codex.mjs)` claim verified against real content. FIXED an orphaned JSDoc in eval-collect.mjs. Flagged 4 hunks as technically rewrites; 3 were grammar repair around a deleted clause and the 1 genuinely new sentence was converted to a pure deletion in e0c513a.',
    },
    {
      round: 1,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Three findings, fixed in acadd2a. The real one: the execute-path eval-record emit ran unconditionally on a --slots-filtered run, whose green covers the filtered rows alone — and do-phase runs `gate run --slots types` after EVERY task, so the durable measurement artifact this phase exists to build was degrading on the most routine call in the protocol. Fixed with a filter guard plus a named stderr line, mutation-proven. Also: task 1.4\'s report carried pre-round-0 figures the tree contradicted, and undercounted its out-of-files[] set. Verified the re-ratchet\'s blast radius mechanically and re-reviewed tasks 1.1-1.3\'s code, which no full-scope round had seen.',
    },
    {
      round: 2,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Reproduced round 1\'s mutation proof independently and extended it to four mutations (constant-collapse both ways, inverted predicate, deleted guard) — all RED, restore GREEN. Four LOW findings fixed in 65a8ade: the out-of-files[] numeral said six while the enumeration named eight; the stray </content> count said two when ten survive plugin-wide; and the partial-run stderr line asserted the record was \'left untouched\' even when none exists, which is the state do-phase\'s first per-task --slots run is always in.',
    },
    {
      round: 3,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'NOT CLEAN — found the HIGH three rounds had passed over. The R1/R2 guard was enforced on the execute path ALONE: latestReport() returns the newest run file whatever produced it, so --verify-complete was a second door. Probed empirically: a full run recorded 5 slots, then `--slots types`, then --verify-complete rewrote the record to slots [\'types\']; and with a RED full run followed by a GREEN filtered run, --verify-complete exited 0 and rewrote the record to green:true — a fabricated pass over a failed gate, reachable from the flow do-phase itself prescribes. Fixed in 68e064a (slotFilter stamp + checkPhaseConsistency refusal + refresh skip); three planted mutations each RED.',
    },
    {
      round: 4,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Confirmed the round-3 HIGH CLOSED and hunted for a fourth door — enumerated every writer and reader of emitPhaseEvalRecord, checkPhaseConsistency, latestReport and writeReport, and verified recordCuration and appendAgentRound preserve slotFilter through their shape round-trips. None found. Two findings fixed in 43424e4: slotFilter was z.string().optional(), so an empty string parsed clean and BOTH guards read it as a full run; and the R3 comment asserted the eval.test.mjs red fired \'on roughly one run in three\', an invented rate the round measured at ~6%. Its third finding (summarizeGateRuns drops the discriminator) was established as pre-existing from phases 1996/2015 and recorded as surfaced debt.',
    },
    {
      round: 5,
      agent: 'code-reviewer',
      verdict: 'clean',
      summary:
        'CLEAN, no blockers. Verified the R4 tightening against all four reports on disk (each still round-trips; the archive carries no slotFilter, so the change is a no-op on it) and confirmed nothing can write an empty value. Independently reproduced the eval.test.mjs failure rate at 5.796% over 2,000,000 trials against the closed form 5.89%. Closing sweep of the whole CODE diff: no later-round fix regressed an earlier one, templates/schema.ts and lib/roadmap/schema.ts still byte-identical. One LOW residual — the .min(1) guard had no test — fixed in d5fe003 with its own mutation proof.',
    },
  ],
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1096,
      total: 1096,
      notes:
        'roadmap/.gate/1/run-000007 — the consumer binds ONE slot, unit = the whole plugin suite (node --test over 59 files + scripts/schema.test.ts). lint/types/build/integration/e2e are declaredAbsent in roadmap.config.json, not skipped by this phase.',
    },
    integrationTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — this consumer has no integration tier.',
    },
    e2eTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — a CLI/JSON-artifact phase with no rendered surface.',
    },
    build: 'clean',
    preReview: 'clean',
  },
  metrics: {
    commits: 20,
    linesAdded: 2572,
    linesRemoved: 395,
    filesChanged: 38,
    testsAtStart: 1069,
    testsAtEnd: 1096,
    testsAdded: 27,
    startedAt: '2026-08-23T22:10:29.000Z',
    completedAt: '2026-08-24T10:53:51.000Z',
    haltCount: 1,
  },
  executionResult: {
    phase: 1,
    status: 'done',
    driver: { model: 'claude-opus-5[1m]', lane: 'session' },
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      'The plugin TEMPLATE plugins/zeroh-roadmap/templates/example.arc.ts still ships id \'A\' + phases: [1], and scripts/scaffold-roadmap.sh copies it into every fresh `roadmap init` — so the exact audit-BROKEN collision this phase cleaned up in the consumer re-appears in every new consumer. Out of task 1.4\'s files[]; needs a follow-up phase deciding what the scaffold should claim (re-id to EXAMPLE, an unclaimed number, or no phases at all).',
      'summarizeGateRuns (cli/lib/eval-collect.mjs) is a THIRD inlet that drops the new slotFilter discriminator: filtered projections enter the arc-sweep corpus as if they were gate runs, so eval-scorecard\'s finalGreenRun can read a green --slots run as \'the run that let the work out\' (its empty rounds[] charges no reviewer for the escape), and eval-score\'s gateRoundsMean fallback counts every rounds-less filtered run as 0, collapsing the mean and flattering the executor. PRE-EXISTING (summarizeGateRuns landed in phase 1996, finalGreenRun in 2015) and outside this diff; rounds 4 and 5 both ruled it a follow-up rather than a phase-1 blocker. Fix is the same rule the other two inlets now enforce: skip reports carrying slotFilter.',
      'latestReport (cli/lib/gate-report.mjs) swallows an unparseable report into \'no report at all\' rather than naming the path and the zod reason — a PRIME-DIRECTIVE swallow. Pre-existing and NOT made more reachable by this phase (no plugin version can write a slotFilter value the new shape rejects, so no legacy report becomes unparseable).',
      'TEN bare `</content>` authoring artifacts survive plugin-wide — the seven agent cards, skills/audit-roadmap/SKILL.md, skills/validate-arc/references/parity-rubric.md and DIET-LEDGER.md\'s own. The two inside the do-arc measured set were removed by the diet; none of the rest is in that set, so none was in scope.',
      'The previous executor\'s `phase 1 task 1.N` commit subjects are invisible to gate.mjs\'s phaseOwnFiles grep, so five files (both schema copies + three test files) sat in foreignCommitsInRange for the whole phase. Two consequences, both now handled: the earlier review round derived reviewScope light from an almost-empty phase-own set (re-reviewed here at FULL across six rounds), and those five files stayed outside the history-comment ratchet until a manual full-diff scan exposed their dated comments. The commit grammar is corrected from task 1.4 onward.',
      'cli/commands/result.mjs still carries its own two-argument PARSE_SCRIPT hardcoded to PhaseExecutionResultShape after eval.mjs\'s copy was folded into tsx-bridge.bridgeParseShape — the duplication task 1.2 named is half-resolved, not resolved.',
      '`--slots` is silently ignored when combined with `--record-round` or `--verify-complete` (those branches return before the filter is computed). Harmless today; a one-line \'ignored\' notice would be kinder.',
      'Reviewer cells are still fed by arc traces alone — a phase record carries slot results, not agent rounds. The plan\'s v1 ruling; parsing gateRounds into records is the named follow-up.',
    ],
    hardStops: [],
    gateRounds: 6, // trued 5→6 (phase 13.8): the convention counts every recorded round INCLUDING round 0
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
          'Two files outside this task\'s planned files[] were touched, both to avoid duplicating something: cli/lib/eval-collect.mjs (the record naming + pure assembler, so the arc-evals name classes have ONE home) and cli/lib/tsx-bridge.mjs (bridgeParseShape). cli/commands/result.mjs still carries its own specialised two-argument PARSE_SCRIPT hardcoded to PhaseExecutionResultShape; it was left alone because its argv contract is pinned by its own tests and it is outside this arc — a named residual, not a silent one. The emit adds one tsx spawn (~2s) to every gate run, including scoped per-task runs; latest-run-wins meant a narrow --slots run overwrote a fuller one, which gate R1 fixed — a --slots-filtered execute run now skips the emit and says so on stderr; the --verify-complete refresh re-emits from latestReport, which is simply the newest run file, so a full gate run BEFORE --verify-complete is what restores the fuller sample — a workflow convention, not a mechanism the refresh enforces.',
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
    {
      id: '1.4',
      title: 'Protocol-load diet + measured rebaseline (operator ruling 2026-08-24)',
      problem:
        "The gate's one red is the measure ratchet: 14917 tokens over an aspirational 12500 budget. Operator ruling 2026-08-24: the budget number is not a target — protocol bodies carry OPERATIVE RULES ONLY (incident archeology and why-a-rule-exists live in git history; at most one clause of rationale where judgment genuinely depends on it; rarely-consulted detail decomposes into on-demand references), and the budget becomes the MEASURED load at last ratification with zero growth allowed.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/DIET-LEDGER.md',
          description:
            "Record the ruling in the header, one line: protocol bodies carry operative rules only — archeology/why lives in git (commit WHY: blocks), <=1 rationale clause where judgment depends on it, rare detail decomposes to references; budget = measured load at last ratification, zero growth → verify: bash -c \"grep -qF 'operative rules only' plugins/zeroh-roadmap/DIET-LEDGER.md\"",
        },
        {
          file: 'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
          description:
            'Diet pass over the 8 measured do-arc-flow files (6 SKILL bodies + 2 references, the roadmap measure --flow do-arc table): DELETION-FOCUSED — remove dated incident narratives, duplicated rule-restatement, and justification prose; NEVER reword an operative rule (gauntlet: rewrites degrade, deletions are auditable); a rare-but-needed detail moves into an existing reference file instead of dying; one DIET-LEDGER disposition row per file with before/after tokens → verify: roadmap measure --flow do-arc',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/measure-budget.mjs',
          description:
            "Set PROTOCOL_LOAD_BUDGET_TOKENS to the post-diet measured total (whatever it measures — no pre-committed target) and replace the docblock history with the one-line semantic: budget = measured load at last ratification (2026-08-24 operator ruling), moved only by a diet (down) or a dated ruling (up) → verify: bash -c 'cd plugins/zeroh-roadmap && capbuild npm test'",
        },
        {
          file: 'roadmap/arcs/example.arc.ts',
          description:
            "Housekeeping A: the shipped scaffold's id 'A' claims phases [1], colliding with POLYSEAT plane 1 (roadmap audit reports BROKEN, pre-existing). Re-id it 'EXAMPLE' with an unclaimed phase number, or delete it if nothing references it (grep first) → verify: roadmap audit",
        },
        {
          file: 'roadmap/arc-prompts/POLYSEAT-execution-prompt.md',
          description:
            'Housekeeping B: correct the Shared-host rules paragraph — 2 environmental failures existed and are fixed in-seam (tsx-bridge shebang contract, task 1.3); the measure ratchet was never environmental and is resolved by this task → verify: bash -c "! grep -qF \'3 KNOWN environmental failures\' roadmap/arc-prompts/POLYSEAT-execution-prompt.md"',
        },
      ],
      acceptanceCriteria: [
        'roadmap measure --flow do-arc total equals PROTOCOL_LOAD_BUDGET_TOKENS exactly (zero-growth baseline); full plugin suite green; one DIET-LEDGER row per dieted file; no operative rule reworded — diffs are deletions, moves, and the two housekeeping fixes',
        'roadmap audit no longer reports the example-arc collision',
      ],
      files: [
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
        'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
        'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
        'plugins/zeroh-roadmap/skills/arc-sweep/SKILL.md',
        'plugins/zeroh-roadmap/skills/release-sweep/SKILL.md',
        'plugins/zeroh-roadmap/skills/validate-arc/SKILL.md',
        'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md',
        'plugins/zeroh-roadmap/skills/validate-arc/references/driving-tiers.md',
        'plugins/zeroh-roadmap/skills/release-sweep/references/followup-contract.md',
        'plugins/zeroh-roadmap/cli/lib/measure-budget.mjs',
        'roadmap/arcs/example.arc.ts',
        'roadmap/arc-prompts/POLYSEAT-execution-prompt.md',
      ],
      batchMode: true,
      testMode: 'none',
      done: true,
      doneDate: '2026-08-24',
      transparencyReport: {
        whatWasDone:
          "The operator's 2026-08-24 ruling is recorded in the DIET-LEDGER header (protocol bodies carry operative rules only; archeology and why-a-rule-exists live in git history; <=1 rationale clause where judgment depends on it; rare detail decomposes to references; the budget is the measured load at last ratification, zero growth). A deletion-focused diet over the 8 files in `roadmap measure --flow do-arc` took the flow from 14,917 tokens / 59,656 B to 13,257 / 53,018 (-1,660 tokens, -11.1%). PROTOCOL_LOAD_BUDGET_TOKENS is re-ratcheted 12500 -> 13257 — the post-diet measured total, so the tree now sits EXACTLY on its budget — and its docblock is the one-line semantic plus the dated ruling. The scaffolded roadmap/arcs/example.arc.ts (id A, phases [1]) is deleted and `roadmap audit` is CLEAN. The POLYSEAT execution prompt no longer claims 3 environmental host failures.",
        how:
          "Every diff over the 8 protocol files is a DELETION or a MOVE — no operative rule was reworded, per the plan's gauntlet (a rewrite risks degrading a protocol the reviewer cannot re-derive; a deletion is auditable). Applied through an exact-string script that REFUSED any pattern not matching exactly once, so no edit could land on a near-miss. What went: dated incident narratives (the 2026-08-17 two-executors-on-one-tree --force story, the reaped-watch-daemon aside, the v0.36.0 three-CI-round + FRONTDOOR five-ratchet ratchet story, the codex merge-in-the-wrong-checkout diagnosis, three '(user ruling <date>)' attributions, the using-zeroh-roadmap provenance paragraph); duplicated rule-restatement (arc-sweep's ACCEPT bullet, a verbatim restatement of its own disposition table; its 'When vs release-sweep' line duplicating the Not-this-skill line four lines above; do-arc's position-re-derives sentence duplicating its own Pause & resume section; release-sweep's prose restating the inline comments of the bash block directly above it; followup-contract's closing line duplicating release-sweep Step 2.5); and justification prose whose operative rule survives verbatim beside it. One MOVE: driving-tiers.md's azure_private_agent worked example — explicitly 'NOT a plugin default' — relocated to DESIGN-NOTES.md, with a pointer and the 'the judge reads whichever bindings the consumer documents' rule left in place. Two stray `</content>` authoring artifacts (arc-sweep and release-sweep EOF) were removed. DIET-LEDGER.md carries one summary row per dieted file with before/after tokens plus one disposition row per removed passage, in the ledger's own three-word disposition vocabulary. VERIFIED: `roadmap measure --flow do-arc` totals 13257, equal to the constant; `capbuild node --test cli/commands/measure.test.mjs` turns the standing red green ('real tree: measure --flow do-arc --assert 13257 exits 0', 10/10); eval-propose + measure 54/54; eval.test.mjs + eval-collect + eval-scorecard 171/171; `roadmap audit` CLEAN.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "Moving the constant forced two mechanical changes the plan did not name, both recorded in the ledger's closing paragraph: the four budget-coupled proposal fixtures (ALPHA/BRAVO/CHARLIE/DELTA) were re-based by the same +757 delta so every boundary property they encode survives (one report EXACTLY at budget, two prod-grade + one fast-lane OVER), and eval-propose.test.mjs test 16 now derives its corpus from PROTOCOL_LOAD_BUDGET_TOKENS (2x budget) instead of the literal 12500/25000 pair — a strengthening, since the next re-ratchet can no longer silently re-point that arithmetic. Eight files outside the task's files[] were touched by the task's own step commits, none of them model-loaded so none owes a ledger row: cli/measure-manifest.json (its printed note still claimed a '<=12k-token budget', which the re-ratchet would have turned into a fresh lie in the very output the criterion reads), cli/lib/eval-propose.test.mjs, the four cli/testdata/eval-proposals fixtures plus their load-fixture.mjs docblock, and plugins/zeroh-roadmap/DESIGN-NOTES.md (the relocation target the driving-tiers move needed). The gate rounds later touched three more: cli/lib/eval-collect.mjs (R0, an orphaned docblock) and cli/commands/gate.mjs + gate.test.mjs (R1/R2, the --slots emit fix). BOOKKEEPING DEVIATION: step 4's example-arc deletion had been staged by `git rm` before the first batch commit, so it rode commit d3aa0f1 (steps 1-2) instead of getting its own step commit; the work is complete and the message for it was folded into the phase record rather than rewriting three of my own commits. RESIDUAL, not fixed: the plugin TEMPLATE plugins/zeroh-roadmap/templates/example.arc.ts still carries id 'A' + phases: [1], so every fresh `roadmap init` scaffolds the same collision this task cleaned up here — out of this task's files[], surfaced rather than widened. TEN bare `</content>` artifacts still survive plugin-wide — the seven agent cards, skills/audit-roadmap/SKILL.md, skills/validate-arc/references/parity-rubric.md, and DIET-LEDGER.md's own pre-existing one; none is in the do-arc measured set, so none was in scope.",
      },
    },
  ],
})
