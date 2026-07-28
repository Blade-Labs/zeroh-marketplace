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
 *
 * `sentinels` names dimensions that carry an absence instead of a number (score XOR sentinel,
 * so the score is omitted, not zeroed); `ratchet` plants ratchet rows; `arcId`/`name` let a
 * caller file the same document under another arc or under a NON-report filename. All four
 * default to today's behaviour, so every pre-existing caller is untouched.
 */
function plantPrior(
  root,
  date,
  { all = 60, per = {}, judgeModel = 'judge-A', sentinels = {}, ratchet = [], arcId = ARC_ID, name } = {},
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
      signals: { synthetic: score },
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
    notes: [],
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
