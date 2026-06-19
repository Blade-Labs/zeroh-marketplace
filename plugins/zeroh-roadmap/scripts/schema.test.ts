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

import { defineBacklog, definePhase, BacklogShape, BacklogTierShape } from '../templates/schema'

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

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
