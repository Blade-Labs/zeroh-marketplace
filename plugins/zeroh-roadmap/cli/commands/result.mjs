/**
 * roadmap result check [--phase N] [file|-]   — validate a PhaseExecutionResult
 * roadmap contract show --json-schema          — emit its JSON Schema (registered as `contract`)
 *
 * Seam 3 (ROADCODE-DESIGN §3): BOTH route through the CONSUMER's installed
 * lib/roadmap/schema.ts via the tsx bridge — the plugin carries NO second
 * PhaseExecutionResult Zod copy. `contract show` emits the schema via the consumer's
 * own zod v4 z.toJSONSchema (a pre-v4 consumer fails LOUD with a migration pointer,
 * never a hand-mirrored schema).
 *
 * Exit-code contract (pre-made decision 10): 0 valid · 2 invalid/mismatch (one
 * `<path>: <message>` per Zod issue) · 1 toolchain-or-config error.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitToplevel } from '../lib/gitroot.mjs'
import {
  bridgeEval,
  consumerSchemaPath,
  BridgeError,
  TSX_ABSENT_HINT,
} from '../lib/tsx-bridge.mjs'

/**
 * Agent-card aliases → the model-id prefix that satisfies them. The launcher can only ever record
 * the ALIAS (a card cannot carry a full model id), so the reconcile is by family: the executor's
 * exact id must begin with its family, which admits a suffixed real-world id like
 * `claude-opus-5[1m]` while still refusing a different family.
 *
 * An alias outside this map — `inherit`, or any harness alias added later — is UNMAPPABLE, and an
 * unmappable alias is announced and skipped, never treated as a mismatch.
 */
const ALIAS_FAMILY = { fable: 'claude-fable', opus: 'claude-opus', sonnet: 'claude-sonnet', haiku: 'claude-haiku' }

/**
 * Reconcile the executor's self-stamped driver.model against the alias the LAUNCHER requested,
 * recorded in the arm file pre-spawn. Returns an exit code: 0 = nothing to say or agreement,
 * 2 = the return contradicts the request.
 *
 * A spawn prompt that ASSERTS a model id overrides the executor's own self-knowledge, and no other
 * check catches it: shape validation has driver optional, the codex reconcile is journal-gated,
 * and the validator warning fires on absent attribution rather than wrong attribution.
 */
function reconcileArmedAlias(root, phase, parsed) {
  const armPath = join(root, '.building', `${phase}-executor.armed`)
  if (!existsSync(armPath)) return 0
  let armed
  try {
    armed = JSON.parse(readFileSync(armPath, 'utf8')).expectedModelAlias
  } catch {
    return 0 // an unreadable or legacy arm records no request — nothing to reconcile against
  }
  if (typeof armed !== 'string' || armed.length === 0) return 0
  const family = Object.hasOwn(ALIAS_FAMILY, armed) ? ALIAS_FAMILY[armed] : undefined
  if (!family) {
    process.stderr.write(
      `roadmap result check: armed model alias '${armed}' maps to no model family — driver.model NOT reconciled `
        + `(arm ${armPath}). Add it to ALIAS_FAMILY in cli/commands/result.mjs if it is a real card alias.\n`,
    )
    return 0
  }
  const returned = parsed.driver?.model
  if (typeof returned !== 'string' || returned.length === 0) {
    process.stderr.write(
      `roadmap result check: the launcher requested model alias '${armed}' but the result carries NO driver.model `
        + `(arm ${armPath}). A spawn the launcher recorded cannot return unattributed: stamp driver `
        + '{ model: <your own exact model id>, lane: \'session\' }.\n',
    )
    return 2
  }
  if (returned.startsWith(family)) return 0
  process.stderr.write(
    `roadmap result check: driver.model '${returned}' is not of the family the launcher requested — the arm records `
      + `alias '${armed}' (family '${family}-*') at ${armPath}. The arm is what was ASKED FOR; driver.model is the `
      + 'executor\'s self-report. If a spawn prompt asserted a model id, that is the defect: an executor stamps its '
      + 'own id from its own harness context, never one handed to it.\n',
  )
  return 2
}

// Parse+validate the input JSON through the consumer shape's safeParse. argv[1] =
// schema path, argv[2] = the input JSON. PARSED on success, ZODISSUES (exit 3) on
// invalid, exit 4 on a load/shape/JSON error.
const PARSE_SCRIPT = `
const schemaPath = process.argv[1]
const inputArg = process.argv[2]
Promise.all([import('file://' + schemaPath), import('node:fs')]).then(([m, fs]) => {
  const shape = m.PhaseExecutionResultShape || (m.default && m.default.PhaseExecutionResultShape)
  if (!shape) { process.stderr.write('PhaseExecutionResultShape not exported from ' + schemaPath); process.exit(4) }
  // '-' ⇒ the doc is on STDIN (one argv entry caps at 128KB; a big doc fails E2BIG, empty stderr).
  const inputJson = inputArg === '-' ? fs.readFileSync(0, 'utf8') : inputArg
  let input
  try { input = JSON.parse(inputJson) } catch (e) { process.stderr.write('input is not valid JSON: ' + e.message); process.exit(4) }
  const r = shape.safeParse(input)
  if (r.success) { process.stdout.write('PARSED:' + JSON.stringify(r.data)) }
  else { process.stderr.write('ZODISSUES:' + JSON.stringify(r.error.issues)); process.exit(3) }
}).catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(4) })
`

// Emit the JSON Schema of PhaseExecutionResultShape via the consumer's own zod
// (resolved from cwd = consumerRoot). A pre-v4 zod (no toJSONSchema) → exit 5.
const CONTRACT_SCRIPT = `
const schemaPath = process.argv[1]
Promise.all([import('file://' + schemaPath), import('zod')]).then(([m, zmod]) => {
  const shape = m.PhaseExecutionResultShape || (m.default && m.default.PhaseExecutionResultShape)
  if (!shape) { process.stderr.write('PhaseExecutionResultShape not exported from ' + schemaPath); process.exit(4) }
  const toJSONSchema = zmod.toJSONSchema || (zmod.z && zmod.z.toJSONSchema)
  if (typeof toJSONSchema !== 'function') { process.stderr.write('NOJSONSCHEMA'); process.exit(5) }
  process.stdout.write('SCHEMA:' + JSON.stringify(toJSONSchema(shape)))
}).catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(4) })
`

function printZodIssues(issues) {
  for (const iss of issues ?? []) {
    const path = Array.isArray(iss.path) && iss.path.length > 0 ? iss.path.join('.') : '(root)'
    process.stderr.write(`${path}: ${iss.message}\n`)
  }
  if (!issues || issues.length === 0) process.stderr.write('(unparseable validation error)\n')
}

/** Read the result JSON from a file arg, '-'/absent (stdin). */
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
    if (a === '--phase') opts.phase = Number(argv[++i])
    else if (a === '--json') opts.json = true
    else positional.push(a)
  }
  return { opts, positional }
}

/** `roadmap result check …` */
export default async function run(argv) {
  const { opts, positional } = parseArgs(argv)
  const sub = positional[0]
  if (sub !== 'check') {
    process.stderr.write('roadmap result: usage: roadmap result check [--phase N] [file|-]\n')
    return 1
  }
  const fileArg = positional[1]

  let inputJson
  try {
    inputJson = readInput(fileArg)
  } catch (e) {
    process.stderr.write(`roadmap result check: cannot read input: ${e.message}\n`)
    return 1
  }
  if (!inputJson.trim()) {
    process.stderr.write('roadmap result check: no input (pass a file or pipe JSON on stdin)\n')
    return 1
  }

  let toplevel, schemaPath
  try {
    toplevel = gitToplevel(process.cwd())
    schemaPath = consumerSchemaPath(toplevel)
  } catch (e) {
    if (e instanceof BridgeError) for (const l of e.messageLines) process.stderr.write(l + '\n')
    else process.stderr.write(`roadmap result check: ${e.message}\n`)
    return 1
  }

  const res = bridgeEval(toplevel, PARSE_SCRIPT, { args: [schemaPath, '-'], input: inputJson })
  if (res.ok) {
    const idx = res.stdout.indexOf('PARSED:')
    const parsed = JSON.parse(res.stdout.slice(idx + 'PARSED:'.length))
    if (opts.phase != null && parsed.phase !== opts.phase) {
      process.stderr.write(`result.phase ${parsed.phase} !== --phase ${opts.phase}\n`)
      return 2
    }
    process.stdout.write(JSON.stringify(parsed) + '\n')
    // The arm is phase-scoped, so without --phase there is no arm to read.
    return opts.phase != null ? reconcileArmedAlias(toplevel, opts.phase, parsed) : 0
  }
  if (res.kind === 'tsx-absent') {
    process.stderr.write(TSX_ABSENT_HINT + '\n')
    return 1
  }
  if (res.kind === 'zod') {
    printZodIssues(res.issues)
    return 2
  }
  process.stderr.write((res.stderr || 'roadmap result check: bridge failure') + '\n')
  return 1
}

/** `roadmap contract show --json-schema` (delegated to from cli/commands/contract.mjs). */
export async function contractRun(argv) {
  const { positional } = parseArgs(argv)
  if (positional[0] !== 'show') {
    process.stderr.write('roadmap contract: usage: roadmap contract show --json-schema\n')
    return 1
  }
  let toplevel, schemaPath
  try {
    toplevel = gitToplevel(process.cwd())
    schemaPath = consumerSchemaPath(toplevel)
  } catch (e) {
    if (e instanceof BridgeError) for (const l of e.messageLines) process.stderr.write(l + '\n')
    else process.stderr.write(`roadmap contract show: ${e.message}\n`)
    return 1
  }
  const res = bridgeEval(toplevel, CONTRACT_SCRIPT, { args: [schemaPath] })
  if (res.ok) {
    const idx = res.stdout.indexOf('SCHEMA:')
    process.stdout.write(res.stdout.slice(idx + 'SCHEMA:'.length) + '\n')
    return 0
  }
  if (res.kind === 'tsx-absent') {
    process.stderr.write(TSX_ABSENT_HINT + '\n')
    return 1
  }
  if (res.exitCode === 5) {
    process.stderr.write(
      "roadmap contract show: the consumer's zod has no z.toJSONSchema — upgrade to zod v4 "
        + '(the JSON Schema is GENERATED from the one Zod shape, never hand-mirrored)\n',
    )
    return 1
  }
  process.stderr.write((res.stderr || 'roadmap contract show: bridge failure') + '\n')
  return 1
}
