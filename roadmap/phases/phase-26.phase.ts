import { definePhase } from '@/lib/roadmap/schema'

/**
 * Protocol diet with a ruler — trim the never-trimmed skills and cards, measured by adherence.
 *
 * The 2026-08 gauntlet rewrote five skills and KEPT six originals (do-phase, do-arc, arc-sweep,
 * validate-arc, release-sweep, test-strategy) on the strength of blind trials; the agent cards
 * were never in it. Those originals are now the biggest model-loaded bodies (do-phase 184 lines
 * / 12.2 KB, do-arc 150 / 10.3 KB, arc-sweep 129 / 8.9 KB, phase-executor card 106 / 7.5 KB) and
 * the do-arc flow loads 13,339 tokens before a phase file is read. The lessons sidecars carry
 * executor lapses that read like overload (a blind replace that silently no-op'd, a guard whose
 * matcher and mutation plant came from one agent, verify clauses re-keyed mid-flight) — but the
 * gauntlet's first lesson stands: 40% of rewrites that read better were regressions only a trial
 * caught, and load-bearing sentences are invisible to inspection. So this phase does NOT cut by
 * taste and does NOT run a with/without pair. It (1) writes a per-paragraph trim map with a named
 * disposition and evidence for every passage, (2) builds an adherence scorer that reads what a
 * landed phase left behind (beacons, commits, records, gate reports) so protocol-following is a
 * number, with the last landed phases as the free baseline, (3) applies the map, and (4) executes
 * real queued phases under the trimmed protocol with BOTH drivers the estate runs — claude-opus-5
 * and gpt-5.6-sol — scoring each run and restoring, passage by passage, whatever a lapse proves
 * load-bearing. Owner ruling 2026-09-02 21:28Z.
 *
 * ## Hypotheses
 * 1. CONFIRMED — no adherence measure exists: `roadmap eval` dispatches merge-judge / trend /
 *    restamp / lesson / scorecard / propose (eval.mjs:121-126) and nothing scores whether a phase
 *    followed the protocol; the scorecard counts rounds and minutes only.
 * 2. CONFIRMED — the evidence to score from exists per phase: beacon events (`executor-start`,
 *    `task-start`, `commit`, `gate-stage-start/end`, `phase-complete`, `escalated`, `resume`,
 *    `result-returned` — beacon.mjs closed vocabulary, per-phase file at
 *    `<worktree>/.building/<phase>-executor.jsonl`), per-task commits under the binding grammar,
 *    transparencyReports with six fields, gateRounds with model, curation evidence on the report
 *    (gate-report.mjs:76 CurationShape), executionResult.roles, lessons.jsonl `phase` field —
 *    and, after phase 25, typed findings per round.
 * 3. CONFIRMED — the diet has a standing grammar and bar: DIET-LEDGER.md requires one disposition
 *    row per removed passage (enforced-by-code | relocated | obsolete-with-evidence) and the
 *    operator ruling of 2026-08-24 says bodies carry operative rules only, incident archeology
 *    lives in git history; measure-budget.mjs moves the ceiling down only by a diet.
 * 4. REFUTED — "R7 already bounds these": SKILL-AUTHORING-STANDARD R7 caps a workflow body at 200
 *    lines and every kept original is under it (184, 150, 129, 106, 105); the constraint that
 *    bites is tokens loaded per flow, which R7 does not measure.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 26,
  name: 'Protocol diet with a ruler: trim map, adherence scorer, the trims, and a two-driver execution trial',
  status: 'done',
  completedDate: '2026-09-03',
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1861,
      total: 1861,
      notes: 'Authoritative capped full gate roadmap/.gate/26/run-000010-2026-09-03T07-33-26-765Z.json was GREEN; the unit slot completed in 1,749,808 ms and the schema suite also passed.',
    },
    integrationTests: { passed: 0, total: 0, notes: 'declared-none for this logic phase.' },
    e2eTests: { passed: 0, total: 0, notes: 'declared-none; no rendered surface.' },
    build: 'clean',
  },
  gateRounds: [
    { round: 0, agent: 'quality-pass', model: 'gpt-5.6-sol', verdict: 'clean', findings: [], summary: 'Removed a speculative applicability helper; focused adherence tests stayed green.' },
    {
      round: 1, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'findings-fixed', summary: 'Closed two HIGH evidence-validation gaps and restored the reviewer severity rubric.',
      findings: [
        { file: 'plugins/zeroh-roadmap/cli/lib/adherence.mjs', severity: 'HIGH', confidence: 98, description: 'Mutation proof accepted generic gate-note boilerplate instead of task transparency evidence.', fixedInCommit: '1e552f3' },
        { file: 'plugins/zeroh-roadmap/cli/lib/adherence.mjs', severity: 'HIGH', confidence: 97, description: 'Verify-clause stability inspected only uncommitted changes.', fixedInCommit: '1e552f3' },
        { file: 'plugins/zeroh-roadmap/agents/code-reviewer.md', severity: 'MEDIUM', confidence: 100, description: 'The reviewer card referenced a nonexistent severity rubric.', fixedInCommit: '1e552f3' },
      ],
    },
    {
      round: 2, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'findings-fixed', summary: 'Bound proof matching to each applicable task and verify exceptions to exact changed clauses.',
      findings: [
        { file: 'plugins/zeroh-roadmap/cli/lib/adherence.mjs', severity: 'HIGH', confidence: 96, description: 'One loosely matching task proof could cover all new guards and restore counted as a decoy.', fixedInCommit: '1e552f3' },
        { file: 'plugins/zeroh-roadmap/cli/lib/adherence.mjs', severity: 'HIGH', confidence: 94, description: 'Unrelated limitation prose could excuse committed verify-clause rewrites.', fixedInCommit: '1e552f3' },
      ],
    },
    {
      round: 3, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'findings-fixed', summary: 'Replaced speculative syntax-token guard detection with explicit per-task applicability.',
      findings: [
        { file: 'plugins/zeroh-roadmap/cli/lib/adherence.mjs', severity: 'HIGH', confidence: 98, description: 'Two syntax tokens could not identify every conformance guard and allowed a vacuous pass.', fixedInCommit: '1e552f3' },
      ],
    },
    { round: 4, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'clean', findings: [], summary: 'Independent closure found no remaining actionable correctness issue.' },
    {
      round: 5, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'findings-fixed', summary: 'Closed the consumer schema seam and completed idempotence and refusal-path coverage.',
      findings: [
        { file: 'lib/roadmap/schema.ts', severity: 'HIGH', confidence: 100, description: 'The consumer schema still stripped structured gate-round model attribution.', fixedInCommit: '1e552f3' },
        { file: 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs', severity: 'MEDIUM', confidence: 100, description: 'Completion-note tests lacked idempotence and consistency and attribution refusal assertions.', fixedInCommit: '1e552f3' },
      ],
    },
    { round: 6, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'clean', findings: [], summary: 'Independent closure verified both schema homes and completion-note refusal paths; no actionable findings.' },
    {
      round: 7, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'findings-fixed', summary: 'Corrected queue lookup to use the newest global queue commit rather than a path-limited first-add fallback.',
      findings: [
        { file: 'plugins/zeroh-roadmap/cli/lib/adherence.mjs', severity: 'HIGH', confidence: 100, description: 'Real queue commits touch backlog.ts, so path-limited oldest-first lookup missed the queue baseline.', fixedInCommit: '1e552f3' },
      ],
    },
    {
      round: 8, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'findings-fixed', summary: 'Made queue-subject matching phase-exact and added a numeric-collision regression.',
      findings: [
        { file: 'plugins/zeroh-roadmap/cli/lib/adherence.mjs', severity: 'HIGH', confidence: 99, description: 'Fixed-string queue lookup matched phase 7 against newer phase 70 queues.', fixedInCommit: '1e552f3' },
      ],
    },
    { round: 9, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'clean', findings: [], summary: 'Independent closure verified exact newest queue matching and collision coverage; no actionable findings.' },
    { round: 10, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'clean', findings: [], summary: 'Independent closure verified clause-specific fingerprints and phase adherence score 1; no actionable findings.' },
  ],
  metrics: {
    commits: 9,
    linesAdded: 1454,
    linesRemoved: 510,
    filesChanged: 32,
    testsAtStart: 1838,
    testsAtEnd: 1863,
    testsAdded: 25,
    startedAt: '2026-09-02T23:04:32Z',
    completedAt: '2026-09-03T08:07:45Z',
    haltCount: 1,
  },
  compromises: 'None',
  executionResult: {
    phase: 26,
    status: 'done',
    driver: { model: 'gpt-5.6-sol', lane: 'codex' },
    modelPolicy: { source: 'config', preset: 'codex' },
    roles: [
      { role: 'software-architect', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'test-engineer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'software-architect', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'software-architect', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'quality-pass', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
    ],
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      'The resumed lane correctly skipped tasks 26.1–26.3 because their done flags and matching commits were already present.',
      'The first full gate exposed stale generated configuration schema; regeneration and its focused regression suite closed the drift before the authoritative green run.',
      'The curator emitted a generic Claude trailer; the curated commit message was corrected immediately to the binding Claude Fable 5 trailer without changing its tree.',
    ],
    hardStops: [],
    gateRounds: 11,
  },
  plannedBy: { model: 'claude-fable-5-1' },
  reviewRecord: { date: '2026-09-02', model: 'claude-fable-5-1', verdict: 'READY', via: 'executed' },
  category: 'refactor',
  kind: 'logic',
  source:
    'Owner ruling 2026-09-02 21:28Z: plan a trimming phase for the skills the gauntlet did not trim (do-phase, do-arc, and siblings); decide WHAT to trim first, then how to test — not with-and-without, but by executing under the trimmed protocol with opus-5 and sol-5.6. Evidence: the 2026-09-02 gate mining (rounds 1.3 → 3.4-4.8 per phase; executor lapses in lessons.jsonl across four repos).',
  priority: 'HIGH',
  dependsOn: [25],
  conflictsWith: [24, 25],
  keyFiles: [
    'plugins/zeroh-roadmap/DIET-PLAN-2026-09.md',
    'plugins/zeroh-roadmap/DIET-LEDGER.md',
    'plugins/zeroh-roadmap/cli/commands/eval.mjs',
    'plugins/zeroh-roadmap/cli/lib/adherence.mjs',
    'plugins/zeroh-roadmap/cli/lib/adherence.test.mjs',
    'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
    'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
    'plugins/zeroh-roadmap/skills/arc-sweep/SKILL.md',
    'plugins/zeroh-roadmap/skills/validate-arc/SKILL.md',
    'plugins/zeroh-roadmap/skills/release-sweep/SKILL.md',
    'plugins/zeroh-roadmap/agents/phase-executor.md',
    'plugins/zeroh-roadmap/agents/quality-pass.md',
    'plugins/zeroh-roadmap/agents/code-reviewer.md',
    'plugins/zeroh-roadmap/agents/software-architect.md',
    'plugins/zeroh-roadmap/cli/lib/measure-budget.mjs',
    'plugins/zeroh-roadmap/DIET-TRIAL-2026-09.md',
  ],
  stakeholderDemo:
    'Every passage of the nine biggest never-trimmed skills and cards has a named disposition with evidence; `roadmap eval adherence <N>` scores any landed phase from its records and the ten phases before the trim form the baseline; the trimmed protocol loads measurably fewer tokens per flow; two real phases executed under it by claude-opus-5 and gpt-5.6-sol score at or above baseline on adherence, rounds and findings — and any passage whose absence a run exposes is restored with a ledger row saying which run proved it.',
  userFacing: false,
  assumptions: [
    {
      claim: 'No adherence scorer and no trim map exist.',
      verify: 'bash -c "test \\"$(grep -c adherence plugins/zeroh-roadmap/cli/commands/eval.mjs)\\" = \\"0\\" && test ! -f plugins/zeroh-roadmap/cli/lib/adherence.mjs && test ! -f plugins/zeroh-roadmap/DIET-PLAN-2026-09.md"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The never-trimmed bodies are at their measured sizes (do-phase ≥180 lines, do-arc ≥145, phase-executor card ≥100).',
      verify: 'bash -c "test \\"$(wc -l < plugins/zeroh-roadmap/skills/do-phase/SKILL.md)\\" -ge 180 && test \\"$(wc -l < plugins/zeroh-roadmap/skills/do-arc/SKILL.md)\\" -ge 145 && test \\"$(wc -l < plugins/zeroh-roadmap/agents/phase-executor.md)\\" -ge 100"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The do-arc protocol-load ceiling stands at 13,339 (phase 23 ruling) and moves down only by a diet.',
      verify: 'bash -c "grep -qF \'PROTOCOL_LOAD_BUDGET_TOKENS = 13339\' plugins/zeroh-roadmap/cli/lib/measure-budget.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The fixture-consumer harness can build a landed-looking phase for scorer tests.',
      verify: 'bash -c "grep -qF \'export function makeFixtureRepo\' plugins/zeroh-roadmap/test/fixture-consumer/harness.mjs && grep -qF \'export function writePhaseFile\' plugins/zeroh-roadmap/test/fixture-consumer/harness.mjs"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '26.1',
      title: 'The trim map: every passage of nine files gets a disposition and its evidence, architect-ratified',
      problem:
        'Nothing says which sentences of do-phase, do-arc, arc-sweep, validate-arc, release-sweep and the four big cards are load-bearing; cutting by inspection is the failure the gauntlet measured at 40%.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/DIET-PLAN-2026-09.md',
          description:
            "One table per file (the five skills + the phase-executor, quality-pass, code-reviewer and software-architect cards), one row per paragraph/bullet in the row grammar of notes §Row grammar (anchor · class · disposition · evidence); a roll-up per file (lines/tokens before, projected after) and projected per-flow ceilings. Rule: a passage citing an incident is relocated, never cut → verify: bash -c \"test -f plugins/zeroh-roadmap/DIET-PLAN-2026-09.md && grep -qF 'skills/do-phase/SKILL.md' plugins/zeroh-roadmap/DIET-PLAN-2026-09.md && grep -qF 'agents/phase-executor.md' plugins/zeroh-roadmap/DIET-PLAN-2026-09.md\"",
        },
        {
          file: 'plugins/zeroh-roadmap/DIET-PLAN-2026-09.md',
          description:
            'software-architect ratification per its Decision Contract over the WHOLE map (one call, not per row): PROCEED for the map as amended, or ESCALATE naming the passages in doubt; the verdict and its amendments are appended to the map under "## Ratification" with the model id. Cuts marked obsolete-with-evidence carry the evidence line the ledger grammar demands → verify: bash -c "grep -qF \'## Ratification\' plugins/zeroh-roadmap/DIET-PLAN-2026-09.md"',
        },
      ],
      acceptanceCriteria: [
        'Nine files mapped with no unclassified paragraph (the row count per file equals the paragraph count, stated in the roll-up); every relocate names its target reference; every enforced-by-code names an existing command or test path; the architect ratification block is present with the deciding model',
      ],
      files: ['plugins/zeroh-roadmap/DIET-PLAN-2026-09.md'],
      testMode: 'none',
      transparencyReport: {
        whatWasDone: 'Mapped every Markdown paragraph across the five target skills and four agent cards, with per-file counts, dispositions, evidence, projections, and architect ratification.',
        how: 'Enumerated blank-line-delimited source blocks, recorded one row per block, then incorporated the resolved claude-fable-5 Decision Contract review as binding row overrides, clause splits, evidence rules, and measured-flow arithmetic. No new guard was introduced.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'The projection remains a pre-edit byte estimate; task 26.3 must replace it with exact roadmap measure output and may not invent cuts if the 15% floor is missed.',
      },
      done: true,
      doneDate: '2026-09-02',
    },
    {
      id: '26.2',
      title: 'roadmap eval adherence: protocol-following scored from what a landed phase left behind',
      problem:
        'The scorecard can count rounds and minutes but cannot say whether an executor ran the tripwires, committed per task, recorded rounds with a model, quoted mutation proofs, curated, or flushed lessons — so a trimmed protocol has no ruler and the driver comparison the owner wants has no number.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/adherence.mjs',
          description:
            "`scoreAdherence(toplevel, phase)` → { phase, driver, checks: [{ id, applicable, passed, evidence }], score }, the twelve checks of notes §Checks, each abstaining when its artifact class is absent (a legacy phase never fails a convention that postdates it); score = passed ÷ applicable → verify: bash -c \"grep -qF 'export function scoreAdherence' plugins/zeroh-roadmap/cli/lib/adherence.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/adherence.test.mjs >/dev/null 2>&1\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/eval.mjs',
          description:
            '`roadmap eval adherence <N> [--json]` and `--since <YYYY-MM-DD>` (every done phase completed on/after the date → a table: phase, driver, score, failed check ids); dispatch beside scorecard (eval.mjs:121-126). The baseline run (`--since` covering the last ten landed phases here) is pasted into DIET-PLAN-2026-09.md §Baseline before any trim lands → verify: bash -c "grep -qF \'adherence\' plugins/zeroh-roadmap/cli/commands/eval.mjs && grep -qF \'## Baseline\' plugins/zeroh-roadmap/DIET-PLAN-2026-09.md && cd plugins/zeroh-roadmap && capbuild node --test cli/commands/eval.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'Fixture phases prove every check in both directions (a phase with the artifact passes, one without fails, a legacy phase abstains); the baseline table for the last ten landed phases is in the plan with per-driver means; the verb never throws on a phase that predates a convention',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/adherence.mjs', 'plugins/zeroh-roadmap/cli/lib/adherence.test.mjs', 'plugins/zeroh-roadmap/cli/commands/eval.mjs', 'plugins/zeroh-roadmap/cli/commands/eval.test.mjs', 'plugins/zeroh-roadmap/DIET-PLAN-2026-09.md'],
      testMode: 'tdd',
      dependsOn: ['26.1'],
      interfaces: { consumes: ['AgentRoundShape.findings from 25.1'], produces: ['scoreAdherence', 'roadmap eval adherence'] },
      transparencyReport: {
        whatWasDone: 'Added a twelve-check adherence scorer, single-phase and date-slice CLI modes, fixture coverage in both directions with legacy abstention, and the pre-trim ten-phase baseline.',
        how: 'The native gpt-5.6-sol test-engineer authored the RED suite first (14 tests, all failing on the absent module); implementation then read phase, beacon, Git, gate, curation and lesson evidence. Mutation proof for the adherence tree guard: removed transparency `how` from the complete fixture → RED (`six-field-transparency-reports` passed false); renamed the check-id anchor → RED (`adherence: unknown check id six-field-transparency-reports`); planted the nearest legal decoy in gate notes while task proof stayed absent → GREEN (the guard still rejected the decoy, 14/14 suite green).',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'Historical artifacts absent from the current worktree cannot be reconstructed, so the baseline names their failed checks; no claude-opus-5 run appears in the last-ten slice and its mean is unrecorded.',
      },
      done: true,
      doneDate: '2026-09-02',
    },
    {
      id: '26.3',
      title: 'Apply the map: bodies shrink, references grow, ledger rows land, ceilings ratchet down',
      problem:
        'The nine files carry rationale, restated rules and single-branch detail in the always-loaded body; the map says where each passage goes, and the ledger grammar demands a row per removal.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
          description:
            'Apply every relocate/cut row of the map to the five skills, creating the named references/ files with the moved text (cited at point of use per R8); the four cards likewise (agents/references/). One DIET-LEDGER.md row per removed passage in the ledger grammar. Skills with evals.json keep them green → verify: bash -c "test \\"$(wc -l < plugins/zeroh-roadmap/skills/do-phase/SKILL.md)\\" -lt 150 && test \\"$(wc -l < plugins/zeroh-roadmap/skills/do-arc/SKILL.md)\\" -lt 125 && grep -qF \'2026-09 diet\' plugins/zeroh-roadmap/DIET-LEDGER.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/measure-budget.mjs',
          description:
            'PROTOCOL_LOAD_BUDGET_TOKENS ratchets DOWN to the measured post-diet do-arc total (the only legal downward move), with the budget-coupled eval-proposal fixtures re-based as the 2026-08-24 pass did; do-phase and plan-arc totals recorded before/after in the ledger roll-up; roles.test envelope ratchet green → verify: bash -c "! grep -qF \'PROTOCOL_LOAD_BUDGET_TOKENS = 13339\' plugins/zeroh-roadmap/cli/lib/measure-budget.mjs && cd plugins/zeroh-roadmap && n=$(grep -oE \'PROTOCOL_LOAD_BUDGET_TOKENS = [0-9]+\' cli/lib/measure-budget.mjs) && node bin/roadmap.mjs measure --flow do-arc --assert ${n##* } >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The do-arc flow loads at least 15% fewer tokens than 13,339 and the ceiling equals the new measured total; every removed passage has a ledger row; no references/ file exists without a body cite (R8); all skill evals and the plugin suite stay green',
      ],
      files: [
        'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
        'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
        'plugins/zeroh-roadmap/skills/arc-sweep/SKILL.md',
        'plugins/zeroh-roadmap/skills/validate-arc/SKILL.md',
        'plugins/zeroh-roadmap/skills/release-sweep/SKILL.md',
        'plugins/zeroh-roadmap/agents/phase-executor.md',
        'plugins/zeroh-roadmap/agents/quality-pass.md',
        'plugins/zeroh-roadmap/agents/code-reviewer.md',
        'plugins/zeroh-roadmap/agents/software-architect.md',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
        'plugins/zeroh-roadmap/cli/lib/measure-budget.mjs',
      ],
      batchMode: true,
      testMode: 'none',
      dependsOn: ['26.2'],
      transparencyReport: {
        whatWasDone: 'Applied the ratified diet across five skills and four role cards, preserved model-policy and spawn-site contracts, added local on-demand references, and ratcheted the do-arc ceiling to 10,788 tokens.',
        how: 'Reused the last independently gated concise forms as the mechanical base, recorded the 2026-09 dispositions, restored post-diet role anchors until roles.test passed 61/61, and rebased budget-coupled proposal fixtures to the exact 43,139-byte measurement. No new guard was introduced; the existing load-budget ratchet was lowered.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'The concise forms intentionally preserve operative rules while moving detail to references; the end-of-phase plugin gate remains responsible for detecting any integration regression outside the focused roles and proposal suites. The post-queue ceiling verify rewrite in 0791042 is authorized by clause-specific evidence ids verify-rewrite:b591badd0b6f and verify-rewrite:3192ba9c202d.',
      },
      done: true,
      doneDate: '2026-09-02',
    },
    {
      id: '26.4',
      title: 'The two-driver execution trial: real phases under the trimmed protocol, scored, with surgical restores',
      problem:
        'A trim that reads fine can still drop the sentence an executor needed; only executions show it, and the estate runs two drivers whose lapses differ. Without a scored run per driver the diet is an opinion.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/DIET-TRIAL-2026-09.md',
          description:
            'Protocol, written before the runs, per notes §Trial: two READY phases × two drivers (claude-opus-5 via a phase-executor spawn in a worktree slot; gpt-5.6-sol via `roadmap codex run <N> --worktree <tmp>`), same base sha, one landing per phase; scoring and the restore rule as stated there → verify: bash -c "test -f plugins/zeroh-roadmap/DIET-TRIAL-2026-09.md && grep -qF \'gpt-5.6-sol\' plugins/zeroh-roadmap/DIET-TRIAL-2026-09.md && grep -qF \'claude-opus-5\' plugins/zeroh-roadmap/DIET-TRIAL-2026-09.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/DIET-TRIAL-2026-09.md',
          description:
            'Run the four executions and record the table (phase × driver: adherence score, failed checks, rounds, findings by severity, minutes); apply the decision rule with one ledger row per restore; close with the verdict per driver and the measured post-trial flow totals → verify: bash -c "grep -qF \'## Results\' plugins/zeroh-roadmap/DIET-TRIAL-2026-09.md && grep -qF \'## Verdict\' plugins/zeroh-roadmap/DIET-TRIAL-2026-09.md"',
        },
      ],
      acceptanceCriteria: [
        'Four scored runs recorded; each driver\'s adherence on the trimmed protocol is at or above its baseline mean or the specific passages restored with evidence; the landed phases are the runs that passed their gates; the final flow totals in the ledger match `roadmap measure`',
      ],
      files: ['plugins/zeroh-roadmap/DIET-TRIAL-2026-09.md', 'plugins/zeroh-roadmap/DIET-LEDGER.md'],
      testMode: 'none',
      dependsOn: ['26.3'],
      transparencyReport: {
        whatWasDone:
          'Recorded all four two-driver trial runs, their adherence and review outcomes, the restore decisions, the selected landed winners, and exact post-trial protocol-load measurements.',
        how:
          'Used the pre-registered shared-base protocol, scored both claude-opus-5 and gpt-5.6-sol executions of phases 27 and 7, applied the restore rule to three keep-marked regressions exposed by the first Opus gate, and closed the trial after both selected winners appeared on the integration ref. No new guard was introduced.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'No historical claude-opus-5 baseline exists, so its two scores are reported without inventing a comparison mean; both gpt-5.6-sol runs exceed the available historical Sol mean.',
      },
      done: true,
      doneDate: '2026-09-03',
    },
  ],
  notes:
    'interview: conducted in-session 2026-09-02 21:28Z — the owner asked for a trimming phase aimed at the skills the gauntlet kept (do-phase, do-arc and siblings), deciding WHAT to trim first and then how to test, explicitly not a with/without pair, and testing execution under both estate drivers (opus-5, sol-5.6). The planner\'s shape: disposition map with evidence → adherence ruler with a historical baseline → apply → two-driver execution trial with surgical restores. The gauntlet archive (~/skill-gauntlet-archive-2026-08-14.tar.gz) stays sealed and unused; its lessons 1, 4 and 5 are the design constraints here. ' +
    'userFacing false: plugin protocol internals. testMode none on 26.1/26.3/26.4 (documents, prose moves under ledger rows, and a recorded trial); 26.3 batchMode by file count (mechanical moves under the ratified map). ' +
    'dependsOn 25: the trial scores findings by severity and the loop rules must be the ones the trimmed protocol will carry. conflictsWith 24 and 25: shared do-arc/do-phase bodies, reviewer and executor cards, DIET-LEDGER and the load ceiling — serialize behind both. ' +
    'Out of scope, recorded: trimming the five gauntlet-rewritten skills (they have sealed contracts and benchmarks; a re-run of THEIR trial is the honest path); trimming test-strategy, audit-roadmap, eval-arc (small; a later pass); a paired with/without trial (owner ruling); changing the drivers\' role bindings (phase 24 owns policy). ' +
    '## Row grammar (26.1): anchor (heading + first words) · class (contract | decision | vocabulary | gotcha | methodology | rationale | restated) · disposition (keep | relocate → references/<file> | enforced-by-code(<cmd|test>) | obsolete-with-evidence) · evidence (a lessons.jsonl line, a gate-round summary, an incident cite inside the passage, or the code that enforces it — never "seems unused"). ' +
    '## Checks (26.2): tripwires-ran (executor-start beacon precedes the first task-start) · one-commit-per-task (a `phase N — N.X` commit per done task) · six-field transparencyReports · gateRounds carry model · rounds carry findings (post-25) · guard mutation proofs quoted where the diff added a shape guard (a test whose body reads the tree: readdirSync/matchAll over sources) · curation evidence on the report · verify-complete passed (completion commit after the last green report) · no self-review round · plan verify clauses unchanged since the queue commit OR each rewrite named in a limitations field · lessons flushed when a resume/escalated beacon exists · executionResult.roles recorded. ' +
    '## Trial (26.4): the next two READY phases after this one (planned from roadmap/followups if fewer exist); four runs; the first green run of each phase lands, the other is scored and discarded; scoring per run = eval adherence, gate rounds, findings by severity (25.4), minutes per task; decision rule: a failed adherence check that the baseline passed → the map row whose cut covers it is RESTORED with a ledger row reverted-with-evidence naming the run; otherwise the trim stands. ' +
    'Verify rehearsal attestation: assumption probes executed 2026-09-02 at plan time — adherence 0 hits in eval.mjs, no adherence.mjs, no DIET-PLAN; line counts 184/150/106; the 13339 ceiling literal present; both harness exports present (all exit 0). Step verifies red-now via their grep halves (no plan file, no Ratification/Baseline headings, no adherence verb, line counts above the targets, the ceiling still 13339, no trial file); runner clauses inherit polarity from the grep representatives. Mode A review EXECUTED 2026-09-02 (claude-fable-5-1, standalone inline): anchors re-opened (eval.mjs:121-126 dispatch, beacon.mjs:50-120 paths + vocabulary, gate-report.mjs:76 curation, harness exports, DIET-LEDGER grammar, R7 caps, measure-budget 13339); H3 promise ledger: map→26.1, ruler+baseline→26.2, trims+ceiling→26.3, two-driver trial+restores→26.4, all covered; H4: the trial\'s four runs are the minimum that puts both drivers on both phases. [FIXED] three step descriptions carried the check list, row grammar and trial protocol inline — moved to notes sections the steps cite. Ratified: testMode none on 26.1/26.3/26.4, batchMode on 26.3, userFacing false, 4-task floor exception. Placement: depends on 25 and conflicts with 24 and 25 → the only non-adjacent slot is the tail → 5 of 5.',
})
