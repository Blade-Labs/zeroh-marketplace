#!/usr/bin/env node
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, runCli, commitPaths } from '../../test/fixture-consumer/harness.mjs'

function writeFollowup(root, name, body) {
  const dir = join(root, 'roadmap', 'followups')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), body)
}

test('followups census distinguishes lifecycle states, references, and orphans', () => {
  const root = makeFixtureRepo()
  writeFollowup(root, 'live.md', '---\nstatus: live\n---\nLive action\n')
  writeFollowup(root, 'parked.md', '---\nstatus: parked\ntrigger: phase 9000 done\nreview-by: 2099-12-31\n---\nParked action\n')
  writeFollowup(root, 'spent.md', '---\nstatus: spent\n---\nCompleted action\n')
  writeFollowup(root, 'orphan.md', 'Headerless action\n')
  writeFollowup(root, 'backlog-ref.md', '---\nstatus: superseded\n---\nOld action\n')
  writeFileSync(join(root, 'roadmap', 'backlog.ts'), "export default { note: 'followups/backlog-ref.md' }\n")
  mkdirSync(join(root, 'roadmap', 'arcs'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'arcs', 'A.arc.ts'), "export default { note: 'live.md' }\n")
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-9000.phase.ts'), "export default { note: 'parked.md' }\n")
  commitPaths(root, 'seed followup census', ['roadmap/followups', 'roadmap/backlog.ts', 'roadmap/arcs', 'roadmap/phases/phase-9000.phase.ts'])

  const result = runCli(root, ['followups', 'census', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.json.summary, {
    total: 5, untriaged: 1, orphaned: 2, live: 1, parked: 1, superseded: 1, spent: 1,
  })
  assert.deepEqual(result.json.rows.map(({ file, status, trigger, refs, orphan }) => ({ file, status, trigger, refs, orphan })), [
    { file: 'backlog-ref.md', status: 'superseded', trigger: null, refs: { backlog: true, phases: false, arcs: false }, orphan: false },
    { file: 'live.md', status: 'live', trigger: null, refs: { backlog: false, phases: false, arcs: true }, orphan: false },
    { file: 'orphan.md', status: 'UNTRIAGED', trigger: null, refs: { backlog: false, phases: false, arcs: false }, orphan: true },
    { file: 'parked.md', status: 'parked', trigger: 'phase 9000 done', refs: { backlog: false, phases: true, arcs: false }, orphan: false },
    { file: 'spent.md', status: 'spent', trigger: null, refs: { backlog: false, phases: false, arcs: false }, orphan: true },
  ])
  assert.ok(result.json.rows.every((row) => Number.isInteger(row.ageDays) && row.ageDays >= 0))
})

test('followups census human table reports the summary and remains a report tool', () => {
  const root = makeFixtureRepo()
  writeFollowup(root, 'orphan.md', 'No frontmatter\n')
  const result = runCli(root, ['followups', 'census'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /orphan\.md\s+UNTRIAGED/)
  assert.match(result.stdout, /1 total.*1 UNTRIAGED.*1 orphan/i)
})

test('followups census returns an empty report when the directory is absent', () => {
  const root = makeFixtureRepo()
  const result = runCli(root, ['followups', 'census', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.json, {
    rows: [],
    summary: { total: 0, untriaged: 0, orphaned: 0, live: 0, parked: 0, superseded: 0, spent: 0 },
  })
})
