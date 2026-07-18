#!/usr/bin/env node
/**
 * TABLE-DRIVEN fixtures for cli/lib/ladder.mjs — the ported gate-protocol.md /
 * do-arc SKILL.md prose tables, one fixture array per table. Every case carries its
 * source line anchor (`gate-protocol.md:NNN` / `do-arc SKILL.md:NN`) so the 1659
 * prose deletion can point HERE as the surviving spec. Purity pin: the module is
 * imported with no fs/env setup and driven with a FROZEN config to prove it never
 * mutates its inputs. Run: node --test cli/lib/ladder.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gateCell,
  specialistFloor,
  deriveTestScope,
  deriveReviewScope,
  deriveDocsOnly,
  classifyBand,
  matchGlob,
  EXECUTABLE_EXTS,
  REVIEW_LIGHT_MAX_LINES,
} from './ladder.mjs'

// A frozen consumer config — Object.freeze at every level proves ladder.mjs mutates nothing.
const CFG = Object.freeze({
  configVersion: 1,
  testCadence: Object.freeze({ enabled: true, backstop: 'ci-pr-gate + nightly', floors: 'blocking' }),
  gateSpecialists: Object.freeze([
    Object.freeze({
      paths: Object.freeze(['src/relay/**', 'src/masking*', 'src/pii/**', 'src/audit/**', 'src/contracts/**']),
      agent: '.claude/agents/governed-spine-reviewer.md',
    }),
  ]),
})
const CFG_NO_CADENCE = Object.freeze({ configVersion: 1, gateSpecialists: CFG.gateSpecialists })

// ── gateCell — 8 kind × mode cells (gate-protocol.md:88-93 rows × :340-345 columns) ─
test('gateCell — the 8 kind × mode table cells', () => {
  // gate-protocol.md:90 mockup — lint+types both modes
  assert.deepEqual(gateCell('mockup', 'inline').slots, ['lint', 'types'])
  assert.deepEqual(gateCell('mockup', 'arc').slots, ['lint', 'types'])
  assert.equal(gateCell('mockup', 'inline').scopedTests, false)

  // gate-protocol.md:343 logic — inline full tiers vs arc narrowed
  assert.deepEqual(gateCell('logic', 'inline').slots, ['lint', 'types', 'unit', 'integration', 'build'])
  assert.deepEqual(gateCell('logic', 'arc').slots, ['lint', 'types', 'build'])
  assert.equal(gateCell('logic', 'arc').scopedTests, true)
  assert.equal(gateCell('logic', 'inline').scopedTests, false)

  // gate-protocol.md:344 hardening — logic row + closure itest, NEVER defers (both modes)
  assert.equal(gateCell('hardening', 'inline').closureItest, true)
  assert.equal(gateCell('hardening', 'arc').closureItest, true)
  assert.deepEqual(gateCell('hardening', 'arc').slots, ['lint', 'types', 'build'])

  // gate-protocol.md:345 release — e2e inline vs deferred in arc
  assert.equal(gateCell('release', 'inline').e2e, 'inline')
  assert.equal(gateCell('release', 'arc').e2e, 'deferred')
  assert.equal(gateCell('logic', 'inline').e2e, false)
})

// ── gateCell — the testCadence.build cadence rung (TESTARCH §1533 follow-up 1) ──────
test('gateCell — testCadence.build absent/"phase" = today\'s cells byte-identical; "arc-end" drops build from every INLINE cell only', () => {
  const CFG_BUILD_ARC_END = Object.freeze({
    configVersion: 1,
    testCadence: Object.freeze({ enabled: true, build: 'arc-end' }),
  })
  const CFG_BUILD_PHASE = Object.freeze({
    configVersion: 1,
    testCadence: Object.freeze({ enabled: true, build: 'phase' }),
  })
  const kinds = ['mockup', 'logic', 'hardening', 'release', undefined]

  for (const kind of kinds) {
    for (const mode of ['inline', 'arc']) {
      // absent key (no cfg / CFG without build) and explicit 'phase' = today's cells EXACTLY
      assert.deepEqual(gateCell(kind, mode, CFG), gateCell(kind, mode), `cfg without build must not change ${kind}/${mode}`)
      assert.deepEqual(gateCell(kind, mode, CFG_BUILD_PHASE), gateCell(kind, mode), `build:'phase' must equal today's ${kind}/${mode}`)
    }
    // 'arc-end' — build absent from the INLINE cell for every kind…
    const inline = gateCell(kind, 'inline', CFG_BUILD_ARC_END)
    assert.ok(!inline.slots.includes('build'), `build must be absent from the ${kind}/inline cell under arc-end cadence`)
    assert.ok(inline.notes.some((n) => /testCadence\.build: arc-end/.test(n)), `${kind}/inline must carry the deferral honesty note`)
    // …and the arc-end column KEEPS it (that is where it defers TO) — mockup never had build in any mode
    const arcCell = gateCell(kind, 'arc', CFG_BUILD_ARC_END)
    assert.deepEqual(arcCell, gateCell(kind, 'arc'), `the arc cell is untouched by the cadence key (${kind})`)
    if (kind !== 'mockup') assert.ok(arcCell.slots.includes('build'), `build stays in the ${kind}/arc cell`)
  }

  // the non-build inline slots are unchanged under arc-end cadence
  assert.deepEqual(gateCell('logic', 'inline', CFG_BUILD_ARC_END).slots, ['lint', 'types', 'unit', 'integration'])
})

// ── specialistFloor — the two divergent floors (gate-protocol.md:188-197, :252-260) ─
test('specialistFloor — a spine path floors test→relevant, review→full; an unmatched diff floors nothing', () => {
  const hit = specialistFloor({ paths: ['src/relay/governed-turn.ts', 'src/foo.ts'] }, CFG)
  assert.equal(hit.matched, true)
  assert.deepEqual(hit.paths, ['src/relay/governed-turn.ts'])
  assert.equal(hit.testFloor, 'relevant') // gate-protocol.md:188-197 — never 'full'
  assert.equal(hit.reviewFloor, 'full') // gate-protocol.md:252-260
  assert.deepEqual(hit.agents, ['.claude/agents/governed-spine-reviewer.md'])

  const miss = specialistFloor({ paths: ['lib/foo.ts', 'docs/x.md'] }, CFG)
  assert.equal(miss.matched, false)
  assert.equal(miss.testFloor, null)
  assert.equal(miss.reviewFloor, null)

  // src/masking* matches src/masking.ts AND src/masking-rehydrate.ts (the * = [^/]* case)
  assert.equal(specialistFloor({ paths: ['src/masking-rehydrate.ts'] }, CFG).matched, true)
})

test('matchGlob — the documented ** / * subset only', () => {
  assert.equal(matchGlob('src/relay/**', 'src/relay/governed-turn.ts'), true)
  assert.equal(matchGlob('src/relay/**', 'src/relayx.ts'), false) // ** requires the slash boundary
  assert.equal(matchGlob('src/masking*', 'src/masking.ts'), true)
  assert.equal(matchGlob('src/masking*', 'src/pii/masking.ts'), false) // * never crosses /
})

// ── deriveTestScope — all four rungs, floor rule, ladder-off, sequence cap ──────────
test('deriveTestScope — ladder OFF when no ## Test cadence (never guess CI posture)', () => {
  // gate-protocol.md:164-174
  const r = deriveTestScope({ paths: ['src/foo.ts'], colocatedTest: new Set() }, { kind: 'logic' }, CFG_NO_CADENCE)
  assert.equal(r.effective, 'full')
  assert.equal(r.ladder, 'off')
})

test('deriveTestScope — the four derived rungs (gate-protocol.md:180-186)', () => {
  // static — docs/data only
  const st = deriveTestScope({ paths: ['docs/x.md', 'roadmap/data.json'], colocatedTest: new Set() }, { kind: 'logic' }, CFG)
  assert.equal(st.derived, 'static')
  assert.equal(st.effective, 'static')

  // scoped — every exec file is a test or has a colocated sibling
  const sc = deriveTestScope(
    { paths: ['lib/foo.ts', 'lib/foo.test.ts'], colocatedTest: new Set(['lib/foo.ts', 'lib/foo.test.ts']) },
    { kind: 'logic' },
    CFG,
  )
  assert.equal(sc.derived, 'scoped')

  // relevant — an exec file with no proving test on disk
  const rel = deriveTestScope({ paths: ['lib/bar.ts'], colocatedTest: new Set() }, { kind: 'logic' }, CFG)
  assert.equal(rel.derived, 'relevant')

  // full — release kind
  const full = deriveTestScope({ paths: ['docs/x.md'], colocatedTest: new Set() }, { kind: 'release' }, CFG)
  assert.equal(full.derived, 'full')
})

test('deriveTestScope — specialist path floors derived to relevant; honesty note names the backstop', () => {
  // gate-protocol.md:188-197 — a docs+spine diff would derive static but floors to relevant
  const r = deriveTestScope(
    { paths: ['src/relay/governed-turn.ts'], colocatedTest: new Set() },
    { kind: 'logic' },
    CFG,
  )
  assert.equal(r.derived, 'relevant')
  assert.match(r.floorReason, /Gate specialists path → floor relevant/)
  assert.ok(r.notes.some((n) => n.includes('ci-pr-gate + nightly')), 'honesty record names the backstop')
})

test('deriveTestScope — the raise-only floor rule (gate-protocol.md:188-197)', () => {
  const diff = { paths: ['lib/bar.ts'], colocatedTest: new Set() } // derives relevant
  // declared full RAISES → honored
  const raised = deriveTestScope(diff, { kind: 'logic', testScope: 'full' }, CFG)
  assert.equal(raised.effective, 'full')
  assert.equal(raised.refused, undefined)
  // declared static is BELOW the derived relevant floor → REFUSED
  const refused = deriveTestScope(diff, { kind: 'logic', testScope: 'static' }, CFG)
  assert.match(refused.refused, /testScope 'static' declared but the diff floor is 'relevant'/)
})

test('deriveTestScope — a declared static under a SPECIALIST floor refuses naming the path', () => {
  const r = deriveTestScope(
    { paths: ['src/relay/governed-turn.ts'], colocatedTest: new Set() },
    { kind: 'logic', testScope: 'static' },
    CFG,
  )
  assert.match(r.refused, /## Gate specialists floor: relevant — src\/relay\/governed-turn\.ts/)
})

test('deriveTestScope — sequence member caps effective at relevant (gate-protocol.md:217-230)', () => {
  const diff = { paths: ['lib/bar.ts'], colocatedTest: new Set() }
  const capped = deriveTestScope(diff, { phase: 1670, kind: 'logic', testScope: 'full' }, CFG, { sequenceMember: true })
  assert.equal(capped.effective, 'relevant')
  assert.ok(capped.notes.some((n) => /sequence-end suite after phase 1670/.test(n)))
})

// ── deriveReviewScope — rungs, 150-line boundary, declaration semantics ─────────────
test('deriveReviewScope — the 150-line boundary (gate-protocol.md:249)', () => {
  assert.equal(REVIEW_LIGHT_MAX_LINES, 150)
  const at = deriveReviewScope({ paths: ['lib/foo.ts'], changedLines: 150 }, { kind: 'logic' }, CFG)
  assert.equal(at.derived, 'light') // <= 150
  const over = deriveReviewScope({ paths: ['lib/foo.ts'], changedLines: 151 }, { kind: 'logic' }, CFG)
  assert.equal(over.derived, 'full') // > 150
})

test('deriveReviewScope — none for docs-only and for kind mockup (gate-protocol.md:248)', () => {
  assert.equal(deriveReviewScope({ paths: ['docs/x.md'], changedLines: 4 }, { kind: 'logic' }, CFG).derived, 'none')
  assert.equal(deriveReviewScope({ paths: ['lib/foo.ts'], changedLines: 9 }, { kind: 'mockup' }, CFG).derived, 'none')
})

test('deriveReviewScope — declaration honored both directions on a non-specialist diff (gate-protocol.md:252-260)', () => {
  // a large-but-mechanical diff lowered to light
  const lowered = deriveReviewScope({ paths: ['lib/foo.ts'], changedLines: 400 }, { kind: 'logic', reviewScope: 'light' }, CFG)
  assert.equal(lowered.derived, 'full')
  assert.equal(lowered.effective, 'light')
  assert.ok(lowered.notes.some((n) => n.includes('reviewScope light')))
})

test('deriveReviewScope — a specialist path refuses a lowered declaration (hard floor full)', () => {
  const r = deriveReviewScope(
    { paths: ['src/relay/governed-turn.ts'], changedLines: 20 },
    { kind: 'logic', reviewScope: 'light' },
    CFG,
  )
  assert.match(r.refused, /## Gate specialists floor: full/)
})

// ── deriveDocsOnly — the :289 executable-extension classifier ────────────────────────
test('deriveDocsOnly — the executable-extension list (gate-protocol.md:289)', () => {
  assert.deepEqual(EXECUTABLE_EXTS, ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rego', '.sql'])
  assert.equal(deriveDocsOnly(['docs/x.md', 'roadmap/data.json', 'img.png']), true)
  for (const ext of EXECUTABLE_EXTS) {
    assert.equal(deriveDocsOnly(['docs/x.md', `lib/foo${ext}`]), false, `${ext} is executable`)
  }
})

// ── classifyBand — the do-arc SKILL.md:52-75 thresholds ─────────────────────────────
const bandPhase = (over) => ({ kind: 'logic', tasks: [], keyFiles: [], ...over })
const tasksOf = (n, testMode = 'none') => Array.from({ length: n }, (_, i) => ({ id: `x.${i}`, testMode, files: [] }))

test('classifyBand — HEAVY at taskCount >= 10 (do-arc SKILL.md:60)', () => {
  assert.equal(classifyBand(bandPhase({ tasks: tasksOf(10) }), CFG).band, 'heavy')
})

test('classifyBand — HEAVY at 4 tdd/e2e on a contended path (do-arc SKILL.md:60)', () => {
  const p = bandPhase({ tasks: tasksOf(4, 'tdd'), keyFiles: ['src/relay/governed-turn.ts'] })
  assert.equal(classifyBand(p, CFG).band, 'heavy')
  // same 4 tdd tasks but NOT contended → not heavy (falls to mid)
  const notContended = bandPhase({ tasks: tasksOf(4, 'tdd'), keyFiles: ['lib/foo.ts'] })
  assert.notEqual(classifyBand(notContended, CFG).band, 'heavy')
})

test('classifyBand — MID for a 3-task logic phase (do-arc SKILL.md:66)', () => {
  assert.equal(classifyBand(bandPhase({ tasks: tasksOf(3) }), CFG).band, 'mid')
})

test('classifyBand — TRIVIAL at taskCount <= 2 (do-arc SKILL.md:70)', () => {
  assert.equal(classifyBand(bandPhase({ tasks: tasksOf(2) }), CFG).band, 'trivial')
})

test('classifyBand — the light-gated 4-task branch, TRIVIAL before MID (do-arc SKILL.md:70-72)', () => {
  const lightGated = bandPhase({ tasks: tasksOf(4), reviewScope: 'light' })
  assert.equal(classifyBand(lightGated, CFG).band, 'trivial')
  // the SAME 4-task phase WITHOUT the light declaration → mid (TRIVIAL rule doesn't catch it)
  const noDecl = bandPhase({ tasks: tasksOf(4) })
  assert.equal(classifyBand(noDecl, CFG).band, 'mid')
})
