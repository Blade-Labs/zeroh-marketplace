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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  HALT_KINDS,
  RESUME_LINE,
  reduceArcTransition,
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
// Keys match EXACTLY what arc-plane.workflow.mjs feeds detectSelfDescope: `acceptanceCriteria`
// (the phase's), `tasks[].acceptanceCriteria`, and `arcCriteria` (the mapped arc criteria).
const PHASE_DATA = {
  acceptanceCriteria: ['The masking service enforces every configured category before any model call'],
  tasks: [{ acceptanceCriteria: ['The ledger append is hash-chained across every governed turn'] }],
  arcCriteria: ['A consumer arc runs end-to-end with every transition a CLI call a test can replay'],
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
test('detectSelfDescope — a substantive sentence beginning with None is never mistaken for empty debt', () => {
  const result = { skipped: ['None of the configured masking categories are enforced before the model call'] }
  const m = detectSelfDescope(result, PHASE_DATA)
  assert.equal(m.length, 1)
  assert.equal(m[0].kind, 'task')
})
test('detectSelfDescope — flags a compromise narrowing an ARC criterion (arcCriteria, the production key)', () => {
  const result = { compromises: ['the land transition is not something a test can replay — it stays narrated in prose'] }
  const m = detectSelfDescope(result, PHASE_DATA)
  assert.equal(m.length, 1)
  assert.equal(m[0].kind, 'arc')
})
test('detectSelfDescope — flags a skipped narrowing a tasks[].acceptanceCriteria entry', () => {
  const result = { skipped: ['the ledger append is not hash-chained across a resumed turn'] }
  const m = detectSelfDescope(result, PHASE_DATA)
  assert.equal(m.length, 1)
  assert.equal(m[0].kind, 'task')
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

// ── workflow-composition pins (1658.2) — the SEPARABLE parts of arc-plane.workflow.mjs ────
const WORKFLOW = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'workflows', 'arc-plane.workflow.mjs'),
  'utf8',
)
test('workflow — every halt is built by buildHaltPayload (no ad-hoc { halt: … } literals)', () => {
  // Ad-hoc object literals would let a halt drift from the seam's shape — forbidden.
  assert.doesNotMatch(WORKFLOW, /\{\s*halt:/)
  const uses = (WORKFLOW.match(/buildHaltPayload/g) ?? []).length
  assert.ok(uses >= 3, `expected ≥3 buildHaltPayload uses, saw ${uses}`)
})
test('workflow — never kills a process (STALLED with a live background-run keeps waiting)', () => {
  assert.doesNotMatch(WORKFLOW, /\bprocess\.kill\b|SIGKILL|SIGTERM/)
})
test('workflow — arms the Stop-hook guard (ROADMAP_EXECUTOR_PHASE + the ONE arm lib) and generates the schema (seam 3)', () => {
  assert.match(WORKFLOW, /ROADMAP_EXECUTOR_PHASE/)
  // The arm FILE belongs to cli/lib/executor-arm.mjs (2376): the workflow routes through it and
  // keeps NO private copy, because a private copy is exactly what bypassed both 2375 guards.
  assert.match(WORKFLOW, /from '\.\.\/cli\/lib\/executor-arm\.mjs'/)
  assert.match(WORKFLOW, /armExecutor\(worktree, phase, sessionId/)
  assert.doesNotMatch(WORKFLOW, /-executor\.armed/)
  assert.match(WORKFLOW, /contract show --json-schema/)
})

// ── reduceArcTransition ──────────────────────────────────────────────────────────────
const knownAuthority = { status: 'known', envelopeDigest: 'sha256:authority-one', source: { kind: 'codex-journal', ref: 'session-1' } }
const lifecycleState = (overrides = {}) => ({ arcId: 'NATIVEGREEN', stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: structuredClone(knownAuthority), ...overrides })
const lifecycleEvent = (eventId, type, detail = {}) => ({ eventId, arcId: 'NATIVEGREEN', source: 'arc-workflow', type, ...detail })

test('reduceArcTransition — normal authorized flow reaches complete without wait-user', () => {
  let state = lifecycleState()
  const flow = [
    ['run-phase', { phase: 37 }, 'phase', 'relaunch-plane'], ['done', { phase: 37 }, 'phase', 'relaunch-plane'],
    ['sweep', {}, 'sweep', 'run-sweep'], ['validate', {}, 'validate', 'run-validate'],
    ['land', {}, 'land', 'run-land'], ['land-proven', { evidence: { head: 'abc1234' } }, 'delivery', 'run-evaluate'],
    ['evaluate', {}, 'evaluate', 'run-evaluate'], ['complete', { evidence: { verdict: 'PASS' } }, 'complete', 'done'],
  ]
  for (const [index, [type, detail, stage, resume]] of flow.entries()) {
    const receipt = reduceArcTransition(state, lifecycleEvent(`flow-${index}`, type, detail))
    assert.equal(receipt.rejection, null, type)
    assert.equal(receipt.next.stage, stage, type)
    assert.equal(receipt.resume, resume, type)
    assert.notEqual(receipt.resume, 'wait-user', type)
    assert.deepEqual(receipt.authorityRef, state.authorityRef, type)
    state = receipt.next
  }
})

test('reduceArcTransition — every halt has its safe recovery action', () => {
  const cases = [
    ['blocked', 'inspect-blocker'], ['escalated', 'wait-user'], ['self-descope', 'wait-user'],
    ['permission', 'wait-user'], ['auth', 'wait-user'], ['review-exhausted', 'wait-user'],
    ['failed', 'inspect-failure'], ['stalled', 'reconcile'], ['exited', 'reconcile'],
    ['unobserved', 'reconcile'], ['gaps', 'run-correction'], ['pause-after', 'relaunch-plane'],
  ]
  for (const [index, [kind, resume]] of cases.entries()) {
    const state = lifecycleState({ stage: kind === 'gaps' ? 'validate' : 'phase' })
    const event = lifecycleEvent(`halt-${index}`, kind, { phase: 37, evidence: { source: kind } })
    const receipt = reduceArcTransition(state, event)
    assert.equal(receipt.rejection, null, kind)
    assert.equal(receipt.next.status, 'halted', kind)
    assert.equal(receipt.next.lastHalt.kind, kind, kind)
    assert.deepEqual(receipt.next.lastHalt.evidence, event.evidence, kind)
    assert.equal(receipt.resume, resume, kind)
  }
})

test('reduceArcTransition — recovery evidence is mandatory and gaps return through sweep', () => {
  for (const [index, c] of [
    { halt: 'blocked', evidence: { reconciled: true } },
    { halt: 'stalled', evidence: { reconciled: true } },
    { halt: 'failed', evidence: { inspected: true } },
    { halt: 'permission', evidence: { authorized: true } },
  ].entries()) {
    const halted = reduceArcTransition(lifecycleState(), lifecycleEvent(`cause-${index}`, c.halt, { evidence: { source: c.halt } })).next
    const missing = reduceArcTransition(halted, lifecycleEvent(`missing-${index}`, 'resume'))
    assert.equal(missing.rejection.kind, 'invalid-transition', c.halt)
    assert.deepEqual(missing.next, halted, c.halt)
    const recovered = reduceArcTransition(halted, lifecycleEvent(`resume-${index}`, 'resume', { evidence: c.evidence }))
    assert.equal(recovered.rejection, null, c.halt)
    assert.deepEqual(recovered.authorityRef, knownAuthority, c.halt)
  }
  const gap = reduceArcTransition(lifecycleState({ stage: 'validate' }), lifecycleEvent('gap', 'gaps', { evidence: { verdict: 'GAPS' } })).next
  const corrected = reduceArcTransition(gap, lifecycleEvent('correction', 'correction', { evidence: { corrected: true } }))
  assert.equal(corrected.next.stage, 'sweep')
  assert.equal(corrected.resume, 'run-sweep')
  assert.equal(reduceArcTransition(gap, lifecycleEvent('skip-sweep', 'land')).rejection.kind, 'invalid-transition')
})

test('reduceArcTransition — unproven landing reconciles without replaying land', () => {
  const halted = reduceArcTransition(lifecycleState({ stage: 'land' }), lifecycleEvent('land-uncertain', 'land-unproven', { evidence: { exitCode: 2 } }))
  assert.equal(halted.next.status, 'halted')
  assert.equal(halted.resume, 'reconcile')
  assert.equal(reduceArcTransition(halted.next, lifecycleEvent('land-replay', 'land')).rejection.kind, 'invalid-transition')
  const reconciled = reduceArcTransition(halted.next, lifecycleEvent('land-reconciled', 'resume', { evidence: { reconciled: true, landed: true } }))
  assert.equal(reconciled.next.stage, 'delivery')
  assert.equal(reconciled.resume, 'run-evaluate')
})

test('reduceArcTransition — duplicate, invalid, cross-arc, and authority-conflict events are typed no-ops', () => {
  const state = lifecycleState({ processedEventIds: ['same-event'] })
  const cases = [
    [lifecycleEvent('same-event', 'run-phase', { phase: 37 }), 'duplicate-event'],
    [lifecycleEvent('too-early', 'land-proven'), 'invalid-transition'],
    [{ ...lifecycleEvent('foreign', 'run-phase', { phase: 37 }), arcId: 'OTHER' }, 'arc-mismatch'],
    [lifecycleEvent('auth-conflict', 'run-phase', { phase: 37, authorityRef: { ...knownAuthority, envelopeDigest: 'sha256:different' } }), 'authority-conflict'],
  ]
  for (const [event, kind] of cases) {
    const receipt = reduceArcTransition(state, event)
    assert.equal(receipt.rejection.kind, kind)
    assert.equal(receipt.rejection.eventId, event.eventId)
    assert.deepEqual(receipt.next, receipt.prior)
    assert.deepEqual(receipt.authorityRef, knownAuthority)
  }
})

test('reduceArcTransition — pure: inputs and nested authority/evidence are never mutated', () => {
  const state = lifecycleState()
  const event = lifecycleEvent('pure-1', 'blocked', { evidence: { reason: 'dependency' } })
  const beforeState = structuredClone(state)
  const beforeEvent = structuredClone(event)
  const receipt = reduceArcTransition(state, event)
  assert.deepEqual(state, beforeState)
  assert.deepEqual(event, beforeEvent)
  assert.deepEqual(receipt.prior, beforeState)
  assert.notStrictEqual(receipt.next, state)
  assert.notStrictEqual(receipt.event, event)
})

test('reduceArcTransition — malformed identities and incoherent state return parseable no-op receipts', () => {
  const malformed = reduceArcTransition(lifecycleState(), lifecycleEvent('   ', 'run-phase', { phase: 37 }))
  assert.equal(malformed.rejection.kind, 'malformed-event')
  assert.deepEqual(malformed.next, malformed.prior)
  assert.deepEqual(malformed.authorityRef, malformed.next.authorityRef)

  const duplicateIds = lifecycleState({ processedEventIds: ['event-a', 'event-a'] })
  const invalidState = reduceArcTransition(duplicateIds, lifecycleEvent('event-b', 'run-phase', { phase: 37 }))
  assert.equal(invalidState.rejection.kind, 'invalid-state')
  assert.deepEqual(invalidState.next, invalidState.prior)
  assert.deepEqual(invalidState.authorityRef, invalidState.next.authorityRef)
})

test('reduceArcTransition — unreadable or conflicting event authority never erases a known reference', () => {
  const state = lifecycleState()
  const unreadable = reduceArcTransition(state, lifecycleEvent('auth-unreadable', 'run-phase', {
    phase: 37,
    authorityRef: { status: 'unknown', reason: 'source-unreadable', sourceRef: 'journal:missing' },
  }))
  assert.equal(unreadable.rejection.kind, 'authority-conflict')
  assert.deepEqual(unreadable.next, unreadable.prior)
  assert.deepEqual(unreadable.authorityRef, knownAuthority)

  const conflict = reduceArcTransition(state, lifecycleEvent('auth-known-conflict', 'run-phase', {
    phase: 37,
    authorityRef: {
      status: 'known',
      envelopeDigest: 'sha256:different',
      source: { kind: 'managed-host-receipt', ref: 'host-receipt-2' },
    },
  }))
  assert.equal(conflict.rejection.kind, 'authority-conflict')
  assert.deepEqual(conflict.next, conflict.prior)
  assert.deepEqual(conflict.authorityRef, knownAuthority)
  assert.deepEqual(conflict.next.authorityRef, knownAuthority)
})

test('reduceArcTransition — rejected recovery keeps the prior resume and authority reference', () => {
  const landHalt = reduceArcTransition(
    lifecycleState({ stage: 'land' }),
    lifecycleEvent('land-halt', 'land-unproven', { evidence: { exitCode: 2 } }),
  ).next
  const rejected = reduceArcTransition(landHalt, lifecycleEvent('bad-recovery', 'resume'))
  assert.equal(rejected.rejection.kind, 'invalid-transition')
  assert.equal(rejected.resume, 'reconcile')
  assert.notEqual(rejected.resume, 'run-land')
  assert.deepEqual(rejected.next, rejected.prior)

  const unknown = lifecycleState({
    authorityRef: { status: 'unknown', reason: 'legacy-unrecorded', sourceRef: null },
  })
  const invalid = reduceArcTransition(unknown, lifecycleEvent('known-too-early', 'land-proven', {
    authorityRef: knownAuthority,
  }))
  assert.equal(invalid.rejection.kind, 'invalid-transition')
  assert.deepEqual(invalid.authorityRef, unknown.authorityRef)
  assert.deepEqual(invalid.next.authorityRef, unknown.authorityRef)
})

test('reduceArcTransition — authority source identity participates in conflict detection', () => {
  const sameDigestDifferentSource = lifecycleEvent('source-conflict', 'run-phase', {
    phase: 37,
    authorityRef: {
      ...knownAuthority,
      source: { kind: 'managed-host-receipt', ref: 'host-receipt-2' },
    },
  })
  const receipt = reduceArcTransition(lifecycleState(), sameDigestDifferentSource)
  assert.equal(receipt.rejection.kind, 'authority-conflict')
  assert.deepEqual(receipt.next, receipt.prior)
  assert.deepEqual(receipt.authorityRef, knownAuthority)
})

test('reduceArcTransition — forged halt recovery and explicit null optionals are malformed', () => {
  const forgedHalt = lifecycleState({
    status: 'halted',
    lastHalt: { kind: 'stalled', phase: 37, evidence: {}, resume: 'run-land' },
  })
  const invalidState = reduceArcTransition(forgedHalt, lifecycleEvent('forged-resume', 'resume', {
    evidence: { reconciled: true },
  }))
  assert.equal(invalidState.rejection.kind, 'invalid-state')
  assert.deepEqual(invalidState.next, invalidState.prior)

  for (const [eventId, detail] of [
    ['null-phase', { phase: null }],
    ['null-authority', { authorityRef: null }],
  ]) {
    const malformed = reduceArcTransition(lifecycleState(), lifecycleEvent(eventId, 'run-phase', detail))
    assert.equal(malformed.rejection.kind, 'malformed-event', eventId)
    assert.deepEqual(malformed.next, malformed.prior, eventId)
  }
})

test('reduceArcTransition — semantically equal known authority ignores object key order', () => {
  const receipt = reduceArcTransition(lifecycleState(), lifecycleEvent('auth-reordered-equal', 'run-phase', {
    phase: 37,
    authorityRef: {
      source: { ref: 'session-1', kind: 'codex-journal' },
      envelopeDigest: 'sha256:authority-one',
      status: 'known',
    },
  }))
  assert.equal(receipt.rejection, null)
  assert.deepEqual(receipt.authorityRef, knownAuthority)
})

test('PR delivery and awaiting-CI are terminal handoffs before plane membership',()=>{
 for(const action of ['deliver','awaiting-ci'])assert.equal(classifyNextAction({action},{name:'anything'}),'handoff')
})
test('canonical lifecycle routes validated work directly to delivery without local land',()=>{
 const authorityRef={status:'unknown',reason:'read-only-projection',sourceRef:null}
 const prior={arcId:'A',stage:'validate',status:'active',processedEventIds:[],lastHalt:null,authorityRef}
 const delivered=reduceArcTransition(prior,{eventId:'deliver-A',arcId:'A',source:'disk-checkpoint',type:'deliver',evidence:{},authorityRef})
 assert.equal(delivered.rejection,null);assert.equal(delivered.next.stage,'delivery');assert.equal(delivered.resume,'run-deliver')
 const pending=reduceArcTransition(delivered.next,{eventId:'ci-A',arcId:'A',source:'disk-checkpoint',type:'awaiting-ci',evidence:{},authorityRef})
 assert.equal(pending.rejection,null);assert.equal(pending.next.stage,'delivery');assert.equal(pending.resume,'await-ci')
})
