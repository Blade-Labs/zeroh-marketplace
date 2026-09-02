#!/usr/bin/env node
/**
 * Fixtures for cli/lib/gate-report.mjs (the module; command flows live in gate.test.mjs):
 * shape parse/reject, the self-gitignore written once, latestReport picks the newest run,
 * writeReport retention (a 6th write leaves exactly the newest 5), and
 * checkPhaseConsistency clause-by-clause. Run: node --test cli/lib/gate-report.test.mjs
 *
 * TEST-FIRST for the optional `curation` block + recordCuration(toplevel, phase, block)
 * (phase 2145.4) at the bottom: curation makes a phase's granular SHAs unreachable, so the
 * proof that lived in them (which commits were squashed, each scratch/revert pair) has to
 * survive in the phase's LATEST gate report or review-phase and eval lose their evidence.
 * The properties are therefore (a) the block round-trips through the shape rather than
 * being silently stripped as an unknown key, (b) reports written before the field existed
 * still parse — the block is additive, never a migration, (c) the writer edits the latest
 * report IN PLACE (no new run file, older runs untouched), and (d) a block that does not
 * validate is refused with the on-disk report left exactly as it was: a half-written
 * evidence record is worse than none, because curation is about to make it unverifiable.
 *
 * TEST-FIRST for the optional `model` on a gate round (phase 2158.1) at the very bottom: a
 * recorded round names its ROLE (code-reviewer, quality-pass) but not the model that ran it,
 * so reviewer attribution is impossible for the evals. The field is additive and optional, so
 * the properties are (a) a model given is CARRIED to disk and back rather than stripped as an
 * unknown key, (b) a round with no model persists no `model` key at all (an attribution nobody
 * supplied must never be invented), and (c) an unusable model (empty string, non-string) is
 * REFUSED at the parse rather than recorded as attribution the evals would go on to read.
 *
 * TEST-FIRST for the no-self-judge rule in checkPhaseConsistency (phase 17.2) at the very
 * bottom: a codex-lane phase whose recorded reviews are empty or all self-review verifies
 * complete today, so a delegated driver judges its own work (mudarabah2 720's false green,
 * atlas 33's agents:[] done flip). The properties are (a) a delegated completion needs at
 * least ONE recorded round (round >= 1) by someone other than the driver, and the refusal
 * names both the rule and the `gate run <N> --record-round` remedy, (b) the rule is
 * LANE-scoped — an inline session self-reviewing is the documented boundary, and (c) it is
 * waived wherever the phase owes no review at all, whether reviewScope none was declared on
 * the phase or DERIVED by the ladder into the report's effective scope. Each clean direction
 * carries a positive control, because a rule that never fires would pass them all.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GateRunReportShape,
  AgentRoundInputShape,
  writeReport,
  latestReport,
  appendAgentRound,
  checkPhaseConsistency,
  gateDir,
} from './gate-report.mjs'
import * as gateReport from './gate-report.mjs'

// 2145.4 lands recordCuration. Resolving it lazily (not as a static named import) keeps a
// missing export a per-test RED instead of a link-time SyntaxError that would stop every
// test above from running at all.
const recordCuration = (...args) => {
  assert.equal(
    typeof gateReport.recordCuration,
    'function',
    'gate-report.mjs must export recordCuration(toplevel, phase, block)',
  )
  return gateReport.recordCuration(...args)
}

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))
const tmpRoot = () => {
  const d = mkdtempSync(join(tmpdir(), 'zr-report-'))
  execFileSync('git', ['init', '-q'], { cwd: d })
  writeFileSync(join(d, 'seed.txt'), 'seed\n')
  execFileSync('git', ['add', 'seed.txt'], { cwd: d })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'seed'], { cwd: d })
  bases.push(d)
  return d
}

const baseReport = (over = {}) => ({
  phase: 1670,
  startedAt: '2026-07-16T10:00:00.000Z',
  baseSha: 'abc123',
  mode: 'arc',
  kind: 'logic',
  testScope: { derived: 'relevant', declared: null, effective: 'relevant' },
  reviewScope: { derived: 'full', declared: null, effective: 'full' },
  slots: [{ slot: 'types', command: 'npm run type-check', exitCode: 0, durationMs: 12, logPath: null }],
  agents: [],
  green: true,
  notes: [],
  ...over,
})

const INDEPENDENT_REVIEW_ENFORCEMENT_AT = '2026-09-01T07:30:27.000Z'

/**
 * A curation block as `roadmap phase curate --apply` records it: how many granular commits
 * were swallowed, the subjects that replaced them, and the scratch/revert pairs whose SHAs
 * the squash is about to make unreachable. 40-char SHAs, because that is what git hands over.
 */
const sha = (c) => c.repeat(40)
const curationBlock = (over = {}) => ({
  squashedCount: 8,
  landedSubjects: [
    'feat(cli): phase 1670 — derive the curation range',
    'feat(cli): phase 1670 — squash the range losslessly',
  ],
  redProofs: [
    {
      scratch: sha('a'),
      revert: sha('b'),
      subject: 'scratch(cli): phase 1670 — prove the foreign tripwire bites',
    },
  ],
  ...over,
})

/** The run files under a phase's gate dir, oldest-first (the names sort by sequence). */
const runFileNames = (root, phase) =>
  readdirSync(gateDir(root, phase))
    .filter((f) => f.endsWith('.json'))
    .sort()

/** A run file exactly as it sits on disk — no shape parse, so a stripped field shows up. */
const rawRun = (root, phase, name) => JSON.parse(readFileSync(join(gateDir(root, phase), name), 'utf8'))

test('GateRunReportShape — parses a valid report, rejects a bad one', () => {
  assert.doesNotThrow(() => GateRunReportShape.parse(baseReport()))
  assert.throws(() => GateRunReportShape.parse(baseReport({ phase: -1 })))
  assert.throws(() => GateRunReportShape.parse(baseReport({ green: 'yes' })))
})

test('writeReport — writes under roadmap/.gate/<phase>/ and self-gitignores once', () => {
  const root = tmpRoot()
  const { path } = writeReport(root, baseReport())
  assert.ok(existsSync(path))
  assert.match(path, /roadmap\/\.gate\/1670\/run-\d+-.*\.json$/)
  const gi = join(root, 'roadmap', '.gate', '.gitignore')
  assert.equal(readFileSync(gi, 'utf8').trim(), '*')
  // a second write does not duplicate/alter the .gitignore
  writeReport(root, baseReport())
  assert.equal(readFileSync(gi, 'utf8').trim(), '*')
})

test('latestReport — picks the newest run', () => {
  const root = tmpRoot()
  writeReport(root, baseReport({ baseSha: 'first' }))
  writeReport(root, baseReport({ baseSha: 'second' }))
  const latest = latestReport(root, 1670)
  assert.equal(latest.report.baseSha, 'second')
  assert.equal(latestReport(root, 9999), null) // no reports for an unknown phase
})

test('writeReport — retains only the newest 5 (a 6th write prunes the oldest)', () => {
  const root = tmpRoot()
  for (let i = 1; i <= 6; i++) writeReport(root, baseReport({ baseSha: `run${i}` }))
  const files = readdirSync(gateDir(root, 1670)).filter((f) => f.endsWith('.json'))
  assert.equal(files.length, 5, 'exactly 5 run files survive')
  assert.equal(latestReport(root, 1670).report.baseSha, 'run6')
  // the oldest (run1) was pruned
  const seqs = files.map((f) => Number(f.match(/^run-(\d+)-/)[1])).sort((a, b) => a - b)
  assert.deepEqual(seqs, [2, 3, 4, 5, 6])
})

test('appendAgentRound — appends to the latest report without a new run file', () => {
  const root = tmpRoot()
  writeReport(root, baseReport())
  appendAgentRound(root, 1670, { round: 1, agent: 'code-reviewer', verdict: 'clean', summary: '0 findings' })
  const latest = latestReport(root, 1670)
  assert.equal(latest.report.agents.length, 1)
  assert.equal(latest.report.agents[0].round, 1)
  assert.ok(latest.report.agents[0].recordedAt) // stamped on append
  assert.equal(readdirSync(gateDir(root, 1670)).filter((f) => f.endsWith('.json')).length, 1, 'no new run file')
})

test('checkPhaseConsistency — the four clauses, red and green', () => {
  const phase = { phase: 1670, testScope: 'relevant', reviewScope: 'full', gateRounds: [{ round: 0 }, { round: 1 }] }

  // green: report matches, one round>=1, one gateRound round>=1
  const good = baseReport({
    testScope: { derived: 'relevant', declared: 'relevant', effective: 'relevant' },
    reviewScope: { derived: 'full', declared: 'full', effective: 'full' },
    agents: [{ round: 1, agent: 'x', verdict: 'clean', summary: 's', recordedAt: 't' }],
  })
  assert.equal(checkPhaseConsistency(phase, good).ok, true)

  // (i) not green
  assert.match(checkPhaseConsistency(phase, { ...good, green: false }).problems.join(' '), /not green/)
  // (ii) phase mismatch
  assert.match(checkPhaseConsistency(phase, { ...good, phase: 9999 }).problems.join(' '), /phase\/report mismatch/)
  // (iii) declared scope mismatch
  const scopeBad = baseReport({ testScope: { derived: 'relevant', declared: 'full', effective: 'full' }, agents: good.agents })
  assert.match(checkPhaseConsistency(phase, scopeBad).problems.join(' '), /scope mismatch/)
  // (iv) gateRounds count mismatch (report has 0 round>=1, phase has 1)
  assert.match(checkPhaseConsistency(phase, { ...good, agents: [] }).problems.join(' '), /gateRounds count mismatch/)
})

test('checkPhaseConsistency — refuses findings-fixed terminal evidence with an open CRITICAL or HIGH finding', () => {
  for (const severity of ['CRITICAL', 'HIGH']) {
    const phase = {
      phase: 1670,
      status: 'done',
      reviewScope: 'full',
      gateRounds: [{ round: 1, verdict: 'findings-fixed' }],
      executionResult: { driver: { model: 'codex', lane: 'session' } },
    }
    const report = baseReport({
      reviewScope: { derived: 'full', declared: 'full', effective: 'full' },
      agents: [{
        round: 1,
        agent: 'code-reviewer',
        verdict: 'findings-fixed',
        summary: `${severity} remains open`,
        findings: [findingRecord({ severity, fixedInCommit: undefined })],
        sha: sha('a'),
        recordedAt: '2026-09-02T10:00:00.000Z',
      }],
    })

    const result = checkPhaseConsistency(phase, report)
    assert.equal(result.ok, false, `${severity} terminal finding must block the done flip`)
    assert.match(result.problems.join(' '), new RegExp(`${severity}.*open|open.*${severity}`, 'i'))
  }
})

test('checkPhaseConsistency — accepts fixed-closed terminal evidence when every MEDIUM and LOW finding names its fix commit', () => {
  const phase = {
    phase: 1670,
    status: 'done',
    reviewScope: 'full',
    gateRounds: [{ round: 1, verdict: 'fixed-closed' }],
    executionResult: { driver: { model: 'codex', lane: 'session' } },
  }
  const report = baseReport({
    reviewScope: { derived: 'full', declared: 'full', effective: 'full' },
    agents: [{
      round: 1,
      agent: 'code-reviewer',
      verdict: 'fixed-closed',
      summary: 'all non-blocking findings fixed',
      findings: [
        findingRecord({ severity: 'MEDIUM', fixedInCommit: 'abcdef1' }),
        findingRecord({ severity: 'LOW', fixedInCommit: 'abcdef2' }),
      ],
      sha: sha('b'),
      recordedAt: '2026-09-02T10:00:00.000Z',
    }],
  })

  assert.deepEqual(checkPhaseConsistency(phase, report), { ok: true, problems: [] })
})

test('checkPhaseConsistency — refuses fixed-closed with no finding to close', () => {
  const phase = {
    phase: 1670,
    status: 'done',
    reviewScope: 'full',
    gateRounds: [{ round: 1, verdict: 'fixed-closed' }],
    executionResult: { driver: { model: 'codex', lane: 'session' } },
  }
  const report = baseReport({
    reviewScope: { derived: 'full', declared: 'full', effective: 'full' },
    agents: [{
      round: 1,
      agent: 'code-reviewer',
      verdict: 'fixed-closed',
      summary: 'nothing was actually closed',
      findings: [],
      sha: sha('c'),
      recordedAt: '2026-09-02T10:00:00.000Z',
    }],
  })
  const result = checkPhaseConsistency(phase, report)
  assert.equal(result.ok, false)
  assert.match(result.problems.join(' '), /at least one MEDIUM\/LOW finding/)
})

// ── the curation block + recordCuration (2145.4) ─────────────────────────────────────

test('GateRunReportShape — the curation block SURVIVES the parse (an unknown key would be stripped)', () => {
  const block = curationBlock()
  const parsed = GateRunReportShape.parse(baseReport({ curation: block }))
  // deepEqual, not doesNotThrow: a non-modelled field parses fine and then vanishes, which
  // is exactly how the evidence would be lost between write and read.
  assert.deepEqual(parsed.curation, block, 'the curation block must round-trip through the shape, field for field')
})

test('GateRunReportShape — a malformed curation block is REJECTED, field by field', () => {
  const bad = [
    ['squashedCount as a string', curationBlock({ squashedCount: '8' })],
    ['a fractional squashedCount', curationBlock({ squashedCount: 1.5 })],
    ['landedSubjects as a bare string', curationBlock({ landedSubjects: 'feat(cli): phase 1670 — one commit' })],
    ['a redProof missing its revert', curationBlock({ redProofs: [{ scratch: sha('a'), subject: 'scratch(cli): phase 1670 — x' }] })],
    ['a redProof missing its subject', curationBlock({ redProofs: [{ scratch: sha('a'), revert: sha('b') }] })],
    ['a non-string redProof subject', curationBlock({ redProofs: [{ scratch: sha('a'), revert: sha('b'), subject: 42 }] })],
    ['redProofs as an object', curationBlock({ redProofs: { scratch: sha('a'), revert: sha('b'), subject: 'x' } })],
  ]
  for (const [why, block] of bad) {
    let threw = false
    try {
      GateRunReportShape.parse(baseReport({ curation: block }))
    } catch {
      threw = true
    }
    assert.ok(threw, `${why} must be rejected — a curation block that parses loosely is evidence nobody can trust`)
  }
})

test('GateRunReportShape — a report WITHOUT curation still parses (the block is additive, not a migration)', () => {
  const root = tmpRoot()
  const legacy = baseReport()
  assert.doesNotThrow(() => GateRunReportShape.parse(legacy), 'the field is OPTIONAL — pre-2145.4 reports must keep parsing')
  writeReport(root, legacy)
  const latest = latestReport(root, 1670)
  assert.equal(latest.report.curation, undefined, 'no curation block is invented for a report that never had one')
  assert.equal(latest.report.green, true, 'the rest of the report is unaffected')
})

test('recordCuration — attaches the block to the LATEST report, in place, and a re-read returns it parsed', () => {
  const root = tmpRoot()
  writeReport(root, baseReport({ baseSha: 'first' }))
  writeReport(root, baseReport({ baseSha: 'second' }))
  appendAgentRound(root, 1670, { round: 1, agent: 'code-reviewer', verdict: 'clean', summary: '0 findings' })
  const targetPath = latestReport(root, 1670).path
  const block = curationBlock()

  const returned = recordCuration(root, 1670, block)

  assert.deepEqual(returned.curation, block, 'the writer returns the updated report, curation attached')
  const latest = latestReport(root, 1670)
  assert.equal(latest.path, targetPath, 'the SAME report file was edited — recordCuration is not a new gate run')
  assert.deepEqual(latest.report.curation, block, 'a re-read returns the block through the shape')
  assert.equal(latest.report.baseSha, 'second', 'the LATEST report carries it, not an earlier run')
  assert.equal(latest.report.agents.length, 1, 'the round recorded before curation survives the rewrite')
  const names = runFileNames(root, 1670)
  assert.equal(names.length, 2, 'no new run file — the gate run is the same run')
  assert.equal(rawRun(root, 1670, names[0]).curation, undefined, 'the older run file is left exactly as it was')
})

test('recordCuration — a second call REPLACES the block rather than stacking a second one', () => {
  const root = tmpRoot()
  writeReport(root, baseReport())
  recordCuration(root, 1670, curationBlock())

  const rerun = curationBlock({
    squashedCount: 3,
    landedSubjects: ['feat(cli): phase 1670 — land the curated history'],
    redProofs: [],
  })
  recordCuration(root, 1670, rerun)

  const latest = latestReport(root, 1670)
  assert.deepEqual(latest.report.curation, rerun, 'the newest curation run is the record — a re-curate is not an append')
  assert.equal(runFileNames(root, 1670).length, 1, 'still one run file')
})

test('recordCuration — a phase with no report throws a NAMED reason (evidence has nowhere to go)', () => {
  const root = tmpRoot()
  writeReport(root, baseReport()) // phase 1670 has a report; 9999 does not
  assert.equal(latestReport(root, 9999), null, 'fixture: the phase under test must have no report')

  let caught = null
  try {
    recordCuration(root, 9999, curationBlock())
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err // the missing-export guard, not the refusal
    caught = err
  }

  assert.ok(caught, 'recording curation evidence into a phase that has no gate report must THROW, never no-op')
  assert.ok(caught instanceof Error)
  assert.match(caught.message, /report/i, 'the reason names the missing gate report')
  assert.match(caught.message, /9999/, 'the reason names the phase it could not record into')
})

test('recordCuration — a malformed block is refused and the on-disk report is left untouched', () => {
  const root = tmpRoot()
  writeReport(root, baseReport())
  const before = readFileSync(latestReport(root, 1670).path, 'utf8')

  let caught = null
  try {
    recordCuration(root, 1670, curationBlock({ squashedCount: '8' }))
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err
    caught = err
  }

  assert.ok(caught, 'a block that does not validate must be refused by the writer, not written and validated later')
  const names = runFileNames(root, 1670)
  assert.equal(names.length, 1)
  assert.equal(readFileSync(join(gateDir(root, 1670), names[0]), 'utf8'), before, 'the report file is byte-identical — no partial write')
  assert.equal(latestReport(root, 1670).report.curation, undefined, 'nothing was recorded')
})

// ── the optional `model` on an agent round (2158.1) ──────────────────────────────────

/** A round as `gate run --record-round` hands it over (no recordedAt — that is stamped on append). */
const roundInput = (over = {}) => ({
  round: 1,
  agent: 'code-reviewer',
  verdict: 'clean',
  summary: '0 findings',
  ...over,
})

/** The same round as it sits INSIDE a report on disk. */
const recordedRound = (over = {}) => ({ ...roundInput(), recordedAt: '2026-07-16T10:25:00.000Z', ...over })

test('the round shapes CARRY a model through the parse (an unmodelled key would be stripped)', () => {
  // Both shapes, because a round crosses two of them: --record-round parses the INPUT shape,
  // and every read/write of the report re-parses the round inside GateRunReportShape. A field
  // modelled on only one side survives the append and vanishes on the next read.
  assert.equal(
    AgentRoundInputShape.parse(roundInput({ model: 'claude-x' })).model,
    'claude-x',
    'AgentRoundInputShape must model `model` — otherwise --record-round drops it before it is ever written',
  )
  const parsed = GateRunReportShape.parse(baseReport({ agents: [recordedRound({ model: 'claude-x' })] }))
  assert.deepEqual(
    parsed.agents[0],
    recordedRound({ model: 'claude-x', findings: [] }),
    'the round round-trips field for field — the model is not stripped between write and read',
  )
})

test('appendAgentRound — a round recorded WITH a model reaches disk and comes back', () => {
  const root = tmpRoot()
  writeReport(root, baseReport())

  const returned = appendAgentRound(root, 1670, roundInput({ model: 'claude-x' }))

  assert.equal(returned.agents[0].model, 'claude-x', 'the writer returns the round with its model')
  const latest = latestReport(root, 1670)
  assert.equal(latest.report.agents[0].model, 'claude-x', 'a re-read through the shape still carries it')
  // The raw file, not the parsed report: a field that parses and then vanishes on write is
  // exactly how the attribution would be lost between the gate run and the eval that reads it.
  const names = runFileNames(root, 1670)
  const raw = rawRun(root, 1670, names[0])
  assert.equal(raw.agents[0].model, 'claude-x', 'the PERSISTED round names the model that ran it')
  // The rest of the round is untouched by the new field.
  assert.equal(raw.agents[0].agent, 'code-reviewer', 'the ROLE still travels — model is additional, not a replacement')
  assert.equal(raw.agents[0].verdict, 'clean')
  assert.equal(raw.agents[0].summary, '0 findings')
  assert.ok(raw.agents[0].recordedAt, 'still stamped on append')
  assert.equal(names.length, 1, 'no new run file')
})

test('appendAgentRound — a round recorded WITHOUT a model persists NO model key (nothing invented)', () => {
  const root = tmpRoot()
  writeReport(root, baseReport())

  appendAgentRound(root, 1670, roundInput())

  const raw = rawRun(root, 1670, runFileNames(root, 1670)[0])
  assert.equal(
    'model' in raw.agents[0],
    false,
    'an unsupplied model is an ABSENT KEY — never a null, an empty string or a guessed default',
  )
  assert.equal(latestReport(root, 1670).report.agents[0].model, undefined, 'and the read side agrees')
  assert.equal(latestReport(root, 1670).report.agents[0].verdict, 'clean', 'the round is otherwise recorded as before')
})

test('a report whose rounds predate the model field still parses (additive, not a migration)', () => {
  const root = tmpRoot()
  const legacy = baseReport({ agents: [recordedRound()] })
  assert.doesNotThrow(() => GateRunReportShape.parse(legacy), 'the field is OPTIONAL — pre-2158.1 reports must keep parsing')
  writeReport(root, legacy)
  assert.equal(latestReport(root, 1670).report.agents[0].model, undefined, 'no model is back-filled onto a historical round')
})

test('an UNUSABLE model is REFUSED by the parse, not recorded as attribution', () => {
  // An empty string is the dangerous one: it parses as a string, reads as "attributed" to any
  // consumer that only checks presence, and names no model at all. Absent means unknown; ''
  // would mean unknown while LOOKING answered.
  const bad = [
    ['an empty model', ''],
    ['a numeric model', 42],
    ['an explicitly null model (absent is how unknown is spelled)', null],
    ['a model as an object', { name: 'claude-x' }],
  ]
  const isError = (e) => e instanceof Error
  for (const [why, model] of bad) {
    assert.throws(
      () => AgentRoundInputShape.parse(roundInput({ model })),
      isError,
      `${why}: AgentRoundInputShape must REFUSE it, not strip it and record an unattributed round`,
    )
    assert.throws(
      () => GateRunReportShape.parse(baseReport({ agents: [recordedRound({ model })] })),
      isError,
      `${why}: GateRunReportShape must REFUSE it — a report on disk is what the evals read`,
    )
  }
})

test('slotFilter — a subset marker that cannot be read as a FULL run', () => {
  // The discriminator both done-flip guards branch on (`if (report.slotFilter)`). An empty
  // string is the dangerous value: it parses as a string, is FALSY, and so re-opens the exact
  // door phase 1 gate R3 closed — a filtered report certifying a done flip and refreshing the
  // eval record. Absent is how a FULL run is spelled; '' would mean filtered while READING full.
  const isError = (e) => e instanceof Error
  for (const [why, slotFilter] of [
    ['an empty slotFilter', ''],
    ['a numeric slotFilter', 42],
    ['an explicitly null slotFilter (absent is how a full run is spelled)', null],
  ])
    assert.throws(
      () => GateRunReportShape.parse(baseReport({ slotFilter })),
      isError,
      `${why}: GateRunReportShape must REFUSE it — a falsy marker reads as a full run to both guards`,
    )

  assert.equal(GateRunReportShape.parse(baseReport({ slotFilter: 'types' })).slotFilter, 'types', 'a real --slots value survives')
  assert.equal(GateRunReportShape.parse(baseReport()).slotFilter, undefined, 'a FULL run carries no marker at all')
})

test('appendAgentRound — a round with an unusable model is refused BEFORE the write', () => {
  const root = tmpRoot()
  writeReport(root, baseReport())
  const path = latestReport(root, 1670).path
  const before = readFileSync(path, 'utf8')

  assert.throws(
    () => appendAgentRound(root, 1670, roundInput({ model: '' })),
    (e) => e instanceof Error,
    'an empty model must abort the append, not be stripped and written as an unattributed round',
  )

  assert.equal(readFileSync(path, 'utf8'), before, 'the report file is byte-identical — no half-recorded round')
  assert.equal(latestReport(root, 1670).report.agents.length, 0, 'nothing was appended')
})

// ── latestReport over an UNREADABLE newest run file (phase 9.2) ───────────────────────
//
const findingRecord = (over = {}) => ({
  file: 'cli/lib/gate-report.mjs',
  line: 42,
  severity: 'HIGH',
  confidence: 95,
  description: 'the persisted reviewer round drops its actionable finding details',
  fixedInCommit: 'abcdef1234567',
  agent: 'code-reviewer',
  ...over,
})

test('appendAgentRound — findings survive and the recording HEAD sha is stamped on disk and parsed read', () => {
  const root = tmpRoot()
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  writeReport(root, baseReport())
  const input = roundInput({ findings: [findingRecord()] })
  const parsedInput = AgentRoundInputShape.parse(input)
  assert.deepEqual(parsedInput.findings, input.findings, 'the INPUT shape carries every finding field')

  const returned = appendAgentRound(root, 1670, input)
  assert.deepEqual(returned.agents[0].findings, input.findings, 'the append result carries the findings')
  assert.equal(returned.agents[0].sha, head, 'the append result stamps the repository HEAD')

  const raw = rawRun(root, 1670, runFileNames(root, 1670)[0])
  assert.deepEqual(raw.agents[0].findings, input.findings, 'the persisted JSON retains every finding detail')
  assert.equal(raw.agents[0].sha, head, 'the persisted JSON retains the recording sha')
  const latest = latestReport(root, 1670)
  const reread = latest.report.agents[0]
  assert.deepEqual(reread.findings, input.findings, 'the REPORT shape does not strip findings on re-read')
  assert.equal(reread.sha, head, 'the REPORT shape does not strip sha on re-read')
  assert.deepEqual(latest.findingsRecorded, [true], 'the raw report proves findings per round, even when empty')
})

test('GateRunReportShape — a pre-findings round still parses without inventing findings or sha', () => {
  const parsed = GateRunReportShape.parse(baseReport({ agents: [recordedRound()] }))
  assert.deepEqual(parsed.agents[0].findings, [], 'legacy evidence receives the additive empty default')
  assert.equal(parsed.agents[0].sha, undefined, 'legacy evidence is not assigned an invented sha')
  assert.equal(parsed.agents[0].summary, '0 findings', 'the pre-existing round otherwise parses unchanged')
})

test('latestReport — preserves raw absence when a legacy round receives the findings default', () => {
  const root = tmpRoot()
  const written = writeReport(root, baseReport())
  const legacy = baseReport({ agents: [recordedRound()] })
  writeFileSync(written.path, JSON.stringify(legacy, null, 2) + '\n')

  const latest = latestReport(root, 1670)
  assert.deepEqual(latest.report.agents[0].findings, [], 'the compatibility default still applies')
  assert.deepEqual(latest.findingsRecorded, [false], 'raw absence survives beside the parsed default')
})

// TEST-FIRST for GateReportUnreadableError. latestReport() answers ONE question — "what is
// this phase's newest gate report?" — and today it answers `null` to two utterly different
// worlds: there is no evidence, and the evidence on disk cannot be read. Every caller
// (appendAgentRound, recordCuration, gate run --record-round / --verify-complete, phase
// validate's done-flip rule, executeCurate) reads that null as ABSENT, so a corrupt or
// schema-drifted run file is narrated as "no report" while it sits there. The properties
// pinned below are therefore (a) null is reserved for zero run files, (b) an unreadable
// NEWEST file throws a typed error naming the concrete path and the parse/Zod detail, and
// (c) it is the NEWEST file that decides — never a scan that falls back to an older
// readable run, which would certify a done flip from stale evidence.

// The class lands with the fix. Resolved lazily (not a static named import) so a missing
// export is a per-test RED, not a link-time SyntaxError that stops every test above.
const GateReportUnreadableError = () => {
  assert.equal(
    typeof gateReport.GateReportUnreadableError,
    'function',
    'gate-report.mjs must export class GateReportUnreadableError (constructed from (path, cause))',
  )
  return gateReport.GateReportUnreadableError
}

/** Drop `body` into a phase's gate dir as the NEWEST run file (seq = highest + 1). */
function writeNewestRun(root, phase, body) {
  const dir = gateDir(root, phase)
  mkdirSync(dir, { recursive: true })
  const seqs = readdirSync(dir)
    .filter((f) => /^run-\d+-.*\.json$/.test(f))
    .map((f) => Number(f.match(/^run-(\d+)-/)[1]))
  const seq = (seqs.length ? Math.max(...seqs) : 0) + 1
  const path = join(dir, `run-${String(seq).padStart(6, '0')}-2026-08-25T10-00-00-000Z.json`)
  writeFileSync(path, body)
  return path
}

/** Call latestReport expecting a THROW; a returned value (null above all) fails here. */
function latestExpectingThrow(root, phase, why) {
  let returned
  try {
    returned = latestReport(root, phase)
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err // the missing-export guard, not the refusal
    return err
  }
  assert.fail(
    `${why}: latestReport returned ${JSON.stringify(returned)} instead of throwing — ` +
      'every caller reads that as "this phase has no gate report" while corrupt evidence sits on disk',
  )
}

/** The typed-refusal contract: class, path, cause, and a message that names both. */
function assertUnreadable(err, path, detail, why) {
  assert.equal(err.name, 'GateReportUnreadableError', `${why}: the refusal is a NAMED error, not a bare Error`)
  assert.ok(err instanceof GateReportUnreadableError(), `${why}: it is an instance of the exported class`)
  assert.ok(err instanceof Error, `${why}: and still an Error`)
  assert.equal(err.path, path, `${why}: .path is the concrete run file that could not be read`)
  assert.ok(err.cause, `${why}: .cause carries the underlying JSON/Zod failure`)
  assert.ok(
    err.message.includes(path),
    `${why}: the message must NAME the run file (got: ${err.message})`,
  )
  assert.ok(
    err.message.includes(detail),
    `${why}: the message must carry the underlying detail '${detail}' — a bare "unreadable" costs a lookup (got: ${err.message})`,
  )
}

/** The JSON.parse failure these exact bytes produce — derived, never a copied literal. */
function parseDetailOf(body) {
  try {
    JSON.parse(body)
  } catch (e) {
    return e.message
  }
  assert.fail('fixture bug: the corrupt body must not parse')
}

test('latestReport — ABSENT is the ONLY null (no dir, empty dir, no run files)', () => {
  // Kept deliberately apart from the failure cases below: the whole defect is that these two
  // worlds share one return value, so the fixture that owns "absent" must own nothing else.
  const root = tmpRoot()
  assert.equal(latestReport(root, 4242), null, 'no roadmap/.gate/<phase>/ at all → null')

  mkdirSync(gateDir(root, 4243), { recursive: true })
  assert.equal(latestReport(root, 4243), null, 'an EMPTY phase dir → null')

  writeFileSync(join(gateDir(root, 4243), 'notes.txt'), 'not a run file\n')
  writeFileSync(join(gateDir(root, 4243), 'summary.json'), '{"green":true}\n')
  assert.equal(latestReport(root, 4243), null, 'a dir holding no run-<seq>-*.json → still null')
})

test('latestReport — corrupt newest report throws GateReportUnreadableError (corrupt is not absent)', () => {
  const root = tmpRoot()
  // An OLDER well-formed report FIRST: the newest file must decide on its own. A reader that
  // scanned backwards for the first readable run would answer with this stale one — green
  // evidence for a run whose real record nobody can read.
  const older = writeReport(root, baseReport({ baseSha: 'older-and-well-formed' }))
  const body = '{ "phase": 1670, "green": tru }\n'
  const corrupt = writeNewestRun(root, 1670, body)
  const before = readFileSync(corrupt, 'utf8')

  const err = latestExpectingThrow(root, 1670, 'the newest run file will not JSON.parse')
  assertUnreadable(err, corrupt, parseDetailOf(body), 'malformed JSON')

  assert.ok(
    !err.message.includes(older.path),
    'the refusal names the file it could not read, never the older one it declined to fall back to',
  )
  assert.equal(readFileSync(corrupt, 'utf8'), before, 'the unreadable file is left byte-identical — a reader never repairs evidence')
  assert.equal(runFileNames(root, 1670).length, 2, 'and never deletes it to make the problem go away')
})

test('latestReport — a schema-drifted newest report throws too, naming the Zod issue', () => {
  // Valid JSON, wrong shape: the second half of the conflated catch. `green: "yes"` is the
  // dangerous one — truthy to anything that skips the parse, so a fall-back-to-absent reading
  // hides a report that would otherwise certify a done flip on a string.
  for (const [why, drift] of [
    ['green as the string "yes"', { ...baseReport(), green: 'yes' }],
    ['a missing required field (baseSha)', (() => { const r = baseReport(); delete r.baseSha; return r })()],
  ]) {
    const root = tmpRoot()
    writeReport(root, baseReport({ baseSha: 'older-and-well-formed' }))
    const body = JSON.stringify(drift, null, 2) + '\n'
    const corrupt = writeNewestRun(root, 1670, body)
    const before = readFileSync(corrupt, 'utf8')

    const check = GateRunReportShape.safeParse(drift)
    assert.equal(check.success, false, `fixture bug: ${why} must not satisfy GateRunReportShape`)
    const issue = check.error.issues[0]

    const err = latestExpectingThrow(root, 1670, `the newest run file is ${why}`)
    assertUnreadable(err, corrupt, issue.message, why)
    assert.ok(
      err.message.includes(String(issue.path[0])),
      `${why}: the message names the offending field '${issue.path[0]}' (got: ${err.message})`,
    )
    assert.equal(readFileSync(corrupt, 'utf8'), before, `${why}: the drifted file is left byte-identical`)
  }
})

test('latestReport — a well-formed newest report still returns { path, report }, even behind an older corrupt one', () => {
  // The positive control, and the other half of "the NEWEST decides": an unreadable OLDER run
  // is nobody's evidence, so it must not red a phase whose newest report is fine.
  const root = tmpRoot()
  writeReport(root, baseReport({ baseSha: 'first' }))
  writeNewestRun(root, 1670, '{ "phase": 1670, "green": tru }\n')
  const newest = writeReport(root, baseReport({ baseSha: 'newest-and-well-formed' }))

  const latest = latestReport(root, 1670)
  assert.ok(latest, 'a readable newest report still resolves')
  assert.equal(latest.path, newest.path, 'and it is the newest run file')
  assert.equal(latest.report.baseSha, 'newest-and-well-formed')
  assert.equal(latest.report.green, true, 'the report comes back parsed through the shape, exactly as before')
})

// ── the no-self-judge rule at verify-complete (17.2) ─────────────────────────────────

/** A phase file as a delegated lane leaves it: `executionResult.driver` stamped at completion,
 *  both scopes declared, and `gateRounds` mirroring the report's rounds so the pre-existing
 *  count/scope clauses stay silent — the ONLY variable under test is reviewer INDEPENDENCE. */
const lanePhase = (lane, over = {}) => ({
  phase: 1670,
  testScope: 'relevant',
  reviewScope: 'full',
  gateRounds: [],
  executionResult: { phase: 1670, status: 'done', driver: { model: 'gpt-5.4-codex', lane } },
  ...over,
})

/** A phase/report pair that agrees on everything except who reviewed. `agents` are report-side
 *  rounds (round defaults to 1); the phase's gateRounds are derived from the same list, because
 *  a mismatched count would red the pair through the OLD clause and prove nothing about 17.2. */
const laneCase = (lane, agents, { phase: phaseOver = {}, report: reportOver = {} } = {}) => ({
  phase: lanePhase(lane, {
    gateRounds: agents.map((a) => ({ round: a.round ?? 1, agent: a.agent })),
    ...phaseOver,
  }),
  report: baseReport({
    startedAt: INDEPENDENT_REVIEW_ENFORCEMENT_AT,
    testScope: { derived: 'relevant', declared: 'relevant', effective: 'relevant' },
    reviewScope: { derived: 'full', declared: 'full', effective: 'full' },
    agents: agents.map((a) => ({ round: 1, verdict: 'clean', summary: 's', recordedAt: 't', ...a })),
    ...reportOver,
  }),
})

/** The refusal must be ONE problem, and it must be THIS one. Asserted as a single entry rather
 *  than "some problem matches": a fixture that also trips the count or scope clause would pass a
 *  substring check while sending the driver to fix the wrong thing. */
const assertRefusedForSelfJudge = (result, why) => {
  assert.equal(result.ok, false, `${why}: the delegated completion must be REFUSED`)
  assert.equal(
    result.problems.length,
    1,
    `${why}: exactly one problem — the independence rule alone (got: ${JSON.stringify(result.problems)})`,
  )
  const [p] = result.problems
  // The rule it broke: a driver may not be its own reviewer.
  assert.match(p, /self-review|self-judge/, `${why}: the problem names the no-self-judge rule (got: ${p})`)
  assert.match(p, /independent/, `${why}: the problem says what is missing — an independent recorded round (got: ${p})`)
  // The remedy, spelled as the command that fixes it — a refusal with no exit is a dead end.
  assert.match(p, /gate run[\s\S]*--record-round/, `${why}: the problem names the \`gate run <N> --record-round\` remedy (got: ${p})`)
}

test('checkPhaseConsistency — a codex-lane completion with no independent recorded round is REFUSED', () => {
  // atlas 33: done flipped with agents:[] — 0 rounds recorded on BOTH sides, so the count clause
  // reads "consistent" and nothing else ever looked.
  const none = laneCase('codex', [])
  assertRefusedForSelfJudge(checkPhaseConsistency(none.phase, none.report), 'codex lane, zero recorded rounds')

  // mudarabah2 720: a single self-review round — recorded honestly, and still the driver's own
  // opinion of its own work.
  const selfOnly = laneCase('codex', [{ agent: 'self-review' }])
  assertRefusedForSelfJudge(checkPhaseConsistency(selfOnly.phase, selfOnly.report), 'codex lane, one self-review round')

  // More self-review does not add independence.
  const selfTwice = laneCase('codex', [{ agent: 'self-review' }, { agent: 'self-review', round: 2 }])
  assertRefusedForSelfJudge(checkPhaseConsistency(selfTwice.phase, selfTwice.report), 'codex lane, two self-review rounds')

  // The report side's `agent` is a free string, so the pre-17.1 laundered spellings must not
  // buy independence just by not matching the enum member exactly.
  for (const laundered of ['codex-self-review', 'self-review (driver)', 'Self-Review', 'self review', 'self_review', 'selfreview']) {
    const c = laneCase('codex', [{ agent: laundered }])
    assertRefusedForSelfJudge(checkPhaseConsistency(c.phase, c.report), `codex lane, legacy free-string '${laundered}'`)
  }
})

test('checkPhaseConsistency — one independent recorded round clears the codex lane', () => {
  const reviewed = laneCase('codex', [{ agent: 'code-reviewer' }])
  assert.deepEqual(
    checkPhaseConsistency(reviewed.phase, reviewed.report).problems,
    [],
    'a codex phase with one independent code-reviewer round is clean',
  )

  // One independent round is the bar — a self-review round alongside it is honest record, not a
  // disqualification.
  const mixed = laneCase('codex', [{ agent: 'self-review' }, { agent: 'code-reviewer', round: 2 }])
  assert.equal(checkPhaseConsistency(mixed.phase, mixed.report).ok, true, 'self-review + one independent round is clean')
})

test('checkPhaseConsistency — the no-self-judge rule is lane-scoped and waived when review scope is none', () => {
  // An inline session reviewing its own work is the pre-existing, documented boundary: the rule
  // keys on the DELEGATED lane.
  const session = laneCase('session', [{ agent: 'self-review' }])
  assert.equal(checkPhaseConsistency(session.phase, session.report).ok, true, 'session lane, self-review only, is clean')

  // Declared reviewScope none: the phase was ratified pre-queue as owing no review, so demanding
  // an independent reviewer would refuse a completion for lacking a round nobody ever planned.
  const declaredNone = laneCase('codex', [], {
    phase: { reviewScope: 'none' },
    report: { reviewScope: { derived: 'none', declared: 'none', effective: 'none' } },
  })
  assert.deepEqual(
    checkPhaseConsistency(declaredNone.phase, declaredNone.report).problems,
    [],
    'codex + DECLARED reviewScope none is clean',
  )

  // Undeclared, but the ladder DERIVED none (a docs-only diff): the report is already in hand at
  // this seam, so keying on the declared field alone would refuse a phase the ladder itself waived.
  const derivedNone = laneCase('codex', [], {
    phase: { reviewScope: undefined },
    report: { reviewScope: { derived: 'none', declared: null, effective: 'none' } },
  })
  assert.deepEqual(
    checkPhaseConsistency(derivedNone.phase, derivedNone.report).problems,
    [],
    'codex + undeclared scope whose report effective is none is clean',
  )

  // The positive controls, LAST so every clean direction above is actually asserted: the same
  // records with the exemption removed are refused. Without them, "clean" three times over could
  // simply mean the rule never fires at all.
  const sameUnderCodex = laneCase('codex', [{ agent: 'self-review' }])
  assert.equal(
    checkPhaseConsistency(sameUnderCodex.phase, sameUnderCodex.report).ok,
    false,
    'control: the session record under lane codex IS refused (the clean above is the lane key, not a dead rule)',
  )
  const scopeFull = laneCase('codex', [])
  assert.equal(
    checkPhaseConsistency(scopeFull.phase, scopeFull.report).ok,
    false,
    'control: zero rounds under reviewScope full IS refused (the waivers are the scope value, not the empty agents[])',
  )
})

test('checkPhaseConsistency — only phases completed before enforcement keep historical reports as evidence', () => {
  for (const agents of [[], [{ agent: 'self-review' }]]) {
    const historical = laneCase('codex', agents, {
      phase: { completedDate: '2026-08-31' },
      report: { startedAt: '2026-09-01T07:30:26.999Z' },
    })
    assert.equal(checkPhaseConsistency(historical.phase, historical.report).ok, true, 'pre-cutoff codex evidence is not retroactively refused')
  }

  const unfinishedWithOldReport = laneCase('codex', [{ agent: 'self-review' }], {
    report: { startedAt: '2026-09-01T07:30:26.999Z' },
  })
  assertRefusedForSelfJudge(
    checkPhaseConsistency(unfinishedWithOldReport.phase, unfinishedWithOldReport.report),
    'a new completion cannot inherit an old report waiver',
  )

  const boundary = laneCase('codex', [{ agent: 'self-review' }], {
    report: { startedAt: INDEPENDENT_REVIEW_ENFORCEMENT_AT },
  })
  assertRefusedForSelfJudge(checkPhaseConsistency(boundary.phase, boundary.report), 'exactly-at-cutoff self-review')

  const reviewed = laneCase('codex', [{ agent: 'code-reviewer' }], {
    report: { startedAt: '2026-09-01T07:30:27.001Z' },
  })
  assert.equal(checkPhaseConsistency(reviewed.phase, reviewed.report).ok, true, 'post-cutoff independent review is clean')
})
