#!/usr/bin/env node
/**
 * TABLE-DRIVEN fixtures for cli/lib/workflow-steps.mjs — the pure §4 decision seams the
 * per-plane workflow composes. Every classifyNextAction branch, every classifyBandRoute
 * branch (incl. force overrides), every buildHaltPayload kind, detectSelfDescope
 * routine-vs-narrowing, buildExecutorPrompt content + byte-stability, and groomBacklogSource
 * clean/absent/ambiguous. Run: node --test cli/lib/workflow-steps.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HALT_KINDS,
  RESUME_LINE,
  buildHaltPayload,
  classifyBandRoute,
  classifyNextAction,
  detectSelfDescope,
  buildExecutorPrompt,
  groomBacklogSource,
} from './workflow-steps.mjs'

// ── buildHaltPayload ──────────────────────────────────────────────────────────────────
test('buildHaltPayload — every kind carries phase + evidence + the fixed resume line', () => {
  const watchVerdict = { verdict: 'STALLED', evidence: { beaconAgeMin: 47, event: 'gate-stage-start' } }
  for (const kind of HALT_KINDS) {
    const evidence = kind === 'stalled' || kind === 'exited' ? watchVerdict : { action: 'blocked', reason: 'unmet dep' }
    const p = buildHaltPayload(kind, { phase: 1658, evidence })
    assert.equal(p.halt, kind)
    assert.equal(p.phase, 1658)
    assert.equal(p.resume, RESUME_LINE)
    // stalled/exited carry the watch verdict JSON VERBATIM as evidence
    assert.deepEqual(p.evidence, evidence)
  }
})

test('buildHaltPayload — unknown kind throws (a halt is never invented)', () => {
  assert.throws(() => buildHaltPayload('wat', { phase: 1 }), /unknown halt kind/)
})

test('buildHaltPayload — defaults phase/evidence to null', () => {
  const p = buildHaltPayload('failed')
  assert.equal(p.phase, null)
  assert.equal(p.evidence, null)
})

// ── classifyBandRoute ─────────────────────────────────────────────────────────────────
const BAND_CASES = [
  { band: 'mid', force: undefined, route: 'spawn' },
  { band: 'trivial', force: undefined, route: 'handoff-inline' },
  { band: 'heavy', force: undefined, route: 'handoff-inline' },
  { band: 'mid', force: 'inline', route: 'handoff-inline', forced: 'inline' }, // --inline overrides mid
  { band: 'trivial', force: 'recursion', route: 'spawn', forced: 'recursion' }, // --recursion overrides trivial
  { band: 'heavy', force: 'recursion', route: 'spawn', forced: 'recursion' },
]
test('classifyBandRoute — band routing + force overrides', () => {
  for (const c of BAND_CASES) {
    const r = classifyBandRoute(c.band, c.force)
    assert.equal(r.route, c.route, `band=${c.band} force=${c.force}`)
    if (c.forced) assert.equal(r.forced, c.forced)
  }
})
test('classifyBandRoute — unknown band/force throw', () => {
  assert.throws(() => classifyBandRoute('gigantic'), /unknown band/)
  assert.throws(() => classifyBandRoute('mid', 'sideways'), /unknown force/)
})

// ── classifyNextAction ────────────────────────────────────────────────────────────────
const PLANE = { name: 'Sequencing', phases: [1658, 1659, 1660] }
const NEXT_CASES = [
  { name: 'run-phase in plane → run', next: { action: 'run-phase', phase: 1658, plane: 'Sequencing' }, plane: PLANE, expect: 'run' },
  { name: 'resume-phase in plane → run', next: { action: 'resume-phase', phase: 1659, plane: 'Sequencing' }, plane: PLANE, expect: 'run' },
  { name: 'phase outside plane → plane-done', next: { action: 'run-phase', phase: 1661, plane: 'Cutover' }, plane: PLANE, expect: 'plane-done' },
  { name: 'complete → complete', next: { action: 'complete' }, plane: PLANE, expect: 'complete' },
  { name: 'blocked → halt', next: { action: 'blocked', reason: 'dep' }, plane: PLANE, expect: 'halt' },
  { name: 'sweep → handoff (checked before plane membership)', next: { action: 'sweep' }, plane: PLANE, expect: 'handoff' },
  { name: 'validate → handoff', next: { action: 'validate' }, plane: PLANE, expect: 'handoff' },
  { name: 'land → handoff', next: { action: 'land' }, plane: PLANE, expect: 'handoff' },
]
test('classifyNextAction — every branch', () => {
  for (const c of NEXT_CASES) assert.equal(classifyNextAction(c.next, c.plane), c.expect, c.name)
})
test('classifyNextAction — name-only plane uses next.plane (files-are-truth cheap path)', () => {
  assert.equal(classifyNextAction({ action: 'run-phase', phase: 1658, plane: 'Sequencing' }, { name: 'Sequencing' }), 'run')
  assert.equal(classifyNextAction({ action: 'run-phase', phase: 1661, plane: 'Cutover' }, { name: 'Sequencing' }), 'plane-done')
})
test('classifyNextAction — an unhandled action throws (a new derive action is never silently misrouted)', () => {
  assert.throws(() => classifyNextAction({ action: 'teleport', phase: 1 }, PLANE), /unhandled arc-next action/)
})

// The loop-order contract as DATA — a scripted arc-next sequence drives classifyNextAction
// through run → run → plane-done (1658.2 composition pin), and a blocked fixture halts first.
test('classifyNextAction — loop order run → run → plane-done', () => {
  const seq = [
    { action: 'run-phase', phase: 1658, plane: 'Sequencing' },
    { action: 'run-phase', phase: 1659, plane: 'Sequencing' },
    { action: 'run-phase', phase: 1661, plane: 'Cutover' },
  ]
  assert.deepEqual(seq.map((n) => classifyNextAction(n, PLANE)), ['run', 'run', 'plane-done'])
})
test('classifyNextAction — a blocked fixture short-circuits to halt', () => {
  assert.equal(classifyNextAction({ action: 'blocked', reason: 'unmet cross-phase dependency' }, PLANE), 'halt')
})

// ── detectSelfDescope ─────────────────────────────────────────────────────────────────
const PHASE_DATA = {
  acceptanceCriteria: ['The masking service enforces every configured category before any model call'],
  arcAcceptanceCriteria: ['A consumer arc runs end-to-end with every transition a CLI call a test can replay'],
}
test('detectSelfDescope — routine decisionRef compromise stays empty', () => {
  const result = { compromises: [{ text: 'used the injected fetcher instead of a live call', decisionRef: 'architect PROCEED_WITH_FIX' }], skipped: 'None' }
  assert.deepEqual(detectSelfDescope(result, PHASE_DATA), [])
})
test('detectSelfDescope — empty compromises stays empty', () => {
  assert.deepEqual(detectSelfDescope({ compromises: [], skipped: 'None' }, PHASE_DATA), [])
})
test('detectSelfDescope — flags a skipped entry narrowing a task criterion', () => {
  const result = { compromises: 'None', skipped: ['shipped 3 of the 5 promised masking categories; enforces fewer than configured'] }
  const m = detectSelfDescope(result, PHASE_DATA)
  assert.equal(m.length, 1)
  assert.equal(m[0].kind, 'task')
})
test('detectSelfDescope — flags a compromise narrowing an ARC acceptanceCriterion', () => {
  const result = { compromises: ['the land transition is not something a test can replay — it stays narrated in prose'] }
  const m = detectSelfDescope(result, PHASE_DATA)
  assert.equal(m.length, 1)
  assert.equal(m[0].kind, 'arc')
})
test('detectSelfDescope — no criteria to check → empty (never a false positive)', () => {
  assert.deepEqual(detectSelfDescope({ skipped: ['dropped a whole feature'] }, {}), [])
})

// ── buildExecutorPrompt ───────────────────────────────────────────────────────────────
const PROMPT_INPUT = {
  phaseFilePath: '/repo/roadmap/phases/phase-1658.phase.ts',
  phaseSource: "export default definePhase({ phase: 1658 })",
  gatePlan: {
    slots: [{ slot: 'lint' }, { slot: 'types' }, { slot: 'integration-scoped', files: ['x.itest.ts'] }],
    testScope: { effective: 'relevant', floorReason: 'gate-specialist path → floor relevant' },
    reviewScope: { effective: 'full' },
    agents: { round0: 'quality-pass', reviewers: ['code-reviewer', 'governed-spine-reviewer'] },
  },
  designRefs: [{ kind: 'architecture', status: 'designed', ref: 'roadmap/arcs/ROADCODE-DESIGN.md', summary: 'one line drawn once' }],
  beaconEvents: [
    { event: 'task-start', task: '1658.3', ts: '2026-07-16T09:00:00Z' },
    { event: 'background-run', pid: 44213, sid: 44213, host: 'illumination', log: '/tmp/gate-1658.log', doneMarker: '[gate] DONE rc=' },
  ],
}
test('buildExecutorPrompt — surfaces phase path, a slot name, a designRef, and the background-run beacon pid/log/DONE-marker', () => {
  const out = buildExecutorPrompt(PROMPT_INPUT)
  assert.match(out, /phase-1658\.phase\.ts/)
  assert.match(out, /integration-scoped/) // a slot from the plan fixture
  assert.match(out, /ROADCODE-DESIGN\.md/) // a designRef ref
  assert.match(out, /pid=44213/) // the background-run beacon pid → rediscover-not-relaunch
  assert.match(out, /\/tmp\/gate-1658\.log/) // its log path
  assert.match(out, /\[gate\] DONE rc=/) // its DONE marker
})
test('buildExecutorPrompt — byte-stable for equal input (deterministic, no Date/random)', () => {
  assert.equal(buildExecutorPrompt(PROMPT_INPUT), buildExecutorPrompt(PROMPT_INPUT))
})

// ── groomBacklogSource ────────────────────────────────────────────────────────────────
const BACKLOG = `export default defineBacklog({
  tiers: [
    { tier: 0, label: 'ROADCODE', items: [
      { phase: 1658, name: 'Sequencing — workflow + thin skills' },
      { phase: 1659, name: 'Prose diet' },
    ] },
  ],
})`
test('groomBacklogSource — clean single match removes the entry line', () => {
  const r = groomBacklogSource(BACKLOG, 1658)
  assert.ok(r.source, r.error)
  assert.doesNotMatch(r.source, /phase: 1658/)
  assert.match(r.source, /phase: 1659/) // siblings survive
})
test('groomBacklogSource — absent entry → error, never a silent skip', () => {
  const r = groomBacklogSource(BACKLOG, 9999)
  assert.ok(r.error)
  assert.match(r.error, /no backlog entry for phase 9999/)
})
test('groomBacklogSource — ambiguous (two entries) → error', () => {
  const dup = BACKLOG.replace("{ phase: 1659,", "{ phase: 1658,").replace('Prose diet', 'dup')
  const r = groomBacklogSource(dup, 1658)
  assert.ok(r.error)
  assert.match(r.error, /ambiguous/)
})
test('groomBacklogSource — a word-boundary guards 16580 from matching 1658', () => {
  const src = `{ phase: 16580, name: 'unrelated' }\n{ phase: 1658, name: 'target' }`
  const r = groomBacklogSource(src, 1658)
  assert.ok(r.source, r.error)
  assert.match(r.source, /16580/)
  assert.doesNotMatch(r.source, /'target'/)
})
test('groomBacklogSource — a single-phase comment naming ONLY N is removed; a multi-phase one is kept', () => {
  const src = `  // 1658 shipped\n  // 1658 + 1659 coordinate\n      { phase: 1658, name: 'x' }`
  const r = groomBacklogSource(src, 1658)
  assert.ok(r.source, r.error)
  assert.doesNotMatch(r.source, /1658 shipped/)
  assert.match(r.source, /1658 \+ 1659 coordinate/)
})
