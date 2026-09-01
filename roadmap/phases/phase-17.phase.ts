import { definePhase } from '@/lib/roadmap/schema'

/**
 * MINESWEEP plane 2 — delegated-lane gate integrity: no self-judge, honest identities.
 *
 * The ratified rule "codex never self-judges" (azure backlog.ts:1040) has no mechanical
 * teeth: mudarabah2 phase-720 landed on a single `codex-self-review` round and shipped a
 * false green; azure 2422's honest self-review record was REJECTED by the enum (no such
 * member) and 2423's three software-architect RESHAPE rounds could not be recorded either
 * ("The agent enum carries no software-architect member") — reviewers launder identity
 * into free text, and atlas 33 reached done with agents:[] entirely. Fix at the one
 * choke point both landing paths share: checkPhaseConsistency.
 * Evidence: roadmap/arc-prompts/MINESWEEP-execution-prompt.md §integrity.
 *
 * ## Hypotheses (why delegated green lands unreviewed)
 * 1. CONFIRMED — the contract cannot EXPRESS the truth and the verifier does not DEMAND
 *    it: the phase-side gateRounds agent enum (templates/schema.ts:151, five members)
 *    lacks both the architect and any self-review identity, and checkPhaseConsistency
 *    only compares round COUNTS (gate-report.mjs:227-233) — zero recorded rounds on both
 *    sides is "consistent", and a self-review round counts like an independent one.
 * 2. REFUTED — "the envelope already forbids it": the run envelope instructs role-filling,
 *    yet 5/5 audited atlas codex phases had defects behind green and 2/2 azure lane
 *    reports recorded self-review — instruction without a refusal did not hold.
 *
 * timing: no reference data for 1-3×surface:false
 */
export default definePhase({
  phase: 17,
  name: 'Delegated-lane gate integrity: widened round identities, no-self-judge refusal at verify-complete',
  status: 'done',
  completedDate: '2026-09-01',
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1485,
      total: 1485,
      notes:
        'Authoritative final gate: roadmap/.gate/17/run-000008-2026-09-01T10-36-02-748Z.json — GREEN on f430e5d, 1,485/1,485 tests plus schema checks. The later c85d02d changes only transparency placement and a test docblock pointer; its focused roles suite passed 42/42 and phase validation passed.',
    },
    integrationTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands; subprocess integration coverage is included in the unit slot.',
    },
    e2eTests: { passed: 0, total: 0, notes: 'declared-none in gateCommands — no rendered surface.' },
    build: 'clean',
    preReview: 'clean',
  },
  gateRounds: [
    {
      round: 0,
      agent: 'quality-pass',
      verdict: 'findings-fixed',
      summary:
        'Quality pass surfaced prompt fidelity, schema migration, and historical-report compatibility concerns; all were resolved and gated.',
    },
    {
      round: 1,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Found the old-report waiver, weakened prompt clauses, fixture capacity bypass, wording, and caller coverage issues; fixed in e2bd12d.',
    },
    {
      round: 2,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Found the loosened envelope ratchet, identity-label residual, and legacy self-review variants; fixed or disclosed in f430e5d.',
    },
    {
      round: 3,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Found only misplaced limitations and a misleading ratchet doc pointer; corrected in c85d02d.',
    },
    {
      round: 4,
      agent: 'code-reviewer',
      verdict: 'clean',
      summary: 'Final independent review verified all round-3 corrections and returned no findings.',
    },
  ],
  metrics: {
    commits: 12,
    linesAdded: 631,
    linesRemoved: 29,
    filesChanged: 12,
    testsAtStart: 1482,
    testsAtEnd: 1485,
    testsAdded: 3,
    startedAt: '2026-09-01T07:14:45Z',
    completedAt: '2026-09-01T10:51:57Z',
    haltCount: 0,
  },
  compromises:
    'None. The free-text reviewer identity residual is an explicit limitation of the ratified design, and curation was deliberately left untouched after its foreign-commit refusal rather than forcing a history rewrite.',
  executionResult: {
    phase: 17,
    status: 'done',
    driver: { model: 'gpt-5.6-sol', lane: 'codex' },
    roles: [
      { role: 'test-engineer', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'test-engineer', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'test-engineer', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'software-architect', model: 'gpt-5.6-sol', via: 'native', substituted: { from: 'claude-fable-5', to: 'gpt-5.6-sol', reason: 'unavailable: claude-fable-5 reached its usage limit — re-run at UNREDUCED rigor on gpt-5.6-sol' } },
      { role: 'software-architect', model: 'gpt-5.6-sol', via: 'native', substituted: { from: 'claude-fable-5', to: 'gpt-5.6-sol', reason: 'unavailable: claude-fable-5 reached its usage limit — re-run at UNREDUCED rigor on gpt-5.6-sol' } },
      { role: 'software-architect', model: 'gpt-5.6-sol', via: 'native', substituted: { from: 'claude-fable-5', to: 'gpt-5.6-sol', reason: 'unavailable: claude-fable-5 reached its usage limit — re-run at UNREDUCED rigor on gpt-5.6-sol' } },
      { role: 'software-architect', model: 'gpt-5.6-sol', via: 'native', substituted: { from: 'claude-fable-5', to: 'gpt-5.6-sol', reason: 'unavailable: claude-fable-5 reached its usage limit — re-run at UNREDUCED rigor on gpt-5.6-sol' } },
      { role: 'quality-pass', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-opus-5', via: 'child-cli', substituted: { from: 'claude-fable-5', to: 'claude-opus-5', reason: 'unavailable: claude-fable-5 reached its usage limit — re-run at UNREDUCED rigor on claude-opus-5' } },
      { role: 'code-reviewer', model: 'claude-opus-5', via: 'child-cli', substituted: { from: 'claude-fable-5', to: 'claude-opus-5', reason: 'first child remained network-idle without a verdict and was retried at identical rigor' } },
      { role: 'code-reviewer', model: 'claude-opus-5', via: 'child-cli', substituted: { from: 'claude-fable-5', to: 'claude-opus-5', reason: 'unavailable: claude-fable-5 reached its usage limit — re-run at UNREDUCED rigor on claude-opus-5' } },
      { role: 'code-reviewer', model: 'claude-opus-5', via: 'child-cli', substituted: { from: 'claude-fable-5', to: 'claude-opus-5', reason: 'unavailable: claude-fable-5 reached its usage limit — re-run at UNREDUCED rigor on claude-opus-5' } },
      { role: 'code-reviewer', model: 'claude-opus-5', via: 'child-cli', substituted: { from: 'claude-fable-5', to: 'claude-opus-5', reason: 'unavailable: claude-fable-5 reached its usage limit — re-run at UNREDUCED rigor on claude-opus-5' } },
    ],
    compromises: [],
    skipped: [],
    hardcoded: ['Independent-review enforcement is anchored at 2026-09-01T07:30:27.000Z, with exemptions limited to phases completed before 2026-09-01.'],
    surfaced: [
      'Curation dry-run refused because 44e475a uses a non-roadmap phase subject and is classified as foreign; protocol requires leaving the history untouched and recording the limitation.',
      'Reviewer independence is inferred from a normalized free-text agent label; optional model data cannot prove identity for every historical round.',
      'The first code-reviewer child stayed network-idle for thirty minutes and returned no verdict; the same role was retried at identical rigor with the explicit agent wrapper.',
    ],
    hardStops: [],
    gateRounds: 5,
  },
  debtResolutions: [
    {
      ref: '17.2.hardcoded',
      status: "won't_fix",
      via: 'arc-sweep ACCEPT, user-ratified 2026-09-01: a deliberate grandfathering anchor — without the rule-commit-time cutoff every pre-rule phase would retroactively fail verify-complete; architect-approved at build time',
      date: '2026-09-01',
    },
  ],
  plannedBy: { model: 'claude-fable-5' },
  category: 'fix',
  kind: 'hardening',
  arcId: 'MINESWEEP',
  source:
    'MINESWEEP plane "Integrity & measurement" — 2026-08-31 mining §Q2/§Q3 (azure 2422/2423 enum rejections; mudarabah2 720 self-review false green; atlas 33 agents:[]).',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/templates/schema.ts',
    'lib/roadmap/schema.ts',
    'plugins/zeroh-roadmap/cli/lib/gate-report.mjs',
    'plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
  ],
  stakeholderDemo:
    'A delegated phase can record its reviewers honestly (software-architect, self-review) and can no longer flip done on its own opinion of itself: verify-complete refuses a codex-lane completion whose only recorded review is self-review.',
  userFacing: false,
  assumptions: [
    {
      claim: 'The phase-side gateRounds agent enum has exactly five members in BOTH schema homes and neither carries software-architect or self-review (line-identical vendor pair).',
      verify:
        'bash -c "grep -qF \\"agent: z.enum([\'quality-pass\', \'architect-critique\', \'simplifier\', \'code-reviewer\', \'test-engineer\']).optional()\\" plugins/zeroh-roadmap/templates/schema.ts && diff <(sed -n 151p plugins/zeroh-roadmap/templates/schema.ts) <(sed -n 151p lib/roadmap/schema.ts) >/dev/null"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'checkPhaseConsistency compares round counts only — no identity rule exists, and a zero/zero round pair passes as consistent (the atlas-33 agents:[] shape).',
      verify: 'bash -c "test \\"$(grep -cF \'self-review\' plugins/zeroh-roadmap/cli/lib/gate-report.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The report-side AgentRoundShape.agent is a free string (gate-report.mjs:40), so the widening lands only in the phase-side enum — no report-side migration.',
      verify: 'bash -c "grep -qF \'agent: z.string()\' plugins/zeroh-roadmap/cli/lib/gate-report.mjs"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '17.1',
      title: 'Widen the gateRounds agent enum in both schema homes: + software-architect, self-review',
      problem:
        'Recorded reality cannot be recorded: azure 2423\'s architect RESHAPE rounds and 2422\'s honest self-review both bounced off the five-member enum, so reviewer identity gets laundered into free text — invisible to any later rule keyed on it.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            "Append 'software-architect' and 'self-review' to the gateRounds agent z.enum, with a docblock line each: software-architect = the Decision-Contract/RESHAPE reviewer; self-review = the driver reviewing its own work — honest, and NEVER sufficient for a delegated lane (17.2's rule). Existing members untouched (history stays parseable) → verify: bash -c \"grep -qF \\\"'self-review'\\\" plugins/zeroh-roadmap/templates/schema.ts\"",
        },
        {
          file: 'lib/roadmap/schema.ts',
          description:
            'Mirror the identical line + docblock in the consumer home in the SAME commit; the vendor pair stays line-identical at the enum (the v10-marker discipline) → verify: bash -c "diff <(grep -F \\"agent: z.enum\\" plugins/zeroh-roadmap/templates/schema.ts) <(grep -F \\"agent: z.enum\\" lib/roadmap/schema.ts) >/dev/null && grep -qF \\"\'self-review\'\\" lib/roadmap/schema.ts"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
          description:
            'Fixture-consumer round-trip: a phase file recording gateRounds agents software-architect and self-review passes `roadmap phase validate`, and `gate run --record-round` with agent software-architect appends cleanly (the 2423 shape, now expressible) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \\"software-architect\\" cli/commands/gate.test.mjs && capbuild node --test cli/commands/gate.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'Both homes carry the widened enum line-identically (diff of the enum lines empty); the azure-2423 round shape validates end-to-end; pre-existing five-member phase files still parse (regression pin)',
      ],
      files: [
        'plugins/zeroh-roadmap/templates/schema.ts',
        'lib/roadmap/schema.ts',
        'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
      ],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ["gateRounds agent enum members 'software-architect', 'self-review'"] },
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          "Widened StructuredGateRoundShape's agent enum in both the plugin template and consumer schema with the software-architect and self-review identities. Added end-to-end CLI fixtures proving both identities parse and record through their honest names while all five legacy identities remain accepted.",
        how:
          'TDD: the test-engineer added four fixture-consumer drives through definePhase, gate run, --record-round, and --verify-complete. RED executed 68 tests with 65 passing and the three new schema directions failing on the old enum; after the identical schema edits, the capped scoped run executed all 68 tests green. The phase types slot also passed as declared-none, and the enum-line diff was empty.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '17.2',
      title: 'checkPhaseConsistency: delegated completions need one independent recorded round',
      problem:
        'A codex-lane phase whose recorded reviews are empty or all self-review still verifies complete — the exact shape of mudarabah2 720\'s false green and atlas 33\'s agents:[] done flip. The rule belongs in checkPhaseConsistency, the ONE home both gate run and verify-complete import (gate-report.mjs:11).',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/gate-report.mjs',
          description:
            "In checkPhaseConsistency, when parsed.executionResult?.driver?.lane === 'codex' AND neither parsed.reviewScope === 'none' NOR report.reviewScope?.effective === 'none' (architect amendment A3 — the ladder DERIVES none for docs-only diffs with no declaration, and the report is already in hand at this seam; keying on the declared field alone would refuse a delegated docs-only phase for lacking a review the ladder itself waived): require ≥1 report agents[] round with round >= 1 whose agent is neither 'self-review' nor a legacy '*self-review*' free-string variant; violation pushes ONE problem naming the ratified rule and the remedy (`gate run <N> --record-round` with an independent agent) → verify: bash -c \"grep -qF 'self-review' plugins/zeroh-roadmap/cli/lib/gate-report.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs',
          description:
            'Six directions: codex lane + only self-review rounds → problem (exit-2 path); codex + zero rounds → problem; codex + one code-reviewer round → clean; session lane + only self-review → clean (the rule is lane-scoped); codex + DECLARED reviewScope none → clean; codex + undeclared scope with report effective none → clean (the derived-none exemption, A3) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'independent recorded round\' cli/lib/gate-report.test.mjs && capbuild node --test cli/lib/gate-report.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The five direction pairs above all hold in the suite; the problem text names the no-self-judge rule and the record-round remedy',
        'Both callers inherit the rule with zero caller edits (grep: no new lane logic in gate.mjs)',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/gate-report.mjs', 'plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['17.1'],
      interfaces: { consumes: ["'self-review' enum member from 17.1"], produces: [] },
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Added the delegated no-self-judge rule to checkPhaseConsistency: a codex-lane completion with review required now needs at least one round>=1 whose report-side agent identity is not an exact or legacy free-string self-review label. The refusal names both the independence requirement and the record-round command that remedies it.',
        how:
          'TDD: the test-engineer added six required directions plus legacy self-review spellings at the pure consistency seam. RED executed 27 tests with 25 passing and the two refusal/control cases failing; GREEN executed all 27 tests successfully. The capped types slot passed as declared-none, and a direct diff assertion confirmed gate.mjs received no caller-side lane logic.',
        compromises: 'None',
        skipped: 'None',
        hardcoded:
          'The named enforcement cutoff 2026-09-01T07:30:27.000Z is the phase-17 rule commit time, architect-approved so only phases completed before the rule retain immutable pre-rule gate reports as historical evidence.',
        limitations:
          'Gate resolution added cli/lib/validate.test.mjs beyond the planned files to prove the shared consistency seam rejects a new completion carrying an old report; the gate command has its own end-to-end refusal coverage. The ratified rule uses the persisted free-text agent label because round model is optional; it rejects normalized self-review spellings but cannot cryptographically prove that a driver did not type an independent-role label.',
      },
    },
    {
      id: '17.3',
      title: 'Codex run envelope names the independence requirement',
      problem:
        'The refusal lands at verify-complete — AFTER the lane finished. One envelope line makes the requirement visible at work time so the lane records an independent round (via its role bindings) instead of discovering the refusal at the end.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            "In buildPrompt's override list (codex.mjs:123), extend the `FILL PROTOCOL ROLES` bullet with: reviews recorded as `self-review` never satisfy completion — a codex-lane phase needs at least one independent recorded round, and `--verify-complete` refuses without it. Run-lane copy ONLY: buildPlanPrompt carries a sibling FILL PROTOCOL ROLES bullet (~line 216) that stays untouched — the test pins that direction → verify: bash -c \"grep -qF 'never satisfy completion' plugins/zeroh-roadmap/cli/commands/codex.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Prompt-content assertion: the run prompt carries the independence line; review and plan prompts do not (they record no gate rounds) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \\"never satisfy completion\\" cli/commands/codex.test.mjs && capbuild node --test cli/commands/codex.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The run envelope states the rule the gate enforces; the non-committing lanes stay silent about it (both directions in the prompt tests)',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          "Extended only the codex run envelope's FILL PROTOCOL ROLES bullet with the exact independence rule: self-review never satisfies completion, at least one independent recorded round is required, and --verify-complete refuses without it. Added positive run assertions and negative review/plan assertions.",
        how:
          "TDD: the test-engineer added real-CLI prompt assertions and established RED at 88/89. An existing prompt-ownership assertion conflicted with the planned exact --verify-complete wording, so the software-architect returned PROCEED_WITH_FIX: preserve the exact teaching sentence and strip only that approved sentence before asserting no other completion mechanics leaked. The capped GREEN run executed 89/89; the types slot passed as declared-none.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Correctness resolution touched cli/lib/roles.test.mjs outside the planned prompt files to re-derive and preserve the envelope-overhead ratchet while compacting unrelated repetition.',
      },
    },
  ],
  notes:
    'interview: skipped — arc member; scope from the MINESWEEP arc record (LOCKED: independence enforced at verify-complete; acceptance criterion delegated-independent-review). ' +
    'reviewScope full (a completion-refusal rule; a wrong polarity here blocks every delegated land). ' +
    '3 tasks below the 4-floor for a nameable reason: one contract widening + one rule at its single choke point + one teaching line; sharding further would fork the seam the phase exists to keep single. Out-of-scope, documented: a mutation-proof-presence check on transparencyReports was REJECTED as unverifiable at this seam (free prose can claim anything) — proof quality is phase 20\'s territory; historical phases recording laundered identities are data, never migrated. ' +
    'Dodge vectors reviewed (review-phase Mode A): the reviewScope-none exemption is not lane-controlled — scope is ratified pre-queue by review-phase Mode A, so a lane rewriting reviewScope to none post-queue is plan falsification visible in the phase diff and the Mode B audit (accepted residual, not a rule gap); the absent-driver dodge is already refused upstream — driverReconcile (gate.mjs) errors when a lane journal exists but executionResult.driver is absent, so the lane-keyed rule only goes silent for true inline sessions (the pre-existing, documented boundary). ' +
    'Verify rehearsal attestation: red-now probes executed 2026-08-31 — self-review 0 hits in both schema homes and gate-report.mjs (step-verifies red for exactly the members/rules their diffs add); assumption probes all exit 0 (enum-line diff empty across homes; agent: z.string() present at report side); the enum-line-diff verify was dry-run against the CURRENT identical pair (green direction) and is red under any one-sided edit by construction (diff non-empty); runner clauses inherit polarity from their grep representatives — every runner verify carries one in-clause (review-phase added the 17.1/17.3 representatives and re-ran all probes 2026-08-31: assumptions 0/0/0, step grep clauses all exit 1).',
})
