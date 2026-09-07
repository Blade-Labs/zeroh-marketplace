import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyJournal, completionFingerprintOf, findJournal, writeJournal } from './codex-journal.mjs'

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


test('journal persists the complete worktree identity verbatim while legacy journals remain identity-free', () => {
  const f = fixture()
  const identity = {
    version: 1, ownershipId: '123e4567-e89b-42d3-a456-426614174000', repository: realpathSync(f.root),
    gitCommonDir: realpathSync(join(f.root, '.git')), worktree: realpathSync(f.worktree),
    gitAdminDir: realpathSync(git(f.worktree, 'rev-parse', '--git-dir')),
    branch: 'refs/heads/lane/37', laneOwner: { kind: 'roadmap-codex', id: 'run:37' },
  }
  f.journal.laneOwner = identity.laneOwner
  f.journal.worktreeIdentity = identity
  writeJournal(f.root, f.journal)
  assert.deepEqual(findJournal(f.root, [37]).journal.worktreeIdentity, identity)
  const boundBytes = readFileSync(f.path)
  const dropped = { ...f.journal }; delete dropped.worktreeIdentity
  assert.throws(() => writeJournal(f.root, dropped), /identity|refused/i)
  assert.deepEqual(readFileSync(f.path), boundBytes, 'a durable identity cannot be dropped')
  assert.throws(() => writeJournal(f.root, { ...f.journal, worktreeIdentity: { ...identity, ownershipId: '223e4567-e89b-42d3-a456-426614174000' } }), /identity|refused/i)
  assert.deepEqual(readFileSync(f.path), boundBytes, 'nor can a durable identity be changed')

  const legacy = fixture()
  assert.equal(findJournal(legacy.root, [37]).journal.worktreeIdentity, undefined, 'an existing identity-free journal remains readable but unowned')
})

test('40.7 completed owned output archives byte-exactly before unlink, while mismatched and legacy evidence stays', async () => {
  const journals = await import('./codex-journal.mjs')
  assert.equal(typeof journals.archiveCompletedLaneOutput, 'function')
  const ownership = await import('./worktree.mjs')

  const owned = fixture({ completed: true })
  owned.journal.laneOwner = { kind: 'roadmap-codex', id: 'run:37' }
  const identity = ownership.createWorktreeIdentity(owned.root, owned.worktree, {
    ownershipId: '123e4567-e89b-42d3-a456-426614174037', laneOwner: owned.journal.laneOwner, expectedBranch: 'refs/heads/lane/37',
  })
  ownership.registerWorktreeIdentity(owned.root, identity)
  owned.journal.worktreeIdentity = identity
  owned.journal.ownerRoot = owned.root
  owned.journal.driverExit = { code: 0, signal: null }
  owned.journal.finishedAt = '2026-09-07T01:00:00.000Z'
  owned.journal.completionFingerprint = completionFingerprintOf(owned.journal)
  writeJournal(owned.root, owned.journal)
  const reportPath = join(owned.worktree, 'CODEX-REPORT.md'); const reportBytes = readFileSync(reportPath)
  const destination = join(owned.root, '.building', 'archived-owned-report.md')
  const archived = journals.archiveCompletedLaneOutput(owned.root, owned.path, owned.journal, { destination })
  assert.deepEqual(readFileSync(destination), reportBytes); assert.equal(archived.archived, destination); assert.equal(archived.removed, true); assert.equal(archived.reason, null)
  assert.equal(existsSync(reportPath), false, 'unlink follows durable archive publication and journal stamp')
  assert.deepEqual(journals.archiveCompletedLaneOutput(owned.root, owned.path, archived.journal, { destination }), archived, 'repeat is idempotent')

  const mismatch = fixture({ completed: true }); writeFileSync(join(mismatch.worktree, 'CODEX-REPORT.md'), 'changed after digest\n')
  const mismatchDestination = join(mismatch.root, '.building', 'must-not-publish.md')
  const held = journals.archiveCompletedLaneOutput(mismatch.root, mismatch.path, mismatch.journal, { destination: mismatchDestination })
  assert.equal(held.removed, false); assert.match(held.reason, /digest|identity|owned/i); assert.ok(existsSync(join(mismatch.worktree, 'CODEX-REPORT.md'))); assert.equal(existsSync(mismatchDestination), false)

  const legacy = fixture({ completed: true })
  const unowned = journals.archiveCompletedLaneOutput(legacy.root, legacy.path, legacy.journal, { destination: join(legacy.root, '.building', 'legacy.md') })
  assert.equal(unowned.removed, false); assert.match(unowned.reason, /unowned|identity/i); assert.ok(existsSync(join(legacy.worktree, 'CODEX-REPORT.md')))
})

test('40.7 journal close publishes one exact immutable twin before unlink and replays safely', async () => {
  const { archiveJournal } = await import('./codex-journal.mjs')
  const f = fixture()
  const original = readFileSync(f.path)
  const closed = archiveJournal(f.path, f.journal, 'phase land')
  assert.equal(existsSync(f.path), false)
  const value = JSON.parse(readFileSync(closed, 'utf8'))
  assert.deepEqual({ ...value, closedAt: undefined, closedBy: undefined }, { ...f.journal, closedAt: undefined, closedBy: undefined })
  assert.equal(value.closedBy, 'phase land')
  assert.ok(Number.isFinite(Date.parse(value.closedAt)))
  const closedBytes = readFileSync(closed)
  assert.equal(archiveJournal(f.path, f.journal, 'phase land'), closed)
  assert.deepEqual(readFileSync(closed), closedBytes, 'identical post-publish replay is byte-stable')

  writeFileSync(f.path, original)
  assert.equal(archiveJournal(f.path, f.journal, 'phase land'), closed)
  assert.equal(existsSync(f.path), false, 'both-copy crash recovery removes only the identical live journal')
  assert.deepEqual(readFileSync(closed), closedBytes)

  writeFileSync(f.path, original)
  assert.throws(() => archiveJournal(f.path, { ...f.journal, workingHead: 'a'.repeat(40) }, 'phase land'), /conflict|different|refus|journal/i)
  assert.deepEqual(readFileSync(f.path), original, 'a conflicting close preserves the exact live journal')
  assert.deepEqual(readFileSync(closed), closedBytes, 'and never overwrites immutable closed evidence')
})

test('40.7 journal close preserves a prior launch before closing a new generation', async () => {
  const { archiveJournal } = await import('./codex-journal.mjs')
  const f = fixture()
  f.journal.launchId = 'first-generation'
  writeFileSync(f.path, JSON.stringify(f.journal))
  const closed = archiveJournal(f.path, f.journal, 'phase land')
  const oldBytes = readFileSync(closed)
  const next = { ...f.journal, launchId: 'next-generation' }
  writeFileSync(f.path, JSON.stringify(next))
  assert.equal(archiveJournal(f.path, next, 'phase land'), closed)
  const prior = f.path.replace(/\.json$/, `.prior.${encodeURIComponent(f.journal.launchId)}.json`)
  assert.deepEqual(readFileSync(prior), oldBytes)
  assert.equal(JSON.parse(readFileSync(closed)).launchId, next.launchId)
  assert.equal(existsSync(f.path), false)
  assert.equal(archiveJournal(f.path, next, 'phase land'), closed)
})

test('40 gate repair: explicit review generation CAS preserves the completed predecessor before identity renewal', async () => {
  const j = await import('./codex-journal.mjs'); const w = await import('./worktree.mjs'); const { publishImmutableFile } = await import('./sidecar.mjs'); const f = fixture(); unlinkSync(f.path)
  const path = join(f.root, '.building', 'codex-review-37.json'), prompt = path.replace(/\.json$/, '-prompt.txt')
  const oldPrompt = Buffer.from('old review prompt\n'), report = Buffer.from('old review result\nCODEX-RUN-COMPLETE\n')
  writeFileSync(prompt, oldPrompt)
  const owner = { kind: 'roadmap-codex', id: 'review:37' }
  const oldIdentity = w.createWorktreeIdentity(f.root, f.worktree, { ownershipId: '323e4567-e89b-42d3-a456-426614174037', laneOwner: owner, expectedBranch: 'refs/heads/lane/37' }); w.registerWorktreeIdentity(f.root, oldIdentity)
  const archivedReport = path.replace(/\.json$/, `-${'old-launch'}-REPORT.md`); writeFileSync(archivedReport, report)
  const old = { ...f.journal, lane: 'review', laneOwner: owner, worktreeIdentity: oldIdentity, ownerRoot: f.root, launchId: 'old-launch', report: 'CODEX-REVIEW.md', prompt,
    requestDigest: j.journalBindingDigestOf({ prompt: oldPrompt.toString(), carriedDigest: null }), reportDigest: j.journalBytesDigestOf(report), archivedReport, archivedAt: '2026-09-07T02:00:00.000Z', driverExit: { code: 0, signal: null }, finishedAt: '2026-09-07T02:00:00.000Z' }
  old.completionFingerprint = j.completionFingerprintOf(old); j.writeJournalAtomic(f.root, old); const oldBytes = readFileSync(path)
  const prior = path.replace(/\.json$/, `.prior.${encodeURIComponent(old.launchId)}`)
  assert.equal(publishImmutableFile(`${prior}.json`, oldBytes), true); assert.equal(publishImmutableFile(`${prior}.prompt.txt`, oldPrompt), true); assert.equal(publishImmutableFile(`${prior}.report.md`, report), true)
  git(f.root, 'worktree', 'remove', '--force', f.worktree); assert.equal(w.removeWorktreeIdentity(f.root, oldIdentity), true); git(f.root, 'branch', '-D', 'lane/37'); git(f.root, 'worktree', 'add', '-q', '-b', 'lane/review-next', f.worktree, old.workingHead)
  const nextIdentity = w.createWorktreeIdentity(f.root, f.worktree, { ownershipId: '423e4567-e89b-42d3-a456-426614174037', laneOwner: owner, expectedBranch: 'refs/heads/lane/review-next' }); w.registerWorktreeIdentity(f.root, nextIdentity)
  const newPrompt = Buffer.from('new review prompt\n'); writeFileSync(prompt, newPrompt)
  const next = { ...old, launchId: 'new-launch', worktreeIdentity: nextIdentity, startedAt: '2026-09-07T03:00:00.000Z', requestDigest: j.journalBindingDigestOf({ prompt: newPrompt.toString(), carriedDigest: null }) }; for (const key of ['reportDigest','archivedReport','archivedAt','driverExit','finishedAt','completionFingerprint']) delete next[key]
  const priorArtifacts = [[`${prior}.json`, oldBytes], [`${prior}.prompt.txt`, oldPrompt], [`${prior}.report.md`, report]]
  const intact = () => { assert.deepEqual(readFileSync(path), oldBytes); for (const [artifact, bytes] of priorArtifacts) assert.deepEqual(readFileSync(artifact), bytes) }
  for (const [artifact, bytes] of priorArtifacts) {
    unlinkSync(artifact); assert.throws(() => j.writeJournalAtomic(f.root, next, { replaceGeneration: old }), /prior|generation|missing|refus/i); assert.deepEqual(readFileSync(path), oldBytes); assert.equal(publishImmutableFile(artifact, bytes), true)
    writeFileSync(artifact, 'conflict\n'); assert.throws(() => j.writeJournalAtomic(f.root, next, { replaceGeneration: old }), /prior|generation|digest|differ|refus/i); writeFileSync(artifact, bytes); intact()
  }
  writeFileSync(path, JSON.stringify({ ...old, startedAt: '2026-09-07T02:00:01.000Z' }, null, 2) + '\n')
  assert.throws(() => j.writeJournalAtomic(f.root, next, { replaceGeneration: old }), /current|generation|differ|refus/i); writeFileSync(path, oldBytes); intact()
  assert.equal(w.removeWorktreeIdentity(f.root, nextIdentity), true)
  assert.throws(() => j.writeJournalAtomic(f.root, next, { replaceGeneration: old }), /identity|registered|owned|refus/i); intact(); w.registerWorktreeIdentity(f.root, nextIdentity)
  const badIdentity = { ...nextIdentity, ownershipId: '523e4567-e89b-42d3-a456-426614174037' }
  assert.throws(() => j.writeJournalAtomic(f.root, { ...next, worktreeIdentity: badIdentity }, { replaceGeneration: old }), /identity|registered|owned|refus/i); intact()
  assert.throws(() => j.writeJournalAtomic(f.root, { ...next, launchId: old.launchId }, { replaceGeneration: old }), /launch|generation|distinct|refus/i); intact()
  assert.throws(() => j.writeJournalAtomic(f.root, { ...next, worktreeIdentity: { ...nextIdentity, ownershipId: oldIdentity.ownershipId } }, { replaceGeneration: old }), /identity|ownership|registered|refus/i); intact()
  assert.throws(() => j.writeJournalAtomic(f.root, { ...next, lane: 'plan', laneOwner: { kind: 'roadmap-codex', id: 'plan:37' }, worktreeIdentity: { ...nextIdentity, laneOwner: { kind: 'roadmap-codex', id: 'plan:37' } } }, { replaceGeneration: old }), /review|lane|scope|identity|refus/i); intact()
  assert.throws(() => j.writeJournalAtomic(f.root, { ...next, phases: [38], laneOwner: { kind: 'roadmap-codex', id: 'review:38' }, worktreeIdentity: { ...nextIdentity, laneOwner: { kind: 'roadmap-codex', id: 'review:38' } } }, { replaceGeneration: old }), /phase|scope|identity|refus/i); intact()
  assert.equal(j.writeJournalAtomic(f.root, next, { replaceGeneration: old }), path)
  assert.deepEqual(readFileSync(`${prior}.json`), oldBytes); assert.deepEqual(readFileSync(`${prior}.prompt.txt`), oldPrompt); assert.deepEqual(readFileSync(`${prior}.report.md`), report)
  assert.deepEqual(JSON.parse(readFileSync(path)), next); assert.equal(j.writeJournalAtomic(f.root, next), path)
})
