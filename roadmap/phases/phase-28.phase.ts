import { definePhase } from '@/lib/roadmap/schema'

/**
 * Lane evidence survives the land; journals know their worktree; the trailer names the driver.
 *
 * Three defects surfaced by the phase-26 diet trial and the 0.38.0 release, all in the plugin's
 * own lane mechanics:
 *
 * 1. `roadmap eval adherence` scores checkout-local evidence — gate reports under
 *    `<root>/.gate/<N>/` and the executor beacon `.building/<N>-executor.jsonl` — and `phase land`
 *    disposes the lane that holds them. Every codex-lane phase therefore fails `tripwires-ran`,
 *    `curation-evidence` and `verify-complete-passed` whatever it did (`eval adherence --since
 *    2026-09-01` on 2026-09-03: 15 of 16 phases fail all three; the one exception, 23, was
 *    finished on a Claude executor in the primary). `one-commit-per-task` fails after curation
 *    for the same reason: it reads task subjects from `git log`, which curation squashed.
 * 2. `findJournal(root, [N])` returns the first journal naming the phase. Two arms of one phase
 *    (the trial's codex/7 lane and the session-run trial/7-opus worktree) collide: the opus arm's
 *    `--verify-complete` reconciled against the codex lane's journal, and `phase land` refused
 *    the session-run worktree outright, so the winner was fast-forwarded by hand.
 * 3. `phase curate` composes a fixed `Co-Authored-By: Claude <noreply@anthropic.com>` trailer
 *    (curate.mjs:228) and the codex prompt dictates `Claude Fable 5` (codex.mjs:150) — both
 *    wrong for a gpt-5.6-sol lane; the phase-26 lane hand-edited its curated message.
 * 4. Phase 26's gate ran 11 rounds against a cap of 5: `gate round-brief` SAYS cap, but
 *    `--record-round` records any round number. The stale "rounds stay uncapped" prose is fixed
 *    (595d853); the mechanism is not.
 *
 * ## Hypotheses
 * 1. CONFIRMED — adherence.mjs latestGateReport reads `<root>/.gate/<N>` and eventsFor reads
 *    `<toplevel>/.building/<N>-executor.jsonl`; both paths are gitignored (`.gitignore:1
 *    .building/`; `roadmap/.gate` absent for every lane phase in the primary — `ls roadmap/.gate`
 *    on 2026-09-03: 10 11 13 14 23 arc-MINESWEEP). `phase land` merges ONLY lessons across
 *    (phase.mjs:431 mergeLessons) before disposeSource.
 * 2. CONFIRMED — codex-journal.mjs findJournal scans `.building` by filename class and returns
 *    the first parsed journal whose `phases` covers the ids; the journal's `worktree` field is
 *    written by launch but never consulted by the lookup. gate.mjs driverReconcile (line 657) and
 *    phase.mjs codexLaneSource (line 335) both call it with `[phaseNum]` only; codexLaneSource
 *    then rejects on `worktree !== cwd` (a refusal, not a search for the right journal).
 * 3. REFUTED — "the executor-arm sidecar is the session arm's journal": executor-arm.mjs writes
 *    a session-bound sidecar (`--session`, `--executor-id`) that no land/reconcile path reads;
 *    it is not lane-shaped and carries no worktree.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 28,
  name: 'Lane evidence survives the land; journals discriminate on worktree; trailer and round cap are enforced',
  status: 'done',
  completedDate: '2026-09-03',
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: { passed: 1885, total: 1885, notes: 'Authoritative full gate run-000008 was GREEN; the unit slot and schema validation passed in 1,705,604 ms.' },
    integrationTests: { passed: 0, total: 0, notes: 'declared-none; the fixture lifecycle coverage ran in the unit slot.' },
    e2eTests: { passed: 0, total: 0, notes: 'declared-none; no rendered surface.' },
    build: 'clean',
  },
  gateRounds: [
    { round: 0, agent: 'quality-pass', model: 'gpt-5.6-sol', verdict: 'clean', findings: [], summary: 'No quality fixes or hard stops; 580 relevant tests passed.' },
    { round: 1, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'findings-fixed', summary: 'Moved model-policy and target-HEAD validation before arm mutation.', findings: [{ file: 'plugins/zeroh-roadmap/cli/commands/executor-arm.mjs', severity: 'MEDIUM', confidence: 96, description: 'Failed prevalidation could leave a stale executor arm.', fixedInCommit: 'd28614f' }] },
    { round: 2, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'findings-fixed', summary: 'Restored incumbent arm bytes when journal writing fails.', findings: [{ file: 'plugins/zeroh-roadmap/cli/commands/executor-arm.mjs', severity: 'MEDIUM', confidence: 94, description: 'Rollback could delete a legitimate incumbent arm.', fixedInCommit: 'd7a741c' }] },
    { round: 3, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'clean', findings: [], summary: 'Both prior findings resolved; no remaining actionable findings.' },
  ],
  metrics: { commits: 4, linesAdded: 647, linesRemoved: 69, filesChanged: 26, testsAtStart: 1863, testsAtEnd: 1885, testsAdded: 22, startedAt: '2026-09-03T08:25:38Z', completedAt: '2026-09-03T10:17:30Z' },
  compromises: 'None',
  executionResult: {
    phase: 28,
    status: 'done',
    driver: { model: 'gpt-5.6-sol', lane: 'codex' },
    modelPolicy: { source: 'config', preset: 'codex' },
    roles: [
      { role: 'test-engineer', model: 'gpt-5.6-sol', via: 'native' }, { role: 'test-engineer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'test-engineer', model: 'gpt-5.6-sol', via: 'native' }, { role: 'test-engineer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'test-engineer', model: 'gpt-5.6-sol', via: 'native' }, { role: 'test-engineer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'quality-pass', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' }, { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
    ],
    compromises: [], skipped: [], hardcoded: [],
    surfaced: ['Task 28.4 lifecycle coverage was added after the initial executor-arm RED capture and passed targeted plus full-suite GREEN.', 'The first full gate caught two hardcoded model ids in test fixtures; gate R0 sourced them from the driver registry.'],
    hardStops: [], gateRounds: 4,
  },
  priority: 'HIGH',
  category: 'fix',
  kind: 'hardening',
  userFacing: false,
  created: '2026-09-03',
  source:
    'Supervising session 2026-09-03: phase-26 lane report (11 gate rounds, hand-edited trailer), the diet trial (journal collision at verify-complete, hand fast-forward of trial/7-opus), and `eval adherence --since 2026-09-01` scoring every lane phase as failing the three checkout-local checks.',
  dependsOn: [],
  conflictsWith: [],
  stakeholderDemo:
    'After landing phase 28 on a codex lane: `roadmap eval adherence 28` in the primary scores curation-evidence, verify-complete-passed and tripwires-ran from carried evidence; the curated commit trailer reads `Co-Authored-By: Codex gpt-5.6-sol`; recording round 6 without --cap-override refuses.',
  plannedBy: { model: 'claude-fable-5-1' },
  reviewRecord: { date: '2026-09-03', model: 'claude-fable-5-1', verdict: 'READY', via: 'executed' },
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/landing.mjs',
    'plugins/zeroh-roadmap/cli/lib/adherence.mjs',
    'plugins/zeroh-roadmap/cli/lib/codex-journal.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.mjs',
    'plugins/zeroh-roadmap/cli/commands/phase.mjs',
    'plugins/zeroh-roadmap/cli/commands/executor-arm.mjs',
    'plugins/zeroh-roadmap/cli/lib/curate.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
  ],
  assumptions: [
    {
      claim: 'phase land merges only lessons across before disposal (the seam 28.1 extends)',
      verify: "grep -F 'const { merged } = mergeLessons(lane.root, cwd)' plugins/zeroh-roadmap/cli/commands/phase.mjs",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'driverReconcile looks a journal up by phase number alone',
      verify: "grep -F \"found = findJournal(root, [phaseNum], 'run')\" plugins/zeroh-roadmap/cli/commands/gate.mjs",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'the run-lane journal filename class admits no label segment',
      verify: "grep -F -e 'journalRe: /^codex-[' plugins/zeroh-roadmap/cli/lib/codex-journal.mjs",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'the curate trailer is a fixed generic constant',
      verify: "grep -F \"const TRAILER = 'Co-Authored-By: Claude <noreply@anthropic.com>'\" plugins/zeroh-roadmap/cli/lib/curate.mjs",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'the primary checkout holds no gate report for the landed lane phase 26 (the evidence loss is real)',
      verify: 'test ! -d roadmap/.gate/26',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '28.1',
      title: 'phase land carries the lane gate reports and executor beacon into the primary before disposal',
      problem:
        'runLand (phase.mjs:431) merges the lane lessons and then disposeSource removes the worktree with its `.gate/<N>/run-*.json` reports and `.building/<N>-executor.jsonl` beacon — the only record of what the gate ran and when tasks started. Nothing in the primary can score or audit a landed lane phase afterwards.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs',
          description:
            'Add `carryLaneEvidence(primaryRoot, laneDir, phaseNum)` beside mergeLaneLessons: copy every `<laneRoadmapRoot>/.gate/<N>/run-*.json` into the primary twin dir (mkdir -p; an existing filename is never overwritten — report it as `kept`), and append the lane beacon `.building/<N>-executor.jsonl` lines the primary twin lacks (exact-line identity, the lessons rule). Return `{ reports, kept, beaconLines }`. → verify: node --test plugins/zeroh-roadmap/cli/lib/landing.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          description:
            'runLand calls carryLaneEvidence right after mergeLessons (before disposeSource) and prints `carried N gate report(s), M beacon line(s) into <primary>`; a carry failure is reported on stderr and does NOT abort the land (evidence is best-effort, the ref move already happened). → verify: node --test plugins/zeroh-roadmap/cli/commands/phase.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'landing.test.mjs: a lane with two reports and a three-line beacon lands into a primary that already holds one same-named report and one of the beacon lines → the primary ends with both reports (the pre-existing one byte-identical, reported kept) and three beacon lines; a lane without a .gate dir carries zero and does not throw',
        'phase.test.mjs: runLand output names the carried counts and the primary path; a throwing carry leaves exit 0 with the failure on stderr',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/landing.mjs', 'plugins/zeroh-roadmap/cli/lib/landing.test.mjs', 'plugins/zeroh-roadmap/cli/commands/phase.mjs', 'plugins/zeroh-roadmap/cli/commands/phase.test.mjs'],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone: 'Carried novel lane gate reports and executor beacon lines into the primary checkout before lane disposal, while preserving same-named primary reports byte-for-byte.',
        how: 'Added a filesystem evidence carrier with exact-line beacon deduplication, wired it after the existing lesson merge, and made carry failures visible but non-fatal after a successful ref move. Independent test-engineer RED cases covered copy, keep, deduplication, output, and failure behavior before the implementation passed both focused suites.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
      done: true,
      doneDate: '2026-09-03',
      interfaces: { consumes: [], produces: ['carryLaneEvidence'] },
    },
    {
      id: '28.2',
      title: 'The adherence scorer reads committed evidence when the checkout-local twin is absent',
      problem:
        'adherence.mjs: `curation-evidence` and `verify-complete-passed` read only latestGateReport (checkout-local), `tripwires-ran` only the beacon file, and `one-commit-per-task` only current `git log` subjects (squashed by curation). The committed record `arc-evals/phase-<N>.peval.json` (eval-collect.mjs:324) carries the gate block but no curation or verify-complete stamp.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
          description:
            'The per-phase record writer stamps `record.gate.curated` (boolean: the report carries a curation record) and `record.gate.verifyComplete` (`"passed"` when the report notes record it, else absent) from the report it already reads for roundsLowOnly (line 432 region). → verify: node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/adherence.mjs',
          description:
            "`curation-evidence` / `verify-complete-passed` pass on the report OR the peval stamps; `one-commit-per-task` also passes for a done task carrying its `commit` sha (the PhaseTaskShape field do-phase persists before curation squashes the subject away; the curation record stores only squashedCount + landedSubjects, curate.mjs:210); `tripwires-ran` with NO beacon file returns applicable:false with evidence `beacon absent (checkout-local; land carries it since phase 28)` — never a fail. → verify: node --test plugins/zeroh-roadmap/cli/lib/adherence.test.mjs",
        },
      ],
      acceptanceCriteria: [
        'adherence.test.mjs: a phase with no .gate dir and no beacon but a peval stamped curated + verifyComplete passed scores those two checks passed and tripwires-ran not applicable; the same phase with a report present is scored from the report; a curated single-commit phase passes one-commit-per-task when every done task carries a `commit` sha and fails when one lacks both the sha and a matching subject',
        '`roadmap eval adherence 26` in the primary after this task scores curation-evidence and verify-complete-passed from the committed record (observed before: both fail)',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/eval-collect.mjs', 'plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs', 'plugins/zeroh-roadmap/cli/lib/adherence.mjs', 'plugins/zeroh-roadmap/cli/lib/adherence.test.mjs'],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone: 'Projected curation and verify-complete evidence into committed phase eval records and taught adherence scoring to use it when checkout-local evidence is absent.',
        how: 'Passed the source gate report into record assembly, extended both synchronized consumer schemas, added authoritative local-report versus peval fallback logic, made absent post-land beacons not applicable, and accepted recorded task commit SHAs after curation. Independent RED tests drove each boundary; no new guard was introduced.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
      done: true,
      doneDate: '2026-09-03',
      dependsOn: ['28.1'],
      interfaces: { consumes: [], produces: ['record.gate.curated', 'record.gate.verifyComplete'] },
    },
    {
      id: '28.3',
      title: 'Journal lookups discriminate on the worktree, and a journal filename admits an arm label',
      problem:
        'findJournal (codex-journal.mjs:90) returns the first journal covering the ids; driverReconcile (gate.mjs:657) and codexLaneSource (phase.mjs:335) call it with the phase number only, so a second arm of the same phase reconciles against the wrong launcher and `codex run` cannot even create the second journal (`codex-<N>.json` already exists).',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/codex-journal.mjs',
          description:
            'findJournal(root, ids, lane, { worktree } = {}): when `worktree` is given, a parsed journal whose `worktree` is a different directory (samePath false) is skipped, neither returned nor a failure; LANES.run journalRe/closedRe admit an optional label segment `codex-<ids>.<label>.json` (label `[a-z0-9]+`, never `closed`), journalPath takes `{ label }`. → verify: node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            'driverReconcile passes `{ worktree: cwd }` whenever cwd is not the main checkout, and findClosedJournal gets the same option; the UNRECONCILED note names the worktree it looked for. → verify: node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            '`codex run <N> --label <l>` names the journal, report twin and log with the label; the already-exists guard is per filename so two labelled arms of one phase coexist; codexLaneSource in phase.mjs passes `{ worktree: cwd }`. → verify: node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs plugins/zeroh-roadmap/cli/commands/phase.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'codex.test.mjs: two journals for phase 7 (one per worktree) → findJournal with each worktree returns its own; without the option the exact-path journal wins as before; a `.opus` labelled journal is found by the live scan and its `.opus.closed.json` twin by findClosedJournal',
        'gate.test.mjs: --verify-complete in worktree B with a phase-7 journal for worktree A and none for B reconciles as an inline session (no problem), and with a B journal reconciles against B',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/codex-journal.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs', 'plugins/zeroh-roadmap/cli/commands/gate.mjs', 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs', 'plugins/zeroh-roadmap/cli/commands/phase.mjs'],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone: 'Made live and closed journal lookup worktree-aware and added optional labels across journal filenames and codex-run artifacts.',
        how: 'Extended the shared journal grammar and path helpers, filtered lookups by resolved worktree, threaded the option through gate reconciliation and phase landing, and added validated --label handling for journal, prompt, report, and log artifacts. Independent RED tests drove the collision and label boundaries before all focused suites passed.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
      done: true,
      doneDate: '2026-09-03',
      interfaces: { consumes: [], produces: ['findJournal opts.worktree', 'journalPath opts.label', 'codex run --label'] },
    },
    {
      id: '28.4',
      title: 'executor-arm --worktree writes a lane-shaped journal so a session-run worktree arm can phase land',
      problem:
        "A headless Claude arm run in a session-made worktree (`git worktree add`) has no journal: `--verify-complete` cannot reconcile its driver and `phase land` refuses it (`not a journal-confirmed codex lane`), so the phase-7 trial winner was fast-forwarded by hand. executor-arm.mjs writes only the session sidecar.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/executor-arm.mjs',
          description:
            "`executor-arm <N> --session <id> --worktree <dir> [--label <l>] [--models …]` additionally writes `<primary>/.building/codex-<N>[.<label>].json` with `{ phases:[N], lane:'run', driver:{ model:<resolved executor model>, lane:'session' }, worktree:<dir>, base:<HEAD of dir>, pgid:null, startedAt, modelPolicy }` via `writeJournal(root, journal, { label })` — a new codex-journal.mjs export extracted from launch()'s inline journal write in codex.mjs so both launchers share one shape; a live journal for that filename refuses. → verify: node --test plugins/zeroh-roadmap/cli/commands/executor-arm-disarm.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/test/fixture-consumer/lifecycle.test.mjs',
          description:
            'Fixture direction: arm a phase into a session-made worktree, commit a curated phase there, `phase land <N>` from that worktree lands by fast-forward, disposes the worktree and archives the journal as `.closed.json` with closedBy `phase land`. → verify: node --test plugins/zeroh-roadmap/test/fixture-consumer/lifecycle.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'executor-arm-disarm.test.mjs: --worktree writes the journal with driver.lane session and the resolved model; a second arm for the same phase with a different label coexists; without --label a live same-name journal refuses (exit 2)',
        'lifecycle.test.mjs: the session-worktree land succeeds end to end under executionIsolation primary',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/executor-arm.mjs', 'plugins/zeroh-roadmap/cli/commands/executor-arm-disarm.test.mjs', 'plugins/zeroh-roadmap/cli/lib/codex-journal.mjs', 'plugins/zeroh-roadmap/test/fixture-consumer/lifecycle.test.mjs'],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone: 'Made executor-arm create lane-shaped, label-aware session journals and proved that a session worktree can land, dispose, and archive its journal end to end.',
        how: 'Extracted the shared journal writer, resolved the executor model and target worktree HEAD, refused live filename collisions, and exercised both the command boundary and real fixture-consumer lifecycle. The executor behavioral tests were RED before production changes and both named suites passed under capbuild.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'The lifecycle regression was added after the initial executor-arm RED capture; it passed targeted and full fixture-suite GREEN but has no separately recorded pre-implementation RED.',
      },
      done: true,
      doneDate: '2026-09-03',
      dependsOn: ['28.3'],
      interfaces: { consumes: ['journalPath opts.label from 28.3', 'findJournal opts.worktree from 28.3'], produces: ['executor-arm --worktree'] },
    },
    {
      id: '28.5',
      title: 'The Co-Authored-By trailer names the driver that did the work',
      problem:
        "curate.mjs:228 hardcodes `Co-Authored-By: Claude <noreply@anthropic.com>` and codex.mjs:150 dictates `Claude Fable 5` for every lane, so a gpt-5.6-sol lane's commits are misattributed and lanes hand-edit curated messages (phase 26 did).",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/roles.mjs',
          description:
            "Export `driverTrailer(model)`: a claude model id maps to `Co-Authored-By: Claude <Family> <Version> <noreply@anthropic.com>` (opus/sonnet/fable/haiku with the version digits), a gpt/sol id to `Co-Authored-By: Codex <model> <noreply@openai.com>`, null/unknown to the generic `Claude` line; pure, table-driven. → verify: node --test plugins/zeroh-roadmap/cli/lib/roles.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/curate.mjs',
          description:
            'The composer takes the driver model (phase executionResult.driver.model, else the majority `model` over gateRounds, else null) and ends the body with driverTrailer(model) instead of TRAILER; codex.mjs builds its commit-trailer prompt line from the same helper with the resolved lane model. → verify: node --test plugins/zeroh-roadmap/cli/lib/curate.test.mjs plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'roles.test.mjs: claude-opus-5 → Claude Opus 5; claude-fable-5-1 → Claude Fable 5.1; gpt-5.6-sol → Codex gpt-5.6-sol; null → Claude',
        'curate.test.mjs: a phase whose driver is gpt-5.6-sol composes the Codex trailer; codex.test.mjs: the prompt names the lane model in its trailer line',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/roles.mjs', 'plugins/zeroh-roadmap/cli/lib/roles.test.mjs', 'plugins/zeroh-roadmap/cli/lib/curate.mjs', 'plugins/zeroh-roadmap/cli/lib/curate.test.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone: 'Generated Co-Authored-By trailers from the actual driver model for curated commits and Codex lane prompts.',
        how: 'Added a pure model-to-trailer helper, selected curation attribution from executionResult with gate-round majority fallback, and built the lane prompt trailer from the resolved Codex driver. RED mapping and curation tests preceded implementation; all named suites passed.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
      done: true,
      doneDate: '2026-09-03',
      interfaces: { consumes: [], produces: ['driverTrailer'] },
    },
    {
      id: '28.6',
      title: 'Recording a round past the cap requires a named override, and the record counts it',
      problem:
        "`gate round-brief` returns rule cap at the fifth round but `gate run --record-round` accepts any round number, so phase 26 recorded rounds 6-10 with no trace of a decision. The cap is advisory prose today.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            "--record-round with `round` greater than the resolved cell's correctness cap refuses (exit 2, names the cap and `--cap-override \"<reason>\"`) unless `--cap-override <reason>` is given, in which case the round entry is stored with `capOverride: <reason>`; the literal `5` inline in round-brief (gate.mjs:611 region, `correctnessRounds.length >= 5 || last.round >= 5`) becomes `CORRECTNESS_ROUND_CAP` exported from one home and read by both paths. → verify: node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
          description:
            'The per-phase record gains `gate.roundsPastCap` (count of recorded rounds above the cap) beside roundsLowOnly, and the scorecard surfaces it per driver. → verify: node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'gate.test.mjs: recording round 6 on a logic cell refuses with the cap named; with --cap-override it records and the entry carries the reason; round 5 records without one',
        'eval-collect.test.mjs: a report with rounds 0-7 yields roundsPastCap 2 (cap 5) and the scorecard row carries it',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/gate.mjs', 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs', 'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs', 'plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs'],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone: 'Enforced the correctness-round cap at record time, persisted named overrides, and surfaced rounds past cap in phase evals and driver scorecards.',
        how: 'Centralized the cap constant, validated --cap-override reasons, extended report and eval schemas, counted evidenced rounds above the cap, and aggregated the metric per driver. Independent focused tests failed on the missing refusal and metric before implementation; the full gate and eval suites then passed.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
      done: true,
      doneDate: '2026-09-03',
      interfaces: { consumes: [], produces: ['--cap-override', 'record.gate.roundsPastCap'] },
    },
  ],
  notes:
    'interview: skipped — every item is a recorded incident from the 2026-09-02/03 supervising session (handoff + phase-26 lane report), planned by that session; no user-owned fork exists. ' +
    'Hypotheses: see the docblock ## Hypotheses (three, one CONFIRMED cause per defect, one REFUTED rival). ' +
    'Not user-facing (plugin lane mechanics; no consumer flag applies). ' +
    'Verify rehearsal attestation: the five assumption probes were executed 2026-09-03 at plan time in the primary (all exit 0, the last by absence of roadmap/.gate/26); every step verify is a node --test invocation of a named suite whose new cases are the RED half of the tdd task, so each can fail. ' +
    'Review 2026-09-03 (Mode A, inline, claude-fable-5-1): anchors re-verified at HEAD (phase.mjs:431, gate.mjs:657, phase.mjs:335, curate.mjs:228, codex.mjs:150, eval-collect.mjs:324/432, gate.mjs:611); three prose-mechanism repairs applied — the curation record carries landedSubjects not task ids (28.2 now keys on task.commit), codex-journal.mjs exports no writer (28.4 extracts one), the round cap is an inline literal (28.6 names the constant). testMode tdd ratified for every task (each adds RED cases to an existing suite); reviewScope full; no licensing. Ordering: 28.1 → 28.2 (the scorer fallback is what makes 28.1 worth having); 28.3 → 28.4 (the label + worktree option); 28.5 and 28.6 stand alone. ' +
    'Evidence carry is best-effort by design (28.1): a land whose ref move succeeded must not report failure because a copy did.',
})
