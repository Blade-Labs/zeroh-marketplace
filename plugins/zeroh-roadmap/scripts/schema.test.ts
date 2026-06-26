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
  IntentVerdictShape,
  PhaseExecutionResultShape,
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
