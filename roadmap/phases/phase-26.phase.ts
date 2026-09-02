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
  status: 'backlog',
  plannedBy: { model: 'claude-fable-5-1' },
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
      done: false,
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
      done: false,
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
            'PROTOCOL_LOAD_BUDGET_TOKENS ratchets DOWN to the measured post-diet do-arc total (the only legal downward move), with the budget-coupled eval-proposal fixtures re-based as the 2026-08-24 pass did; do-phase and plan-arc totals recorded before/after in the ledger roll-up; roles.test envelope ratchet green → verify: bash -c "! grep -qF \'PROTOCOL_LOAD_BUDGET_TOKENS = 13339\' plugins/zeroh-roadmap/cli/lib/measure-budget.mjs && cd plugins/zeroh-roadmap && node bin/roadmap.mjs measure --flow do-arc --assert $(grep -oE \'PROTOCOL_LOAD_BUDGET_TOKENS = [0-9]+\' cli/lib/measure-budget.mjs | grep -oE \'[0-9]+$\') >/dev/null 2>&1"',
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
      done: false,
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
      done: false,
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
    'Verify rehearsal attestation: assumption probes executed 2026-09-02 at plan time — adherence 0 hits in eval.mjs, no adherence.mjs, no DIET-PLAN; line counts 184/150/106; the 13339 ceiling literal present; both harness exports present (all exit 0). Step verifies red-now via their grep halves (no plan file, no Ratification/Baseline headings, no adherence verb, line counts above the targets, the ceiling still 13339, no trial file); runner clauses inherit polarity from the grep representatives.',
})
