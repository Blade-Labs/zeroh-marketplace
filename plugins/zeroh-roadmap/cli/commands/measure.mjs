/**
 * roadmap measure [--flow F] [--assert N] [--json] — the protocol-load meter (ROADCODE
 * 1659.3). Sums ceil(bytes/4) over the files a flow actually loads into its driving
 * context, per cli/measure-manifest.json (DERIVED, each entry carrying the instruction
 * site that causes the load). This is the committed, re-runnable measurement the arc's
 * protocol-load-cut criterion demands (measured, never asserted — honesty rail 4).
 *
 * Exit contract (design §2): 0 = printed (and, with --assert, within budget) · 2 = the
 * flow total EXCEEDS --assert N (the cut cannot be narrated) · 1 = usage / a manifest
 * path that does not exist (a renamed skill must BREAK the meter, never silently shrink it).
 */
import { readFileSync, statSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MANIFEST = join(PLUGIN_ROOT, 'cli', 'measure-manifest.json')

const flagVal = (argv, name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

/**
 * The manifest sum for one flow: `{ rows, totalBytes, totalTokens, note }`, or null when the
 * answer cannot be derived — no readable manifest, an unknown flow, or a manifest path that no
 * longer exists. NEVER a partial sum: a renamed skill must break the meter loudly rather than
 * silently shrink it, and a caller stamping a partial figure into a report would be recording
 * a number that looks like a measurement and is not.
 *
 * Exported because the eval's workflow stamp needs the same figure. ONE metering
 * implementation, two consumers — `run()` below is the other.
 */
export function flowTokens(flowName, { manifestPath = MANIFEST, baseDir = PLUGIN_ROOT } = {}) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
  const flow = (manifest.flows ?? {})[flowName]
  if (!flow) return null

  const rows = []
  let totalBytes = 0
  let totalTokens = 0
  for (const entry of flow.files ?? []) {
    const abs = join(baseDir, entry.path)
    if (!existsSync(abs)) return null
    const bytes = statSync(abs).size
    const tokens = Math.ceil(bytes / 4)
    totalBytes += bytes
    totalTokens += tokens
    rows.push({ path: entry.path, bytes, tokens, why: entry.why })
  }
  return { rows, totalBytes, totalTokens, note: flow.note }
}

export default async function run(argv) {
  const json = argv.includes('--json')
  const flow = flagVal(argv, '--flow')
  const assertRaw = flagVal(argv, '--assert')
  const assertN = assertRaw != null ? Number(assertRaw) : null

  if (assertRaw != null && !Number.isFinite(assertN)) {
    process.stderr.write(`roadmap measure: --assert expects a number, got '${assertRaw}'\n`)
    return 1
  }

  // --manifest is a test-only override (the fixture suite points at a tmp manifest); its
  // entry paths resolve relative to the override file's dir. The default plugin manifest's
  // paths resolve relative to PLUGIN_ROOT.
  const manifestOverride = flagVal(argv, '--manifest')
  const manifestPath = manifestOverride ? resolve(manifestOverride) : MANIFEST
  const baseDir = manifestOverride ? dirname(manifestPath) : PLUGIN_ROOT

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    process.stderr.write(`roadmap measure: cannot read ${manifestPath}: ${e.message}\n`)
    return 1
  }

  const flows = manifest.flows ?? {}
  if (!flow) {
    process.stderr.write(`roadmap measure: --flow required. Known flows: ${Object.keys(flows).join(', ')}\n`)
    return 1
  }
  if (!flows[flow]) {
    process.stderr.write(`roadmap measure: unknown flow '${flow}'. Known flows: ${Object.keys(flows).join(', ')}\n`)
    return 1
  }

  // The preconditions above are validated here, with their own diagnostics, because flowTokens
  // reports only derivable-or-not; past them, the ONE remaining null cause is a missing path.
  const measured = flowTokens(flow, { manifestPath, baseDir })
  if (!measured) {
    // A renamed/deleted skill must break the meter loudly, never silently shrink it.
    const missing = (flows[flow].files ?? []).find((entry) => !existsSync(join(baseDir, entry.path)))
    process.stderr.write(`roadmap measure: manifest path does not exist — ${missing?.path ?? '(unresolved)'} (flow '${flow}'). A renamed skill must break the meter; fix the manifest.\n`)
    return 1
  }
  const { rows, totalBytes, totalTokens } = measured

  const overBudget = assertN != null && totalTokens > assertN

  if (json) {
    process.stdout.write(JSON.stringify({ flow, files: rows, totalBytes, totalTokens, assert: assertN, withinBudget: assertN == null ? null : !overBudget }, null, 2) + '\n')
  } else {
    const lines = [`# roadmap measure — flow '${flow}' (bytes/4 over the model-loaded set)`, '']
    if (flows[flow].note) lines.push(flows[flow].note, '')
    lines.push('| tokens | bytes | file |', '|---:|---:|---|')
    for (const r of rows) lines.push(`| ${r.tokens} | ${r.bytes} | ${r.path} |`)
    lines.push(`| **${totalTokens}** | **${totalBytes}** | **TOTAL (${rows.length} files)** |`, '')
    if (assertN != null) lines.push(overBudget ? `OVER BUDGET: ${totalTokens} > ${assertN} tokens` : `within budget: ${totalTokens} ≤ ${assertN} tokens`, '')
    process.stdout.write(lines.join('\n'))
  }

  return overBudget ? 2 : 0
}
