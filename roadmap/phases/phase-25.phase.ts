import { definePhase } from '@/lib/roadmap/schema'

/**
 * Gate loop convergence — persist the reviewer's findings, stop on severity, review only the delta.
 *
 * Mined 2026-09-02 across four consumers (2,000 gated phase records, ~4,000 recorded rounds):
 * correctness rounds per phase rose from 1.3 (July, azure, 418 phases) to 3.4-4.8 (Aug-Sep, atlas
 * and this repo); a first correctness round is CLEAN 5-8% of the time now versus 34% in July;
 * 27-30% of phases hit the five-round cap and get triaged by the supervising session; a round
 * costs a median 15 min and a mean 25-40 min of wall clock. Reading the summaries: atlas rounds
 * are real product defects; this repo's late rounds are misplaced limitations text, doc
 * pointers, stale verify anchors and mutation-proof counts. Three structural causes, each a
 * rule rather than a rewrite — ruled by the owner 2026-09-02 21:07Z ("keep gate finding
 * results, delta-only diffs, don't loop if only low severity — address all found and close").
 *
 * ## Hypotheses
 * 1. CONFIRMED — the loop has no severity-gated stop: agents/code-reviewer.md:11-17 demands
 *    every finding at ≥80% confidence "minor findings are how regressions accumulate", LOW
 *    covers naming and dead code, and do-phase SKILL.md:112 ends the loop only on an empty
 *    array ("clean") or the cap; 87% of recorded rounds are `findings-fixed`.
 * 2. CONFIRMED — findings are not persisted: gate-report.mjs AgentRoundInputShape (:84-90)
 *    carries round/agent/verdict/summary/model only; the 11 `findings` mentions in gate.mjs are
 *    lint findings (history comments, deviant grammar), never the reviewer's; zero `.gate` files
 *    in any consumer carry a "severity" key. StructuredGateRoundShape (templates/schema.ts:149-162)
 *    already allows `findings: GateFinding[]` on a phase-record round — nothing writes it.
 * 3. CONFIRMED — rounds ≥2 have no scope rule: neither agents/code-reviewer.md (0 hits for
 *    delta/since) nor do-phase SKILL.md:112-118 tells a later round to review the delta since the
 *    previous round and verify the prior findings' closure; the one reviewer that did so on its
 *    own (atlas phase 40, "9 killed / 2 survived") converged.
 * 4. REFUTED — "the rise is a reviewer-model effect": by-driver means overlap (atlas: opus 2.9,
 *    sol 3.9, fable 4.8 rounds at n=5-18, confounded by phase kind and month) — no clean signal,
 *    and no severity data to separate defects from nits. Item 2 is what makes the question
 *    answerable; a blind trial is reserved for the skill-size question, not for these rules.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 25,
  name: 'Gate loop convergence: persisted reviewer findings, severity-gated stop, delta-only later rounds, eval slices',
  status: 'backlog',
  plannedBy: { model: 'claude-fable-5-1' },
  reviewRecord: { date: '2026-09-02', model: 'claude-fable-5-1', verdict: 'READY', via: 'executed' },
  category: 'feature',
  kind: 'logic',
  source:
    'Owner ruling 2026-09-02 21:07Z after the cross-repo gate mining: ship the three high-confidence rule fixes without a blind trial (persist findings; delta-only later rounds; only CRITICAL/HIGH continue the loop — MEDIUM/LOW are fixed and the round closes). Cost evidence: ~146 gate-fix commits in 90 days here alone at 25-40 min each.',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [24],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/gate-report.mjs',
    'plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
    'plugins/zeroh-roadmap/templates/schema.ts',
    'lib/roadmap/schema.ts',
    'plugins/zeroh-roadmap/agents/code-reviewer.md',
    'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
    'plugins/zeroh-roadmap/agents/phase-executor.md',
    'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
    'plugins/zeroh-roadmap/cli/lib/eval-score.mjs',
    'plugins/zeroh-roadmap/cli/lib/eval-scorecard.mjs',
  ],
  stakeholderDemo:
    'A phase whose round 1 returns two LOW and one MEDIUM finding is fixed in one commit and the gate closes with those three findings on record (severity, file, line, fixing commit); a round that returns a HIGH continues, and round 2 reviews only the commits since round 1 plus the closure of round 1\'s findings; every consumer\'s scorecard can say how many rounds were spent on LOW-only findings — the number that was unanswerable on 2026-09-02.',
  userFacing: false,
  assumptions: [
    {
      claim: 'The gate report round shape carries no findings and no sha, and the record-round verb has no round-brief sibling.',
      verify:
        'bash -c "test \\"$(grep -c findings plugins/zeroh-roadmap/cli/lib/gate-report.mjs)\\" = \\"0\\" && test \\"$(grep -c round-brief plugins/zeroh-roadmap/cli/commands/gate.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The phase-record round verdict enum is exactly clean | findings-fixed | skipped in both schema homes.',
      verify:
        'bash -c "grep -qF \\"verdict: z.enum([\'clean\', \'findings-fixed\', \'skipped\'])\\" plugins/zeroh-roadmap/templates/schema.ts && grep -qF \\"verdict: z.enum([\'clean\', \'findings-fixed\', \'skipped\'])\\" lib/roadmap/schema.ts"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'Neither the reviewer card nor do-phase scopes a later round to the delta since the previous round.',
      verify: 'bash -c "test \\"$(grep -ciE \'since the previous round|delta since|sinceSha\' plugins/zeroh-roadmap/agents/code-reviewer.md plugins/zeroh-roadmap/skills/do-phase/SKILL.md | grep -vc \':0$\')\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The loop stops only on clean or the cap: do-phase names the cap and no severity rule.',
      verify: 'bash -c "grep -qF \'correctness loop (cap 5)\' plugins/zeroh-roadmap/skills/do-phase/SKILL.md && ! grep -qiE \'only (CRITICAL|HIGH).*continue|severity-gated\' plugins/zeroh-roadmap/skills/do-phase/SKILL.md"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '25.1',
      title: 'Findings persist: record-round carries the reviewer\'s typed array and the recording sha',
      problem:
        'AgentRoundInputShape (gate-report.mjs:84-90) and AgentRoundShape (:44-52) drop everything but round/agent/verdict/summary/model; the reviewer\'s typed JSON (code-reviewer.md:51-56, the GateFindingShape contract) is echoed to chat and lost, so no record can say what severity a round found or which commit fixed it.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/gate-report.mjs',
          description:
            "A plugin-side `GateFindingRecordShape` mirroring templates/schema.ts:131-137 (file, line?, severity enum CRITICAL|HIGH|MEDIUM|LOW, confidence 80-100?, description ≥10, fixedInCommit ≥7?); AgentRoundInputShape and AgentRoundShape gain `findings: array(...).default([])`; appendAgentRound stamps `sha` (HEAD of the toplevel at record time, via gitroot) beside recordedAt. Reports written before this field parse unchanged (default) → verify: bash -c \"grep -qF 'GateFindingRecordShape' plugins/zeroh-roadmap/cli/lib/gate-report.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/gate-report.test.mjs >/dev/null 2>&1\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            '`--record-round` accepts `findings` in its JSON (gate.mjs:697-737 path), refuses a malformed severity naming the enum (exit 2), and prints the counts `recorded round R (agent: verdict; C/H/M/L = c/h/m/l)`. gate.test.mjs: round-trip with three findings, the legacy shape without findings still accepted, a bad severity refused → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'findings\' cli/commands/gate.test.mjs && capbuild node --test cli/commands/gate.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'A recorded round reads back with its findings and sha; a pre-existing report without them still parses; a severity outside the enum is refused with exit 2 naming the four legal values',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/gate-report.mjs', 'plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs', 'plugins/zeroh-roadmap/cli/commands/gate.mjs', 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs'],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['GateFindingRecordShape', 'AgentRoundShape.findings', 'AgentRoundShape.sha'] },
      done: false,
    },
    {
      id: '25.2',
      title: 'The stop rule, mechanized: gate round-brief says continue, close or cap from the recorded severities',
      problem:
        'Termination lives in prose (do-phase SKILL.md:112 "cap 5") and requires an empty findings array; a round with only LOW findings forces another 15-40 minute round, and 27-30% of phases reach the cap and get triaged by hand.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            "New verb `roadmap gate round-brief <N> [--json]` (dispatch beside plan/run at gate.mjs:534-585): reads the latest full report's rounds; `rule` = 'cap' when 5 correctness rounds are recorded; else 'continue' when the last round carries any CRITICAL/HIGH finding (or a legacy `findings-fixed` round with no findings recorded — unknown severity is not evidence of low); else 'close' when every finding is MEDIUM/LOW (the executor fixes ALL of them, records the round as `fixed-closed` with `fixedInCommit` on each, and the loop ends); 'clean' when the last round is clean. Output: { nextRound, rule, sinceSha, priorFindings[] } → verify: bash -c \"grep -qF 'round-brief' plugins/zeroh-roadmap/cli/commands/gate.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/commands/gate.test.mjs >/dev/null 2>&1\"",
        },
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            "StructuredGateRoundShape.verdict (templates/schema.ts:160) gains 'fixed-closed'; mirror line-identically in lib/roadmap/schema.ts (vendor-pair). checkPhaseConsistency (gate-report.mjs:212-256) gains rule (vi): a `fixed-closed` terminal round carries only MEDIUM/LOW findings, each with fixedInCommit; a terminal `findings-fixed` round holding a CRITICAL/HIGH is not complete → verify: bash -c \"grep -qF 'fixed-closed' plugins/zeroh-roadmap/templates/schema.ts && diff <(grep -n 'fixed-closed' plugins/zeroh-roadmap/templates/schema.ts | cut -d: -f2-) <(grep -n 'fixed-closed' lib/roadmap/schema.ts | cut -d: -f2-) >/dev/null && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/gate-report.test.mjs >/dev/null 2>&1\"",
        },
      ],
      acceptanceCriteria: [
        'round-brief returns continue for a HIGH, close for MEDIUM+LOW only, clean for an empty round, cap at five, and continue for a legacy findings-fixed round without findings (six directions tested); verify-complete refuses a done flip whose terminal round is findings-fixed with an open CRITICAL/HIGH, and accepts a fixed-closed round whose findings all carry fixedInCommit',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/gate.mjs', 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs', 'plugins/zeroh-roadmap/templates/schema.ts', 'lib/roadmap/schema.ts', 'plugins/zeroh-roadmap/cli/lib/gate-report.mjs', 'plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['25.1'],
      interfaces: { consumes: ['AgentRoundShape.findings from 25.1', 'AgentRoundShape.sha from 25.1'], produces: ['gate round-brief', "verdict 'fixed-closed'"] },
      done: false,
    },
    {
      id: '25.3',
      title: 'Delta-only later rounds: the reviewer card and do-phase follow round-brief, not the whole diff',
      problem:
        'Round N re-reviews the entire phase diff and finds new things in old code; nothing tells it to review the commits since round N-1 and to verify each prior finding\'s closure at its recorded file and line. The one reviewer that did so converged (atlas 40); the default keeps churning.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/agents/code-reviewer.md',
          description:
            'One "Round scope" block after the focus list (code-reviewer.md:25-33): round 1 reviews the phase diff; round ≥2 reviews `git diff <sinceSha>..HEAD` from round-brief PLUS re-reads each prior finding at its file/line and reports it as closed or still-open (a still-open prior finding keeps its severity); no fresh finding on code untouched since sinceSha unless it is CRITICAL. The output contract unchanged. Card size funded in-file (a DIET-LEDGER row) → verify: bash -c "grep -qF \'sinceSha\' plugins/zeroh-roadmap/agents/code-reviewer.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
          description:
            'The gate paragraph (do-phase SKILL.md:110-121): the loop is driven by `roadmap gate round-brief <N>` — continue / close / clean / cap — the executor recording each round\'s typed findings via --record-round; "cap 5" stays the ceiling. phase-executor.md:63-67 cites the same verb; the codex lane inherits via do-phase. Measures: do-phase total before/after; `roadmap measure --flow do-arc --assert 13339` exits 0; DIET-LEDGER row for any trim → verify: bash -c "grep -qF \'round-brief\' plugins/zeroh-roadmap/skills/do-phase/SKILL.md && grep -qF \'round-brief\' plugins/zeroh-roadmap/agents/phase-executor.md && cd plugins/zeroh-roadmap && node bin/roadmap.mjs measure --flow do-arc --assert 13339 >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The reviewer card carries the round-scope rule once; do-phase and the executor card drive the loop by round-brief; the do-arc assert holds and the do-phase total is recorded; no other skill or card restates the rule (grep round-brief across skills/agents finds only those three homes plus MULTI-DRIVER if it cites)',
      ],
      files: ['plugins/zeroh-roadmap/agents/code-reviewer.md', 'plugins/zeroh-roadmap/skills/do-phase/SKILL.md', 'plugins/zeroh-roadmap/agents/phase-executor.md', 'plugins/zeroh-roadmap/DIET-LEDGER.md'],
      testMode: 'none',
      dependsOn: ['25.2'],
      done: false,
    },
    {
      id: '25.4',
      title: 'The eval sees it: findings by severity per round, and a rounds-on-low-only metric',
      problem:
        'eval-collect.mjs:487 projects rounds as round/agent/verdict/model only, so the scorecard (eval-scorecard.mjs:198-301) can count rounds but never say whether they were spent on LOW findings — the exact question the 2026-09-02 mining could not answer.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
          description:
            'The rounds projection (eval-collect.mjs:487) carries `findings: { CRITICAL, HIGH, MEDIUM, LOW }` counts per round and `terminal` (clean | fixed-closed | cap | open); the peval `gate` block gains `roundsLowOnly` (rounds whose findings were all MEDIUM/LOW) and `findingsBySeverity` totals → verify: bash -c "grep -qF \'roundsLowOnly\' plugins/zeroh-roadmap/cli/lib/eval-collect.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/eval-collect.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-scorecard.mjs',
          description:
            'The per-actor cell gains `lowOnlyRoundShare` (rounds spent on MEDIUM/LOW-only findings ÷ rounds with recorded findings; abstains below the n floor and when no round carries findings — legacy records never read as zero); eval-score.mjs speed dimension cites it as an explanation column, never a score input (the ratified seven dimensions stay), and its cleanFinal (eval-score.mjs:253) counts a `fixed-closed` terminal round as converged alongside `clean`. Tests in both suites, legacy-record direction included → verify: bash -c "grep -qF \'lowOnlyRoundShare\' plugins/zeroh-roadmap/cli/lib/eval-scorecard.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/eval-scorecard.test.mjs cli/lib/eval-score.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'A peval for a phase with recorded findings reports findingsBySeverity and roundsLowOnly; a legacy phase reports them absent, not zero; the scorecard column abstains on legacy-only cells; `roadmap eval scorecard` on this repo regenerates without error',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/eval-collect.mjs', 'plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs', 'plugins/zeroh-roadmap/cli/lib/eval-scorecard.mjs', 'plugins/zeroh-roadmap/cli/lib/eval-scorecard.test.mjs', 'plugins/zeroh-roadmap/cli/lib/eval-score.mjs', 'plugins/zeroh-roadmap/cli/lib/eval-score.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['25.1'],
      interfaces: { consumes: ['AgentRoundShape.findings from 25.1'], produces: ['peval gate.roundsLowOnly', 'scorecard lowOnlyRoundShare'] },
      done: false,
    },
  ],
  notes:
    'interview: conducted in-session 2026-09-02 20:36-21:07Z — the owner reviewed the cross-repo mining, ruled the three fixes high-confidence and asked to ship them without a blind trial; the planner concurred (rule changes with visible mechanisms, and 25.1/25.4 make the effect measurable in data), reserving the gauntlet for the skill-size question. MEDIUM joins LOW in the close rule by the owner\'s wording ("only low severity — address all found and close") read against the card: MEDIUM is non-blocking by definition (code-reviewer.md:16), and a MEDIUM fix that itself breaks something is caught by the mechanical gate rerun, not by another review round. ' +
    'Four tasks below the 5-8 target for a nameable reason: three rules plus their measurement; padding would invent work. userFacing false: plugin internals. testMode none on 25.3 (prose + measures). ' +
    'conflictsWith 24: both edit templates/schema.ts + lib/roadmap/schema.ts (24.3 adds PhaseExecutionResultShape.modelPolicy; 25.2 widens StructuredGateRoundShape.verdict) and both carry a DIET-LEDGER row — serialize behind 24. ' +
    'Out of scope, recorded: a blind (gauntlet) trial of a trimmed do-phase body — the skill-size question, planned separately once 25.4 data exists; the quality-pass (round 0) contract, unchanged; backfilling severities onto historical rounds (unknowable — records stay absent, never zero); a consumer cadence ladder for atlas/viky (a config line in those repos, not plugin work). ' +
    'Verify rehearsal attestation: assumption probes executed 2026-09-02 at plan time — gate-report.mjs findings 0 hits, round-brief 0 hits, the verdict enum literal present in both homes, delta/since 0 hits in card+skill, "correctness loop (cap 5)" present with no severity rule (all exit 0). Step verifies red-now via their grep halves (no GateFindingRecordShape, no findings in gate.test, no round-brief, no fixed-closed, no sinceSha, no roundsLowOnly, no lowOnlyRoundShare); runner clauses inherit polarity from the grep representatives. Mode A review EXECUTED 2026-09-02 (claude-fable-5-1, standalone inline): every anchor re-opened at HEAD (gate-report.mjs:44-52/84-90/183-195/212-256, gate.mjs:534-585/697-737, templates/schema.ts:131-162 both homes, code-reviewer.md:11-17/25-33/51-56, do-phase SKILL.md:110-121, phase-executor.md:63-67, eval-collect.mjs:487, eval-scorecard.mjs:198/301); blast radius: the gate.mjs `findings` locals are lint findings (history comments, deviant grammar), untouched; eval-score.mjs:253 cleanFinal keys on verdict clean — 25.4 must treat fixed-closed as a converged terminal there (added to 25.4 step 2 by this review). One [FIXED]: assumption 3 verify used awk with an unescaped field ref — replaced by a file-count form. Ratified: testMode none on 25.3; userFacing false; 4-task floor exception. Placement: HIGH, conflictsWith 24 (queued at index 1) — index 0 keeps one entry between → 1 of 4.',
})
