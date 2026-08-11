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
  readdirSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bridgeEval, TSX_ABSENT_HINT } from '../lib/tsx-bridge.mjs'
import { DECLARED_RESETS } from '../lib/eval-score.mjs'
import { SCORECARD_N_FLOOR } from '../lib/eval-scorecard.mjs'
import { readPriorReports } from './eval.mjs'
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
 *
 * `sentinels` names dimensions that carry an absence instead of a number (score XOR sentinel,
 * so the score is omitted, not zeroed); `ratchet` plants ratchet rows; `notes` plants the note
 * array a restamp then edits; `arcId`/`name` let a caller file the same document under another
 * arc or under a NON-report filename. Every knob defaults to today's behaviour, so every
 * pre-existing caller is untouched.
 */
function plantPrior(
  root,
  date,
  {
    all = 60,
    per = {},
    judgeModel = 'judge-A',
    sentinels = {},
    signals = {},
    notes = [],
    ratchet = [],
    arcId = ARC_ID,
    name,
  } = {},
) {
  const dimensions = {}
  for (const key of EVAL_KEYS) {
    const owner = EVAL_JUDGE_KEYS.includes(key) ? 'judge' : 'deterministic'
    if (Object.prototype.hasOwnProperty.call(sentinels, key)) {
      dimensions[key] = { owner, sentinel: sentinels[key], signals: {}, sourceRefs: ['planted-prior'] }
      continue
    }
    const score = Object.prototype.hasOwnProperty.call(per, key) ? per[key] : all
    dimensions[key] = {
      owner,
      score,
      // `signals` is per-dimension override territory: the declared-reset predicates read
      // signals, so a test about retirement has to be able to plant a pre-reset one.
      signals: { synthetic: score, ...(signals[key] ?? {}) },
      sourceRefs: ['planted-prior'],
    }
  }
  const doc = {
    arcId,
    date,
    judgeModel,
    dimensions,
    ratchet,
    attribution: { drivers: [], reviewers: [] },
    notes,
  }
  mkdirSync(evalsDir(root), { recursive: true })
  const p = join(evalsDir(root), name ?? `${arcId}-${date}.json`)
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

// ── gate R1: the baseline is CROSS-ARC ────────────────────────────────────────────────
test('eval <ARCID> — prior reports from OTHER arcs form the baseline (an arc lands once)', () => {
  const root = buildEvalFixture()
  // Two priors filed under a DIFFERENT arc id. Scoped to this arc alone there would be zero
  // comparable priors and every row would read no-baseline forever, so the PROVE stage would
  // never fire on a workflow where each arc lands exactly once.
  for (const [date, all] of [['2026-07-02', 60], ['2026-07-03', 70]]) {
    const p = plantPrior(root, date, { all })
    renameSync(p, join(evalsDir(root), `OTHERARC-${date}.json`))
  }

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const row = ratchetRow(readReport(root, EVAL_DATE), 'code-confidence')
  assert.equal(samplesOf(row), 2, 'both foreign-arc reports are part of the reference class')
  assert.ok(row.baseline >= 60 && row.baseline <= 70, `the mean of 60 and 70; got ${row.baseline}`)
})

// ── gate R1: a mis-shaped artifact is refused at the trace boundary ────────────────────
test('eval <ARCID> — a well-formed-JSON but MIS-SHAPED verdicts artifact is REFUSED, not scored', () => {
  const root = buildEvalFixture()
  const vp = join(evalsDir(root), `${ARC_ID}-2026-07-20-verdicts.json`)
  const doc = JSON.parse(readFileSync(vp, 'utf8'))
  // Valid JSON, invalid contract: the tier is not a member of the closed enum. Without the
  // trace parse this would reach the scorer and become a real-looking number.
  doc.verdicts[0].tierUsed = 'live-hosts'
  writeFileSync(vp, JSON.stringify(doc, null, 2) + '\n')

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 2, `a mis-shaped artifact must be refused, not scored: ${r.stdout + r.stderr}`)
  assert.match(r.stderr, /ArcTraceShape/, 'the refusal names the contract that rejected it')
  assert.equal(existsSync(reportPath(root, EVAL_DATE)), false, 'nothing derived from unreadable evidence reaches disk')
})

// ── gate R1: the regenerated projection is reproducible ───────────────────────────────
test('eval <ARCID> — timing-stats.json is byte-identical across a --force re-run at the same date', () => {
  const root = buildEvalFixture()
  assert.equal(roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE]).code, 0)
  const first = readFileSync(timingPath(root), 'utf8')
  assert.equal(roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE, '--force']).code, 0)
  assert.equal(
    readFileSync(timingPath(root), 'utf8'),
    first,
    'a second wall-clock read here would put a spurious diff in the committed archive on every run',
  )
})

// ══ `roadmap eval merge-judge --arc <ID>` — the ONE door a judge verdict reaches a report by ══
// The skeleton report scores three dimensions deterministically and leaves FOUR carrying
// owner:'judge' + the `pending-judge` sentinel. merge-judge is the only seam that fills them,
// and the two failures it exists to stop are pinned here:
//   (a) a judge recomputing or overriding a DETERMINISTIC signal — refused by OWNER, which also
//       catches the skip variant that an "already has a score" check would sail past;
//   (b) an off-pin judge silently averaged into the rolling baseline — the merge still happens,
//       but loudly, and the judge-owned ratchet rows stop comparing.
// Same driver as every test above (the REAL bin, so dispatch registration is proven) and the
// same shared arc-eval fixture corpus. Every test here WRITES, so every one builds a fresh root.

/** The pinned judge. Its ONE home in code is cli/commands/eval.mjs — asserted below. */
const JUDGE_PIN = 'claude-sonnet-5'

/** ArcEvalJudgeDimensionShape requires `.min(30)` evidence — a traceable proof, not an opinion. */
const evidenceFor = (key) => `${key}: read cli/lib/eval-score.mjs:452 and the two phase files behind it`

/**
 * A judge verdict over the fixture arc. Every JUDGE-owned key is covered exactly once (scored,
 * or listed in `skipped` with a reason) because ArcEvalJudgeVerdictShape's coverage refine
 * demands it; `extraDimensions` is how the ownership-seam tests reach for a deterministic key.
 */
function judgeVerdict({ judgeModel = JUDGE_PIN, scores = {}, skipped = [], extraDimensions = {} } = {}) {
  const dimensions = { ...extraDimensions }
  for (const key of EVAL_JUDGE_KEYS) {
    if (skipped.some((s) => s.dimension === key)) continue
    dimensions[key] = { score: scores[key] ?? 80, evidence: evidenceFor(key), confidence: 'high' }
  }
  return { arcId: ARC_ID, judgeModel, dimensions, ...(skipped.length > 0 ? { skipped } : {}) }
}

/**
 * A fixture root that already carries the skeleton report at EVAL_DATE, plus any planted priors
 * (planted BEFORE the run so the skeleton's own ratchet sees them, exactly as a real archive
 * would). Priors are dated well before EVAL_DATE, so "the newest dated report for this arc" is
 * unambiguously the skeleton — the resolution merge-judge has to get right.
 */
function fixtureWithSkeleton({ priors = [] } = {}) {
  const root = buildEvalFixture()
  for (const p of priors) plantPrior(root, p.date, p)
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, `fixture precondition: the skeleton report must build: ${r.stdout + r.stderr}`)
  return root
}

/** Pipe a verdict on stdin (the lane the judge skill uses) and guard against a false red/green. */
function mergeJudge(root, verdict, extra = []) {
  const r = roadmap(root, ['eval', 'merge-judge', '--arc', ARC_ID, ...extra], JSON.stringify(verdict))
  // Until the subcommand exists, `merge-judge` is swallowed by the bare-arcid lane and refused
  // as a missing arc — which is ALSO exit 2. Without this guard the refusal tests below would
  // pass for entirely the wrong reason.
  assert.doesNotMatch(
    r.stderr,
    /merge-judge\.arc\.ts/,
    `merge-judge was parsed as an ARC ID, not dispatched as a subcommand:\n${r.stderr}`,
  )
  return r
}

/** Two priors judged by the PIN — so a judge-owned baseline genuinely exists to be reset. */
const PINNED_PRIORS = [
  { date: '2026-07-02', all: 60, judgeModel: JUDGE_PIN },
  { date: '2026-07-03', all: 60, judgeModel: JUDGE_PIN },
]

// ── 15. the happy path: four judge dimensions filled, nothing pending left ─────────────
test('eval merge-judge — a pin-matching verdict FILLS all four judge dimensions and clears every sentinel', () => {
  const root = fixtureWithSkeleton({ priors: PINNED_PRIORS })
  const before = readReport(root, EVAL_DATE)

  const r = mergeJudge(root, judgeVerdict({ scores: { 'doc-brevity': 72.5 } }))
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const after = readReport(root, EVAL_DATE)
  for (const key of EVAL_JUDGE_KEYS) {
    const d = after.dimensions[key]
    assert.equal(d.owner, 'judge', `${key} stays judge-owned — merging a verdict does not transfer ownership`)
    assert.equal(d.score, key === 'doc-brevity' ? 72.5 : 80, `${key} carries the verdict's own number`)
    assert.equal(d.evidence, evidenceFor(key), `${key} carries the judge's quoted proof verbatim`)
    // The contract STRIPS an unknown top-level key on a dimension (ArcEvalReportShape's objects
    // are strip-mode), so `signals` is the only home a confidence can survive the pre-write
    // .parse() in. A confidence written anywhere else vanishes silently on the way to disk.
    assert.equal(d.signals.confidence, 'high', `${key}'s confidence must survive to disk; got ${JSON.stringify(d.signals)}`)
    assert.equal(d.sentinel, undefined, `${key} is scored — score XOR sentinel forbids it keeping the disclaimer too`)
    assert.ok(d.sourceRefs.length >= 1, `${key} keeps its skeleton sourceRefs`)
  }
  assert.doesNotMatch(
    JSON.stringify(after),
    /pending-judge/,
    'with all four scored the finalized report has NOTHING outstanding — a leftover sentinel is a half-merged report',
  )

  assert.equal(after.judgeModel, JUDGE_PIN, 'the report records which model judged it (item 6)')
  // The deterministic side is not the judge's to touch, even incidentally.
  for (const key of EVAL_DETERMINISTIC_KEYS)
    assert.deepEqual(after.dimensions[key], before.dimensions[key], `${key} is byte-for-byte what the scorer wrote`)

  // A merged report whose ratchet still says "no current value" would be internally incoherent:
  // the row's value IS the dimension's score, and with two same-model priors it now compares.
  for (const key of EVAL_JUDGE_KEYS) {
    const row = ratchetRow(after, key)
    assert.equal(row.value, after.dimensions[key].score, `${key}'s ratchet row must carry the merged value`)
    assert.equal(samplesOf(row), 2, `${key}: both PIN-judged priors are comparable now the report shares their judge`)
    assert.equal(row.baseline, 60, `${key}: the mean of the two planted 60s; got ${row.baseline}`)
  }

  const res = parsesConsumerShape(root, 'ArcEvalReportShape', after)
  assert.equal(res.ok, true, `the finalized report must still satisfy ArcEvalReportShape; got: ${res.detail}`)
})

// ── 16. the ownership seam — a judge may not score a deterministic dimension ───────────
test('eval merge-judge — a verdict SCORING a deterministic dimension is REFUSED (exit 2), report untouched', () => {
  const root = fixtureWithSkeleton()
  const before = readFileSync(reportPath(root, EVAL_DATE), 'utf8')

  const verdict = judgeVerdict({
    extraDimensions: {
      'code-confidence': { score: 95, evidence: evidenceFor('code-confidence'), confidence: 'high' },
    },
  })
  const r = mergeJudge(root, verdict)
  assert.equal(r.code, 2, `a judge overriding a deterministic signal is a refusal, not a merge: ${r.stdout + r.stderr}`)
  assert.match(r.stderr, /code-confidence/, 'the refusal names the offending dimension')
  assert.match(r.stderr, /owner/i, 'and names the seam it violated — ownership, not "already scored"')
  assert.match(r.stderr, /deterministic/i, "and the owner the report actually records for it")
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'a refusal reads as a refusal, not a leaked stack')
  assert.equal(
    readFileSync(reportPath(root, EVAL_DATE), 'utf8'),
    before,
    'a refused verdict leaves the report byte-for-byte untouched — no partial merge',
  )
})

// ── 17. the same seam, the SKIP variant ───────────────────────────────────────────────
test('eval merge-judge — a verdict SKIPPING a deterministic dimension is refused by the same seam', () => {
  const root = fixtureWithSkeleton()
  const before = readFileSync(reportPath(root, EVAL_DATE), 'utf8')

  // The skip carries no score, so an "already has a number" check would wave it through and let
  // a judge annotate a dimension it does not own. The rule is OWNER, which catches both shapes.
  const verdict = judgeVerdict({
    skipped: [{ dimension: 'code-confidence', why: 'could not read the gate records for this one' }],
  })
  const r = mergeJudge(root, verdict)
  assert.equal(r.code, 2, `the skip variant is the same violation: ${r.stdout + r.stderr}`)
  assert.match(r.stderr, /code-confidence/, 'the refusal names the offending dimension')
  assert.match(r.stderr, /owner/i, 'and names the ownership seam')
  assert.equal(readFileSync(reportPath(root, EVAL_DATE), 'utf8'), before, 'report untouched')
})

// ── 18. the model pin — an off-pin judge merges LOUDLY and stops the ratchet ───────────
test('eval merge-judge — an OFF-PIN verdict merges, names itself baseline-reset material, and un-compares judge rows', () => {
  // Priors judged by the PIN, so a judge-owned baseline WOULD exist: without them every judge
  // row reads no-baseline anyway and the assertion below would be vacuous.
  const root = fixtureWithSkeleton({ priors: PINNED_PRIORS })
  const OFF_PIN = 'some-other-model-4'

  const r = mergeJudge(root, judgeVerdict({ judgeModel: OFF_PIN }))
  assert.equal(r.code, 0, `an off-pin pass is not refused — it is recorded honestly: ${r.stdout + r.stderr}`)

  const after = readReport(root, EVAL_DATE)
  assert.equal(after.judgeModel, OFF_PIN, 'the report records the model that ACTUALLY judged it, not the pin')
  for (const key of EVAL_JUDGE_KEYS)
    assert.equal(after.dimensions[key].score, 80, `${key} is still filled — the merge happens, the ratchet is what changes`)

  const note = after.notes.find((n) => n.includes(OFF_PIN))
  assert.ok(note, `a note must NAME the off-pin model; notes were ${JSON.stringify(after.notes)}`)
  assert.match(note, /baseline[- ]reset/i, `the note must say what it means for the baseline; got ${JSON.stringify(note)}`)

  for (const key of EVAL_JUDGE_KEYS) {
    const row = ratchetRow(after, key)
    assert.equal(row.regression, false, `${key}: a differently-judged prior can never evidence a regression`)
    assert.equal(typeof row.note, 'string', `${key}: an un-compared row must SAY why`)
    assert.match(row.note, /incomparable-judge/, `${key}: got ${JSON.stringify(row.note)}`)
    assert.equal(row.baseline, null, `${key}: an incomparable row must not carry a number it refuses to compare against`)
  }

  // The reset is scoped to the judge, not global: nobody judged the deterministic dimensions,
  // so their priors stay comparable in the very same run.
  const det = ratchetRow(after, 'code-confidence')
  assert.equal(det.baseline, 60, `a deterministic row still compares across judge models; got ${det.baseline}`)
  assert.equal(samplesOf(det), 2, 'both priors remain in the deterministic reference class')
  assert.equal(det.value, after.dimensions['code-confidence'].score)
  assert.doesNotMatch(det.note, /incomparable-judge/, 'no judge touched code-confidence — it cannot be judge-incomparable')

  const res = parsesConsumerShape(root, 'ArcEvalReportShape', after)
  assert.equal(res.ok, true, `the off-pin report must still satisfy ArcEvalReportShape; got: ${res.detail}`)
})

// ── 19. a partial pass stays honestly partial ─────────────────────────────────────────
test('eval merge-judge — two scored + two SKIPPED: the skipped keep pending-judge and their reasons reach notes', () => {
  const root = fixtureWithSkeleton()
  const skipped = [
    { dimension: 'doc-brevity', why: 'the transparency reports were unreadable in this arc' },
    { dimension: 'plan-quality', why: 'no plan artifacts survived the phase rewrite' },
  ]
  const r = mergeJudge(root, judgeVerdict({ skipped }))
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const after = readReport(root, EVAL_DATE)
  for (const key of ['standards-adherence', 'composability-testability']) {
    assert.equal(after.dimensions[key].score, 80, `${key} was scored and must be filled`)
    assert.equal(after.dimensions[key].sentinel, undefined, `${key} carries no leftover disclaimer`)
  }
  for (const { dimension } of skipped) {
    const d = after.dimensions[dimension]
    assert.equal(d.owner, 'judge', `${dimension} is still the judge's to score one day`)
    assert.equal(d.sentinel, 'pending-judge', `${dimension} was skipped — it is still PENDING, not resolved`)
    assert.equal(d.score, undefined, `${dimension} must not gain a number from a pass that declined to score it`)
    assert.equal(d.evidence, undefined, `${dimension} has no proof, so it must not carry one`)
  }
  for (const { dimension, why } of skipped) {
    const note = after.notes.find((n) => n.includes(why))
    assert.ok(note, `the reason for skipping ${dimension} must reach notes; notes were ${JSON.stringify(after.notes)}`)
  }
  const res = parsesConsumerShape(root, 'ArcEvalReportShape', after)
  assert.equal(res.ok, true, `a partially merged report must still satisfy ArcEvalReportShape; got: ${res.detail}`)
})

// ── 20. a mis-shaped verdict never reaches the report ─────────────────────────────────
test('eval merge-judge — a mis-shaped verdict is REFUSED (exit 2) with a Zod issue line; report untouched', () => {
  const root = fixtureWithSkeleton()
  const before = readFileSync(reportPath(root, EVAL_DATE), 'utf8')

  // (a) evidence below the .min(30) traceability floor — an opinion wearing a number's clothes.
  const thin = judgeVerdict()
  thin.dimensions['doc-brevity'].evidence = 'looked fine'
  const a = mergeJudge(root, thin)
  assert.equal(a.code, 2, a.stdout + a.stderr)
  assert.match(a.stderr, /dimensions\.doc-brevity\.evidence: .+/, 'the Zod issue path is printed')
  assert.doesNotMatch(a.stderr, /\n\s+at [^\n]*\n\s+at /, 'a refusal reads as a refusal, not a leaked stack')

  // (b) a judge-owned dimension neither scored nor skipped — the silent omission the coverage
  // refine exists to stop. It must not be readable as "leave that one pending, then".
  const omitted = judgeVerdict()
  delete omitted.dimensions['plan-quality']
  const b = mergeJudge(root, omitted)
  assert.equal(b.code, 2, b.stdout + b.stderr)
  assert.match(b.stderr, /dimensions\.plan-quality: .+/, 'the omission is named by key')
  assert.match(b.stderr, /skip/i, 'and points at the reachable downgrade path')

  assert.equal(readFileSync(reportPath(root, EVAL_DATE), 'utf8'), before, 'neither refusal touched the report')
})

// ── 21. no report to merge into ───────────────────────────────────────────────────────
test('eval merge-judge — an arc with no dated report is REFUSED (exit 2) by name, and mints nothing', () => {
  const root = buildEvalFixture()
  // Precondition: the arc-evals dir EXISTS and holds the -sweep/-verdicts siblings, so this
  // pins "no REPORT", not "no directory" — a record is not a report.
  assert.ok(existsSync(join(evalsDir(root), `${ARC_ID}-2026-07-20-sweep.json`)), 'fixture precondition: the sweep sibling')
  assert.equal(existsSync(reportPath(root, EVAL_DATE)), false, 'fixture precondition: no dated report yet')

  const r = mergeJudge(root, judgeVerdict())
  assert.equal(r.code, 2, `a verdict with nowhere to land is refused: ${r.stdout + r.stderr}`)
  assert.match(r.stderr, new RegExp(ARC_ID), 'the refusal names the arc it found no report for')
  assert.equal(existsSync(reportPath(root, EVAL_DATE)), false, 'a merge never CREATES a report — it finalizes one')
  assert.equal(
    readdirSync(evalsDir(root)).filter((f) => /^EVALFIX-\d{4}-\d{2}-\d{2}\.json$/.test(f)).length,
    0,
    'no dated report was minted anywhere in the archive',
  )
})

// ── 22. the pin lives in exactly ONE place ────────────────────────────────────────────
test('eval merge-judge — the judge model pin appears EXACTLY once in cli/commands/eval.mjs', () => {
  const src = readFileSync(join(PLUGIN_ROOT, 'cli', 'commands', 'eval.mjs'), 'utf8')
  const hits = src.split(JUDGE_PIN).length - 1
  // Two homes drift: one gets bumped for a new judge and the other keeps waving the old model
  // past the off-pin check, which is precisely the silent baseline contamination this seam
  // exists to prevent. Zero homes means the check is not implemented at all.
  assert.equal(hits, 1, `expected exactly ONE '${JUDGE_PIN}' pin home in cli/commands/eval.mjs; found ${hits}`)
})

// ══ `roadmap eval trend` — the committed corpus rendered as ONE self-contained HTML page ══
// A pile of dated JSON reports shows no direction; the ratchet's value is the ACROSS-arcs line.
// So this takes NO arc argument and reads every dated report in roadmap/arc-evals/. The three
// honesty properties that must survive rendering, and that these tests pin:
//   (a) a dimension carrying a SENTINEL instead of a score is a GAP in that dimension's line —
//       never interpolated across, which would draw a trend nobody measured;
//   (b) a judgeModel change between consecutive reports is a visible vertical MARKER (a baseline
//       reset), not just another data point on the same line;
//   (c) regression rows are LISTED as text, never left to be inferred from a slope.
// Plus the no-CDN bar: one file, inline SVG, zero external assets — a page that phones out is a
// page that renders blank on an air-gapped soil box and leaks the corpus's existence off-network.
//
// TWO RENDERING CONTRACTS the assertions below require (they are what makes the honesty
// properties machine-checkable rather than eyeball-checkable, so the implementation owes them):
//   1. each dimension section is anchored `id="dim-<key>"`;
//   2. every element that DRAWS the series (polyline / path / circle) carries `class="series"`
//      (any class list containing the word), so axes and gridlines are distinguishable from data.

const trendPath = (root) => join(evalsDir(root), 'trend.html')
const rx = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

/**
 * Drive `roadmap eval trend` and guard the false red: until the subcommand exists, `trend` is
 * swallowed by the bare-arcid lane and refused as a missing arc file (`trend.arc.ts`, exit 2) —
 * without this guard the refusal-shaped assertions below would pass for the wrong reason, the
 * way mergeJudge() guards its own lane.
 */
function evalTrend(root, extra = []) {
  const r = roadmap(root, ['eval', 'trend', ...extra])
  assert.doesNotMatch(
    r.stderr,
    /trend\.arc\.ts/,
    `trend was parsed as an ARC ID, not dispatched as a subcommand:\n${r.stderr}`,
  )
  return r
}

/** The slice of the page belonging to ONE dimension: from its anchor to the next dimension's. */
function dimSection(html, key) {
  const anchor = `id="dim-${key}"`
  const at = html.indexOf(anchor)
  assert.notEqual(at, -1, `the page must carry a section anchored ${anchor}; a dimension may not silently vanish`)
  const rest = html.slice(at + anchor.length)
  const next = rest.search(/id="dim-[a-z-]+"/)
  return next === -1 ? rest : rest.slice(0, next)
}

/**
 * Count what a slice of the page actually DRAWS for its series: `points` = plotted data points,
 * `segments` = straight-line connections between them (polyline point-pairs, path L commands).
 * A rendering that interpolates across a gap necessarily emits a connecting segment, so
 * `segments` is the number that kills it — see the sentinel-gap test.
 */
function seriesDraw(slice) {
  let points = 0
  let segments = 0
  for (const [el] of slice.matchAll(/<(?:polyline|path|circle)\b[^>]*>/g)) {
    if (!/class="[^"]*\bseries\b[^"]*"/.test(el)) continue
    const pts = el.match(/points="([^"]*)"/)
    if (pts) {
      const n = pts[1].trim().split(/[\s,]*\s+/).filter(Boolean).length
      points += n
      segments += Math.max(0, n - 1)
      continue
    }
    const d = el.match(/\bd="([^"]*)"/)
    if (d) {
      points += (d[1].match(/[MmLl]/g) ?? []).length
      segments += (d[1].match(/[Ll]/g) ?? []).length
      continue
    }
    if (/<circle\b/.test(el)) points += 1
  }
  return { points, segments }
}

/** The corpus the honesty properties are read off: three dates, a judgeModel change at the 2nd. */
const TREND_JUDGE_A = 'judge-A'
const TREND_JUDGE_B = 'other-judge-9'

// ── 23. the headline: seven sections, the judge-change marker, and ZERO external assets ──
test('eval trend — renders every dimension, marks the judgeModel change, and links to NOTHING remote', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60, judgeModel: TREND_JUDGE_A })
  plantPrior(root, '2026-07-03', { all: 70, judgeModel: TREND_JUDGE_B })
  plantPrior(root, '2026-07-04', { all: 65, judgeModel: TREND_JUDGE_B })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(trendPath(root)), `expected the page at ${trendPath(root)}`)
  assert.match(r.stdout, rx(trendPath(root)), 'the run names the file it wrote')

  const html = readFileSync(trendPath(root), 'utf8')
  // All SEVEN, by name: a corpus-driven renderer that only draws the dimensions it found data
  // for would quietly shrink a seven-dimension picture to a three-dimension one.
  for (const key of EVAL_KEYS) {
    assert.ok(html.includes(key), `the page must name ${key}`)
    assert.ok(dimSection(html, key).length > 0, `${key} must have its own section`)
  }

  // The judge change is a BASELINE RESET, not a data point on the same line: both models are
  // named and the page says what the change means, beside a drawn vertical marker.
  assert.ok(html.includes(TREND_JUDGE_B), `the off-pin judge must be named on the page`)
  assert.ok(html.includes(TREND_JUDGE_A), `and the model it replaced, or the marker names one side only`)
  assert.match(html, /baseline[- ]reset/i, 'a judge change must be labelled for what it is')
  assert.match(html, /<(?:line|rect)\b[^>]*>/, 'the marker is DRAWN, not merely mentioned in prose')

  // The no-CDN bar. This is the criterion the phase names explicitly: one file, no network.
  assert.doesNotMatch(html, /https?:\/\//, 'a self-contained page carries no absolute URL at all')
})

// ── 24. a sentinel is a GAP in the line, never an interpolation ────────────────────────
test('eval trend — a sentinel dimension BREAKS its series rather than being connected across', () => {
  const root = buildEvalFixture()
  // doc-brevity: scored, ABSENT, scored. The two scored points are non-adjacent, so a correct
  // rendering draws zero connecting segments for this dimension while every other dimension
  // (three scored points) draws two.
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70, sentinels: { 'doc-brevity': 'pending-judge' } })
  plantPrior(root, '2026-07-04', { all: 65 })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const html = readFileSync(trendPath(root), 'utf8')

  const gapped = seriesDraw(dimSection(html, 'doc-brevity'))
  const whole = seriesDraw(dimSection(html, 'code-confidence'))

  // Harness sanity FIRST: a fully-scored dimension really does register as connected segments
  // here. Without this the zero below could mean "this counter never sees anything".
  assert.ok(whole.points >= 3, `code-confidence has three scored reports; counted ${whole.points} plotted points`)
  assert.ok(whole.segments >= 2, `a fully-scored line is connected; counted ${whole.segments} segments`)

  assert.ok(gapped.points >= 2, `both SCORED doc-brevity reports must still be plotted; counted ${gapped.points}`)
  // The assertion that kills the naive implementation: one that drops sentinel reports from the
  // series and hands the surviving [60, 65] to a single polyline draws a segment straight over
  // the date nobody measured. Any such rendering registers segments >= 1 here.
  assert.equal(
    gapped.segments,
    0,
    `doc-brevity's two scored points flank an unmeasured date — connecting them draws a trend nobody measured (counted ${gapped.segments} segments)`,
  )
  // And the hole is stated, not merely left blank: a reader must be able to tell "no data" from
  // "the renderer forgot".
  assert.match(
    dimSection(html, 'doc-brevity'),
    /gap|pending-judge|no score|not scored|unmeasured/i,
    'the doc-brevity section must SAY that a report carried no score',
  )
})

// ── 25. a dimension nobody ever scored still gets a section ────────────────────────────
test('eval trend — a dimension with NO data anywhere renders a section saying so, never vanishes', () => {
  const root = buildEvalFixture()
  const noData = { speed: 'no-timestamps' }
  plantPrior(root, '2026-07-02', { all: 60, sentinels: noData })
  plantPrior(root, '2026-07-03', { all: 70, sentinels: noData })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const html = readFileSync(trendPath(root), 'utf8')

  const section = dimSection(html, 'speed')
  assert.equal(seriesDraw(section).points, 0, 'nothing was measured — nothing may be plotted')
  assert.equal(seriesDraw(section).segments, 0, 'and certainly nothing connected')
  assert.match(section, /no data|no score|not scored|no-timestamps|unmeasured/i, 'the empty section must say WHY it is empty')
  // The other six are unaffected: an empty dimension must not blank the page.
  assert.ok(seriesDraw(dimSection(html, 'code-confidence')).segments >= 1, 'the scored dimensions still render')
})

// ── 26. a corrupted report is skipped BY NAME and the rest still render ────────────────
test('eval trend — an unparseable report WARNs by filename, exits 0, and the remaining reports render', () => {
  const root = buildEvalFixture()
  mkdirSync(evalsDir(root), { recursive: true })
  const corruptName = `${ARC_ID}-2026-07-01.json`
  writeFileSync(join(evalsDir(root), corruptName), '{"broken":')
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })

  const r = evalTrend(root)
  assert.equal(r.code, 0, `one bad report must not fail the render: ${r.stdout + r.stderr}`)
  const out = r.stdout + r.stderr
  assert.match(out, new RegExp(`WARN[\\s\\S]{0,200}${corruptName.replace(/\./g, '\\.')}`), 'the skipped file is named in a WARN')
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'a skipped file is a WARN, not a leaked stack')

  const html = readFileSync(trendPath(root), 'utf8')
  const drawn = seriesDraw(dimSection(html, 'code-confidence'))
  assert.ok(drawn.points >= 2, `the two readable reports still render; counted ${drawn.points} points`)
  assert.ok(drawn.segments >= 1, 'and they are connected — a corrupt neighbour is not a gap in the data')
  assert.doesNotMatch(html, /2026-07-01/, 'a file that did not parse contributes no point to the line')
})

// ── 27. the non-report siblings are not reports ────────────────────────────────────────
test('eval trend — -sweep/-verdicts siblings and timing-stats.json are neither read nor warned about', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })
  // Planted as FULL report documents under sibling names and a date shared with no real report:
  // an implementation that globbed *.json would happily plot them, and the distinctive score
  // plus the unique date make that visible rather than a coin flip.
  plantPrior(root, '2026-07-05', { all: 11, name: `${ARC_ID}-2026-07-05-sweep.json` })
  plantPrior(root, '2026-07-05', { all: 11, name: `${ARC_ID}-2026-07-05-verdicts.json` })
  plantPrior(root, '2026-07-05', { all: 11, name: 'timing-stats.json' })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const out = r.stdout + r.stderr
  assert.doesNotMatch(out, /-sweep\.json/, 'a sweep record is not a report and must not be warned about as one')
  assert.doesNotMatch(out, /-verdicts\.json/, 'a verdicts record is not a report either')
  assert.doesNotMatch(out, /timing-stats\.json/, 'the projection is not a report either')

  const html = readFileSync(trendPath(root), 'utf8')
  assert.doesNotMatch(html, /2026-07-05/, 'the siblings must contribute no data point')
  const drawn = seriesDraw(dimSection(html, 'code-confidence'))
  assert.ok(drawn.points >= 2, `the two real reports are plotted; counted ${drawn.points}`)
  // Two reports = ONE connecting segment. Had the three siblings been read as reports the line
  // would carry a third point and a second segment — counting segments says that regardless of
  // whether the renderer also marks each point with a circle.
  assert.equal(
    drawn.segments,
    1,
    `exactly the two dated REPORTS are the line — five files in the directory, two of them reports (counted ${drawn.segments} segments)`,
  )
})

// ── 27a. the three stamps, at production and on the existing corpus ────────────────────
const WORKFLOW_GAP_RX = /workflow provenance GAP/

test('eval <ARCID> — a fresh report is stamped with profile, fingerprint and a real workflow block', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const report = readReport(root, EVAL_DATE)
  assert.equal(report.profile, 'prod-grade')
  assert.equal(report.workflow.profile, report.profile, 'the block snapshots the profile it ran under')
  // The sha is the PLUGIN's HEAD, and it is a measurement rather than a placeholder — plus the
  // `-dirty` marker whenever the plugin tree that RAN differs from the commit it points at,
  // which on this shared checkout is the usual case rather than the exception.
  const head = execFileSync('git', ['-C', PLUGIN_ROOT, 'rev-parse', '--short=12', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  const dirty = execFileSync('git', ['-C', PLUGIN_ROOT, 'status', '--porcelain', '.'], { encoding: 'utf8' }).trim() !== ''
  assert.equal(report.workflow.pluginSha, dirty ? `${head}-dirty` : head, 'the producing build is named, not guessed')
  const measured = JSON.parse(
    execFileSync('node', [BIN, 'measure', '--flow', 'do-arc', '--json'], { encoding: 'utf8' }),
  )
  assert.equal(report.workflow.protocolLoadTokens, measured.totalTokens, 'one metering implementation, one number')
  // The fixture consumer ships no tsconfig.json, so 'unknown' is the HONEST answer here rather
  // than a defect — the language ladder itself is pinned rung by rung in eval-collect.test.mjs.
  assert.equal(report.fingerprint.language, 'unknown')
  assert.equal(report.fingerprint.corpusSize, 2, 'the consumer corpus is COUNTED, not asserted')
  assert.ok(!report.notes.some((n) => WORKFLOW_GAP_RX.test(n)), 'a stamped report names no provenance gap')
})

test('eval restamp — adds profile + fingerprint additively and leaves every SCORE byte-identical', () => {
  const root = buildEvalFixture()
  const p = plantPrior(root, '2026-07-02', { all: 60 })
  const before = JSON.parse(readFileSync(p, 'utf8'))
  assert.equal(before.profile, undefined, 'fixture precondition: an unstamped report')

  const r = roadmap(root, ['eval', 'restamp'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /stamped/, 'the run prints what it did per file')

  const after = JSON.parse(readFileSync(p, 'utf8'))
  assert.equal(after.profile, 'prod-grade')
  assert.equal(after.fingerprint.repo.length > 0, true)
  // The honesty rail, asserted structurally rather than trusted: restamp NEVER re-scores.
  for (const key of ['dimensions', 'ratchet', 'attribution', 'date', 'arcId', 'judgeModel'])
    assert.deepEqual(after[key], before[key], `${key} must be untouched by a restamp`)
  // And it never invents provenance for a build nobody recorded.
  assert.equal(after.workflow, undefined, 'a retro-stamped plugin sha would be a fabricated fact')
  assert.ok(after.notes.some((n) => WORKFLOW_GAP_RX.test(n)), 'instead the absence is a NAMED gap')
})

test('eval restamp — a second run is byte-identical (idempotent, and the gap note is appended once)', () => {
  const root = buildEvalFixture()
  const p = plantPrior(root, '2026-07-02', { all: 60 })
  assert.equal(roadmap(root, ['eval', 'restamp']).code, 0)
  const first = readFileSync(p, 'utf8')

  const second = roadmap(root, ['eval', 'restamp'])
  assert.equal(second.code, 0, second.stdout + second.stderr)
  assert.match(second.stdout, /unchanged/, 'a settled corpus reports unchanged, not a rewrite')
  assert.equal(readFileSync(p, 'utf8'), first, 'a settled restamp writes nothing')
  assert.equal(
    (JSON.parse(first).notes.filter((n) => WORKFLOW_GAP_RX.test(n))).length,
    1,
    'the gap note is appended once, never once per run',
  )
})

/**
 * The retirement half of the restamp, which is what actually edited the committed archive: a
 * reset note is dropped from EXISTING reports once no report in the corpus is pre-reset any
 * more. Asserted in BOTH directions on the same fixture shape, so a blanket delete (or a
 * blanket keep) reds one of the two.
 */
const POST_RESET_SIGNALS = {
  speed: { referenceMinutesPerTask: 8 },
  'code-confidence': { escapeWindow: 'land-record-anchored' },
}
const FOREIGN_NOTE = 'a hand-written observation the loop does not own'
const speedResetNote = DECLARED_RESETS.find((r) => r.id === 'speed-reference-8').note

test('eval restamp — a RETIRED reset note is dropped from an existing report, foreign prose is not', () => {
  const root = buildEvalFixture()
  const p = plantPrior(root, '2026-07-02', {
    all: 60,
    signals: POST_RESET_SIGNALS,
    notes: [FOREIGN_NOTE, speedResetNote],
  })

  assert.equal(roadmap(root, ['eval', 'restamp']).code, 0)
  const notes = JSON.parse(readFileSync(p, 'utf8')).notes
  assert.ok(
    !notes.includes(speedResetNote),
    `nothing pre-reset survives in the corpus, so the archive's copy retires too; got ${JSON.stringify(notes)}`,
  )
  assert.ok(notes.includes(FOREIGN_NOTE), 'a note the registry does not own is never the restamp\'s to edit')
})

test('eval restamp — the SAME note is KEPT while one pre-reset report is still in the corpus', () => {
  const root = buildEvalFixture()
  const p = plantPrior(root, '2026-07-02', {
    all: 60,
    signals: POST_RESET_SIGNALS,
    notes: [FOREIGN_NOTE, speedResetNote],
  })
  // One report still scored under the old reference — the disclaimer is still true of the corpus.
  plantPrior(root, '2026-07-03', {
    all: 70,
    signals: { ...POST_RESET_SIGNALS, speed: { referenceMinutesPerTask: 45 } },
  })

  assert.equal(roadmap(root, ['eval', 'restamp']).code, 0)
  const notes = JSON.parse(readFileSync(p, 'utf8')).notes
  assert.ok(notes.includes(speedResetNote), 'retirement is a CORPUS question, not a per-file one')
})

/**
 * The all-or-nothing rail at the CLI boundary. The FAILURE legs are unit-tested at their seam
 * (assembleWorkflowStamp with an injected failing exec, cli/lib/eval-collect.test.mjs) because
 * that is where a failure can be injected without faking a git-less world; what only the CLI
 * can prove is that the two states are mutually exclusive and that a written block is complete.
 */
test('eval <ARCID> — a workflow block and a workflow-gap warning never coexist, and a written block is COMPLETE', () => {
  const root = buildEvalFixture()
  assert.equal(roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE]).code, 0)
  const report = readReport(root, EVAL_DATE)

  const hasBlock = report.workflow !== undefined
  assert.equal(
    hasBlock,
    !report.notes.some((n) => /no workflow block written/.test(n)),
    'never both, never neither — a partial stamp has no representation',
  )
  if (hasBlock)
    for (const k of ['pluginVersion', 'pluginSha', 'protocolLoadTokens', 'profile'])
      assert.notEqual(report.workflow[k], undefined, `a written block is COMPLETE (${k} present)`)
})

// ── 27b. declared resets: the STAMP retires, the trend MARKER does not ─────────────────
const SPEED_RESET_RX = /SPEED_REFERENCE_MINUTES_PER_TASK recalibrated 45 → 8/
const SPEED_RESET_ID = 'speed-reference-8'

test('eval <ARCID> — a PRE-reset report in the corpus stamps the speed reset note onto the new report', () => {
  const root = buildEvalFixture()
  // referenceMinutesPerTask 45 is the SIGNAL of a report scored under the old model. The
  // predicate reads that, never the note's own presence, which would be circular.
  plantPrior(root, '2026-07-02', { all: 60, signals: { speed: { referenceMinutesPerTask: 45 } } })
  plantPrior(root, '2026-07-03', { all: 70, signals: { speed: { referenceMinutesPerTask: 45 } } })

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const notes = readReport(root, EVAL_DATE).notes
  assert.ok(
    notes.some((n) => SPEED_RESET_RX.test(n)),
    `a corpus still holding pre-reset reports must carry the stamp; got ${JSON.stringify(notes)}`,
  )
})

test('eval <ARCID> — once NO pre-reset report is left the stamp AUTO-RETIRES, and the trend marker survives it', () => {
  const root = buildEvalFixture()
  // The same corpus, post-reset: every prior was produced under the new reference.
  plantPrior(root, '2026-07-02', { all: 60, signals: { speed: { referenceMinutesPerTask: 8 } } })
  plantPrior(root, '2026-07-03', { all: 70, signals: { speed: { referenceMinutesPerTask: 8 } } })

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const notes = readReport(root, EVAL_DATE).notes
  assert.ok(
    !notes.some((n) => SPEED_RESET_RX.test(n)),
    `nothing pre-reset remains, so the disclaimer is noise and must retire; got ${JSON.stringify(notes)}`,
  )

  // The RECORD of the reset is permanent even so: the trend page draws it from the registry,
  // not from a surviving note, exactly as it does for a judge-model reset.
  assert.equal(evalTrend(root).code, 0)
  const html = readFileSync(trendPath(root), 'utf8')
  assert.ok(html.includes(SPEED_RESET_ID), 'the permanent marker names the reset by its registry id')
  assert.match(html, /scoring-model reset/i, 'and says what kind of reset it was')
  assert.match(html, /class="reset"/, 'the marker is DRAWN, not merely listed in prose')
})

test('eval trend — every registry reset is marked even on a corpus that never saw one', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60, signals: { speed: { referenceMinutesPerTask: 8 } } })
  plantPrior(root, '2026-07-03', { all: 70, signals: { speed: { referenceMinutesPerTask: 8 } } })

  assert.equal(evalTrend(root).code, 0)
  const html = readFileSync(trendPath(root), 'utf8')
  for (const id of ['escape-attribution', 'escape-anchor-option-c', SPEED_RESET_ID])
    assert.ok(html.includes(id), `the timeline must mark ${id} whether or not any report still predates it`)
})

// ── 28. self-containment, spelled out ──────────────────────────────────────────────────
test('eval trend — the page loads NO script, stylesheet, font or image from anywhere', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60, judgeModel: TREND_JUDGE_A })
  plantPrior(root, '2026-07-03', { all: 70, judgeModel: TREND_JUDGE_B })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const html = readFileSync(trendPath(root), 'utf8')

  assert.doesNotMatch(html, /<script[^>]*\bsrc\s*=/i, 'no external script')
  assert.doesNotMatch(html, /<link[^>]*rel\s*=\s*["']?stylesheet/i, 'no external stylesheet')
  assert.doesNotMatch(html, /\bsrc\s*=\s*["']https?:/i, 'no remote image or iframe source')
  assert.doesNotMatch(html, /@import/i, 'no CSS @import — the back door around the link rule')
  assert.doesNotMatch(html, /https?:\/\//, 'one file, zero network')
  // And it really is a rendered page, so the assertions above are not passing over an empty file.
  assert.match(html, /<svg\b/i, 'the charts are INLINE SVG')
  assert.ok(html.length > 500, `a rendered corpus page is not a stub; got ${html.length} bytes`)
})

// ── 29. regressions are LISTED, not left to a slope ────────────────────────────────────
test('eval trend — a ratchet row flagged regression:true is listed as text under its dimension', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', {
    all: 40,
    ratchet: [
      { dimension: 'doc-brevity', baseline: 60, value: 40, delta: -20, regression: true, note: 'samples=1' },
      { dimension: 'speed', baseline: 60, value: 40, delta: -20, regression: false, note: 'samples=1' },
    ],
  })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const html = readFileSync(trendPath(root), 'utf8')
  const section = dimSection(html, 'doc-brevity')
  // The CLI already shouts REGRESSION in caps (§10); the page keeps that vocabulary, which also
  // keeps a section HEADING like "Regressions" from being mistaken for a listed row.
  assert.match(section, /REGRESSION/, 'the regression is stated in words under the dimension it hit')
  assert.match(section, /2026-07-03/, 'and dated, so a reader knows which report regressed')
  assert.match(section, /[-−]20\b/, 'and carries its signed delta rather than leaving the size to a slope')
  // A row that did NOT flag must not be dressed up as a regression somewhere else on the page.
  assert.doesNotMatch(dimSection(html, 'speed'), /REGRESSION/, 'speed carried regression:false — it is not a regression')
})

// ── 30. an empty corpus is not a crash and not a fabricated chart ──────────────────────
test('eval trend — an absent/empty corpus exits 0 or refuses BY NAME, never a stack or a zero line', () => {
  const root = makeConsumer()
  const r = evalTrend(root)
  assert.ok([0, 1, 2].includes(r.code), `the three-way contract holds (got ${r.code})`)
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'an empty corpus is a fact, not an exception')

  if (r.code !== 0) {
    assert.match(r.stdout + r.stderr, /arc-evals/, 'a refusal names the corpus directory it found nothing in')
    return
  }
  if (!existsSync(trendPath(root))) return
  const html = readFileSync(trendPath(root), 'utf8')
  const drawn = seriesDraw(html)
  assert.equal(drawn.points, 0, 'no reports means no plotted points — a zero line is a fabricated score of zero')
  assert.equal(drawn.segments, 0, 'and nothing connected')
  assert.match(html, /no reports|no data|empty/i, 'the page must say the corpus is empty')
})

// ══ `roadmap eval <ARCID> --backfill` — the historical run the judge will NEVER see ══════
// A backfill sweeps arcs whose diffs predate the rubric. The judge pass is not late for them,
// it is never coming — so their judge-owned dimensions must carry the TERMINAL
// `unjudged-backfill` sentinel rather than `pending-judge`, which promises a pass that will
// not happen, and must carry no judge attribution at all. Everything else about the run is
// the SAME pipeline: a backfill that scored differently would seed the ratchet with numbers
// no ordinary run could reproduce.

/** The report's raw bytes — the sentinel invariants are about what is IN the archived file. */
const rawReport = (root, date) => readFileSync(reportPath(root, date), 'utf8')

const BACKFILL_DATE = '2026-07-26'

// ── 31. the headline: same pipeline, terminal sentinel, no `pending-judge` anywhere ─────
test('eval <ARCID> --backfill — same collect/score/ratchet/persist pipeline, judge dims TERMINAL unjudged-backfill', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--backfill', '--date', BACKFILL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(reportPath(root, BACKFILL_DATE)), `expected the report at ${reportPath(root, BACKFILL_DATE)}`)

  const report = readReport(root, BACKFILL_DATE)
  assert.equal(report.arcId, ARC_ID)
  assert.equal(report.date, BACKFILL_DATE, 'a backfill is dated by the flag like any other run')
  assert.deepEqual(Object.keys(report.dimensions).sort(), [...EVAL_KEYS].sort(), 'exactly the seven closed keys')

  // The deterministic half is UNTOUCHED by the mode: those dimensions read recorded artifacts,
  // which a backfill has as much of as a live run.
  for (const key of EVAL_DETERMINISTIC_KEYS) {
    const d = report.dimensions[key]
    assert.equal(typeof d.score, 'number', `${key} is deterministic — a backfill still scores it`)
    assert.equal(d.sentinel, undefined, `${key} has every input it needs in this fixture`)
  }
  for (const key of EVAL_JUDGE_KEYS) {
    const d = report.dimensions[key]
    assert.equal(d.sentinel, 'unjudged-backfill', `${key} will never be judged — the sentinel must say so terminally`)
    assert.equal(d.score, undefined, `${key} must not carry a CLI-invented number`)
    assert.notEqual(d.score, 0, `${key} must sentinel, never zero — a zero reads as a real, terrible arc`)
  }

  // The whole point of a separate sentinel is that a reader can never mistake the file for one
  // awaiting a pass, so the promise must not survive anywhere in the bytes (notes included).
  assert.equal(
    rawReport(root, BACKFILL_DATE).includes('pending-judge'),
    false,
    'a backfilled report may not contain the string pending-judge ANYWHERE — the judge pass is not coming',
  )

  assert.equal(report.ratchet.length, 7, 'one ratchet row per dimension, always — the mode changes no shape')
  assert.ok(existsSync(timingPath(root)), 'the identical pipeline still regenerates the projection')
})

// ── 32. the persisted backfill really parses the consumer contract ──────────────────────
test('eval <ARCID> --backfill — the written report satisfies the CONSUMER ArcEvalReportShape', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--backfill', '--date', BACKFILL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  // The precondition IS the point: without it this test would pass over an ordinary report
  // while --backfill was silently ignored, and prove nothing about the new sentinel parsing.
  const doc = readReport(root, BACKFILL_DATE)
  for (const key of EVAL_JUDGE_KEYS)
    assert.equal(doc.dimensions[key].sentinel, 'unjudged-backfill', `precondition: ${key} is the backfill sentinel`)

  const res = parsesConsumerShape(root, 'ArcEvalReportShape', doc)
  assert.equal(res.ok, true, `a backfilled report must satisfy ArcEvalReportShape; got: ${res.detail}`)
})

// ── 33. no judge attribution, and the deterministic FEEDERS survive ─────────────────────
test('eval <ARCID> --backfill — carries NO judgeModel key, and keeps every judge dimension FEEDER', () => {
  // ONE root, two runs: the plain run is the reference for the feeders, and sharing the root
  // keeps the git history (and therefore every collected signal) identical between them.
  const root = buildEvalFixture()
  const plain = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(plain.code, 0, plain.stdout + plain.stderr)
  const back = roadmap(root, ['eval', ARC_ID, '--backfill', '--date', BACKFILL_DATE])
  assert.equal(back.code, 0, back.stdout + back.stderr)

  const plainReport = readReport(root, EVAL_DATE)
  const report = readReport(root, BACKFILL_DATE)
  // Without this the test would compare a plain report with a plain report and pass while
  // --backfill did nothing at all.
  for (const key of EVAL_JUDGE_KEYS)
    assert.equal(report.dimensions[key].sentinel, 'unjudged-backfill', `precondition: ${key} is the backfill sentinel`)

  // Not `=== undefined`: an explicit `judgeModel: null`/'none'/'backfill' would still be an
  // attribution line in the archive, and the trend page reads the KEY to mark baseline resets.
  assert.equal(
    Object.prototype.hasOwnProperty.call(report, 'judgeModel'),
    false,
    `an unjudged report may carry no judge attribution at all; got judgeModel=${JSON.stringify(report.judgeModel)}`,
  )

  for (const key of EVAL_JUDGE_KEYS) {
    const d = report.dimensions[key]
    assert.ok(
      Object.keys(d.signals ?? {}).length > 0,
      `${key}: the feeders are COUNTS of recorded things, not judgements — a backfill must not drop them`,
    )
    assert.deepEqual(
      d.signals,
      plainReport.dimensions[key].signals,
      `${key}: the deterministic feeders must be byte-identical to the plain run — only the sentinel differs`,
    )
    assert.deepEqual(d.sourceRefs, plainReport.dimensions[key].sourceRefs, `${key}: same artifacts cited`)
    assert.equal(d.owner, 'judge', `${key} stays judge-owned — nobody else may score it later either`)
  }
})

// ── 34. the mode is NAMED in the notes, beside the gaps it did not stop naming ──────────
test('eval <ARCID> --backfill — a note names the backfill MODE and the existing gap notes survive', () => {
  // omitVerdicts is the fixture variant that produces a real collector/scorer gap note, so
  // this pins that the mode note is ADDED to the honesty rails rather than replacing them.
  const root = buildEvalFixture({ omitVerdicts: true })
  const r = roadmap(root, ['eval', ARC_ID, '--backfill', '--date', BACKFILL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const report = readReport(root, BACKFILL_DATE)
  const notes = report.notes ?? []
  const modeNote = notes.find((n) => /backfill/i.test(n))
  assert.ok(modeNote, `a backfilled report must NAME its mode in notes; got ${JSON.stringify(notes)}`)
  assert.match(
    modeNote,
    /judge/i,
    `the mode note must say what the mode COSTS (the judge pass); got ${JSON.stringify(modeNote)}`,
  )

  const gapNote = notes.find((n) => /no-verdicts-file|verdicts file/i.test(n))
  assert.ok(
    gapNote,
    `the pre-existing artifact-gap note must still be present alongside the mode note; got ${JSON.stringify(notes)}`,
  )
  assert.equal(report.dimensions['verified-vs-intent'].sentinel, 'no-verdicts-file', 'the gap itself is unchanged')

  // The human lane prints notes; a mode this consequential must not be JSON-only.
  assert.ok(
    r.stdout.split('\n').some((l) => /note:/.test(l) && /backfill/i.test(l)),
    `stdout must print the backfill mode note; stdout was:\n${r.stdout}`,
  )
})

// ── 35. regression guard: WITHOUT the flag nothing changes ──────────────────────────────
test('eval <ARCID> — WITHOUT --backfill the judge dims stay pending-judge and unjudged-backfill never appears', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const report = readReport(root, EVAL_DATE)
  for (const key of EVAL_JUDGE_KEYS)
    assert.equal(report.dimensions[key].sentinel, 'pending-judge', `${key} still awaits a real judge pass`)
  assert.equal(
    rawReport(root, EVAL_DATE).includes('unjudged-backfill'),
    false,
    'the terminal sentinel must never leak into an ordinary run — that would cancel a pass that IS coming',
  )
})

// ══ `roadmap eval lesson "<text>"` — the EVENT-triggered capture ══════════════════════════
// A lesson learned mid-session dies with the session unless one command can commit it. This is
// that command: it APPENDS one JSON document per line to the committed
// roadmap/arc-evals/lessons.jsonl sidecar, which concurrent sessions on the same tree share.
// JSONL and append-only are the whole design — a read-modify-write of an array would race and
// the loser would silently drop the lesson it was written to keep — so the invariants pinned
// here are: exactly ONE line added per call, the earlier lines byte-for-byte untouched, the
// document satisfying the CONSUMER's LessonShape, `origin.kind` always the literal 'session'
// (the eval loop writes its own artifacts through its own path and must stay distinguishable),
// and an unnamed writer landing as the literal 'unrecorded' rather than a guessed actor id.
// Every test builds its own makeConsumer() root: a lessons file left behind would become the
// next test's baseline and turn the append assertions vacuous.

const lessonsPath = (root) => join(root, 'roadmap', 'arc-evals', 'lessons.jsonl')

/** The lines of the sidecar, minus the trailing empty one a newline-terminated file leaves. */
function lessonLines(root) {
  const raw = readFileSync(lessonsPath(root), 'utf8')
  assert.ok(raw.endsWith('\n'), 'JSONL is newline-TERMINATED — an unterminated last line corrupts the next append')
  return raw.split('\n').slice(0, -1)
}

/**
 * Run the capture and guard against a false red/green. Until the subcommand exists, `lesson` is
 * swallowed by the bare-arcid lane and refused as a missing arc file — which is ALSO a non-zero
 * exit with a message on stderr, so the usage tests below would otherwise pass for entirely the
 * wrong reason. (Same guard idiom as mergeJudge above.)
 */
function lesson(root, args) {
  const r = roadmap(root, ['eval', 'lesson', ...args])
  assert.doesNotMatch(
    r.stderr,
    /lesson\.arc\.ts/,
    `'lesson' was parsed as an ARC ID, not dispatched as a subcommand:\n${r.stderr}`,
  )
  return r
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

// ── 36. one capture, one line ────────────────────────────────────────────────────────────
test('eval lesson — appends exactly ONE line that round-trips, kind session, with a freshly minted ts', () => {
  const root = makeConsumer()
  const before = Date.now()
  const r = lesson(root, ['a masked category that fails open is a leak, not a fallback'])
  const after = Date.now()
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const lines = lessonLines(root)
  assert.equal(lines.length, 1, `exactly one line per capture; got ${JSON.stringify(lines)}`)

  const doc = JSON.parse(lines[0])
  assert.equal(doc.text, 'a masked category that fails open is a leak, not a fallback', 'the text rides in verbatim')
  assert.equal(doc.origin.kind, 'session', "this command's provenance is ALWAYS 'session' — the eval loop owns 'eval-loop'")

  assert.match(doc.ts, ISO_Z, `ts must be an ISO-8601 Z datetime (what LessonShape's .datetime() accepts); got ${doc.ts}`)
  const t = Date.parse(doc.ts)
  assert.ok(Number.isFinite(t), `ts must be parseable; got ${doc.ts}`)
  // Minted BY the command at capture time. A hardcoded or copied timestamp would still match the
  // regex above, so the window is what makes the assertion mean anything.
  assert.ok(
    t >= before - 1000 && t <= after + 1000,
    `ts must be minted during the run (${new Date(before).toISOString()}..${new Date(after).toISOString()}); got ${doc.ts}`,
  )

  // The shape belongs to the CONSUMER, so it is checked through the consumer's own schema rather
  // than against this test author's belief about the contract.
  const res = parsesConsumerShape(root, 'LessonShape', doc)
  assert.equal(res.ok, true, `the persisted lesson must satisfy LessonShape; got: ${res.detail}`)
})

// ── 37. APPEND-ONLY — the earlier line is never rewritten ────────────────────────────────
test('eval lesson — a second capture appends AFTER the first and leaves line 1 byte-identical', () => {
  const root = makeConsumer()
  assert.equal(lesson(root, ['first lesson', '--phase', '2015']).code, 0)
  const firstLine = lessonLines(root)[0]
  const firstBytes = readFileSync(lessonsPath(root), 'utf8')

  assert.equal(lesson(root, ['second lesson', '--phase', '2016']).code, 0)

  const lines = lessonLines(root)
  assert.equal(lines.length, 2, `the second capture ADDS a line, it does not replace the file; got ${JSON.stringify(lines)}`)
  assert.equal(lines[0], firstLine, 'line 1 is byte-for-byte what the first run wrote — a rewrite is a lost lesson')
  assert.equal(JSON.parse(lines[0]).text, 'first lesson', 'and in capture order')
  assert.equal(JSON.parse(lines[1]).text, 'second lesson')
  // Prefix identity catches the read-modify-write variant that reproduces line 1 but reflows
  // the bytes around it (reindented JSON, a rewritten terminator).
  assert.ok(
    readFileSync(lessonsPath(root), 'utf8').startsWith(firstBytes),
    'the whole of the previous file must survive as an exact PREFIX of the new one',
  )
})

// ── 38. no text at all is USAGE, and writes nothing ──────────────────────────────────────
test('eval lesson — with no text argument it is USAGE (exit 1), no stack, and no sidecar is minted', () => {
  const root = makeConsumer()
  const r = lesson(root, [])
  // 1 = the caller invoked it wrong; 2 is reserved for a document the contract refused. A capture
  // with nothing to capture never reaches the contract at all.
  assert.equal(r.code, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /usage/i, `the empty call must teach the form; stderr was:\n${r.stderr}`)
  assert.match(r.stderr, /lesson/, 'and name the subcommand it is the usage for')
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'a usage error reads as usage, not a leaked stack')
  assert.equal(existsSync(lessonsPath(root)), false, 'a refused capture leaves no empty sidecar behind')
  assert.equal(existsSync(join(root, 'roadmap', 'arc-evals')), false, 'and mints no directory for it either')
})

// ── 39. the same, for text that is only whitespace ───────────────────────────────────────
test('eval lesson — whitespace-only text is the SAME usage refusal, not an empty lesson on disk', () => {
  const root = makeConsumer()
  // LessonShape's .min(1) would happily accept '   ': a blank lesson is a caller mistake the CLI
  // has to catch, not a document the contract can.
  const r = lesson(root, ['   '])
  assert.equal(r.code, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /usage/i, `stderr was:\n${r.stderr}`)
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'no leaked stack')
  assert.equal(existsSync(lessonsPath(root)), false, 'nothing on disk — a whitespace lesson is worse than none')
})

// ── 40. --phase and --writer ride in verbatim ────────────────────────────────────────────
test('eval lesson — --phase and --writer land in the record exactly as given', () => {
  const root = makeConsumer()
  const r = lesson(root, ['re-read the phase file before editing; it moves under you', '--phase', '2015', '--writer', 'claude-fable-5'])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = JSON.parse(lessonLines(root)[0])
  assert.equal(doc.phase, 2015, 'the phase is a NUMBER in the record, not the string the shell handed over')
  assert.equal(doc.origin.writer, 'claude-fable-5', 'the self-reported writer is carried verbatim')
  assert.equal(doc.origin.kind, 'session', 'a named writer does not change the provenance kind')
  assert.equal(doc.text, 're-read the phase file before editing; it moves under you')

  const res = parsesConsumerShape(root, 'LessonShape', doc)
  assert.equal(res.ok, true, `got: ${res.detail}`)
})

// ── 41. the named gap, and the key that must simply be ABSENT ────────────────────────────
test("eval lesson — an unnamed writer is the literal 'unrecorded'; an unnamed phase omits the key entirely", () => {
  const root = makeConsumer()
  const r = lesson(root, ['a lesson from a session that did not say who it was'])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = JSON.parse(lessonLines(root)[0])
  assert.equal(
    doc.origin.writer,
    'unrecorded',
    `an unnamed writer is a NAMED gap, never a guessed model id; got ${JSON.stringify(doc.origin.writer)}`,
  )
  // Not `=== undefined`: `phase: null` or `phase: 0` would read as an answer in the archive, and
  // JSON.parse turns an explicit null into a present key that a consumer has to defend against.
  assert.equal(
    'phase' in doc,
    false,
    `an unnamed phase must OMIT the key, not carry an empty answer; got ${JSON.stringify(doc)}`,
  )
  const res = parsesConsumerShape(root, 'LessonShape', doc)
  assert.equal(res.ok, true, `got: ${res.detail}`)
})

// ── 42. NON-SHADOWING: the new literal must not swallow the arc-id lane ──────────────────
test('eval <ARCID> — the `lesson` literal shadows nothing; a bare arcid still reaches the arc-eval path', () => {
  const root = sharedFixture()
  // The cheap proof: an arc id that does not exist must still be refused BY THE ARC-EVAL LANE
  // (which names the missing arc file), never handled as a lesson with a funny name. A new
  // literal checked in the wrong order is the regression this dispatch could most easily cause.
  const r = roadmap(root, ['eval', 'NOSUCHARC', '--date', EVAL_DATE])
  assert.notEqual(r.code, 0, `a missing arc must never exit 0: ${r.stdout}`)
  const out = r.stdout + r.stderr
  assert.match(out, /NOSUCHARC/, 'the refusal names the arc it could not find')
  assert.match(out, /\.arc\.ts|arc file/, `it is the ARC-EVAL refusal, not a lesson usage line; got:\n${out}`)
  assert.doesNotMatch(out, /lessons\.jsonl/, 'an arc id never touches the lessons sidecar')
  assert.equal(existsSync(lessonsPath(root)), false, 'and writes no lesson for it')
})

// ── 43. the receipt says what landed ─────────────────────────────────────────────────────
test('eval lesson — stdout on success reports what was written, INCLUDING the minted ts', () => {
  const root = makeConsumer()
  const r = lesson(root, ['the receipt has to carry the timestamp the caller never chose', '--writer', 'claude-fable-5'])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = JSON.parse(lessonLines(root)[0])
  // The ts is the one field the CALLER did not supply, so it is the one the receipt must echo:
  // without it a session has no way to cite the line it just wrote.
  assert.ok(
    r.stdout.includes(doc.ts),
    `stdout must carry the minted ts ${doc.ts} that landed in the file; stdout was:\n${r.stdout}`,
  )
  assert.ok(r.stdout.includes('lessons.jsonl'), `stdout must name the sidecar it appended to; stdout was:\n${r.stdout}`)
})

// ── 44. the third exit code: a document the CONTRACT refuses, not the parser ─────────────
test('eval lesson — a non-positive --phase is a Zod REFUSAL (exit 2), distinct from usage (exit 1), and lands nothing', () => {
  const root = makeConsumer()
  // The exit-code contract only means something if all three lanes are reachable. `--phase 0`
  // is well-formed input the SHAPE rejects (phase is a positive int), so it separates "the
  // caller held the command wrong" (1) from "the caller's document is not a lesson" (2).
  const r = lesson(root, ['a lesson filed against a phase number that cannot exist', '--phase', '0'])
  assert.equal(r.code, 2, `a shape refusal is exit 2, not 1: ${r.stdout + r.stderr}`)
  assert.match(r.stderr, /LessonShape/, 'the refusal names the shape that refused it')
  assert.match(r.stderr, /phase/, 'and the field it refused on')
  assert.equal(existsSync(lessonsPath(root)), false, 'a refused lesson leaves NO file behind')
})

// ══ `roadmap eval scorecard` — the PER-ACTOR outcome slice ═════════════════════════════════
// The slicing arithmetic belongs to cli/lib/eval-scorecard.test.mjs and is deliberately not
// restated here. What this section pins is the COMMAND SEAM, and the four ways it could ship
// arithmetic that is right into a product that is wrong:
//
//   (a) ABSTENTION THAT DOES NOT REACH THE READER. computeScorecard drops `metrics` below the
//       floor, but a renderer that prints a blank column, a dash or a 0 where the abstention
//       was puts an unsampled actor on a leaderboard anyway. So the marker is asserted to be
//       explicit AND to carry both numbers a reader needs to judge it — this cell's n and the
//       floor it fell under — on the marker line itself, not scattered through the output.
//   (b) A POOLED ROW. Every cell is cohort-scoped because assignment is not random; one summary
//       line averaging across cohorts would undo the whole normalisation, and it is exactly the
//       line a well-meaning renderer adds. Pinned by an explicit compare against the document
//       (the top-level key set, the rendered row count, and the one number a pooled row would
//       have to print), never by a bare grep for the word "total".
//   (c) THE PROJECTION BECOMING A BASELINE. scorecard.json lands in roadmap/arc-evals/ beside
//       the dated reports the ratchet reads. If it were ever picked up as a prior, every future
//       baseline would silently absorb a document that carries no dimension scores at all.
//   (d) AN IRREPRODUCIBLE ARTIFACT. It is committed, so a second wall-clock read inside the run
//       would put a spurious diff in the archive on every regeneration (the timing-stats rule).
//
// The corpus is the SAME shared arc-eval fixture, plus a planted dated report per arc — the
// scorecard's corpus is "arcs that already have a dated report", so the report IS the enrolment.
// Every test here writes into roadmap/arc-evals/, so every one builds a fresh fixture root.

const scorecardPath = (root) => join(evalsDir(root), 'scorecard.json')

/**
 * Run the slice and guard against a false red/green. Until the subcommand exists, `scorecard`
 * is swallowed by the bare-arcid lane and refused as a missing arc file — a non-zero exit with
 * a message on stderr, which several assertions below would otherwise "pass" against for
 * entirely the wrong reason. (Same guard idiom as `lesson` and `mergeJudge` above.)
 */
function scorecard(root, args = []) {
  const r = roadmap(root, ['eval', 'scorecard', ...args])
  assert.doesNotMatch(
    r.stderr,
    /scorecard\.arc\.ts/,
    `'scorecard' was parsed as an ARC ID, not dispatched as a subcommand:\n${r.stderr}`,
  )
  return r
}

const readScorecard = (root) => JSON.parse(readFileSync(scorecardPath(root), 'utf8'))

/** Every cell of the document, each tagged with the identity string a row must name it by. */
const scorecardCells = (doc) => [
  ...doc.drivers.map((cell) => ({ kind: 'driver', id: cell.model, cell })),
  ...(doc.planners ?? []).map((cell) => ({ kind: 'planner', id: cell.model, cell })),
  ...doc.reviewers.map((cell) => ({ kind: 'reviewer', id: cell.agent, cell })),
]

/**
 * Does `line` print the number `n` as its own token? The boundary excludes a leading/trailing
 * digit, `.` AND `-`, because without the `-` the cohort label `1-3` would satisfy "prints 1"
 * and the model id `claude-opus-5` would satisfy "prints the floor 5" — an assertion that
 * passes on text that never mentioned the sample count or the floor at all.
 */
const printsNumber = (line, n) => new RegExp(`(?<![\\d.\\-])${n}(?![\\d.\\-])`).test(line)

/** Every formatting of a metric value a row may legitimately have chosen. */
const renderingsOf = (v) => (typeof v === 'number' ? [String(v), v.toFixed(0), v.toFixed(1), v.toFixed(2)] : [String(v)])

/**
 * A SECOND arc in the fixture repo, derived from the fully-recorded phase 9001 by substitution
 * so its phase files are valid against the same consumer schema by construction (a hand-written
 * phase file here would only encode this test author's belief about the contract). Every derived
 * phase keeps 9001's driver, its four tasks and its web/ keyFile, so all of them land in ONE
 * cohort cell together with 9001 — which is the only way a corpus this small reaches the floor.
 */
function plantSiblingArc(root, arcId, phaseNums) {
  const phasesDir = join(root, 'roadmap', 'phases')
  const template = readFileSync(join(phasesDir, 'phase-9001.phase.ts'), 'utf8')
  for (const n of phaseNums) {
    const src = template.replaceAll('9001', String(n)).replaceAll("arcId: 'EVALFIX'", `arcId: '${arcId}'`)
    writeFileSync(join(phasesDir, `phase-${n}.phase.ts`), src)
  }
  const arcSrc = readFileSync(join(root, 'roadmap', 'arcs', `${ARC_ID}.arc.ts`), 'utf8')
    .replaceAll(ARC_ID, arcId)
    .replace(/planes: \[[\s\S]*?\n {2}\],/, `planes: [{ name: 'engine', phases: [${phaseNums.join(', ')}] }],`)
  writeFileSync(join(root, 'roadmap', 'arcs', `${arcId}.arc.ts`), arcSrc)
  assert.match(arcSrc, /phases: \[\d/, 'fixture precondition: the sibling arc file names its member phases')
}

// ── 45. every cell under the floor ABSTAINS, all the way to disk ─────────────────────────
test('eval scorecard — an under-floor corpus writes a document whose every cell abstains with NO metrics key', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE) // the dated report is what enrols EVALFIX in the corpus
  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(scorecardPath(root)), `expected the projection at ${scorecardPath(root)}`)

  const doc = readScorecard(root)
  assert.equal(doc.nFloor, SCORECARD_N_FLOOR, 'the floor is STAMPED into the document, not left implicit')
  assert.equal(doc.generatedAt, `${EVAL_DATE}T00:00:00.000Z`, '--date pins the stamp; a wall-clock read here is a diff every run')

  const cells = scorecardCells(doc)
  // Without this the loop below is vacuous — an empty document would "pass" every assertion.
  assert.ok(cells.length > 0, `fixture precondition: the corpus must produce cells; got ${JSON.stringify(doc)}`)
  for (const { kind, id, cell } of cells) {
    assert.ok(
      cell.samples < doc.nFloor,
      `fixture precondition: this corpus is under-floor everywhere; ${kind} ${id} had ${cell.samples}`,
    )
    assert.equal(cell.abstained, true, `${kind} ${id}: ${cell.samples} samples is under the floor and must abstain`)
    // Not `metrics === undefined`: an explicit `metrics: null` survives JSON and reads as a
    // measurement of nothing. The key must be genuinely ABSENT.
    assert.equal('metrics' in cell, false, `${kind} ${id}: an abstained cell carries no metrics key at all`)
  }

  // The shape belongs to the CONSUMER, and its superRefine is what makes abstention structural.
  const res = parsesConsumerShape(root, 'ScorecardShape', doc)
  assert.equal(res.ok, true, `the persisted projection must satisfy ScorecardShape; got: ${res.detail}`)
})

// ── 46. the abstention has to reach the READER, carrying both numbers ────────────────────
test('eval scorecard — each abstained cell prints an ABSTAINED marker carrying ITS n and the floor', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)
  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = readScorecard(root)
  const cells = scorecardCells(doc)
  assert.ok(cells.length > 0, 'fixture precondition: the corpus must produce cells')
  const markerLines = r.stdout.split('\n').filter((l) => /ABSTAINED/.test(l))

  for (const { kind, id, cell } of cells) {
    // One line has to carry all three facts together. A run that printed "ABSTAINED" on one
    // line and the sample count three lines away leaves the reader to guess which cell was
    // under-sampled and by how much — the exact judgement the floor exists to hand them.
    const line = markerLines.find(
      (l) => l.includes(id) && printsNumber(l, cell.samples) && printsNumber(l, doc.nFloor),
    )
    assert.ok(
      line,
      `${kind} ${id}: expected ONE ABSTAINED line naming it with n=${cell.samples} and the floor ${doc.nFloor};` +
        ` the ABSTAINED lines were:\n${markerLines.join('\n')}`,
    )
  }
  assert.equal(
    markerLines.length,
    cells.length,
    `exactly one marker per abstained cell — an extra marker is a row with no cell behind it;` +
      ` got:\n${markerLines.join('\n')}`,
  )
})

// ── 47. a SCORED cell is reachable through the CLI, and prints its metrics ───────────────
test('eval scorecard — a driver cell at or above the floor renders a metrics row, not an abstention', () => {
  const root = buildEvalFixture()
  // Six derived phases sharing 9001's driver, task count and surface, so their cohort cell
  // clears SCORECARD_N_FLOOR even before 9001 itself joins it.
  const SIBLING = 'EVALSIB'
  const siblingPhases = [9101, 9102, 9103, 9104, 9105, 9106]
  plantSiblingArc(root, SIBLING, siblingPhases)
  plantPrior(root, EVAL_DATE)
  plantPrior(root, EVAL_DATE, { arcId: SIBLING })

  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = readScorecard(root)
  const scored = doc.drivers.filter((c) => c.abstained === false)
  assert.equal(
    scored.length,
    1,
    `fixture precondition: exactly one driver cell should clear the floor of ${doc.nFloor};` +
      ` the driver cells were ${JSON.stringify(doc.drivers.map((c) => ({ model: c.model, band: c.taskCountBand, surface: c.surface, samples: c.samples })))}` +
      `\n(a zero here usually means the sibling arc's trace did not collect — check stdout for a WARN:\n${r.stdout})`,
  )
  const cell = scored[0]
  assert.ok(cell.samples >= doc.nFloor, `a scored cell is at or above the floor; got ${cell.samples}`)
  assert.equal(typeof cell.metrics, 'object', 'a scored cell carries its metrics')
  assert.ok(Object.keys(cell.metrics).length > 0, 'and the metrics record is not empty')

  const row = r.stdout
    .split('\n')
    .find((l) => l.includes(cell.model) && printsNumber(l, cell.samples) && !/ABSTAINED/.test(l))
  assert.ok(
    row,
    `the scored cell must render as a metrics row, never an abstention; stdout was:\n${r.stdout}`,
  )
  for (const [key, value] of Object.entries(cell.metrics))
    assert.ok(
      renderingsOf(value).some((v) => row.includes(v)),
      `the scored row must PRINT ${key}=${JSON.stringify(value)} (a metric computed and not shown is a metric nobody acts on); row was: ${row}`,
    )
  // The named absence rail travels to the reader too: a sentinel metric is printed as its word,
  // and the row above already proved it, so what is checked here is that it did not become 0.
  for (const [key, value] of Object.entries(cell.metrics))
    assert.notEqual(value, null, `${key} must be a number or a NAMED sentinel, never null`)

  const res = parsesConsumerShape(root, 'ScorecardShape', doc)
  assert.equal(res.ok, true, `got: ${res.detail}`)
})

// ── 48. THE PROJECTION IS NOT A BASELINE ─────────────────────────────────────────────────
test('eval scorecard — writing scorecard.json does not change what readPriorReports sees', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })
  plantPrior(root, EVAL_DATE, { all: 65 })

  const before = readPriorReports(evalsDir(root))
  assert.equal(before.length, 3, `fixture precondition: three dated reports; got ${before.length}`)

  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(scorecardPath(root)), 'fixture precondition: the projection was actually written')

  const after = readPriorReports(evalsDir(root))
  assert.equal(
    after.length,
    before.length,
    `the projection lands in the SAME directory the ratchet reads. A scorecard picked up as a` +
      ` prior would drag every future baseline toward a document that scores no dimension at all.` +
      ` Reports seen after: ${JSON.stringify(after.map((d) => d.date))}`,
  )

  // And the same fact through a REAL second command: the arc-eval run reports its baseline
  // sample count in the ratchet note, so a fourth "prior" would be visible there too.
  const second = roadmap(root, ['eval', ARC_ID, '--date', '2026-07-26'])
  assert.equal(second.code, 0, second.stdout + second.stderr)
  assert.equal(
    samplesOf(ratchetRow(readReport(root, '2026-07-26'), 'code-confidence')),
    before.length,
    'the ratchet counts exactly the dated REPORTS — the projection is not one of them',
  )
})

// ── 49. reproducibility — the committed artifact must not churn ──────────────────────────
test('eval scorecard — two runs at the same --date over the same corpus are BYTE-IDENTICAL', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)

  const first = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(first.code, 0, first.stdout + first.stderr)
  const firstBytes = readFileSync(scorecardPath(root), 'utf8')

  const second = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(second.code, 0, `the projection is regenerated in place, never refused: ${second.stdout + second.stderr}`)
  // Raw strings, not parsed objects: key order, indentation and the trailing newline are all
  // part of what shows up as a diff in the committed archive on every regeneration.
  assert.equal(
    readFileSync(scorecardPath(root), 'utf8'),
    firstBytes,
    'the same inputs and the same date must reproduce the same BYTES',
  )
})

// ── 50. the one wall-clock mint is LOUD ──────────────────────────────────────────────────
test('eval scorecard — an omitted --date defaults to today and SAYS so, naming the flag', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)

  const r = scorecard(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const now = new Date()
  const candidates = [now.toISOString().slice(0, 10), now.toLocaleDateString('sv-SE')]
  const doc = readScorecard(root)
  const today = candidates.find((d) => doc.generatedAt.startsWith(d))
  assert.ok(today, `generatedAt must be stamped with today; looked for ${candidates.join(' or ')}, got ${doc.generatedAt}`)

  const line = r.stdout.split('\n').find((l) => l.includes(today) && l.includes('--date'))
  assert.ok(
    line,
    `the defaulted date must be printed beside the --date flag that overrides it; stdout was:\n${r.stdout}`,
  )
})

// ── 51. --json ───────────────────────────────────────────────────────────────────────────
test('eval scorecard --json — stdout carries the document AND the file is still written', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)

  const r = scorecard(root, ['--date', EVAL_DATE, '--json'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(scorecardPath(root)), '--json is an ADDITIONAL lane; it does not suppress the write')

  const emitted = JSON.parse(r.stdout)
  assert.deepEqual(
    emitted,
    readScorecard(root),
    'the emitted document and the persisted one are the same document — two renderings that could drift are two contracts',
  )
})

// ── 52. NO POOLED ROW — checked against the document, not by grepping for a word ─────────
test('eval scorecard — nothing rendered or persisted claims a cross-cohort total', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)
  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = readScorecard(root)
  // (a) THE DOCUMENT: the envelope has exactly five keys, so there is nowhere for a summary,
  // an overall or a fleet mean to live. An added field would fail here by name.
  assert.deepEqual(
    Object.keys(doc).sort(),
    ['drivers', 'generatedAt', 'nFloor', 'notes', 'planners', 'reviewers'],
    'the envelope carries the three cell arrays and nothing that could hold a pooled figure',
  )

  const cells = scorecardCells(doc)
  assert.ok(cells.length > 1, 'fixture precondition: a pooled row is only meaningful over several cells')

  // (b) THE RENDERING: one row per cell and no row beyond them. Every rendered row is matched
  // back to a cell of the document rather than counted loosely.
  const rows = r.stdout.split('\n').filter((l) => /ABSTAINED/.test(l))
  assert.equal(rows.length, cells.length, `one row per cell; rows were:\n${rows.join('\n')}`)
  for (const line of rows)
    assert.ok(
      cells.some(({ id, cell }) => line.includes(id) && printsNumber(line, cell.samples)),
      `every rendered row must correspond to a real cell (identity + its own n); this one does not: ${line}`,
    )

  // (c) THE ONE NUMBER a pooled row would have to print: the cross-cohort sample total. It is
  // computed from the document rather than grepped for by name, so a summary row spelled
  // "fleet", "overall" or with no label at all is caught just the same.
  const total = cells.reduce((a, { cell }) => a + cell.samples, 0)
  assert.ok(
    !cells.some(({ cell }) => cell.samples === total),
    `fixture precondition: the pooled total (${total}) must not coincide with any cell's own n`,
  )
  assert.deepEqual(
    r.stdout.split('\n').filter((l) => printsNumber(l, total)),
    [],
    `no line may print the cross-cohort total ${total} — work is not randomly assigned, so a pooled` +
      ` figure is a comparison the data cannot support; stdout was:\n${r.stdout}`,
  )
})

// ── 53. an arc that will not collect is WARNed and EXCLUDED, never a hard failure ────────
test('eval scorecard — an enrolled arc whose trace cannot collect is named in a WARN and changes nothing', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)
  const clean = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(clean.code, 0, clean.stdout + clean.stderr)
  const cleanBytes = readFileSync(scorecardPath(root), 'utf8')

  // A dated report with no arc file behind it: enrolled by the corpus rule, uncollectable in
  // fact. The corpus is historical, so this is an ordinary state, not an error state.
  plantPrior(root, EVAL_DATE, { arcId: 'GHOSTARC' })
  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, `one uncollectable arc must not fail the sweep: ${r.stdout + r.stderr}`)

  const out = r.stdout + r.stderr
  assert.match(out, /WARN[\s\S]{0,200}GHOSTARC/, `the excluded arc must be named in a WARN; output was:\n${out}`)
  assert.equal(
    readFileSync(scorecardPath(root), 'utf8'),
    cleanBytes,
    'an excluded arc contributes NOTHING — not a cell, not a sample, not a zero',
  )
})

// ── 54. NON-SHADOWING: the new literal must not swallow the arc-id lane ──────────────────
test('eval <ARCID> — the `scorecard` literal shadows nothing; a bare arcid still reaches the arc-eval path', () => {
  const root = sharedFixture()
  // The cheap proof (same idiom as the `lesson` non-shadowing test): an arc id that does not
  // exist must still be refused BY THE ARC-EVAL LANE, which names the missing arc file.
  const r = roadmap(root, ['eval', 'NOSUCHARC', '--date', EVAL_DATE])
  assert.notEqual(r.code, 0, `a missing arc must never exit 0: ${r.stdout}`)
  const out = r.stdout + r.stderr
  assert.match(out, /NOSUCHARC/, 'the refusal names the arc it could not find')
  assert.match(out, /\.arc\.ts|arc file/, `it is the ARC-EVAL refusal, not a scorecard usage line; got:\n${out}`)
  assert.equal(existsSync(scorecardPath(root)), false, 'and an arc id never regenerates the projection')
})

// ══ `roadmap eval propose` — the ELICIT stage at the COMMAND seam ══════════════════════════
// The clustering, scoring and consolidation arithmetic belongs to cli/lib/eval-propose.test.mjs
// and is deliberately not restated here. What this section pins is everything that only exists
// once the library is wired to a real repo through the real bin:
//
//   (a) THE DOCUMENTS THAT REACH DISK ARE PROPOSALS. Every written file is re-validated against
//       the CONSUMER's ProposalShape through the tsx bridge, not against this test's belief
//       about the contract — the same rail every other recorder in this file holds.
//   (b) THE ORDER THE READER SEES. A queue printed in corpus order is a queue nobody can act on;
//       the expected order is derived from the WRITTEN files (read, sort by score) so the
//       assertion cannot silently agree with a hardcoded table that drifted.
//   (c) THE REFUSALS ARE VISIBLE. A singleton, a lane-less cluster, a thin corpus and an absent
//       lessons sidecar are all NAMED in the output. A loop that drops findings quietly is the
//       one failure that makes every green run meaningless.
//   (d) THE TWO LANES AND THE TWO SIDE-EFFECT MODES. --json keeps stdout machine-clean; --dry-run
//       writes nothing at all, proven by a following real run that DOES write.
//   (e) PROVENANCE THROUGH THE CLI. A foreign-origin file in the proposals directory survives a
//       real run byte-for-byte.
//
// The corpus is the shared planted fixture (cli/testdata/eval-proposals/), copied into a tmp
// consumer's roadmap/arc-evals/ so the command reads it exactly as it reads a committed archive.

import { spawnSync } from 'node:child_process'
import { FIXTURE_DIR, REPORT_FILES, LESSONS_FILE } from '../testdata/eval-proposals/load-fixture.mjs'
import { clusterFindings, extractFindings, proposalId } from '../lib/eval-propose.mjs'

const proposalsDir = (root) => join(evalsDir(root), 'proposals')

/** Copy the planted corpus into a consumer's archive. `reports`/`lessons` narrow it, which is how
 *  the thin-corpus and absent-sidecar tests get their own honest corpus rather than a mutated one. */
function seedProposalCorpus(root, { reports = REPORT_FILES, lessons = true } = {}) {
  mkdirSync(evalsDir(root), { recursive: true })
  for (const f of reports) writeFileSync(join(evalsDir(root), f), readFileSync(join(FIXTURE_DIR, f), 'utf8'))
  if (lessons) writeFileSync(join(evalsDir(root), LESSONS_FILE), readFileSync(join(FIXTURE_DIR, LESSONS_FILE), 'utf8'))
  return root
}

/**
 * What the SHIPPED library says the seeded corpus supports. Derived rather than tabulated: a
 * hardcoded count here would turn a fixture edit into a false red about the command, and the
 * expectation tables already live in cli/lib/eval-propose.test.mjs where the corpus is defined.
 */
function expectedFromCorpus({ reports = REPORT_FILES, lessons = true } = {}) {
  const parsedReports = reports.map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')))
  const parsedLessons = lessons
    ? readFileSync(join(FIXTURE_DIR, LESSONS_FILE), 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l))
    : []
  const result = clusterFindings(extractFindings(parsedReports, parsedLessons))
  return { ...result, ids: result.clusters.map(proposalId) }
}

/** The proposal filenames on disk, sorted; an absent directory reads as "nothing written". */
const proposalFiles = (root) =>
  existsSync(proposalsDir(root)) ? readdirSync(proposalsDir(root)).filter((f) => f.endsWith('.json')).sort() : []

const readProposal = (root, name) => JSON.parse(readFileSync(join(proposalsDir(root), name), 'utf8'))

/**
 * A LOCAL driver, because the shared `roadmap()` helper hardcodes `stderr: ''` on success
 * (execFileSync only surfaces stderr on the throw path), and this command's whole two-lane
 * contract lives in what reaches STDERR on an exit-0 run — unobservable through that helper.
 * Same arguments, same cwd, both streams captured either way.
 */
function runBin(root, args) {
  const r = spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 120_000 })
  if (r.error) throw r.error
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * Run the pass and guard against a false red/green. Until the subcommand exists, `propose` is
 * swallowed by the bare-arcid lane and refused as a missing arc file — a non-zero exit with a
 * message on stderr, which several assertions below would otherwise "pass" against for entirely
 * the wrong reason. (Same guard idiom as `mergeJudge`, `lesson` and `scorecard` above.)
 */
function propose(root, args = []) {
  const r = runBin(root, ['eval', 'propose', ...args])
  assert.doesNotMatch(
    r.stderr,
    /propose\.arc\.ts/,
    `'propose' was parsed as an ARC ID, not dispatched as a subcommand:\n${r.stderr}`,
  )
  return r
}

/**
 * ONE full run over the full corpus, shared by the read-only tests below (each proposal costs a
 * tsx bridge spawn, so a fresh run per assertion would dominate the file's runtime). Nothing here
 * mutates the root, and every test that writes — dry-run, idempotence, provenance, the narrowed
 * corpora — builds its own consumer instead.
 */
let fullProposeRun = null
function sharedProposeRun() {
  if (fullProposeRun === null) {
    const root = seedProposalCorpus(makeConsumer())
    const run = propose(root)
    fullProposeRun = { root, run }
  }
  return fullProposeRun
}

// ── 55. end to end: one document per cluster, and every one of them is a PROPOSAL ────────
test('eval propose — writes one proposal per emitted cluster and every file satisfies the CONSUMER ProposalShape', () => {
  const { root, run } = sharedProposeRun()
  assert.equal(run.code, 0, run.stdout + run.stderr)

  const expected = expectedFromCorpus()
  assert.ok(expected.ids.length > 1, `fixture precondition: the corpus must support several clusters; got ${expected.ids.length}`)

  assert.deepEqual(
    proposalFiles(root),
    [...expected.ids].map((id) => `${id}.json`).sort(),
    'exactly one <id>.json per cluster the library emits — an extra file is a proposal with no cluster behind it',
  )

  for (const name of proposalFiles(root)) {
    const doc = readProposal(root, name)
    assert.equal(`${doc.id}.json`, name, `${name}: the file is addressed by the id inside it, or a re-run cannot find it`)
    assert.equal(doc.status, 'surfaced', `${name}: the pass may only ever mint 'surfaced' — anything else is self-ratification`)
    assert.ok(doc.evidence.length >= 2, `${name}: the >=2 floor reaches disk; got ${doc.evidence.length}`)
    const res = parsesConsumerShape(root, 'ProposalShape', doc)
    assert.equal(res.ok, true, `${name} must satisfy ProposalShape; got: ${res.detail}`)
  }
})

// ── 56. the queue is printed in priority order ───────────────────────────────────────────
test('eval propose — the printed proposal lines run in opportunity.score DESCENDING order', () => {
  const { root, run } = sharedProposeRun()
  assert.equal(run.code, 0, run.stdout + run.stderr)

  const written = proposalFiles(root).map((name) => readProposal(root, name))
  assert.ok(written.length > 1, 'fixture precondition: ordering needs more than one proposal')
  // Without two DIFFERENT scores any ordering satisfies "descending" and the assertion below is
  // vacuous — the corpus has to be able to tell a right order from a wrong one.
  assert.ok(
    new Set(written.map((d) => d.opportunity.score)).size >= 2,
    `fixture precondition: at least two distinct scores; got ${JSON.stringify(written.map((d) => d.opportunity.score))}`,
  )

  const positions = written.map((d) => ({ id: d.id, score: d.opportunity.score, at: run.stdout.indexOf(d.id) }))
  for (const p of positions)
    assert.notEqual(p.at, -1, `every written proposal must appear in the human output; ${p.id} did not:\n${run.stdout}`)

  const printed = [...positions].sort((a, b) => a.at - b.at)
  for (let i = 1; i < printed.length; i += 1)
    assert.ok(
      printed[i - 1].score >= printed[i].score,
      `the queue must read highest-opportunity first: ${printed[i - 1].id} (${printed[i - 1].score}) printed above ` +
        `${printed[i].id} (${printed[i].score}); stdout was:\n${run.stdout}`,
    )

  // Each line carries what a reader needs to triage without opening the file.
  for (const d of written) {
    const line = run.stdout.split('\n').find((l) => l.includes(d.id))
    assert.ok(line, `${d.id} must own a line; stdout was:\n${run.stdout}`)
    assert.ok(line.includes(d.lane), `${d.id}: the line must name its lane ${d.lane}; got ${line}`)
    assert.ok(line.includes(d.kind), `${d.id}: the line must name its kind ${d.kind}; got ${line}`)
    assert.ok(line.includes(d.status), `${d.id}: the line must name its status ${d.status}; got ${line}`)
    assert.ok(printsNumber(line, d.evidence.length), `${d.id}: the line must carry its evidence count; got ${line}`)
    assert.ok(
      renderingsOf(d.opportunity.score).some((v) => line.includes(v)),
      `${d.id}: the line must print the score it is ranked by (${d.opportunity.score}); got ${line}`,
    )
  }
})

// ── 57. the two lanes: stdout is machine-clean under --json ──────────────────────────────
test('eval propose --json — stdout ALONE parses as the proposal array; the human summary is on stderr', () => {
  const root = seedProposalCorpus(makeConsumer())
  const r = propose(root, ['--json'])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const emitted = JSON.parse(r.stdout)
  assert.ok(Array.isArray(emitted), `the --json lane emits an ARRAY of proposals; got ${typeof emitted}`)
  const files = proposalFiles(root)
  assert.ok(files.length > 0, 'fixture precondition: the run must have written something to compare against')
  assert.equal(emitted.length, files.length, 'the emitted array and the written set are the same set')
  assert.deepEqual(
    emitted.map((d) => d.id).sort(),
    files.map((f) => f.replace(/\.json$/, '')).sort(),
    'and the same documents, not two renderings that could drift',
  )

  // The token is one of the named counts, which is prose no JSON consumer can swallow. If it
  // appears on stdout the pipe into JSON.parse breaks for every caller.
  assert.doesNotMatch(r.stdout, /skippedSingletons/, `the human summary must not leak into the JSON lane; stdout was:\n${r.stdout}`)
  assert.match(r.stderr, /skippedSingletons/, `the summary still has to reach the operator, on stderr; stderr was:\n${r.stderr}`)
})

// ── 58. --dry-run writes NOTHING, and the same corpus proves it would have ───────────────
test('eval propose --dry-run — creates no directory and no file, but names the paths it would write', () => {
  const root = seedProposalCorpus(makeConsumer())
  const expected = expectedFromCorpus()

  const dry = propose(root, ['--dry-run'])
  assert.equal(dry.code, 0, dry.stdout + dry.stderr)
  assert.equal(
    existsSync(proposalsDir(root)),
    false,
    'a dry run may not even mint the directory — an empty directory in a committed archive is a side effect',
  )
  assert.deepEqual(proposalFiles(root), [], 'and nothing at all was written')
  for (const id of expected.ids)
    assert.ok(
      dry.stdout.includes(`${id}.json`),
      `a dry run has to name the path it WOULD have written (${id}.json); stdout was:\n${dry.stdout}`,
    )

  // The assertion above is only about the FLAG if the very same corpus writes when the flag is
  // dropped. Otherwise a run that is simply broken passes the dry-run test.
  const real = propose(root)
  assert.equal(real.code, 0, real.stdout + real.stderr)
  assert.deepEqual(
    proposalFiles(root),
    [...expected.ids].map((id) => `${id}.json`).sort(),
    'the identical invocation without --dry-run writes every one of those files',
  )
})

// ── 59. an absent lessons sidecar is a NAMED absence, not a crash and not a zero ─────────
test('eval propose — with no lessons.jsonl the run succeeds, SAYS the sidecar is absent, and still emits the report-backed proposals', () => {
  const root = seedProposalCorpus(makeConsumer(), { lessons: false })
  assert.equal(existsSync(join(evalsDir(root), LESSONS_FILE)), false, 'fixture precondition: no sidecar')

  const r = propose(root)
  assert.equal(r.code, 0, `an absent sidecar is an ordinary corpus state, not a failure: ${r.stdout + r.stderr}`)

  const out = r.stdout + r.stderr
  assert.match(out, /lessons\.jsonl/, `the absence must be NAMED, not silently read as zero lessons; output was:\n${out}`)

  const expected = expectedFromCorpus({ lessons: false })
  const withLessons = expectedFromCorpus()
  assert.ok(
    expected.ids.length < withLessons.ids.length,
    'fixture precondition: the sidecar really does contribute proposals, or this test proves nothing',
  )
  assert.deepEqual(
    proposalFiles(root),
    [...expected.ids].map((id) => `${id}.json`).sort(),
    'exactly the report-backed subset survives',
  )
  assert.deepEqual(
    proposalFiles(root).filter((f) => f.startsWith('recurring-lesson-key')),
    [],
    'and no lesson-key proposal is minted out of a file that does not exist',
  )
})

// ── 60. a corpus that supports nothing says so, honestly, and exits 0 ────────────────────
test('eval propose — a single-report corpus prints the exact too-thin line, writes nothing, exits 0', () => {
  const root = seedProposalCorpus(makeConsumer(), { reports: [REPORT_FILES[0]], lessons: false })
  const expected = expectedFromCorpus({ reports: [REPORT_FILES[0]], lessons: false })
  assert.equal(expected.clusters.length, 0, 'fixture precondition: one report can only produce singletons')
  assert.ok(expected.skippedSingletons > 0, 'fixture precondition: and it does produce some')

  const r = propose(root)
  assert.equal(r.code, 0, `nothing to propose is not an error: ${r.stdout + r.stderr}`)
  assert.ok(
    (r.stdout + r.stderr).includes('corpus too thin: every candidate cluster below the 2-finding floor'),
    `the empty result must be stated in words rather than shown as an empty list; output was:\n${r.stdout + r.stderr}`,
  )
  assert.deepEqual(proposalFiles(root), [], 'and no proposal is manufactured to fill the silence')
})

// ── 61. idempotence through the CLI — a committed artifact must not churn ────────────────
test('eval propose — a second run over the same corpus is BYTE-IDENTICAL and reports zero created', () => {
  const root = seedProposalCorpus(makeConsumer())
  const first = propose(root)
  assert.equal(first.code, 0, first.stdout + first.stderr)
  const before = Object.fromEntries(proposalFiles(root).map((f) => [f, readFileSync(join(proposalsDir(root), f), 'utf8')]))
  assert.ok(Object.keys(before).length > 0, 'fixture precondition: the first run wrote something')

  const second = propose(root)
  assert.equal(second.code, 0, `a re-run regenerates in place, it is not refused: ${second.stdout + second.stderr}`)
  const after = Object.fromEntries(proposalFiles(root).map((f) => [f, readFileSync(join(proposalsDir(root), f), 'utf8')]))
  // Raw strings, not parsed objects: indentation, key order, the trailing newline and the
  // updatedAt stamp are all part of what shows up as a diff in the committed archive every run.
  assert.deepEqual(after, before, 'the same corpus must reproduce the same BYTES on every run')
  assert.match(
    second.stdout + second.stderr,
    /created\D{0,4}0(?!\d)/,
    `the second run created nothing and has to say so; output was:\n${second.stdout + second.stderr}`,
  )
})

// ── 62. the refusals are COUNTED, by name, with their real numbers ───────────────────────
test('eval propose — the output names skippedSingletons and skippedNoLane carrying the values the library computed', () => {
  const { run } = sharedProposeRun()
  assert.equal(run.code, 0, run.stdout + run.stderr)

  const expected = expectedFromCorpus()
  assert.ok(expected.skippedSingletons > 0 && expected.skippedNoLane > 0, 'fixture precondition: both refusals are exercised')

  const out = run.stdout + run.stderr
  for (const [name, value] of [
    ['skippedSingletons', expected.skippedSingletons],
    ['skippedNoLane', expected.skippedNoLane],
  ]) {
    // One line has to carry the label AND its number: a count printed three lines from its name
    // leaves the reader to guess which refusal it belongs to.
    const line = out.split('\n').find((l) => l.includes(name) && printsNumber(l, value))
    assert.ok(line, `expected a line naming ${name} with its value ${value}; output was:\n${out}`)
  }
})

// ── 63. provenance through the CLI — a foreign file is untouched and reported ────────────
test('eval propose — a foreign writeOrigin file in the proposals dir survives byte-for-byte and is named', () => {
  const root = seedProposalCorpus(makeConsumer())
  mkdirSync(proposalsDir(root), { recursive: true })
  const foreignName = 'user-authored-note.json'
  const foreignPath = join(proposalsDir(root), foreignName)
  const foreignBytes = JSON.stringify({ id: 'user-authored-note', writeOrigin: 'user', note: 'written by hand' }, null, 2) + '\n'
  writeFileSync(foreignPath, foreignBytes)

  const r = propose(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.equal(
    readFileSync(foreignPath, 'utf8'),
    foreignBytes,
    'a file the loop did not write is not the loop\'s to reformat, repair or replace',
  )
  assert.ok(
    (r.stdout + r.stderr).includes('user-authored-note'),
    `the skipped foreign file must be reported BY NAME; output was:\n${r.stdout + r.stderr}`,
  )
  const expected = expectedFromCorpus()
  assert.deepEqual(
    proposalFiles(root).filter((f) => f !== foreignName),
    [...expected.ids].map((id) => `${id}.json`).sort(),
    'and it neither blocks nor displaces the run\'s own proposals',
  )
})

// ── 64. NON-SHADOWING: `propose` is a literal, never an arc id ───────────────────────────
test('eval propose — the literal is dispatched before the arc-id fallthrough, so no dated report is minted', () => {
  const { root, run } = sharedProposeRun()
  // The artifacts are the proof, not the exit code: the arc-id fallthrough ALSO exits non-zero
  // on a missing arc, so "it failed" would look identical before the subcommand existed.
  assert.equal(run.code, 0, run.stdout + run.stderr)
  assert.ok(existsSync(proposalsDir(root)), 'the run really reached the propose lane')

  const dated = readdirSync(evalsDir(root)).filter((f) => /^propose-\d{4}-\d{2}-\d{2}\.json$/.test(f))
  assert.deepEqual(dated, [], `'propose' must never be scored as an arc; found ${JSON.stringify(dated)}`)
})

// ── 65. discoverability ──────────────────────────────────────────────────────────────────
test('roadmap --help — the eval entry advertises the propose subcommand', () => {
  const root = sharedFixture()
  const r = roadmap(root, ['--help'])
  assert.equal(r.code, 0, r.stderr)
  const line = r.stdout.split('\n').find((l) => /^\s*eval\b/.test(l))
  assert.ok(line, `--help must list eval; stdout was:\n${r.stdout}`)
  assert.match(line, /propose/, `a subcommand missing from the TREE is a subcommand nobody finds; the eval line was:\n${line}`)
})

// ══ `roadmap eval trend` — the OPEN PROPOSALS section ═══════════════════════════════════════
// A proposal that only lives in a directory rots there unseen. The trend page is the one place a
// human already looks at the corpus across arcs, so it is where open proposals have to surface —
// and there are exactly two silences that must be impossible:
//   (a) a MISSING section, which reads as a broken page;
//   (b) an EMPTY TABLE with no sentence, which reads as a claim nobody made.
// What the section owes, and what these tests pin:
//   1. a table of `status === 'surfaced'` rows ONLY, sorted by opportunity.score DESCENDING,
//      each row carrying score / lane / kind / title / evidence count / createdAt;
//   2. a one-line count of the non-surfaced OWN proposals (ratified, rejected, archived) — those
//      are counted, never tabled, or a decided proposal re-enters the queue as an open one;
//   3. parse-failures and foreign-`writeOrigin` files named BY FILENAME in a footnote — a file
//      the page cannot read is a fact about the corpus, not something to drop;
//   4. `no open proposals` in words whenever there is nothing to table;
//   5. the existing trend contract untouched: exit 0, trend.html written, the wrote-line printed.
//
// ONE RENDERING CONTRACT the assertions require (the analogue of the `id="dim-<key>"` anchor the
// chart tests pin): the section is a real `<table>` whose proposal rows are `<tr>` elements
// containing `<td>` cells. That is what makes "exactly these rows, in this order" machine-
// checkable rather than eyeball-checkable, so the implementation owes it.
//
// The fixtures are built by a LOCAL factory (one good document, copy-mutated) rather than by
// running `roadmap eval propose` first, for two reasons: these tests need controlled scores,
// distinct titles, a specific archived document and two deliberately BROKEN files, none of which
// a real pass emits; and deriving them from the propose corpus would turn an edit to that fixture
// into a false red about the trend page. The honesty the generated route would have bought is
// bought instead by validating the base document against the CONSUMER's ProposalShape through the
// tsx bridge in the first test — so the factory cannot encode this test author's belief about the
// contract.

/** The impl's own escaping (cli/commands/eval.mjs `esc`), so assertions compare like with like. */
const escHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A VALID surfaced proposal, mutated by copy. `opportunity` merges rather than replaces so a
 * caller can move the score alone without restating the ruling provenance beside it.
 * The scores follow the real prioritizer (importance + max(importance - satisfaction, 0)), which
 * is what OpportunityShape's refine is about — a fixture that ignored it would not parse.
 */
const PROPOSAL_BASE = {
  id: 'recurring-sentinel-doc-brevity',
  findingClass: 'recurring-sentinel',
  lane: 'plugin-generic',
  kind: 'process-change',
  title: 'name the unjudged dimensions in the arc-end summary',
  rationale: 'four dimensions carried a sentinel in every report of this corpus and nobody was told',
  evidence: [
    { file: 'roadmap/arc-evals/A-2026-07-02.json', jsonPath: 'dimensions.doc-brevity.sentinel', excerpt: 'pending-judge' },
    { file: 'roadmap/arc-evals/A-2026-07-03.json', jsonPath: 'dimensions.doc-brevity.sentinel', excerpt: 'pending-judge' },
  ],
  opportunity: {
    importance: 9,
    satisfaction: 4,
    score: 14,
    rulingId: 'recurring-sentinel-weight',
    rulingsVersion: 1,
    satisfactionSource: 'measured over the dated reports in roadmap/arc-evals/',
  },
  writeOrigin: 'roadmap-eval-loop',
  status: 'surfaced',
  createdAt: '2026-07-10',
  updatedAt: '2026-07-10',
}

/** Write one proposal into roadmap/arc-evals/proposals/<id>.json and hand the document back. */
function plantProposal(root, overrides = {}) {
  const doc = {
    ...PROPOSAL_BASE,
    ...overrides,
    opportunity: { ...PROPOSAL_BASE.opportunity, ...(overrides.opportunity ?? {}) },
  }
  mkdirSync(proposalsDir(root), { recursive: true })
  writeFileSync(join(proposalsDir(root), `${doc.id}.json`), JSON.stringify(doc, null, 2) + '\n')
  return doc
}

/** The slice of the page from the Open proposals heading onward (the section is the page's last). */
function proposalsSection(html) {
  const at = html.search(/Open proposals/)
  assert.notEqual(
    at,
    -1,
    'the page must carry an "Open proposals" section — a missing section reads as a broken page,' +
      ' which is one of the two silences this section exists to make impossible',
  )
  return html.slice(at)
}

/** The proposal ROWS of that section: `<tr>` elements carrying `<td>` cells (the header has none). */
const proposalRows = (html) =>
  [...proposalsSection(html).matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(([tr]) => tr).filter((tr) => /<td\b/.test(tr))

/** Section text with tags flattened to spaces — a count split across `<strong>` is still one
 *  sentence to a reader, so the count assertions read the page the way a reader does. */
const flattenTags = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

/** Does the section state `<word>` with the number `n` beside it (within one short window)? */
function statesCount(section, word, n) {
  const text = flattenTags(section)
  for (const m of text.matchAll(new RegExp(word, 'gi'))) {
    const window = text.slice(Math.max(0, m.index - 32), m.index + word.length + 32)
    if (printsNumber(window, n)) return true
  }
  return false
}

// ── 66. POPULATED: surfaced rows in score order, the archived one COUNTED and not tabled ──
test('eval trend — the Open proposals table lists surfaced proposals highest-score first and only COUNTS the archived one', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })

  const top = plantProposal(root, {
    id: 'recurring-regression-code-confidence',
    title: 'anchor the escape window to the land record',
    kind: 'schema-tightening',
    lane: 'plugin-generic',
    createdAt: '2026-07-10',
    evidence: [
      { file: 'roadmap/arc-evals/A-2026-07-02.json', jsonPath: 'ratchet[0]', excerpt: 'regression: true' },
      { file: 'roadmap/arc-evals/A-2026-07-03.json', jsonPath: 'ratchet[0]', excerpt: 'regression: true' },
      { file: 'roadmap/arc-evals/lessons.jsonl', jsonPath: 'line 4', excerpt: 'the escape window drifted again' },
    ],
    opportunity: { importance: 9, satisfaction: 4, score: 14 },
  })
  const lower = plantProposal(root, {
    id: 'recurring-lesson-key-phase-file',
    title: 're-read the phase file before editing it',
    kind: 'process-change',
    lane: 'consumer-specific',
    createdAt: '2026-07-11',
    opportunity: { importance: 6, satisfaction: 5, score: 7 },
  })
  const archived = plantProposal(root, {
    id: 'recurring-low-score-speed',
    title: 'raise the speed reference for surface-heavy phases',
    status: 'archived',
    archivedReason: 'superseded by the declared speed-reference-8 reset, which already recalibrated it',
    createdAt: '2026-07-09',
    opportunity: { importance: 8, satisfaction: 2, score: 14 },
  })

  // The factory is only trustworthy if the CONSUMER's own contract accepts what it produces —
  // otherwise these fixtures encode a belief about ProposalShape rather than the shape itself.
  for (const doc of [top, lower, archived]) {
    const res = parsesConsumerShape(root, 'ProposalShape', doc)
    assert.equal(res.ok, true, `fixture precondition: ${doc.id} must satisfy ProposalShape; got: ${res.detail}`)
  }
  // Ordering is only a claim if the two scores can distinguish a right order from a wrong one.
  assert.notEqual(
    top.opportunity.score,
    lower.opportunity.score,
    'fixture precondition: two DIFFERENT scores, or "sorted descending" is satisfied by any order',
  )
  assert.ok(top.opportunity.score > lower.opportunity.score, 'fixture precondition: `top` is the higher-scoring one')

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(trendPath(root)), `the existing contract holds: the page at ${trendPath(root)}`)
  assert.match(r.stdout, rx(trendPath(root)), 'and the run still names the file it wrote')

  const html = readFileSync(trendPath(root), 'utf8')
  const section = proposalsSection(html)

  // PRESENT first, so the absence assertion below cannot pass over a section that rendered nothing.
  assert.ok(section.includes(escHtml(top.title)), `the higher-scoring proposal must be listed; section was:\n${section}`)
  assert.ok(section.includes(escHtml(lower.title)), `the lower-scoring proposal must be listed; section was:\n${section}`)
  assert.ok(
    section.indexOf(escHtml(top.title)) < section.indexOf(escHtml(lower.title)),
    `the table reads highest-opportunity first: ${top.id} (${top.opportunity.score}) must precede ` +
      `${lower.id} (${lower.opportunity.score}); section was:\n${section}`,
  )

  // A decided proposal that reappears in the open queue is a decision re-opened by a renderer.
  assert.equal(
    html.includes(escHtml(archived.title)),
    false,
    `an archived proposal is COUNTED, never tabled — its title must not appear anywhere on the page;` +
      ` page was:\n${html}`,
  )
  assert.ok(statesCount(section, 'archived', 1), `the section must state the archived count of 1; section was:\n${section}`)
  // All three non-surfaced statuses are accounted for, or a reader cannot tell "none rejected"
  // from "rejections are not counted here at all".
  for (const word of ['ratified', 'rejected', 'archived'])
    assert.match(flattenTags(section), new RegExp(word, 'i'), `the one-line count must name ${word}`)

  const rows = proposalRows(html)
  assert.equal(
    rows.length,
    2,
    `exactly the two SURFACED proposals are rows — three files, one of them decided; rows were:\n${rows.join('\n')}`,
  )
  for (const doc of [top, lower]) {
    const row = rows.find((tr) => tr.includes(escHtml(doc.title)))
    assert.ok(row, `${doc.id} must own a table row; rows were:\n${rows.join('\n')}`)
    assert.ok(row.includes(doc.lane), `${doc.id}: the row must name its lane ${doc.lane}; got ${row}`)
    assert.ok(row.includes(doc.kind), `${doc.id}: the row must name its kind ${doc.kind}; got ${row}`)
    assert.ok(
      renderingsOf(doc.opportunity.score).some((v) => row.includes(v)),
      `${doc.id}: the row must print the score it is ranked by (${doc.opportunity.score}); got ${row}`,
    )
    assert.ok(
      printsNumber(row, doc.evidence.length),
      `${doc.id}: the row must carry its evidence count (${doc.evidence.length}) — a proposal's weight is how` +
        ` much backs it; got ${row}`,
    )
    assert.ok(row.includes(doc.createdAt), `${doc.id}: the row must carry createdAt ${doc.createdAt}; got ${row}`)
  }
})

// ── 67. EMPTY, TWO WAYS — a missing directory and an empty result are DIFFERENT code paths ──
// One returns early on a stat, the other falls through the filter with nothing left, and an
// implementation can easily get one right and the other wrong. Both must produce the same honest
// sentence, because to a reader they are the same fact: there is nothing open to look at.
test('eval trend — with NO proposals directory the section still renders and says "no open proposals"', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })
  assert.equal(existsSync(proposalsDir(root)), false, 'fixture precondition: no proposals directory at all')

  const r = evalTrend(root)
  assert.equal(r.code, 0, `an absent proposals directory is an ordinary corpus state: ${r.stdout + r.stderr}`)

  const html = readFileSync(trendPath(root), 'utf8')
  const section = proposalsSection(html)
  assert.ok(
    section.includes('no open proposals'),
    `an empty table with no sentence reads as a claim nobody made; section was:\n${section}`,
  )
  assert.deepEqual(proposalRows(html), [], 'and nothing is tabled — there is nothing to table')
  assert.equal(existsSync(proposalsDir(root)), false, 'rendering the page mints no directory as a side effect')
})

test('eval trend — a proposals directory holding ONLY a non-surfaced proposal says "no open proposals" too', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })
  const ratified = plantProposal(root, {
    id: 'recurring-sentinel-plan-quality',
    title: 'require a named plan artifact per phase',
    status: 'ratified',
  })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const html = readFileSync(trendPath(root), 'utf8')
  const section = proposalsSection(html)
  assert.ok(
    section.includes('no open proposals'),
    `zero SURFACED rows is the same fact as no directory, and must read the same; section was:\n${section}`,
  )
  assert.deepEqual(proposalRows(html), [], 'a ratified proposal is not an open one and may not be tabled')
  assert.equal(
    html.includes(escHtml(ratified.title)),
    false,
    'a decided proposal is counted, never surfaced back into the open queue',
  )
  assert.ok(statesCount(section, 'ratified', 1), `the count must be DATA-driven — 1 ratified here; section was:\n${section}`)
})

// ── 68. PROVENANCE FOOTNOTE — an unreadable and a foreign file are named, never dropped ─────
test('eval trend — an unparseable and a foreign-origin proposal file are named in a footnote, tabled as nothing, and untouched', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })
  const valid = plantProposal(root, {
    id: 'recurring-regression-speed',
    title: 'record the reference minutes on every timed phase',
  })

  const brokenName = 'half-written-proposal.json'
  const brokenPath = join(proposalsDir(root), brokenName)
  const brokenBytes = '{"id":"half-written-proposal","status":"surfaced"'
  writeFileSync(brokenPath, brokenBytes)

  const foreignName = 'user-authored-note.json'
  const foreignPath = join(proposalsDir(root), foreignName)
  const FOREIGN_TITLE = 'a proposal a human wrote by hand in this directory'
  const foreignBytes =
    JSON.stringify({ ...PROPOSAL_BASE, id: 'user-authored-note', title: FOREIGN_TITLE, writeOrigin: 'user' }, null, 2) + '\n'
  writeFileSync(foreignPath, foreignBytes)

  const r = evalTrend(root)
  assert.equal(r.code, 0, `two unusable files must not fail the render: ${r.stdout + r.stderr}`)
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'an unreadable file is a reported fact, not a leaked stack')

  const html = readFileSync(trendPath(root), 'utf8')
  const section = proposalsSection(html)

  // PRESENT first: the row assertions below mean nothing if the section rendered empty.
  assert.ok(section.includes(escHtml(valid.title)), `the readable own proposal must still be tabled; section was:\n${section}`)
  assert.ok(section.includes(brokenName), `the unparseable file must be named BY FILENAME; section was:\n${section}`)
  assert.ok(section.includes(foreignName), `the foreign-origin file must be named BY FILENAME; section was:\n${section}`)

  const rows = proposalRows(html)
  assert.equal(rows.length, 1, `exactly the ONE own, readable, surfaced proposal is a row; rows were:\n${rows.join('\n')}`)
  assert.ok(rows[0].includes(escHtml(valid.title)), `and it is the valid one; got ${rows[0]}`)
  assert.equal(
    rows.some((tr) => tr.includes(escHtml(FOREIGN_TITLE))),
    false,
    'a file the loop did not write is REPORTED, never rendered as one of its own proposals',
  )

  // Rendering is a read. A page generator that "repaired" a file it could not parse would be
  // editing a committed archive nobody asked it to touch.
  assert.equal(readFileSync(brokenPath, 'utf8'), brokenBytes, 'the unparseable file is byte-for-byte untouched')
  assert.equal(readFileSync(foreignPath, 'utf8'), foreignBytes, 'and so is the foreign one')
})

// ── 69. HTML SAFETY — the new section escapes through the page's own esc() ──────────────────
test('eval trend — a proposal title carrying markup is ESCAPED into the table, not dropped and not injected', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  const HOSTILE = 'audit <script>alert(1)</script> & the rehydration map'
  const doc = plantProposal(root, { id: 'recurring-lesson-key-masking', title: HOSTILE })
  const res = parsesConsumerShape(root, 'ProposalShape', doc)
  assert.equal(res.ok, true, `fixture precondition: the hostile-titled proposal is a VALID proposal; got: ${res.detail}`)

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const html = readFileSync(trendPath(root), 'utf8')

  assert.equal(
    html.includes('<script>alert(1)</script>'),
    false,
    'the raw markup must never reach the page — the section owes the same esc() every other cell uses',
  )
  // Escaping, not dropping: a renderer that silently skipped the row would also pass the line
  // above while losing a real proposal.
  assert.ok(
    proposalsSection(html).includes(escHtml(HOSTILE)),
    `the title must be present in ESCAPED form; section was:\n${proposalsSection(html)}`,
  )
  assert.ok(html.includes('&amp;'), 'the ampersand is escaped too, or the escaper is a < > special case')
  const rows = proposalRows(html)
  assert.equal(rows.length, 1, `the row is rendered, not dropped; rows were:\n${rows.join('\n')}`)
})

// ── 70. NO STAND-IN ZERO — a surfaced own document with no numeric score is footnoted ────────
// Test 68 covers the two files the READER cannot use at all: unparseable bytes, and a foreign
// writeOrigin. It cannot catch the third: a document that IS the loop's own and IS surfaced, but
// whose opportunity block is missing or truncated. The page used to table it with `?? 0`, and to
// SORT on that 0 — which is precisely the stand-in zero the corpus forbids everywhere else, since
// `0` reads as "measured, and worthless" for something nobody ever measured. A number that was
// never taken belongs in the same named footnote as a file that will not parse.
//
// A local raw planter rather than plantProposal: that factory MERGES the opportunity block by
// design, so it cannot express the absence of one.

/** Write a document verbatim into the proposals directory; return its filename. */
function plantRawProposal(root, doc) {
  mkdirSync(proposalsDir(root), { recursive: true })
  const name = `${doc.id}.json`
  writeFileSync(join(proposalsDir(root), name), JSON.stringify(doc, null, 2) + '\n')
  return name
}

for (const [label, mangle] of [
  ['NO opportunity block at all', (d) => { delete d.opportunity }],
  ['a STRING where the score should be', (d) => { d.opportunity = { ...d.opportunity, score: '14' } }],
]) {
  test(`eval trend — a surfaced own proposal with ${label} is named in the footnote, never tabled with a stand-in 0`, () => {
    const root = buildEvalFixture()
    plantPrior(root, '2026-07-02', { all: 60 })
    plantPrior(root, '2026-07-03', { all: 70 })

    const valid = plantProposal(root, {
      id: 'recurring-regression-speed',
      title: 'record the reference minutes on every timed phase',
      opportunity: { importance: 9, satisfaction: 4, score: 14 },
    })

    const SCORELESS_TITLE = 'a truncated own document nobody ever scored'
    const scoreless = { ...PROPOSAL_BASE, id: 'recurring-sentinel-plan-quality', title: SCORELESS_TITLE }
    mangle(scoreless)
    const scorelessName = plantRawProposal(root, scoreless)

    // Preconditions: this document is the loop's OWN and SURFACED, so test 68's provenance routes
    // cannot be what excludes it. Without these the assertions below would pass for the wrong reason.
    assert.equal(scoreless.writeOrigin, 'roadmap-eval-loop', 'fixture precondition: own write origin, not foreign')
    assert.equal(scoreless.status, 'surfaced', 'fixture precondition: surfaced, so it is an OPEN proposal by status')
    assert.notEqual(typeof scoreless.opportunity?.score, 'number', 'fixture precondition: and it carries no numeric score')
    assert.equal(typeof valid.opportunity.score, 'number', 'fixture precondition: the control document DOES carry one')

    const r = evalTrend(root)
    assert.equal(r.code, 0, `a truncated own document must not fail the render: ${r.stdout + r.stderr}`)
    assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'an unusable document is a reported fact, not a leaked stack')

    const html = readFileSync(trendPath(root), 'utf8')
    const section = proposalsSection(html)

    // PRESENT first, or every absence below is satisfied by a section that rendered nothing.
    assert.ok(section.includes(escHtml(valid.title)), `the fully scored proposal must still be tabled; section was:\n${section}`)

    // The LABEL it is filed under, not merely that it is named somewhere. Filing a document that
    // parses perfectly under `unreadable` sends the reader hunting for a parse error that does not
    // exist, and makes the page's `unreadable` mean something different from the propose command's.
    const footnoteLine = flattenTags(section)
      .split(/(?=surfaced but carrying|unreadable:|foreign write-origin|status outside)/)
      .find((chunk) => chunk.includes(scorelessName))
    assert.ok(
      footnoteLine,
      `the score-less document must be named in a footnote; section was:\n${section}`,
    )
    assert.match(
      footnoteLine,
      /surfaced but carrying no numeric score/,
      `and under the label that describes it, not "unreadable"; the chunk naming it was:\n${footnoteLine}`,
    )

    const rows = proposalRows(html)
    assert.equal(
      rows.length,
      1,
      `exactly ONE row: the scored document. A document with no score is not a row with a zero in it; rows were:\n${rows.join('\n')}`,
    )
    assert.ok(rows[0].includes(escHtml(valid.title)), `and the surviving row is the scored one; got ${rows[0]}`)
    assert.ok(
      renderingsOf(valid.opportunity.score).some((v) => rows[0].includes(v)),
      `the surviving row prints the score it is ranked by (${valid.opportunity.score}); got ${rows[0]}`,
    )
    assert.equal(
      rows.some((tr) => tr.includes(escHtml(SCORELESS_TITLE))),
      false,
      `the score-less document must own no row at all — tabling it means inventing the number it is ranked by; rows were:\n${rows.join('\n')}`,
    )
    assert.equal(
      html.includes(escHtml(SCORELESS_TITLE)),
      false,
      `and its title appears nowhere on the page: the footnote names the FILE, not a half-rendered proposal; page was:\n${html}`,
    )

    // Named, not dropped. A silent skip is how a reader comes to believe the queue is shorter.
    assert.ok(
      section.includes(scorelessName),
      `the unusable document must be named BY FILENAME in the section footnote; section was:\n${section}`,
    )

    // The precise form of the old bug: a rendered score cell holding 0. Asserted as the cell, not
    // as "the page contains no 0" — the page is full of numbers, and that weaker claim would be a
    // test that fails for reasons unrelated to this rail.
    assert.equal(
      /<td[^>]*>\s*0\s*<\/td>/.test(section),
      false,
      `no score cell may render 0 for a document that was never measured — 0 reads as "measured, and worthless"; section was:\n${section}`,
    )
  })
}

// ── 71. A STATUS THE LIFECYCLE NEVER NAMED IS NAMED, NOT DROPPED ─────────────────────────
// The section's own rule is that a file it cannot use is a fact about the corpus. An own,
// parseable document whose `status` is outside ProposalStatusShape — hand-edited, or written by an
// older vintage — matched none of the surfaced / decided branches and so was neither tabled, nor
// counted, nor mentioned. Not inflating a count and not being mentioned at all are different
// decisions, and only the first of them was the intent.
test('eval trend — an own proposal carrying a status outside the lifecycle is named in a footnote, not silently dropped', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })

  const valid = plantProposal(root, { id: 'recurring-regression-speed', title: 'record the reference minutes on every timed phase' })

  const STRANGE_TITLE = 'a document filed under a status nobody defined'
  const strange = { ...PROPOSAL_BASE, id: 'recurring-sentinel-plan-quality', title: STRANGE_TITLE, status: 'deferred' }
  const strangeName = plantRawProposal(root, strange)

  // Preconditions: own origin and parseable, so neither provenance route can be what excluded it.
  assert.equal(strange.writeOrigin, 'roadmap-eval-loop', 'fixture precondition: the loop owns this file')
  assert.equal(
    ['surfaced', 'ratified', 'rejected', 'archived'].includes(strange.status),
    false,
    'fixture precondition: the status really is outside the contract lifecycle',
  )

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const html = readFileSync(trendPath(root), 'utf8')
  const section = proposalsSection(html)

  assert.ok(section.includes(escHtml(valid.title)), 'the valid proposal is still tabled, so the assertions below are not about an empty section')
  assert.equal(proposalRows(html).length, 1, 'and it is the only row: a document with no known status is not an open proposal')
  assert.equal(html.includes(escHtml(STRANGE_TITLE)), false, 'nor is it tabled under some other heading')
  assert.ok(section.includes(strangeName), `it must be named BY FILENAME; section was:\n${section}`)
  assert.ok(statesCount(section, 'ratified', 0), 'and it inflates no decided count')
  assert.ok(statesCount(section, 'archived', 0), 'under any of them')
})

// ── 72. `eval propose` — A VALIDATOR THAT COULD NOT RUN IS NOT A VERDICT ABOUT THE CORPUS ──
// The command-side half of the rail cli/lib/eval-propose.test.mjs pins from the library side. The
// consolidation pass may only downgrade a validation failure the validator MARKED as a verdict
// about the document (`documentRefused`), and the real validator sets that flag for exactly one
// bridge outcome: `zod`. Every library test injects its own validator, so no test below the CLI
// can observe which outcomes the shipped one marks.
//
// WHY THIS DISCRIMINATES: the run below reaches the validator on a REFRESH — a document derived
// from a file on disk — which is the ONLY lane where the two behaviours differ (a freshly built
// document throws either way). With the flag as shipped (`res.kind === 'zod'`, false for a missing
// toolchain) the failure propagates, the command prints the worktree hint and exits 1. Flip it to
// a constant `true` and the identical run files the proposal under `unusable-own`, writes the rest
// of the queue and EXITS 0 — a broken tool reported as a stale corpus, in green. The exit code and
// the hint line both fail on that mutant.

/**
 * `eval propose` in a consumer whose tsx bridge cannot be resolved. The child gets a PATH holding
 * a symlink to git and NOTHING else, so `npx --no-install tsx` is a genuine ENOENT rather than a
 * stubbed one, while gitToplevel still works; node is spawned by absolute path, so the scrub takes
 * away only what the bridge goes looking for.
 */
function proposeWithoutTsx(root) {
  const binDir = mkdtempSync(join(tmpdir(), 'zr-nopath-'))
  bases.push(binDir)
  symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(binDir, 'git'))
  const r = spawnSync(process.execPath, [BIN, 'eval', 'propose'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, PATH: binDir },
  })
  if (r.error) throw r.error
  const out = { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  assert.doesNotMatch(out.stderr, /propose\.arc\.ts/, `'propose' was parsed as an ARC ID, not dispatched as a subcommand:\n${out.stderr}`)
  return out
}

test('eval propose — an UNRESOLVABLE tsx bridge aborts the run with the worktree hint (exit 1), never a stale-file count', () => {
  const root = seedProposalCorpus(makeConsumer())

  // A full pass with a working bridge first, so the proposals directory holds this loop's own files.
  const first = propose(root)
  assert.equal(first.code, 0, first.stdout + first.stderr)
  const files = proposalFiles(root)
  assert.ok(files.length > 0, 'fixture precondition: the first run wrote the proposals the second run derives from')

  // One hand-edit to a REGENERATED field, which is what turns the next run's staging into a
  // refresh. Left on disk exactly so: every assertion below is about a disk-derived document.
  const edited = join(proposalsDir(root), files[0])
  writeFileSync(
    edited,
    JSON.stringify({ ...readProposal(root, files[0]), title: 'hand-edited, so the pass has something to refresh' }, null, 2) + '\n',
  )
  const before = Object.fromEntries(files.map((f) => [f, readFileSync(join(proposalsDir(root), f), 'utf8')]))

  // The precondition that makes this test about the FLAG: with the toolchain present, this corpus
  // stages exactly one document and that document is disk-derived. A run that also created or
  // archived one would throw on that one first, in EITHER version of the guard, and prove nothing.
  const dry = propose(root, ['--dry-run'])
  assert.equal(dry.code, 0, dry.stdout + dry.stderr)
  assert.match(
    dry.stdout + dry.stderr,
    /created 0 {2}refreshed 1\b/,
    `fixture precondition: exactly one staged document, and it is a refresh; output was:\n${dry.stdout + dry.stderr}`,
  )
  const archivedLine = (dry.stdout + dry.stderr).split('\n').find((l) => /^\s*archived\b/.test(l))
  assert.ok(
    archivedLine && printsNumber(archivedLine, 0),
    `fixture precondition: no cluster dissolved, so the refresh really is the only staged document; the line was: ${archivedLine}`,
  )

  const r = proposeWithoutTsx(root)
  assert.equal(
    r.code,
    1,
    `a toolchain that could not run is the exit-1 lane: never 0 (a stale-file count) and never 2 (a refused document); output was:\n${r.stdout + r.stderr}`,
  )
  assert.ok(
    r.stderr.includes(TSX_ABSENT_HINT),
    `and it has to print the one line that says how to fix it; stderr was:\n${r.stderr}`,
  )
  assert.equal(
    (r.stdout + r.stderr).includes('unusable-own'),
    false,
    `the corpus was never judged, so nothing may be filed as an unusable own file; output was:\n${r.stdout + r.stderr}`,
  )
  assert.deepEqual(
    Object.fromEntries(proposalFiles(root).map((f) => [f, readFileSync(join(proposalsDir(root), f), 'utf8')])),
    before,
    'and the refusal left the directory exactly as it found it',
  )
})
