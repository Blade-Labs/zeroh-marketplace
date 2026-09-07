#!/usr/bin/env node
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bases, git, makeFixtureRepo } from './harness.mjs'
import { cleanupOwnedLaneFixture } from './worktree-gc.fixture.mjs'
import { archiveJournal } from '../../cli/lib/codex-journal.mjs'
import * as cleanup from '../../cli/lib/worktree.mjs'

const specs = Object.freeze([
  { label: 'merged-run', kind: 'eligible' },
  { label: 'merged-plan', kind: 'eligible', lane: 'plan' },
  { label: 'merged-review-detached', kind: 'eligible', lane: 'review', detached: true },
  { label: 'closed-run', kind: 'eligible', closed: true },
  { label: 'closed-plan', kind: 'eligible', lane: 'plan', closed: true },
  { label: 'closed-review', kind: 'eligible', lane: 'review', detached: true, closed: true },
  { label: 'crash-after-planned', kind: 'crash', hook: 'afterPlanned' },
  { label: 'crash-after-removing', kind: 'crash', hook: 'afterRemoving' },
  { label: 'crash-before-disposal', kind: 'crash', hook: 'beforeDisposal' },
  { label: 'crash-after-disposal', kind: 'crash', hook: 'afterDisposal' },
  { label: 'crash-after-receipt', kind: 'crash', hook: 'afterReceipt' },
  { label: 'active-run', kind: 'active' },
  { label: 'active-plan', kind: 'active', lane: 'plan' },
  { label: 'active-review', kind: 'active', lane: 'review', detached: true },
  { label: 'dirty-tracked', kind: 'dirty' },
  { label: 'dirty-index', kind: 'dirty' },
  { label: 'dirty-report', kind: 'dirty' },
  { label: 'dirty-unknown', kind: 'dirty' },
  { label: 'dirty-mixed', kind: 'dirty' },
  { label: 'unique-run', kind: 'unique' },
  { label: 'unique-plan', kind: 'unique', lane: 'plan' },
  { label: 'unique-detached', kind: 'unique', detached: true },
  { label: 'not-integrated-run', kind: 'not-integrated' },
  { label: 'not-integrated-plan', kind: 'not-integrated', lane: 'plan' },
  { label: 'not-integrated-review', kind: 'not-integrated', lane: 'review', detached: true },
  { label: 'open-pr-run', kind: 'protected' },
  { label: 'open-pr-review', kind: 'protected', lane: 'review', detached: true },
  { label: 'provider-unavailable', kind: 'provider-unavailable' },
  { label: 'provider-throws', kind: 'provider-throws' },
  { label: 'provider-malformed', kind: 'provider-malformed' },
  { label: 'legacy-journal', kind: 'legacy' },
  { label: 'unregistered-journal-only', kind: 'unregistered' },
  { label: 'unknown-no-journal', kind: 'unknown' },
  { label: 'session-slot-one', kind: 'slot', slot: 1 },
  { label: 'session-slot-two', kind: 'slot', slot: 2 },
  { label: 'other-tool-worktree', kind: 'other-tool' },
  { label: 'target-corrupt-json', kind: 'corrupt' },
  { label: 'target-journal-symlink', kind: 'journal-symlink' },
  { label: 'worktree-path-symlink', kind: 'worktree-symlink' },
  { label: 'copied-ownership-id', kind: 'copied-identity' },
  { label: 'mismatched-git-admin', kind: 'git-admin' },
  { label: 'mismatched-git-common', kind: 'git-common' },
  { label: 'mismatched-repository', kind: 'repository' },
  { label: 'ambiguous-run-label', kind: 'ambiguous' },
  { label: 'ambiguous-cross-lane', kind: 'cross-lane' },
  { label: 'wrong-owner-root', kind: 'owner-root' },
  { label: 'race-journal', kind: 'race' },
  { label: 'race-dirt', kind: 'race' },
  { label: 'race-head', kind: 'race' },
  { label: 'race-registry', kind: 'race' },
].map(Object.freeze))
const selectedKinds = new Set(['eligible', 'crash', 'race'])
const removableKinds = new Set(['eligible', 'crash'])
const expectedClass = row => selectedKinds.has(row.kind) ? 'eligible'
  : row.kind === 'active' ? 'live' : row.kind.startsWith('provider-') ? 'protection-unavailable'
    : ['dirty', 'unique', 'not-integrated', 'protected'].includes(row.kind) ? row.kind : 'ownership-uncertain'
function rewrite(row, patch) {
  row.journal = { ...row.journal, ...patch }
  writeFileSync(row.journalPath, JSON.stringify(row.journal, null, 2) + '\n')
}
function commitLane(row) {
  const name = `${row.label}.txt`
  writeFileSync(join(row.worktree, name), `preserve ${row.label}\n`)
  execFileSync('git', ['-C', row.worktree, 'add', name])
  execFileSync('git', ['-C', row.worktree, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', row.label])
  const head = execFileSync('git', ['-C', row.worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  rewrite(row, { workingHead: head })
  return head
}
function protection(request, modes) {
  const mode = modes[request.identity.ownershipId]
  if (mode === 'protected') return { state: 'protected', evidence: [{ kind: 'provider-pr', id: `pr-${request.identity.ownershipId}`, head: request.head }], reason: 'open pull request' }
  if (mode === 'provider-unavailable') return { state: 'unavailable', evidence: [], reason: 'provider unavailable' }
  if (mode === 'provider-throws') throw new Error('provider transport unavailable')
  if (mode === 'provider-malformed') return { state: 'unexpected-provider-answer' }
  return { state: 'unprotected', evidence: [], reason: null }
}

// One estate exposes cross-lane coupling; every row uses real Git and filesystem state.
test('40.8 exact fifty-lane estate preserves every unsafe lane across races and fresh-process recovery', { timeout: 180_000 }, async () => {
  assert.equal(specs.length, 50)
  assert.equal(new Set(specs.map(row => row.label)).size, 50)
  const root = makeFixtureRepo(), adapter = { root, git: (...args) => git(root, ...args) }
  const slotClaims = [1, 2].map(slot => cleanup.claimSlot(root, { owner: `matrix-slot-${slot}` }))
  assert.deepEqual(slotClaims.map(claim => claim.slot), [1, 2])
  const rows = []
  for (const [index, spec] of specs.entries()) {
    const lane = await cleanupOwnedLaneFixture({ id: 408100 + index, existing: { r: adapter }, module: cleanup,
      lane: spec.lane ?? 'run', detached: spec.detached ?? false,
      worktree: spec.slot ? `${root}-wt-${spec.slot}` : undefined,
      makeRepo: () => { throw new Error('one estate expected') }, track: path => bases.push(path) })
    rows.push({ ...spec, ...lane })
  }
  const pgid = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim())
  assert.ok(Number.isSafeInteger(pgid) && pgid > 1)
  const tracked = git(root, 'ls-files').split('\n').find(Boolean)
  const modes = Object.fromEntries(rows.map(row => [row.identity.ownershipId, row.kind]))
  const registryPath = join(root, '.building', 'worktree-slots.json')
  const removeIdentity = row => {
    assert.equal(cleanup.removeWorktreeIdentity(root, row.identity), true)
    assert.equal(cleanup.registeredWorktreeIdentity(root, row.worktree), null)
  }
  for (const row of rows) {
    if (row.closed) {
      const live = row.journalPath
      row.journalPath = archiveJournal(live, row.journal, 'matrix setup')
      row.journal = JSON.parse(readFileSync(row.journalPath))
      assert.ok(!existsSync(live) && row.journalPath.endsWith('.closed.json'))
    }
    if (row.kind === 'active') rewrite(row, { pgid })
    if (row.kind === 'dirty') {
      if (['dirty-tracked', 'dirty-index', 'dirty-mixed'].includes(row.label)) writeFileSync(join(row.worktree, tracked), `modified ${row.label}\n`)
      if (row.label === 'dirty-index') execFileSync('git', ['-C', row.worktree, 'add', tracked])
      if (['dirty-report', 'dirty-unknown', 'dirty-mixed'].includes(row.label)) writeFileSync(join(row.worktree, row.label === 'dirty-report' ? 'CODEX-REPORT.md' : 'unknown-artifact.txt'), 'keep this work\n')
    }
    if (['unique', 'not-integrated'].includes(row.kind)) {
      const head = commitLane(row)
      if (row.kind === 'not-integrated') git(root, 'branch', `archive/${row.label}`, head)
    }
    if (['legacy', 'unregistered', 'unknown', 'other-tool'].includes(row.kind)) {
      removeIdentity(row)
      if (row.kind === 'legacy') { const { worktreeIdentity, laneOwner, ...legacy } = row.journal; row.journal = legacy; rewrite(row, {}) }
      if (['unknown', 'other-tool'].includes(row.kind)) rmSync(row.journalPath)
      if (row.kind === 'other-tool') writeFileSync(join(row.worktree, 'OTHER-TOOL-SESSION.txt'), 'foreign ownership\n')
    }
    if (row.kind === 'slot') assert.ok(cleanup.isSlotDir(root, row.worktree), 'slot must be an actual reserved slot path')
    if (row.kind === 'corrupt') writeFileSync(row.journalPath, '{broken')
    if (row.kind === 'journal-symlink') {
      const target = `${row.journalPath}.target`
      renameSync(row.journalPath, target); symlinkSync(target, row.journalPath)
      assert.ok(lstatSync(row.journalPath).isSymbolicLink())
    }
    if (row.kind === 'worktree-symlink') {
      row.physicalTarget = `${row.worktree}-physical`; bases.push(row.physicalTarget)
      renameSync(row.worktree, row.physicalTarget); symlinkSync(row.physicalTarget, row.worktree)
      assert.ok(lstatSync(row.worktree).isSymbolicLink())
    }
    if (row.kind === 'copied-identity') rewrite(row, { worktreeIdentity: { ...row.identity, ownershipId: rows[0].identity.ownershipId } })
    if (row.kind === 'git-admin') rewrite(row, { worktreeIdentity: { ...row.identity, gitAdminDir: rows[0].identity.gitAdminDir } })
    if (row.kind === 'git-common') rewrite(row, { worktreeIdentity: { ...row.identity, gitCommonDir: rows[0].identity.gitAdminDir } })
    if (row.kind === 'repository') rewrite(row, { worktreeIdentity: { ...row.identity, repository: rows[0].worktree } })
    if (row.kind === 'owner-root') rewrite(row, { ownerRoot: `${root}-foreign` })
    if (row.kind === 'ambiguous') writeFileSync(row.journalPath.replace(/\.json$/, '.shadow.json'), JSON.stringify(row.journal))
    if (row.kind === 'cross-lane') writeFileSync(join(root, '.building', 'codex-review-999999.json'), JSON.stringify(row.journal))
    row.preservedTracked = readFileSync(join(row.worktree, tracked))
  }
  const initialSlots = JSON.parse(readFileSync(registryPath)).slots
  const probeProtection = request => protection(request, modes)
  const policy = { inactiveObservations: 2, inactiveIntervalMs: 1000, integrationRef: 'develop', configuredProtectionRefs: [], deleteIntegratedBranches: true }
  const first = await cleanup.planWorktreeCleanup(root, { ...policy, invocationId: 'c8400000-0000-4000-8000-000000000001', observedAt: '2026-09-07T00:00:00.000Z' }, { probeProtection })
  const plan = await cleanup.planWorktreeCleanup(root, { ...policy, invocationId: 'c8400000-0000-4000-8000-000000000002', observedAt: '2026-09-07T00:00:01.000Z' }, { probeProtection })
  assert.equal(first.items.length, 50); assert.equal(plan.items.length, 50)
  for (const row of rows) {
    const actual = plan.items.find(item => item.worktree === row.worktree)
    assert.equal(actual?.classification, expectedClass(row), row.label)
    if (selectedKinds.has(row.kind)) assert.equal(first.items.find(item => item.worktree === row.worktree)?.classification, 'observation-required', row.label)
  }
  const expected = new Set(rows.filter(row => selectedKinds.has(row.kind)).map(row => row.identity.ownershipId))
  assert.deepEqual(new Set(plan.items.filter(item => item.classification === 'eligible').map(item => item.identity.ownershipId)), expected)
  const touched = new Set(), interrupted = new Set(), recovery = []
  const byId = new Map(rows.map(row => [row.identity.ownershipId, row]))
  const hooks = Object.fromEntries(['afterPlanned', 'afterRemoving', 'beforeDisposal', 'afterDisposal', 'afterReceipt'].map(hook => [hook, payload => {
    const id = payload.identity?.ownershipId ?? payload.item?.identity?.ownershipId ?? payload.ownershipId
    const row = byId.get(id)
    if (hook === 'beforeDisposal' && row?.kind === 'race' && !touched.has(row.label)) {
      touched.add(row.label)
      if (row.label === 'race-journal') rewrite(row, { startedAt: '2026-09-07T00:00:02.000Z' })
      if (row.label === 'race-dirt') writeFileSync(join(row.worktree, 'late-work.txt'), 'preserve raced work\n')
      if (row.label === 'race-head') commitLane(row)
      if (row.label === 'race-registry') cleanup.removeWorktreeIdentity(root, row.identity)
    }
    if (row?.kind === 'crash' && row.hook === hook && !interrupted.has(row.label)) {
      interrupted.add(row.label); throw new Error(`matrix interruption ${row.label}`)
    }
  }]))
  const resumeScript = `
    import { resumeWorktreeCleanup } from ${JSON.stringify(new URL('../../cli/lib/worktree.mjs', import.meta.url).href)};
    const protection = ${protection.toString()};
    const modes = JSON.parse(process.argv[2]);
    const result = await resumeWorktreeCleanup(process.argv[1], {}, { probeProtection: request => protection(request, modes) });
    process.stdout.write(JSON.stringify({ pid: process.pid, result }));
  `
  let applied
  for (let attempt = 0; attempt <= rows.filter(row => row.kind === 'crash').length; attempt++) {
    try { applied = await cleanup.applyWorktreeCleanup(root, plan, { probeProtection, hooks }); break }
    catch (error) {
      assert.match(error.message, /^matrix interruption /)
      const resumed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', resumeScript, root, JSON.stringify(modes)], { cwd: root, encoding: 'utf8', timeout: 60_000 }))
      assert.notEqual(resumed.pid, process.pid)
      recovery.push({ interrupted: error.message, resumed: resumed.result.items.map(item => ({ ownershipId: item.ownershipId, state: item.state })) })
    }
  }
  assert.ok(applied, 'all five interrupted prefixes must converge')
  assert.equal(interrupted.size, 5); assert.equal(touched.size, 4)
  assert.deepEqual(new Set(applied.items.map(item => item.ownershipId)), expected, 'apply consumes the exact dry-run selected set')
  const registry = JSON.parse(readFileSync(registryPath))
  for (const row of rows) {
    const removed = removableKinds.has(row.kind)
    assert.equal(!existsSync(row.worktree), removed, row.label)
    if (removed) assert.equal(registry.cleanup[row.identity.ownershipId].receipt.state, 'removed', row.label)
    else {
      assert.deepEqual(readFileSync(join(row.worktree, tracked)), row.preservedTracked, `${row.label}: existing work survives`)
      if (row.physicalTarget) assert.ok(existsSync(row.physicalTarget), 'symlink target survives')
      if (row.kind === 'race') assert.equal(registry.cleanup[row.identity.ownershipId].receipt.state, 'held', row.label)
    }
    if (row.identity.branch) {
      const refs = git(root, 'for-each-ref', '--format=%(refname)', row.identity.branch).split('\n')
      assert.equal(refs.includes(row.identity.branch), !removed, `${row.label}: branch disposition matches safe removal`)
    }
  }
  assert.deepEqual(registry.slots, initialSlots, 'cleanup never drops active session claims')
  const beforeReplay = readFileSync(registryPath)
  const replay = await cleanup.applyWorktreeCleanup(root, plan, { probeProtection, dispose() { throw new Error('completed replay must not dispose') } })
  assert.deepEqual(replay, applied)
  assert.deepEqual(readFileSync(registryPath), beforeReplay)
  console.log('WORKTREE_GC_MATRIX ' + JSON.stringify({ count: rows.length, providerUsage: 'injected', recoveries: recovery,
    rows: rows.map(row => ({ label: row.label, expectedClass: expectedClass(row), classified: plan.items.find(item => item.worktree === row.worktree).classification,
      selected: expected.has(row.identity.ownershipId), removed: !existsSync(row.worktree), held: existsSync(row.worktree) })) }))
})
