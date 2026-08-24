/**
 * roadmap driver — the honesty rail on driver capabilities.
 *
 *   roadmap driver verify <id>     probe the driver's real capabilities, write the provenance
 *   roadmap driver register <id>   refuse without fresh same-host provenance; else print the entry
 *
 * A capability is DECLARED and VERIFIED or it is recorded absent. `verify` runs each probe
 * against the binary named by resolveDriver(id).bin — never a literal, so cli/lib/drivers.mjs
 * stays the one home — and writes the probe's real output VERBATIM to the consumer root's
 * .building/driver-verify-<id>.json. A paraphrased probe is not evidence.
 *
 * Provenance is per-HOST and must never be committable, so verify also ensures .building/ is
 * ignored at the consumer root.
 *
 * `register` READS that provenance and PRINTS an entry skeleton. It never edits the registry:
 * the registry is committed code a human lands. FRESH means the report exists, its host equals
 * this host (a copied file proves nothing here), every probe passed, its probes name this
 * driver's own binary, and it carries a date and a reading of those probes.
 *
 * Exit codes: 0 clean · 1 usage · 2 refused / any probe red.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { gitToplevel } from '../lib/gitroot.mjs'
import { DRIVERS, resolveDriver } from '../lib/drivers.mjs'

const PROBE_TIMEOUT_MS = 60_000

/**
 * A feature is ON only if exactly ONE row has `name` as its first token, that row ends in
 * `true`, and it states no other verdict. Tokenised rather than pattern-matched: `hooks` must
 * not be satisfied by `plugin_hooks`, by a `true` on another line, by a trailing default column
 * after the row's own `removed false`, or by whichever of two contradicting rows comes first.
 */
function featureOn(name) {
  return (output) => {
    const rows = []
    for (const line of String(output).split('\n')) {
      const tokens = line.trim().split(/[ \t]+/)
      if (tokens[0] !== name) continue
      const verdicts = tokens.slice(1).filter((t) => t === 'true' || t === 'false')
      rows.push(verdicts.length === 1 && verdicts[0] === 'true' && tokens[tokens.length - 1] === 'true')
    }
    // A table stating the same feature twice is self-contradicting evidence, not a verdict to
    // pick from by row order.
    return rows.length === 1 && rows[0]
  }
}

/**
 * Per-driver probe sets. Only the ARGV is per-driver here; the binary always comes from the
 * registry. Every `expect` entry — a predicate or a regex — must hold over the output for the
 * probe to pass; without one, a zero exit is the pass. A driver with no entry gets the generic
 * set, and its interpretation says so — presence proven, capabilities unproven.
 *
 * Flag patterns are line-anchored on [ \t] (never \s, which in JS matches \n) and end on a
 * non-word, non-dash boundary, so `--agents` is not satisfied by `--agents-legacy`.
 */
const PROBES = Object.freeze({
  codex: Object.freeze([
    { name: 'version', args: ['--version'] },
    { name: 'capabilities', args: ['features', 'list'], expect: [featureOn('multi_agent'), featureOn('hooks')] },
    { name: 'exec-smoke', args: ['exec', '--help'] },
  ]),
  claude: Object.freeze([
    { name: 'version', args: ['--version'] },
    {
      name: 'capabilities',
      args: ['--help'],
      expect: [/^[ \t]*--agents(?![\w-])/m, /^[ \t]*-p,[ \t]+--print(?![\w-])/m],
    },
  ]),
})

const GENERIC_PROBES = Object.freeze([{ name: 'version', args: ['--version'] }])

function reportPath(root, id) {
  return join(root, '.building', `driver-verify-${id}.json`)
}

/** Append `.building/` to the consumer-root .gitignore unless it is already covered. */
function ensureBuildingIgnored(root) {
  const path = join(root, '.gitignore')
  const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (current.split('\n').some((l) => l.trim() === '.building/' || l.trim() === '.building')) return
  const sep = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  writeFileSync(path, `${current}${sep}.building/\n`)
}

/** Run one probe → { name, command, output, pass }. A missing binary is a FAIL row, never a throw. */
function runProbe(bin, probe) {
  const command = [bin, ...probe.args].join(' ')
  const r = spawnSync(bin, probe.args, { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS })
  if (r.error) return { name: probe.name, command, output: r.error.message, pass: false }
  const output = [r.stdout, r.stderr].filter((s) => s && s.length > 0).join('\n')
  const ran = r.status === 0
  const expected = (probe.expect ?? []).every((e) => (typeof e === 'function' ? e(output) : e.test(output)))
  return { name: probe.name, command, output, pass: ran && expected }
}

function interpret(id, probes, generic) {
  const passed = probes.filter((p) => p.pass)
  const failed = probes.filter((p) => !p.pass)
  const lines = [`${id}: ${passed.length}/${probes.length} probes passed on ${hostname()}.`]
  if (failed.length > 0) lines.push(`unproven: ${failed.map((p) => p.name).join(', ')}.`)
  if (generic) lines.push('generic probe set — presence proven, capabilities UNPROVEN, never assume them.')
  lines.push('A capability absent from these probes is unproven, never assumed present or absent.')
  return lines.join(' ')
}

function verifyDriver(root, id) {
  let entry
  try {
    entry = resolveDriver(id)
  } catch (e) {
    process.stderr.write(`roadmap driver: ${e.message}\n`)
    return 2
  }
  const set = Object.hasOwn(PROBES, id) ? PROBES[id] : GENERIC_PROBES
  const probes = set.map((p) => runProbe(entry.bin, p))
  const doc = {
    date: new Date().toISOString(),
    host: hostname(),
    probes,
    interpretation: interpret(id, probes, !Object.hasOwn(PROBES, id)),
  }
  mkdirSync(join(root, '.building'), { recursive: true })
  writeFileSync(reportPath(root, id), JSON.stringify(doc, null, 2) + '\n')
  ensureBuildingIgnored(root)

  for (const p of probes) process.stderr.write(`  ${p.pass ? 'PASS' : 'FAIL'}  ${p.name.padEnd(14)} ${p.command}\n`)
  process.stderr.write(`roadmap driver: provenance → ${reportPath(root, id)}\n`)
  if (probes.every((p) => p.pass)) return 0
  process.stderr.write(
    `roadmap driver: ${id} is NOT verified on ${hostname()} — the failed probes above are the evidence, not a reason to assume the capability\n`,
  )
  return 2
}

/** The provenance if it is fresh, else a refusal reason naming what is wrong with it. */
function freshProvenance(root, id) {
  const path = reportPath(root, id)
  if (!existsSync(path)) return { ok: false, reason: `no provenance at ${path}` }
  let doc
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return { ok: false, reason: `provenance at ${path} is not readable JSON: ${e.message}` }
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, reason: `provenance at ${path} is not a JSON object (got ${JSON.stringify(doc)})` }
  }
  for (const field of ['host', 'date', 'interpretation']) {
    if (typeof doc[field] !== 'string' || doc[field].trim().length === 0) {
      return { ok: false, reason: `provenance at ${path} carries no ${field} — evidence missing that field proves nothing` }
    }
  }
  if (Number.isNaN(Date.parse(doc.date))) {
    return { ok: false, reason: `provenance at ${path} carries an unparseable date '${doc.date}' — undated evidence cannot be read as fresh` }
  }
  const here = hostname()
  if (doc.host !== here) {
    return { ok: false, reason: `provenance was proven on host '${doc.host}', not on '${here}' — a copied report is not proof` }
  }
  const probes = Array.isArray(doc.probes) ? doc.probes : []
  if (probes.length === 0) return { ok: false, reason: `provenance at ${path} records no probes` }
  for (const [i, p] of probes.entries()) {
    if (p === null || typeof p !== 'object') {
      return { ok: false, reason: `provenance at ${path}: probe ${i} is not an object (${JSON.stringify(p)})` }
    }
    for (const field of ['name', 'command', 'output']) {
      if (typeof p[field] !== 'string' || p[field].trim().length === 0) {
        return { ok: false, reason: `provenance at ${path}: probe ${i} carries no ${field} — a row missing it records nothing` }
      }
    }
  }
  const failed = probes.filter((p) => p.pass !== true)
  if (failed.length > 0) {
    return { ok: false, reason: `probes still red: ${failed.map((p) => p.name).join(', ')}` }
  }
  let bin
  try {
    bin = resolveDriver(id).bin
  } catch (e) {
    return { ok: false, reason: e.message }
  }
  const foreign = probes.filter((p) => typeof p.command !== 'string' || !p.command.startsWith(`${bin} `))
  if (foreign.length > 0) {
    return {
      ok: false,
      reason: `provenance at ${path} records probes of another binary (${foreign.map((p) => p.command).join(', ')}), not of '${bin}'`,
    }
  }
  return { ok: true, doc }
}

/** The entry a human pastes into cli/lib/drivers.mjs, carrying THIS host's probe evidence. */
function entrySkeleton(id, doc) {
  const known = DRIVERS[id]
  const evidence = doc.probes.map((p) => p.output).join('\n')
  return [
    `  ${id}: Object.freeze({`,
    `    id: '${id}',`,
    `    family: '${known?.family ?? '<family>'}',`,
    `    bin: '${known?.bin ?? id}',`,
    '    launch: Object.freeze({',
    `      argv: (${known ? '{ worktree }' : 'opts'}) => [${known ? '/* keep the landed argv */' : '/* the launch argv */'}],`,
    `      promptChannel: '${known?.launch?.promptChannel ?? '<stdin|argv>'}',`,
    `      sandboxPosture: '${known?.launch?.sandboxPosture ?? '<bypass|inherit|sandboxed>'}',`,
    '    }),',
    `    resume: ${known?.resume ? `'${known.resume}'` : 'null'},`,
    `    roleCapabilities: Object.freeze({ /* only what the probes above proved */ }),`,
    '    verifiedAt: Object.freeze({',
    `      date: ${JSON.stringify(String(doc.date).slice(0, 10))},`,
    `      host: ${JSON.stringify(doc.host)},`,
    `      command: ${JSON.stringify(doc.probes.map((p) => p.command).join(' && '))},`,
    `      output: ${JSON.stringify(evidence)},`,
    '    }),',
    '  }),',
  ].join('\n')
}

function registerDriver(root, id) {
  const fresh = freshProvenance(root, id)
  if (!fresh.ok) {
    process.stderr.write(`roadmap driver: refusing to register '${id}' — ${fresh.reason}\n`)
    process.stderr.write(`roadmap driver: run \`roadmap driver verify ${id}\` on this host first\n`)
    return 2
  }
  process.stdout.write(
    `roadmap driver: '${id}': every recorded probe passed on ${fresh.doc.host}.\n` +
      `roadmap driver: ${fresh.doc.interpretation}\n` +
      'roadmap driver: paste this entry into cli/lib/drivers.mjs (this command never edits it), keeping roleCapabilities to what the probes above proved:\n\n',
  )
  process.stdout.write(entrySkeleton(id, fresh.doc) + '\n')
  return 0
}

export default async function run(argv) {
  const sub = argv[0]
  const id = argv[1]
  if ((sub !== 'verify' && sub !== 'register') || !id || id.startsWith('-')) {
    process.stderr.write('roadmap driver: usage: roadmap driver verify <id> | roadmap driver register <id>\n')
    return 1
  }
  let root
  try {
    root = gitToplevel(process.cwd())
  } catch (e) {
    process.stderr.write(
      `roadmap driver: cannot resolve a consumer root from ${process.cwd()} — provenance is written to the consumer root's .building/, so run this from a checkout (git said: ${e.message})\n`,
    )
    return 1
  }
  return sub === 'verify' ? verifyDriver(root, id) : registerDriver(root, id)
}
