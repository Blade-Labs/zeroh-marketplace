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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gitToplevel } from '../lib/gitroot.mjs'
import { bridgeEval, consumerSchemaPath, BridgeError, TSX_ABSENT_HINT } from '../lib/tsx-bridge.mjs'

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
    else if (a === '--force') opts.force = true
    else positional.push(a)
  }
  return { opts, positional }
}

const USAGE =
  'roadmap eval: usage: roadmap eval record-sweep|record-verdicts --arc <ID> [--force] [file|-]\n'

export default async function run(argv) {
  const { opts, positional } = parseArgs(argv)
  const sub = positional[0]
  const recorder = RECORDERS[sub]
  if (!recorder) {
    process.stderr.write(USAGE)
    return 1
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
