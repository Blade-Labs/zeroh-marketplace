#!/usr/bin/env node

/**
 * Plugin-internal schema test — exercises BacklogShape / defineBacklog with
 * both the flat and tiered input forms, plus the negative cases that must
 * still be rejected (duplicate phase numbers, malformed entries).
 *
 * @spec roadmap-backlog-tiers — defineBacklog() accepts BOTH a flat
 *   BacklogEntry[] (back-compat) AND a tiered { tiers: [{ tier, label,
 *   items }, ...] } object, normalizes the parse result to BacklogTiered
 *   (synthesizing { tier: 0, label: 'Default', items: [...] } for the flat
 *   form), and continues to reject duplicate phase numbers across the
 *   whole queue. BacklogTierShape constraints: tier is a non-negative
 *   integer, label is a string of at least 5 characters.
 *
 * Not scaffolded into target repos — scaffold-roadmap.sh copies a fixed
 * allowlist of scripts and this file is not on it. Run from the plugin root
 * via:
 *   pnpm install   # provides zod
 *   npx tsx scripts/schema.test.ts
 *
 * Exits 0 on success, 1 if any check fails. Plain assertion-style; no test
 * runner required so the plugin stays zero-deps for end users.
 */

import {
  defineBacklog,
  definePhase,
  defineArc,
  BacklogShape,
  BacklogTierShape,
  ArcShape,
  AcceptanceCriterionShape,
  DesignRefShape,
  ArcVerdictsFileShape,
  ArcEvalReportShape,
  ArcEvalJudgeVerdictShape,
  JUDGE_OWNED_DIMENSION_KEYS,
  ArcTraceShape,
  EvalDimensionShape,
  EvalDimensionKeyShape,
  EvalSentinelShape,
  TimingStatsShape,
  LessonShape,
  ScorecardShape,
  IntentVerdictShape,
  PhaseExecutionResultShape,
  PhaseMetricsShape,
  PhaseEvalRecordShape,
  PhaseEvalRecordListShape,
  RunnerSummaryShape,
  SweepReportShape,
  StructuredGateRoundShape,
  TransparencyReportShape,
  FindingClassShape,
  ProposalLaneShape,
  ProposalKindShape,
  ProposalStatusShape,
  ProposalEvidenceShape,
  OpportunityShape,
  ImportanceRulingShape,
  ImportanceRulingsTableShape,
  ProposalShape,
} from '../templates/schema'
import { crossValidate, discoverArcs } from '../templates/registry'

let failures = 0

function check(label: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ok — ${label}`)
  } catch (err) {
    // Test-failure recorder. Catch is the whole point: keep running every
    // check so one bad case doesn't mask the others. Remediation: open the
    // failing case below, compare the printed message against the relevant
    // shape in templates/schema.ts, and either fix the schema or update
    // the test if the spec genuinely changed.
    failures++
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      `  FAIL — ${label}\n` +
        `         ${message}\n` +
        `         remediation: inspect the case above against templates/schema.ts (BacklogShape / defineBacklog).`,
    )
  }
}

function assertEq<T>(actual: T, expected: T, where: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${where}: expected ${e}, got ${a}`)
}

function assertThrows(fn: () => unknown, where: string): void {
  try {
    fn()
  } catch {
    return
  }
  throw new Error(`${where}: expected to throw, did not`)
}

console.log('BacklogShape — flat input')

check('flat: parses array of entries', () => {
  const out = defineBacklog([
    { phase: 1, name: 'First entry' },
    { phase: 2, name: 'Second entry' },
  ])
  assertEq(out.tiers.length, 1, 'normalized to one default tier')
  assertEq(out.tiers[0].tier, 0, 'default tier number is 0')
  assertEq(out.tiers[0].label, 'Default', 'default tier label')
  assertEq(out.tiers[0].items.length, 2, 'two items in default tier')
  assertEq(out.tiers[0].items[0].phase, 1, 'first entry preserved')
})

check('flat: empty array yields one empty default tier', () => {
  const out = defineBacklog([])
  assertEq(out.tiers.length, 1, 'still one tier')
  assertEq(out.tiers[0].items.length, 0, 'no items')
})

check('flat: rejects duplicate phase numbers', () => {
  assertThrows(
    () =>
      defineBacklog([
        { phase: 1, name: 'First entry' },
        { phase: 1, name: 'Duplicate phase' },
      ]),
    'flat duplicates',
  )
})

check('flat: rejects entry with phase <= 0', () => {
  assertThrows(
    () => defineBacklog([{ phase: 0, name: 'Zero phase' }]),
    'phase=0',
  )
})

check('flat: rejects entry with too-short name', () => {
  assertThrows(() => defineBacklog([{ phase: 1, name: 'no' }]), 'short name')
})

console.log('\nBacklogShape — tiered input')

check('tiered: parses { tiers: [...] }', () => {
  const out = defineBacklog({
    tiers: [
      {
        tier: 0,
        label: 'Sentinel becomes daily driver',
        items: [
          { phase: 18, name: 'Bring up sentinel' },
          { phase: 19, name: 'Wire dashboards' },
        ],
      },
      {
        tier: 1,
        label: 'Polish and cleanup',
        items: [{ phase: 20, name: 'Doc sweep across plugin' }],
      },
    ],
  })
  assertEq(out.tiers.length, 2, 'two tiers preserved')
  assertEq(out.tiers[0].label, 'Sentinel becomes daily driver', 'first label')
  assertEq(out.tiers[1].items[0].phase, 20, 'second tier item')
})

check('tiered: rejects duplicate phase numbers across tiers', () => {
  assertThrows(
    () =>
      defineBacklog({
        tiers: [
          {
            tier: 0,
            label: 'First tier label',
            items: [{ phase: 7, name: 'Some entry' }],
          },
          {
            tier: 1,
            label: 'Second tier label',
            items: [{ phase: 7, name: 'Cross-tier dup' }],
          },
        ],
      }),
    'cross-tier duplicate',
  )
})

check('tiered: rejects negative tier number', () => {
  assertThrows(
    () =>
      defineBacklog({
        tiers: [
          { tier: -1, label: 'Negative tier', items: [{ phase: 1, name: 'Item' }] },
        ],
      }),
    'tier=-1',
  )
})

check('tiered: rejects too-short tier label', () => {
  assertThrows(
    () =>
      defineBacklog({
        tiers: [{ tier: 0, label: 'no', items: [{ phase: 1, name: 'Item' }] }],
      }),
    'short label',
  )
})

check('tiered: empty tiers array is allowed (output: tiers=[])', () => {
  const out = defineBacklog({ tiers: [] })
  assertEq(out.tiers.length, 0, 'no tiers')
})

console.log('\nBacklogShape — exports')

check('BacklogShape and BacklogTierShape are exported and parse-capable', () => {
  BacklogShape.parse([])
  BacklogTierShape.parse({ tier: 2, label: 'A valid label', items: [] })
})

console.log('\nPhaseShape — historical status (loose legacy variant)')

// Minimal valid base fields shared by the historical cases below.
const basePhase = {
  phase: 1,
  name: 'A legacy phase name',
  source: 'legacy source note',
  priority: 'MEDIUM' as const,
  dependsOn: [] as number[],
  conflictsWith: [] as number[],
  keyFiles: ['src/x.ts'],
  stakeholderDemo: 'A demoable legacy outcome.',
  tasks: [] as never[],
}

check('historical: parses loose — no gate required, legacy category/kind accepted', () => {
  const p = definePhase({
    ...basePhase,
    status: 'historical',
    category: 'chore', // legacy vocabulary NOT in the current category enum
    kind: 'feature', // legacy vocabulary NOT in the current kind enum
    // no gate / gateRounds / metrics — historical must not require them
  } as never)
  assertEq(p.status, 'historical', 'status preserved')
})

check('historical: tolerates recorded gate with passed != total (never falsified)', () => {
  const p = definePhase({
    ...basePhase,
    status: 'historical',
    category: 'feature',
    kind: 'logic',
    gate: { lint: 'clean', typeCheck: 'clean', unitTests: { passed: 5, total: 6 }, build: 'clean' },
  } as never)
  assertEq(p.status, 'historical', 'historical with a partial/red gate parses')
})

check('done stays STRICT — missing gate is still rejected (historical did not loosen done)', () => {
  assertThrows(
    () => definePhase({ ...basePhase, status: 'done', category: 'feature', kind: 'logic' } as never),
    'done without gate',
  )
})

console.log('\nArcShape — defineArc')

check('ArcShape: parses id "B" with one plane, applies defaults', () => {
  const a = defineArc({
    id: 'B',
    name: 'Arc Bravo',
    baseRef: 'main',
    planes: [{ name: 'core', phases: [855] }],
  })
  assertEq(a.status, 'planning', 'status defaults to planning')
  assertEq(a.singleSeams, [], 'singleSeams defaults to []')
  assertEq(a.honestyRails, [], 'honestyRails defaults to []')
})

check('ArcShape: rejects empty planes array', () => {
  assertThrows(
    () => defineArc({ id: 'B', name: 'Arc Bravo', baseRef: 'main', planes: [] }),
    'empty planes',
  )
})

check('ArcShape: rejects bad status', () => {
  assertThrows(
    () =>
      ArcShape.parse({
        id: 1,
        name: 'Arc One',
        baseRef: 'main',
        planes: [{ name: 'core', phases: [1] }],
        status: 'bogus',
      }),
    'bad status',
  )
})

check('defineArc: flat `phases` form normalizes to one Default plane', () => {
  const a = defineArc({ id: 'A', name: 'Flat arc', baseRef: 'main', phases: [855, 856] })
  assertEq(a.planes.length, 1, 'one plane')
  assertEq(a.planes[0].name, 'Default', 'plane named Default')
  assertEq(a.planes[0].phases, [855, 856], 'phases carried into the Default plane')
})

check('defineArc: flat form rejects empty phases', () => {
  assertThrows(
    () => defineArc({ id: 'A', name: 'Flat arc', baseRef: 'main', phases: [] }),
    'empty flat phases',
  )
})

// MIRROR INVARIANT: AcceptanceCriterionShape + IntentVerdictShape are duplicated
// byte-identical in each consumer's lib/roadmap/schema.ts (this template is the
// source of truth; there is no generator copying it). The two copies are hand-synced
// and the VALIDATE arc honestyRail enforces it at review — this plugin test env can't
// read a consumer's tree, so we assert the shapes here and trust the sync, rather than
// fake a cross-repo diff the runner cannot do.
console.log('\nArcShape — acceptanceCriteria')

const sampleCriterion = {
  id: 'ac-1',
  job: 'draft a reply a rep can send without editing',
  surfaces: ['office-pane'],
  signal: 'the drafted reply appears in the pane with the masked names rehydrated',
  tier: 'wired' as const,
  bar: 'reads as finished — no raw error, no placeholder, no token left unresolved',
}

check('acceptanceCriteria: an arc round-trips a structured criterion', () => {
  const a = defineArc({
    id: 'B',
    name: 'Arc Bravo',
    baseRef: 'main',
    planes: [{ name: 'core', phases: [855] }],
    acceptanceCriteria: [sampleCriterion],
  })
  assertEq(a.acceptanceCriteria.length, 1, 'one criterion carried')
  assertEq(a.acceptanceCriteria[0].tier, 'wired', 'tier preserved')
  assertEq(a.acceptanceCriteria[0].surfaces, ['office-pane'], 'surfaces preserved')
})

check('acceptanceCriteria: an arc without it defaults to []', () => {
  const a = defineArc({ id: 'B', name: 'Arc Bravo', baseRef: 'main', planes: [{ name: 'core', phases: [855] }] })
  assertEq(a.acceptanceCriteria, [], 'defaults to empty array (non-breaking)')
})

check('acceptanceCriteria: rejects an unknown tier (fail-loud at the boundary)', () => {
  assertThrows(
    () => AcceptanceCriterionShape.parse({ ...sampleCriterion, tier: 'smoke' }),
    'unknown tier',
  )
})

// MIRROR INVARIANT (designRefs): DesignRefShape is likewise duplicated byte-identical
// into each consumer's lib/roadmap/schema.ts — same hand-sync discipline as
// AcceptanceCriterionShape above (no generator); the DESIGN arc honestyRail enforces it
// at review. Asserted here against the template; the cross-repo sync is trusted, not faked.
console.log('\nArcShape — designRefs')

const sampleDesignRef = {
  kind: 'architecture' as const,
  ref: 'docs/architecture/src/governed-connectors-and-tools.md#tool-loop',
  status: 'reused' as const,
  summary: 'the generic governed tool-call loop pattern, reused for this arc',
}

check('designRefs: an arc round-trips a structured design ref', () => {
  const a = defineArc({
    id: 'B',
    name: 'Arc Bravo',
    baseRef: 'main',
    planes: [{ name: 'core', phases: [855] }],
    designRefs: [sampleDesignRef],
  })
  assertEq(a.designRefs.length, 1, 'one design ref carried')
  assertEq(a.designRefs[0].kind, 'architecture', 'kind preserved')
  assertEq(a.designRefs[0].status, 'reused', 'status preserved')
})

check('designRefs: an arc without it defaults to []', () => {
  const a = defineArc({ id: 'B', name: 'Arc Bravo', baseRef: 'main', planes: [{ name: 'core', phases: [855] }] })
  assertEq(a.designRefs, [], 'defaults to empty array (non-breaking)')
})

check('designRefs: rejects an unknown kind (fail-loud at the boundary)', () => {
  assertThrows(
    () => DesignRefShape.parse({ ...sampleDesignRef, kind: 'visual' }),
    'unknown kind',
  )
})

check('designRefs: rejects an unknown status (fail-loud at the boundary)', () => {
  assertThrows(
    () => DesignRefShape.parse({ ...sampleDesignRef, status: 'invented' }),
    'unknown status',
  )
})

// SUPERSESSION: a replaced design and its successor must not both read as current,
// so a superseded ref carries WHO replaced it, WHY and WHEN. The stamp is optional:
// every already-committed arc file predates it and must keep parsing untouched.
const sampleSupersession = {
  byArc: 'CARDKIT',
  reason: 'replaced by the unified card grammar v1.3, one renderer and one vocabulary',
  date: '2026-08-01',
}

check('designRefs: a ref WITHOUT supersededBy still parses and stays absent (back-compat)', () => {
  const d = DesignRefShape.parse({ ...sampleDesignRef })
  assertEq(d.supersededBy, undefined, 'absent stays absent, never invented')
  const a = defineArc({
    id: 'B',
    name: 'Arc Bravo',
    baseRef: 'main',
    planes: [{ name: 'core', phases: [855] }],
    designRefs: [sampleDesignRef],
  })
  assertEq(a.designRefs[0].supersededBy, undefined, 'every committed arc file keeps parsing')
})

check('designRefs: a supersededBy stamp round-trips through defineArc (byArc/reason/date all carried)', () => {
  const a = defineArc({
    id: 'B',
    name: 'Arc Bravo',
    baseRef: 'main',
    planes: [{ name: 'core', phases: [855] }],
    designRefs: [{ ...sampleDesignRef, supersededBy: sampleSupersession }],
  })
  assertEq(a.designRefs[0].supersededBy, sampleSupersession, 'the whole stamp survives the parse, not stripped')
  assertEq(a.designRefs[0].supersededBy?.byArc, 'CARDKIT', 'the successor arc is nameable, so a dead pattern points at its replacement')
  assertEq(a.designRefs[0].status, 'reused', 'the rest of the ref is untouched by the stamp')
})

check('designRefs: a supersededBy reason below 10 chars rejects, exactly 10 parses (the .min(10) boundary)', () => {
  assertThrows(
    () => DesignRefShape.parse({
      ...sampleDesignRef,
      supersededBy: { ...sampleSupersession, reason: 'too short' }, // 9 chars
    }),
    'a 9-char supersession reason',
  )
  const ok = DesignRefShape.parse({
    ...sampleDesignRef,
    supersededBy: { ...sampleSupersession, reason: 'superseded' }, // 10 chars
  })
  assertEq(ok.supersededBy?.reason, 'superseded', 'exactly 10 chars is accepted')
})

console.log('\nIntentVerdictShape — the judge return')

check('IntentVerdict: a met verdict parses', () => {
  const v = IntentVerdictShape.parse({
    criterionId: 'ac-1',
    status: 'met',
    tierUsed: 'wired',
    evidence: 'transcript: the pane rendered "Dear Acme team" with the masked name rehydrated',
    confidence: 'high',
  })
  assertEq(v.status, 'met', 'met preserved')
  assertEq(v.gap, undefined, 'no gap on a met verdict')
})

check('IntentVerdict: a gap verdict carries whatsMissing + suggestedFix', () => {
  const v = IntentVerdictShape.parse({
    criterionId: 'ac-1',
    status: 'gap',
    tierUsed: 'live-ui',
    evidence: 'screenshot pane-1.png: the reply area shows a raw 502 instead of a draft',
    gap: { whatsMissing: 'the draft never renders on a rehydration miss', suggestedFix: 'surface the session-reset message instead of the 502' },
    confidence: 'medium',
  })
  assertEq(v.gap?.whatsMissing.length > 0, true, 'gap detail carried')
})

check('IntentVerdict: a gap verdict WITHOUT a gap object fails the refine', () => {
  assertThrows(
    () => IntentVerdictShape.parse({ criterionId: 'ac-1', status: 'gap', tierUsed: 'wired', evidence: 'x', confidence: 'low' }),
    'gap without gap object',
  )
})

check('IntentVerdict: empty evidence fails (met-without-evidence is unexpressible)', () => {
  assertThrows(
    () => IntentVerdictShape.parse({ criterionId: 'ac-1', status: 'met', tierUsed: 'wired', evidence: '', confidence: 'high' }),
    'empty evidence',
  )
})

console.log('\nPhaseShape — arcId back-reference')

check('arcId: a backlog phase with arcId 855 round-trips', () => {
  const p = definePhase({ ...basePhase, status: 'backlog', category: 'feature', arcId: 855 } as never)
  assertEq(p.arcId, 855, 'arcId preserved')
})

check('arcId: a phase without arcId still parses (back-compat)', () => {
  const p = definePhase({ ...basePhase, status: 'backlog', category: 'feature' } as never)
  assertEq(p.arcId, undefined, 'no arcId is fine')
})

check('arcId: a string arcId "B" round-trips (matches Arc.id union)', () => {
  const p = definePhase({ ...basePhase, status: 'backlog', category: 'feature', arcId: 'B' } as never)
  assertEq(p.arcId, 'B', 'string arcId preserved')
})

console.log('\nPhaseExecutionResult')

check('PhaseExecutionResult: minimal { phase, status, gateRounds } parses, arrays default to []', () => {
  const r = PhaseExecutionResultShape.parse({ phase: 855, status: 'done', gateRounds: 1 })
  assertEq(r.compromises, [], 'compromises defaults to []')
  assertEq(r.hardStops, [], 'hardStops defaults to []')
})

check('PhaseExecutionResult: rejects bad status', () => {
  assertThrows(
    () => PhaseExecutionResultShape.parse({ phase: 855, status: 'bogus', gateRounds: 1 }),
    'bad status',
  )
})

check('executionResult: a phase persists its roll-up and a phase without it still parses', () => {
  const withResult = definePhase({
    ...basePhase,
    status: 'backlog',
    category: 'feature',
    executionResult: { phase: 1, status: 'done', gateRounds: 2 },
  } as never)
  assertEq(withResult.executionResult?.status, 'done', 'persisted result status')
  assertEq(withResult.executionResult?.compromises, [], 'result arrays default to []')
  const without = definePhase({ ...basePhase, status: 'backlog', category: 'feature' } as never)
  assertEq(without.executionResult, undefined, 'absent executionResult is fine (back-compat)')
})

console.log('\nregistry — arc cross-validation')

const sampleArc = defineArc({
  id: 855,
  name: 'Arcs arc',
  baseRef: 'main',
  planes: [{ name: 'core', phases: [855] }],
})

check('crossValidate flags a phase whose arcId matches no arc', () => {
  const errors = crossValidate(
    [{ phase: 855 }, { phase: 856, arcId: 999 }] as never,
    [sampleArc],
  )
  assertEq(errors.length, 1, 'exactly the dangling-arcId error')
})

check('crossValidate passes a phase whose arcId matches a discovered arc', () => {
  assertEq(crossValidate([{ phase: 855, arcId: 855 }] as never, [sampleArc]), [], 'no errors')
})

check('crossValidate flags a phase claimed by two arcs', () => {
  const arcA = defineArc({ id: 'A', name: 'Arc Alpha', baseRef: 'main', phases: [855] })
  const arcB = defineArc({ id: 'B', name: 'Arc Bravo', baseRef: 'main', phases: [855] })
  const errors = crossValidate([{ phase: 855 }] as never, [arcA, arcB])
  if (!errors.some((e) => e.includes('claimed by 2 arc planes'))) {
    throw new Error(`expected a two-arc claim error, got ${JSON.stringify(errors)}`)
  }
})

check('crossValidate flags an arcId that disagrees with the arc listing the phase', () => {
  // phase 855 says arcId 'A', but arc 'A' lists only phase 856 — back-ref vs forward list disagree
  const arcA = defineArc({ id: 'A', name: 'Arc Alpha', baseRef: 'main', phases: [856] })
  const errors = crossValidate([{ phase: 855, arcId: 'A' }, { phase: 856 }] as never, [arcA])
  if (!errors.some((e) => e.includes('that arc') && e.includes('do not list it'))) {
    throw new Error(`expected an arcId-disagreement error, got ${JSON.stringify(errors)}`)
  }
})

console.log('\nv9 tightening — MinimalTask discriminant, gate rounds, label cap, arcId union')

const richTask = {
  id: '1.1',
  title: 'A real task title',
  problem: 'A problem statement that is long enough to satisfy the schema.',
  steps: [{ file: 'src/x.ts', description: 'change something specific' }],
  acceptanceCriteria: ['a criterion long enough to pass'],
  files: ['src/x.ts'],
  done: false,
}

check('v9: a rich-shaped task missing `problem` REJECTS (no silent MinimalTask degrade)', () => {
  const { problem: _dropped, ...taskMissingProblem } = richTask
  assertThrows(
    () =>
      definePhase({
        ...basePhase,
        status: 'backlog',
        category: 'feature',
        tasks: [taskMissingProblem],
      } as never),
    'rich task missing problem must not degrade to MinimalTask',
  )
})

check('v9: a minimal task WITH `minimal: true` parses', () => {
  const p = definePhase({
    ...basePhase,
    status: 'backlog',
    category: 'feature',
    tasks: [{ minimal: true, id: '1.1', title: 'legacy row', done: true }],
  } as never)
  assertEq(p.tasks.length, 1, 'minimal task accepted with the discriminant')
})

check('v9: a 201-char backlog tier label rejects; 200 passes', () => {
  const long = 'x'.repeat(201)
  assertThrows(
    () => BacklogTierShape.parse({ tier: 0, label: long, items: [] }),
    '201-char label',
  )
  BacklogTierShape.parse({ tier: 0, label: 'y'.repeat(200), items: [] })
})

check('v9: RunnerSummary accepts a NUMERIC arcId (parity with Arc.id)', () => {
  const r = RunnerSummaryShape.parse({
    arcId: 2,
    outcome: 'shipped',
    compromiseDisposition: [],
    gateSignals: { arcSweepClean: true, validateArcPassed: true, fullSuiteGreen: true },
    receiptRef: 'receipt-ref-1',
  })
  assertEq(r.arcId, 2, 'numeric arcId parses')
})

check('v9: structured gate round with agent enum + verdict parses; bad agent rejects', () => {
  const round = StructuredGateRoundShape.parse({
    round: 1,
    agent: 'code-reviewer',
    verdict: 'clean',
    findings: [],
    summary: 'Round 1: 0 findings — gate clean',
  })
  assertEq(round.agent, 'code-reviewer', 'agent recorded')
  assertThrows(
    () => StructuredGateRoundShape.parse({ round: 1, agent: 'not-an-agent' }),
    'unknown gate agent',
  )
})

check('v9: PhaseTask.commit accepts a sha and rejects a too-short one', () => {
  const p = definePhase({
    ...basePhase,
    status: 'backlog',
    category: 'feature',
    tasks: [{ ...richTask, done: true, doneDate: '2026-07-01', commit: 'abc123def' }],
  } as never)
  const t = p.tasks[0] as { commit?: string }
  assertEq(t.commit, 'abc123def', 'commit sha recorded')
  assertThrows(
    () =>
      definePhase({
        ...basePhase,
        status: 'backlog',
        category: 'feature',
        tasks: [{ ...richTask, commit: 'abc' }],
      } as never),
    'short commit sha',
  )
})

console.log('\nROADOPUS widenings — additive schema fields (phase 1367)')

check('decisionRef: TransparencyReport accepts an optional decisionRef; absent still parses', () => {
  TransparencyReportShape.parse({
    whatWasDone: 'did the thing properly',
    how: 'by the documented approach',
    compromises: 'a narrow trade-off was accepted here',
    skipped: 'None',
    hardcoded: 'None',
    limitations: 'None',
    decisionRef: 'architect PROCEED_WITH_FIX 2026-07-05',
  })
  TransparencyReportShape.parse({
    whatWasDone: 'did the thing properly',
    how: 'by the documented approach',
    compromises: 'None',
    skipped: 'None',
    hardcoded: 'None',
    limitations: 'None',
  })
})

check('userFacing + flag: a phase with userFacing:true and a FlagId parses; boot-wired variant parses', () => {
  const withId = definePhase({
    ...basePhase, status: 'backlog', category: 'feature',
    userFacing: true, flag: { id: 'MY_FLAG' },
  } as never)
  assertEq((withId as { userFacing?: boolean }).userFacing, true, 'userFacing preserved')
  definePhase({
    ...basePhase, status: 'backlog', category: 'feature',
    userFacing: true, flag: { bootWired: true, justification: 'route-mount cannot hot-flip at runtime' },
  } as never)
})

check('flag: a neither-variant object REJECTS ({id} or {bootWired,justification} only)', () => {
  assertThrows(
    () => definePhase({ ...basePhase, status: 'backlog', category: 'feature', flag: { nonsense: true } } as never),
    'flag neither variant',
  )
  assertThrows(
    () => definePhase({ ...basePhase, status: 'backlog', category: 'feature', flag: { bootWired: true } } as never),
    'bootWired missing justification',
  )
})

check('assumptions: onFalse ESCALATE parses; a non-ESCALATE onFalse rejects', () => {
  definePhase({
    ...basePhase, status: 'backlog', category: 'feature',
    assumptions: [{ claim: 'the file exists at that path', verify: 'test -f x', onFalse: 'ESCALATE' }],
  } as never)
  assertThrows(
    () => definePhase({
      ...basePhase, status: 'backlog', category: 'feature',
      assumptions: [{ claim: 'the file exists at that path', verify: 'test -f x', onFalse: 'WARN' }],
    } as never),
    'assumptions onFalse must be ESCALATE',
  )
})

check('debtResolutions: the widened statuses planned + operator-pending parse (via optional)', () => {
  const p = definePhase({
    ...basePhase, status: 'backlog', category: 'feature',
    debtResolutions: [
      { ref: '1.1.compromises', status: 'planned', date: '2026-07-05' },
      { ref: '1.2.skipped', status: 'operator-pending', date: '2026-07-05' },
    ],
  } as never)
  assertEq((p as { debtResolutions?: unknown[] }).debtResolutions?.length, 2, 'two debt resolutions parsed')
})

check('back-compat: a pre-ROADOPUS-shaped phase with NONE of the new fields parses', () => {
  const p = definePhase({ ...basePhase, status: 'backlog', category: 'feature' } as never)
  assertEq((p as { userFacing?: boolean }).userFacing, undefined, 'no userFacing')
  assertEq((p as { flag?: unknown }).flag, undefined, 'no flag')
  assertEq((p as { assumptions?: unknown }).assumptions, undefined, 'no assumptions')
})

console.log('\nActor attribution — PhaseExecutionResult.driver + phase-level plannedBy')

check('driver: a result WITH driver parses and round-trips model + lane', () => {
  const r = PhaseExecutionResultShape.parse({
    phase: 1995,
    status: 'done',
    gateRounds: 1,
    driver: { model: 'claude-opus-5', lane: 'session' },
  })
  assertEq(r.driver?.model, 'claude-opus-5', 'driver.model')
  assertEq(r.driver?.lane, 'session', 'driver.lane')
})

check('driver: a HISTORICAL result without driver still parses, and driver stays undefined', () => {
  const r = PhaseExecutionResultShape.parse({ phase: 855, status: 'done', gateRounds: 1 })
  assertEq(r.driver, undefined, 'absent driver is absent, never defaulted')
})

check('driver: an UNKNOWN lane parses — a result must load whoever wrote it; only empty rejects', () => {
  const r = PhaseExecutionResultShape.parse({
    phase: 1995,
    status: 'done',
    gateRounds: 1,
    driver: { model: 'grok-9', lane: 'grok-exec' },
  })
  assertEq(r.driver?.lane, 'grok-exec', 'an unregistered lane round-trips verbatim')
  assertThrows(
    () =>
      PhaseExecutionResultShape.parse({
        phase: 1995,
        status: 'done',
        gateRounds: 1,
        driver: { model: 'grok-9', lane: '' },
      }),
    'an empty lane',
  )
})

check('plannedBy: a phase WITH plannedBy parses; a historical phase WITHOUT it still parses', () => {
  const withPlanner = definePhase({
    ...basePhase,
    status: 'backlog',
    category: 'feature',
    plannedBy: { model: 'claude-opus-5' },
  } as never)
  assertEq(
    (withPlanner as { plannedBy?: { model: string } }).plannedBy?.model,
    'claude-opus-5',
    'plannedBy.model',
  )
  const without = definePhase({ ...basePhase, status: 'backlog', category: 'feature' } as never)
  assertEq((without as { plannedBy?: unknown }).plannedBy, undefined, 'absent plannedBy is absent')
})

check('arc descopes + criteriaRatifications: accepted; a descope missing ratifiedBy rejects', () => {
  const arc = defineArc({
    id: 'TESTARC', name: 'A test arc name', baseRef: 'develop',
    planes: [{ name: 'plane one', phases: [1] }],
    descopes: [{ item: 'the keyed HMAC widening', ratifiedBy: 'DPO', ratifiedAt: '2026-07-05' }],
    criteriaRatifications: ['2026-07-05: narrowed AC-3 per user ratification'],
  } as never)
  assertEq((arc as { descopes?: unknown[] }).descopes?.length, 1, 'descope recorded')
  assertThrows(
    () => defineArc({
      id: 'TESTARC2', name: 'A test arc name', baseRef: 'develop',
      planes: [{ name: 'plane one', phases: [1] }],
      descopes: [{ item: 'the keyed HMAC widening', ratifiedAt: '2026-07-05' }],
    } as never),
    'descope missing ratifiedBy',
  )
})

check('RunnerSummary openFollowups: accepted; absent still parses', () => {
  const base = {
    arcId: 'TESTARC', outcome: 'shipped' as const,
    compromiseDisposition: [] as { item: string; disposition: 'ACCEPT' }[],
    gateSignals: { arcSweepClean: true, validateArcPassed: true, fullSuiteGreen: true },
    receiptRef: 'none',
  }
  RunnerSummaryShape.parse({ ...base, openFollowups: 3 })
  RunnerSummaryShape.parse(base)
})

console.log('\nRole bindings — PhaseExecutionResult.roles')

/* The roles array is the RECORDING TARGET for the protocol-role resolver: which model filled
 * each role and how it was fulfilled. Four invariants ride on it:
 *   - every field of a binding SURVIVES the parse — a recording target that silently drops
 *     what it was handed records nothing;
 *   - `via` is a CLOSED vocabulary (native | child-cli | inline) and the rejection NAMES it —
 *     an unrecognised fulfilment mode must not be written down as if it were understood;
 *   - a binding is all-or-nothing — role/model/via are required, so a half-filled entry
 *     cannot masquerade as a record;
 *   - absence is NOT emptiness — a result without roles comes back undefined, keeping
 *     "no bindings recorded" distinguishable from "the resolver ran and bound nothing".
 */
type RoleBinding = {
  role: string
  model: string
  via: 'native' | 'child-cli' | 'inline'
  substituted?: { from: string; to: string; reason: string }
}

const VIA_MODES = ['native', 'child-cli', 'inline'] as const

const substitutionReason = 'the native lane was saturated, the child CLI answered the review role'

const sampleRoles: RoleBinding[] = [
  { role: 'implementer', model: 'claude-opus-5', via: 'native' },
  {
    role: 'reviewer',
    model: 'gpt-5-codex',
    via: 'child-cli',
    substituted: { from: 'claude-opus-5', to: 'gpt-5-codex', reason: substitutionReason },
  },
]

type ZodIssueLike = { path?: (string | number)[]; message?: string; values?: unknown }

/** Assert `fn` rejected via Zod and hand back the issues. A parse that SUCCEEDS and a
 *  runtime TypeError are both failures here — neither is a schema rejection, and an
 *  assertThrows that cannot tell them apart certifies nothing. */
function zodIssues(fn: () => unknown, where: string): ZodIssueLike[] {
  let threw = false
  let thrown: unknown
  try {
    fn()
  } catch (err) {
    threw = true
    thrown = err
  }
  if (!threw) throw new Error(`${where}: expected a schema rejection, the parse SUCCEEDED`)
  const issues = (thrown as { issues?: unknown }).issues
  if (!Array.isArray(issues)) {
    const message = thrown instanceof Error ? thrown.message : String(thrown)
    throw new Error(`${where}: threw a NON-Zod error (${message}) — a runtime error is not a schema rejection`)
  }
  return issues as ZodIssueLike[]
}

function issueAtPath(issues: ZodIssueLike[], path: (string | number)[], where: string): ZodIssueLike {
  const hit = issues.find((i) => JSON.stringify(i.path) === JSON.stringify(path))
  if (!hit) {
    throw new Error(
      `${where}: no issue at path ${JSON.stringify(path)} — the rejection must point at the offending binding; issues were ${JSON.stringify(issues)}`,
    )
  }
  return hit
}

function assertNamesViaEnum(issue: ZodIssueLike, where: string): void {
  const rendered = `${issue.message ?? ''} ${JSON.stringify(issue.values ?? null)}`
  for (const mode of VIA_MODES) {
    if (!rendered.includes(mode)) {
      throw new Error(`${where}: the rejection must NAME the enum — "${mode}" is missing from ${JSON.stringify(rendered)}`)
    }
  }
}

check('roles: a two-entry roles array round-trips every field, through the shape AND through a phase file', () => {
  const parsed = PhaseExecutionResultShape.parse({
    phase: 1996,
    status: 'done',
    gateRounds: 1,
    roles: sampleRoles,
  }) as { roles?: RoleBinding[] }
  const roles = parsed.roles
  if (!roles) {
    throw new Error(
      'roles came back undefined — PhaseExecutionResultShape does not carry the field, so the binding record was stripped (a plain z.object drops unknown keys)',
    )
  }
  assertEq(roles.length, 2, 'both bindings carried')
  assertEq(roles[0].role, 'implementer', 'roles[0].role')
  assertEq(roles[0].model, 'claude-opus-5', 'roles[0].model')
  assertEq(roles[0].via, 'native', 'roles[0].via')
  assertEq(roles[0].substituted, undefined, 'roles[0].substituted stays absent — never an invented empty object')
  assertEq(roles[1].role, 'reviewer', 'roles[1].role')
  assertEq(roles[1].model, 'gpt-5-codex', 'roles[1].model')
  assertEq(roles[1].via, 'child-cli', 'roles[1].via')
  assertEq(roles[1].substituted?.from, 'claude-opus-5', 'roles[1].substituted.from — who was asked')
  assertEq(roles[1].substituted?.to, 'gpt-5-codex', 'roles[1].substituted.to — who answered')
  assertEq(roles[1].substituted?.reason, substitutionReason, 'roles[1].substituted.reason — why the swap happened')

  const p = definePhase({
    ...basePhase,
    status: 'backlog',
    category: 'feature',
    executionResult: { phase: 1, status: 'done', gateRounds: 1, roles: sampleRoles },
  } as never)
  const persisted = (p as { executionResult?: { roles?: RoleBinding[] } }).executionResult?.roles
  assertEq(persisted?.length, 2, 'a phase FILE persists both bindings')
  assertEq(persisted?.[1].substituted?.reason, substitutionReason, 'the substitution survives the phase-file parse')
})

check('roles: all three via modes parse, and a fourth REJECTS with the enum error at the binding path', () => {
  for (const via of VIA_MODES) {
    const parsed = PhaseExecutionResultShape.parse({
      phase: 1996,
      status: 'done',
      gateRounds: 1,
      roles: [{ role: 'implementer', model: 'claude-opus-5', via }],
    }) as { roles?: RoleBinding[] }
    assertEq(parsed.roles?.[0].via, via, `legal mode "${via}" round-trips`)
  }

  const shapeIssues = zodIssues(
    () =>
      PhaseExecutionResultShape.parse({
        phase: 1996,
        status: 'done',
        gateRounds: 1,
        roles: [{ role: 'implementer', model: 'claude-opus-5', via: 'subagent' }],
      }),
    'via "subagent" on PhaseExecutionResultShape',
  )
  assertNamesViaEnum(
    issueAtPath(shapeIssues, ['roles', 0, 'via'], 'via "subagent" on PhaseExecutionResultShape'),
    'via "subagent" on PhaseExecutionResultShape',
  )

  const phaseIssues = zodIssues(
    () =>
      definePhase({
        ...basePhase,
        status: 'backlog',
        category: 'feature',
        executionResult: {
          phase: 1,
          status: 'done',
          gateRounds: 1,
          roles: [{ role: 'implementer', model: 'claude-opus-5', via: 'subagent' }],
        },
      } as never),
    'via "subagent" in a phase file',
  )
  assertNamesViaEnum(
    issueAtPath(phaseIssues, ['executionResult', 'roles', 0, 'via'], 'via "subagent" in a phase file'),
    'via "subagent" in a phase file',
  )
})

check('roles: a result WITHOUT roles parses unchanged — roles stays undefined, never defaulted to []', () => {
  const declared = Object.keys(
    (PhaseExecutionResultShape as unknown as { shape?: Record<string, unknown> }).shape ?? {},
  )
  if (!declared.includes('roles')) {
    throw new Error(
      `PhaseExecutionResultShape declares no \`roles\` key (declared: ${declared.join(', ')}) — an absent roles is then indistinguishable from a stripped unknown key and this case would pass vacuously`,
    )
  }
  const r = PhaseExecutionResultShape.parse({ phase: 855, status: 'done', gateRounds: 1 }) as {
    roles?: RoleBinding[]
    compromises: string[]
  }
  assertEq(r.roles, undefined, 'absent roles stays absent — [] would read as "the resolver ran and bound nothing"')
  assertEq(r.compromises, [], 'the rest of the result is untouched by the widening')

  const p = definePhase({
    ...basePhase,
    status: 'backlog',
    category: 'feature',
    executionResult: { phase: 1, status: 'done', gateRounds: 2 },
  } as never)
  assertEq(
    (p as { executionResult?: { roles?: unknown } }).executionResult?.roles,
    undefined,
    'every already-committed phase file keeps parsing with roles absent',
  )
})

check('roles: a binding missing role, model, or via REJECTS — a half-filled binding records nothing', () => {
  const full = { role: 'implementer', model: 'claude-opus-5', via: 'native' as const }
  for (const key of ['role', 'model', 'via'] as const) {
    const { [key]: _dropped, ...partial } = full
    const where = `a binding missing \`${key}\``
    issueAtPath(
      zodIssues(
        () =>
          PhaseExecutionResultShape.parse({
            phase: 1996,
            status: 'done',
            gateRounds: 1,
            roles: [partial],
          }),
        where,
      ),
      ['roles', 0, key],
      where,
    )
  }
})

console.log('\nSweepReportShape — the arc-sweep record')

const sampleSweepReport = {
  arcId: 'TESTARC',
  date: '2026-07-27',
  estateRatchets: 'green' as const,
  phaseGates: [
    { phase: 1940, done: true, gateGreen: true },
    { phase: 1941, done: true, gateGreen: true },
  ],
  debtDispositions: [
    {
      item: 'the keyed HMAC widening',
      disposition: 'OPERATOR-PENDING' as const,
      ref: 'roadmap/followups/TESTARC.md',
    },
  ],
  architectVerdict: 'PROCEED — no spine or contract risk left open',
  deferredToReleaseSweep: ['the docs canon refresh'],
  overall: 'green' as const,
  blockers: [],
}

check('SweepReport: a full report with an OPERATOR-PENDING debt disposition round-trips', () => {
  const r = SweepReportShape.parse(sampleSweepReport)
  assertEq(r.arcId, 'TESTARC', 'arcId preserved')
  assertEq(r.estateRatchets, 'green', 'estateRatchets preserved')
  assertEq(r.phaseGates.length, 2, 'both phase gates carried')
  assertEq(r.phaseGates[0].phase, 1940, 'first gate phase preserved')
  assertEq(r.phaseGates[0].gateGreen, true, 'first gate verdict preserved')
  assertEq(r.debtDispositions[0].disposition, 'OPERATOR-PENDING', 'disposition token preserved')
  assertEq(r.debtDispositions[0].ref, 'roadmap/followups/TESTARC.md', 'disposition ref preserved')
  assertEq(r.deferredToReleaseSweep, ['the docs canon refresh'], 'deferrals preserved')
  assertEq(r.overall, 'green', 'overall verdict preserved')
  assertEq(r.blockers, [], 'blockers preserved')
})

// TAXONOMY REUSE: the disposition vocabulary must be CompromiseDispositionShape itself,
// not a parallel enum that could drift from the phase-level debt taxonomy. An invented
// token is the cheapest proof of that reuse.
check('SweepReport: an unknown disposition token rejects (reuses CompromiseDispositionShape)', () => {
  assertThrows(
    () =>
      SweepReportShape.parse({
        ...sampleSweepReport,
        debtDispositions: [{ item: 'the keyed HMAC widening', disposition: 'MAYBE-LATER' }],
      }),
    'unknown disposition token',
  )
})

check('SweepReport: an empty phaseGates array rejects (a sweep over no gates is unexpressible)', () => {
  assertThrows(
    () => SweepReportShape.parse({ ...sampleSweepReport, phaseGates: [] }),
    'empty phaseGates',
  )
})

console.log('\nArcVerdictsFileShape — the persisted judge run')

const sampleMetVerdict = {
  criterionId: 'ac-1',
  status: 'met' as const,
  tierUsed: 'wired' as const,
  evidence: 'transcript: the pane rendered "Dear Acme team" with the masked name rehydrated',
  confidence: 'high' as const,
}

check('ArcVerdictsFile: a file with one met verdict parses and round-trips', () => {
  const f = ArcVerdictsFileShape.parse({
    arcId: 855,
    date: '2026-07-27',
    judgeModel: 'claude-opus-4',
    verdicts: [sampleMetVerdict],
    ratifiedDescopes: ['AC-3 narrowed per user ratification'],
  })
  assertEq(f.arcId, 855, 'numeric arcId parses (parity with Arc.id)')
  assertEq(f.judgeModel, 'claude-opus-4', 'judgeModel preserved')
  assertEq(f.verdicts.length, 1, 'one verdict carried')
  assertEq(f.verdicts[0].status, 'met', 'verdict status preserved')
  assertEq(f.ratifiedDescopes, ['AC-3 narrowed per user ratification'], 'descopes preserved')
})

check('ArcVerdictsFile: an EMPTY verdicts array rejects (a judge run with no verdict is not a run)', () => {
  assertThrows(
    () =>
      ArcVerdictsFileShape.parse({
        arcId: 855,
        date: '2026-07-27',
        judgeModel: 'claude-opus-4',
        verdicts: [],
      }),
    'empty verdicts',
  )
})

// The IntentVerdict `.refine` (gap status requires a gap object) must still bite
// through the array wrapper — an array of a refined shape must not relax it.
check('ArcVerdictsFile: a gap verdict without a gap object rejects through the array wrapper', () => {
  assertThrows(
    () =>
      ArcVerdictsFileShape.parse({
        arcId: 855,
        date: '2026-07-27',
        judgeModel: 'claude-opus-4',
        verdicts: [
          sampleMetVerdict,
          {
            criterionId: 'ac-2',
            status: 'gap',
            tierUsed: 'live-ui',
            evidence: 'screenshot pane-1.png: the reply area shows a raw 502 instead of a draft',
            confidence: 'medium',
          },
        ],
      }),
    'gap verdict without gap object inside the file',
  )
})

console.log('\nPhaseMetricsShape — time-axis widening (additive)')

// ADDITIVE GUARANTEE: verbatim historical fixture — the seven original count fields and
// nothing else. Every metrics record already written to a roadmap phase file looks exactly
// like this; if the widening ever became required, this case reds.
const historicalMetrics = {
  commits: 4,
  linesAdded: 312,
  linesRemoved: 87,
  filesChanged: 11,
  testsAtStart: 640,
  testsAtEnd: 651,
  testsAdded: 11,
}

check('PhaseMetrics: a historical seven-field record still parses; the three new keys are undefined', () => {
  const m = PhaseMetricsShape.parse(historicalMetrics)
  assertEq(m.commits, 4, 'commits preserved')
  assertEq(m.testsAdded, 11, 'testsAdded preserved')
  assertEq(m.startedAt, undefined, 'startedAt absent, not defaulted')
  assertEq(m.completedAt, undefined, 'completedAt absent, not defaulted')
  assertEq(m.haltCount, undefined, 'haltCount absent, not zero-filled')
})

check('PhaseMetrics: a record WITH startedAt/completedAt/haltCount round-trips all three', () => {
  const m = PhaseMetricsShape.parse({
    ...historicalMetrics,
    startedAt: '2026-07-26T09:15:00.000Z',
    completedAt: '2026-07-27T11:42:00.000Z',
    haltCount: 2,
  })
  assertEq(m.startedAt, '2026-07-26T09:15:00.000Z', 'startedAt preserved')
  assertEq(m.completedAt, '2026-07-27T11:42:00.000Z', 'completedAt preserved')
  assertEq(m.haltCount, 2, 'haltCount preserved')
})

check('PhaseMetrics: haltCount 0 parses but -1 rejects (a negative halt count is not honest-absent)', () => {
  const zero = PhaseMetricsShape.parse({ ...historicalMetrics, haltCount: 0 })
  assertEq(zero.haltCount, 0, 'an explicit zero is a real recorded value')
  assertThrows(
    () => PhaseMetricsShape.parse({ ...historicalMetrics, haltCount: -1 }),
    'haltCount=-1',
  )
})

console.log('\nEval engine contracts — ArcEvalReport / ArcTrace / TimingStats')

// A reject-only case would pass VACUOUSLY if the shape were missing — the
// undefined-property TypeError is a throw too, and assertThrows can't tell it
// from a real schema rejection. Every reject-only case below asserts the export
// exists FIRST, outside the assertThrows.
function requireShape(shape: unknown, name: string): void {
  if (!shape || typeof (shape as { parse?: unknown }).parse !== 'function') {
    throw new Error(`${name} is not exported from templates/schema.ts (or is not a zod shape)`)
  }
}

// ONE fixture, mutated by copy in the negative cases: repeating seven dimension
// literals per case would let a drifting key silently pass in the copies that
// weren't updated. Every negative below starts from THIS valid report.
function makeDimensions(): Record<string, unknown> {
  return {
    'code-confidence': {
      owner: 'deterministic',
      score: 82,
      signals: { gateRounds: 2, slotFailures: 0 },
      sourceRefs: ['roadmap/phases/1996.phase.ts#gate'],
    },
    'verified-vs-intent': {
      owner: 'deterministic',
      score: 100,
      signals: { met: 4, gap: 0 },
      sourceRefs: ['roadmap/arcs/EVALLOOP-verdicts.json'],
    },
    'standards-adherence': {
      owner: 'judge',
      sentinel: 'pending-judge',
      signals: { reviewRounds: 1 },
      sourceRefs: ['roadmap/arcs/EVALLOOP-sweep.json'],
    },
    'doc-brevity': {
      owner: 'judge',
      sentinel: 'pending-judge',
      signals: { docLines: 240 },
      sourceRefs: ['docs/architecture/src/testing.md'],
    },
    'composability-testability': {
      owner: 'judge',
      sentinel: 'pending-judge',
      signals: { newSeams: 'two injected fetchers' },
      sourceRefs: ['templates/schema.ts'],
    },
    speed: {
      owner: 'deterministic',
      score: 64,
      signals: { medianMinutes: 41 },
      sourceRefs: ['roadmap/phases/1996.phase.ts#metrics'],
    },
    'plan-quality': {
      owner: 'judge',
      sentinel: 'unjudged-backfill',
      signals: { haltCount: 0 },
      sourceRefs: ['roadmap/phases/1996.phase.ts#tasks'],
    },
  }
}

function makeEvalReport(): Record<string, unknown> {
  return {
    arcId: 'EVALLOOP',
    date: '2026-07-27',
    judgeModel: 'claude-opus-5',
    dimensions: makeDimensions(),
    ratchet: [
      { dimension: 'code-confidence', baseline: 78, value: 82, delta: 4, regression: false },
      {
        dimension: 'plan-quality',
        baseline: null,
        value: null,
        delta: null,
        regression: false,
        note: 'no-baseline',
      },
    ],
    attribution: {
      drivers: [{ model: 'claude-opus-5', lane: 'session', phases: [1996] }],
      reviewers: [{ agent: 'code-reviewer', rounds: 2 }],
    },
    notes: [],
  }
}

check('EvalDimension: BOTH score and sentinel REJECTS (a scored dimension is not also absent)', () => {
  requireShape(EvalDimensionShape, 'EvalDimensionShape')
  assertThrows(
    () =>
      EvalDimensionShape.parse({
        owner: 'deterministic',
        score: 82,
        sentinel: 'pending-judge',
        signals: { gateRounds: 2 },
        sourceRefs: ['roadmap/phases/1996.phase.ts#gate'],
      }),
    'score and sentinel together',
  )
})

check('EvalDimension: NEITHER score nor sentinel REJECTS (silence is not a score)', () => {
  requireShape(EvalDimensionShape, 'EvalDimensionShape')
  assertThrows(
    () =>
      EvalDimensionShape.parse({
        owner: 'judge',
        signals: { gateRounds: 2 },
        sourceRefs: ['roadmap/phases/1996.phase.ts#gate'],
      }),
    'neither score nor sentinel',
  )
})

check('EvalDimension: a deterministic scored dimension and a judge pending-judge dimension both parse', () => {
  const scored = EvalDimensionShape.parse({
    owner: 'deterministic',
    score: 82,
    signals: { gateRounds: 2, slotFailures: 0 },
    sourceRefs: ['roadmap/phases/1996.phase.ts#gate'],
    evidence: 'gate R1 clean, R2 clean',
  })
  assertEq(scored.score, 82, 'score preserved')
  assertEq(scored.sentinel, undefined, 'no sentinel on a scored dimension')
  const pending = EvalDimensionShape.parse({
    owner: 'judge',
    sentinel: 'pending-judge',
    signals: { reviewRounds: 1 },
    sourceRefs: ['roadmap/arcs/EVALLOOP-sweep.json'],
  })
  assertEq(pending.sentinel, 'pending-judge', 'sentinel preserved')
  assertEq(pending.score, undefined, 'no score on a sentinel dimension')
})

check('EvalSentinel: the vocabulary is CLOSED — an invented sentinel string rejects', () => {
  requireShape(EvalSentinelShape, 'EvalSentinelShape')
  EvalSentinelShape.parse('no-baseline')
  assertThrows(() => EvalSentinelShape.parse('not-yet-scored'), 'invented sentinel')
})

check('EvalDimensionKey: the dimension vocabulary is CLOSED — an eighth key rejects', () => {
  requireShape(EvalDimensionKeyShape, 'EvalDimensionKeyShape')
  EvalDimensionKeyShape.parse('doc-brevity')
  assertThrows(() => EvalDimensionKeyShape.parse('vibes'), 'invented dimension key')
})

check('ArcEvalReport: a full SEVEN-key report parses and round-trips every dimension', () => {
  const r = ArcEvalReportShape.parse(makeEvalReport())
  assertEq(Object.keys(r.dimensions).sort(), [
    'code-confidence',
    'composability-testability',
    'doc-brevity',
    'plan-quality',
    'speed',
    'standards-adherence',
    'verified-vs-intent',
  ], 'all seven dimensions present')
  assertEq(r.dimensions['code-confidence'].score, 82, 'deterministic score carried')
  assertEq(r.dimensions['plan-quality'].sentinel, 'unjudged-backfill', 'sentinel carried')
  assertEq(r.attribution.drivers[0].phases, [1996], 'driver phases carried')
  assertEq(r.attribution.reviewers[0].rounds, 2, 'reviewer rounds carried')
})

check('ArcEvalReport: a SIX-key report REJECTS (a dropped dimension cannot be silent)', () => {
  requireShape(ArcEvalReportShape, 'ArcEvalReportShape')
  const report = makeEvalReport()
  const dims = report.dimensions as Record<string, unknown>
  delete dims['doc-brevity']
  assertThrows(() => ArcEvalReportShape.parse(report), 'six dimensions')
})

check('ArcEvalReport: an UNKNOWN eighth dimension key REJECTS (a scorer cannot invent one)', () => {
  requireShape(ArcEvalReportShape, 'ArcEvalReportShape')
  const report = makeEvalReport()
  ;(report.dimensions as Record<string, unknown>)['vibes'] = {
    owner: 'judge',
    score: 99,
    signals: {},
    sourceRefs: ['nowhere.md'],
  }
  assertThrows(() => ArcEvalReportShape.parse(report), 'eighth dimension key')
})

check('ArcEvalReport: sourceRefs: [] REJECTS (the reproducibility bar bites per dimension)', () => {
  requireShape(ArcEvalReportShape, 'ArcEvalReportShape')
  const report = makeEvalReport()
  ;(report.dimensions as Record<string, { sourceRefs: string[] }>)['speed'].sourceRefs = []
  assertThrows(() => ArcEvalReportShape.parse(report), 'empty sourceRefs')
  const withEmptyRef = makeEvalReport()
  ;(withEmptyRef.dimensions as Record<string, { sourceRefs: string[] }>)['speed'].sourceRefs = ['']
  assertThrows(() => ArcEvalReportShape.parse(withEmptyRef), 'blank sourceRef string')
})

check('ArcEvalReport: score 101 and score -1 REJECT (0..100 is the closed range)', () => {
  const over = makeEvalReport()
  ;(over.dimensions as Record<string, { score?: number }>)['speed'].score = 101
  assertThrows(() => ArcEvalReportShape.parse(over), 'score 101')
  const under = makeEvalReport()
  ;(under.dimensions as Record<string, { score?: number }>)['speed'].score = -1
  assertThrows(() => ArcEvalReportShape.parse(under), 'score -1')
  const atBounds = makeEvalReport()
  ;(atBounds.dimensions as Record<string, { score?: number }>)['speed'].score = 100
  assertEq(ArcEvalReportShape.parse(atBounds).dimensions['speed'].score, 100, 'score 100 is in range')
  const atZero = makeEvalReport()
  ;(atZero.dimensions as Record<string, { score?: number }>)['speed'].score = 0
  assertEq(ArcEvalReportShape.parse(atZero).dimensions['speed'].score, 0, 'score 0 is in range')
})

check('ArcEvalReport ratchet: regression:true with delta:null REJECTS; with a real delta parses', () => {
  const bad = makeEvalReport()
  ;(bad.ratchet as unknown[])[0] = {
    dimension: 'code-confidence',
    baseline: null,
    value: null,
    delta: null,
    regression: true,
  }
  assertThrows(() => ArcEvalReportShape.parse(bad), 'regression without a computable delta')

  const good = makeEvalReport()
  ;(good.ratchet as unknown[])[0] = {
    dimension: 'code-confidence',
    baseline: 88,
    value: 82,
    delta: -6,
    regression: true,
    note: 'gate took two extra rounds',
  }
  const r = ArcEvalReportShape.parse(good)
  assertEq(r.ratchet[0].delta, -6, 'a real regression carries its delta')
  // the no-baseline row from the fixture: null everywhere, regression false
  assertEq(r.ratchet[1].baseline, null, 'no-baseline row keeps a null baseline')
  assertEq(r.ratchet[1].regression, false, 'a missing baseline is not a regression')
  assertEq(r.ratchet[1].note, 'no-baseline', 'the sentinel note survives')
})

check('ArcTrace: a minimal one-phase trace parses and the array defaults land', () => {
  const t = ArcTraceShape.parse({
    arcId: 1996,
    collectedAt: '2026-07-27T09:15:00.000Z',
    phases: [{ phase: 1996, taskCount: 3 }],
    git: { escapeScan: 'complete', escapeFixes: [] },
  })
  assertEq(t.phases[0].keyFiles, [], 'keyFiles defaults to []')
  assertEq(t.phases[0].transparency, [], 'transparency defaults to []')
  assertEq(t.phases[0].gateRuns, [], 'gateRuns defaults to []')
  assertEq(t.phases[0].executionResult, undefined, 'absent executionResult stays absent')
  assertEq(t.sweep, undefined, 'absent sweep stays absent')
  assertEq(t.git.landedAt, undefined, 'absent landedAt stays absent, never invented')
})

check('ArcTrace: a non-datetime collectedAt REJECTS (a trace timestamp is machine-comparable)', () => {
  requireShape(ArcTraceShape, 'ArcTraceShape')
  assertThrows(
    () =>
      ArcTraceShape.parse({
        arcId: 1996,
        collectedAt: '2026-07-27',
        phases: [{ phase: 1996, taskCount: 3 }],
        git: { escapeScan: 'complete', escapeFixes: [] },
      }),
    'date-only collectedAt',
  )
})

check('ArcTrace: composes the EXISTING shapes verbatim — a real execution result + metrics parse through', () => {
  const t = ArcTraceShape.parse({
    arcId: 'EVALLOOP',
    collectedAt: '2026-07-27T09:15:00.000Z',
    phases: [
      {
        phase: 1996,
        executionResult: {
          phase: 1996,
          status: 'done',
          gateRounds: 2,
          driver: { model: 'claude-opus-5', lane: 'session' },
        },
        metrics: {
          ...historicalMetrics,
          startedAt: '2026-07-26T09:15:00.000Z',
          completedAt: '2026-07-27T11:42:00.000Z',
          haltCount: 2,
        },
        plannedBy: { model: 'claude-opus-5' },
        keyFiles: ['templates/schema.ts'],
        taskCount: 4,
        transparency: [
          {
            whatWasDone: 'added the eval engine contracts',
            how: 'by writing the shapes into templates/schema.ts',
            compromises: 'None',
            skipped: 'None',
            hardcoded: 'None',
            limitations: 'None',
          },
        ],
        gateRuns: [
          {
            startedAt: '2026-07-27T10:00:00.000Z',
            green: true,
            rounds: [{ round: 1, agent: 'code-reviewer', verdict: 'clean' }],
            slotFailures: 0,
          },
        ],
      },
    ],
    sweep: sampleSweepReport,
    verdicts: {
      arcId: 'EVALLOOP',
      date: '2026-07-27',
      judgeModel: 'claude-opus-4',
      verdicts: [sampleMetVerdict],
    },
    git: {
      landedAt: '2026-07-27T12:00:00.000Z',
      escapeScan: 'complete',
      escapeFixes: [{ sha: 'abc123d', subject: 'fix(roadmap): gate R1', files: 2 }],
    },
  })
  assertEq(t.phases[0].executionResult?.driver?.lane, 'session', 'driver lane carried through the trace')
  assertEq(t.phases[0].executionResult?.compromises, [], 'the composed shape keeps its own defaults')
  assertEq(t.phases[0].metrics?.haltCount, 2, 'the metrics time axis carried through')
  assertEq(t.sweep?.overall, 'green', 'the sweep report composes verbatim')
  assertEq(t.verdicts?.verdicts[0].status, 'met', 'the verdicts file composes verbatim')
  assertEq(t.phases[0].gateRuns[0].rounds[0].round, 1, 'gate round recorded')
})

check('ArcTrace: a 6-char escape-fix sha REJECTS (min(7) matches the checkpoint sha bar)', () => {
  requireShape(ArcTraceShape, 'ArcTraceShape')
  assertThrows(
    () =>
      ArcTraceShape.parse({
        arcId: 1996,
        collectedAt: '2026-07-27T09:15:00.000Z',
        phases: [{ phase: 1996, taskCount: 1 }],
        git: { escapeScan: 'complete', escapeFixes: [{ sha: 'abc123', subject: 'fix: x', files: 1 }] },
      }),
    'short escape-fix sha',
  )
})

check('ArcTrace: a git block with NO escapeScan REJECTS (an empty escape list needs its provenance)', () => {
  requireShape(ArcTraceShape, 'ArcTraceShape')
  assertThrows(
    () =>
      ArcTraceShape.parse({
        arcId: 1996,
        collectedAt: '2026-07-27T09:15:00.000Z',
        phases: [{ phase: 1996, taskCount: 1 }],
        git: { escapeFixes: [] },
      }),
    'git block without escapeScan',
  )
  const unavailable = ArcTraceShape.parse({
    arcId: 1996,
    collectedAt: '2026-07-27T09:15:00.000Z',
    phases: [{ phase: 1996, taskCount: 1 }],
    git: { escapeScan: 'unavailable', escapeFixes: [] },
  })
  assertEq(unavailable.git.escapeScan, 'unavailable', 'a failed scan is expressible, and is NOT zero escapes')
})

check('ArcTrace: a parseError on a phase parses (an unreadable phase is SEEN, never dropped)', () => {
  const t = ArcTraceShape.parse({
    arcId: 1996,
    collectedAt: '2026-07-27T09:15:00.000Z',
    phases: [{ phase: 1996, taskCount: 0, parseError: 'phase file failed to import' }],
    git: { escapeScan: 'complete', escapeFixes: [] },
  })
  assertEq(t.phases[0].parseError, 'phase file failed to import', 'parseError preserved')
  assertThrows(
    () =>
      ArcTraceShape.parse({
        arcId: 1996,
        collectedAt: '2026-07-27T09:15:00.000Z',
        phases: [{ phase: 1996, taskCount: 0, parseError: '' }],
        git: { escapeScan: 'complete', escapeFixes: [] },
      }),
    'blank parseError',
  )
})

check('ArcEvalReport: an UNSTAMPED committed-report fixture still parses (the stamps are additive)', () => {
  const r = ArcEvalReportShape.parse(makeEvalReport())
  assertEq(r.profile, undefined, 'absent profile stays absent, never defaulted')
  assertEq(r.workflow, undefined, 'absent workflow block stays absent — a named gap, not a fabrication')
  assertEq(r.fingerprint, undefined, 'absent fingerprint stays absent')
})

check('ArcEvalReport: a fully stamped report parses and round-trips all three stamps', () => {
  const r = ArcEvalReportShape.parse({
    ...makeEvalReport(),
    profile: 'prod-grade',
    workflow: {
      pluginVersion: '1.4.0',
      pluginSha: 'abc1234def56',
      protocolLoadTokens: 18422,
      profile: 'prod-grade',
    },
    fingerprint: { repo: 'azure_private_agent', language: 'typescript', corpusSize: 1904 },
  })
  assertEq(r.workflow?.pluginSha, 'abc1234def56', 'pluginSha preserved')
  assertEq(r.workflow?.protocolLoadTokens, 18422, 'protocolLoadTokens preserved')
  assertEq(r.fingerprint?.corpusSize, 1904, 'corpusSize preserved')
  assertEq(r.profile, 'prod-grade', 'profile preserved')
})

check('ArcEvalReport: a workflow block MISSING pluginSha rejects (a partial stamp is a fabricated one)', () => {
  requireShape(ArcEvalReportShape, 'ArcEvalReportShape')
  assertThrows(
    () =>
      ArcEvalReportShape.parse({
        ...makeEvalReport(),
        profile: 'prod-grade',
        workflow: { pluginVersion: '1.4.0', protocolLoadTokens: 18422, profile: 'prod-grade' },
      }),
    'workflow without pluginSha',
  )
  assertThrows(
    () =>
      ArcEvalReportShape.parse({
        ...makeEvalReport(),
        profile: 'prod-grade',
        workflow: {
          pluginVersion: '1.4.0',
          pluginSha: 'abc123',
          protocolLoadTokens: 18422,
          profile: 'prod-grade',
        },
      }),
    'a pluginSha shorter than 7 chars',
  )
})

check('ArcEvalReport: profile disagreeing with workflow.profile REJECTS (two claims about one fact)', () => {
  requireShape(ArcEvalReportShape, 'ArcEvalReportShape')
  assertThrows(
    () =>
      ArcEvalReportShape.parse({
        ...makeEvalReport(),
        profile: 'prod-grade',
        workflow: {
          pluginVersion: '1.4.0',
          pluginSha: 'abc1234def56',
          protocolLoadTokens: 18422,
          profile: 'ux-iteration',
        },
      }),
    'profile disagreeing with workflow.profile',
  )
  // Only the BOTH-present case is constrained: a workflow block on a report carrying no
  // top-level profile makes one claim, not two.
  const oneSided = ArcEvalReportShape.parse({
    ...makeEvalReport(),
    workflow: {
      pluginVersion: '1.4.0',
      pluginSha: 'abc1234def56',
      protocolLoadTokens: 18422,
      profile: 'ux-iteration',
    },
  })
  assertEq(oneSided.workflow?.profile, 'ux-iteration', 'an unpaired workflow.profile parses')
})

check("ArcTrace: escapeWindow 'land-record-anchored' parses; an unknown window token rejects", () => {
  const t = ArcTraceShape.parse({
    arcId: 'EVALLOOP',
    collectedAt: '2026-07-27T09:15:00.000Z',
    phases: [{ phase: 2014, taskCount: 6 }],
    git: {
      escapeScan: 'complete',
      escapeFixes: [],
      escapeWindow: 'land-record-anchored',
      landedAt: '2026-07-19T23:59:59.999Z',
    },
  })
  assertEq(t.git.escapeWindow, 'land-record-anchored', 'the land-record window token parses')
  for (const known of ['merge-anchored', 'tip-anchored'] as const) {
    assertEq(
      ArcTraceShape.parse({
        arcId: 'EVALLOOP',
        collectedAt: '2026-07-27T09:15:00.000Z',
        phases: [{ phase: 2014, taskCount: 6 }],
        git: { escapeScan: 'complete', escapeFixes: [], escapeWindow: known },
      }).git.escapeWindow,
      known,
      `the pre-existing ${known} token still parses`,
    )
  }
  assertThrows(
    () =>
      ArcTraceShape.parse({
        arcId: 'EVALLOOP',
        collectedAt: '2026-07-27T09:15:00.000Z',
        phases: [{ phase: 2014, taskCount: 6 }],
        git: { escapeScan: 'complete', escapeFixes: [], escapeWindow: 'land-anchored' },
      }),
    'an unknown escapeWindow token',
  )
})

check('TimingStats: a cohort with interruptedExcluded 1 parses; notes defaults to []', () => {
  const s = TimingStatsShape.parse({
    generatedAt: '2026-07-27T09:15:00.000Z',
    cohorts: [
      {
        taskCountBand: '3-5',
        surface: true,
        samples: 9,
        medianMinutes: 41,
        p80Minutes: 78.5,
        interruptedExcluded: 1,
      },
    ],
  })
  assertEq(s.notes, [], 'notes defaults to []')
  assertEq(s.cohorts[0].interruptedExcluded, 1, 'excluded count preserved, never folded into samples')
  assertEq(s.cohorts[0].surface, true, 'the surface axis is a boolean, not a label')
})

check('TimingStats: negative samples REJECTS; a zero-sample cohort parses (honest empty band)', () => {
  requireShape(TimingStatsShape, 'TimingStatsShape')
  const cohort = {
    taskCountBand: '3-5',
    surface: false,
    samples: 0,
    medianMinutes: 0,
    p80Minutes: 0,
    interruptedExcluded: 0,
  }
  const s = TimingStatsShape.parse({ generatedAt: '2026-07-27T09:15:00.000Z', cohorts: [cohort], notes: [] })
  assertEq(s.cohorts[0].samples, 0, 'a zero-sample cohort is expressible')
  assertThrows(
    () =>
      TimingStatsShape.parse({
        generatedAt: '2026-07-27T09:15:00.000Z',
        cohorts: [{ ...cohort, samples: -1 }],
      }),
    'negative samples',
  )
  assertThrows(
    () =>
      TimingStatsShape.parse({
        generatedAt: '2026-07-27T09:15:00.000Z',
        cohorts: [{ ...cohort, medianMinutes: -1 }],
      }),
    'negative medianMinutes',
  )
})

console.log('\nLesson / Scorecard — the learning record and the n-floor rails')

// ONE fixture per shape, mutated by copy in every negative: the rails here are
// RELATIONSHIPS (origin against its writer, samples against nFloor, metrics
// against abstained), so a case that retypes the whole literal could drift a
// field the rule doesn't concern and still reject for the wrong reason. Every
// negative below starts from a value that is already legal and breaks exactly
// one thing.
function makeLesson(): Record<string, unknown> {
  return {
    ts: '2026-07-27T09:15:00.000Z',
    phase: 1996,
    text: 'A reject-only case passes vacuously when the shape is missing.',
    origin: { writer: 'session:seat-a', kind: 'session' },
  }
}

check('Lesson: a lesson parses with and without the optional phase; the origin round-trips', () => {
  requireShape(LessonShape, 'LessonShape')
  const withPhase = LessonShape.parse(makeLesson())
  assertEq(withPhase.phase, 1996, 'phase preserved')
  assertEq(withPhase.origin.kind, 'session', 'origin.kind preserved')
  assertEq(withPhase.origin.writer, 'session:seat-a', 'origin.writer preserved')
  const { phase: _dropped, ...noPhase } = makeLesson()
  const without = LessonShape.parse(noPhase)
  assertEq(without.phase, undefined, 'phase is genuinely optional, not defaulted')
  assertEq(without.text, makeLesson().text, 'text preserved')
})

check('Lesson: an UNATTRIBUTED lesson REJECTS — every lesson names who wrote it', () => {
  requireShape(LessonShape, 'LessonShape')
  const { origin: _dropped, ...orphan } = makeLesson()
  assertIssuePath(LessonShape, orphan, ['origin'], 'a lesson with no origin')
  assertIssuePath(
    LessonShape,
    { ...makeLesson(), origin: { writer: '', kind: 'session' } },
    ['origin', 'writer'],
    'an empty origin.writer',
  )
})

check('Lesson: origin.kind is CLOSED to session | eval-loop — an unknown lane REJECTS', () => {
  requireShape(LessonShape, 'LessonShape')
  assertEq(LessonShape.parse({ ...makeLesson(), origin: { writer: 'eval', kind: 'eval-loop' } }).origin.kind, 'eval-loop', 'eval-loop is a legal lane')
  assertIssuePath(
    LessonShape,
    { ...makeLesson(), origin: { writer: 'grok', kind: 'grok' } },
    ['origin', 'kind'],
    'an unknown origin.kind',
  )
})

check('Lesson: ts is a DATETIME — a bare date REJECTS, and empty text REJECTS', () => {
  requireShape(LessonShape, 'LessonShape')
  assertIssuePath(LessonShape, { ...makeLesson(), ts: '2026-07-28' }, ['ts'], 'a bare date as ts')
  assertIssuePath(LessonShape, { ...makeLesson(), text: '' }, ['text'], 'empty lesson text')
  assertIssuePath(LessonShape, { ...makeLesson(), phase: 0 }, ['phase'], 'phase 0')
})

// nFloor 5 throughout: the cells below sit AT the floor (5), one under it (2)
// and above it (9), so every boundary case is exact rather than comfortably
// clear of the line.
function makeDriverCell(): Record<string, unknown> {
  return {
    model: 'claude-opus-5',
    lane: 'session',
    taskCountBand: '3-5',
    surface: true,
    samples: 9,
    abstained: false,
    metrics: { medianMinutes: 41, gateRounds: 2, verdict: 'PASS' },
  }
}

function makeReviewerCell(): Record<string, unknown> {
  return {
    agent: 'code-reviewer',
    taskCountBand: '3-5',
    surface: false,
    samples: 9,
    abstained: false,
    metrics: { rounds: 2, verdict: 'PASS' },
  }
}

function makeScorecard(): Record<string, unknown> {
  return {
    generatedAt: '2026-07-27T09:15:00.000Z',
    nFloor: 5,
    drivers: [makeDriverCell()],
    reviewers: [makeReviewerCell()],
  }
}

check('Scorecard: a fully-sampled card parses, notes defaults to [], and a cell at or above the floor keeps its metrics', () => {
  requireShape(ScorecardShape, 'ScorecardShape')
  const s = ScorecardShape.parse(makeScorecard())
  assertEq(s.notes, [], 'notes defaults to []')
  assertEq(s.nFloor, 5, 'nFloor preserved')
  assertEq(s.drivers[0].metrics?.medianMinutes, 41, 'driver metrics preserved')
  assertEq(s.reviewers[0].metrics?.rounds, 2, 'reviewer metrics preserved')
  const atFloor = ScorecardShape.parse({
    ...makeScorecard(),
    drivers: [{ ...makeDriverCell(), samples: 5 }],
    reviewers: [{ ...makeReviewerCell(), samples: 5 }],
  })
  assertEq(atFloor.drivers[0].abstained, false, 'samples EXACTLY at nFloor does not abstain')
  assertEq(atFloor.reviewers[0].abstained, false, 'the floor is >=, not >, on the reviewer axis too')
})

check('Scorecard: generatedAt is a DATETIME and nFloor is a POSITIVE int — a bare date and nFloor 0 REJECT', () => {
  requireShape(ScorecardShape, 'ScorecardShape')
  assertIssuePath(ScorecardShape, { ...makeScorecard(), generatedAt: '2026-07-28' }, ['generatedAt'], 'a bare date as generatedAt')
  assertIssuePath(ScorecardShape, { ...makeScorecard(), nFloor: 0 }, ['nFloor'], 'nFloor 0')
  assertIssuePath(
    ScorecardShape,
    { ...makeScorecard(), drivers: [{ ...makeDriverCell(), samples: -1, abstained: true }] },
    ['drivers', 0, 'samples'],
    'negative samples',
  )
})

check('Scorecard: THE RANKED ANECDOTE — a driver cell of 2 samples under an nFloor of 5 that does NOT abstain REJECTS', () => {
  requireShape(ScorecardShape, 'ScorecardShape')
  const { metrics: _dropped, ...thin } = makeDriverCell()
  assertThrows(
    () =>
      ScorecardShape.parse({
        ...makeScorecard(),
        drivers: [{ ...thin, samples: 2, abstained: false }],
      }),
    'a sub-floor driver cell that reports instead of abstaining',
  )
  assertThrows(
    () =>
      ScorecardShape.parse({
        ...makeScorecard(),
        drivers: [{ ...makeDriverCell(), samples: 4, abstained: false }],
      }),
    'a driver cell ONE sample under the floor that reports',
  )
})

check('Scorecard: abstention is an EQUIVALENCE — a cell at or above the floor claiming abstained REJECTS', () => {
  requireShape(ScorecardShape, 'ScorecardShape')
  const { metrics: _driverMetrics, ...thinDriver } = makeDriverCell()
  const { metrics: _reviewerMetrics, ...thinReviewer } = makeReviewerCell()
  assertThrows(
    () =>
      ScorecardShape.parse({
        ...makeScorecard(),
        drivers: [{ ...thinDriver, samples: 9, abstained: true }],
      }),
    'a well-sampled driver cell that abstains anyway',
  )
  assertThrows(
    () =>
      ScorecardShape.parse({
        ...makeScorecard(),
        drivers: [{ ...thinDriver, samples: 5, abstained: true }],
      }),
    'a driver cell EXACTLY at the floor that abstains',
  )
  assertThrows(
    () =>
      ScorecardShape.parse({
        ...makeScorecard(),
        reviewers: [{ ...thinReviewer, samples: 9, abstained: true }],
      }),
    'a well-sampled reviewer cell that abstains anyway',
  )
})

check('Scorecard: an abstained cell carries NO metrics — a sub-floor cell smuggling numbers REJECTS on BOTH axes', () => {
  requireShape(ScorecardShape, 'ScorecardShape')
  assertThrows(
    () =>
      ScorecardShape.parse({
        ...makeScorecard(),
        drivers: [{ ...makeDriverCell(), samples: 2, abstained: true }],
      }),
    'an abstained driver cell carrying metrics',
  )
  assertThrows(
    () =>
      ScorecardShape.parse({
        ...makeScorecard(),
        reviewers: [{ ...makeReviewerCell(), samples: 2, abstained: true }],
      }),
    'an abstained reviewer cell carrying metrics',
  )
  assertThrows(
    () =>
      ScorecardShape.parse({
        ...makeScorecard(),
        drivers: [{ ...makeDriverCell(), samples: 2, abstained: true, metrics: {} }],
      }),
    'an abstained driver cell carrying an EMPTY metrics object — the key itself is the claim',
  )
})

check('Scorecard: a sub-floor cell that abstains and reports nothing PARSES — on the driver AND the reviewer axis', () => {
  requireShape(ScorecardShape, 'ScorecardShape')
  const { metrics: _driverMetrics, ...thinDriver } = makeDriverCell()
  const { metrics: _reviewerMetrics, ...thinReviewer } = makeReviewerCell()
  const s = ScorecardShape.parse({
    ...makeScorecard(),
    drivers: [{ ...thinDriver, samples: 2, abstained: true }],
    reviewers: [{ ...thinReviewer, samples: 2, abstained: true }],
    notes: ['nFloor 5; two cohorts abstained'],
  })
  assertEq(s.drivers[0].abstained, true, 'the driver cell abstains')
  assertEq(s.drivers[0].metrics, undefined, 'an abstained driver cell carries no metrics')
  assertEq(s.drivers[0].samples, 2, 'the sample count is still published — abstention is visible, not hidden')
  assertEq(s.reviewers[0].abstained, true, 'the reviewer cell abstains')
  assertEq(s.reviewers[0].metrics, undefined, 'an abstained reviewer cell carries no metrics')
  assertEq(s.notes, ['nFloor 5; two cohorts abstained'], 'explicit notes are kept verbatim')
})

check('Scorecard: the reviewer axis is a DISTINCT cell — it is keyed by agent and rejects a driver cell in its place', () => {
  requireShape(ScorecardShape, 'ScorecardShape')
  assertIssuePath(
    ScorecardShape,
    { ...makeScorecard(), reviewers: [makeDriverCell()] },
    ['reviewers', 0, 'agent'],
    'a driver cell filed under reviewers',
  )
  assertIssuePath(
    ScorecardShape,
    { ...makeScorecard(), drivers: [{ ...makeDriverCell(), lane: '' }] },
    ['drivers', 0, 'lane'],
    'an empty driver lane',
  )
  assertIssuePath(
    ScorecardShape,
    { ...makeScorecard(), reviewers: [{ ...makeReviewerCell(), agent: '' }] },
    ['reviewers', 0, 'agent'],
    'an empty reviewer agent',
  )
  const s = ScorecardShape.parse({
    ...makeScorecard(),
    drivers: [{ ...makeDriverCell(), metrics: { medianMinutes: 41, verdict: 'PASS' } }],
  })
  assertEq(s.drivers[0].metrics?.verdict, 'PASS', 'metrics values may be a number OR a string')
})

console.log('\nArcEvalJudgeVerdict — the judge returns a TYPED verdict, never prose')

// Path-asserting reject helper. assertThrows only proves "something threw" —
// for the coverage rule that is not enough, because the whole point is WHICH
// dimension was left uncovered. Every coverage case that names a key asserts
// the issue PATH so a blanket top-level refine can't pass this file.
function assertIssuePath(
  shape: unknown,
  input: unknown,
  expected: (string | number)[],
  where: string,
): void {
  const s = shape as {
    safeParse: (v: unknown) => {
      success: boolean
      error?: { issues: Array<{ path: PropertyKey[] }> }
    }
  }
  const r = s.safeParse(input)
  if (r.success) throw new Error(`${where}: expected to reject, parsed clean`)
  const seen = (r.error?.issues ?? []).map((i) => i.path.map(String).join('.'))
  const want = expected.map(String).join('.')
  if (!seen.includes(want)) {
    throw new Error(`${where}: expected an issue at path [${want}], got [${seen.join(' | ')}]`)
  }
}

// Evidence is min(30) — quotable, not a verdict-shaped grunt. Generate it from
// the dimension name so every fixture line is distinguishable in a failure.
function judgeEvidence(dimension: string): string {
  return `quoted from the diff for ${dimension}: the reviewer left the seam injected`
}

function judgeDim(
  score: number,
  dimension: string,
  confidence: 'high' | 'medium' | 'low' = 'high',
): Record<string, unknown> {
  return { score, evidence: judgeEvidence(dimension), confidence }
}

// ONE fixture, mutated by copy: the coverage rule is about the RELATIONSHIP
// between `dimensions` and `skipped`, so every negative below starts from a
// verdict that is already legal and breaks exactly one thing.
function makeJudgeVerdict(): Record<string, unknown> {
  return {
    arcId: 'EVALLOOP',
    judgeModel: 'claude-opus-4',
    dimensions: {
      'standards-adherence': judgeDim(78, 'standards-adherence'),
      'doc-brevity': judgeDim(91, 'doc-brevity', 'medium'),
      'composability-testability': judgeDim(64, 'composability-testability', 'low'),
      'plan-quality': judgeDim(0, 'plan-quality'),
    },
  }
}

check('JudgeVerdict: JUDGE_OWNED_DIMENSION_KEYS is exactly the four judge keys, and each is a REAL dimension key', () => {
  requireShape(EvalDimensionKeyShape, 'EvalDimensionKeyShape')
  assertEq([...JUDGE_OWNED_DIMENSION_KEYS].sort(), [
    'composability-testability',
    'doc-brevity',
    'plan-quality',
    'standards-adherence',
  ], 'the judge owns four of the seven dimensions')
  for (const key of JUDGE_OWNED_DIMENSION_KEYS) {
    EvalDimensionKeyShape.parse(key)
  }
})

check('JudgeVerdict: all four judge dimensions scored, nothing skipped — parses and round-trips score/evidence/confidence', () => {
  const v = ArcEvalJudgeVerdictShape.parse(makeJudgeVerdict())
  assertEq(v.arcId, 'EVALLOOP', 'arcId carried')
  assertEq(v.judgeModel, 'claude-opus-4', 'the judge self-report is the model pin')
  assertEq(v.dimensions['standards-adherence']?.score, 78, 'score round-trips')
  assertEq(
    v.dimensions['doc-brevity']?.evidence,
    judgeEvidence('doc-brevity'),
    'evidence round-trips verbatim — the quote IS the artifact',
  )
  assertEq(v.dimensions['composability-testability']?.confidence, 'low', 'confidence round-trips')
  assertEq(v.dimensions['plan-quality']?.score, 0, 'a zero score is a score, not an absence')
  assertEq(v.skipped, undefined, 'an absent skip list stays absent, never invented as []')
  // a deterministic key the judge did not touch carries NO value
  assertEq(v.dimensions['speed'], undefined, 'an untouched deterministic key has no value')
})

check('JudgeVerdict: two scored + two skipped parses — the honest downgrade path is REACHABLE, not a silent omission', () => {
  const input = makeJudgeVerdict()
  const dims = input.dimensions as Record<string, unknown>
  delete dims['composability-testability']
  delete dims['plan-quality']
  input.skipped = [
    { dimension: 'composability-testability', why: 'no test diff in this arc to read' },
    { dimension: 'plan-quality', why: 'the phase file was authored before the plan template' },
  ]
  const v = ArcEvalJudgeVerdictShape.parse(input)
  assertEq(v.dimensions['standards-adherence']?.score, 78, 'the scored half survives')
  assertEq(v.dimensions['plan-quality'], undefined, 'the skipped half carries no score')
  assertEq(v.skipped?.length, 2, 'both skips recorded')
  assertEq(v.skipped?.[0].dimension, 'composability-testability', 'the skip names its dimension')
  assertEq(
    v.skipped?.[1].why,
    'the phase file was authored before the plan template',
    'the reason survives — a skip without a reason is not a skip',
  )
})

check('JudgeVerdict: ALL FOUR skipped parses — a wholly honest non-judgement is legal, an empty dimensions map included', () => {
  const v = ArcEvalJudgeVerdictShape.parse({
    arcId: 1996,
    judgeModel: 'claude-opus-4',
    dimensions: {},
    skipped: JUDGE_OWNED_DIMENSION_KEYS.map((dimension) => ({
      dimension,
      why: `the judge could not read enough of the arc to score ${dimension}`,
    })),
  })
  assertEq(v.arcId, 1996, 'the numeric arcId arm of the union parses')
  assertEq(v.skipped?.length, 4, 'four skips')
  for (const key of JUDGE_OWNED_DIMENSION_KEYS) {
    assertEq(v.dimensions[key], undefined, `${key} carries no score`)
  }
})

check('JudgeVerdict: a judge key NEITHER scored NOR skipped REJECTS at path dimensions.plan-quality (anti-vacuous — an `in`/Object.keys coverage check passes this input, since z.record over an enum materializes EVERY key as undefined)', () => {
  requireShape(ArcEvalJudgeVerdictShape, 'ArcEvalJudgeVerdictShape')
  const input = makeJudgeVerdict()
  delete (input.dimensions as Record<string, unknown>)['plan-quality']
  assertIssuePath(
    ArcEvalJudgeVerdictShape,
    input,
    ['dimensions', 'plan-quality'],
    'uncovered judge dimension',
  )
})

check('JudgeVerdict: an EXPLICITLY undefined dimension value REJECTS — "absent" has exactly ONE wire representation (omission)', () => {
  requireShape(ArcEvalJudgeVerdictShape, 'ArcEvalJudgeVerdictShape')
  const input = makeJudgeVerdict()
  ;(input.dimensions as Record<string, unknown>)['plan-quality'] = undefined
  assertThrows(() => ArcEvalJudgeVerdictShape.parse(input), 'explicit undefined dimension value')
})

check('JudgeVerdict: a key BOTH scored and skipped REJECTS (covered EXACTLY once — a score is not also an abstention)', () => {
  requireShape(ArcEvalJudgeVerdictShape, 'ArcEvalJudgeVerdictShape')
  const input = makeJudgeVerdict()
  input.skipped = [{ dimension: 'doc-brevity', why: 'ran out of budget reading the docs' }]
  assertThrows(() => ArcEvalJudgeVerdictShape.parse(input), 'scored and skipped at once')
})

check('JudgeVerdict: a DUPLICATE dimension in skipped REJECTS (two reasons for one abstention is an unresolvable record)', () => {
  requireShape(ArcEvalJudgeVerdictShape, 'ArcEvalJudgeVerdictShape')
  const input = makeJudgeVerdict()
  const dims = input.dimensions as Record<string, unknown>
  delete dims['plan-quality']
  input.skipped = [
    { dimension: 'plan-quality', why: 'the phase file would not import cleanly' },
    { dimension: 'plan-quality', why: 'and the plan section was missing entirely' },
  ]
  assertThrows(() => ArcEvalJudgeVerdictShape.parse(input), 'duplicate skipped dimension')
})

check('JudgeVerdict: a DETERMINISTIC key alongside the four judge keys PARSES — ownership is per-report, refused by `eval merge-judge` (exit 2), NOT by this shape', () => {
  const input = makeJudgeVerdict()
  ;(input.dimensions as Record<string, unknown>)['code-confidence'] = judgeDim(55, 'code-confidence')
  const v = ArcEvalJudgeVerdictShape.parse(input)
  assertEq(v.dimensions['code-confidence']?.score, 55, 'the overreaching score is carried, not silently dropped')
  assertEq(v.dimensions['plan-quality']?.score, 0, 'the judge-owned keys are untouched by the extra')
})

check('JudgeVerdict: an INVENTED eighth dimension key REJECTS (the enum record is closed, same bar as ArcEvalReport)', () => {
  requireShape(ArcEvalJudgeVerdictShape, 'ArcEvalJudgeVerdictShape')
  const input = makeJudgeVerdict()
  ;(input.dimensions as Record<string, unknown>)['vibes'] = judgeDim(99, 'vibes')
  assertThrows(() => ArcEvalJudgeVerdictShape.parse(input), 'eighth dimension key in a verdict')

  const skippedInvented = makeJudgeVerdict()
  ;(skippedInvented.skipped as unknown) = [
    { dimension: 'vibes', why: 'could not read the vibes of this arc' },
  ]
  assertThrows(() => ArcEvalJudgeVerdictShape.parse(skippedInvented), 'eighth dimension key in skipped')
})

check('JudgeVerdict: evidence at 29 chars REJECTS and at 30 parses — a score without quotable evidence is invalid BY CONSTRUCTION', () => {
  requireShape(ArcEvalJudgeVerdictShape, 'ArcEvalJudgeVerdictShape')
  const short = makeJudgeVerdict()
  ;(short.dimensions as Record<string, { evidence: string }>)['doc-brevity'].evidence = 'x'.repeat(29)
  assertIssuePath(
    ArcEvalJudgeVerdictShape,
    short,
    ['dimensions', 'doc-brevity', 'evidence'],
    'evidence at 29 chars',
  )
  const atBound = makeJudgeVerdict()
  ;(atBound.dimensions as Record<string, { evidence: string }>)['doc-brevity'].evidence = 'x'.repeat(30)
  assertEq(
    ArcEvalJudgeVerdictShape.parse(atBound).dimensions['doc-brevity']?.evidence.length,
    30,
    'exactly 30 chars is the floor, not one past it',
  )
})

check('JudgeVerdict: a skip `why` at 9 chars REJECTS and at 10 parses ("no time" is not a reason)', () => {
  requireShape(ArcEvalJudgeVerdictShape, 'ArcEvalJudgeVerdictShape')
  const base = makeJudgeVerdict()
  delete (base.dimensions as Record<string, unknown>)['plan-quality']

  const short = JSON.parse(JSON.stringify(base)) as Record<string, unknown>
  short.skipped = [{ dimension: 'plan-quality', why: 'x'.repeat(9) }]
  assertIssuePath(ArcEvalJudgeVerdictShape, short, ['skipped', 0, 'why'], 'why at 9 chars')

  const atBound = JSON.parse(JSON.stringify(base)) as Record<string, unknown>
  atBound.skipped = [{ dimension: 'plan-quality', why: 'x'.repeat(10) }]
  assertEq(
    ArcEvalJudgeVerdictShape.parse(atBound).skipped?.[0].why.length,
    10,
    'exactly 10 chars is the floor',
  )
})

check('JudgeVerdict: score 101 and -1 REJECT; 0 and 100 parse (0..100 is the closed range, same as ArcEvalReport)', () => {
  requireShape(ArcEvalJudgeVerdictShape, 'ArcEvalJudgeVerdictShape')
  const over = makeJudgeVerdict()
  ;(over.dimensions as Record<string, { score: number }>)['doc-brevity'].score = 101
  assertIssuePath(ArcEvalJudgeVerdictShape, over, ['dimensions', 'doc-brevity', 'score'], 'score 101')

  const under = makeJudgeVerdict()
  ;(under.dimensions as Record<string, { score: number }>)['doc-brevity'].score = -1
  assertIssuePath(ArcEvalJudgeVerdictShape, under, ['dimensions', 'doc-brevity', 'score'], 'score -1')

  const atTop = makeJudgeVerdict()
  ;(atTop.dimensions as Record<string, { score: number }>)['doc-brevity'].score = 100
  assertEq(
    ArcEvalJudgeVerdictShape.parse(atTop).dimensions['doc-brevity']?.score,
    100,
    'score 100 is in range',
  )
  const atZero = makeJudgeVerdict()
  ;(atZero.dimensions as Record<string, { score: number }>)['doc-brevity'].score = 0
  assertEq(
    ArcEvalJudgeVerdictShape.parse(atZero).dimensions['doc-brevity']?.score,
    0,
    'score 0 is in range',
  )
})

check('JudgeVerdict: an empty judgeModel REJECTS (a verdict that will not say what ran it cannot pin a model)', () => {
  requireShape(ArcEvalJudgeVerdictShape, 'ArcEvalJudgeVerdictShape')
  const input = makeJudgeVerdict()
  input.judgeModel = ''
  assertIssuePath(ArcEvalJudgeVerdictShape, input, ['judgeModel'], 'empty judgeModel')
})

console.log('\nProposal contract — the ONE shape crossing the plugin/consumer boundary')

// Proposals are written by the plugin CLI and committed + read in the consumer
// repo, so the shape IS the contract: a closed finding-class vocabulary (an open
// string would let the clustering pass invent classes), lane + kind as closed
// enums, and evidence enforced STRUCTURALLY at min(2) so no speculative
// single-source proposal can be written at all.

// ONE known-good base per shape, mutated by copy in every negative case: a
// negative fixture that was never valid to begin with proves nothing.
function makeEvidence(n: number): Record<string, unknown> {
  return {
    file: `roadmap/arcs/EVALLOOP-eval-${n}.json`,
    jsonPath: `$.dimensions['code-confidence'].signals.gateRounds`,
    excerpt: `gate R${n} reopened on the same masking seam`,
  }
}

function makeOpportunity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    importance: 8,
    satisfaction: 3,
    score: 13,
    rulingId: 'ruling-recurring-regression',
    rulingsVersion: 1,
    satisfactionSource: 'roadmap/arcs/EVALLOOP-eval.json#dimensions.code-confidence',
    ...overrides,
  }
}

function makeCandidateReviewFocus(): Record<string, unknown> {
  return {
    id: 'masking-seam-regression',
    signature: 'maskPrompt(.*)\\s*//\\s*TODO',
    guidance: 'every masking seam change ships a wired-turn itest',
  }
}

function makeReductionTarget(): Record<string, unknown> {
  return {
    flow: 'do-phase protocol load',
    measuredTokens: 41000,
    budgetTokens: 30000,
    ledger: 'roadmap/eval/reduction-ledger.json',
  }
}

function makeProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'recurring-regression-masking-seam',
    findingClass: 'recurring-regression',
    lane: 'consumer-specific',
    kind: 'review-focus-candidate',
    title: 'Masking seam regressions keep reopening the same gate',
    rationale: 'Three arcs in a row reopened gate R1 on the same masking seam.',
    evidence: [makeEvidence(1), makeEvidence(2)],
    opportunity: makeOpportunity(),
    candidateReviewFocus: makeCandidateReviewFocus(),
    writeOrigin: 'roadmap-eval-loop',
    status: 'surfaced',
    createdAt: '2026-07-28',
    updatedAt: '2026-07-28',
    ...overrides,
  }
}

function makeRulingsTable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const classes = [
    'recurring-regression',
    'recurring-sentinel',
    'recurring-low-score',
    'recurring-lesson-key',
    'protocol-load-over-budget',
  ]
  return {
    version: 1,
    ratified: '2026-07-28',
    rulings: classes.map((findingClass, i) => ({
      id: `ruling-${findingClass}`,
      findingClass,
      importance: 5 + i * 0.5,
      rationale: `ratified importance for ${findingClass} findings across the fleet`,
    })),
    ...overrides,
  }
}

check('Proposal: a full review-focus-candidate with TWO evidence entries parses and round-trips lane/kind/evidence', () => {
  requireShape(ProposalShape, 'ProposalShape')
  const p = ProposalShape.parse(makeProposal())
  assertEq(p.id, 'recurring-regression-masking-seam', 'id round-trips')
  assertEq(p.lane, 'consumer-specific', 'lane round-trips — a lane-less proposal is not ready')
  assertEq(p.kind, 'review-focus-candidate', 'kind round-trips')
  assertEq(p.findingClass, 'recurring-regression', 'findingClass round-trips')
  assertEq(p.evidence.length, 2, 'both evidence entries survive')
  assertEq(p.evidence[1].file, 'roadmap/arcs/EVALLOOP-eval-2.json', 'the SECOND source is carried, not collapsed')
  assertEq(p.candidateReviewFocus?.id, 'masking-seam-regression', 'the kind payload round-trips')
  assertEq(p.writeOrigin, 'roadmap-eval-loop', 'the write origin is the provenance stamp')
  assertEq(p.status, 'surfaced', 'status round-trips')
  assertEq(p.reductionTarget, undefined, 'no reduction payload on a review-focus proposal')
})

check('Proposal: exactly ONE evidence entry REJECTS at [evidence] — the rule-of-three floor is STRUCTURAL, not advisory', () => {
  requireShape(ProposalShape, 'ProposalShape')
  assertIssuePath(
    ProposalShape,
    makeProposal({ evidence: [makeEvidence(1)] }),
    ['evidence'],
    'a single-source proposal',
  )
  assertIssuePath(ProposalShape, makeProposal({ evidence: [] }), ['evidence'], 'a zero-evidence proposal')
  const atFloor = ProposalShape.parse(makeProposal({ evidence: [makeEvidence(1), makeEvidence(2)] }))
  assertEq(atFloor.evidence.length, 2, 'EXACTLY two is the floor, not one past it')
  assertIssuePath(
    ProposalShape,
    makeProposal({ evidence: [makeEvidence(1), { ...makeEvidence(2), excerpt: '' }] }),
    ['evidence', 1, 'excerpt'],
    'an empty excerpt smuggled in as the second source',
  )
})

check('FindingClass: the vocabulary is CLOSED — a sixth class rejects, in the enum AND inside a proposal', () => {
  requireShape(FindingClassShape, 'FindingClassShape')
  requireShape(ProposalShape, 'ProposalShape')
  for (const known of [
    'recurring-regression',
    'recurring-sentinel',
    'recurring-low-score',
    'recurring-lesson-key',
    'protocol-load-over-budget',
  ]) {
    FindingClassShape.parse(known)
  }
  assertThrows(() => FindingClassShape.parse('recurring-vibes'), 'an invented sixth finding class')
  assertIssuePath(
    ProposalShape,
    makeProposal({ findingClass: 'recurring-vibes' }),
    ['findingClass'],
    'an invented finding class on a proposal',
  )
})

check('Proposal: kind review-focus-candidate WITHOUT candidateReviewFocus REJECTS (the kind IS the promise of a payload)', () => {
  requireShape(ProposalShape, 'ProposalShape')
  const { candidateReviewFocus: _dropped, ...noPayload } = makeProposal()
  assertThrows(() => ProposalShape.parse(noPayload), 'a review-focus-candidate with no candidate')
})

check('Proposal: kind reduction REQUIRES reductionTarget — missing REJECTS, present parses and round-trips the ledger', () => {
  requireShape(ProposalShape, 'ProposalShape')
  const { candidateReviewFocus: _dropped, ...base } = makeProposal({ kind: 'reduction' })
  assertThrows(() => ProposalShape.parse(base), 'a reduction proposal with no target')
  const p = ProposalShape.parse({ ...base, reductionTarget: makeReductionTarget() })
  assertEq(p.kind, 'reduction', 'kind round-trips')
  assertEq(p.reductionTarget?.measuredTokens, 41000, 'the measured token count round-trips')
  assertEq(p.reductionTarget?.budgetTokens, 30000, 'the budget round-trips')
  assertEq(p.reductionTarget?.ledger, 'roadmap/eval/reduction-ledger.json', 'the ledger ref round-trips')
  assertEq(p.candidateReviewFocus, undefined, 'no review-focus payload on a reduction')
})

check('Proposal: payload/kind pairing is TWO-DIRECTIONAL — process-change carrying EITHER payload REJECTS', () => {
  requireShape(ProposalShape, 'ProposalShape')
  assertThrows(
    () => ProposalShape.parse(makeProposal({ kind: 'process-change' })),
    'a process-change smuggling a candidateReviewFocus',
  )
  const { candidateReviewFocus: _dropped, ...bare } = makeProposal({ kind: 'process-change' })
  assertThrows(
    () => ProposalShape.parse({ ...bare, reductionTarget: makeReductionTarget() }),
    'a process-change smuggling a reductionTarget',
  )
  const clean = ProposalShape.parse(bare)
  assertEq(clean.kind, 'process-change', 'a payload-free process-change is the legal form')
  assertEq(clean.candidateReviewFocus, undefined, 'and it carries neither payload')
  assertEq(clean.reductionTarget, undefined, 'neither payload, both directions')
  const { candidateReviewFocus: _also, ...schema } = makeProposal({ kind: 'schema-tightening' })
  assertThrows(
    () => ProposalShape.parse({ ...schema, reductionTarget: makeReductionTarget() }),
    'a schema-tightening smuggling a reductionTarget',
  )
})

check('Proposal: writeOrigin is the LITERAL roadmap-eval-loop — a user-written origin REJECTS', () => {
  requireShape(ProposalShape, 'ProposalShape')
  assertIssuePath(ProposalShape, makeProposal({ writeOrigin: 'user' }), ['writeOrigin'], 'writeOrigin user')
  assertIssuePath(
    ProposalShape,
    makeProposal({ writeOrigin: 'roadmap-eval-loop ' }),
    ['writeOrigin'],
    'a trailing-space near-miss origin',
  )
})

check('Proposal: status archived REQUIRES archivedReason — bare REJECTS, a >=10-char reason parses', () => {
  requireShape(ProposalShape, 'ProposalShape')
  assertThrows(
    () => ProposalShape.parse(makeProposal({ status: 'archived' })),
    'an archived proposal with no reason',
  )
  assertThrows(
    () => ProposalShape.parse(makeProposal({ status: 'archived', archivedReason: 'stale' })),
    'a 5-char archived reason',
  )
  const p = ProposalShape.parse(
    makeProposal({ status: 'archived', archivedReason: 'superseded by the ratified review focus' }),
  )
  assertEq(p.status, 'archived', 'status round-trips')
  assertEq(p.archivedReason, 'superseded by the ratified review focus', 'the reason survives verbatim')
  const live = ProposalShape.parse(makeProposal({ status: 'ratified' }))
  assertEq(live.archivedReason, undefined, 'a non-archived proposal needs no reason')
})

check('Opportunity: satisfaction null BINDS score to importance — a diverging score REJECTS, an equal one parses', () => {
  requireShape(OpportunityShape, 'OpportunityShape')
  assertThrows(
    () => OpportunityShape.parse(makeOpportunity({ satisfaction: null, score: 13 })),
    'an unmeasured opportunity claiming a gap-inflated score',
  )
  assertThrows(
    () => OpportunityShape.parse(makeOpportunity({ satisfaction: null, score: 0 })),
    'an unmeasured opportunity scored at zero instead of importance',
  )
  const unmeasured = OpportunityShape.parse(makeOpportunity({ satisfaction: null, score: 8 }))
  assertEq(unmeasured.satisfaction, null, 'null satisfaction is an honest absence, not 0')
  assertEq(unmeasured.score, 8, 'score falls back to importance exactly')
  const measured = OpportunityShape.parse(makeOpportunity())
  assertEq(measured.score, 13, 'a MEASURED satisfaction is free to diverge — the refine binds only the null case')
  assertEq(measured.rulingsVersion, 1, 'the rulings version pins which table scored this')
  assertEq(measured.rulingId, 'ruling-recurring-regression', 'the ruling id round-trips')
})

check('Opportunity: the 0..10 range is closed and the provenance fields are required', () => {
  requireShape(OpportunityShape, 'OpportunityShape')
  assertIssuePath(OpportunityShape, makeOpportunity({ importance: 11 }), ['importance'], 'importance 11')
  assertIssuePath(OpportunityShape, makeOpportunity({ importance: -1 }), ['importance'], 'importance -1')
  assertIssuePath(
    OpportunityShape,
    makeOpportunity({ satisfaction: 11 }),
    ['satisfaction'],
    'satisfaction 11',
  )
  assertIssuePath(OpportunityShape, makeOpportunity({ score: -1 }), ['score'], 'a negative score')
  assertIssuePath(OpportunityShape, makeOpportunity({ rulingId: '' }), ['rulingId'], 'an empty rulingId')
  assertIssuePath(
    OpportunityShape,
    makeOpportunity({ rulingsVersion: 0 }),
    ['rulingsVersion'],
    'rulingsVersion 0',
  )
  assertIssuePath(
    OpportunityShape,
    makeOpportunity({ satisfactionSource: '' }),
    ['satisfactionSource'],
    'an unsourced satisfaction',
  )
  const atBounds = OpportunityShape.parse(makeOpportunity({ importance: 10, satisfaction: 0, score: 0 }))
  assertEq(atBounds.importance, 10, 'importance 10 is in range')
  assertEq(atBounds.satisfaction, 0, 'satisfaction 0 is a MEASURED zero, distinct from null')
})

check('Proposal: the id is slug-shaped — /^[a-z0-9-]+$/ rejects underscores, capitals and spaces', () => {
  requireShape(ProposalShape, 'ProposalShape')
  assertIssuePath(ProposalShape, makeProposal({ id: 'Recurring_Regression' }), ['id'], 'a capitalized snake id')
  assertIssuePath(ProposalShape, makeProposal({ id: 'recurring regression' }), ['id'], 'a spaced id')
  assertIssuePath(ProposalShape, makeProposal({ id: '' }), ['id'], 'an empty id')
  assertEq(ProposalShape.parse(makeProposal({ id: 'a-1' })).id, 'a-1', 'a lowercase slug parses')
})

check('ImportanceRulingsTable: a v1 table with one ruling per finding class parses and keeps every ruling', () => {
  requireShape(ImportanceRulingsTableShape, 'ImportanceRulingsTableShape')
  const t = ImportanceRulingsTableShape.parse(makeRulingsTable())
  assertEq(t.version, 1, 'version round-trips')
  assertEq(t.rulings.length, 5, 'one ruling per finding class survives')
  assertEq(
    t.rulings.map((r) => r.findingClass).sort(),
    [
      'protocol-load-over-budget',
      'recurring-lesson-key',
      'recurring-low-score',
      'recurring-regression',
      'recurring-sentinel',
    ],
    'the table covers the closed class vocabulary',
  )
  assertEq(t.rulings[0].importance, 5, 'the ratified importance round-trips')
})

check('ImportanceRulingsTable: a <10-char rationale REJECTS, version 0 REJECTS, and an empty rulings list REJECTS', () => {
  requireShape(ImportanceRulingsTableShape, 'ImportanceRulingsTableShape')
  requireShape(ImportanceRulingShape, 'ImportanceRulingShape')
  const short = makeRulingsTable()
  ;(short.rulings as Array<{ rationale: string }>)[0].rationale = 'x'.repeat(9)
  assertIssuePath(ImportanceRulingsTableShape, short, ['rulings', 0, 'rationale'], 'a 9-char rationale')
  const atBound = makeRulingsTable()
  ;(atBound.rulings as Array<{ rationale: string }>)[0].rationale = 'x'.repeat(10)
  assertEq(
    ImportanceRulingsTableShape.parse(atBound).rulings[0].rationale.length,
    10,
    'exactly 10 chars is the floor',
  )
  assertIssuePath(ImportanceRulingsTableShape, makeRulingsTable({ version: 0 }), ['version'], 'version 0')
  assertIssuePath(ImportanceRulingsTableShape, makeRulingsTable({ version: 1.5 }), ['version'], 'a fractional version')
  assertIssuePath(ImportanceRulingsTableShape, makeRulingsTable({ rulings: [] }), ['rulings'], 'an empty rulings list')
  assertIssuePath(
    ImportanceRulingsTableShape,
    makeRulingsTable({ ratified: '2026' }),
    ['ratified'],
    'a truncated ratified date',
  )
  assertThrows(
    () =>
      ImportanceRulingShape.parse({
        id: 'ruling-vibes',
        findingClass: 'recurring-vibes',
        importance: 5,
        rationale: 'vibes matter a great deal to the fleet',
      }),
    'a ruling for an invented finding class',
  )
})

check('Proposal: lane and status vocabularies are CLOSED — an unknown lane and an unknown status each REJECT', () => {
  requireShape(ProposalLaneShape, 'ProposalLaneShape')
  requireShape(ProposalStatusShape, 'ProposalStatusShape')
  requireShape(ProposalKindShape, 'ProposalKindShape')
  requireShape(ProposalShape, 'ProposalShape')
  ProposalLaneShape.parse('plugin-generic')
  ProposalLaneShape.parse('consumer-specific')
  assertThrows(() => ProposalLaneShape.parse('both'), 'an invented lane')
  for (const s of ['surfaced', 'ratified', 'rejected', 'archived']) ProposalStatusShape.parse(s)
  assertThrows(() => ProposalStatusShape.parse('pending'), 'an invented status')
  for (const k of [
    'review-focus-candidate',
    'skill-amendment',
    'schema-tightening',
    'process-change',
    'reduction',
  ]) {
    ProposalKindShape.parse(k)
  }
  assertThrows(() => ProposalKindShape.parse('refactor'), 'an invented kind')
  assertIssuePath(ProposalShape, makeProposal({ lane: 'both' }), ['lane'], 'an unknown lane on a proposal')
  assertIssuePath(ProposalShape, makeProposal({ status: 'pending' }), ['status'], 'an unknown status on a proposal')
  const { candidateReviewFocus: _dropped, ...bare } = makeProposal()
  assertIssuePath(ProposalShape, { ...bare, kind: 'refactor' }, ['kind'], 'an unknown kind on a proposal')
})

check('ProposalEvidence: every field is load-bearing — a blank file, jsonPath or excerpt REJECTS', () => {
  requireShape(ProposalEvidenceShape, 'ProposalEvidenceShape')
  const e = ProposalEvidenceShape.parse(makeEvidence(1))
  assertEq(e.file, 'roadmap/arcs/EVALLOOP-eval-1.json', 'the source file round-trips')
  assertEq(e.jsonPath, "$.dimensions['code-confidence'].signals.gateRounds", 'the json path round-trips')
  assertIssuePath(ProposalEvidenceShape, { ...makeEvidence(1), file: '' }, ['file'], 'an unnamed source file')
  assertIssuePath(ProposalEvidenceShape, { ...makeEvidence(1), jsonPath: '' }, ['jsonPath'], 'an empty json path')
  assertIssuePath(ProposalEvidenceShape, { ...makeEvidence(1), excerpt: '' }, ['excerpt'], 'an empty excerpt')
})

check('Proposal: title and rationale carry a >=10-char floor, and supersededBy is optional-but-nonempty when present', () => {
  requireShape(ProposalShape, 'ProposalShape')
  assertIssuePath(ProposalShape, makeProposal({ title: 'x'.repeat(9) }), ['title'], 'a 9-char title')
  assertIssuePath(ProposalShape, makeProposal({ rationale: 'x'.repeat(9) }), ['rationale'], 'a 9-char rationale')
  assertIssuePath(ProposalShape, makeProposal({ createdAt: '2026' }), ['createdAt'], 'a truncated createdAt')
  assertIssuePath(ProposalShape, makeProposal({ updatedAt: '2026' }), ['updatedAt'], 'a truncated updatedAt')
  const atBound = ProposalShape.parse(makeProposal({ title: 'x'.repeat(10), rationale: 'y'.repeat(10) }))
  assertEq(atBound.title.length, 10, 'exactly 10 chars is the title floor')
  const superseded = ProposalShape.parse(makeProposal({ supersededBy: 'recurring-regression-v2' }))
  assertEq(superseded.supersededBy, 'recurring-regression-v2', 'the supersession pointer round-trips')
  assertEq(ProposalShape.parse(makeProposal()).supersededBy, undefined, 'absent stays absent, never invented')
})

console.log('\nPhaseEvalRecordShape')

// Unknown-key rejection is the WHOLE point of this shape: the three ad-hoc JSON
// layouts it replaces silently strip fields, so a producer that renames a key
// keeps "parsing" while the consumer reads undefined. assertIssuePath alone is
// not enough — it would also pass if the level rejected for some UNRELATED
// reason at the same path. Assert the issue CODE and the named key too.
function assertUnknownKeyRejected(
  shape: unknown,
  input: unknown,
  expectedPath: (string | number)[],
  expectedKey: string,
  where: string,
): void {
  const s = shape as {
    safeParse: (v: unknown) => {
      success: boolean
      error?: { issues: Array<{ code: string; path: PropertyKey[]; keys?: string[] }> }
    }
  }
  const r = s.safeParse(input)
  if (r.success) throw new Error(`${where}: expected to reject, parsed clean (key was STRIPPED)`)
  const want = expectedPath.map(String).join('.')
  const hit = (r.error?.issues ?? []).find(
    (i) => i.code === 'unrecognized_keys' && i.path.map(String).join('.') === want,
  )
  if (!hit) {
    const seen = (r.error?.issues ?? [])
      .map((i) => `${i.code}@[${i.path.map(String).join('.')}]`)
      .join(' | ')
    throw new Error(`${where}: expected unrecognized_keys at [${want}], got [${seen}]`)
  }
  if (!(hit.keys ?? []).includes(expectedKey)) {
    throw new Error(
      `${where}: issue at [${want}] did not name the key "${expectedKey}", named [${(hit.keys ?? []).join(', ')}]`,
    )
  }
}

// MINIMAL fixture — exactly the required fields and nothing else. Every negative
// below starts from a record that is already legal and breaks exactly one thing.
function makeEvalRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: 725,
    date: '2026-08-23',
    consumerFingerprint: { repo: 'mudarabah2', language: 'typescript', corpusSize: 1840 },
    taskCount: 4,
    keyFiles: ['lib/roadmap/schema.ts', 'scripts/emit-phases.ts'],
    gate: {
      green: true,
      slots: [
        { slot: 'lint', exitCode: 0, durationMs: 4200 },
        { slot: 'e2e', declaredAbsent: true },
      ],
    },
    ...overrides,
  }
}

// The seven-field historical metrics fixture is reused verbatim: the eval record
// embeds the EXISTING PhaseMetricsShape, it does not fork a parallel one.
const fullEvalRecord = {
  ...makeEvalRecord(),
  metrics: { ...historicalMetrics, haltCount: 2 },
  attribution: {
    plannedBy: { model: 'claude-opus-5' },
    driver: { model: 'claude-sonnet-4-6', lane: 'codex' },
    roles: {
      'test-writer': { model: 'claude-opus-5' },
      reviewer: { model: 'claude-haiku-4-5' },
    },
  },
}

check('PhaseEvalRecord: a FULL record round-trips every field and optional with values intact', () => {
  requireShape(PhaseEvalRecordShape, 'PhaseEvalRecordShape')
  const r = PhaseEvalRecordShape.parse(fullEvalRecord)
  assertEq(r.phase, 725, 'phase preserved')
  assertEq(r.date, '2026-08-23', 'the CALLER-supplied date is preserved, never re-minted')
  assertEq(r.consumerFingerprint.repo, 'mudarabah2', 'fingerprint repo preserved')
  assertEq(r.consumerFingerprint.language, 'typescript', 'fingerprint language preserved')
  assertEq(r.consumerFingerprint.corpusSize, 1840, 'fingerprint corpusSize preserved')
  assertEq(r.taskCount, 4, 'taskCount preserved — it is the bandFor cohort key')
  assertEq(r.keyFiles, ['lib/roadmap/schema.ts', 'scripts/emit-phases.ts'], 'keyFiles preserved in order')
  assertEq(r.gate.green, true, 'gate.green preserved')
  assertEq(r.gate.slots.length, 2, 'both slots preserved')
  assertEq(r.gate.slots[0].slot, 'lint', 'slot name preserved')
  assertEq(r.gate.slots[0].exitCode, 0, 'an exit code of 0 survives — it is a real value, not absent')
  assertEq(r.gate.slots[0].durationMs, 4200, 'durationMs preserved')
  assertEq(r.gate.slots[0].declaredAbsent, undefined, 'a ran slot declares no absence')
  assertEq(r.gate.slots[1].declaredAbsent, true, 'declaredAbsent preserved on the absent slot')
  assertEq(r.gate.slots[1].exitCode, undefined, 'an absent slot has no exit code, not a zero')
  assertEq(r.metrics?.commits, 4, 'the embedded PhaseMetrics is the EXISTING shape, values intact')
  assertEq(r.metrics?.haltCount, 2, 'the metrics time-axis widening survives the embed')
  assertEq(r.attribution?.plannedBy?.model, 'claude-opus-5', 'plannedBy model preserved')
  assertEq(r.attribution?.driver?.model, 'claude-sonnet-4-6', 'driver model preserved')
  assertEq(r.attribution?.driver?.lane, 'codex', 'driver lane preserved')
  assertEq(r.attribution?.roles?.['test-writer'].model, 'claude-opus-5', 'a hyphenated role key preserved')
  assertEq(r.attribution?.roles?.reviewer.model, 'claude-haiku-4-5', 'a second role entry preserved')
})

check('PhaseEvalRecord: a MINIMAL record parses — keyFiles and gate.slots default to [], metrics/attribution stay ABSENT', () => {
  requireShape(PhaseEvalRecordShape, 'PhaseEvalRecordShape')
  const r = PhaseEvalRecordShape.parse({
    phase: 1,
    date: '2026-01-01',
    consumerFingerprint: { repo: 'zeroh-marketplace', language: 'typescript', corpusSize: 0 },
    taskCount: 0,
    gate: { green: false },
  })
  assertEq(r.keyFiles, [], 'keyFiles defaults to the empty cohort, not undefined')
  assertEq(r.gate.slots, [], 'gate.slots defaults to empty, not undefined')
  assertEq(r.gate.green, false, 'a red gate is a recorded value, not a missing one')
  assertEq(r.taskCount, 0, 'taskCount 0 is legal — the floor, not a rejection')
  assertEq(r.consumerFingerprint.corpusSize, 0, 'corpusSize 0 is legal')
  assertEq(r.metrics, undefined, 'metrics absent, not zero-filled')
  assertEq(r.attribution, undefined, 'attribution absent, never invented')
})

check('PhaseEvalRecord: an unknown key at the ROOT is REJECTED, never silently stripped', () => {
  requireShape(PhaseEvalRecordShape, 'PhaseEvalRecordShape')
  assertUnknownKeyRejected(
    PhaseEvalRecordShape,
    { ...makeEvalRecord(), phaseNumber: 725 },
    [],
    'phaseNumber',
    'a near-miss root key (phaseNumber vs phase)',
  )
  assertUnknownKeyRejected(
    PhaseEvalRecordShape,
    { ...makeEvalRecord(), scorecard: { verdict: 'PASS' } },
    [],
    'scorecard',
    'an extra root object',
  )
})

check('PhaseEvalRecord: strictness is NOT root-only — an unknown key inside attribution.driver, a gate.slots row, or consumerFingerprint each REJECT at their own path', () => {
  requireShape(PhaseEvalRecordShape, 'PhaseEvalRecordShape')
  assertUnknownKeyRejected(
    PhaseEvalRecordShape,
    {
      ...makeEvalRecord(),
      attribution: { driver: { model: 'claude-sonnet-4-6', lane: 'session', temperature: 0.2 } },
    },
    ['attribution', 'driver'],
    'temperature',
    'an unknown key nested two levels deep in attribution.driver',
  )
  assertUnknownKeyRejected(
    PhaseEvalRecordShape,
    makeEvalRecord({
      gate: { green: true, slots: [{ slot: 'lint', exitCode: 0 }, { slot: 'e2e', skipped: true }] },
    }),
    ['gate', 'slots', 1],
    'skipped',
    'an unknown key in the SECOND gate.slots row (index must be named)',
  )
  assertUnknownKeyRejected(
    PhaseEvalRecordShape,
    makeEvalRecord({
      consumerFingerprint: { repo: 'mudarabah2', language: 'typescript', corpusSize: 1840, loc: 90210 },
    }),
    ['consumerFingerprint'],
    'loc',
    'an unknown key in consumerFingerprint',
  )
  assertUnknownKeyRejected(
    PhaseEvalRecordShape,
    { ...makeEvalRecord(), attribution: { roles: { reviewer: { model: 'claude-opus-5', cost: 3 } } } },
    ['attribution', 'roles', 'reviewer'],
    'cost',
    'an unknown key inside a roles map VALUE',
  )
})

check('PhaseEvalRecord: metrics is the ONE deliberately-open level — it REUSES PhaseMetricsShape, and the doc says so', () => {
  requireShape(PhaseEvalRecordShape, 'PhaseEvalRecordShape')
  // The record is strict everywhere it DECLARES a level, but `metrics` embeds the shared
  // PhaseMetricsShape rather than restating it, and that shape is a plain object. Pinning the
  // strip here is what keeps the exception a documented decision instead of a claim the
  // strictness block silently fails to cover: without this case the shape's own JSDoc would be
  // the only statement about metrics, and nothing would notice if it stopped being true.
  const withExtra = PhaseEvalRecordShape.parse(
    makeEvalRecord({
      metrics: {
        commits: 3, linesAdded: 10, linesRemoved: 1, filesChanged: 2,
        testsAtStart: 100, testsAtEnd: 105, testsAdded: 5,
        tokensBurned: 999999,
      },
    }),
  )
  assertEq(withExtra.metrics?.commits, 3, 'the known metrics survive')
  assertEq(
    (withExtra.metrics as Record<string, unknown>)?.tokensBurned,
    undefined,
    'an unknown metrics key is STRIPPED, not rejected — the reuse of PhaseMetricsShape is what makes a widening there reach this record for free',
  )
  // And the exception is exactly one level wide: its SIBLING under the same root is strict.
  assertUnknownKeyRejected(
    PhaseEvalRecordShape,
    makeEvalRecord({ consumerFingerprint: { repo: 'r', language: 'typescript', corpusSize: 1, loc: 2 } }),
    ['consumerFingerprint'],
    'loc',
    'the open level does not leak: consumerFingerprint still rejects',
  )
})

check('PhaseEvalRecord: date must be a full ISO date — 9 chars rejects, exactly 10 is the floor', () => {
  requireShape(PhaseEvalRecordShape, 'PhaseEvalRecordShape')
  assertIssuePath(PhaseEvalRecordShape, makeEvalRecord({ date: '2026-08-2' }), ['date'], 'a 9-char date')
  assertIssuePath(PhaseEvalRecordShape, makeEvalRecord({ date: '' }), ['date'], 'an empty date')
  assertIssuePath(PhaseEvalRecordShape, makeEvalRecord({ date: '2026' }), ['date'], 'a bare year')
  const atBound = PhaseEvalRecordShape.parse(makeEvalRecord({ date: '2026-08-23' }))
  assertEq(atBound.date, '2026-08-23', 'exactly 10 chars is the floor')
  const stamped = PhaseEvalRecordShape.parse(makeEvalRecord({ date: '2026-08-23T09:15:00.000Z' }))
  assertEq(stamped.date, '2026-08-23T09:15:00.000Z', 'a longer ISO stamp is still accepted verbatim')
})

check('PhaseEvalRecord: phase must be a POSITIVE integer — 0, -1 and 1.5 all reject; 1 is the floor', () => {
  requireShape(PhaseEvalRecordShape, 'PhaseEvalRecordShape')
  assertIssuePath(PhaseEvalRecordShape, makeEvalRecord({ phase: 0 }), ['phase'], 'phase 0')
  assertIssuePath(PhaseEvalRecordShape, makeEvalRecord({ phase: -1 }), ['phase'], 'a negative phase')
  assertIssuePath(PhaseEvalRecordShape, makeEvalRecord({ phase: 1.5 }), ['phase'], 'a fractional phase')
  assertEq(PhaseEvalRecordShape.parse(makeEvalRecord({ phase: 1 })).phase, 1, 'phase 1 is the floor')
})

check('PhaseEvalRecord: taskCount is non-negative and driver.lane is OPEN but never blank', () => {
  requireShape(PhaseEvalRecordShape, 'PhaseEvalRecordShape')
  assertIssuePath(PhaseEvalRecordShape, makeEvalRecord({ taskCount: -1 }), ['taskCount'], 'a negative taskCount')
  assertIssuePath(PhaseEvalRecordShape, makeEvalRecord({ taskCount: 2.5 }), ['taskCount'], 'a fractional taskCount')
  // A record must be emittable for whichever driver ran the phase, or the very phases this
  // measurement exists to compare are the ones it silently drops.
  for (const lane of ['session', 'codex', 'grok-exec']) {
    const ok = PhaseEvalRecordShape.parse({
      ...makeEvalRecord(),
      attribution: { driver: { model: 'claude-sonnet-4-6', lane } },
    })
    assertEq(ok.attribution?.driver?.lane, lane, `lane ${lane} round-trips`)
  }
  assertIssuePath(
    PhaseEvalRecordShape,
    { ...makeEvalRecord(), attribution: { driver: { model: 'claude-sonnet-4-6', lane: '' } } },
    ['attribution', 'driver', 'lane'],
    'a blank driver lane',
  )
})

check('PhaseEvalRecordList: parses an array of two records and names the offending INDEX on a bad element', () => {
  requireShape(PhaseEvalRecordListShape, 'PhaseEvalRecordListShape')
  const list = PhaseEvalRecordListShape.parse([makeEvalRecord({ phase: 724 }), fullEvalRecord])
  assertEq(list.length, 2, 'both records parsed')
  assertEq(list[0].phase, 724, 'first element preserved')
  assertEq(list[1].phase, 725, 'second element preserved')
  assertEq(list[1].attribution?.driver?.lane, 'codex', 'the second element keeps its attribution')
  assertEq(PhaseEvalRecordListShape.parse([]).length, 0, 'an empty batch is legal')
  assertIssuePath(
    PhaseEvalRecordListShape,
    [makeEvalRecord({ phase: 724 }), makeEvalRecord({ phase: 0 })],
    [1, 'phase'],
    'a bad phase in the SECOND element',
  )
  assertIssuePath(
    PhaseEvalRecordListShape,
    [makeEvalRecord({ date: '2026' }), makeEvalRecord()],
    [0, 'date'],
    'a bad date in the FIRST element',
  )
  assertUnknownKeyRejected(
    PhaseEvalRecordListShape,
    [makeEvalRecord(), { ...makeEvalRecord(), phaseNumber: 725 }],
    [1],
    'phaseNumber',
    'an unknown root key in the second element of a batch',
  )
})

// discoverArcs is async — run it and the final summary inside an async tail so
// the harness stays CJS-compatible (no top-level await).
;(async () => {
  try {
    const out = await discoverArcs('/no/such/dir')
    assertEq(out, { arcs: [], errors: [] }, 'missing dir')
    console.log('  ok — discoverArcs over a missing roadmap/arcs dir returns empty')
  } catch (err) {
    failures++
    console.error(`  FAIL — discoverArcs over a missing roadmap/arcs dir returns empty\n` +
      `         ${err instanceof Error ? err.message : String(err)}`)
  }

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)`)
  process.exit(failures === 0 ? 0 : 1)
})()
