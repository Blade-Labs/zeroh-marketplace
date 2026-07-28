#!/usr/bin/env node
/**
 * Fixtures for `roadmap eval record-sweep` + `record-verdicts` — driven through the REAL
 * bin/roadmap.mjs (also proving dispatch registration) against a tmp git-inited consumer
 * whose lib/roadmap/schema.ts re-exports the REAL templates/schema.ts, with a
 * node_modules/zod symlink so the tsx bridge resolves the consumer's own zod.
 *
 * What is pinned: the archive PATH (roadmap/arc-evals/<ARCID>-<date>-<suffix>.json, date off
 * the DOCUMENT not wall-clock), the document round-trip on disk, and the three-way exit-code
 * contract that must never blur — 0 written · 1 usage/toolchain · 2 refused (mis-shape,
 * arcId/--arc mismatch, existing path without --force). Refusals are also pinned to leave
 * NO file behind and to surface a Zod issue line rather than a raw stack. Both input lanes
 * are exercised: the positional file arg and a genuine stdin pipe (what the skills use).
 *
 * The second section covers the bare `roadmap eval <ARCID>` run (collect → score → ratchet →
 * dated report + regenerated timing-stats), driven against the SHARED arc-eval fixture corpus
 * (cli/testdata/eval-arc/build-fixture.mjs) rather than an empty tmp repo, so the wiring is
 * proven over real phase files, real gate records and a real git history. Run:
 * node --test cli/commands/eval.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bridgeEval } from '../lib/tsx-bridge.mjs'
import { buildEvalFixture, ARC_ID } from '../testdata/eval-arc/build-fixture.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..', '..')
const BIN = join(PLUGIN_ROOT, 'bin', 'roadmap.mjs')
const SCHEMA = join(PLUGIN_ROOT, 'templates', 'schema.ts')
const PLUGIN_ZOD = realpathSync(join(PLUGIN_ROOT, 'node_modules', 'zod'))

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

/** A git-inited tmp consumer with the re-export schema + a zod symlink. */
function makeConsumer() {
  const root = mkdtempSync(join(tmpdir(), 'zr-eval-'))
  bases.push(root)
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  writeFileSync(join(root, 'lib', 'roadmap', 'schema.ts'), `export * from '${SCHEMA}'\n`)
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(PLUGIN_ZOD, join(root, 'node_modules', 'zod'), 'dir')
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' })
  git('init', '-q')
  return root
}

/** Drive bin/roadmap.mjs with cwd = the consumer; return { code, stdout, stderr }. */
function roadmap(root, args, input) {
  const stdio = input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe']
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      stdio,
      ...(input === undefined ? {} : { input }),
    })
    return { code: 0, stdout, stderr: '' }
  } catch (err) {
    return { code: err.status ?? 1, stdout: (err.stdout ?? '').toString(), stderr: (err.stderr ?? '').toString() }
  }
}

const ARC = 'TESTARC'
const DATE = '2026-07-27'
const outPath = (root, suffix) => join(root, 'roadmap', 'arc-evals', `${ARC}-${DATE}-${suffix}.json`)

const validSweep = {
  arcId: ARC,
  date: DATE,
  estateRatchets: 'green',
  phaseGates: [{ phase: 9001, done: true, gateGreen: true }],
  debtDispositions: [{ item: 'a named compromise', disposition: 'ACCEPT', ref: 'phase 9001' }],
  architectVerdict: 'no designRefs',
  deferredToReleaseSweep: [],
  overall: 'green',
  blockers: [],
}

const validVerdicts = {
  arcId: ARC,
  date: DATE,
  judgeModel: 'claude-sonnet-5',
  verdicts: [
    {
      criterionId: 'ac-1',
      status: 'met',
      tierUsed: 'wired',
      evidence: 'observed the CLI write the dated file',
      confidence: 'high',
    },
  ],
}

/** Write a document into the consumer root and hand back its path (the file lane). */
function docFile(root, name, doc) {
  const f = join(root, name)
  writeFileSync(f, JSON.stringify(doc))
  return f
}

test('record-sweep — a valid report writes the dated archive file and round-trips (exit 0)', () => {
  const root = makeConsumer()
  const f = docFile(root, 'sweep.json', validSweep)
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, f])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const path = outPath(root, 'sweep')
  assert.ok(existsSync(path), `expected the archive at ${path}`)
  assert.match(r.stdout, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'stdout names the written path')

  const raw = readFileSync(path, 'utf8')
  assert.ok(raw.endsWith('}\n'), 'pretty-printed with a trailing newline')
  const onDisk = JSON.parse(raw)
  assert.equal(onDisk.arcId, ARC)
  assert.equal(onDisk.date, DATE)
  assert.equal(onDisk.overall, 'green')
  assert.equal(onDisk.architectVerdict, 'no designRefs')
  assert.deepEqual(onDisk.debtDispositions, [
    { item: 'a named compromise', disposition: 'ACCEPT', ref: 'phase 9001' },
  ])
  assert.deepEqual(onDisk.phaseGates, [{ phase: 9001, done: true, gateGreen: true }])
})

test('record-verdicts — the document PIPED ON STDIN writes the verdicts archive (exit 0)', () => {
  const root = makeConsumer()
  // The stdin lane is what the skills use, so it is proven end-to-end here rather than
  // assumed from the file lane.
  const r = roadmap(root, ['eval', 'record-verdicts', '--arc', ARC], JSON.stringify(validVerdicts))
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const path = outPath(root, 'verdicts')
  assert.ok(existsSync(path), `expected the archive at ${path}`)
  const onDisk = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(onDisk.judgeModel, 'claude-sonnet-5')
  assert.equal(onDisk.arcId, ARC)
  assert.equal(onDisk.verdicts.length, 1)
  assert.equal(onDisk.verdicts[0].criterionId, 'ac-1')
  assert.equal(onDisk.verdicts[0].tierUsed, 'wired')
})

test('record-sweep — an unknown disposition token is REFUSED (exit 2), named, and writes nothing', () => {
  const root = makeConsumer()
  const bad = {
    ...validSweep,
    debtDispositions: [{ item: 'a named compromise', disposition: 'MAYBE-LATER', ref: 'phase 9001' }],
  }
  const f = docFile(root, 'bad.json', bad)
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, f])
  assert.equal(r.code, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /debtDispositions\.0\.disposition: .+/, 'the Zod issue path is printed')
  // A refusal must read as a refusal, not as a crash leaking the recorder's internals.
  assert.doesNotMatch(r.stderr, /at .*\n.*at /, 'no raw node stack trace')
  assert.equal(existsSync(outPath(root, 'sweep')), false, 'a refused document never reaches disk')
  assert.equal(existsSync(join(root, 'roadmap', 'arc-evals')), false, 'no archive dir minted on refusal')
})

test('record-sweep — re-recording an existing path WITHOUT --force is refused; bytes unchanged', () => {
  const root = makeConsumer()
  const first = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, docFile(root, 'sweep.json', validSweep)])
  assert.equal(first.code, 0, first.stderr)
  const path = outPath(root, 'sweep')
  const before = readFileSync(path, 'utf8')

  const changed = { ...validSweep, architectVerdict: 'SECOND PASS VERDICT' }
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, docFile(root, 'sweep2.json', changed)])
  assert.equal(r.code, 2, r.stdout + r.stderr)
  assert.match(r.stderr, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'stderr names the existing path')
  assert.equal(readFileSync(path, 'utf8'), before, 'the recorded history is byte-for-byte untouched')
  assert.match(before, /"no designRefs"/)
})

test('record-sweep — the same re-record WITH --force overwrites and says so', () => {
  const root = makeConsumer()
  const first = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, docFile(root, 'sweep.json', validSweep)])
  assert.equal(first.code, 0, first.stderr)
  const path = outPath(root, 'sweep')

  const changed = { ...validSweep, architectVerdict: 'SECOND PASS VERDICT', overall: 'blocked', blockers: ['open gap'] }
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, '--force', docFile(root, 'sweep2.json', changed)])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /OVERWROTE/, 'an overwrite is loud, never silent')

  const onDisk = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(onDisk.architectVerdict, 'SECOND PASS VERDICT')
  assert.equal(onDisk.overall, 'blocked')
  assert.deepEqual(onDisk.blockers, ['open gap'])
})

test('record-sweep — --arc disagreeing with the document arcId is refused (exit 2), no file written', () => {
  const root = makeConsumer()
  const f = docFile(root, 'sweep.json', validSweep)
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', 'OTHER', f])
  assert.equal(r.code, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /TESTARC.*OTHER/, 'the mismatch names both sides')
  assert.equal(existsSync(join(root, 'roadmap', 'arc-evals', `OTHER-${DATE}-sweep.json`)), false)
  assert.equal(existsSync(outPath(root, 'sweep')), false)
})

test('record-sweep — a missing --arc is USAGE (exit 1), not a refusal (exit 2)', () => {
  const root = makeConsumer()
  const f = docFile(root, 'sweep.json', validSweep)
  const r = roadmap(root, ['eval', 'record-sweep', f])
  // The codes carry meaning downstream: 1 = the caller invoked it wrong, 2 = the document
  // was rejected. Collapsing them would make a malformed aggregate look like a typo.
  assert.equal(r.code, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /--arc/)
  assert.equal(existsSync(outPath(root, 'sweep')), false)
})

// ══ `roadmap eval <ARCID>` — collect → score → ratchet → dated report ══════════════════
// Same driver as above (the REAL bin, so dispatch registration is proven), but the consumer
// is the SHARED arc-eval fixture corpus: a scripted git history, real phase files, real gate
// run records and the dated sweep/verdicts artifacts. What is pinned here is the WIRING and
// the honesty rails the recorders already hold — the scoring arithmetic itself belongs to
// cli/lib/eval-score.test.mjs and is deliberately not restated.
//
// Roots: read-only runs share a memoized fixture (a fixture costs a git script plus tsx
// bridge reads); every test that WRITES into roadmap/arc-evals/ builds a fresh one, because
// a report or a planted prior left behind would silently become the next test's baseline.

const EVAL_KEYS = [
  'code-confidence',
  'verified-vs-intent',
  'standards-adherence',
  'doc-brevity',
  'composability-testability',
  'speed',
  'plan-quality',
]
const EVAL_DETERMINISTIC_KEYS = ['code-confidence', 'verified-vs-intent', 'speed']
const EVAL_JUDGE_KEYS = ['standards-adherence', 'doc-brevity', 'composability-testability', 'plan-quality']

const evalFixtureMemo = new Map()
/** A SHARED fixture root — only for runs that write nothing into the repo. */
const sharedFixture = (opts = {}) => {
  const key = JSON.stringify(opts)
  if (!evalFixtureMemo.has(key)) evalFixtureMemo.set(key, buildEvalFixture(opts))
  return evalFixtureMemo.get(key)
}

const evalsDir = (root) => join(root, 'roadmap', 'arc-evals')
const reportPath = (root, date) => join(evalsDir(root), `${ARC_ID}-${date}.json`)
const timingPath = (root) => join(evalsDir(root), 'timing-stats.json')
const readReport = (root, date) => JSON.parse(readFileSync(reportPath(root, date), 'utf8'))

/**
 * Validate a document against the CONSUMER's shape the way production does: through the tsx
 * bridge into the fixture repo's own lib/roadmap/schema.ts. A structural check in this file
 * would only prove the test author's belief about the contract. (Idiom copied from
 * cli/lib/eval-collect.test.mjs's parsesArcTraceShape, generalized over the shape name.)
 */
function parsesConsumerShape(root, shapeName, doc) {
  const jsonPath = join(root, `shape-under-test-${shapeName}.json`)
  writeFileSync(jsonPath, JSON.stringify(doc))
  const schema = join(root, 'lib', 'roadmap', 'schema.ts')
  const script = `import('${schema}').then(async (M) => {
    const S = M.default ?? M
    const { readFileSync } = await import('node:fs')
    const r = S.${shapeName}.safeParse(JSON.parse(readFileSync('${jsonPath}', 'utf8')))
    process.stdout.write(r.success ? 'SHAPE_OK' : 'SHAPE_BAD:' + JSON.stringify(r.error.issues))
  }).catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(9) })`
  const res = bridgeEval(root, script)
  if (!res.ok) return { ok: false, detail: res.stderr }
  return res.stdout.includes('SHAPE_OK') ? { ok: true, detail: '' } : { ok: false, detail: res.stdout.slice(0, 2000) }
}

/**
 * A minimal VALID ArcEvalReport, planted as a prior so the ratchet has a baseline.
 * `per` overrides a dimension's score; everything else takes `all`. Written under the dated
 * REPORT name, which is the only prior form the ratchet may read.
 */
function plantPrior(root, date, { all = 60, per = {}, judgeModel = 'judge-A' } = {}) {
  const dimensions = {}
  for (const key of EVAL_KEYS) {
    const score = Object.prototype.hasOwnProperty.call(per, key) ? per[key] : all
    dimensions[key] = {
      owner: EVAL_JUDGE_KEYS.includes(key) ? 'judge' : 'deterministic',
      score,
      signals: { synthetic: score },
      sourceRefs: ['planted-prior'],
    }
  }
  const doc = {
    arcId: ARC_ID,
    date,
    judgeModel,
    dimensions,
    ratchet: [],
    attribution: { drivers: [], reviewers: [] },
    notes: [],
  }
  mkdirSync(evalsDir(root), { recursive: true })
  const p = join(evalsDir(root), `${ARC_ID}-${date}.json`)
  writeFileSync(p, JSON.stringify(doc, null, 2) + '\n')
  return p
}

const ratchetRow = (report, dimension) => report.ratchet.find((r) => r.dimension === dimension)
/** The convention eval-score.test.mjs pinned: a row with a baseline names `samples=<n>`. */
function samplesOf(row) {
  assert.equal(typeof row.note, 'string', `${row?.dimension}: a row with a baseline carries a note`)
  const m = row.note.match(/samples=(\d+)/)
  assert.ok(m, `${row.dimension}: expected samples=<n> in the note; got ${JSON.stringify(row.note)}`)
  return Number(m[1])
}

const EVAL_DATE = '2026-07-25'

// ── 1. end to end ─────────────────────────────────────────────────────────────────────
test('eval <ARCID> — writes the dated report with all seven dimensions, three scored and four pending-judge', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(reportPath(root, EVAL_DATE)), `expected the report at ${reportPath(root, EVAL_DATE)}`)

  const report = readReport(root, EVAL_DATE)
  assert.equal(report.arcId, ARC_ID)
  assert.equal(report.date, EVAL_DATE, 'the report is dated by the flag, not by a second wall-clock read')
  assert.deepEqual(Object.keys(report.dimensions).sort(), [...EVAL_KEYS].sort(), 'exactly the seven closed keys')

  for (const key of EVAL_DETERMINISTIC_KEYS) {
    const d = report.dimensions[key]
    assert.equal(typeof d.score, 'number', `${key} is deterministic — it must carry a real number`)
    assert.equal(d.sentinel, undefined, `${key} has every input it needs in this fixture`)
  }
  for (const key of EVAL_JUDGE_KEYS) {
    const d = report.dimensions[key]
    assert.equal(d.sentinel, 'pending-judge', `${key} awaits the judge pass`)
    assert.equal(d.score, undefined, `${key} must not carry a CLI-invented number`)
    assert.notEqual(d.score, 0, `${key} must sentinel, never zero — a zero reads as a real, terrible arc`)
  }

  assert.equal(report.ratchet.length, 7, 'one ratchet row per dimension, always — a missing row reads as "not regressed"')
  const unrecorded = report.attribution.drivers.find((d) => d.model === 'unrecorded')
  assert.ok(
    unrecorded,
    `the fixture's driver-less phase must land as the literal 'unrecorded'; got ${JSON.stringify(report.attribution.drivers)}`,
  )
})

// ── 2. the written report really parses the consumer contract ─────────────────────────
test('eval <ARCID> — the file on disk satisfies the CONSUMER ArcEvalReportShape through the tsx bridge', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const res = parsesConsumerShape(root, 'ArcEvalReportShape', readReport(root, EVAL_DATE))
  assert.equal(res.ok, true, `the persisted report must satisfy ArcEvalReportShape; got: ${res.detail}`)
})

// ── 3. idempotence — the reproducibility bar ──────────────────────────────────────────
test('eval <ARCID> — a second run at the same --date is BYTE-IDENTICAL with --force, refused without it', () => {
  const root = buildEvalFixture()
  const first = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(first.code, 0, first.stdout + first.stderr)
  const before = readFileSync(reportPath(root, EVAL_DATE), 'utf8')

  const refused = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(refused.code, 2, refused.stdout + refused.stderr)
  assert.match(
    refused.stderr,
    new RegExp(reportPath(root, EVAL_DATE).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the refusal names the path it will not clobber',
  )
  assert.equal(readFileSync(reportPath(root, EVAL_DATE), 'utf8'), before, 'a refused re-run leaves the first report untouched')

  const forced = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE, '--force'])
  assert.equal(forced.code, 0, forced.stdout + forced.stderr)
  // Byte-identity also pins that the run does NOT ratchet against its OWN previous report:
  // a re-run that read its predecessor as a prior would produce a different ratchet table.
  assert.equal(
    readFileSync(reportPath(root, EVAL_DATE), 'utf8'),
    before,
    'the same inputs and the same date must reproduce the same bytes',
  )
})

// ── 4. the regenerated projection ─────────────────────────────────────────────────────
test('eval <ARCID> — timing-stats.json is regenerated, parses TimingStatsShape, and names its heuristic', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(timingPath(root)), `expected the projection at ${timingPath(root)}`)

  const stats = JSON.parse(readFileSync(timingPath(root), 'utf8'))
  const res = parsesConsumerShape(root, 'TimingStatsShape', stats)
  assert.equal(res.ok, true, `the projection must satisfy TimingStatsShape; got: ${res.detail}`)
  assert.ok(stats.cohorts.length >= 1, 'the fixture arc has timed phases — the table must not be empty')
  assert.ok(
    stats.notes.some((n) => /heuristic/i.test(n)),
    `the surface axis is a path guess and must SAY so; got ${JSON.stringify(stats.notes)}`,
  )
})

// ── 5. a corrupted prior is skipped BY NAME, never silently ───────────────────────────
test('eval <ARCID> — an unparseable prior report WARNs by filename and never becomes a baseline', () => {
  const root = buildEvalFixture()
  mkdirSync(evalsDir(root), { recursive: true })
  const corruptName = `${ARC_ID}-2026-07-01.json`
  writeFileSync(join(evalsDir(root), corruptName), '{"broken":')
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, `one bad prior must not fail the run: ${r.stdout + r.stderr}`)
  const out = r.stdout + r.stderr
  assert.match(out, new RegExp(`WARN[\\s\\S]{0,200}${corruptName.replace(/\./g, '\\.')}`), 'the skipped file is named in a WARN')

  // The two readable priors still formed the baseline: a corrupt file that had been read as
  // an empty/zero report would show up here as a third sample or a collapsed baseline.
  const row = ratchetRow(readReport(root, EVAL_DATE), 'code-confidence')
  assert.equal(samplesOf(row), 2, 'exactly the two VALID priors are the baseline')
  assert.equal(typeof row.baseline, 'number')
  assert.ok(row.baseline >= 60 && row.baseline <= 70, `the baseline is the mean of 60 and 70; got ${row.baseline}`)
})

// ── 6. the non-report siblings in the same directory ──────────────────────────────────
test('eval <ARCID> — the -sweep/-verdicts siblings and timing-stats.json are NOT priors', () => {
  const root = buildEvalFixture()
  // The fixture ships EVALFIX-2026-07-20-sweep.json, -verdicts.json and an earlier sweep;
  // they live in the same directory and match the same arc prefix.
  assert.ok(existsSync(join(evalsDir(root), `${ARC_ID}-2026-07-20-sweep.json`)), 'fixture precondition: the sweep sibling')
  assert.ok(existsSync(join(evalsDir(root), `${ARC_ID}-2026-07-20-verdicts.json`)), 'fixture precondition: the verdicts sibling')

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const out = r.stdout + r.stderr
  assert.doesNotMatch(out, /-sweep\.json/, 'a sweep record is not a report and must not be warned about as one')
  assert.doesNotMatch(out, /-verdicts\.json/, 'a verdicts record is not a report and must not be warned about as one')
  assert.doesNotMatch(out, /timing-stats\.json[^\n]*(WARN|parse)/i, 'the projection is not a prior report either')

  const row = ratchetRow(readReport(root, EVAL_DATE), 'code-confidence')
  assert.equal(row.baseline, null, 'no dated REPORT exists yet — the siblings must not manufacture a baseline')
  assert.equal(row.note, 'no-baseline', `got ${JSON.stringify(row.note)}`)
  assert.equal(row.regression, false, 'a baseline nobody can compute is never a regression')
})

// ── 7. --collect-only ─────────────────────────────────────────────────────────────────
test('eval <ARCID> --collect-only — writes NOTHING and, with --json, emits the trace on stdout', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE, '--collect-only'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.equal(existsSync(reportPath(root, EVAL_DATE)), false, '--collect-only stops before the report')
  assert.equal(existsSync(timingPath(root)), false, '--collect-only regenerates no projection either')

  const j = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE, '--collect-only', '--json'])
  assert.equal(j.code, 0, j.stdout + j.stderr)
  const trace = JSON.parse(j.stdout)
  assert.ok(Array.isArray(trace.phases) && trace.phases.length > 0, 'the emitted trace carries its phases')
  assert.equal(typeof trace.git, 'object', 'and the git facts the scorer reads')
  assert.equal(existsSync(reportPath(root, EVAL_DATE)), false, '--json does not smuggle a write back in')
})

// ── 8. --json on a full run ───────────────────────────────────────────────────────────
test('eval <ARCID> --json — stdout is the report JSON, parseable on its own', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE, '--json'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const report = JSON.parse(r.stdout)
  assert.ok(report.dimensions, 'the JSON lane carries the dimensions record')
  assert.deepEqual(Object.keys(report.dimensions).sort(), [...EVAL_KEYS].sort())
})

// ── 9. the printed summary ────────────────────────────────────────────────────────────
test('eval <ARCID> — stdout names every dimension and states plainly which ones await the judge', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  for (const key of EVAL_KEYS) assert.ok(r.stdout.includes(key), `stdout must name ${key}`)
  for (const key of EVAL_JUDGE_KEYS) {
    const line = r.stdout.split('\n').find((l) => l.includes(key) && /pending-judge/.test(l))
    assert.ok(line, `${key}'s line must show its sentinel, not a blank or a zero; stdout was:\n${r.stdout}`)
  }
  // One line that says WHICH dimensions are outstanding, so a reader never mistakes a
  // three-dimension report for a seven-dimension one.
  const awaits = r.stdout.split('\n').find((l) => /await/i.test(l))
  assert.ok(awaits, `stdout must carry a line saying the judge pass is outstanding; stdout was:\n${r.stdout}`)
  for (const key of EVAL_JUDGE_KEYS) assert.ok(awaits.includes(key), `the awaiting line must name ${key}; got ${awaits}`)
})

// ── 10. a regression is named ─────────────────────────────────────────────────────────
test('eval <ARCID> — a drop below the rolling baseline prints a REGRESSION line naming the dimension', () => {
  const root = buildEvalFixture()
  // Far above anything this fixture can score, so the current run is unambiguously a drop.
  plantPrior(root, '2026-07-02', { all: 60, per: { 'code-confidence': 99 } })
  plantPrior(root, '2026-07-03', { all: 60, per: { 'code-confidence': 98 } })

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const report = readReport(root, EVAL_DATE)
  assert.ok(
    report.dimensions['code-confidence'].score < 98,
    `fixture precondition: the current score must sit below the planted baseline; got ${report.dimensions['code-confidence'].score}`,
  )
  const row = ratchetRow(report, 'code-confidence')
  assert.equal(row.regression, true, 'the row itself must flag')
  assert.ok(row.delta < 0, 'a flagged regression always has a computable negative delta')

  const line = r.stdout.split('\n').find((l) => /REGRESSION/.test(l))
  assert.ok(line, `a regression must be shouted, not buried in the JSON; stdout was:\n${r.stdout}`)
  assert.ok(line.includes('code-confidence'), `the REGRESSION line must name the dimension; got ${line}`)
  // The dimensions that did NOT regress must not be dressed up as regressions.
  const shouted = r.stdout.split('\n').filter((l) => /REGRESSION/.test(l))
  assert.equal(shouted.length, 1, `exactly the one regressed dimension is shouted; got ${JSON.stringify(shouted)}`)
})

// ── 11. the one wall-clock mint is LOUD ───────────────────────────────────────────────
test('eval <ARCID> — an omitted --date defaults to today and SAYS so, naming the flag', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const now = new Date()
  // Either reading of "today" is acceptable; what is not acceptable is minting a date silently.
  const candidates = [now.toISOString().slice(0, 10), now.toLocaleDateString('sv-SE')]
  const today = candidates.find((d) => existsSync(reportPath(root, d)))
  assert.ok(today, `the report must land under today's date; looked for ${candidates.join(' or ')}`)

  const line = r.stdout.split('\n').find((l) => l.includes(today) && l.includes('--date'))
  assert.ok(
    line,
    `the defaulted date must be printed beside the --date flag that overrides it; stdout was:\n${r.stdout}`,
  )
})

// ── 12. an unknown arc ────────────────────────────────────────────────────────────────
test('eval <ARCID> — an arc with no arc file is REFUSED by name, not scored as an empty arc', () => {
  const root = sharedFixture()
  const r = roadmap(root, ['eval', 'NOSUCHARC', '--date', EVAL_DATE])
  assert.notEqual(r.code, 0, `a missing arc must never exit 0: ${r.stdout}`)
  assert.ok([1, 2].includes(r.code), `the three-way contract holds (got ${r.code})`)
  assert.match(r.stdout + r.stderr, /NOSUCHARC/, 'the refusal names the arc it could not find')
  // A stack frame is an INDENTED `at ` line. Matching a bare `at ` anywhere would fire on
  // any prose containing "that " — which is a test that fails on good English, not on a leak.
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'a refusal reads as a refusal, not a leaked stack')
  assert.equal(
    existsSync(join(evalsDir(root), `NOSUCHARC-${EVAL_DATE}.json`)),
    false,
    'a zero-phase report for an arc that does not exist would be fabricated data',
  )
})

// ── 13. discoverability ───────────────────────────────────────────────────────────────
test('roadmap --help — the eval entry advertises the bare-arc collect/score form', () => {
  const root = sharedFixture()
  const r = roadmap(root, ['--help'])
  assert.equal(r.code, 0, r.stderr)
  const line = r.stdout.split('\n').find((l) => /^\s*eval\b/.test(l))
  assert.ok(line, `--help must list eval; stdout was:\n${r.stdout}`)
  assert.match(line, /<arc/i, 'the bare-arcid subform is the one callers reach for — it must be shown')
  assert.match(line, /collect/i)
  assert.match(line, /score/i)
})

// ── 14. the recorders are not shadowed ────────────────────────────────────────────────
test('eval record-sweep — still works from the fixture root; the bare-arcid form shadows nothing', () => {
  const root = buildEvalFixture()
  // A bare positional that happens to look like an arc id must not swallow the two literal
  // subcommand names; this is the regression the new dispatch could most easily cause.
  const sweep = JSON.parse(readFileSync(join(evalsDir(root), `${ARC_ID}-2026-07-20-sweep.json`), 'utf8'))
  const f = docFile(root, 'resweep.json', { ...sweep, date: '2026-07-26' })
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', ARC_ID, f])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(join(evalsDir(root), `${ARC_ID}-2026-07-26-sweep.json`)), 'the recorder still lands its suffixed file')
})
