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
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GateRunReportShape,
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
