#!/usr/bin/env node
/**
 * Fixtures for the NEW validate surface (the ported rules stay covered by the UNMODIFIED
 * bin/validate-roadmap-file.test.mjs — no duplicate fixtures here): the gate-report
 * done-flip consistency rule (four clauses + green pass + no-dir pass) and the
 * `roadmap phase validate` CLI exit mapping. Driven through the real bin over tmp git
 * repos with plain-object phase files. Run: node --test cli/lib/validate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeReport, gateDir } from './gate-report.mjs'
import { validateRoadmapFile } from './validate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'zr-validate-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'ignore' })
  return root
}
function writePhase(root, num, obj) {
  writeFileSync(join(root, 'roadmap', 'phases', `phase-${num}.phase.ts`), `export default ${JSON.stringify(obj, null, 2)}\n`)
  return join(root, 'roadmap', 'phases', `phase-${num}.phase.ts`)
}
function validate(root, num) {
  try {
    execFileSync('node', [BIN, 'phase', 'validate', String(num)], { cwd: root, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stderr: '' }
  } catch (err) {
    return { code: err.status ?? 1, stderr: (err.stderr ?? '').toString() }
  }
}

const report = (num, over = {}) => ({
  phase: num,
  startedAt: '2026-07-16T10:00:00.000Z',
  baseSha: 'abc',
  mode: 'arc',
  kind: 'logic',
  testScope: { derived: 'relevant', declared: 'relevant', effective: 'relevant' },
  reviewScope: { derived: 'full', declared: 'full', effective: 'full' },
  slots: [{ slot: 'types', command: 'true', exitCode: 0, durationMs: 1, logPath: null }],
  agents: [{ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: '0 findings', recordedAt: 't' }],
  green: true,
  notes: [],
  ...over,
})
const donePhase = (num, over = {}) => ({
  phase: num,
  status: 'done',
  testScope: 'relevant',
  reviewScope: 'full',
  gateRounds: [{ round: 0 }, { round: 1 }],
  tasks: [{ id: `${num}.1`, done: true }],
  ...over,
})

test('done-flip rule — a done phase with NO .gate dir keeps today\'s behavior (exit 0)', () => {
  const root = makeRepo()
  writePhase(root, 2000, donePhase(2000))
  assert.equal(validate(root, 2000).code, 0)
})

test('done-flip rule — a done phase with a GREEN coherent report passes (exit 0)', () => {
  const root = makeRepo()
  writePhase(root, 2001, donePhase(2001))
  writeReport(root, report(2001))
  assert.equal(validate(root, 2001).code, 0)
})

test('done-flip rule — a NOT-GREEN latest report fails exit 2 naming the rule + report path', () => {
  const root = makeRepo()
  writePhase(root, 2002, donePhase(2002))
  const { path } = writeReport(root, report(2002, { green: false }))
  const r = validate(root, 2002)
  assert.equal(r.code, 2)
  assert.match(r.stderr, /done-without-green-gate-report/)
  assert.match(r.stderr, /not green/)
  assert.ok(r.stderr.includes(path.split('/').pop()), 'names the report file')
})

test('done-flip rule — a SCOPE mismatch and a gateRounds-count mismatch each fail exit 2', () => {
  const scopeRepo = makeRepo()
  writePhase(scopeRepo, 2003, donePhase(2003))
  writeReport(scopeRepo, report(2003, { reviewScope: { derived: 'full', declared: 'light', effective: 'light' } }))
  const scope = validate(scopeRepo, 2003)
  assert.equal(scope.code, 2)
  assert.match(scope.stderr, /scope mismatch/)

  const roundRepo = makeRepo()
  writePhase(roundRepo, 2004, donePhase(2004))
  writeReport(roundRepo, report(2004, { agents: [] })) // 0 rounds vs phase's 1 → mismatch
  const rounds = validate(roundRepo, 2004)
  assert.equal(rounds.code, 2)
  assert.match(rounds.stderr, /gateRounds count mismatch/)
})

test('CLI exit mapping — a done-with-open-task fixture exits 2; its corrected twin exits 0', () => {
  const root = makeRepo()
  writePhase(root, 2005, donePhase(2005, { tasks: [{ id: '2005.1', done: true }, { id: '2005.2', done: false }] }))
  const bad = validate(root, 2005)
  assert.equal(bad.code, 2)
  assert.match(bad.stderr, /done-with-open-task/)
  // corrected twin — all tasks done, no gate dir → clean
  writePhase(root, 2005, donePhase(2005, { tasks: [{ id: '2005.1', done: true }, { id: '2005.2', done: true }] }))
  assert.equal(validate(root, 2005).code, 0)
})

test('validateRoadmapFile — strict flag returns kind ok on a valid file (engine reused, no process.exit)', () => {
  const root = makeRepo()
  const p = writePhase(root, 2006, { phase: 2006, status: 'backlog', tasks: [] })
  const res = validateRoadmapFile(p, { strict: true })
  assert.equal(res.kind, 'ok')
  assert.equal(res.ok, true)
})

// ── the corrupt-latest-report lane (phase 9.2) ───────────────────────────────────────
//
// The done-flip rule reads the phase's newest gate report through latestReport(), which
// answers `null` both for "no report" and for "the newest run file cannot be read" — and the
// rule's `if (!latest) return []` then treats the second as the first. A done phase whose
// only evidence is a corrupt run file therefore validates CLEAN: the one guard that exists to
// stop a narrated done flip goes silent exactly when the evidence stopped being readable.
// The rule must instead REPORT it — a finding naming the file and why it could not be read —
// and it must not crash validation to do so (an exception here would surface as exit 1, the
// usage/toolchain lane, and read as a broken validator rather than a broken report).

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

test('phase validate — corrupt newest gate report is a named finding, never a silent pass', () => {
  const root = makeRepo()
  const phaseFile = writePhase(root, 2007, donePhase(2007))
  // An OLDER green, coherent report: on its own this phase validates clean, so the ONLY
  // difference between the two halves of this test is the unreadable newest file. A rule that
  // fell back to the newest READABLE report would pass here — certifying a done flip from a
  // report that is no longer the record.
  const { path: olderPath } = writeReport(root, report(2007))
  const body = '{ "phase": 2007, "green": tru }\n'
  const corruptPath = writeNewestRun(root, 2007, body)
  let parseDetail = null
  try {
    JSON.parse(body)
  } catch (e) {
    parseDetail = e.message
  }
  assert.ok(parseDetail, 'fixture bug: the corrupt body must not parse')

  const res = validateRoadmapFile(phaseFile)

  assert.equal(res.kind, 'errors', `an unreadable gate report is a FINDING, not a pass and not a crash (got kind ${res.kind})`)
  const finding = res.errors.find((e) => e.rule === 'done-without-green-gate-report')
  assert.ok(
    finding,
    `the done-flip rule must fire: a done phase whose newest report cannot be read has no readable green evidence (got ${JSON.stringify(res.errors)})`,
  )
  assert.ok(finding.msg.includes(corruptPath), `the finding NAMES the unreadable run file (got: ${finding.msg})`)
  assert.ok(
    finding.msg.includes(parseDetail),
    `and carries WHY it could not be read — '${parseDetail}' (got: ${finding.msg})`,
  )
  assert.equal(
    finding.msg.includes(olderPath),
    false,
    'the finding is about the newest report, not the older one the rule declined to fall back to',
  )

  // The CLI face: exit 2 (check failed), never 1 (a thrown error would land there) and never 0.
  const r = validate(root, 2007)
  assert.equal(r.code, 2, `the corrupt report reds the phase; stderr: ${r.stderr}`)
  assert.match(r.stderr, /done-without-green-gate-report/)
  assert.ok(r.stderr.includes(corruptPath), `stderr names the file too; stderr: ${r.stderr}`)
  assert.equal(readFileSync(corruptPath, 'utf8'), body, 'validation never repairs or rewrites the evidence it read')

  // Positive control: make the newest report readable and coherent → clean again, exit 0.
  writeFileSync(corruptPath, readFileSync(olderPath, 'utf8'))
  assert.equal(validate(root, 2007).code, 0, 'the ONLY thing this phase was red for was the unreadable report')
})
