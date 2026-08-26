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
  status: 'in-progress',
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
      done: false,
      interfaces: { consumes: [], produces: ['ArcShape.rejectedAlternatives (templates/schema.ts)'] },
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
      done: false,
      dependsOn: ['10.3'],
      interfaces: { consumes: ['ArcShape.rejectedAlternatives (templates/schema.ts)'], produces: [] },
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
      done: false,
      dependsOn: ['10.3'],
      interfaces: { consumes: ['ArcShape.rejectedAlternatives (templates/schema.ts)'], produces: [] },
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
      done: false,
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
      done: false,
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
      done: false,
    },
  ],
  notes:
    'interview: skipped — scope fixed by user rulings in-conversation (2026-08-26): vertical slicing priority, parallel work investigated not implemented, interview strength revisited (became 10.2), rest per the presented gap analysis. ' +
    'Interview-strength assessment (the "revisit" the user asked for): plan-arc’s interview is structurally sound (default-on, one-question-at-a-time, recorded skip, LOCKED DECISIONS home, Step 1c decision-completeness sweep); the weakness is plan-phase’s self-judged "underspecified" trigger with no recorded skip — 10.2 closes exactly that asymmetry; no further strengthening warranted. ' +
    'Architect verdict (PROCEED_WITH_TASK): rejectedAlternatives Arc-only, named distinctively (bare REJECTED appears in prose everywhere), decidedBy/decidedAt provenance; option (d) extend-descopes rejected — a rejected alternative is not a scope narrowing and would force every descopes reader to filter; option (b) Phase-level field rejected — standalone-phase rejections already persist in decisionRef and Phase-schema churn is wider blast radius. NAMED RESIDUAL: rejections on arc-less standalone phases stay in decisionRef free prose (findable via the Step 0 phases-grep, untyped); promoting decisionRef to a structured shape is a separate Phase-schema decision. ' +
    'Semantic resurrection is un-mechanizable — the mechanizable envelope is 10.4 (shrink guard + adoption WARN) plus 10.5’s reader wiring with review-phase H2 as the judgment red-line; deliberately NO audit-roadmap check 15 (structurally-empty-for-many-arcs = noise). ' +
    'Gauntlet compliance (GAUNTLET-2026-08.md): all skill/agent edits are hotfix-class in-place lines (lesson 2), rationale detail rides references not bodies (lesson 4), edited sections re-checked against SKILL-AUTHORING-STANDARD.md; no full gauntlet re-run warranted for one-to-two-line additive edits. ' +
    'userFacing: false — plugin planning/execution machinery only; no consumer app surface, so no flag applies. ' +
    'Zero-test tasks are legitimate here: 10.1/10.2/10.5/10.6/10.7/10.8 are prose/docblock edits with grep-observable landings; the only executable logic (10.4 lint guards) is tdd with mutation proof.',
})
