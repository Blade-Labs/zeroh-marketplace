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
  IntentVerdictShape,
  PhaseExecutionResultShape,
  PhaseMetricsShape,
  RunnerSummaryShape,
  SweepReportShape,
  StructuredGateRoundShape,
  TransparencyReportShape,
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

check('driver: an unlisted lane rejects until the enum widens deliberately', () => {
  assertThrows(
    () =>
      PhaseExecutionResultShape.parse({
        phase: 1995,
        status: 'done',
        gateRounds: 1,
        driver: { model: 'grok-9', lane: 'grok' },
      }),
    'lane grok',
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
