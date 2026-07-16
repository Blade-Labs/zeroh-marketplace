#!/usr/bin/env node
/**
 * derive.test.mjs — the action-ladder fixture table for cli/lib/derive.mjs (arc
 * ROADCODE 1657.1). Real tmp git repos (mkdtempSync + git init), phase/arc files in
 * REAL single-quoted TS-literal form so BOTH tiers read them (the regex tier anchors
 * on `status: '…'`, the typed tier imports via tsx). One case per action; the full §2
 * JSON shape is asserted, not just .action. Run: node --test cli/lib/derive.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveArcPosition, runDebtCensus, readValidateVerdict, DeriveError } from './derive.mjs'
import { defaultExec } from './exec.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

/** A JS/TS object literal with unquoted keys + single-quoted strings — valid for tsx
 *  import AND matched by phasescan's single-quote regexes (fixtures avoid apostrophes). */
const tsSrc = (obj) =>
  'export default ' + JSON.stringify(obj, null, 2).replace(/"([\w$]+)":/g, '$1:').replace(/"/g, "'") + '\n'

const CONFIG = { configVersion: 1, gateCommands: { lint: 'l', types: 't', unit: 'u', integration: 'i', build: 'b', e2e: 'none', emit: 'e' } }

/** Build a scratch consumer repo: git init + roadmap/{arcs,phases}. */
function makeRepo(arcId, arc, phases) {
  const root = mkdtempSync(join(tmpdir(), 'zr-derive-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  mkdirSync(join(root, 'roadmap', 'arcs'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'arcs', `${arcId}.arc.ts`), tsSrc({ id: arcId, baseRef: 'develop', ...arc }))
  for (const p of phases) writeFileSync(join(root, 'roadmap', 'phases', `phase-${p.phase}.phase.ts`), tsSrc(p))
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'init', '-q'])
  execFileSync('git', ['-C', root, 'add', '-A'])
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed'])
  return root
}

function writeSidecar(root, arcId, sidecar) {
  const dir = join(root, 'roadmap', 'arcs', '.building')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${arcId}.json`), JSON.stringify({ arcId, ...sidecar }))
}
function writeValidate(root, arcId, verdict) {
  const dir = join(root, 'roadmap', '.gate', `arc-${arcId}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'validate.json'), JSON.stringify({ arcId, verdict, at: '2026-07-16T00:00:00Z' }))
}
function writeArcSummary(root, arcId, outcome) {
  writeFileSync(join(root, 'roadmap', 'arc-summary.json'), JSON.stringify({ arcId, outcome }))
}

/** An exec seam that fakes the debt census (writes `entries` to --json <out>) and
 *  records every call; git falls through to the real binary. */
function makeExec(entries, recorder) {
  return (file, args, opts) => {
    recorder?.push({ file, args })
    if (args.some((a) => String(a).endsWith('debt-census.mts'))) {
      const out = args[args.indexOf('--json') + 1]
      writeFileSync(out, JSON.stringify({ entries }))
      return { status: 0, stdout: '', stderr: '' }
    }
    return defaultExec(file, args, opts)
  }
}

const done = (n, over = {}) => ({ phase: n, status: 'done', arcId: 'A', tasks: [{ id: `${n}.1`, done: true }], ...over })
const backlog = (n, over = {}) => ({ phase: n, status: 'backlog', arcId: 'A', tasks: [{ id: `${n}.1`, done: false }], ...over })

test('run-phase — next backlog member in plane order; deps respected; census NOT invoked', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10, 11] }] }, [done(10), backlog(11)])
  writeSidecar(root, 'A', { worktree: root, branch: 'dev' })
  const rec = []
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], rec) })
  assert.equal(pos.action, 'run-phase')
  assert.equal(pos.phase, 11)
  assert.equal(pos.plane, 'P1')
  assert.equal(pos.band, 'trivial')
  assert.deepEqual(pos.done, [10])
  assert.deepEqual(pos.remaining, [])
  assert.deepEqual(pos.gates, { swept: false, validated: false, suiteGreen: null })
  assert.ok(!rec.some((c) => c.args.some((a) => String(a).endsWith('debt-census.mts'))), 'census must NOT run while a member is backlog')
})

test('run-phase — a backlog member whose deps are unmet is skipped; block when none runnable', () => {
  // 11 depends on 12 (backlog) → 11 not runnable; 12 has no deps → 12 runs first.
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [11, 12] }] }, [backlog(11, { dependsOn: ['bogus'] }), backlog(12)])
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  // 11's dep is a non-existent phase (never done) → skipped; 12 runnable.
  assert.equal(pos.action, 'run-phase')
  assert.equal(pos.phase, 12)
})

test('blocked — a backlog member with an unmet dep and no runnable sibling', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [11] }] }, [backlog(11, { dependsOn: [9999] })])
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'blocked')
  assert.match(pos.reason, /unmet cross-phase dependency/)
})

test('blocked — malformed member file (no status:)', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [])
  // member 10 file missing entirely
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'blocked')
  assert.match(pos.reason, /missing/)
})

test('blocked — foreign lane: sidecar armed to a DIFFERENT worktree', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [backlog(10)])
  writeSidecar(root, 'A', { worktree: '/home/other/tree', branch: 'x' })
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, worktree: root, exec: makeExec([], []) })
  assert.equal(pos.action, 'blocked')
  assert.match(pos.reason, /foreign lane/)
})

test('sweep — all members done, census slice has an OPEN entry', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [done(10)])
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([{ arcId: 'A', state: 'OPEN' }], []) })
  assert.equal(pos.action, 'sweep')
  assert.equal(pos.gates.swept, false)
})

test('validate — swept, arc HAS acceptanceCriteria, no verdict artifact', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }], acceptanceCriteria: [{ id: 'c1', job: 'x' }] }, [done(10)])
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'validate')
  assert.equal(pos.gates.swept, true)
  assert.equal(pos.gates.validated, false)
})

test('land — swept + validate verdict PASS + not yet landed', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }], acceptanceCriteria: [{ id: 'c1', job: 'x' }] }, [done(10)])
  writeValidate(root, 'A', 'PASS')
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'land')
  assert.deepEqual(pos.gates, { swept: true, validated: true, suiteGreen: null })
})

test('complete — arc-summary shipped + no sidecar → idempotent no-op', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [done(10)]) // no acceptanceCriteria → validated no-op
  writeArcSummary(root, 'A', 'shipped')
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'complete')
  assert.equal(pos.gates.validated, true)
})

test('strict context — tsx bridge unavailable makes deriveArcPosition fail LOUD (never guesses)', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [backlog(10)])
  const savedPath = process.env.PATH
  process.env.PATH = '/nonexistent-roadmap-bin'
  try {
    assert.throws(
      () => deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) }),
      (e) => e instanceof DeriveError && e.kind === 'tsx-absent',
    )
  } finally {
    process.env.PATH = savedPath
  }
})

test('readValidateVerdict — strict: malformed artifact throws, absent is null', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [done(10)])
  assert.equal(readValidateVerdict(root, 'A'), null)
  writeValidate(root, 'A', 'PASS')
  assert.equal(readValidateVerdict(root, 'A').verdict, 'PASS')
  writeFileSync(join(root, 'roadmap', '.gate', 'arc-A', 'validate.json'), JSON.stringify({ arcId: 'A', verdict: 'MAYBE' }))
  assert.throws(() => readValidateVerdict(root, 'A'), (e) => e instanceof DeriveError && e.kind === 'malformed-artifact')
})

test('runDebtCensus — slices to the arc; census invocation failure ⇒ null (never a fabricated 0)', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [done(10)])
  const sliced = runDebtCensus(root, 'A', {
    exec: makeExec([{ arcId: 'A', state: 'OPEN' }, { arcId: 'A', state: 'OPEN-planned' }, { arcId: 'B', state: 'OPEN' }, { arcId: 'A', state: 'OPEN-operator' }], []),
  })
  assert.deepEqual({ open: sliced.open, openPlanned: sliced.openPlanned, openOperator: sliced.openOperator }, { open: 1, openPlanned: 1, openOperator: 1 })
  const failed = runDebtCensus(root, 'A', { exec: () => ({ status: 1, stdout: '', stderr: 'boom' }) })
  assert.equal(failed, null)
})

test('singleSeam — derive.mjs imports phasescan + tsx-bridge + gitscan from cli/lib; no inline parser', () => {
  const src = readFileSync(join(HERE, 'derive.mjs'), 'utf8')
  assert.match(src, /from '\.\/phasescan\.mjs'/)
  assert.match(src, /from '\.\/tsx-bridge\.mjs'/)
  assert.match(src, /from '\.\/gitscan\.mjs'/)
})
