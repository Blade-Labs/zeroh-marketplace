import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function cleanupOwnedLaneFixture({ id, existing = null, module, makeRepo, track, lane = 'run', worktree: requestedWorktree, branch: requestedBranch, detached = false }) {
  const r = existing?.r ?? makeRepo()
  const head = existing ? r.git('rev-parse', 'develop') : r.commit('cleanup integrated seed')
  if (!existing) r.git('branch', '-f', 'develop', head)
  const worktree = requestedWorktree ?? `${r.root}-cleanup-${id}`
  const branch = requestedBranch ?? `cleanup/${id}`
  track(worktree)
  if (detached) r.git('worktree', 'add', '-q', '--detach', worktree, head)
  else r.git('worktree', 'add', '-q', '-b', branch, worktree, head)
  const laneOwner = { kind: 'roadmap-codex', id: `${lane}:${id}` }
  const identity = module.createWorktreeIdentity(r.root, worktree, {
    ownershipId: `823e4567-e89b-42d3-a456-426614${String(id).slice(-6).padStart(6, '0')}`,
    laneOwner,
    expectedBranch: detached ? null : `refs/heads/${branch}`,
  })
  module.registerWorktreeIdentity(r.root, identity)
  const journal = {
    phases: [String(id)], lane, worktree, laneOwner, worktreeIdentity: identity,
    ownerRoot: realpathSync(r.root), pgid: 999999999, requestedRef: 'refs/heads/develop',
    requestedHead: head, baseHead: head, workingHead: head, startedAt: '2026-09-07T00:00:00.000Z',
  }
  const prefix = lane === 'run' ? 'codex-' : `codex-${lane}-`
  const journalPath = join(r.root, '.building', `${prefix}${id}.json`)
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + '\n')
  return { module, r, head, worktree, identity, journal, journalPath }
}
