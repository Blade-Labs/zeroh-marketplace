/**
 * roadmap eval record-sweep   --arc <ID> [--force] [file|-]  — persist arc-sweep's aggregate
 * roadmap eval record-verdicts --arc <ID> [--force] [file|-]  — persist validate-arc's judge panel
 *
 * The G1/G2 recorders (arc EVALCORE): the two land-time aggregates that used to live only in
 * chat get a mechanical write path, so a malformed aggregate is REFUSED at record time rather
 * than discovered months later at eval time. The skills call this command instead of carrying a
 * prose write ritual — the same reason every other repo-state transition became CLI code.
 *
 * Seam 3 (the `result check` precedent): validation routes through the CONSUMER's installed
 * lib/roadmap/schema.ts via the tsx bridge. The plugin carries NO second copy of
 * SweepReportShape / ArcVerdictsFileShape.
 *
 * Home: roadmap/arc-evals/<ARCID>-<date>-sweep.json | -verdicts.json — the COMMITTED archive.
 * These records are NOT regenerable (they capture a sweep's and a judge panel's output), unlike
 * the gitignored roadmap/arc-summaries/ RunnerSummaries. The date comes from the DOCUMENT, never
 * from wall-clock here: the recorder must not silently mint a timestamp the caller did not
 * assert. Existing paths are append-only by default — a same-day re-record is the --force case
 * and says so loudly.
 *
 * Exit-code contract (the universal one): 0 written · 1 usage/toolchain/config · 2 refused
 * (mis-shape, or an existing file without --force).
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gitToplevel } from '../lib/gitroot.mjs'
import { bridgeEval, consumerSchemaPath, BridgeError, TSX_ABSENT_HINT } from '../lib/tsx-bridge.mjs'
import {
  collectArcTrace,
  assembleWorkflowStamp,
  assembleConsumerFingerprint,
  WORKFLOW_PROFILE,
  CollectError,
} from '../lib/eval-collect.mjs'
import {
  scoreArcTrace,
  assembleAttribution,
  computeRatchet,
  computeTimingStats,
  declaredResetNotes,
  DECLARED_RESETS,
  DIMENSION_KEYS,
  JUDGE_DIMENSIONS,
} from '../lib/eval-score.mjs'

/** The two recorders, keyed by subcommand: which consumer shape validates, which suffix lands. */
const RECORDERS = {
  'record-sweep': { shape: 'SweepReportShape', suffix: 'sweep', what: 'arc-sweep report' },
  'record-verdicts': { shape: 'ArcVerdictsFileShape', suffix: 'verdicts', what: 'intent verdicts' },
}

/** The archive home — committed by design (see the module docblock). */
export const ARC_EVALS_DIR = ['roadmap', 'arc-evals']

// Parse the stdin document against the named consumer shape. argv[1] = schema path,
// argv[2] = shape name, argv[3] = the input JSON. Mirrors result.mjs's PARSE_SCRIPT so
// there is one bridge idiom, not two.
const PARSE_SCRIPT = `
const schemaPath = process.argv[1]
const shapeName = process.argv[2]
const inputJson = process.argv[3]
import('file://' + schemaPath).then((m) => {
  const shape = m[shapeName] || (m.default && m.default[shapeName])
  if (!shape) { process.stderr.write(shapeName + ' not exported from ' + schemaPath + ' — the consumer schema predates arc EVALCORE; re-sync lib/roadmap/schema.ts'); process.exit(4) }
  let input
  try { input = JSON.parse(inputJson) } catch (e) { process.stderr.write('input is not valid JSON: ' + e.message); process.exit(4) }
  const r = shape.safeParse(input)
  if (r.success) { process.stdout.write('PARSED:' + JSON.stringify(r.data)) }
  else { process.stderr.write('ZODISSUES:' + JSON.stringify(r.error.issues)); process.exit(3) }
}).catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(4) })
`

function printZodIssues(issues) {
  for (const iss of issues ?? []) {
    const path = Array.isArray(iss.path) && iss.path.length > 0 ? iss.path.join('.') : '(root)'
    process.stderr.write(`${path}: ${iss.message}\n`)
  }
  if (!issues || issues.length === 0) process.stderr.write('(unparseable validation error)\n')
}

/** Read the document from a file arg, or '-'/absent (stdin). */
function readInput(fileArg) {
  if (!fileArg || fileArg === '-') {
    try {
      return readFileSync(0, 'utf8')
    } catch {
      return ''
    }
  }
  return readFileSync(fileArg, 'utf8')
}

function parseArgs(argv) {
  const opts = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--arc') opts.arc = argv[++i]
    else if (a === '--date') opts.date = argv[++i]
    else if (a === '--force') opts.force = true
    else if (a === '--collect-only') opts.collectOnly = true
    else if (a === '--backfill') opts.backfill = true
    else if (a === '--report') opts.report = argv[++i]
    else if (a === '--phase') opts.phase = argv[++i]
    else if (a === '--writer') opts.writer = argv[++i]
    else if (a === '--json') opts.json = true
    else positional.push(a)
  }
  return { opts, positional }
}

const USAGE =
  'roadmap eval: usage:\n' +
  '  roadmap eval <ARCID> [--date <YYYY-MM-DD>] [--force] [--collect-only] [--backfill] [--json]\n' +
  '  roadmap eval record-sweep|record-verdicts --arc <ID> [--force] [file|-]\n' +
  '  roadmap eval merge-judge --arc <ID> [--report <path>]   (verdict JSON on stdin)\n' +
  '  roadmap eval trend                                      (renders roadmap/arc-evals/trend.html)\n' +
  '  roadmap eval restamp [--json]                           (additively re-stamps existing reports; never re-scores)\n' +
  '  roadmap eval lesson "<text>" [--phase N] [--writer <actor-id>]  (appends one lesson to the committed sidecar)\n'

export default async function run(argv) {
  const { opts, positional } = parseArgs(argv)
  const sub = positional[0]
  const recorder = RECORDERS[sub]
  if (!recorder) {
    if (!sub) {
      process.stderr.write(USAGE)
      return 1
    }
    if (sub === 'merge-judge') return runMergeJudge(opts)
    if (sub === 'trend') return runTrend(opts)
    if (sub === 'restamp') return runRestamp(opts)
    if (sub === 'lesson') return runLesson(opts, positional)
    // Anything that is not one of the two literal recorder names is an ARC ID. The literals
    // are checked FIRST so a future arc called `record-sweep` could never shadow the recorder.
    return runArcEval(sub, opts)
  }
  if (!opts.arc) {
    process.stderr.write('roadmap eval: --arc <ID> is required (it names the file the record lands in)\n')
    return 1
  }

  let inputJson
  try {
    inputJson = readInput(positional[1])
  } catch (e) {
    process.stderr.write(`roadmap eval ${sub}: cannot read input: ${e.message}\n`)
    return 1
  }
  if (!inputJson.trim()) {
    process.stderr.write(`roadmap eval ${sub}: no input (pass a file or pipe the JSON document on stdin)\n`)
    return 1
  }

  let toplevel, schemaPath
  try {
    toplevel = gitToplevel(process.cwd())
    schemaPath = consumerSchemaPath(toplevel)
  } catch (e) {
    if (e instanceof BridgeError) for (const l of e.messageLines) process.stderr.write(l + '\n')
    else process.stderr.write(`roadmap eval ${sub}: ${e.message}\n`)
    return 1
  }

  const res = bridgeEval(toplevel, PARSE_SCRIPT, { args: [schemaPath, recorder.shape, inputJson] })
  if (!res.ok) {
    if (res.kind === 'tsx-absent') {
      process.stderr.write(TSX_ABSENT_HINT + '\n')
      return 1
    }
    if (res.kind === 'zod') {
      // A refusal here is the whole point: an aggregate that will not parse never reaches disk,
      // so no downstream eval ever reads a half-shaped record.
      process.stderr.write(`roadmap eval ${sub}: refused — the document does not match ${recorder.shape}:\n`)
      printZodIssues(res.issues)
      return 2
    }
    process.stderr.write((res.stderr || `roadmap eval ${sub}: bridge failure`) + '\n')
    return 1
  }

  const parsed = JSON.parse(res.stdout.slice(res.stdout.indexOf('PARSED:') + 'PARSED:'.length))
  // The arcId travels INSIDE the document too; a --arc that disagrees would silently file the
  // record under the wrong arc, so the mismatch is a refusal rather than a preference.
  if (String(parsed.arcId) !== String(opts.arc)) {
    process.stderr.write(
      `roadmap eval ${sub}: refused — document arcId '${parsed.arcId}' !== --arc '${opts.arc}'\n`,
    )
    return 2
  }

  const dir = join(toplevel, ...ARC_EVALS_DIR)
  const outPath = join(dir, `${opts.arc}-${parsed.date}-${recorder.suffix}.json`)
  if (existsSync(outPath) && !opts.force) {
    process.stderr.write(
      `roadmap eval ${sub}: refused — ${outPath} already exists (records are append-only history).\n` +
        'Re-record the same day deliberately with --force.\n',
    )
    return 2
  }
  const overwriting = existsSync(outPath)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n')
  } catch (e) {
    process.stderr.write(`roadmap eval ${sub}: cannot write ${outPath}: ${e.message}\n`)
    return 1
  }
  process.stdout.write(
    `${overwriting ? 'OVERWROTE (--force)' : 'wrote'} ${outPath} — ${recorder.what} for arc ${opts.arc} (${parsed.date})\n`,
  )
  return 0
}

// ── `roadmap eval trend` — the across-arcs line the ratchet exists to draw ─────────────

/** The rendered projection's fixed name; regenerated in place beside the dated archive. */
export const TREND_FILE = 'trend.html'

/** Chart geometry. Constants rather than magic numbers so a reader can change the picture
 *  without decoding it, and so every dimension's chart is dimensionally identical. */
const CHART = { w: 720, h: 190, padL: 44, padR: 16, padT: 14, padB: 34 }

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * `roadmap eval restamp` — bring the EXISTING corpus up to the current stamp set, ADDITIVELY.
 *
 * The one hard rule: this never re-scores. `dimensions`, `ratchet`, `attribution`, `date` and
 * `judgeModel` are untouched on every file; only absent `profile` / `fingerprint` are filled and
 * only retired reset notes are dropped. A `workflow` block is NEVER written onto an existing
 * report — the build that produced it was not recorded, and stamping today's sha would fabricate
 * provenance — so a report without one gets its gap NAMED in notes instead, once.
 *
 * Every rewritten report is bridge-validated against ArcEvalReportShape BEFORE it is written, so
 * a restamp can never leave the archive in a state the reader refuses.
 */
async function runRestamp(opts) {
  let toplevel, schemaPath
  try {
    toplevel = gitToplevel(process.cwd())
    schemaPath = consumerSchemaPath(toplevel)
  } catch (e) {
    if (e instanceof BridgeError) for (const l of e.messageLines) process.stderr.write(l + '\n')
    else process.stderr.write(`roadmap eval restamp: ${e.message}\n`)
    return 1
  }

  const dir = join(toplevel, ...ARC_EVALS_DIR)
  const say = (line) => process.stdout.write(line + '\n')
  if (!existsSync(dir)) {
    say(`roadmap eval restamp: no ${ARC_EVALS_DIR.join('/')} directory — nothing to restamp`)
    return 0
  }

  const fingerprint = assembleConsumerFingerprint(toplevel)
  // Retirement is a CORPUS question, so the whole corpus is read once and the surviving note set
  // computed from it — a per-file decision would let two files disagree about the same fact.
  const corpus = readPriorReports(dir, { onWarn: say })
  const surviving = new Set(declaredResetNotes(corpus))
  const registryNotes = new Set(DECLARED_RESETS.map((r) => r.note))
  const WORKFLOW_GAP_NOTE =
    'workflow provenance GAP: this report predates the workflow version stamp, and the build that ' +
    'produced it was never recorded — a retro-stamped plugin sha would be a fabricated fact, so the block stays absent'

  const files = readdirSync(dir)
    .sort()
    .filter((f) => REPORT_NAME_RE.test(f))
  let stamped = 0
  for (const f of files) {
    const p = join(dir, f)
    let doc
    try {
      doc = JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      continue // readPriorReports already warned by name
    }
    if (!doc || typeof doc.dimensions !== 'object' || doc.dimensions === null) continue

    const before = JSON.stringify(doc)
    if (doc.profile === undefined) doc.profile = WORKFLOW_PROFILE
    if (doc.fingerprint === undefined) doc.fingerprint = fingerprint
    const notes = Array.isArray(doc.notes) ? doc.notes : []
    // Drop only notes THIS registry owns and whose reset has retired; anything else in the array
    // is someone else's prose and is not ours to edit.
    const kept = notes.filter((n) => !registryNotes.has(n) || surviving.has(n))
    if (!doc.workflow && !kept.includes(WORKFLOW_GAP_NOTE)) kept.push(WORKFLOW_GAP_NOTE)
    doc.notes = kept

    if (JSON.stringify(doc) === before) {
      say(`  unchanged  ${f}`)
      continue
    }

    const validated = bridgeValidate(toplevel, schemaPath, 'ArcEvalReportShape', doc)
    if (!validated.ok) {
      process.stderr.write(`roadmap eval restamp: refused — ${f} would not match ArcEvalReportShape after stamping:\n`)
      if (validated.res.kind === 'zod') printZodIssues(validated.res.issues)
      else process.stderr.write((validated.res.stderr || 'bridge failure') + '\n')
      return 2
    }
    writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8')
    stamped += 1
    say(`  stamped    ${f}`)
  }

  say(`roadmap eval restamp: ${stamped} stamped, ${files.length - stamped} unchanged (scores untouched by construction)`)
  if (opts.json) process.stdout.write(JSON.stringify({ stamped, total: files.length }, null, 2) + '\n')
  return 0
}

/**
 * `roadmap eval trend` — render every dated report in roadmap/arc-evals/ as ONE self-contained
 * page. Cross-arc by design, exactly like the ratchet's reference class: the question the page
 * answers is whether the WORKFLOW is improving, which a single arc can never show.
 *
 * ## Three properties the rendering may not quietly break
 * A dimension carrying a SENTINEL is a HOLE in its line, not a missing row: the series is drawn
 * as one polyline per contiguous run of scored reports, so two scored points either side of an
 * unmeasured one are never joined. Connecting them would draw a trend nobody measured — the
 * graphical form of the zero-standing-in-for-absent-data lie the scorer already refuses.
 * A judgeModel change is a vertical MARKER and a named baseline reset, never another point on
 * the same line. And a flagged regression is LISTED in words under its dimension, because a
 * reader should not have to infer the most important fact on the page from a slope.
 *
 * ## No external assets, enforced by having none
 * Inline SVG, inline CSS, no scripts. Not even an `xmlns` — inline SVG in HTML needs none, and
 * the URL would be the single thing on the page pointing at the network. The page must open
 * from a filesystem with no connection at all, which is the state a proof artifact is read in.
 */
async function runTrend(opts) {
  let toplevel
  try {
    toplevel = gitToplevel(process.cwd())
  } catch (e) {
    process.stderr.write(`roadmap eval trend: ${e.message}\n`)
    return 1
  }

  const dir = join(toplevel, ...ARC_EVALS_DIR)
  const say = (line) => process.stdout.write(line + '\n')
  // The SAME reader the ratchet uses: one definition of "a report", so the page and the
  // baseline can never disagree about which files count.
  const reports = readPriorReports(dir, { onWarn: say }).sort((a, b) => String(a.date).localeCompare(String(b.date)))

  const outPath = join(dir, TREND_FILE)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(outPath, renderTrendPage(reports), 'utf8')
  } catch (e) {
    process.stderr.write(`roadmap eval trend: cannot write ${outPath}: ${e.message}\n`)
    return 1
  }
  say(`wrote ${outPath} — ${reports.length} report(s) across ${new Set(reports.map((r) => String(r.arcId))).size} arc(s)`)
  if (opts.json) process.stdout.write(JSON.stringify({ reports: reports.length, path: outPath }, null, 2) + '\n')
  return 0
}

/** Where a report's judge model changed from its predecessor — each one a baseline reset. */
function judgeResets(reports) {
  const out = []
  for (let i = 1; i < reports.length; i++) {
    const from = reports[i - 1].judgeModel ?? null
    const to = reports[i].judgeModel ?? null
    if (from !== to) out.push({ index: i, from: from ?? 'unrecorded', to: to ?? 'unrecorded', date: reports[i].date })
  }
  return out
}

/**
 * Every DECLARED scoring-model reset, positioned on the report axis by DATE. Drawn from the
 * registry rather than from any surviving note, so a reset stays on the timeline permanently
 * after its per-report stamp has retired — the same treatment a judge-model reset gets.
 *
 * The index is the first report dated on or after the reset; a reset newer than every report
 * pins to the right edge, so it is visible rather than silently dropped.
 */
function scoringModelResets(reports) {
  return DECLARED_RESETS.map((reset) => {
    const at = reports.findIndex((r) => String(r.date) >= reset.date)
    return { index: at === -1 ? Math.max(0, reports.length - 1) : at, id: reset.id, date: reset.date }
  })
}

/** One dimension's chart. Runs of CONSECUTIVE scored reports become one polyline each; every
 *  scored report also gets its own dot, so an isolated point between two gaps is still visible.
 *  A run of one draws NO polyline — there is nothing to connect it to. */
function renderChart(reports, key, resets) {
  const { w, h, padL, padR, padT, padB } = CHART
  const plotW = w - padL - padR
  const plotH = h - padT - padB
  const x = (i) => (reports.length <= 1 ? padL + plotW / 2 : padL + (i * plotW) / (reports.length - 1))
  const y = (score) => padT + ((100 - score) / 100) * plotH

  const runs = []
  let run = []
  reports.forEach((r, i) => {
    const score = r?.dimensions?.[key]?.score
    if (typeof score === 'number') run.push({ i, score })
    else if (run.length > 0) {
      runs.push(run)
      run = []
    }
  })
  if (run.length > 0) runs.push(run)

  const parts = []
  for (const g of [0, 25, 50, 75, 100])
    parts.push(`<line class="grid" x1="${padL}" y1="${y(g)}" x2="${w - padR}" y2="${y(g)}"/>`)
  parts.push(`<line class="axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${h - padB}"/>`)
  parts.push(`<line class="axis" x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}"/>`)
  for (const g of [0, 50, 100]) parts.push(`<text class="tick" x="${padL - 6}" y="${y(g) + 4}">${g}</text>`)

  for (const reset of resets)
    parts.push(
      `<line class="reset" x1="${x(reset.index)}" y1="${padT}" x2="${x(reset.index)}" y2="${h - padB}"/>`,
    )

  for (const r of runs)
    if (r.length >= 2)
      parts.push(`<polyline class="series" points="${r.map((p) => `${x(p.i)},${y(p.score)}`).join(' ')}"/>`)
  for (const r of runs)
    for (const p of r) parts.push(`<circle class="series" cx="${x(p.i)}" cy="${y(p.score)}" r="3"/>`)

  reports.forEach((r, i) => {
    if (i % Math.ceil(reports.length / 6 || 1) !== 0 && i !== reports.length - 1) return
    parts.push(`<text class="tick date" x="${x(i)}" y="${h - padB + 16}">${esc(r.date)}</text>`)
  })

  return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">${parts.join('')}</svg>`
}

/** The whole page. Every section is emitted for all seven dimensions, always — a page that
 *  rendered only the dimensions it found data for would silently shrink the picture. */
function renderTrendPage(reports) {
  const judged = judgeResets(reports)
  const scoringResets = reports.length > 0 ? scoringModelResets(reports) : []
  const resets = [...judged, ...scoringResets]
  const head = []
  head.push('<h1>Arc eval trend</h1>')
  if (reports.length === 0) {
    head.push(
      '<p class="empty">No reports in roadmap/arc-evals/ yet — the corpus is empty. ' +
        'Nothing is plotted, because a line drawn through no data is a fabricated score of zero.</p>',
    )
  } else {
    head.push(
      `<p class="meta">${reports.length} report(s), ${esc(reports[0].date)} to ${esc(reports[reports.length - 1].date)}, ` +
        `across ${new Set(reports.map((r) => String(r.arcId))).size} arc(s). Higher is better on every axis.</p>`,
    )
    if (resets.length > 0) {
      head.push('<div class="resets"><h2>Baseline resets</h2><ul>')
      for (const r of judged)
        head.push(
          `<li><strong>${esc(r.date)}</strong>: judge changed from <code>${esc(r.from)}</code> to ` +
            `<code>${esc(r.to)}</code> — baseline reset. Judge-owned scores either side of this ` +
            'marker are not comparable and were excluded from each other\'s baseline.</li>',
        )
      // Permanent, registry-driven: these outlive the per-report stamps, which retire once no
      // pre-reset report is left. A reader a year from now still sees where the model changed.
      for (const r of scoringResets)
        head.push(
          `<li><strong>${esc(r.date)}</strong>: scoring-model reset <code>${esc(r.id)}</code> — scores either ` +
            'side of this marker were produced by different scoring models.</li>',
        )
      head.push('</ul></div>')
    }
  }

  const sections = DIMENSION_KEYS.map((key) => {
    const scored = reports.filter((r) => typeof r?.dimensions?.[key]?.score === 'number')
    const missing = reports.filter((r) => typeof r?.dimensions?.[key]?.score !== 'number')
    const body = []
    body.push(renderChart(reports, key, resets))
    if (scored.length === 0)
      body.push(
        `<p class="gap">No data: no report scored this dimension${
          missing.length > 0 ? ` (${esc([...new Set(missing.map((r) => r.dimensions?.[key]?.sentinel ?? 'no score'))].join(', '))})` : ''
        }. Nothing is plotted rather than plotted as zero.</p>`,
      )
    else if (missing.length > 0)
      body.push(
        '<p class="gap">Gap: no score in ' +
          missing.map((r) => `${esc(r.date)} (${esc(r.dimensions?.[key]?.sentinel ?? 'no score')})`).join(', ') +
          '. The line BREAKS across it — joining the neighbours would draw a trend nobody measured.</p>',
      )

    const regressions = []
    for (const r of reports)
      for (const row of r.ratchet ?? [])
        if (row.regression && row.dimension === key)
          regressions.push(
            `<li>REGRESSION ${esc(r.date)}: ${esc(row.value)} against a baseline of ${esc(row.baseline)} (delta ${esc(row.delta)})</li>`,
          )
    if (regressions.length > 0) body.push(`<ul class="regressions">${regressions.join('')}</ul>`)

    return `<section><h2 id="dim-${key}">${key}</h2>${body.join('')}</section>`
  })

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Arc eval trend</title><style>
:root{color-scheme:light dark}
body{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:0 auto;padding:24px;max-width:840px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px}
.meta,.empty{color:#666;margin:0 0 16px}
section{border-top:1px solid #8883;padding-top:4px}
.chart{display:block;max-width:100%;overflow:visible}
.grid{stroke:#8882;stroke-width:1}.axis{stroke:#8886;stroke-width:1}
.series{fill:none;stroke:#2f6feb;stroke-width:2}circle.series{fill:#2f6feb}
.reset{stroke:#c2410c;stroke-width:2;stroke-dasharray:4 3}
.tick{fill:#888;font-size:10px;text-anchor:end}.date{text-anchor:middle}
.gap{color:#8a6d3b;margin:4px 0}
.regressions{margin:4px 0;padding-left:18px;color:#b3261e}
.resets{border-left:3px solid #c2410c;padding-left:12px}
code{font-family:ui-monospace,monospace}
</style></head><body>
${head.join('\n')}
${sections.join('\n')}
</body></html>
`
}

// ── `roadmap eval merge-judge` — the judge verdict's ONE door into a report ────────────

/**
 * The pinned judge model, in its ONE code home. The other home is the `model:` frontmatter of
 * agents/arc-eval-judge.md, which pins the SPAWN; this constant is what a returned verdict's
 * self-reported `judgeModel` is checked against. Two homes, two different jobs — scattering the
 * string further is how a pin quietly stops being one.
 *
 * Changing this value is a deliberate baseline reset: judge-owned dimensions scored by the old
 * model stop being comparable, which computeRatchet already enforces from `judgeModel` alone.
 */
export const PINNED_JUDGE_MODEL = 'claude-sonnet-5'

/** The newest dated report for an arc, or null. Same anchored pattern the priors reader uses,
 *  so a `-sweep`/`-verdicts` sibling can never be mistaken for the report being finalized. */
function newestReportPath(dir, arcId) {
  if (!existsSync(dir)) return null
  const re = new RegExp(`^${arcId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}-\\d{2}-\\d{2}\\.json$`)
  const hits = readdirSync(dir).filter((f) => re.test(f)).sort()
  return hits.length > 0 ? join(dir, hits[hits.length - 1]) : null
}

/**
 * `roadmap eval merge-judge --arc <ID> [--report <path>]` — fold a typed judge verdict into a
 * skeleton report, enforce the ownership seam and the model pin, and finalize in place.
 *
 * This is a SEAM, not a convenience: the alternative is a skill hand-editing report JSON in
 * prose, which decays on contact with the first surprising verdict. Everything the merge is
 * allowed to refuse, it refuses here once — mis-shape, a judge reaching into a deterministic
 * dimension, a report that does not exist — so no downstream reader has to re-litigate it.
 *
 * The off-pin case deliberately MERGES rather than refuses. A verdict from another model is
 * real data about a real arc; what it must never be is silently averaged into a baseline built
 * from a different judge. So it lands, loudly labelled, and the affected ratchet rows say why
 * they cannot be compared. Refusing instead would only push the operator into hand-editing.
 */
async function runMergeJudge(opts) {
  if (!opts.arc) {
    process.stderr.write('roadmap eval merge-judge: --arc <ID> is required (it names the report the verdict lands in)\n')
    return 1
  }

  let toplevel, schemaPath
  try {
    toplevel = gitToplevel(process.cwd())
    schemaPath = consumerSchemaPath(toplevel)
  } catch (e) {
    if (e instanceof BridgeError) for (const l of e.messageLines) process.stderr.write(l + '\n')
    else process.stderr.write(`roadmap eval merge-judge: ${e.message}\n`)
    return 1
  }

  let inputJson
  try {
    inputJson = readInput('-')
  } catch (e) {
    process.stderr.write(`roadmap eval merge-judge: cannot read the verdict: ${e.message}\n`)
    return 1
  }
  if (!inputJson.trim()) {
    process.stderr.write('roadmap eval merge-judge: no input (pipe the judge verdict JSON on stdin)\n')
    return 1
  }

  const parsedVerdict = bridgeEval(toplevel, PARSE_SCRIPT, { args: [schemaPath, 'ArcEvalJudgeVerdictShape', inputJson] })
  if (!parsedVerdict.ok) {
    if (parsedVerdict.kind === 'tsx-absent') {
      process.stderr.write(TSX_ABSENT_HINT + '\n')
      return 1
    }
    if (parsedVerdict.kind === 'zod') {
      // The judge is an LLM; a mis-shaped verdict is an EXPECTED outcome, not an exception. It
      // is refused here so the report stays honestly unjudged rather than half-filled.
      process.stderr.write('roadmap eval merge-judge: refused — the verdict does not match ArcEvalJudgeVerdictShape:\n')
      printZodIssues(parsedVerdict.issues)
      return 2
    }
    process.stderr.write((parsedVerdict.stderr || 'roadmap eval merge-judge: bridge failure') + '\n')
    return 1
  }
  const verdict = JSON.parse(parsedVerdict.stdout.slice(parsedVerdict.stdout.indexOf('PARSED:') + 'PARSED:'.length))

  if (String(verdict.arcId) !== String(opts.arc)) {
    process.stderr.write(
      `roadmap eval merge-judge: refused — verdict arcId '${verdict.arcId}' !== --arc '${opts.arc}'\n`,
    )
    return 2
  }

  const dir = join(toplevel, ...ARC_EVALS_DIR)
  const reportPath = opts.report ? opts.report : newestReportPath(dir, String(opts.arc))
  if (!reportPath || !existsSync(reportPath)) {
    process.stderr.write(
      `roadmap eval merge-judge: refused — no dated report for arc ${opts.arc} in ${dir}.\n` +
        `Run \`roadmap eval ${opts.arc}\` first; a verdict has nothing to merge into until the skeleton exists.\n`,
    )
    return 2
  }

  let report
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch (e) {
    process.stderr.write(`roadmap eval merge-judge: cannot read ${reportPath}: ${e.message}\n`)
    return 1
  }

  // THE OWNERSHIP SEAM. Owner-based rather than "already carries a score": it also catches a
  // judge SKIPPING a dimension it was never asked to judge, which would otherwise leak a
  // meaningless reason into the report's notes.
  const touched = [...Object.keys(verdict.dimensions ?? {}), ...(verdict.skipped ?? []).map((s) => s.dimension)]
  for (const key of touched) {
    const owner = report.dimensions?.[key]?.owner
    if (owner !== 'judge') {
      process.stderr.write(
        `roadmap eval merge-judge: refused — the verdict touches '${key}', whose owner in this report is ` +
          `'${owner ?? 'absent'}', not 'judge'.\n` +
          'The judge agent never recomputes a deterministic signal (the single-scoring-implementation seam):\n' +
          'deterministic dimensions are scored by cli/lib/eval-score.mjs and READ by the judge, never returned by it.\n',
      )
      return 2
    }
  }

  const notes = [...(report.notes ?? [])]

  for (const [key, d] of Object.entries(verdict.dimensions ?? {})) {
    const target = report.dimensions[key]
    // The sentinel must GO, not sit beside the new number: EvalDimensionShape enforces
    // score XOR sentinel, so leaving it would fail the pre-write parse.
    delete target.sentinel
    target.score = d.score
    target.evidence = d.evidence
    // `signals` is the only place confidence survives to disk — EvalDimensionShape strips
    // unknown top-level keys, so a `confidence` field written beside `score` would vanish
    // silently at the pre-write parse and the report would lose the judge's own hedge.
    target.signals = { ...(target.signals ?? {}), confidence: d.confidence }
  }

  for (const s of verdict.skipped ?? []) {
    // A skip stays PENDING. It is not a score, not a zero, and not a new sentinel: the judge
    // simply has not judged it, which is exactly what `pending-judge` already means.
    notes.push(`${s.dimension}: judge skipped - ${s.why}`)
  }

  report.judgeModel = verdict.judgeModel
  const offPin = verdict.judgeModel !== PINNED_JUDGE_MODEL
  if (offPin)
    notes.push(
      `judgeModel ${verdict.judgeModel} differs from the pin ${PINNED_JUDGE_MODEL} - baseline reset material: ` +
        'judge-owned dimensions in this report are not comparable with priors judged by the pinned model',
    )
  report.notes = notes

  // Recomputed, never patched: computeRatchet owns the comparability rule (a prior judged by
  // another model is excluded from a judge-owned dimension), so stamping judgeModel above is
  // what makes the off-pin exclusion happen — the same one function every other caller uses.
  const priors = readPriorReports(dir, { excludePath: reportPath, onWarn: (l) => process.stdout.write(l + '\n') })
  report.ratchet = computeRatchet(report, priors)
  for (const row of report.ratchet) {
    if (!JUDGE_DIMENSIONS.has(row.dimension)) continue
    // Count what the comparability rule THREW AWAY. A row that simply has no priors is
    // `no-baseline` and says so; a row whose priors exist but were judged by another model is
    // a different fact, and a reader who cannot tell them apart will read a reset as a gap.
    const excluded = priors.filter(
      (p) => typeof p?.dimensions?.[row.dimension]?.score === 'number' && (p.judgeModel ?? null) !== report.judgeModel,
    ).length
    if (excluded > 0)
      row.note = `${row.note ? row.note + ' ' : ''}incomparable-judge (${excluded} prior(s) judged by another model, excluded)`
  }

  const validated = bridgeValidate(toplevel, schemaPath, 'ArcEvalReportShape', report)
  if (!validated.ok) {
    if (validated.res.kind === 'tsx-absent') {
      process.stderr.write(TSX_ABSENT_HINT + '\n')
      return 1
    }
    process.stderr.write('roadmap eval merge-judge: refused — the merged report does not match ArcEvalReportShape:\n')
    if (validated.res.kind === 'zod') printZodIssues(validated.res.issues)
    else process.stderr.write((validated.res.stderr ?? '') + '\n')
    return 2
  }

  try {
    writeFileSync(reportPath, JSON.stringify(validated.parsed, null, 2) + '\n')
  } catch (e) {
    process.stderr.write(`roadmap eval merge-judge: cannot write ${reportPath}: ${e.message}\n`)
    return 1
  }

  const final = validated.parsed
  process.stdout.write(`roadmap eval merge-judge ${opts.arc} — judged by ${final.judgeModel}\n`)
  if (offPin) process.stdout.write(`OFF-PIN: ${final.judgeModel} is not the pinned ${PINNED_JUDGE_MODEL} — baseline reset material\n`)
  for (const key of DIMENSION_KEYS) {
    if (!JUDGE_DIMENSIONS.has(key)) continue
    const d = final.dimensions[key]
    process.stdout.write(`  ${pad(key, 27)}${d.score ?? d.sentinel}\n`)
  }
  for (const row of final.ratchet.filter((r) => r.regression))
    process.stdout.write(`REGRESSION ${row.dimension}: ${row.value} against a baseline of ${row.baseline} (delta ${row.delta})\n`)
  process.stdout.write(`finalized ${reportPath}\n`)
  return 0
}

// ── `roadmap eval lesson` — the event-triggered capture ────────────────────────────────

/** The append-only sidecar. JSONL, not a JSON array: concurrent sessions on a shared tree
 *  append to this file, and a read-modify-write array would let the loser of that race drop
 *  the very lesson it was called to keep. */
export const LESSONS_FILE = 'lessons.jsonl'

/**
 * `roadmap eval lesson "<text>" [--phase N] [--writer <actor-id>]` — flush one durable lesson
 * to the committed sidecar the moment a session learns it.
 *
 * EVENT-triggered by design: the trigger MOMENTS live in the executor-facing skill text (an
 * error recovered, a user correction, a surprising re-derivation), never a "reflect every N
 * prompts" interval — periodic reflection produces filler, and filler is what makes a corpus
 * unreadable.
 *
 * `kind` is always `session`: this command IS the session lane. The eval loop writes its own
 * artifacts through its own path, and that split is what lets consolidation tell its own
 * output from upstream content it must never touch.
 */
async function runLesson(opts, positional) {
  const text = positional[1]
  if (typeof text !== 'string' || !text.trim()) {
    process.stderr.write(
      'roadmap eval lesson: usage: roadmap eval lesson "<text>" [--phase N] [--writer <actor-id>]\n' +
        '  the lesson text is required — an empty lesson is a line the corpus cannot learn from\n',
    )
    return 1
  }

  let toplevel, schemaPath
  try {
    toplevel = gitToplevel(process.cwd())
    schemaPath = consumerSchemaPath(toplevel)
  } catch (e) {
    if (e instanceof BridgeError) for (const l of e.messageLines) process.stderr.write(l + '\n')
    else process.stderr.write(`roadmap eval lesson: ${e.message}\n`)
    return 1
  }

  const doc = {
    // The command's ONE wall-clock mint, echoed loudly below: a caller cannot pin this the way
    // --date pins a report's date, so the value it wrote is the value it must show.
    ts: new Date().toISOString(),
    ...(opts.phase === undefined ? {} : { phase: Number(opts.phase) }),
    text: text.trim(),
    // Self-reported or the literal `unrecorded` — the UNRECORDED_DRIVER discipline. A guessed
    // actor id is worse than a named gap, because only the gap is visible later.
    origin: { writer: opts.writer ?? 'unrecorded', kind: 'session' },
  }

  const validated = bridgeValidate(toplevel, schemaPath, 'LessonShape', doc)
  if (!validated.ok) {
    const { res } = validated
    if (res.kind === 'tsx-absent') {
      process.stderr.write(TSX_ABSENT_HINT + '\n')
      return 1
    }
    if (res.kind === 'zod') {
      process.stderr.write('roadmap eval lesson: refused — the lesson does not match LessonShape:\n')
      printZodIssues(res.issues)
      return 2
    }
    process.stderr.write((res.stderr || 'roadmap eval lesson: bridge failure') + '\n')
    return 1
  }

  const dir = join(toplevel, ...ARC_EVALS_DIR)
  const outPath = join(dir, LESSONS_FILE)
  try {
    mkdirSync(dir, { recursive: true })
    // APPEND, never rewrite — see LESSONS_FILE.
    appendFileSync(outPath, JSON.stringify(validated.parsed) + '\n')
  } catch (e) {
    process.stderr.write(`roadmap eval lesson: cannot append to ${outPath}: ${e.message}\n`)
    return 1
  }

  const say = (line) => process.stdout.write(line + '\n')
  say(`roadmap eval lesson — appended to ${outPath}`)
  say(`  ts      ${validated.parsed.ts}`)
  say(`  writer  ${validated.parsed.origin.writer} (${validated.parsed.origin.kind})`)
  if (validated.parsed.phase !== undefined) say(`  phase   ${validated.parsed.phase}`)
  say(`  text    ${validated.parsed.text}`)
  return 0
}

// ── `roadmap eval <ARCID>` — collect → score → ratchet → the dated report ──────────────

/** The regenerated projection's fixed name — stats are a projection, reports are the archive. */
export const TIMING_STATS_FILE = 'timing-stats.json'

/** The dated REPORT form, for ANY arc. The `-sweep`/`-verdicts` siblings live in the same
 *  directory and share the arc prefix, but their date is not final before `.json`, so this
 *  anchored pattern excludes them: a record is not a report. `timing-stats.json` carries no
 *  date at all and is likewise excluded. */
const REPORT_NAME_RE = /^.+-\d{4}-\d{2}-\d{2}\.json$/

/**
 * Every prior REPORT in the archive, oldest first, excluding `excludePath` (a re-run must
 * never ratchet against its own previous output — that would make `--force` non-reproducible).
 *
 * CROSS-ARC by design: an arc lands once and produces one dated report, so a baseline scoped
 * to a single arc could never reach MIN_COMPARABLE_PRIORS and the ratchet would be permanently
 * `no-baseline`. The reference class is the workflow's recent arcs, which is also what the
 * backfill seeds and what the timing table already pools over. Comparability is enforced
 * per-dimension by computeRatchet (a sentinelled prior, and a differently-judged prior on a
 * judge-owned dimension, are excluded there), not by filename.
 *
 * A file that will not read, will not JSON-parse, or carries no `dimensions` record is
 * SKIPPED with a WARN naming it. Reading a corrupt prior as an empty report would drag every
 * baseline toward zero and manufacture regressions, so the skip is loud rather than lenient.
 * The check is deliberately structural rather than a full bridged `.parse()` per file: the
 * ratchet reads only `judgeModel` and each dimension's `score`, and one tsx spawn per
 * historical report would make the command unusable at corpus scale.
 */
export function readPriorReports(dir, { excludePath, onWarn } = {}) {
  if (!existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir).sort()) {
    if (!REPORT_NAME_RE.test(f)) continue
    const p = join(dir, f)
    if (excludePath && p === excludePath) continue
    let doc
    try {
      doc = JSON.parse(readFileSync(p, 'utf8'))
    } catch (e) {
      onWarn?.(`WARN: skipping ${f} — it does not parse as JSON (${e.message})`)
      continue
    }
    if (!doc || typeof doc.dimensions !== 'object' || doc.dimensions === null) {
      onWarn?.(`WARN: skipping ${f} — it carries no dimensions record, so it is not a report`)
      continue
    }
    out.push(doc)
  }
  return out
}

/** Validate a document against a CONSUMER shape through the bridge (the record-sweep idiom). */
function bridgeValidate(toplevel, schemaPath, shapeName, doc) {
  const res = bridgeEval(toplevel, PARSE_SCRIPT, { args: [schemaPath, shapeName, JSON.stringify(doc)] })
  if (res.ok) return { ok: true, parsed: JSON.parse(res.stdout.slice(res.stdout.indexOf('PARSED:') + 'PARSED:'.length)) }
  return { ok: false, res }
}

/** Which other arcs already have a dated report — the timing table pools across all of them. */
function arcsWithReports(dir) {
  if (!existsSync(dir)) return []
  const ids = new Set()
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(.+)-\d{4}-\d{2}-\d{2}\.json$/)
    if (m) ids.add(m[1])
  }
  return [...ids].sort()
}

const pad = (s, n) => String(s).padEnd(n)

/**
 * `roadmap eval <ARCID>` — the seam do-arc's post-land step and the backfill both call.
 * Collect the arc's trace from disk, score the deterministic dimensions, mark the judge-owned
 * ones pending, ratchet against the prior reports, and persist the dated report beside a
 * regenerated timing table.
 *
 * The report is validated against the CONSUMER's ArcEvalReportShape BEFORE it reaches disk:
 * a report that will not parse must never become someone's baseline. The `--date` default is
 * the CLI's one wall-clock mint and is printed loudly beside the flag that overrides it —
 * a silently minted date is how an archive stops being reproducible.
 */
async function runArcEval(arcId, opts) {
  let toplevel, schemaPath
  try {
    toplevel = gitToplevel(process.cwd())
    schemaPath = consumerSchemaPath(toplevel)
  } catch (e) {
    if (e instanceof BridgeError) for (const l of e.messageLines) process.stderr.write(l + '\n')
    else process.stderr.write(`roadmap eval: ${e.message}\n`)
    return 1
  }

  // With --json the machine lane owns stdout; the human summary moves aside so the output
  // stays pipeable into jq without a stripping step.
  const say = (line) => (opts.json ? process.stderr : process.stdout).write(line + '\n')

  const dateDefaulted = !opts.date
  const date = opts.date ?? new Date().toISOString().slice(0, 10)

  let collected
  try {
    collected = collectArcTrace(toplevel, arcId)
  } catch (e) {
    if (e instanceof CollectError) {
      for (const l of e.messageLines) process.stderr.write(l + '\n')
      return e.kind === 'tsx-absent' ? 1 : 2
    }
    process.stderr.write(`roadmap eval ${arcId}: ${e.message}\n`)
    return 1
  }
  for (const w of collected.warnings) say(`WARN: ${w}`)

  // The trace is validated HERE, at the one boundary it crosses into the scorer. This is what
  // the collector defers to: ArcTraceShape composes SweepReportShape / ArcVerdictsFileShape /
  // RunnerSummaryShape by reference, so this single parse is what stops a well-formed-JSON but
  // mis-shaped artifact from being read as a number further down.
  const traceCheck = bridgeValidate(toplevel, schemaPath, 'ArcTraceShape', collected.trace)
  if (!traceCheck.ok) {
    if (traceCheck.res.kind === 'tsx-absent') {
      process.stderr.write(TSX_ABSENT_HINT + '\n')
      return 1
    }
    process.stderr.write(`roadmap eval ${arcId}: refused — the collected trace does not match ArcTraceShape:\n`)
    if (traceCheck.res.kind === 'zod') printZodIssues(traceCheck.res.issues)
    else process.stderr.write((traceCheck.res.stderr ?? '') + '\n')
    return 2
  }

  if (opts.collectOnly) {
    if (opts.json) process.stdout.write(JSON.stringify(collected.trace, null, 2) + '\n')
    else
      say(
        `collected ${collected.trace.phases.length} phase(s) for arc ${arcId} — ` +
          `sweep ${collected.trace.sweep ? 'present' : 'absent'}, verdicts ${collected.trace.verdicts ? 'present' : 'absent'}, ` +
          // A failed scan must never print "0 escape fix(es)" — this is the one line a human
          // eyeballs before trusting the trace, so it is the last place a zero may stand in.
          `${collected.trace.git.escapeScan === 'unavailable' ? 'escape scan unavailable' : `${collected.trace.git.escapeFixes.length} escape fix(es)`}. ` +
          'Nothing written (--collect-only).',
      )
    return 0
  }

  const dir = join(toplevel, ...ARC_EVALS_DIR)
  const outPath = join(dir, `${arcId}-${date}.json`)
  if (existsSync(outPath) && !opts.force) {
    process.stderr.write(
      `roadmap eval ${arcId}: refused — ${outPath} already exists (reports are dated, append-only history).\n` +
        'Re-run the same day deliberately with --force.\n',
    )
    return 2
  }

  const scored = scoreArcTrace(collected.trace, { backfill: Boolean(opts.backfill) })
  const stampWarnings = []
  const workflow = assembleWorkflowStamp({ warn: (l) => stampWarnings.push(l) })
  const draft = {
    arcId,
    date,
    dimensions: scored.dimensions,
    ratchet: [],
    attribution: assembleAttribution(collected.trace),
    profile: WORKFLOW_PROFILE,
    // Absent rather than partial, and the gap is NAMED in notes: a workflow block is provenance,
    // and half a provenance record still reads as one.
    ...(workflow ? { workflow } : {}),
    fingerprint: assembleConsumerFingerprint(toplevel),
    notes: [...collected.warnings, ...scored.notes, ...stampWarnings],
  }
  const priors = readPriorReports(dir, { excludePath: outPath, onWarn: say })
  draft.ratchet = computeRatchet(draft, priors)
  // The corpus INCLUDING the report being written decides which reset stamps still apply: a
  // report that is itself pre-reset (an unregenerated window, the old speed reference) must
  // carry the disclaimer that describes it.
  draft.notes.push(...declaredResetNotes([...priors, draft]))

  const validated = bridgeValidate(toplevel, schemaPath, 'ArcEvalReportShape', draft)
  if (!validated.ok) {
    const { res } = validated
    if (res.kind === 'tsx-absent') {
      process.stderr.write(TSX_ABSENT_HINT + '\n')
      return 1
    }
    if (res.kind === 'zod') {
      process.stderr.write(`roadmap eval ${arcId}: refused — the report does not match ArcEvalReportShape:\n`)
      printZodIssues(res.issues)
      return 2
    }
    process.stderr.write((res.stderr || `roadmap eval ${arcId}: bridge failure`) + '\n')
    return 1
  }
  const report = validated.parsed

  // The timing table pools EVERY arc that already has a report, not just this one — a
  // reference class of one arc is not a reference class.
  const traces = [collected.trace]
  for (const other of arcsWithReports(dir)) {
    if (other === arcId) continue
    try {
      traces.push(collectArcTrace(toplevel, other).trace)
    } catch {
      say(`WARN: arc ${other} has reports but its trace could not be collected — excluded from the timing table`)
    }
  }
  // Derived from the DATA, never from wall clock: a second `new Date()` here would make the
  // regenerated table differ byte-for-byte on every run over identical inputs, so the committed
  // archive would show a spurious diff each time the eval is re-run. The instant is midnight of
  // the NEWEST date in the pool — this report's own date, or a later report's if one exists.
  // Keying it to this report's date alone let a re-run at a HISTORICAL date backdate a
  // corpus-wide table below data it already contained, which is a table claiming to predate its
  // own inputs.
  const newestDate = [date, ...priors.map((p) => String(p.date))].sort().at(-1)
  const stats = computeTimingStats(traces, { generatedAt: `${newestDate}T00:00:00.000Z` })
  const statsValidated = bridgeValidate(toplevel, schemaPath, 'TimingStatsShape', stats)
  if (!statsValidated.ok) {
    process.stderr.write(`roadmap eval ${arcId}: refused — the timing table does not match TimingStatsShape:\n`)
    if (statsValidated.res.kind === 'zod') printZodIssues(statsValidated.res.issues)
    else process.stderr.write((statsValidated.res.stderr ?? '') + '\n')
    return 2
  }

  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
    writeFileSync(join(dir, TIMING_STATS_FILE), JSON.stringify(statsValidated.parsed, null, 2) + '\n')
  } catch (e) {
    process.stderr.write(`roadmap eval ${arcId}: cannot write ${outPath}: ${e.message}\n`)
    return 1
  }

  if (opts.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')

  say(`roadmap eval ${arcId} — report ${date}`)
  if (dateDefaulted) say(`date ${date} defaulted to today; pass --date <YYYY-MM-DD> to pin it`)
  say('')
  say('dimensions:')
  for (const key of DIMENSION_KEYS) {
    const d = report.dimensions[key]
    say(`  ${pad(key, 27)}${pad(d.owner, 15)}${d.score ?? d.sentinel}`)
  }
  const judgeOwned = DIMENSION_KEYS.filter((k) => JUDGE_DIMENSIONS.has(k))
  // A backfill's judge dimensions are CLOSED, not late. Printing "awaiting" over them would
  // tell the operator to go run a pass that this mode has deliberately declined to run.
  say(
    opts.backfill
      ? `unjudged by design (backfill, no pass is coming): ${judgeOwned.join(', ')}`
      : `awaiting the judge pass: ${judgeOwned.join(', ')}`,
  )
  say('')
  say('ratchet:')
  for (const row of report.ratchet)
    say(
      `  ${pad(row.dimension, 27)}baseline ${row.baseline ?? '-'}  value ${row.value ?? '-'}  ` +
        `delta ${row.delta ?? '-'}  ${row.note ?? ''}`,
    )
  // Shouted separately so exactly the regressed dimensions carry the word — a reader
  // scanning for it must not have to tell a flagged row from an unflagged one.
  for (const row of report.ratchet.filter((r) => r.regression))
    say(`REGRESSION ${row.dimension}: ${row.value} against a baseline of ${row.baseline} (delta ${row.delta})`)
  for (const n of report.notes) say(`note: ${n}`)
  say('')
  say(`wrote ${outPath}`)
  say(`regenerated ${join(dir, TIMING_STATS_FILE)}`)
  return 0
}
