import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyJournal, completionFingerprintOf, writeJournal } from './codex-journal.mjs'

const cleanups = []
process.on('exit', () => cleanups.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

const git = (root, ...args) => execFileSync(
  'git',
  ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
).trim()
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const gitResult = (file, args) => {
  try {
    return { status: 0, stdout: execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout?.toString() ?? '', stderr: error.stderr?.toString() ?? error.message }
  }
}

function fixture({ completed = false, advanceRequested = false, trackedReport = false } = {}) {
  const estate = realpathSync(mkdtempSync(join(tmpdir(), 'zr-exact-journal-')))
  cleanups.push(estate)
  const root = join(estate, 'main')
  const worktree = join(estate, 'lane')
  mkdirSync(root)
  git(root, 'init', '-q', '-b', 'develop')
  writeFileSync(join(root, 'tracked.txt'), 'base\n')
  const report = Buffer.from('exact report bytes\n')
  if (trackedReport) writeFileSync(join(root, 'CODEX-REPORT.md'), report)
  git(root, 'add', 'tracked.txt', ...(trackedReport ? ['CODEX-REPORT.md'] : []))
  git(root, 'commit', '-qm', 'base')
  const baseHead = git(root, 'rev-parse', 'HEAD')
  git(root, 'worktree', 'add', '-q', '-b', 'lane/37', worktree, baseHead)
  if (!trackedReport) writeFileSync(join(worktree, 'CODEX-REPORT.md'), report)
  mkdirSync(join(worktree, 'roadmap'), { recursive: true })
  writeFileSync(join(worktree, 'roadmap', '.arc-mode'), '')
  const reportDigest = digest(report)
  const laneOwner = { kind: 'roadmap-codex', id: 'owner-37' }
  const authorityDigest = digest(Buffer.from('canonical authority metadata'))
  const governanceDigest = digest(Buffer.from('canonical governance metadata'))
  const journal = {
    phases: [37],
    lane: 'run',
    worktree,
    base: 'develop',
    pgid: 999999999,
    requestedRef: 'refs/heads/develop',
    requestedHead: baseHead,
    baseHead,
    workingHead: baseHead,
    report: 'CODEX-REPORT.md',
    ...(completed ? { reportDigest } : {}),
    laneOwner,
    authorityDigest,
    governanceDigest,
    startedAt: '2026-09-07T00:00:00.000Z',
  }
  if (completed) journal.completionFingerprint = completionFingerprintOf(journal)
  const path = writeJournal(root, journal)
  if (advanceRequested) {
    writeFileSync(join(root, 'upstream.txt'), 'upstream advance\n')
    git(root, 'add', 'upstream.txt')
    git(root, 'commit', '-qm', 'advance requested ref')
  }
  const expected = {
    worktree,
    requestedRef: journal.requestedRef,
    requestedHead: git(root, 'rev-parse', journal.requestedRef),
    laneOwner,
    authorityDigest,
    governanceDigest,
    ...(completed ? { reportDigest, completionFingerprint: journal.completionFingerprint } : {}),
  }
  return { estate, root, worktree, baseHead, path, journal, expected }
}

const bytesOf = ({ root, worktree, path }) => ({
  journal: readFileSync(path),
  report: readFileSync(join(worktree, 'CODEX-REPORT.md')),
  tracked: readFileSync(join(worktree, 'tracked.txt')),
  arcMode: readFileSync(join(worktree, 'roadmap', '.arc-mode')),
  gitWorktrees: Buffer.from(git(root, 'worktree', 'list', '--porcelain')),
})

test('classifyJournal — registered inactive clean lane is stale-clean for the newly resolved requested commit', () => {
  const f = fixture({ advanceRequested: true })
  const before = bytesOf(f)
  assert.notEqual(f.journal.requestedHead, f.expected.requestedHead, 'fixture: requested ref advanced after launch')
  const result = classifyJournal(f.root, [37], f.expected, { isAlive: () => false })
  assert.equal(result.state, 'stale-clean')
  assert.equal(result.restartable, true)
  assert.equal(result.requestedHead, f.expected.requestedHead)
  assert.equal(result.workingHead, f.baseHead)
  assert.deepEqual(bytesOf(f), before)
})

test('classifyJournal — exact report completion binding is reusable and fingerprint is derived from actual fields', () => {
  const f = fixture({ completed: true })
  const before = bytesOf(f)
  assert.equal(f.journal.completionFingerprint, completionFingerprintOf(f.journal))
  const result = classifyJournal(f.root, [37], f.expected, { isAlive: () => false })
  assert.equal(result.state, 'reusable')
  assert.equal(result.restartable, false)
  assert.equal(result.evidence.reportDigest, f.journal.reportDigest)
  assert.equal(result.evidence.completionFingerprint, f.journal.completionFingerprint)
  assert.deepEqual(bytesOf(f), before)
})

test('classifyJournal — completed old-head evidence becomes stale-clean when the requested branch advances', () => {
  const f = fixture({ completed: true, advanceRequested: true })
  const before = bytesOf(f)
  const result = classifyJournal(f.root, [37], f.expected, { isAlive: () => false })
  assert.equal(result.state, 'stale-clean')
  assert.equal(result.restartable, true)
  assert.equal(result.requestedHead, f.expected.requestedHead)
  assert.notEqual(result.state, 'reusable')
  assert.deepEqual(bytesOf(f), before)
})

test('classifyJournal — malformed identity, wrong lane scope, and unsafe journal paths refuse byte-intact', () => {
  const cases = [
    ['missing-owner', (f) => { delete f.journal.laneOwner; writeJournal(f.root, f.journal) }],
    ['missing-owner-both-sides', (f) => { delete f.journal.laneOwner; delete f.expected.laneOwner; writeJournal(f.root, f.journal) }],
    ['malformed-owner', (f) => { f.journal.laneOwner = { kind: '', id: 37 }; writeJournal(f.root, f.journal) }],
    ['missing-authority', (f) => { delete f.journal.authorityDigest; writeJournal(f.root, f.journal) }],
    ['missing-authority-both-sides', (f) => { delete f.journal.authorityDigest; delete f.expected.authorityDigest; writeJournal(f.root, f.journal) }],
    ['malformed-authority', (f) => { f.journal.authorityDigest = 'sha256:nope'; writeJournal(f.root, f.journal) }],
    ['missing-governance', (f) => { delete f.journal.governanceDigest; writeJournal(f.root, f.journal) }],
    ['missing-governance-both-sides', (f) => { delete f.journal.governanceDigest; delete f.expected.governanceDigest; writeJournal(f.root, f.journal) }],
    ['malformed-governance', (f) => { f.journal.governanceDigest = 'sha256:nope'; writeJournal(f.root, f.journal) }],
    ['missing-pgid', (f) => { delete f.journal.pgid; writeJournal(f.root, f.journal) }],
    ['malformed-pgid', (f) => { f.journal.pgid = '999'; writeJournal(f.root, f.journal) }],
    ['missing-base-head', (f) => { delete f.journal.baseHead; writeJournal(f.root, f.journal) }],
    ['malformed-base-head', (f) => { f.journal.baseHead = 'not-a-commit'; writeJournal(f.root, f.journal) }],
    ['missing-requested-head', (f) => { delete f.journal.requestedHead; writeJournal(f.root, f.journal) }],
    ['wrong-phases', (f) => { f.journal.phases = [38]; writeFileSync(f.path, `${JSON.stringify(f.journal)}\n`) }],
    ['wrong-lane', (f) => { f.journal.lane = 'review'; writeFileSync(f.path, `${JSON.stringify(f.journal)}\n`) }],
    ['journal-symlink', (f) => {
      const outside = join(f.estate, 'outside-journal.json')
      writeFileSync(outside, readFileSync(f.path))
      unlinkSync(f.path)
      symlinkSync(outside, f.path)
    }],
  ]
  for (const [name, arrange] of cases) {
    const f = fixture()
    arrange(f)
    const before = bytesOf(f)
    const result = classifyJournal(f.root, [37], f.expected, { isAlive: () => false })
    assert.equal(result.restartable, false, name)
    assert.match(result.state, /^(corrupt|unowned|diverged)$/, name)
    assert.deepEqual(bytesOf(f), before, `${name}: classification preserves every byte`)
  }
})

test('classifyJournal — probe failures and arbitrary report-name exemptions refuse without mutation', () => {
  const cases = [
    ['common-dir-probe', (f, deps) => {
      deps.exec = () => ({ status: 1, stdout: '', stderr: 'common-dir unavailable' })
    }, 'unowned'],
    ['liveness-probe', (_f, deps) => {
      deps.isAlive = () => { throw new Error('liveness unavailable') }
    }, 'corrupt'],
    ['arbitrary-report-name', (f) => {
      f.journal.report = 'scratch.tmp'
      writeFileSync(join(f.worktree, 'scratch.tmp'), 'untracked data\n')
      writeJournal(f.root, f.journal)
    }, 'dirty'],
  ]
  for (const [name, arrange, state] of cases) {
    const f = fixture()
    const deps = { isAlive: () => false }
    arrange(f, deps)
    const before = bytesOf(f)
    let result
    assert.doesNotThrow(() => { result = classifyJournal(f.root, [37], f.expected, deps) }, name)
    assert.equal(result.state, state, name)
    assert.equal(result.restartable, false, name)
    assert.deepEqual(bytesOf(f), before, `${name}: classification preserves every byte`)
  }
})

test('classifyJournal — force-pushed ancestry refuses and Git refs are parsed after end-of-options', () => {
  const pushed = fixture()
  git(pushed.root, 'checkout', '-q', '--orphan', 'replacement')
  writeFileSync(join(pushed.root, 'replacement.txt'), 'replacement history\n')
  git(pushed.root, 'add', 'replacement.txt')
  git(pushed.root, 'commit', '-qm', 'replacement root')
  git(pushed.root, 'branch', '-f', 'develop', 'HEAD')
  pushed.expected.requestedHead = git(pushed.root, 'rev-parse', 'refs/heads/develop')
  const pushedBefore = bytesOf(pushed)
  const refused = classifyJournal(pushed.root, [37], pushed.expected, { isAlive: () => false })
  assert.equal(refused.state, 'diverged')
  assert.equal(refused.restartable, false)
  assert.deepEqual(bytesOf(pushed), pushedBefore)

  const observed = fixture()
  const calls = []
  const result = classifyJournal(observed.root, [37], observed.expected, {
    isAlive: () => false,
    exec: (file, args) => { calls.push(args); return gitResult(file, args) },
  })
  assert.equal(result.state, 'stale-clean')
  const requestedProbe = calls.find((args) => args.includes(`${observed.expected.requestedRef}^{commit}`))
  assert.ok(requestedProbe, 'requested ref was resolved')
  assert.ok(requestedProbe.indexOf('--end-of-options') < requestedProbe.indexOf(`${observed.expected.requestedRef}^{commit}`))
})

test('classifyJournal — copied, wrong-owner, dirty, live, diverged, unique-work, corrupt, and report mismatch all refuse byte-intact', () => {
  const cases = [
    ['copied', (f) => {
      const foreign = join(f.estate, 'foreign')
      mkdirSync(foreign)
      git(foreign, 'init', '-q')
      f.journal.worktree = foreign
      writeJournal(f.root, f.journal)
    }, 'unowned'],
    ['wrong-owner', (f) => { f.journal.laneOwner = { kind: 'roadmap-codex', id: 'other-owner' }; writeJournal(f.root, f.journal) }, 'unowned'],
    ['wrong-authority', (f) => { f.journal.authorityDigest = digest(Buffer.from('other authority')); writeJournal(f.root, f.journal) }, 'unowned'],
    ['wrong-governance', (f) => { f.journal.governanceDigest = digest(Buffer.from('other governance')); writeJournal(f.root, f.journal) }, 'unowned'],
    ['dirty', (f) => writeFileSync(join(f.worktree, 'tracked.txt'), 'dirty\n'), 'dirty'],
    ['tracked-reserved-report-dirty', (f) => writeFileSync(join(f.worktree, 'CODEX-REPORT.md'), 'modified tracked report\n'), 'dirty'],
    ['live', (_f, deps) => { deps.isAlive = () => true }, 'live'],
    ['working-head-diverged', (f) => {
      writeFileSync(join(f.worktree, 'drift.txt'), 'drift\n')
      git(f.worktree, 'add', 'drift.txt')
      git(f.worktree, 'commit', '-qm', 'unrecorded drift')
    }, 'diverged'],
    ['unresolved-request', (f) => { f.expected.requestedRef = 'refs/heads/missing'; f.expected.requestedHead = null }, 'diverged'],
    ['unique-work', (f) => {
      writeFileSync(join(f.worktree, 'unique.txt'), 'unique\n')
      git(f.worktree, 'add', 'unique.txt')
      git(f.worktree, 'commit', '-qm', 'unique lane commit')
      const head = git(f.worktree, 'rev-parse', 'HEAD')
      f.journal.workingHead = head
      writeJournal(f.root, f.journal)
    }, 'unique-commit'],
    ['corrupt', (f) => writeFileSync(f.path, '{ truncated'), 'corrupt'],
    ['report-mismatch', (f) => writeFileSync(join(f.worktree, 'CODEX-REPORT.md'), 'copied report bytes\n'), 'diverged'],
    ['forged-fingerprint', (f) => {
      f.journal.completionFingerprint = digest(Buffer.from('caller-matched-forgery'))
      f.expected.completionFingerprint = f.journal.completionFingerprint
      writeJournal(f.root, f.journal)
    }, 'diverged'],
  ]
  for (const [name, arrange, state] of cases) {
    const f = fixture({
      completed: ['report-mismatch', 'forged-fingerprint'].includes(name),
      trackedReport: name === 'tracked-reserved-report-dirty',
    })
    const deps = { isAlive: () => false }
    arrange(f, deps)
    const before = bytesOf(f)
    const result = classifyJournal(f.root, [37], f.expected, deps)
    assert.equal(result.state, state, name)
    assert.equal(result.restartable, false, name)
    assert.deepEqual(bytesOf(f), before, `${name}: classification preserves every byte`)
  }
})

test('classifyJournal — thrown Git ownership probe and unreadable report refuse byte-intact', () => {
  const thrown = fixture()
  const thrownBefore = bytesOf(thrown)
  let thrownResult
  assert.doesNotThrow(() => {
    thrownResult = classifyJournal(thrown.root, [37], thrown.expected, {
      isAlive: () => false,
      exec: () => { throw new Error('git probe exploded') },
    })
  })
  assert.equal(thrownResult.state, 'unowned')
  assert.equal(thrownResult.restartable, false)
  assert.deepEqual(bytesOf(thrown), thrownBefore)

  const directory = fixture({ completed: true })
  unlinkSync(join(directory.worktree, 'CODEX-REPORT.md'))
  mkdirSync(join(directory.worktree, 'CODEX-REPORT.md'))
  const directoryBefore = {
    journal: readFileSync(directory.path),
    tracked: readFileSync(join(directory.worktree, 'tracked.txt')),
    arcMode: readFileSync(join(directory.worktree, 'roadmap', '.arc-mode')),
  }
  let directoryResult
  assert.doesNotThrow(() => {
    directoryResult = classifyJournal(directory.root, [37], directory.expected, { isAlive: () => false })
  })
  assert.equal(directoryResult.state, 'diverged')
  assert.equal(directoryResult.restartable, false)
  assert.deepEqual({
    journal: readFileSync(directory.path),
    tracked: readFileSync(join(directory.worktree, 'tracked.txt')),
    arcMode: readFileSync(join(directory.worktree, 'roadmap', '.arc-mode')),
  }, directoryBefore)
})

test('classifyJournal — configured arc marker and canonical labeled run report remain supported', () => {
  const configured = fixture()
  unlinkSync(join(configured.worktree, 'roadmap', '.arc-mode'))
  mkdirSync(join(configured.worktree, 'docs', 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(configured.worktree, 'docs', 'roadmap', '.arc-mode'), '')
  const configuredResult = classifyJournal(configured.root, [37], configured.expected, { isAlive: () => false })
  assert.equal(configuredResult.state, 'stale-clean')
  assert.equal(configuredResult.restartable, true)

  const labeled = fixture()
  const label = 'opus'
  const reportName = `CODEX-REPORT.${label}.md`
  const report = readFileSync(join(labeled.worktree, 'CODEX-REPORT.md'))
  writeFileSync(join(labeled.worktree, reportName), report)
  unlinkSync(join(labeled.worktree, 'CODEX-REPORT.md'))
  labeled.journal.report = reportName
  labeled.journal.label = label
  unlinkSync(labeled.path)
  labeled.path = writeJournal(labeled.root, labeled.journal, { label })
  const labeledResult = classifyJournal(labeled.root, [37], labeled.expected, { isAlive: () => false })
  assert.equal(labeledResult.state, 'stale-clean')
  assert.equal(labeledResult.restartable, true)

  for (const [lane, laneReport] of [['review', 'CODEX-REVIEW.md'], ['plan', 'CODEX-PLAN.md']]) {
    const other = fixture()
    const bytes = readFileSync(join(other.worktree, 'CODEX-REPORT.md'))
    writeFileSync(join(other.worktree, laneReport), bytes)
    unlinkSync(join(other.worktree, 'CODEX-REPORT.md'))
    other.journal.lane = lane
    other.journal.report = laneReport
    other.expected.lane = lane
    unlinkSync(other.path)
    other.path = writeJournal(other.root, other.journal)
    const result = classifyJournal(other.root, [37], other.expected, { isAlive: () => false })
    assert.equal(result.state, 'stale-clean', lane)
    assert.equal(result.restartable, true, lane)
  }
})
