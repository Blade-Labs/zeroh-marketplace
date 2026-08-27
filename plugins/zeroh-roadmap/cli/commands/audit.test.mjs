#!/usr/bin/env node
/**
 * Fixtures for `roadmap audit` — the 14 structural checks over a roadmap — driven
 * through the REAL bin/roadmap.mjs against tmp fixture repos. Observable behavior
 * ONLY: exit codes + --json output (this suite never imports the command source).
 *
 * A fixture repo's lib/roadmap/{registry,schema}.ts re-export the REAL
 * templates/*.ts, with a node_modules/zod symlink so discovery resolves the
 * consumer's own zod (same shape result.test.mjs uses). Phase/arc/archive files
 * are PLAIN OBJECT literals with UNQUOTED identifier keys — several checks (4
 * markers, 9 missing-kind, 11 batchMode) read the file's SOURCE TEXT, so a
 * JSON.stringify form (quoted keys) would defeat them; `js()` emits real JS.
 *
 * Each check gets a caught-RED fixture (the finding fires with the right severity)
 * AND a passing-GREEN fixture (the finding is absent). 12.1–12.4 each get their
 * own red+green. Plus: the exit-code pair, the historical-status exemption from
 * check 5, and a fully-clean repo → verdict CLEAN. Run:
 *   node --test cli/commands/audit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..', '..')
const BIN = join(PLUGIN_ROOT, 'bin', 'roadmap.mjs')
const REGISTRY = join(PLUGIN_ROOT, 'templates', 'registry.ts')
const SCHEMA = join(PLUGIN_ROOT, 'templates', 'schema.ts')
const PLUGIN_ZOD = realpathSync(join(PLUGIN_ROOT, 'node_modules', 'zod'))

const roots = []
process.on('exit', () => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

/** JS-literal serializer — UNQUOTED identifier keys, so source-text checks (4/9/11)
 *  see real `kind:` / `batchMode:` tokens rather than JSON's quoted `"kind":`. */
function js(v) {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (Array.isArray(v)) return '[' + v.map(js).join(', ') + ']'
  if (typeof v === 'object') {
    const body = Object.entries(v)
      .map(([k, val]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${js(val)}`)
      .join(', ')
    return '{ ' + body + ' }'
  }
  return JSON.stringify(v)
}

/** A fixture repo with the re-export registry+schema and a zod symlink. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'zr-audit-'))
  roots.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(PLUGIN_ZOD, join(root, 'node_modules', 'zod'), 'dir')
  writeFileSync(join(root, 'lib', 'roadmap', 'registry.ts'), `export * from '${REGISTRY}'\n`)
  writeFileSync(join(root, 'lib', 'roadmap', 'schema.ts'), `export * from '${SCHEMA}'\n`)
  return root
}

const writePhase = (root, n, obj) =>
  writeFileSync(join(root, 'roadmap', 'phases', `phase-${n}.phase.ts`), `export default ${js(obj)}\n`)
const writeRawPhase = (root, n, src) =>
  writeFileSync(join(root, 'roadmap', 'phases', `phase-${n}.phase.ts`), src)
const writeArchive = (root, ver, n, obj) => {
  mkdirSync(join(root, 'roadmap', 'archive', ver), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'archive', ver, `phase-${n}.phase.ts`), `export default ${js(obj)}\n`)
}
const writeArc = (root, id, obj) => {
  mkdirSync(join(root, 'roadmap', 'arcs'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'arcs', `${id}.arc.ts`), `export default ${js(obj)}\n`)
}
const writeBacklog = (root, items) =>
  writeFileSync(
    join(root, 'roadmap', 'backlog.ts'),
    `export default { tiers: [{ tier: 0, label: 'Default queue', items: ${js(items)} }] }\n`,
  )
const writeFollowup = (root, name, source) => {
  mkdirSync(join(root, 'roadmap', 'followups'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'followups', name), source)
}

/** A git repo with one commit whose subject names `phase <n>` (age ≈ 0 → not stale). */
function gitCommitPhase(root, n) {
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' })
  git('init', '-q')
  // Stage explicit paths only — a shared-host hook blocks `git add -A`.
  git('add', 'roadmap', 'lib')
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `phase ${n} — landed the work here`], { stdio: 'ignore' })
}

/** Drive bin/roadmap.mjs `audit <root> --json`; return { code, report }. */
function audit(root) {
  let code = 0
  let stdout = ''
  let stderr = ''
  try {
    stdout = execFileSync('node', [BIN, 'audit', root, '--json'], { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    code = err.status ?? 1
    stdout = (err.stdout ?? '').toString()
    stderr = (err.stderr ?? '').toString()
  }
  let report = null
  try {
    report = JSON.parse(stdout)
  } catch {
    /* left null — caller asserts on code/stderr for the usage-error path */
  }
  return { code, report, stdout, stderr }
}

const has = (report, check, severity) =>
  report.findings.some((f) => f.check === check && f.severity === severity)

// ── phase / task builders ────────────────────────────────────────────────────
const basePhase = (n, o = {}) => ({ phase: n, name: 'Phase named here', status: 'backlog', kind: 'logic', arcId: null, tasks: [], ...o })
const doneTask = (id, o = {}) => ({ id, title: 'Task title here now', done: true, ...o })
const openTask = (id, o = {}) => ({ id, title: 'Task title here now', done: false, ...o })
const cleanTR = (o = {}) => ({ whatWasDone: 'did the real work', how: 'by doing the thing', compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'None', ...o })
const archived = (n, ver, o = {}) => ({ phase: n, name: 'Archived phase named', status: 'done', kind: 'logic', version: ver, tasks: [], ...o })

// ════════════════════════════════════════════════════════════════════════════
// Check 1 — dangling phase dependsOn → CRITICAL
// ════════════════════════════════════════════════════════════════════════════
test('check 1 RED — phase dependsOn a number with no phase file → CRITICAL, exit 2', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { dependsOn: [999] }))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.equal(report.verdict, 'BROKEN')
  assert.ok(has(report, 1, 'CRITICAL'), 'expected a check-1 CRITICAL finding')
})

test('check 1 GREEN — every dependsOn resolves → no check-1 finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { dependsOn: [101] }))
  writePhase(root, 101, basePhase(101))
  const { report } = audit(root)
  assert.ok(!has(report, 1, 'CRITICAL'), 'check-1 must not fire when the dep exists')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 2 — dependency cycle → CRITICAL
// ════════════════════════════════════════════════════════════════════════════
test('check 2 RED — A dependsOn B, B dependsOn A → CRITICAL, exit 2', () => {
  const root = makeRepo()
  writePhase(root, 101, basePhase(101, { dependsOn: [102] }))
  writePhase(root, 102, basePhase(102, { dependsOn: [101] }))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 2, 'CRITICAL'), 'expected a check-2 CRITICAL finding')
})

test('check 2 GREEN — a linear dependency chain → no check-2 finding', () => {
  const root = makeRepo()
  writePhase(root, 101, basePhase(101, { dependsOn: [102] }))
  writePhase(root, 102, basePhase(102, { dependsOn: [] }))
  const { report } = audit(root)
  assert.ok(!has(report, 2, 'CRITICAL'), 'no cycle → no check-2 finding')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 3 — backlog queues a phase with no phase file → HIGH
// ════════════════════════════════════════════════════════════════════════════
test('check 3 RED — backlog queues a phase with no phase file → HIGH, exit 2', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100))
  writeBacklog(root, [{ phase: 777, name: 'Ghost phase queued here' }])
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 3, 'HIGH'), 'expected a check-3 HIGH finding')
})

test('check 3 GREEN — every backlog entry has a phase file → no check-3 finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100))
  writeBacklog(root, [{ phase: 100, name: 'Real queued phase here' }])
  const { report } = audit(root)
  assert.ok(!has(report, 3, 'HIGH'), 'backlog entry with a file → no check-3 finding')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 4 — [NEEDS CLARIFICATION marker → MEDIUM (escalates to CRITICAL in backlog)
// ════════════════════════════════════════════════════════════════════════════
test('check 4 RED — a [NEEDS CLARIFICATION marker in a non-queued phase → MEDIUM, exit 0', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { notes: '[NEEDS CLARIFICATION: which API to call]' }))
  const { code, report } = audit(root)
  assert.equal(code, 0, 'MEDIUM-only → exit 0 (HAS ISSUES)')
  assert.ok(has(report, 4, 'MEDIUM'), 'expected a check-4 MEDIUM finding')
  assert.ok(!has(report, 4, 'CRITICAL'), 'a non-queued marker must not escalate')
})

test('check 4 RED escalation — the marked phase is ALSO in the backlog → CRITICAL, exit 2', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { notes: '[NEEDS CLARIFICATION: which API to call]' }))
  writeBacklog(root, [{ phase: 100, name: 'Queued unclear phase' }])
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 4, 'CRITICAL'), 'a queued marker must escalate to CRITICAL')
})

test('check 4 GREEN — no unresolved marker → no check-4 finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { notes: 'Fully specified, nothing open here.' }))
  const { report } = audit(root)
  assert.ok(!has(report, 4, 'MEDIUM') && !has(report, 4, 'CRITICAL'), 'clean notes → no check-4 finding')
})

// ── Check 4 scoping: WHERE the check is armed, and WHAT counts as a marker ──
// Two independent suppressors, tested one at a time so a half-fix cannot pass:
//   (a) STATUS — a terminal phase (done/historical/cancelled) is a shipped record, and a record
//       may quote whatever it resolved; the check is armed only on phases still to be executed.
//   (b) TERMINATION — a marker is the token CLOSED by a colon (question inline) or a bracket (the bare
//       form every protocol home documents). Both fire: missing a real unresolved question in a
//       queued phase is the dangerous direction. An UNTERMINATED occurrence is a guard string
//       NAMING the token, never one being asked. A live phase that quotes a terminated form in
//       prose does red — accepted conservatism; records describe the token instead of quoting it.
// Both shapes below are verbatim from done phase 8, which this audit red permanently and falsely.

/** A multi-LINE phase literal: check 4 reports file:line, so each shape needs its own line. */
const phaseLines = (n, status, tail) => `export default {
  phase: ${n},
  name: 'Phase named right here',
  status: '${status}',
  kind: 'logic',
  arcId: null,
  tasks: [],
${tail}}
`
const REAL_MARKER = '[NEEDS CLARIFICATION: which auth flow?]'

test('check 4 — a DONE phase quoting the literal at all (guard string, sign-off count) yields no finding — the STATUS suppressor', () => {
  const root = makeRepo()
  writeRawPhase(root, 800, phaseLines(800, 'done',
    "  markerGuards: ['[NEEDS CLARIFICATION', 'TODO('],\n"
    + "  notes: 'Sign-off evidence: 0 [NEEDS CLARIFICATION] markers remained in the plan.',\n"))
  const { code, report } = audit(root)
  assert.deepEqual(report.findings.filter((f) => f.check === 4), [], 'neither a guard-string list entry nor a count of markers is an open question')
  assert.equal(report.verdict, 'CLEAN', 'these two shapes alone are what pinned a real roadmap at a standing HAS ISSUES verdict')
  assert.equal(code, 0)
})

test('check 4 — a REAL marker is history in a terminal phase, but still fires in a live one', () => {
  for (const status of ['done', 'historical', 'cancelled']) {
    const terminal = makeRepo()
    writeRawPhase(terminal, 800, phaseLines(800, status, `  notes: '${REAL_MARKER}',\n`))
    const { report } = audit(terminal)
    assert.deepEqual(report.findings.filter((f) => f.check === 4), [], `a ${status} phase cannot be executed again — its recorded question is not an open one`)
  }

  const live = makeRepo()
  writeRawPhase(live, 800, phaseLines(800, 'backlog', `  notes: '${REAL_MARKER}',\n`))
  const { code, report } = audit(live)
  const found = report.findings.filter((f) => f.check === 4)
  assert.equal(found.length, 1, 'the check stays armed on a live phase — exactly one marker, one finding')
  assert.equal(found[0].severity, 'MEDIUM', 'not queued → MEDIUM')
  assert.equal(code, 0)
  assert.match(found[0].location, /phase-800\.phase\.ts:8$/, 'the location points at the marker LINE (line 8), not the file')
})

test('check 4 — TERMINATION is the boundary: an unterminated guard string is clean, BOTH documented marker forms fire', () => {
  const guard = makeRepo()
  writeRawPhase(guard, 800, phaseLines(800, 'backlog', "  notes: 'markerGuards scanned for [NEEDS CLARIFICATION and TODO(',\n"))
  writeBacklog(guard, [{ phase: 800, name: 'Queued phase named here' }])
  const guardReport = audit(guard).report
  assert.deepEqual(guardReport.findings.filter((f) => f.check === 4), [], 'a guard string NAMING the token is not a marker, even in the phase that runs next')
  assert.equal(guardReport.verdict, 'CLEAN')

  // The dangerous direction: the BARE documented form carrying a question must still red. Every
  // protocol home writes the marker bare, and this check is the only code enforcement of it.
  const bare = makeRepo()
  writeRawPhase(bare, 800, phaseLines(800, 'backlog', "  notes: '[NEEDS CLARIFICATION] which auth flow does the consumer use?',\n"))
  writeBacklog(bare, [{ phase: 800, name: 'Queued phase named here' }])
  const bareFound = audit(bare).report.findings.filter((f) => f.check === 4)
  assert.equal(bareFound.length, 1, 'the bare documented marker form in a QUEUED phase must escalate')
  assert.equal(bareFound[0].severity, 'CRITICAL')

  const real = makeRepo()
  writeRawPhase(real, 800, phaseLines(800, 'backlog', `  notes: '${REAL_MARKER}',\n`))
  writeBacklog(real, [{ phase: 800, name: 'Queued phase named here' }])
  const { code, report } = audit(real)
  const found = report.findings.filter((f) => f.check === 4)
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'CRITICAL', 'an unanswered question in the phase queued for execution still escalates')
  assert.equal(found[0].phase, 800)
  assert.equal(code, 2)
})

// ════════════════════════════════════════════════════════════════════════════
// Check 5 — status:'done' phase with a task done:false → HIGH
// ════════════════════════════════════════════════════════════════════════════
test('check 5 RED — a done phase with an incomplete task → HIGH, exit 2', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { status: 'done', tasks: [openTask('100.1')] }))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 5, 'HIGH'), 'expected a check-5 HIGH finding')
})

test('check 5 GREEN — a done phase whose tasks are all done → no check-5 finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { status: 'done', tasks: [doneTask('100.1')] }))
  const { report } = audit(root)
  assert.ok(!has(report, 5, 'HIGH'), 'all tasks done → no check-5 finding')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 6 — task dependsOn resolution → HIGH (missing / forward-ref); MEDIUM (phase-number-like)
// ════════════════════════════════════════════════════════════════════════════
test('check 6 RED — task dependsOn a task id that does not exist → HIGH, exit 2', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { tasks: [openTask('100.1', { dependsOn: ['100.9'] })] }))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 6, 'HIGH'), 'expected a check-6 HIGH finding')
})

test('check 6 RED forward-reference — task depends on a LATER task id → HIGH, exit 2', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { tasks: [openTask('100.1', { dependsOn: ['100.2'] }), openTask('100.2')] }))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 6, 'HIGH'), 'a forward reference is a check-6 HIGH')
})

test('check 6 RED phase-number-like — dep looks like a phase number not "N.M" → MEDIUM, exit 0', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { tasks: [openTask('100.1', { dependsOn: ['99'] })] }))
  const { code, report } = audit(root)
  assert.equal(code, 0, 'MEDIUM-only → exit 0')
  assert.ok(has(report, 6, 'MEDIUM'), 'a phase-number-like dep is a check-6 MEDIUM')
})

test('check 6 GREEN — a valid backward task dependency → no check-6 finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { tasks: [openTask('100.1'), openTask('100.2', { dependsOn: ['100.1'] })] }))
  const { report } = audit(root)
  assert.ok(!has(report, 6, 'HIGH') && !has(report, 6, 'MEDIUM'), 'valid task dep → no check-6 finding')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 7 — in-progress phase, stale/unknown commit age → LOW
// ════════════════════════════════════════════════════════════════════════════
test('check 7 RED — an in-progress phase with no commit history → LOW (unknown age), exit 0', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { status: 'in-progress' }))
  const { code, report } = audit(root)
  assert.equal(code, 0, 'LOW-only → exit 0')
  assert.ok(has(report, 7, 'LOW'), 'expected a check-7 LOW finding')
})

test('check 7 GREEN — an in-progress phase with a recent "phase N" commit → no check-7 finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { status: 'in-progress' }))
  gitCommitPhase(root, 100)
  const { report } = audit(root)
  assert.ok(!has(report, 7, 'LOW'), 'a fresh commit clears the check-7 age finding')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 8 — duplicate phase number across active + archive → CRITICAL
// ════════════════════════════════════════════════════════════════════════════
test('check 8 RED — the same phase number in phases/ AND archive/<v>/ → CRITICAL, exit 2', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100))
  writeArchive(root, '1.0.0', 100, archived(100, '1.0.0'))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 8, 'CRITICAL'), 'expected a check-8 CRITICAL finding')
})

test('check 8 GREEN — active and archived numbers are disjoint → no check-8 finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100))
  writeArchive(root, '1.0.0', 101, archived(101, '1.0.0'))
  const { report } = audit(root)
  assert.ok(!has(report, 8, 'CRITICAL'), 'disjoint numbers → no check-8 finding')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 9 — phase file missing the kind: field → HIGH
// ════════════════════════════════════════════════════════════════════════════
test('check 9 RED — a phase file omitting kind: → HIGH, exit 2', () => {
  const root = makeRepo()
  const obj = basePhase(100)
  delete obj.kind
  writePhase(root, 100, obj)
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 9, 'HIGH'), 'expected a check-9 HIGH finding')
})

test('check 9 GREEN — a phase file carrying kind: → no check-9 finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { kind: 'logic' }))
  const { report } = audit(root)
  assert.ok(!has(report, 9, 'HIGH'), 'kind present → no check-9 finding')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 10 — backlog queues a terminal/archived phase (severity by status)
// ════════════════════════════════════════════════════════════════════════════
test('check 10 RED done — backlog queues a done phase → MEDIUM, exit 0', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { status: 'done', tasks: [doneTask('100.1')] }))
  writeBacklog(root, [{ phase: 100, name: 'Queued done phase here' }])
  const { code, report } = audit(root)
  assert.equal(code, 0)
  assert.ok(has(report, 10, 'MEDIUM'), 'queued done phase → check-10 MEDIUM')
})

test('check 10 RED cancelled → LOW; historical → LOW', () => {
  const rootC = makeRepo()
  writePhase(rootC, 100, basePhase(100, { status: 'cancelled' }))
  writeBacklog(rootC, [{ phase: 100, name: 'Queued cancelled phase' }])
  assert.ok(has(audit(rootC).report, 10, 'LOW'), 'queued cancelled phase → check-10 LOW')

  const rootH = makeRepo()
  writePhase(rootH, 100, basePhase(100, { status: 'historical' }))
  writeBacklog(rootH, [{ phase: 100, name: 'Queued historical phase' }])
  assert.ok(has(audit(rootH).report, 10, 'LOW'), 'queued historical phase → check-10 LOW')
})

test('check 10 RED archived — backlog queues an archived phase → HIGH, exit 2', () => {
  const root = makeRepo()
  writeArchive(root, '1.0.0', 100, archived(100, '1.0.0'))
  writeBacklog(root, [{ phase: 100, name: 'Queued archived phase' }])
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 10, 'HIGH'), 'queued archived phase → check-10 HIGH')
})

test('check 10 GREEN — backlog queues only a backlog-status phase → no check-10 finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { status: 'backlog' }))
  writeBacklog(root, [{ phase: 100, name: 'Queued backlog phase here' }])
  const { report } = audit(root)
  assert.ok(
    !has(report, 10, 'HIGH') && !has(report, 10, 'MEDIUM') && !has(report, 10, 'LOW'),
    'queueing a live backlog phase → no check-10 finding',
  )
})

// ════════════════════════════════════════════════════════════════════════════
// Check 11 — oversize task (files>10 OR steps>6) without batchMode, not done → HIGH
// ════════════════════════════════════════════════════════════════════════════
test('check 11 RED files — files.length>10 without batchMode on an open task → HIGH, exit 2', () => {
  const root = makeRepo()
  const files = Array.from({ length: 12 }, (_, i) => `src/file${i}.ts`)
  writePhase(root, 100, basePhase(100, { tasks: [openTask('100.1', { files })] }))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 11, 'HIGH'), 'expected a check-11 HIGH finding')
})

test('check 11 RED steps — steps.length>6 without batchMode on an open task → HIGH, exit 2', () => {
  const root = makeRepo()
  const steps = Array.from({ length: 8 }, (_, i) => ({ file: `src/f${i}.ts`, description: 'do the step here' }))
  writePhase(root, 100, basePhase(100, { tasks: [openTask('100.1', { steps })] }))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 11, 'HIGH'), 'an 8-step task without batchMode is a check-11 HIGH')
})

test('check 11 GREEN — oversize task carrying batchMode:true → no check-11 finding', () => {
  const root = makeRepo()
  const files = Array.from({ length: 12 }, (_, i) => `src/file${i}.ts`)
  writePhase(root, 100, basePhase(100, { tasks: [openTask('100.1', { files, batchMode: true })] }))
  const { report } = audit(root)
  assert.ok(!has(report, 11, 'HIGH'), 'batchMode:true licenses the oversize task')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 12.1 — archived phase with status != 'done' → CRITICAL
// ════════════════════════════════════════════════════════════════════════════
test('check 12.1 RED — an archived phase whose status is not done → CRITICAL, exit 2', () => {
  const root = makeRepo()
  writeArchive(root, '1.0.0', 100, archived(100, '1.0.0', { status: 'in-progress' }))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 12, 'CRITICAL'), 'expected a check-12(.1) CRITICAL finding')
})

test('check 12.1 GREEN — an archived done phase → no check-12 CRITICAL for status', () => {
  const root = makeRepo()
  writeArchive(root, '1.0.0', 100, archived(100, '1.0.0', { status: 'done' }))
  const { report } = audit(root)
  assert.ok(!has(report, 12, 'CRITICAL'), 'a well-formed archived done phase → no check-12 CRITICAL')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 12.2 — archived phase version field != containing dir name → CRITICAL
// ════════════════════════════════════════════════════════════════════════════
test('check 12.2 RED — archived phase version disagrees with its dir → CRITICAL, exit 2', () => {
  const root = makeRepo()
  writeArchive(root, '1.0.0', 100, archived(100, '2.0.0'))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 12, 'CRITICAL'), 'a version/dir mismatch is a check-12(.2) CRITICAL')
})

test('check 12.2 GREEN — archived phase version matches its dir → no check-12 CRITICAL', () => {
  const root = makeRepo()
  writeArchive(root, '1.0.0', 100, archived(100, '1.0.0'))
  const { report } = audit(root)
  assert.ok(!has(report, 12, 'CRITICAL'), 'version === dir → no check-12 CRITICAL')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 12.3 — archived phase with open (non-"None", unclosed) debt → HIGH
// ════════════════════════════════════════════════════════════════════════════
test('check 12.3 RED — archived non-"None" debt with NO closing debtResolution → HIGH, exit 2', () => {
  const root = makeRepo()
  writeArchive(root, '1.0.0', 100, archived(100, '1.0.0', {
    tasks: [doneTask('100.1', { transparencyReport: cleanTR({ compromises: 'cut this corner for now' }) })],
  }))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 12, 'HIGH'), 'open archived debt is a check-12(.3) HIGH')
})

test('check 12.3 RED planned — a debtResolution status:planned stays OPEN → HIGH, exit 2', () => {
  const root = makeRepo()
  writeArchive(root, '1.0.0', 100, archived(100, '1.0.0', {
    tasks: [doneTask('100.1', { transparencyReport: cleanTR({ compromises: 'cut this corner for now' }) })],
    debtResolutions: [{ ref: '100.1.compromises', status: 'planned', date: '2026-01-01' }],
  }))
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 12, 'HIGH'), 'a planned (not-yet-closed) resolution keeps the debt a check-12 HIGH')
})

test('check 12.3 GREEN — a status:fixed debtResolution closes the debt → no check-12 HIGH', () => {
  const root = makeRepo()
  writeArchive(root, '1.0.0', 100, archived(100, '1.0.0', {
    tasks: [doneTask('100.1', { transparencyReport: cleanTR({ compromises: 'cut this corner for now' }) })],
    debtResolutions: [{ ref: '100.1.compromises', status: 'fixed', via: 'abc1234', date: '2026-01-01' }],
  }))
  const { report } = audit(root)
  assert.ok(!has(report, 12, 'HIGH'), 'a fixed resolution closes the debt → no check-12 HIGH')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 12.4 — archived debtResolution ref matching no non-"None" field → MEDIUM
// ════════════════════════════════════════════════════════════════════════════
test('check 12.4 RED — a debtResolution ref matching no non-"None" field → MEDIUM, exit 0', () => {
  const root = makeRepo()
  writeArchive(root, '1.0.0', 100, archived(100, '1.0.0', {
    tasks: [doneTask('100.1', { transparencyReport: cleanTR() })],
    debtResolutions: [{ ref: '100.1.compromises', status: 'fixed', via: 'abc1234', date: '2026-01-01' }],
  }))
  const { code, report } = audit(root)
  assert.equal(code, 0, 'MEDIUM-only → exit 0')
  assert.ok(has(report, 12, 'MEDIUM'), 'a dangling debtResolution is a check-12(.4) MEDIUM')
})

test('check 12.4 GREEN — a debtResolution matching a real non-"None" field → no check-12 MEDIUM', () => {
  const root = makeRepo()
  writeArchive(root, '1.0.0', 100, archived(100, '1.0.0', {
    tasks: [doneTask('100.1', { transparencyReport: cleanTR({ compromises: 'cut this corner for now' }) })],
    debtResolutions: [{ ref: '100.1.compromises', status: 'fixed', via: 'abc1234', date: '2026-01-01' }],
  }))
  const { report } = audit(root)
  assert.ok(!has(report, 12, 'MEDIUM'), 'a matched debtResolution → no check-12 MEDIUM')
})

// ════════════════════════════════════════════════════════════════════════════
// Check 13 — limitations disposed pre-archive (release-sweep's walk) → MEDIUM (WARN)
// ════════════════════════════════════════════════════════════════════════════
test('check 13 RED — an ACTIVE phase disposing a .limitations ref as fixed → MEDIUM, exit 0, verdict HAS ISSUES', () => {
  const root = makeRepo()
  writePhase(root, 900, basePhase(900, {
    tasks: [doneTask('900.1', { transparencyReport: cleanTR({ limitations: 'known gap left for a later phase' }) })],
    debtResolutions: [{ ref: '900.1.limitations', status: 'fixed', via: 'abc1234', date: '2026-01-01' }],
  }))
  const { code, report } = audit(root)
  assert.equal(code, 0, 'a check-13 MEDIUM never breaks the §2 exit contract')
  assert.equal(report.verdict, 'HAS ISSUES', 'MEDIUM-only → HAS ISSUES, never BROKEN')
  assert.ok(has(report, 13, 'MEDIUM'), 'disposing limitations pre-archive on an unarchived phase is a check-13 MEDIUM')
})

test('check 13 GREEN planned — the same .limitations ref left status:planned → no check-13 finding', () => {
  const root = makeRepo()
  writePhase(root, 900, basePhase(900, {
    tasks: [doneTask('900.1', { transparencyReport: cleanTR({ limitations: 'known gap left for a later phase' }) })],
    debtResolutions: [{ ref: '900.1.limitations', status: 'planned', date: '2026-01-01' }],
  }))
  const { report } = audit(root)
  assert.ok(!has(report, 13, 'MEDIUM'), 'planned is a legitimate open disposition, not a check-13 finding')
})

test("check 13 GREEN archived — an ARCHIVED phase disposing .limitations as fixed → no check-13 finding", () => {
  const root = makeRepo()
  writeArchive(root, '1.0.0', 900, archived(900, '1.0.0', {
    tasks: [doneTask('900.1', { transparencyReport: cleanTR({ limitations: 'known gap left for a later phase' }) })],
    debtResolutions: [{ ref: '900.1.limitations', status: 'fixed', via: 'abc1234', date: '2026-01-01' }],
  }))
  const { report } = audit(root)
  assert.ok(!has(report, 13, 'MEDIUM'), "an archived phase's limitations disposal is release-sweep's legitimate walk")
})

// ════════════════════════════════════════════════════════════════════════════
// Check 14 — followup hygiene (report-only)
// ════════════════════════════════════════════════════════════════════════════
test('check 14 RED — an UNTRIAGED orphan followup → MEDIUM', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100))
  writeFollowup(root, 'orphan.md', 'No lifecycle header\n')
  const { code, report } = audit(root)
  assert.equal(code, 0)
  assert.ok(has(report, 14, 'MEDIUM'))
})

test('check 14 GREEN — a referenced UNTRIAGED followup is not an orphan finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { notes: 'followups/referenced.md' }))
  writeFollowup(root, 'referenced.md', 'No lifecycle header\n')
  const { report } = audit(root)
  assert.ok(!has(report, 14, 'MEDIUM'))
})

test('check 14 RED — a spent followup still present → LOW', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100))
  writeFollowup(root, 'spent.md', '---\nstatus: spent\n---\nDone\n')
  const { report } = audit(root)
  assert.ok(has(report, 14, 'LOW'))
})

test('check 14 GREEN — a live followup is not a spent finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100))
  writeFollowup(root, 'live.md', '---\nstatus: live\n---\nActive\n')
  const { report } = audit(root)
  assert.ok(!has(report, 14, 'LOW'))
})

test('check 14 RED — a spent followup that is STILL REFERENCED → HIGH (deleting it breaks the referrer)', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { notes: 'followups/still-cited.md' }))
  writeFollowup(root, 'still-cited.md', '---\nstatus: spent\n---\nClaimed done\n')
  const { code, report } = audit(root)
  assert.ok(has(report, 14, 'HIGH'), 'a deletion-authorizing stamp on a referenced file is the dangerous shape')
  assert.equal(code, 2, 'HIGH breaks the audit — this is the phase-2423 class, not a nit')
})

test('check 14 GREEN — a spent ORPHAN stays LOW, never HIGH (it is safe to delete)', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100))
  writeFollowup(root, 'spent-orphan.md', '---\nstatus: spent\n---\nDone\n')
  const { report } = audit(root)
  assert.ok(has(report, 14, 'LOW'))
  assert.ok(!has(report, 14, 'HIGH'), 'orphanhood is exactly what makes the deletion safe')
})

test('check 14 RED — superseded-but-referenced is the same HIGH shape as spent', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { notes: 'followups/superseded-cited.md' }))
  writeFollowup(root, 'superseded-cited.md', '---\nstatus: superseded\n---\nReplaced\n')
  const { report } = audit(root)
  assert.ok(has(report, 14, 'HIGH'))
})

test('check 14 RED — review-by in the past → LOW', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100))
  writeFollowup(root, 'review.md', '---\nstatus: parked\ntrigger: named event\nreview-by: 2000-01-01\n---\nParked\n')
  const { report } = audit(root)
  assert.ok(has(report, 14, 'LOW'))
})

test('check 14 GREEN — future review-by and no followups directory are silent', () => {
  const futureRoot = makeRepo()
  writePhase(futureRoot, 100, basePhase(100))
  writeFollowup(futureRoot, 'review.md', '---\nstatus: parked\ntrigger: named event\nreview-by: 2099-01-01\n---\nParked\n')
  assert.ok(!has(audit(futureRoot).report, 14, 'LOW'))

  const emptyRoot = makeRepo()
  writePhase(emptyRoot, 100, basePhase(100))
  assert.ok(!audit(emptyRoot).report.findings.some((finding) => finding.check === 14))
})

// ════════════════════════════════════════════════════════════════════════════
// Bonus crossValidate — arc-consistency HIGH
// ════════════════════════════════════════════════════════════════════════════
test("arc-consistency RED — phase.arcId names an arc whose planes don't list it → HIGH, exit 2", () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { arcId: 'AA' }))
  writePhase(root, 200, basePhase(200, { arcId: 'AA' }))
  writeArc(root, 'AA', { id: 'AA', name: 'Arc named here', baseRef: 'develop', planes: [{ name: 'Default', phases: [200] }] })
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 'arc-consistency', 'HIGH'), 'expected an arc-consistency HIGH finding')
})

test('arc-consistency GREEN — arcId agrees with the arc plane membership → no finding', () => {
  const root = makeRepo()
  writePhase(root, 200, basePhase(200, { arcId: 'AA' }))
  writeArc(root, 'AA', { id: 'AA', name: 'Arc named here', baseRef: 'develop', planes: [{ name: 'Default', phases: [200] }] })
  const { report } = audit(root)
  assert.ok(!has(report, 'arc-consistency', 'HIGH'), 'consistent arc membership → no finding')
})

// ════════════════════════════════════════════════════════════════════════════
// Bonus discovery — a phase file that fails to parse → HIGH
// ════════════════════════════════════════════════════════════════════════════
test('discovery RED — a phase file that fails to parse → HIGH, exit 2', () => {
  const root = makeRepo()
  writeRawPhase(root, 100, 'export default this is not valid javascript {{{\n')
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.ok(has(report, 'discovery', 'HIGH'), 'expected a discovery HIGH finding')
})

test('discovery GREEN — all phase files parse → no discovery finding', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100))
  const { report } = audit(root)
  assert.ok(!has(report, 'discovery', 'HIGH'), 'parseable phases → no discovery finding')
})

// ════════════════════════════════════════════════════════════════════════════
// Exit-code contract + verdict boundaries
// ════════════════════════════════════════════════════════════════════════════
test('exit code — a single HIGH finding exits 2 (BROKEN)', () => {
  const root = makeRepo()
  const obj = basePhase(100)
  delete obj.kind // one check-9 HIGH, nothing else
  writePhase(root, 100, obj)
  const { code, report } = audit(root)
  assert.equal(code, 2)
  assert.equal(report.verdict, 'BROKEN')
  assert.equal(report.summary.findings.HIGH, 1)
  assert.equal(report.summary.findings.CRITICAL, 0)
})

test('exit code — a MEDIUM-only finding exits 0 (HAS ISSUES)', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { notes: '[NEEDS CLARIFICATION: still open]' }))
  const { code, report } = audit(root)
  assert.equal(code, 0)
  assert.equal(report.verdict, 'HAS ISSUES')
  assert.equal(report.summary.findings.CRITICAL, 0)
  assert.equal(report.summary.findings.HIGH, 0)
  assert.ok(report.summary.findings.MEDIUM >= 1)
})

// ════════════════════════════════════════════════════════════════════════════
// Historical-status exemption from check 5
// ════════════════════════════════════════════════════════════════════════════
test('historical exemption — a historical phase with an incomplete task does NOT trigger check 5', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { status: 'historical', tasks: [openTask('100.1')] }))
  const { code, report } = audit(root)
  assert.ok(!has(report, 5, 'HIGH'), 'historical status is exempt from the done-with-incomplete-task check')
  assert.equal(code, 0, 'the exempt phase leaves the tree clean')
})

// ════════════════════════════════════════════════════════════════════════════
// Fully-clean repo
// ════════════════════════════════════════════════════════════════════════════
test('clean repo — no findings → verdict CLEAN, exit 0', () => {
  const root = makeRepo()
  writePhase(root, 100, basePhase(100, { kind: 'logic', dependsOn: [] }))
  writePhase(root, 101, basePhase(101, { kind: 'logic', dependsOn: [100] }))
  writeBacklog(root, [{ phase: 100, name: 'First queued phase here' }, { phase: 101, name: 'Second queued phase' }])
  const { code, report } = audit(root)
  assert.equal(code, 0)
  assert.equal(report.verdict, 'CLEAN')
  assert.equal(report.findings.length, 0)
})

// ════════════════════════════════════════════════════════════════════════════
// Usage error — no roadmap/phases directory
// ════════════════════════════════════════════════════════════════════════════
test('usage error — auditing a dir with no roadmap/phases exits 1', () => {
  const bare = mkdtempSync(join(tmpdir(), 'zr-audit-bare-'))
  roots.push(bare)
  const { code } = audit(bare)
  assert.equal(code, 1, 'a missing roadmap/phases dir is a usage error, exit 1')
})
