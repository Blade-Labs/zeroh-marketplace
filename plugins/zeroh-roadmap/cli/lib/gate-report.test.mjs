#!/usr/bin/env node
/**
 * Fixtures for cli/lib/gate-report.mjs (the module; command flows live in gate.test.mjs):
 * shape parse/reject, the self-gitignore written once, latestReport picks the newest run,
 * writeReport retention (a 6th write leaves exactly the newest 5), and
 * checkPhaseConsistency clause-by-clause. Run: node --test cli/lib/gate-report.test.mjs
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
