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
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gitToplevel } from '../lib/gitroot.mjs'
import { bridgeEval, consumerSchemaPath, BridgeError, TSX_ABSENT_HINT } from '../lib/tsx-bridge.mjs'
import { collectArcTrace, CollectError } from '../lib/eval-collect.mjs'
import { scoreArcTrace, assembleAttribution, computeRatchet, computeTimingStats, DIMENSION_KEYS, JUDGE_DIMENSIONS } from '../lib/eval-score.mjs'

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
    else if (a === '--json') opts.json = true
    else positional.push(a)
  }
  return { opts, positional }
}

const USAGE =
  'roadmap eval: usage:\n' +
  '  roadmap eval <ARCID> [--date <YYYY-MM-DD>] [--force] [--collect-only] [--json]\n' +
  '  roadmap eval record-sweep|record-verdicts --arc <ID> [--force] [file|-]\n'

export default async function run(argv) {
  const { opts, positional } = parseArgs(argv)
  const sub = positional[0]
  const recorder = RECORDERS[sub]
  if (!recorder) {
    if (!sub) {
      process.stderr.write(USAGE)
      return 1
    }
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

// ── `roadmap eval <ARCID>` — collect → score → ratchet → the dated report ──────────────

/** The regenerated projection's fixed name — stats are a projection, reports are the archive. */
export const TIMING_STATS_FILE = 'timing-stats.json'

/** The dated REPORT form. The `-sweep`/`-verdicts` siblings live in the same directory and
 *  share the arc prefix, so the pattern is anchored: a record is not a report. */
const reportNameRe = (arcId) =>
  new RegExp(`^${String(arcId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{4}-\\d{2}-\\d{2})\\.json$`)

/**
 * Every prior REPORT for an arc, oldest first, excluding `excludePath` (a re-run must never
 * ratchet against its own previous output — that would make `--force` non-reproducible).
 *
 * A file that will not read, will not JSON-parse, or carries no `dimensions` record is
 * SKIPPED with a WARN naming it. Reading a corrupt prior as an empty report would drag every
 * baseline toward zero and manufacture regressions, so the skip is loud rather than lenient.
 * The check is deliberately structural rather than a full bridged `.parse()` per file: the
 * ratchet reads only `judgeModel` and each dimension's `score`, and one tsx spawn per
 * historical report would make the command unusable at corpus scale.
 */
export function readPriorReports(dir, arcId, { excludePath, onWarn } = {}) {
  if (!existsSync(dir)) return []
  const re = reportNameRe(arcId)
  const out = []
  for (const f of readdirSync(dir).sort()) {
    if (!re.test(f)) continue
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

  if (opts.collectOnly) {
    if (opts.json) process.stdout.write(JSON.stringify(collected.trace, null, 2) + '\n')
    else
      say(
        `collected ${collected.trace.phases.length} phase(s) for arc ${arcId} — ` +
          `sweep ${collected.trace.sweep ? 'present' : 'absent'}, verdicts ${collected.trace.verdicts ? 'present' : 'absent'}, ` +
          `${collected.trace.git.escapeFixes.length} escape fix(es). Nothing written (--collect-only).`,
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

  const scored = scoreArcTrace(collected.trace)
  const draft = {
    arcId,
    date,
    dimensions: scored.dimensions,
    ratchet: [],
    attribution: assembleAttribution(collected.trace),
    notes: [...collected.warnings, ...scored.notes],
  }
  const priors = readPriorReports(dir, arcId, { excludePath: outPath, onWarn: say })
  draft.ratchet = computeRatchet(draft, priors)

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
  const stats = computeTimingStats(traces)
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
  const awaiting = DIMENSION_KEYS.filter((k) => JUDGE_DIMENSIONS.has(k))
  say(`awaiting the judge pass: ${awaiting.join(', ')}`)
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
