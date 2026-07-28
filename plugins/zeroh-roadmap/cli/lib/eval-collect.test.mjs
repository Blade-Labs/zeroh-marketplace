#!/usr/bin/env node
/**
 * eval-collect.test.mjs — the ArcTrace COLLECTOR (arc EVALCORE, 1996.2): everything the
 * scorer is allowed to look at, read from disk alone. Fixtures come from the shared
 * corpus builder (cli/testdata/eval-arc/build-fixture.mjs), which materializes a real
 * consumer repo — real phase files parsed through the REAL consumer schema over the REAL
 * tsx bridge, real roadmap/.gate run reports, real dated artifacts and a scripted git
 * history with ONE planted post-land escape fix and two decoys (an unrelated fix, and a
 * body-only phase mention that must never move the land boundary).
 *
 * The invariants under test are absence invariants: an absent artifact must surface as an
 * ABSENT FIELD (the scorer owns the single absence→sentinel mapping), a phase file that
 * will not import must be RECORDED as a parse failure and named in warnings (a silently
 * dropped phase would quietly improve every average it should have dragged down), and a
 * collect must never mint a driver, a plannedBy or a landedAt it cannot evidence.
 *
 * Run: node --test cli/lib/eval-collect.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultExec } from './exec.mjs'
import { bridgeEval } from './tsx-bridge.mjs'
import { buildEvalFixture, ARC_ID, PHASE_NUMS } from '../testdata/eval-arc/build-fixture.mjs'
import { collectArcTrace, summarizeGateRuns, findArcGitFacts, newestArtifact, CollectError } from './eval-collect.mjs'

const scratch = []
process.on('exit', () => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** Fixture roots are expensive (a git script + tsx bridge reads) — build each variant once. */
const memo = new Map()
const fixture = (opts = {}) => {
  const key = JSON.stringify(opts)
  if (!memo.has(key)) memo.set(key, buildEvalFixture(opts))
  return memo.get(key)
}

/**
 * ArcTraceShape lives in the consumer's TypeScript schema, which a .mjs test cannot
 * import directly — so the trace is validated the way production validates it: shipped
 * through the tsx bridge into the fixture repo's own `lib/roadmap/schema.ts` and
 * `.parse()`d there. This is the REAL contract, not a restatement of it.
 */
function parsesArcTraceShape(root, trace) {
  const jsonPath = join(root, 'trace-under-test.json')
  writeFileSync(jsonPath, JSON.stringify(trace))
  const schema = join(root, 'lib', 'roadmap', 'schema.ts')
  const script = `import('${schema}').then(async (M) => {
    const S = M.default ?? M
    const { readFileSync } = await import('node:fs')
    const r = S.ArcTraceShape.safeParse(JSON.parse(readFileSync('${jsonPath}', 'utf8')))
    process.stdout.write(r.success ? 'TRACE_OK' : 'TRACE_BAD:' + JSON.stringify(r.error.issues))
  }).catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(9) })`
  const res = bridgeEval(root, script)
  if (!res.ok) return { ok: false, detail: res.stderr }
  return res.stdout.includes('TRACE_OK')
    ? { ok: true, detail: '' }
    : { ok: false, detail: res.stdout.slice(0, 2000) }
}

const byNum = (trace, n) => trace.phases.find((p) => p.phase === n)

// ── 1. the collected trace ────────────────────────────────────────────────────────────
test('collectArcTrace — both member phases, ASCENDING, each populated from its phase file', () => {
  const root = fixture()
  const { trace, warnings } = collectArcTrace(root, ARC_ID)

  assert.equal(trace.arcId, ARC_ID)
  assert.deepEqual(trace.phases.map((p) => p.phase), PHASE_NUMS, 'ascending phase order, both planes flattened')
  assert.deepEqual(warnings, [], 'a fully-recorded corpus warns about nothing')

  const p1 = byNum(trace, 9001)
  assert.equal(p1.taskCount, 4)
  assert.equal(p1.transparency.length, 4, 'every task report is carried, not just the last')
  assert.equal(p1.transparency[0].whatWasDone, 'added the collector entry point over the arc file and its members')
  assert.equal(p1.executionResult.status, 'done')
  assert.equal(p1.executionResult.gateRounds, 2)
  assert.deepEqual(p1.executionResult.driver, { model: 'claude-opus-5', lane: 'session' })
  assert.equal(p1.metrics.startedAt, '2026-07-16T10:00:00.000Z')
  assert.equal(p1.metrics.completedAt, '2026-07-16T10:40:00.000Z')
  assert.equal(p1.metrics.haltCount, 0, 'a recorded zero is data — only an UNRECORDED haltCount is absent')
  assert.ok(
    p1.keyFiles.includes('web/src/panels/eval-panel.tsx'),
    'keyFiles travel verbatim — the surface-cohort heuristic reads them downstream',
  )
  assert.equal(p1.parseError, undefined)

  const p2 = byNum(trace, 9002)
  assert.equal(p2.taskCount, 2)
  assert.equal(p2.transparency.length, 2)
  assert.equal(p2.executionResult.status, 'done')
  assert.equal(p2.metrics.haltCount, 2, 'the interrupted phase carries its halt count')
  assert.ok(!p2.keyFiles.some((f) => f.startsWith('web/')), 'the non-surface cohort has no web/ keyFile')

  // Arc-level artifacts: newest sweep, the verdicts panel, the regenerable summary.
  assert.equal(trace.sweep.date, '2026-07-20')
  assert.equal(trace.sweep.overall, 'green')
  assert.equal(trace.verdicts.judgeModel, 'claude-sonnet-5')
  assert.equal(trace.verdicts.verdicts.length, 3)
  assert.equal(trace.verdicts.verdicts.filter((v) => v.status === 'gap').length, 1)
  assert.equal(trace.summary.outcome, 'shipped')

  // Gate runs land flattened on the phase entries.
  assert.equal(p1.gateRuns.length, 1)
  assert.equal(p1.gateRuns[0].rounds.length, 3)
  assert.equal(p1.gateRuns[0].slotFailures, 0)
  assert.equal(p2.gateRuns[0].slotFailures, 1)
})

// ── 2. the contract ───────────────────────────────────────────────────────────────────
test('collectArcTrace — the trace .parse()s ArcTraceShape from the REAL consumer schema', () => {
  const root = fixture()
  const { trace } = collectArcTrace(root, ARC_ID)
  const r = parsesArcTraceShape(root, trace)
  assert.equal(r.ok, true, `the trace must satisfy ArcTraceShape; got: ${r.detail}`)
})

// ── 3. idempotence (the acceptance criterion) ─────────────────────────────────────────
test('collectArcTrace — two runs over one fixture are deep-equal modulo collectedAt', () => {
  const root = fixture()
  const a = collectArcTrace(root, ARC_ID).trace
  const b = collectArcTrace(root, ARC_ID).trace
  assert.notEqual(a.collectedAt, undefined, 'collectedAt is stamped, not omitted')
  delete a.collectedAt
  delete b.collectedAt
  assert.deepEqual(a, b, 'the collector is a pure function of disk state plus the timestamp')
})

// ── 4. field-level absence: the verdicts artifact ─────────────────────────────────────
test('collectArcTrace — a missing verdicts file is an ABSENT FIELD, never a throw or a stub', () => {
  const root = fixture({ omitVerdicts: true })
  const { trace } = collectArcTrace(root, ARC_ID)
  assert.equal(trace.verdicts, undefined, 'absence is the field being absent — the scorer maps it to its sentinel')
  assert.ok(!('verdicts' in trace) || trace.verdicts === undefined, 'never an empty verdicts stub standing in for absent')
  // Every other field survives the absence.
  assert.equal(trace.sweep.date, '2026-07-20')
  assert.equal(trace.summary.outcome, 'shipped')
  assert.deepEqual(trace.phases.map((p) => p.phase), PHASE_NUMS)
  assert.equal(parsesArcTraceShape(root, trace).ok, true, 'a verdict-less trace is still a valid ArcTrace')
})

// ── 5. the quarantining-emit stance ───────────────────────────────────────────────────
test('collectArcTrace — an unimportable phase file is RECORDED (parseError) + WARNED, its sibling intact', () => {
  const root = fixture({ malformedPhase: 9002 })
  const { trace, warnings } = collectArcTrace(root, ARC_ID)

  assert.deepEqual(trace.phases.map((p) => p.phase), PHASE_NUMS, 'the broken phase is recorded, NEVER dropped')
  const bad = byNum(trace, 9002)
  assert.equal(typeof bad.parseError, 'string')
  assert.ok(bad.parseError.length > 0, 'the parse failure carries its reason, not an empty marker')
  assert.equal(bad.executionResult, undefined, 'no execution result is invented for a file that would not load')
  assert.equal(bad.metrics, undefined)
  assert.equal(bad.taskCount, 0, 'an uncountable task list is 0 tasks recorded alongside the parseError, not a guess')

  const good = byNum(trace, 9001)
  assert.equal(good.parseError, undefined, 'the sibling phase is untouched by its neighbour failing')
  assert.equal(good.taskCount, 4)
  assert.deepEqual(good.executionResult.driver, { model: 'claude-opus-5', lane: 'session' })

  assert.ok(warnings.some((w) => /9002/.test(w)), `warnings must name the failing phase; got ${JSON.stringify(warnings)}`)
  assert.ok(!warnings.some((w) => /\b9001\b/.test(w)), 'the healthy phase is not named in a warning')
  assert.equal(parsesArcTraceShape(root, trace).ok, true, 'a quarantined phase still yields a valid ArcTrace')
})

// ── 6. git facts: the land boundary + the escape rate ─────────────────────────────────
test('findArcGitFacts — landedAt is the newest MEMBER commit; exactly ONE escape fix, the unrelated one excluded', () => {
  const root = fixture()
  const facts = findArcGitFacts(root, PHASE_NUMS, { exec: defaultExec })

  // The land boundary is the `docs(roadmap): mark phase 9002 complete` commit (2026-07-18T12:00),
  // NOT the later `chore: tidy the fixture notes` whose BODY mentions phase 9001.
  assert.equal(new Date(facts.landedAt).toISOString(), '2026-07-18T12:00:00.000Z')

  assert.equal(facts.escapeFixes.length, 1, `exactly one escape fix; got ${JSON.stringify(facts.escapeFixes)}`)
  const [esc] = facts.escapeFixes
  assert.equal(esc.subject, 'fix(x): repair the collector guard')
  assert.equal(esc.files, 1, 'files is the SIZE of the intersection with the arc files, not the commit diff size')
  assert.ok(esc.sha.length >= 7)
  assert.ok(
    !facts.escapeFixes.some((f) => /unrelated/.test(f.subject)),
    'a post-land fix touching no arc file is not an escape',
  )

  assert.ok(facts.arcFiles.includes('src/collector.ts'))
  assert.ok(facts.arcFiles.includes('src/scorer.ts'))
  assert.ok(!facts.arcFiles.includes('src/unrelated.ts'), 'only the member commits contribute arc files')
})

test('findArcGitFacts — a member number with no commits yields no landedAt and no escapes (never a guessed boundary)', () => {
  const root = fixture()
  // 'phase 900' is a PREFIX of 'phase 9001': a loose --grep would match it and mint a
  // land boundary for an arc that never ran.
  const facts = findArcGitFacts(root, [900], { exec: defaultExec })
  assert.equal(facts.landedAt, undefined, "'phase 900' must not match 'phase 9001'")
  assert.deepEqual(facts.escapeFixes, [])
  assert.deepEqual(facts.arcFiles, [])
})

test('findArcGitFacts — a FAILED escape scan reports escapeScan unavailable, never zero escapes', () => {
  const root = fixture()
  // Member lookups and `git show` succeed; only the post-land log fails (the ENOBUFS shape
  // the 1 MiB exec buffer used to produce on a real repo). An empty escapeFixes here would
  // read as a spotless arc and RAISE the score, so the failure must travel as data.
  const failingLog = (file, args, opts) =>
    args.includes('--format=%H%x09%aI%x09%s') && args.some((a) => String(a).startsWith('--since='))
      ? { status: 1, stdout: '', stderr: 'ENOBUFS' }
      : defaultExec(file, args, opts)

  const facts = findArcGitFacts(root, PHASE_NUMS, { exec: failingLog })
  assert.equal(facts.escapeScan, 'unavailable', 'a scan that could not run says so')
  assert.deepEqual(facts.escapeFixes, [], 'and reports no fixes — which is UNKNOWN, not zero')
  assert.ok(facts.landedAt, 'the land boundary is still derivable from the member commits')

  // The collector turns that into a WARNING, so a degraded collect is visible in the run
  // output rather than inferred from a suspiciously good score.
  const { trace, warnings } = collectArcTrace(root, ARC_ID, { exec: failingLog })
  assert.equal(trace.git.escapeScan, 'unavailable')
  assert.ok(
    warnings.some((w) => /escape scan/i.test(w) && /not zero/i.test(w)),
    `the run must say the escape count is unknown; got ${JSON.stringify(warnings)}`,
  )
})

test('collectArcTrace — the git facts ride the trace under trace.git', () => {
  const root = fixture()
  const { trace } = collectArcTrace(root, ARC_ID, { exec: defaultExec })
  assert.equal(new Date(trace.git.landedAt).toISOString(), '2026-07-18T12:00:00.000Z')
  assert.equal(trace.git.escapeFixes.length, 1)
  assert.equal(trace.git.escapeFixes[0].subject, 'fix(x): repair the collector guard')
})

// ── 7. gate run summaries ─────────────────────────────────────────────────────────────
test('summarizeGateRuns — rounds and slotFailures per phase; an absent .gate dir is [] not a throw', () => {
  const root = fixture()

  const g1 = summarizeGateRuns(root, 9001)
  assert.equal(g1.length, 1)
  assert.equal(g1[0].green, true)
  assert.equal(g1[0].startedAt, '2026-07-16T10:05:00.000Z')
  assert.deepEqual(
    g1[0].rounds,
    [
      { round: 0, agent: 'quality-pass', verdict: 'clean' },
      { round: 1, agent: 'code-reviewer', verdict: 'findings-fixed' },
      { round: 2, agent: 'code-reviewer', verdict: 'clean' },
    ],
    'every round in order, with the agent that produced it — the reviewer trajectory is the signal',
  )
  assert.equal(g1[0].slotFailures, 0, 'four exit-0 slots is zero failures')

  const g2 = summarizeGateRuns(root, 9002)
  assert.equal(g2.length, 1)
  assert.deepEqual(g2[0].rounds, [{ round: 1, agent: 'code-reviewer', verdict: 'clean' }])
  assert.equal(g2[0].slotFailures, 1, 'the one exit-1 slot is counted; the two exit-0 slots are not')

  assert.deepEqual(summarizeGateRuns(root, 9999), [], 'a phase with no .gate dir has no runs — never a throw')
})

test('summarizeGateRuns — a mis-shaped run file is SKIPPED, never thrown, and never half-counted', () => {
  const root = fixture()
  const dir = join(root, 'roadmap', '.gate', '9001')
  writeFileSync(join(dir, 'run-000002-2026-07-16T11-00-00-000Z.json'), '{"phase": 9001, "green":')
  const g = summarizeGateRuns(root, 9001)
  assert.equal(g.length, 1, 'the corrupt run is dropped from the list, the readable one survives')
  assert.equal(g[0].slotFailures, 0)
})

// ── 8. newest-wins artifact selection ─────────────────────────────────────────────────
test('newestArtifact — the newest dated file wins; a suffix with no files is null', () => {
  const root = fixture()
  const dir = join(root, 'roadmap', 'arc-evals')
  const sweep = newestArtifact(dir, ARC_ID, 'sweep')
  assert.equal(sweep, join(dir, `${ARC_ID}-2026-07-20-sweep.json`), 'the 2026-07-20 sweep beats the 2026-07-10 one')
  assert.equal(newestArtifact(dir, ARC_ID, 'verdicts'), join(dir, `${ARC_ID}-2026-07-20-verdicts.json`))
  assert.equal(newestArtifact(dir, ARC_ID, 'nosuchsuffix'), null, 'no file ⇒ null, never a fabricated path')
  assert.equal(newestArtifact(dir, 'OTHERARC', 'sweep'), null, 'another arc id never borrows this arc artifacts')

  const empty = mkdtempSync(join(tmpdir(), 'zr-evalfix-empty-'))
  scratch.push(empty)
  assert.equal(newestArtifact(empty, ARC_ID, 'sweep'), null, 'an empty (or absent) dir is null, never a throw')
})

// ── 9. the typed refusal ──────────────────────────────────────────────────────────────
test('collectArcTrace — an absent arc file throws CollectError kind no-arc (never an empty trace)', () => {
  const root = fixture({ omitArc: true })
  assert.throws(
    () => collectArcTrace(root, ARC_ID),
    (e) => e instanceof CollectError && e.kind === 'no-arc',
    'an arc that does not exist must refuse, not collect a zero-phase trace that scores as perfect',
  )
})

// ── 10. plannedBy: recorded or absent, never guessed ──────────────────────────────────
test('collectArcTrace — plannedBy travels from the phase file; an unrecorded one stays undefined', () => {
  const root = fixture()
  const { trace } = collectArcTrace(root, ARC_ID)
  assert.deepEqual(byNum(trace, 9001).plannedBy, { model: 'claude-opus-5' })
  assert.equal(byNum(trace, 9002).plannedBy, undefined, 'no plannedBy on the file ⇒ no plannedBy on the trace')
  // Same rule one level down: the driver is self-reported or absent.
  assert.equal(byNum(trace, 9002).executionResult.driver, undefined, 'an unrecorded driver is never back-filled')
})
