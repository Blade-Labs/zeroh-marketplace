// Shared eval fixtures. Importing this module registers no tests.
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

import { readPriorReports } from '../commands/eval.mjs'

import { phaseEvalRecordPath } from '../lib/eval-collect.mjs'

import { buildEvalFixture, ARC_ID } from './eval-arc/build-fixture.mjs'

import { makeFixtureRepo, writePhaseFile, commitAll, runCli, git } from '../../test/fixture-consumer/harness.mjs'

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

// ── 27a. the three stamps, at production and on the existing corpus ────────────────────
const WORKFLOW_GAP_RX = /workflow provenance GAP/

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

// ── 27b. declared resets: the STAMP retires, the trend MARKER does not ─────────────────
const SPEED_RESET_RX = /SPEED_REFERENCE_MINUTES_PER_TASK recalibrated 45 → 8/

const SPEED_RESET_ID = 'speed-reference-8'

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

// ══ `roadmap eval scorecard` over PHASE RECORDS (arc POLYSEAT plane 1) ══════════════════
// The slice's corpus used to be "arcs that already have a dated report" and nothing else, so a
// consumer that executes ordinary phases without arcs got a scorecard with ZERO driver cells
// however much work it did (measured in mudarabah2). `roadmap gate run` now leaves
// a record per phase at roadmap/arc-evals/phase-<N>.peval.json, and runScorecard reads them
// beside its arc-trace loop.
//
// What the command seam owes on top of the arithmetic (which lives in
// cli/lib/eval-scorecard.test.mjs and is not restated here):
//   - the records reach computeScorecard AT ALL from a repo with no arc report whatsoever;
//   - the degraded escape signal survives the shape, the write and the RENDERING as its named
//     word rather than becoming a 0 somewhere between the slicer and the reader;
//   - the reader's warnings reach the say channel — a warning that dies in the library turns
//     an unreadable record back into the silent skip the reader exists to prevent.

/** The production record, at the production spelling, under the production path helper. */
const pevalRecord = (phase, o = {}) => ({
  phase,
  date: o.date ?? '2026-08-20',
  consumerFingerprint: { repo: 'zr-evalfix', language: 'typescript', corpusSize: 12 },
  taskCount: o.taskCount ?? 3,
  keyFiles: o.keyFiles ?? ['src/collector.ts'],
  gate: { green: true, slots: [{ slot: 'lint', exitCode: 0, durationMs: 1200 }] },
  metrics: {
    commits: 3,
    linesAdded: 120,
    linesRemoved: 10,
    filesChanged: 4,
    testsAtStart: 100,
    testsAtEnd: 108,
    testsAdded: 8,
    startedAt: '2026-08-20T10:00:00.000Z',
    completedAt: '2026-08-20T10:30:00.000Z',
    haltCount: 0,
  },
  attribution: {
    plannedBy: { model: 'claude-fable-5' },
    driver: { model: 'claude-opus-5', lane: 'session' },
  },
})

/** Plant N records that all land in ONE cohort cell — same driver model+lane, same
 *  bandFor(taskCount), same surfaceOf(keyFiles). Split across cohorts they would never reach
 *  the floor, and the test would go green on an abstention for the wrong reason. */
function plantPhaseEvalRecords(root, phases, o = {}) {
  mkdirSync(evalsDir(root), { recursive: true })
  for (const n of phases) writeFileSync(phaseEvalRecordPath(root, n), JSON.stringify(pevalRecord(n, o), null, 2) + '\n')
  return phases.map((n) => phaseEvalRecordPath(root, n))
}

// ══ the pending-judge SIGNAL on stderr (task 18.3) ═══════════════════════════════════════
// A persisted report whose four judge-owned dimensions still carry `pending-judge` is a
// THREE-dimension report wearing a seven-dimension shape. `wrote <path>` is the last thing the
// run says, so the operator reads a finished artifact. The signal rides STDERR — the human
// summary already prints the awaiting line on stdout, but stdout is the lane a caller pipes,
// and this is the one line that must reach a human regardless — and it names the ONE command
// that resolves the gap, so the reader never has to go looking for it.
//
// The silence direction is the other half: --backfill's judge dimensions are TERMINAL
// (unjudged-backfill, no pass is coming), so nothing is pending, and printing a count or
// pointing at merge-judge would send an operator to run a pass this mode deliberately declined.

const MERGE_JUDGE_CMD = `roadmap eval merge-judge --arc ${ARC_ID}`

/** The stderr line that CARRIES the count — the number standing alone, beside the word for
 *  what is being counted. `printsNumber` (case 47's helper) is what keeps `4` from matching a
 *  `24` or a date fragment. */
const pendingCountLine = (stderr, n) =>
  stderr.split('\n').find((l) => /pending|judge|unscored/i.test(l) && printsNumber(l, n))

const roadmapCapturingBothStreams = (root, args) => {
  const res = spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 120_000 })
  return { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

export { ARC, ARC_ID, BACKFILL_DATE, BIN, DATE, EVAL_DATE, EVAL_DETERMINISTIC_KEYS, EVAL_JUDGE_KEYS, EVAL_KEYS, FOREIGN_NOTE, ISO_Z, JUDGE_PIN, LESSONS_FILE, MERGE_JUDGE_CMD, PINNED_PRIORS, PLUGIN_ROOT, POST_RESET_SIGNALS, PROPOSAL_BASE, REPORT_FILES, SCORECARD_N_FLOOR, SPEED_RESET_ID, SPEED_RESET_RX, TREND_JUDGE_A, TREND_JUDGE_B, TSX_ABSENT_HINT, WORKFLOW_GAP_RX, assert, buildEvalFixture, commitAll, dimSection, docFile, escHtml, evalTrend, evalsDir, evidenceFor, execFileSync, existsSync, expectedFromCorpus, fixtureWithSkeleton, flattenTags, git, join, judgeVerdict, lesson, lessonLines, lessonsPath, makeConsumer, makeFixtureRepo, mergeJudge, mkdirSync, outPath, parsesConsumerShape, pendingCountLine, plantPhaseEvalRecords, plantPrior, plantProposal, plantRawProposal, plantSiblingArc, printsNumber, proposalFiles, proposalRows, proposalsDir, proposalsSection, propose, proposeWithoutTsx, ratchetRow, rawReport, readFileSync, readPriorReports, readProposal, readReport, readScorecard, readdirSync, renameSync, renderingsOf, reportPath, roadmap, roadmapCapturingBothStreams, runCli, rx, samplesOf, scorecard, scorecardCells, scorecardPath, seedProposalCorpus, seriesDraw, sharedFixture, sharedProposeRun, speedResetNote, statesCount, test, timingPath, trendPath, validSweep, validVerdicts, writeFileSync, writePhaseFile }
