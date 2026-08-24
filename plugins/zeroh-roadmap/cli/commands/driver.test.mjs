#!/usr/bin/env node
/**
 * WIRED tests for `roadmap driver verify|register` — the honesty rail on driver capabilities.
 *
 * Rules pinned here:
 *   - verify PROBES the binary named by resolveDriver(id).bin and writes the probe's real
 *     stdout/stderr VERBATIM into .building/driver-verify-<id>.json — never a summary, never
 *     a boolean. Evidence that has been paraphrased is not evidence.
 *   - an absent binary is a FAIL row plus exit 2, never an uncaught throw: a stack trace in
 *     stderr is a bug report about the CLI, not a verdict about the host.
 *   - register READS provenance and PRINTS; it never writes cli/lib/drivers.mjs. Fresh means
 *     same-host and all-PASS — a report copied from another machine proves nothing here.
 *
 * Exit codes: 0 clean · 1 usage/config · 2 check failed/refused.
 * Hermetic tmp-git-repo + fake-binary-on-PATH pattern from cli/commands/codex.test.mjs.
 * Run: node --test cli/commands/driver.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { hostname, tmpdir } from 'node:os'
import { join, dirname, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRIVERS } from '../lib/drivers.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')
const REGISTRY = join(HERE, '..', 'lib', 'drivers.mjs')
const HOST = hostname()

const cleanups = []
process.on('exit', () => cleanups.forEach((fn) => fn()))

function tmpRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'driver-test-')))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q'], { cwd: root })
  mkdirSync(join(root, '.building'), { recursive: true })
  return root
}

/** Spawn the CLI by absolute node path: a scrubbed PATH may not contain `node`. */
function cli(root, args, env = process.env) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

const MARKER = `ZEROH-FAKE-${Math.random().toString(36).slice(2, 10)}`

/**
 * A fake `codex` printing capability rows shaped like the real ones, so a value-reading probe
 * still passes, with a run-unique marker in the version line so no assertion below can be
 * satisfied by text the registry already carries.
 */
const FAKE_STDOUT = [
  `codex-cli 99.0.0-${MARKER}`,
  'hooks                                stable             true',
  'multi_agent                          stable             true',
  'plugin_hooks                         removed            false',
  'plugins                              stable             true',
  'config lives at `~/.codex/config.toml` (a backtick + ${brace} the skeleton must survive)',
]

function fakeBinOnPath(root, name = 'codex', lines = FAKE_STDOUT) {
  const dir = join(root, 'fakebin')
  mkdirSync(dir, { recursive: true })
  const body = ['#!/bin/sh', ...lines.map((l) => `echo '${l}'`), 'exit 0', ''].join('\n')
  writeFileSync(join(dir, name), body)
  chmodSync(join(dir, name), 0o755)
  return { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` }
}

/** PATH with every directory holding an executable `name` removed — git and sh survive. */
function pathWithout(name) {
  const kept = (process.env.PATH ?? '').split(delimiter).filter((dir) => {
    if (!dir) return false
    try {
      return !readdirSync(dir).includes(name)
    } catch {
      return true
    }
  })
  return { ...process.env, PATH: kept.join(delimiter) }
}

function report(root, id) {
  const p = join(root, '.building', `driver-verify-${id}.json`)
  assert.ok(existsSync(p), `verify must write its provenance to ${p}`)
  return JSON.parse(readFileSync(p, 'utf8'))
}

function writeProvenance(root, id, overrides = {}) {
  const doc = {
    date: new Date().toISOString(),
    host: HOST,
    probes: [
      { name: 'version', command: `${id} --version`, output: FAKE_STDOUT[0], pass: true },
      { name: 'capabilities', command: `${id} features list`, output: FAKE_STDOUT.slice(1).join('\n'), pass: true },
    ],
    interpretation: 'subagents native; hooks and plugins available',
    ...overrides,
  }
  writeFileSync(join(root, '.building', `driver-verify-${id}.json`), JSON.stringify(doc, null, 2) + '\n')
  return doc
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const STACK_FRAME = /\n\s+at .+:\d+:\d+/
function assertNoStackTrace(stderr, what) {
  assert.doesNotMatch(stderr, STACK_FRAME, `${what} must be a verdict, not a stack trace: ${stderr}`)
}

// ── criterion 1: the provenance carries the probe's real output, verbatim ──────────────
test('verify records the probe stdout VERBATIM and exits 0 when every probe passes', () => {
  const root = tmpRepo()
  const env = fakeBinOnPath(root, DRIVERS.codex.bin)
  const r = cli(root, ['driver', 'verify', 'codex'], env)
  assert.equal(r.code, 0, `all probes green must exit 0: ${r.err}`)

  const doc = report(root, 'codex')
  assert.equal(doc.host, HOST, 'provenance names the host it was proven on')
  assert.equal(typeof doc.date, 'string')
  assert.ok(doc.date.trim().length > 0, 'provenance must be dated')
  assert.equal(typeof doc.interpretation, 'string')
  assert.ok(doc.interpretation.trim().length > 0, 'an unreadable probe dump is not a capability claim')
  assert.ok(Array.isArray(doc.probes) && doc.probes.length > 0, `probes must be a populated array: ${JSON.stringify(doc.probes)}`)

  for (const p of doc.probes) {
    assert.equal(typeof p.name, 'string')
    assert.ok(p.name.trim().length > 0, 'every probe is named')
    assert.equal(typeof p.command, 'string')
    assert.ok(p.command.includes(DRIVERS.codex.bin), `a probe must name the binary it ran: ${p.command}`)
    assert.equal(p.pass, true, `probe ${p.name} failed against the fake: ${p.output}`)
    assert.equal(typeof p.output, 'string', `probe ${p.name}: output must be the probe's text, never a boolean`)
    assert.ok(p.output.trim().length > 0, `probe ${p.name}: an empty output records nothing`)
  }

  // The verbatim rail: every line the report carries is a line the binary actually printed.
  // A summary, a truncation or a rewritten verdict fails this.
  const printed = new Set(FAKE_STDOUT.map((l) => l.trimEnd()))
  for (const p of doc.probes) {
    for (const line of p.output.split('\n').map((l) => l.trimEnd()).filter(Boolean)) {
      assert.ok(
        printed.has(line),
        `probe ${p.name} carries a line the binary never printed — output must be verbatim stdout: ${JSON.stringify(line)}`,
      )
    }
  }
  const union = doc.probes.map((p) => p.output).join('\n')
  assert.ok(
    union.includes(FAKE_STDOUT[0]),
    `the report must carry the binary's own version line verbatim (${FAKE_STDOUT[0]}); got: ${union}`,
  )
  assert.ok(union.includes(MARKER), 'the recorded text must come from this run\'s probe, not from the registry')
})

// ── an absent binary is a FAIL row, not a crash ────────────────────────────────────────
test('verify against an ABSENT binary writes a FAIL row and exits 2 with no stack trace', () => {
  const root = tmpRepo()
  const env = pathWithout(DRIVERS.codex.bin)
  const r = cli(root, ['driver', 'verify', 'codex'], env)
  assert.equal(r.code, 2, `an unprovable capability is a refusal, never a pass: ${r.err}`)
  assertNoStackTrace(r.err, 'an absent binary')
  assert.doesNotMatch(r.err, /^\s*at .*\(.*:\d+:\d+\)/m, `stack frame leaked to stderr: ${r.err}`)

  const doc = report(root, 'codex')
  assert.ok(
    doc.probes.some((p) => p.pass === false),
    `an absent binary must be recorded as a failed probe: ${JSON.stringify(doc.probes)}`,
  )
  for (const p of doc.probes.filter((x) => x.pass === false)) {
    assert.equal(typeof p.output, 'string')
    assert.ok(p.output.trim().length > 0, `probe ${p.name}: a failure must record what happened, not an empty string`)
  }
})

test('verify on an UNREGISTERED id refuses, naming every known driver id', () => {
  const root = tmpRepo()
  const known = Object.keys(DRIVERS)
  assert.ok(!known.includes('grok'), 'grok is the deliberately empty slot — an entry would void this test')
  const r = cli(root, ['driver', 'verify', 'grok'])
  assert.equal(r.code, 2, `an unregistered id must refuse: ${r.err}`)
  assert.match(r.err, /grok/, `the refusal must name the offending id: ${r.err}`)
  for (const id of known) {
    assert.ok(r.err.includes(id), `the refusal must name known driver ${id}: ${r.err}`)
  }
  assertNoStackTrace(r.err, 'an unregistered id')
  assert.ok(!existsSync(join(root, '.building', 'driver-verify-grok.json')), 'a refused id writes no provenance')
})

// ── criterion 2: register refuses without fresh same-host provenance ───────────────────
test('register with NO provenance exits 2 naming `roadmap driver verify <id>` as the remedy', () => {
  const root = tmpRepo()
  const r = cli(root, ['driver', 'register', 'codex'])
  assert.equal(r.code, 2, `an unverified id must refuse: ${r.err}`)
  assert.ok(
    r.err.includes('roadmap driver verify codex'),
    `stderr must name the exact remediation command: ${r.err}`,
  )
})

test('register with provenance from ANOTHER host exits 2 — a copied file is not proof', () => {
  const root = tmpRepo()
  const foreign = `not-${HOST}`
  writeProvenance(root, 'codex', { host: foreign })
  const r = cli(root, ['driver', 'register', 'codex'])
  assert.equal(r.code, 2, `provenance stamped ${foreign} must not certify ${HOST}: ${r.out}${r.err}`)
  assert.ok(r.err.includes('roadmap driver verify codex'), `stderr must name the remediation: ${r.err}`)
  assert.ok(r.err.includes(foreign) || r.err.includes(HOST), `the refusal must name the host mismatch: ${r.err}`)
})

test('register with a same-host report carrying one FAILED probe exits 2', () => {
  const root = tmpRepo()
  const doc = writeProvenance(root, 'codex')
  doc.probes[1].pass = false
  writeFileSync(join(root, '.building', 'driver-verify-codex.json'), JSON.stringify(doc, null, 2) + '\n')
  const r = cli(root, ['driver', 'register', 'codex'])
  assert.equal(r.code, 2, `one red probe is not a verified driver: ${r.out}${r.err}`)
  assert.ok(r.err.includes('roadmap driver verify codex'), `stderr must name the remediation: ${r.err}`)
})

// ── criterion 3: fresh all-PASS provenance prints guidance and edits nothing ───────────
test('register with fresh same-host all-PASS provenance exits 0 printing an entry skeleton', () => {
  const root = tmpRepo()
  writeProvenance(root, 'codex')
  const before = sha256(REGISTRY)
  const r = cli(root, ['driver', 'register', 'codex'])
  assert.equal(r.code, 0, `fresh same-host provenance must be accepted: ${r.err}`)
  assert.ok(r.out.includes('codex'), `the skeleton must name the id it registers: ${r.out}`)
  for (const field of ['bin', 'launch', 'verifiedAt']) {
    assert.ok(r.out.includes(field), `the skeleton must name the registry field ${field}: ${r.out}`)
  }
  assert.ok(r.out.includes(MARKER), `the skeleton must carry this host's probe text, not a placeholder: ${r.out}`)
  assert.equal(sha256(REGISTRY), before, 'register must never write cli/lib/drivers.mjs — a human pastes the entry')

  // The skeleton is printed under "paste this into drivers.mjs", so it has to BE JavaScript
  // whatever the probe printed.
  const entry = r.out.slice(r.out.indexOf(`  ${'codex'}: Object.freeze({`))
  assert.doesNotThrow(
    () => new Function(`return { ${entry} }`),
    `the printed entry must parse as JavaScript — probe output is arbitrary text: ${entry}`,
  )
})

test('register never writes the registry on ANY path it takes', () => {
  const root = tmpRepo()
  const before = sha256(REGISTRY)
  cli(root, ['driver', 'register', 'codex'])
  writeProvenance(root, 'codex', { host: `not-${HOST}` })
  cli(root, ['driver', 'register', 'codex'])
  writeProvenance(root, 'codex')
  cli(root, ['driver', 'register', 'codex'])
  assert.equal(sha256(REGISTRY), before, 'no register path may edit the registry')
})

// ── the capability probe reads the VALUE column, not a substring ──────────────────────
// A feature table names features that are OFF and features whose name contains another's;
// a probe that cannot tell those apart certifies capabilities the host does not have.
const CAP_CASES = [
  {
    what: 'every feature present but switched OFF',
    rows: [
      'hooks                                removed            false',
      'multi_agent                          removed            false',
      'plugin_hooks                         removed            false',
    ],
    code: 2,
  },
  {
    what: "only plugin_hooks, whose NAME contains 'hooks'",
    rows: [
      'plugin_hooks                         stable             true',
      'multi_agent                          stable             true',
    ],
    code: 2,
  },
  {
    what: 'both features on, under a MULTI-WORD status',
    rows: [
      'hooks                                under development  true',
      'multi_agent                          under development  true',
    ],
    code: 0,
  },
  { what: 'the real passing table', rows: FAKE_STDOUT.slice(1), code: 0 },
  {
    what: "a row is OFF and a LATER line carries the bare word 'true'",
    rows: [
      'hooks                                removed            false',
      'true',
      'multi_agent                          stable             true',
    ],
    code: 2,
  },
  {
    what: "a row states 'false' and a TRAILING default column says 'true'",
    rows: [
      'hooks                                removed            false              true',
      'multi_agent                          stable             true',
    ],
    code: 2,
  },
  {
    what: 'the SAME feature is stated twice, ON then OFF',
    rows: [
      'hooks                                stable             true',
      'hooks                                removed            false',
      'multi_agent                          stable             true',
    ],
    code: 2,
  },
  {
    what: 'the SAME feature is stated twice, OFF then ON',
    rows: [
      'hooks                                removed            false',
      'hooks                                stable             true',
      'multi_agent                          stable             true',
    ],
    code: 2,
  },
  {
    what: "a row states 'false' and prose after it ends in 'true'",
    rows: [
      'hooks                                removed            false              default was true',
      'multi_agent                          stable             true',
    ],
    code: 2,
  },
]

for (const c of CAP_CASES) {
  test(`verify on a feature table where ${c.what} exits ${c.code}`, () => {
    const root = tmpRepo()
    const env = fakeBinOnPath(root, DRIVERS.codex.bin, [`codex-cli 99.0.0-${MARKER}`, ...c.rows])
    const r = cli(root, ['driver', 'verify', 'codex'], env)
    assert.equal(r.code, c.code, `${c.what}: expected exit ${c.code}\n${r.err}`)
    const cap = report(root, 'codex').probes.find((p) => p.name === 'capabilities')
    assert.equal(cap.pass, c.code === 0, `${c.what}: the capabilities probe must decide this case\n${cap.output}`)
  })
}

// ── provenance certifies the driver it PROBED, never whichever id asked ────────────────
test('register refuses provenance whose probes ran a DIFFERENT binary', () => {
  const root = tmpRepo()
  const doc = writeProvenance(root, 'codex')
  doc.probes[0].command = 'someothertool --version'
  writeFileSync(join(root, '.building', 'driver-verify-codex.json'), JSON.stringify(doc, null, 2) + '\n')
  const r = cli(root, ['driver', 'register', 'codex'])
  assert.equal(r.code, 2, `a report of another binary is not this driver's proof: ${r.out}${r.err}`)
  assert.match(r.err, /someothertool --version/, `the refusal must name the foreign command: ${r.err}`)
})

for (const field of ['interpretation', 'date', 'host']) {
  test(`register refuses provenance carrying no ${field} — and never prints "undefined"`, () => {
    const root = tmpRepo()
    const doc = writeProvenance(root, 'codex')
    delete doc[field]
    writeFileSync(join(root, '.building', 'driver-verify-codex.json'), JSON.stringify(doc, null, 2) + '\n')
    const r = cli(root, ['driver', 'register', 'codex'])
    assert.equal(r.code, 2, `provenance missing ${field} is not a verdict: ${r.out}${r.err}`)
    assert.doesNotMatch(r.out + r.err, /undefined/, `no output may render an absent field: ${r.out}${r.err}`)
  })
}

test('verify outside a git repository is a verdict, not a stack trace', () => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'driver-nogit-')))
  cleanups.push(() => rmSync(outside, { recursive: true, force: true }))
  const r = cli(outside, ['driver', 'verify', 'codex'])
  assert.equal(r.code, 1, `a cwd outside a checkout is a usage error: ${r.err}`)
  assertNoStackTrace(r.err, 'a cwd outside a git repository')
  assert.match(r.err, /cannot resolve a consumer root/, `the refusal must name the cause: ${r.err}`)
  assert.match(r.err, /git said: .+/, `the refusal must carry git's own error, not only our reading of it: ${r.err}`)
})

// ── a report is the one input this command exists to distrust ──────────────────────────
const MALFORMED_PROBE_CASES = [
  { what: 'a probe row missing its output', mutate: (d) => delete d.probes[1].output },
  { what: 'a probe row whose output is a boolean', mutate: (d) => (d.probes[1].output = true) },
  { what: 'a null element in probes', mutate: (d) => (d.probes[1] = null) },
  { what: 'a probe row missing its command', mutate: (d) => delete d.probes[0].command },
  { what: 'a date that is not a date', mutate: (d) => (d.date = 'banana cream pie forever') },
]

for (const c of MALFORMED_PROBE_CASES) {
  test(`register refuses ${c.what} — a verdict, never a throw`, () => {
    const root = tmpRepo()
    const doc = writeProvenance(root, 'codex')
    c.mutate(doc)
    writeFileSync(join(root, '.building', 'driver-verify-codex.json'), JSON.stringify(doc, null, 2) + '\n')
    const r = cli(root, ['driver', 'register', 'codex'])
    assert.equal(r.code, 2, `${c.what}: malformed provenance is a refusal, not a usage error or a pass: ${r.out}${r.err}`)
    assertNoStackTrace(r.err, c.what)
    assert.doesNotMatch(r.out + r.err, /undefined/, `no output may render an absent field: ${r.out}${r.err}`)
    assert.equal(r.out, '', `nothing may be printed for pasting from a malformed report: ${r.out}`)
  })
}

test("the claude capability probe is not satisfied by a LONGER flag containing the token", () => {
  const root = tmpRepo()
  const env = fakeBinOnPath(root, DRIVERS.claude.bin, [
    '2.1.0-fake',
    '  --agents-legacy <json>                a different flag entirely',
    '  -p, --print                           Print response and exit',
  ])
  const r = cli(root, ['driver', 'verify', 'claude'], env)
  assert.equal(r.code, 2, `--agents-legacy must not certify --agents: ${r.err}`)
  const cap = report(root, 'claude').probes.find((p) => p.name === 'capabilities')
  assert.equal(cap.pass, false, `the capabilities probe must decide this case\n${cap.output}`)
})

// A report whose top level is not an object at all — the document is an input too.
for (const [what, body] of [
  ['the literal null', 'null'],
  ['an array', '[]'],
  ['a number', '42'],
  ['a bare string', '"provenance"'],
]) {
  test(`register refuses provenance that is ${what} — a verdict, never a throw`, () => {
    const root = tmpRepo()
    writeFileSync(join(root, '.building', 'driver-verify-codex.json'), `${body}\n`)
    const r = cli(root, ['driver', 'register', 'codex'])
    assert.equal(r.code, 2, `${what}: malformed provenance is a refusal: ${r.out}${r.err}`)
    assertNoStackTrace(r.err, what)
    assert.equal(r.out, '', `nothing may be printed for pasting: ${r.out}`)
  })
}

test('verify refuses an Object.prototype member as a driver id, never crashing on it', () => {
  const root = tmpRepo()
  for (const id of ['toString', 'constructor', '__proto__']) {
    const r = cli(root, ['driver', 'verify', id])
    assert.equal(r.code, 2, `verify ${id} must refuse: ${r.err}`)
    assertNoStackTrace(r.err, `verify ${id}`)
    assert.ok(!existsSync(join(root, '.building', `driver-verify-${id}.json`)), `${id}: a refused id writes no provenance`)
  }
})
