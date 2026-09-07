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
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveArcPosition, deriveArcLifecycleTransition, runDebtCensus, readValidateVerdict, DeriveError } from './derive.mjs'
import { defaultExec } from './exec.mjs'
import { plantPrior } from '../testdata/eval.test-support.mjs'
import { writeLandJournal } from './landing.mjs'

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
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  symlinkSync(resolve(HERE, '..', '..', '..', '..', 'lib', 'roadmap', 'schema.ts'), join(root, 'lib', 'roadmap', 'schema.ts'))
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
  writeFileSync(join(root, 'roadmap', 'arc-summary.json'), JSON.stringify({
    arcId,
    outcome,
    compromiseDisposition: [],
    gateSignals: { arcSweepClean: true, validateArcPassed: true, fullSuiteGreen: true },
    receiptRef: 'none',
  }))
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

const BROKEN_PHASE_SRC = "export default { phase: 11, status: 'backlog', tasks: [ THIS_IS_BROKEN @#$ }\n"

test('run-phase — a broken candidate AFTER the first runnable is never read (batch lazy-throw preserves early return)', () => {
  // [10 runnable backlog, 11 broken] — the loop returns on 10 and never consults 11.
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10, 11] }] }, [backlog(10)])
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-11.phase.ts'), BROKEN_PHASE_SRC)
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'run-phase')
  assert.equal(pos.phase, 10, 'a broken file after the first runnable candidate must not blow up the derive')
})

test('run-phase — a broken candidate BEFORE the first runnable throws a DeriveError naming THAT file', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [11, 10] }] }, [backlog(10)])
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-11.phase.ts'), BROKEN_PHASE_SRC)
  assert.throws(
    () => deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) }),
    (e) => e instanceof DeriveError && e.messageLines.some((l) => /phase-11\.phase\.ts/.test(l)),
    'consulting the broken candidate first throws lazily for that file',
  )
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

test('gaps — a durable GAPS verdict exposes one corrective resume through sweep', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }], acceptanceCriteria: [{ id: 'c1', job: 'x' }] }, [done(10)])
  writeValidate(root, 'A', 'GAPS')
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'gaps')
  assert.equal(pos.transitionReceipt.rejection, null)
  assert.equal(pos.transitionReceipt.next.status, 'halted')
  assert.equal(pos.transitionReceipt.next.stage, 'validate')
  assert.equal(pos.transitionReceipt.resume, 'run-correction')
})

test('correction lifecycle — awaiting repair gaps, ready repair sweeps, and matching green review revalidates', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }], acceptanceCriteria: [{ id: 'c1', job: 'x' }] }, [done(10)])
  const validationHead = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const validatePath = join(root, 'roadmap', '.gate', 'arc-A', 'validate.json')
  mkdirSync(dirname(validatePath), { recursive: true })
  const validationAt = '2026-09-07T00:00:00.000Z'
  writeFileSync(validatePath, JSON.stringify({
    arcId: 'A', verdict: 'GAPS', at: validationAt,
    correction: { state: 'awaiting-repair', validationHead },
  }))
  assert.equal(deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) }).action, 'gaps')

  writeFileSync(join(root, 'repair.txt'), 'repair\n')
  execFileSync('git', ['-C', root, 'add', 'repair.txt'])
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'fix: repair gap'])
  const repairHead = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  writeFileSync(validatePath, JSON.stringify({
    arcId: 'A', verdict: 'GAPS', at: validationAt,
    correction: { state: 'needs-sweep', validationHead, repairHead, readyAt: '2026-09-07T00:01:00.000Z' },
  }))
  assert.equal(deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) }).action, 'sweep')

  const evalDir = join(root, 'roadmap', 'arc-evals')
  mkdirSync(evalDir, { recursive: true })
  writeFileSync(join(evalDir, 'A-2026-09-07-sweep.json'), JSON.stringify({
    arcId: 'A', date: '2026-09-07', estateRatchets: 'green', phaseGates: [{ phase: 10, done: true, gateGreen: true }],
    debtDispositions: [], architectVerdict: 'clean', deferredToReleaseSweep: [], overall: 'green', blockers: [],
    correction: { validationAt, validationHead, repairHead, reviewedHead: repairHead },
  }, null, 2) + '\n')
  const sweepPath = join(evalDir, 'A-2026-09-07-sweep.json')
  const validSweepBytes = readFileSync(sweepPath, 'utf8')
  writeFileSync(sweepPath, JSON.stringify({
    arcId: 'A', date: '2026-09-07', overall: 'green',
    correction: { validationAt, validationHead, repairHead, reviewedHead: repairHead },
  }))
  assert.equal(deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) }).action, 'sweep', 'a partial green object is not a valid sweep proof')
  writeFileSync(sweepPath, validSweepBytes)
  execFileSync('git', ['-C', root, 'add', 'roadmap'])
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'docs: record correction review'])
  assert.equal(deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) }).action, 'validate', 'an evidence-only commit after the matching review does not force another sweep')

  writeFileSync(join(root, 'source-change.txt'), 'post-review source change\n')
  execFileSync('git', ['-C', root, 'add', 'source-change.txt'])
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'feat: change source after review'])
  assert.equal(deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) }).action, 'sweep')
})

test('land — swept + validate verdict PASS + not yet landed', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }], acceptanceCriteria: [{ id: 'c1', job: 'x' }] }, [done(10)])
  writeValidate(root, 'A', 'PASS')
  writeSidecar(root, 'A', { worktree: root, branch: 'develop' })
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'land')
  assert.deepEqual(pos.gates, { swept: true, validated: true, suiteGreen: null })
})

test('land-unproven — integrated distinct arc branch without shipped summary reconciles and never replays land', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [done(10)])
  execFileSync('git', ['-C', root, 'branch', 'develop'])
  execFileSync('git', ['-C', root, 'branch', 'arc/A'])
  writeSidecar(root, 'A', { worktree: root, branch: 'arc/A' })
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'land-unproven')
  assert.equal(pos.transitionReceipt.rejection, null)
  assert.equal(pos.transitionReceipt.next.status, 'halted')
  assert.equal(pos.transitionReceipt.next.stage, 'land')
  assert.equal(pos.transitionReceipt.resume, 'reconcile')
})

test('land — same-branch ancestry is not proof of a prior landing', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [done(10)])
  execFileSync('git', ['-C', root, 'branch', 'develop'])
  writeSidecar(root, 'A', { worktree: root, branch: 'develop' })
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'land')
  assert.equal(pos.transitionReceipt.rejection, null)
})

test('land-unproven — a malformed shipped summary cannot prove land', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [done(10)])
  execFileSync('git', ['-C', root, 'branch', 'develop'])
  execFileSync('git', ['-C', root, 'branch', 'arc/A'])
  writeSidecar(root, 'A', { worktree: root, branch: 'arc/A' })
  writeFileSync(join(root, 'roadmap', 'arc-summary.json'), JSON.stringify({ arcId: 'A', outcome: 'shipped' }))
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'land-unproven')
  assert.equal(pos.transitionReceipt.rejection, null)
  assert.equal(pos.transitionReceipt.resume, 'reconcile')
})

test('evaluate — proven shipped summary without an arc evaluation resumes the missing post-land action', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [done(10)]) // no acceptanceCriteria → validated no-op
  writeArcSummary(root, 'A', 'shipped')
  writeSidecar(root, 'A', { worktree: root, branch: 'arc/A' })
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'evaluate')
  assert.equal(pos.transitionReceipt.rejection, null)
  assert.equal(pos.transitionReceipt.next.stage, 'evaluate')
  assert.equal(pos.transitionReceipt.resume, 'run-evaluate')
  assert.equal(pos.gates.validated, true)
})

test('land-unproven — a live landing journal holds even when a shipped summary is visible', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [done(10)])
  writeArcSummary(root, 'A', 'shipped')
  writeLandJournal(root, 'A', { pid: process.pid, startedAt: '2026-09-07T00:00:00.000Z', step: 'post-land' })
  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'land-unproven')
  assert.equal(pos.transitionReceipt.rejection, null)
  assert.equal(pos.transitionReceipt.resume, 'reconcile')
})

test('complete — only a final seven-dimension report bound to exact shipped summary bytes completes evaluation', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [done(10)])
  writeArcSummary(root, 'A', 'shipped')
  const summaryBytes = readFileSync(join(root, 'roadmap', 'arc-summary.json'))
  const digest = `sha256:${createHash('sha256').update(summaryBytes).digest('hex')}`
  const reportPath = plantPrior(root, '2026-09-07', { arcId: 'A' })
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  writeFileSync(reportPath, JSON.stringify({ ...report, landSummaryDigest: digest }, null, 2) + '\n')
  let pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'complete')
  assert.equal(pos.transitionReceipt.rejection, null)
  assert.equal(pos.transitionReceipt.next.stage, 'complete')

  writeFileSync(reportPath, JSON.stringify({ ...report, landSummaryDigest: 'sha256:mismatch' }, null, 2) + '\n')
  pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'evaluate', 'a structurally valid legacy or mismatched report cannot complete this land')

  writeFileSync(join(root, 'roadmap', 'arc-evals', 'A-2026-09-08.json'), JSON.stringify({
    arcId: 'A', date: '2026-09-08', judgeModel: 'claude-sonnet-5', landSummaryDigest: digest,
    dimensions: Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((key) => [key, {}])),
    ratchet: [], attribution: { drivers: [], reviewers: [] }, notes: [],
  }))
  pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'evaluate', 'seven arbitrary dimension keys are not a valid completed evaluation')

  const pendingPath = plantPrior(root, '2026-09-09', { arcId: 'A', sentinels: { 'doc-brevity': 'pending-judge' } })
  const pending = JSON.parse(readFileSync(pendingPath, 'utf8'))
  writeFileSync(pendingPath, JSON.stringify({ ...pending, landSummaryDigest: digest }, null, 2) + '\n')
  pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(pos.action, 'evaluate', 'a newer pending judge report keeps evaluation open')
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

test('derive lifecycle — identical disk checkpoint yields an identical reducer receipt after resume', () => {
  const root = makeRepo('A', { planes: [{ name: 'P1', phases: [10] }] }, [backlog(10)])
  const position = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  const fresh = deriveArcLifecycleTransition(position)
  const resumed = deriveArcLifecycleTransition(
    deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) }),
  )
  assert.deepEqual(resumed, fresh)
  assert.equal(fresh.event.type, 'run-phase')
  assert.equal(fresh.event.phase, 10)
  assert.equal(fresh.rejection, null)
  assert.deepEqual(fresh.authorityRef, {
    status: 'unknown',
    reason: 'read-only-projection',
    sourceRef: null,
  })
})

test('derive lifecycle — terminal disk checkpoints seed their honest stage before reducing', () => {
  const root = makeRepo(
    'A',
    { planes: [{ name: 'P1', phases: [10] }], acceptanceCriteria: [{ id: 'c1', job: 'x' }] },
    [done(10)],
  )
  writeValidate(root, 'A', 'PASS')
  const position = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, exec: makeExec([], []) })
  assert.equal(position.action, 'land')
  assert.ok(position.transitionReceipt, 'derive output carries its reducer receipt')
  assert.equal(position.transitionReceipt.prior.stage, 'validate')
  assert.equal(position.transitionReceipt.event.type, 'land')
  assert.equal(position.transitionReceipt.next.stage, 'land')
  assert.equal(position.transitionReceipt.rejection, null)
})
