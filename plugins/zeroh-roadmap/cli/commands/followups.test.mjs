#!/usr/bin/env node
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, runCli, commitPaths, definePhaseSrc } from '../../test/fixture-consumer/harness.mjs'

function writeFollowup(root, name, body) {
  const dir = join(root, 'roadmap', 'followups')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), body)
}

/**
 * A real-shaped phase file: a header DOCBLOCK carrying `quotedStatus` as PROSE, then the actual
 * `definePhase(` field. The two disagree on purpose — the docblock is documentation, the field is
 * the phase's status, and only the field may decide whether this phase's citations count.
 */
function writePhaseWithProse(root, { phase, status, quotedStatus, notes }) {
  const docblock = [
    '/**',
    ` * Phase ${phase}. The record this plan supersedes reads:`,
    ` *   status: '${quotedStatus}'   ← PROSE, quoted from another phase's file.`,
    ' */',
    '',
  ].join('\n')
  writeFileSync(
    join(root, 'roadmap', 'phases', `phase-${phase}.phase.ts`),
    docblock + definePhaseSrc({ phase, status, kind: 'logic', notes, tasks: [] }),
  )
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
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-9000.phase.ts'), "export default { status: 'backlog', note: 'parked.md' }\n")
  // A DONE phase's citation is history, not a live plan input: it must NOT keep a followup off the
  // orphan list, or the remedy for a deletion becomes editing shipped history (phase 2423 gate R2).
  writeFollowup(root, 'cited-by-done.md', '---\nstatus: spent\n---\nClaimed done\n')
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-9001.phase.ts'), "export default { status: 'done', note: 'cited-by-done.md' }\n")
  // The directory index is not a followup and must not be counted.
  writeFileSync(join(root, 'roadmap', 'followups', 'README.md'), '# index\n')
  commitPaths(root, 'seed followup census', ['roadmap/followups', 'roadmap/backlog.ts', 'roadmap/arcs', 'roadmap/phases/phase-9000.phase.ts', 'roadmap/phases/phase-9001.phase.ts'])

  const result = runCli(root, ['followups', 'census', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.json.summary, {
    total: 6, untriaged: 1, orphaned: 3, live: 1, parked: 1, superseded: 1, spent: 2,
  }, 'README.md is excluded from the census; the done-phase citation does not rescue cited-by-done.md from orphanhood')
  assert.deepEqual(result.json.rows.map(({ file, status, trigger, refs, orphan }) => ({ file, status, trigger, refs, orphan })), [
    { file: 'backlog-ref.md', status: 'superseded', trigger: null, refs: { backlog: true, phases: false, arcs: false }, orphan: false },
    { file: 'cited-by-done.md', status: 'spent', trigger: null, refs: { backlog: false, phases: false, arcs: false }, orphan: true },
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
  // A dated file pins the review-by VALUE, not just the header: release-sweep Step 2.5 flags a
  // past review-by from this column, so dropping the cell must red even if the header survives.
  writeFollowup(root, 'dated.md', '---\nstatus: parked\ntrigger: the second consumer appears\nreview-by: 2099-12-31\n---\nbody\n')
  const result = runCli(root, ['followups', 'census'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /orphan\.md\s+UNTRIAGED/)
  assert.match(result.stdout, /REVIEW-BY/, 'the human table carries the review-by column release-sweep Step 2.5 reads')
  assert.match(result.stdout, /dated\.md[^\n]*2099-12-31/, 'the review-by VALUE reaches the row, not only the header')
  assert.match(result.stdout, /2 total.*1 UNTRIAGED/i)
})

test('followups census rejects every grammar violation to UNTRIAGED and fails ageDays open', () => {
  const root = makeFixtureRepo()
  writeFollowup(root, 'bad-date.md', '---\nstatus: live\nreview-by: soon\n---\nMalformed review date\n')
  writeFollowup(root, 'bad-status.md', '---\nstatus: retired\n---\nStatus outside the enum\n')
  writeFollowup(root, 'parked-no-trigger.md', '---\nstatus: parked\n---\nNo promoting event\n')
  const result = runCli(root, ['followups', 'census', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.json.rows.map((row) => [row.file, row.status]), [
    ['bad-date.md', 'UNTRIAGED'],
    ['bad-status.md', 'UNTRIAGED'],
    ['parked-no-trigger.md', 'UNTRIAGED'],
  ])
  // Never committed → `git log -1` is empty: ageDays fails OPEN (null), never throws.
  assert.ok(result.json.rows.every((row) => row.ageDays === null))
})

test('followups census matches inbound references by exact basename, never substring', () => {
  const root = makeFixtureRepo()
  writeFollowup(root, 'WORKFORCE.md', '---\nstatus: live\n---\nShort name\n')
  writeFollowup(root, 'HQWORKFORCE.md', '---\nstatus: live\n---\nLonger name that contains the short one\n')
  writeFileSync(join(root, 'roadmap', 'backlog.ts'), "export default { note: 'roadmap/followups/HQWORKFORCE.md' }\n")
  const result = runCli(root, ['followups', 'census', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.json.rows.map((row) => [row.file, row.orphan]), [
    ['HQWORKFORCE.md', false],
    ['WORKFORCE.md', true],
  ])
})

// The liveOnly skip decides whether a citation counts, so it must read the status FIELD the way
// every other reader does (matchStatusField, anchored at definePhase). A whole-file regex answers
// "does this text mention a terminal status" — a live phase whose docblock QUOTES one is then
// skipped, its citation vanishes, and the followup is reported ORPHANED: the silent under-count
// this census exists to prevent. Both directions are
// pinned, because deleting the skip would "fix" the first case and break the second.
test('followups census counts a LIVE phase citation whose docblock prose quotes a terminal status', () => {
  const root = makeFixtureRepo()
  writeFollowup(root, 'plan-input.md', '---\nstatus: live\n---\nPlan input of a live phase\n')
  writeFollowup(root, 'history-only.md', '---\nstatus: live\n---\nCited only by shipped history\n')
  writePhaseWithProse(root, { phase: 9100, status: 'backlog', quotedStatus: 'done', notes: 'followups/plan-input.md' })
  // Mirror image: prose says backlog, the FIELD says done — a done phase's citation is history and
  // must still be skipped, so a fix that simply drops the skip cannot pass this pair.
  writePhaseWithProse(root, { phase: 9101, status: 'done', quotedStatus: 'backlog', notes: 'followups/history-only.md' })

  const result = runCli(root, ['followups', 'census', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(
    result.json.rows.map(({ file, refs, orphan }) => ({ file, phases: refs.phases, orphan })),
    [
      { file: 'history-only.md', phases: false, orphan: true },
      { file: 'plan-input.md', phases: true, orphan: false },
    ],
    'the live phase (status FIELD backlog) counts its citation; the done phase (status FIELD done) does not',
  )
  assert.equal(result.json.summary.orphaned, 1, 'exactly one orphan — quoting a terminal status in prose does not manufacture another')
})

test('followups census applies the terminal skip ONLY to *.phase.ts — a note under phases/ and an arc still count', () => {
  const root = makeFixtureRepo()
  writeFollowup(root, 'noted.md', '---\nstatus: live\n---\nCited by the phases index\n')
  writeFollowup(root, 'arced.md', '---\nstatus: live\n---\nCited by an arc file\n')
  // Not a phase file: it has no status field to read, so no skip can apply to it.
  writeFileSync(
    join(root, 'roadmap', 'phases', 'README.md'),
    "# Phases index\n\nShipped rows read `status: 'done'`. The live queue's plan input is followups/noted.md.\n",
  )
  // Arcs are never status-scoped at all — an arc citing a followup is always a live reference.
  writeFileSync(join(root, 'roadmap', 'arcs', 'T.arc.ts'), "export default { id: 'T', status: 'done', notes: 'followups/arced.md' }\n")

  const result = runCli(root, ['followups', 'census', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(
    result.json.rows.map(({ file, refs, orphan }) => ({ file, phases: refs.phases, arcs: refs.arcs, orphan })),
    [
      { file: 'arced.md', phases: false, arcs: true, orphan: false },
      { file: 'noted.md', phases: true, arcs: false, orphan: false },
    ],
    'terminal-status TEXT in a non-phase file never suppresses its citation',
  )
  assert.equal(result.json.summary.orphaned, 0)
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
