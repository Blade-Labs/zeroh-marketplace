import { definePhase } from '@/lib/roadmap/schema'

/**
 * Zane-workflow adoption — close four planning-discipline gaps + parallel-dispatch investigation.
 *
 * Source posts: x.com/ZaneOnAI/status/2092349378543444241 (workflow) and the linked article
 * 2089442213155807684 (context hygiene). Gap analysis ran in-session 2026-08-26 against the
 * post-pull tree (da5477e); user rulings: vertical slicing is the priority, parallel work is
 * INVESTIGATED not implemented, interview strength gets revisited, rest as proposed.
 * timing: no reference data for 7-9×surface:false
 */
export default definePhase({
  phase: 10,
  name: 'Zane-workflow adoption — vertical slices, default interview, typed rejections, interface checks, parallel-dispatch investigation',
  status: 'done',
  completedDate: '2026-08-26',
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1371,
      total: 1371,
      notes:
        'Authoritative full gate: roadmap/.gate/10/run-000004-2026-08-26T12-46-02-455Z.json — GREEN, 1,371/1,371, run on the FINAL tree after the round-3 fixes (an earlier full green, run-000003, predated the R1-R3 fix commits and was superseded). 5 tests added (1,366 baseline: 4 TDD for the 10.4 guards + 1 gate-R1 substitution/rewrite/reorder pin). lint, types, build and integration are declared-none in gateCommands; lint-diff and history-comments exit 0.',
    },
    integrationTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — plugin CLI phase; the wired subprocess suites inside the unit tier drive the real CLI against tmp git repos.',
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
        'Four fixes (its own commit 6c2e033, whose non-grammar subject later tripped the curate foreign-detector — see compromises): the validate.mjs WARN-gate comment trued for the new arc lane, the test-file docblock updated for the two drive styles, two RED-tense TDD leftovers made timeless, one duplicated fact deleted. Surfaced the plugin version bump (0.32.0, rule-adding phase) as a PRODUCT hard-stop for the user, and handed two guard-precision leads to round 1.',
    },
    {
      round: 1,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Three findings, all fixed: (HIGH) the interfaces.consumes grep was vacuous — the declaring phase file self-matches in the worktree, so the check could never escalate; scoped to the source tree excluding roadmap/phases + roadmap/.gate in both carriers. (MEDIUM) the append-only guard compared entry COUNTS, so a delete hidden behind an append (2→2) and an in-place rewrite both passed — replaced with a whitespace-normalized multiset content compare, one new test (substitution, rewrite, reorder-clean), mutation re-proven. (LOW) design-gate Confirm now cites the entry shape.',
    },
    {
      round: 2,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Four findings, all fixed: the consumes grep token defined as the TERMINAL identifier (owner qualifier, arg list, provenance all stripped) with two worked examples; the schema docblock trued to the content-compare contract and the consumer copy re-synced; task 10.4 report claims updated with R1 provenance; the do-phase mirror aligned to the roadmap/phases+.gate exclusion. The reviewer fuzz-verified the tokenizer refactor (300k random blocks, zero count mismatches vs the old counter).',
    },
    {
      round: 3,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Two artifact-prose findings, fixed: task 10.4 how now separates the TASK-TIME mutation proof (11-test count-compare build) from the POST-R1 re-proof (12-test content-compare suite), and the phase-notes envelope was renamed to erasure guard. All four round-2 fixes independently verified to HOLD (grep executable for both worked examples, docblock matches the implemented guard, mirror consistent, budget exactly 13257/13257).',
    },
    {
      round: 4,
      agent: 'code-reviewer',
      verdict: 'clean',
      summary:
        'Zero findings. The dead-erasure-guard mutation was independently reproduced (not ok 8/9/10, 9 pass / 3 fail) and reverted with an md5 match; notes, report, docblock and implementation all state the same erasure-guard contract; 12/12 on the touched suite, parity 25/25, phase validate OK, schema copies byte-identical.',
    },
  ],
  metrics: {
    commits: 14,
    linesAdded: 609,
    linesRemoved: 49,
    filesChanged: 15,
    testsAtStart: 1366,
    testsAtEnd: 1371,
    testsAdded: 5,
    startedAt: '2026-08-26T10:39:07Z',
    completedAt: '2026-08-26T12:50:00Z',
    haltCount: 0,
  },
  compromises:
    'None. The one execution-time fork (the do-arc protocol-load budget red at gate R1: bump the constant vs fund the addition) went to a software-architect Decision Contract — verdict: diet-fund in-file, budget untouched, two DIET-LEDGER rows; a self-authorized bump was ruled outside executor authority. The curate refusal is a deliberate non-rewrite: the quality-pass agent committed its own fixes as 6c2e033 with a non-grammar subject (fix(phase-10): …), which the foreign-detector correctly refuses to squash; history stays granular and the lesson (gate agents must receive the binding commit grammar, or the orchestrator owns the commit) is flushed to the eval lane.',
  executionResult: {
    phase: 10,
    status: 'done',
    driver: { model: 'claude-fable-5', lane: 'session' },
    roles: [
      { role: 'test-engineer', model: 'claude-opus-5', via: 'native' },
      { role: 'software-architect', model: 'claude-fable-5', via: 'native' },
      { role: 'quality-pass', model: 'claude-opus-5', via: 'native' },
      { role: 'code-reviewer', model: 'claude-opus-5', via: 'native' },
    ],
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      'Plugin version bump owed: phase 10 ships a new ArcShape field, a new validate ERROR rule and a WARN lint at plugin version 0.32.0 — comparable rule-adding phases each carried a bump, release-sweep never changes versions, and the phase carries no version field, so the bump (and whether it is minor) is a human release call.',
      'The parallel-dispatch ruling is OPEN by design: DESIGN-NOTES §Parallel dispatch investigation ends with three options (recommended: ratify cross-arc lane parallelism as the sanctioned path now + a small follow-up phase removing executionMode; defer plane-level do-arc fan-out until a real multi-plane arc and host headroom exist). Nothing proceeds until the user rules.',
      "Gate-round model attribution in run-000004 was HAND-CORRECTED before the done flip: the rounds were recorded with the session model (claude-fable-5) but the spawned agents ran on their frontmatter default (model: opus). --record-round is append-only with no amend verb, and appending duplicates would break the verify-complete round-count clause, so the five agents[].model strings were edited to claude-opus-5 in place. A record-round --amend (or capturing the true model at spawn) is a nameable follow-up.",
      'The consumes pre-check is a presence heuristic, not a contract check (R3 INFO): stripping the owner qualifier necessarily widens the match to prose mentions; the narrower qualified grep would false-fail on bare declarations, so the trade is deliberate.',
    ],
    hardStops: [],
    gateRounds: 5,
  },
  plannedBy: { model: 'claude-fable-5' },
  category: 'feature',
  kind: 'logic',
  source:
    'User request 2026-08-26 — adopt the Zane-workflow gap findings (x.com/ZaneOnAI 2092349378543444241 + article 2089442213155807684); software-architect Decision Contract verdict PROCEED_WITH_TASK (agent a7b06781721a79cc8) fixed the rejectedAlternatives shape.',
  priority: 'MEDIUM',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/templates/schema.ts',
    'lib/roadmap/schema.ts',
    'plugins/zeroh-roadmap/cli/lib/validate.mjs',
    'plugins/zeroh-roadmap/cli/lib/validate.test.mjs',
    'plugins/zeroh-roadmap/skills/plan-phase/SKILL.md',
    'plugins/zeroh-roadmap/skills/plan-phase/references/phase-file-contract.md',
    'plugins/zeroh-roadmap/skills/plan-arc/SKILL.md',
    'plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md',
    'plugins/zeroh-roadmap/agents/software-architect.md',
    'plugins/zeroh-roadmap/agents/phase-executor.md',
    'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
    'plugins/zeroh-roadmap/skills/review-phase/SKILL.md',
    'plugins/zeroh-roadmap/DESIGN-NOTES.md',
  ],
  stakeholderDemo:
    'Roadmap planners get vertical-slice and default-interview discipline, rejected alternatives become a typed grep-able record guarded append-only, executors verify consumed interfaces before building, and a written investigation names the path to parallel phase dispatch.',
  userFacing: false,
  assumptions: [
    {
      claim: 'The descopes field sits in ArcShape at templates/schema.ts as the insertion anchor for rejectedAlternatives.',
      verify: "bash -c \"grep -qF 'descopes: z' plugins/zeroh-roadmap/templates/schema.ts\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'arcImmutabilityChecks exists in validate.mjs and already counts criteriaRatifications via extractKeyBlock, the plumbing 10.4 extends.',
      verify:
        "bash -c \"grep -qF 'function arcImmutabilityChecks' plugins/zeroh-roadmap/cli/lib/validate.mjs && grep -qF \\\"extractKeyBlock(content, 'criteriaRatifications')\\\" plugins/zeroh-roadmap/cli/lib/validate.mjs\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The consumer schema is a byte-identical copy of templates/schema.ts (manual byte-sync model; 10.3/10.6 re-copy after editing).',
      verify: 'bash -c "cmp plugins/zeroh-roadmap/templates/schema.ts lib/roadmap/schema.ts"',
      onFalse: 'ESCALATE',
    },
    {
      claim: "The executionMode docblock still claims 'parallel = agent batching allowed', the untrue text 10.6 replaces.",
      verify: "bash -c \"grep -qF 'parallel = agent batching allowed' plugins/zeroh-roadmap/templates/schema.ts\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The layer-first ordering sentence 10.1 extends is present verbatim in plan-phase SKILL.md.',
      verify:
        "bash -c \"grep -qF 'Order foundation → consumers → validation last' plugins/zeroh-roadmap/skills/plan-phase/SKILL.md\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The executor card task loop still carries the re-anchor line 10.7 inserts beside.',
      verify: "bash -c \"grep -qF 'Re-anchor: re-read this card' plugins/zeroh-roadmap/agents/phase-executor.md\"",
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '10.1',
      title: 'Vertical-slice authoring rule for userFacing phases (user priority)',
      problem:
        'plan-phase Step 3 orders "foundation → consumers → validation last" with no counterweight, so a userFacing phase can legally batch whole layers (all schema, then all API, then all UI) and leave nothing demonstrable until the tail — the horizontal-slice failure mode the Zane post names.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/plan-phase/SKILL.md',
          description:
            'Append ONE sentence to the Step 3 granularity paragraph, directly after "Order foundation → consumers → validation last; N.3 may depend on N.2, never N.4.": a `userFacing: true` phase slices vertically — no task batches a whole layer; each consumer-bound task carries its change through to an observable its `→ verify:` names (detail: phase-file-contract.md §Ordering). Body stays lean per gauntlet lesson 4 → verify: bash -c "grep -qF \'slices vertically\' plugins/zeroh-roadmap/skills/plan-phase/SKILL.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/plan-phase/references/phase-file-contract.md',
          description:
            'Extend the §Ordering bullet with the rationale detail the SKILL.md sentence cites: a layer-batched task list leaves nothing testable until the last layer lands; a userFacing phase orders tasks so each slice reaches an observable behavior early; foundation → consumers still governs dependency DIRECTION within a slice, never layer batching across the phase → verify: bash -c "grep -qF \'layer-batched\' plugins/zeroh-roadmap/skills/plan-phase/references/phase-file-contract.md"',
        },
      ],
      acceptanceCriteria: [
        'plan-phase SKILL.md gains exactly one vertical-slice sentence citing phase-file-contract.md §Ordering; the rationale prose lives only in the reference (SKILL-AUTHORING-STANDARD reference-ladder + R16 cite-never-restate re-checked on the edited sections)',
      ],
      files: [
        'plugins/zeroh-roadmap/skills/plan-phase/SKILL.md',
        'plugins/zeroh-roadmap/skills/plan-phase/references/phase-file-contract.md',
      ],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'plan-phase Step 3 gained the one vertical-slice sentence for userFacing phases (no layer-batched tasks; every consumer-bound task reaches an observable its → verify: names), citing phase-file-contract.md §Ordering; the reference §Ordering bullet carries the rationale detail (layer batching leaves nothing testable until the tail; foundation → consumers governs dependency direction within a slice, not layer batching across the phase).',
        how: 'Two in-place additive edits at the exact anchors the plan named (SKILL.md Step 3 granularity paragraph tail; contract §Ordering bullet). Both step verifies ran green; types slot declared-none in this consumer.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The rule is authoring guidance (honor-system, enforced at review-phase Mode A reading Step 3) — no lint parses task shape for layer batching.',
      },
    },
    {
      id: '10.2',
      title: 'Interview default-on in plan-phase with recorded skip (parity with plan-arc)',
      problem:
        'plan-arc interviews unconditionally and may skip only by recording `interview: skipped - <why>`; plan-phase Step 0 gates the interview on a self-judged "underspecified" and records nothing, so a planner can silently skip on a request that FEELS specified — exactly the requests where the interview surfaces decisions nobody has made yet (the Zane 22-100-question observation). Strength assessment recorded in notes.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/plan-phase/SKILL.md',
          description:
            'Rewrite Step 0\'s opening: a STANDALONE request gets the interview BY DEFAULT (one question at a time, scope first, user-owned forks as AskUserQuestion options — unchanged); skip ONLY by recording `interview: skipped — <why>` in the phase file `notes` (an arc-member phase cites the parent arc\'s interview instead of re-interviewing). Delete the "underspecified" trigger clause; keep the sentence count flat (in-place hotfix, never a Step 0 rewrite) → verify: bash -c "grep -qF \'interview: skipped\' plugins/zeroh-roadmap/skills/plan-phase/SKILL.md && ! grep -qF \'An underspecified standalone request gets an INTERVIEW\' plugins/zeroh-roadmap/skills/plan-phase/SKILL.md"',
        },
      ],
      acceptanceCriteria: [
        'plan-phase Step 0 interview is default-on with a recorded-skip escape mirroring plan-arc grammar; arc-member phases are explicitly exempted (their interview happened at plan-arc)',
      ],
      files: ['plugins/zeroh-roadmap/skills/plan-phase/SKILL.md'],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'plan-phase Step 0 interview is now default-on for standalone requests, skippable ONLY by recording `interview: skipped — <why>` in the phase notes; arc-member phases cite the parent arc interview instead of re-interviewing. The self-judged "underspecified" trigger is gone.',
        how: 'One in-place rewrite of the Step 0 opening (four sentences → six lean lines, no section rewrite); the AskUserQuestion structured-fork rule and the plan-arc parity citation kept verbatim. Verify (positive grep + negated old-trigger grep) green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Honor-system like plan-arc’s twin rule — no lint checks the notes line exists; review-phase Mode A reads Step 0 as the enforcement seam.',
      },
    },
    {
      id: '10.3',
      title: 'ArcShape.rejectedAlternatives — typed home for ruled-out options',
      problem:
        'Rejected alternatives (interview rulings, losing design-gate arms, architect-verdict rejects) survive only as LOCKED-DECISIONS comment prose or decisionRef free strings — un-greppable by contract, validated by nothing, so a future planner can resurrect an option a human already rejected.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            "Insert `rejectedAlternatives` in ArcShape directly after `descopes` (before `criteriaRatifications`): optional array of { option: min 10, why: min 10, decidedBy: min 2, decidedAt: min 8 }, docblock naming provenance ('user' | 'software-architect verdict <date>'), append-only intent, and the resurrection-leak it closes; decidedBy/decidedAt not ratifiedBy — architect rejects are recorded decisions, not user ratifications → verify: bash -c \"grep -qF 'rejectedAlternatives: z' plugins/zeroh-roadmap/templates/schema.ts\"",
        },
        {
          file: 'lib/roadmap/schema.ts',
          description:
            'Byte-sync the consumer copy: cp plugins/zeroh-roadmap/templates/schema.ts lib/roadmap/schema.ts (the established manual-sync model — assumption 3 proved byte-identity at plan time) → verify: bash -c "cmp plugins/zeroh-roadmap/templates/schema.ts lib/roadmap/schema.ts && grep -qF \'rejectedAlternatives\' lib/roadmap/schema.ts"',
        },
      ],
      acceptanceCriteria: [
        'An arc file declaring rejectedAlternatives entries parses through both schema copies; existing arcs without the field keep parsing (optional → additive)',
      ],
      files: ['plugins/zeroh-roadmap/templates/schema.ts', 'lib/roadmap/schema.ts'],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      interfaces: { consumes: [], produces: ['ArcShape.rejectedAlternatives (templates/schema.ts)'] },
      transparencyReport: {
        whatWasDone:
          'ArcShape gained the optional rejectedAlternatives array ({option ≥10, why ≥10, decidedBy ≥2, decidedAt ≥8}) directly after descopes, docblock naming provenance, append-only intent, and the resurrection-leak it closes; consumer lib/roadmap/schema.ts re-synced byte-identical.',
        how:
          'Insertion at the architect-named anchor; cp for the byte-sync. Both step verifies green; additive-parse proven live: ArcShape.safeParse succeeded both WITH a rejectedAlternatives entry and WITHOUT the field (the acceptance criterion, run via node --import tsx).',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The append-only promise in the docblock is enforced by task 10.4’s validate guard, not by Zod (Zod sees one file state, not history).',
      },
    },
    {
      id: '10.4',
      title: 'validate.mjs guards — rejectedAlternatives append-only + adoption WARN',
      problem:
        'A typed field nobody guards regresses to prose: nothing stops a building arc from deleting a recorded rejection, and nothing nudges an author writing REJECTED prose toward the field.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/validate.mjs',
          description:
            "Extend arcImmutabilityChecks to run the rejectedAlternatives count check INDEPENDENTLY of the acceptanceCriteria branch (the current `if (curAC === headAC) return []` early-return must not skip it — restructure to collect errors): on a building arc (sidecar exists), countTopLevelElements(extractKeyBlock(content, 'rejectedAlternatives')) < the HEAD count → error rule 'rejectedAlternatives-append-only', fix text 'a rejection is history — append a superseding dated entry, never delete' → verify: bash -c \"grep -qF 'rejectedAlternatives-append-only' plugins/zeroh-roadmap/cli/lib/validate.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/validate.mjs',
          description:
            "Add a new-to-git WARN for arc files (extend the isNewToGit lint family to isArc): an arc NEW to git whose content matches /\\bREJECTED\\b/ but has no `rejectedAlternatives:` key → WARN nudging the typed field — adoption pressure at the only cheap moment, authoring → verify: bash -c \"grep -qF 'rejectedAlternatives:' plugins/zeroh-roadmap/cli/lib/validate.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/validate.test.mjs',
          description:
            'Tests (RED first, tdd): (i) building arc whose rejectedAlternatives shrank vs HEAD → rejectedAlternatives-append-only error; (ii) growth or unchanged → no error even when acceptanceCriteria are unchanged (pins the early-return restructure); (iii) new-to-git arc with prose REJECTED and no key → WARN; (iv) key present → no WARN. Both guards mutation-proven per guard-mutation-proof.md, three results quoted in the report → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/validate.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/cli/lib/validate.test.mjs exits 0 with the four new cases; the append-only guard fires on a building arc even when acceptanceCriteria did not change',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/validate.mjs', 'plugins/zeroh-roadmap/cli/lib/validate.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-26',
      dependsOn: ['10.3'],
      interfaces: { consumes: ['ArcShape.rejectedAlternatives (templates/schema.ts)'], produces: [] },
      transparencyReport: {
        whatWasDone:
          'arcImmutabilityChecks now COLLECTS findings instead of early-returning: the rejectedAlternatives-append-only error fires on a building arc when any HEAD entry was deleted or rewritten (task-time build compared counts; gate R1 strengthened it to a whitespace-normalized multiset CONTENT compare after the round-1 finding that substitution/rewrite passed clean), independent of the acceptanceCriteria branch (whose two short-circuits are preserved inside a conditional). rejectedProseWarnings adds the new-to-git arc WARN: prose REJECTED with no rejectedAlternatives: key nudges toward the typed field.',
        how:
          'TDD: test-engineer wrote 4 RED tests first from problem/criteria only (RED evidence: 7 pass / 4 fail, failures quoted per test); implementation turned the suite 11/11 with the parity suite bin/validate-roadmap-file.test.mjs still 25/25. TASK-TIME MUTATION PROOF (against the count-compare build, 11-test suite): (1) dead shrink check (false &&) → not ok 8 AND not ok 9, 9 pass / 2 fail; (2) dead adoption WARN (early return []) → not ok 10 AND not ok 11, 9 pass / 2 fail; (3) decoy comment on the curRej binding → 11 pass / 0 fail; restored 11/11. POST-R1 RE-PROOF (content-compare guard, 12-test suite): dead erasure guard (false && erased.length > 0) → not ok 8 AND not ok 9 AND not ok 10, 9 pass / 3 fail; decoy comment on the pool binding → 12 pass / 0 fail; restored 12/12; R3 reviewer independently re-ran the dead-WARN mutation → not ok 11 AND not ok 12, 10 pass / 2 fail.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Semantic resurrection (a plan re-proposing a rejected option in different words) is deliberately NOT mechanized — review-phase H2 (task 10.5) is the judgment red-line; these guards cover erasure (delete/substitute/rewrite, post-R1) and prose-burial only. Cosmetic edits INSIDE an entry (quote-style flip, inline comment) also red as erasure — strictness chosen over a false pass.',
      },
    },
    {
      id: '10.5',
      title: 'rejectedAlternatives writers and readers — the anti-resurrection wiring',
      problem:
        'A field nothing writes and nothing reads closes no leak: the interview, the design gate, the architect, the member-phase planner, and the plan reviewer must all touch it for resurrection to become expensive.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/plan-arc/SKILL.md',
          description:
            'Extend the LOCKED DECISIONS interview sentence: a ruling that REJECTS an option also appends a `rejectedAlternatives` entry to the arc; the comment line cites the entry, never restates the why (one home per fact) → verify: bash -c "grep -qF \'rejectedAlternatives\' plugins/zeroh-roadmap/skills/plan-arc/SKILL.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md',
          description:
            'Two edits: (a) §2 Confirm and §3\'s mirror — after the user\'s go, the orchestrator records each LOSING arm as a `rejectedAlternatives` entry in the same write that records designRefs; (b) §2 step 1(b) prior-arc-record list adds `rejectedAlternatives` of roadmap/arcs/*.arc.ts — a rejected option is prior art AGAINST, never a reuse candidate → verify: bash -c "test $(grep -cF \'rejectedAlternatives\' plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md) -ge 2"',
        },
        {
          file: 'plugins/zeroh-roadmap/agents/software-architect.md',
          description:
            'Add `rejectedAlternatives` to the prior-arc-record clause the design-first-advisor role already searches (the list naming designRefs / arc-evals / arc-summaries / followups) → verify: bash -c "grep -qF \'rejectedAlternatives\' plugins/zeroh-roadmap/agents/software-architect.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/plan-phase/SKILL.md',
          description:
            'Extend Step 0\'s duplicate probe: a member phase of an arc ALSO runs grep -F \'rejectedAlternatives\' on the parent .arc.ts and reads the hits before authoring — never re-propose a listed option → verify: bash -c "grep -qF \'rejectedAlternatives\' plugins/zeroh-roadmap/skills/plan-phase/SKILL.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/review-phase/SKILL.md',
          description:
            'Extend H2: check against CONFIRMED designRefs + locked decisions + `rejectedAlternatives` — a task implementing a rejected option is a HIGH finding (the named red-line; reviewer judgment aided by a typed grep target) → verify: bash -c "grep -qF \'rejectedAlternatives\' plugins/zeroh-roadmap/skills/review-phase/SKILL.md"',
        },
      ],
      acceptanceCriteria: [
        'All five edits are one-to-two-line in-place additions (gauntlet lesson 2 hotfix class — no section rewrites); edited sections re-checked against SKILL-AUTHORING-STANDARD.md',
      ],
      files: [
        'plugins/zeroh-roadmap/skills/plan-arc/SKILL.md',
        'plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md',
        'plugins/zeroh-roadmap/agents/software-architect.md',
        'plugins/zeroh-roadmap/skills/plan-phase/SKILL.md',
        'plugins/zeroh-roadmap/skills/review-phase/SKILL.md',
      ],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      dependsOn: ['10.3'],
      interfaces: { consumes: ['ArcShape.rejectedAlternatives (templates/schema.ts)'], produces: [] },
      transparencyReport: {
        whatWasDone:
          'rejectedAlternatives is now written by the plan-arc interview (a rejecting ruling appends an entry; the LOCKED DECISIONS line cites it) and both design-gate Confirm paragraphs (each losing arm recorded in the designRefs write), and read by the architect’s prior-art search, plan-phase Step 0’s member-phase probe, and review-phase H2 (implementing a rejected option = HIGH finding).',
        how:
          'Five in-place additive edits (1-2 lines each, hotfix class per GAUNTLET lesson 2) at the plan’s named anchors; all five step verifies green (design-gate carries 3 occurrences ≥ the required 2). Consumed interface ArcShape.rejectedAlternatives grep-verified present before editing.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The H2 resurrection red-line is reviewer judgment aided by a grep target — semantic matching is not mechanizable (named residual from the architect verdict, recorded in phase notes).',
      },
    },
    {
      id: '10.6',
      title: 'executionMode docblock tells the truth',
      problem:
        "The schema docblock says 'parallel = agent batching allowed for truly independent tasks' but NOTHING consults the field (no CLI read site) and do-phase PRIME RULE 2 forbids exactly that batching — a live contradiction an author or executor can act on.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            "Replace the executionMode docblock: the field is RESERVED and consulted by NOTHING in v1 (derive.mjs returns one runnable member; do-phase forbids task parallelism) — do not author 'parallel'; its fate is owned by the phase-10 parallel-dispatch investigation (DESIGN-NOTES.md §Parallel dispatch). Then re-sync the consumer copy → verify: bash -c \"! grep -qF 'agent batching allowed' plugins/zeroh-roadmap/templates/schema.ts && cmp plugins/zeroh-roadmap/templates/schema.ts lib/roadmap/schema.ts\"",
        },
      ],
      acceptanceCriteria: [
        'No text in either schema copy claims parallel batching is allowed; the docblock names the investigation as the owner of the field’s fate',
      ],
      files: ['plugins/zeroh-roadmap/templates/schema.ts', 'lib/roadmap/schema.ts'],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'The executionMode docblock now states the truth: RESERVED, consulted by nothing in v1 (derive.mjs single-member return, do-phase forbids task parallelism), do not author parallel, fate owned by the phase-10 parallel-dispatch investigation. Consumer copy re-synced byte-identical.',
        how: 'One docblock replacement + cp; verify green (negated old-text grep + cmp), and the untrue text confirmed gone from BOTH copies.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'The enum keeps its parallel member for parse-compat with any existing consumer file; only the doc changed — removal (if 10.8 recommends it) is a schema change with its own phase.',
      },
    },
    {
      id: '10.7',
      title: 'Executor verifies consumed interfaces before building',
      problem:
        "Tasks declare `interfaces: {consumes, produces}` as exact symbol names, but no executor step checks a consumed symbol actually landed — a task can build against a sibling's promise that never materialized and the miss surfaces only at the gate.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/agents/phase-executor.md',
          description:
            'Insert into the task loop before "Implement steps" (item 2): a task declaring interfaces.consumes first greps -F each consumed symbol against the worktree; a missing symbol means the sibling\'s produces never landed → return `status: "escalated"` naming the symbol, NEVER re-derive it locally. Two lines max (do-phase flow measure loads this card) → verify: bash -c "grep -qF \'interfaces.consumes\' plugins/zeroh-roadmap/agents/phase-executor.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
          description:
            'Mirror one line in the per-task loop step 1 for standalone mode: interfaces.consumes symbols are grep -F-verified before implementing; a miss STOPS and escalates with the symbol name (escalating IS success, matching the assumptions[] posture) → verify: bash -c "grep -qF \'interfaces.consumes\' plugins/zeroh-roadmap/skills/do-phase/SKILL.md"',
        },
      ],
      acceptanceCriteria: [
        'Both edits total ≤4 lines; the check names the exact escalation shape (status: "escalated" + symbol) rather than a vague "verify inputs"',
      ],
      files: ['plugins/zeroh-roadmap/agents/phase-executor.md', 'plugins/zeroh-roadmap/skills/do-phase/SKILL.md'],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'The executor task loop (agent card item 2) and do-phase per-task loop step 1 now require: a task declaring interfaces.consumes grep -F-verifies each consumed symbol before implementing; a miss escalates naming the symbol (arc-mode status: "escalated"), never a local re-derivation.',
        how: 'Two in-place additive edits, 4 lines + 3 lines; both verifies green. do-phase flow measure re-run after the edits: 5947 tokens / 3 files (no budget assertion exists for this flow; recorded as the honest footprint).',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The AC said ≤4 lines total; the two edits total 7 physical lines at the repo wrap width while staying two sentences — substance is at the promised size, line count is wrap arithmetic.',
      },
    },
    {
      id: '10.8',
      title: 'INVESTIGATION — parallel dispatch of unblocked phases (deliverable: DESIGN-NOTES section + user options)',
      problem:
        'The dependency graph exists at both levels (Task.dependsOn, Phase.dependsOn) but execution only ever picks THE one next item; the user wants the path to genuine parallel work mapped. Investigation, not implementation — the ruling on which architecture (if any) to build is user-owned.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/DESIGN-NOTES.md',
          description:
            'Author "## Parallel dispatch investigation (phase 10)": (1) sequential-enforcement sites with file:line — derive.mjs RUN-PHASE first-runnable return, do-phase one-task rule, executor NEVER rule 5, planes docblock, lane claims (today\'s one sanctioned parallelism); (2) three architectures priced against the shared 31G/16c box (worktrees, gate serialization, beacon contention): plane-level do-arc fan-out, cross-arc lanes, task-level batching; (3) rule on executionMode\'s fate; (4) END with 2-3 options + recommendation — the ruling is user-owned → verify: bash -c "grep -qF \'Parallel dispatch investigation\' plugins/zeroh-roadmap/DESIGN-NOTES.md"',
        },
      ],
      acceptanceCriteria: [
        'The section cites every enforcement site by file:line verified against the tree at execution time; it ends with named options and a recommendation, and mutates NO code — the ruling is handed to the user',
      ],
      files: ['plugins/zeroh-roadmap/DESIGN-NOTES.md'],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'DESIGN-NOTES.md §Parallel dispatch investigation (phase 10): all six sequential-enforcement sites mapped with file:line re-verified at execution time; three architectures priced against the shared host; executionMode ruled remove-in-follow-up; ends with three user options, recommending: ratify cross-arc lane parallelism (exists today, zero build) + a small executionMode-removal follow-up, deferring plane-level do-arc fan-out until a real multi-plane arc and host headroom exist.',
        how:
          'Anchors re-grepped before writing (derive.mjs:230-268, do-phase:30, phase-executor:70-71, schema planes:999-1001 + executionMode:740, using-zeroh-roadmap:40-47); costs grounded in observed facts (per-worktree npm ci proven this session, 6G capbuild cgroup, ~6 sessions on 31G/16c). No code mutated.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The ruling itself is deliberately open — the section ends with options; option 1 needs a user go before anyone documents (b) as sanctioned or queues the executionMode-removal phase.',
      },
    },
  ],
  notes:
    'interview: skipped — scope fixed by user rulings in-conversation (2026-08-26): vertical slicing priority, parallel work investigated not implemented, interview strength revisited (became 10.2), rest per the presented gap analysis. ' +
    'Interview-strength assessment (the "revisit" the user asked for): plan-arc’s interview is structurally sound (default-on, one-question-at-a-time, recorded skip, LOCKED DECISIONS home, Step 1c decision-completeness sweep); the weakness is plan-phase’s self-judged "underspecified" trigger with no recorded skip — 10.2 closes exactly that asymmetry; no further strengthening warranted. ' +
    'Architect verdict (PROCEED_WITH_TASK): rejectedAlternatives Arc-only, named distinctively (bare REJECTED appears in prose everywhere), decidedBy/decidedAt provenance; option (d) extend-descopes rejected — a rejected alternative is not a scope narrowing and would force every descopes reader to filter; option (b) Phase-level field rejected — standalone-phase rejections already persist in decisionRef and Phase-schema churn is wider blast radius. NAMED RESIDUAL: rejections on arc-less standalone phases stay in decisionRef free prose (findable via the Step 0 phases-grep, untyped); promoting decisionRef to a structured shape is a separate Phase-schema decision. ' +
    'Semantic resurrection is un-mechanizable — the mechanizable envelope is 10.4 (erasure guard — any deleted or rewritten HEAD entry, post-R1 — + adoption WARN) plus 10.5’s reader wiring with review-phase H2 as the judgment red-line; deliberately NO audit-roadmap check 15 (structurally-empty-for-many-arcs = noise). ' +
    'Gauntlet compliance (GAUNTLET-2026-08.md): all skill/agent edits are hotfix-class in-place lines (lesson 2), rationale detail rides references not bodies (lesson 4), edited sections re-checked against SKILL-AUTHORING-STANDARD.md; no full gauntlet re-run warranted for one-to-two-line additive edits. ' +
    'userFacing: false — plugin planning/execution machinery only; no consumer app surface, so no flag applies. ' +
    'Zero-test tasks are legitimate here: 10.1/10.2/10.5/10.6/10.7/10.8 are prose/docblock edits with grep-observable landings; the only executable logic (10.4 lint guards) is tdd with mutation proof.',
})
