#!/usr/bin/env node
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, mkdirSync, readdirSync, statSync, existsSync, chmodSync } from 'node:fs'
import { makeFixtureRepo, runCli, writePhaseFile, commitPaths, git, bases } from './harness.mjs'
import { latestReport, correctnessDecision, CORRECTNESS_ROUND_CAP } from '../../cli/lib/gate-report.mjs'
import { launchCompletedExactLane } from './exact-lane.fixture.mjs'
import { validateArchivedReviewCompletion } from '../../cli/lib/codex-journal.mjs'
import { removeWorktreeIdentity } from '../../cli/lib/worktree.mjs'

const seed = (phase) => {
  const root = makeFixtureRepo()
  const path = writePhaseFile(root, {
    phase, status: 'in-progress', name: 'bounded review convergence', category: 'test', source: 'fixture-consumer',
    priority: 'LOW', dependsOn: [], conflictsWith: [], keyFiles: ['src/plain.ts'],
    stakeholderDemo: 'ten incomplete criteria reach a bounded review decision', kind: 'logic',
    tasks: [{ minimal: true, id: `${phase}.1`, title: 'bounded convergence', done: true }], reviewScope: 'full', testScope: 'full',
  }, { kind: 'define' })
  commitPaths(root, `feat: phase ${phase} — review convergence`, [path])
  const gate = runCli(root, ['gate', 'run', String(phase)])
  assert.equal(gate.code, 0, gate.stderr)
  return root
}

const exactLane = async (root, lane, id) => {
  const worktree = `${root}-exact-${lane}-${id}`
  bases.push(worktree)
  mkdirSync(root + '/.building', { recursive: true })
  const brief = `${root}/.building/exact-${id}-brief.md`
  writeFileSync(brief, '# Exact bounded criteria\n')
  return launchCompletedExactLane({
    root, lane, id, worktree, authorPlan: false, reviewDoc: lane === 'plan' ? brief : null,
    invoke: (args, env) => runCli(root, ['codex', ...args, '--parent-authority', 'workspace-write'], env),
  })
}

const tenOpen = Array.from({ length: 10 }, (_, index) => ({
  file: `src/criterion-${index + 1}.ts`, severity: 'HIGH',
  description: `acceptance criterion ${index + 1} remains incomplete after the bounded review`,
}))
const head = (root) => git(root, 'rev-parse', 'HEAD')
const record = (root, phase, round, verdict, findings, sha, agent = 'code-reviewer') =>
  runCli(root, ['gate', 'run', String(phase), '--record-round', JSON.stringify({
    round, agent, verdict, summary: `${findings.length} incomplete criteria`, findings, sha,
  })])

async function proveExactLanes(root, reviewPhase, planId) {
  const review = await exactLane(root, 'review', reviewPhase)
  const plan = await exactLane(root, 'plan', planId)
  for (const [lane, id, fx] of [['review', reviewPhase, review], ['plan', planId, plan]]) {
    const status = runCli(root, ['codex', 'status', String(id), `--${lane}`])
    assert.equal(status.code, 0, status.stderr)
    assert.equal(status.json.state, 'complete')
    assert.equal(status.json.reportDigest, fx.journal.reportDigest)
  }
  return { review, plan }
}

test('37.6 — exactly ten incomplete criteria halt at the shipped third-round cap without erasing evidence', async () => {
  const phase = 93760
  const root = seed(phase)
  const lanes = await proveExactLanes(root, phase, 93762)
  for (let round = 1; round <= CORRECTNESS_ROUND_CAP; round += 1) {
    if (round > 1) {
      const rel = `src/repair-round-${round}.ts`
      writeFileSync(`${root}/${rel}`, `export const repairRound = ${round}\n`)
      commitPaths(root, `fix: phase ${phase} — repair round ${round}`, [rel])
    }
      const reviewed = await exactLane(root, 'review', phase)
      assert.equal(reviewed.journal.requestedHead, head(root), `round ${round} review binds the repaired HEAD`)
      const reviewedStatus = runCli(root, ['codex', 'status', String(phase), '--review'])
      assert.equal(reviewedStatus.code, 0, reviewedStatus.stderr)
    const sha = head(root)
    const written = record(root, phase, round, 'findings-fixed', tenOpen, sha)
    assert.equal(written.code, 0, written.stderr)
    const brief = runCli(root, ['gate', 'round-brief', String(phase), '--json'])
    assert.equal(brief.code, 0, brief.stderr)
    assert.equal(brief.json.rule, round < CORRECTNESS_ROUND_CAP ? 'continue' : 'cap')
    assert.equal(brief.json.sinceSha, sha)
    assert.equal(brief.json.priorFindings.length, 10)
  }
  const report = latestReport(root, phase).report
  assert.deepEqual(report.agents.map((round) => round.findings.length), [10, 10, 10])
  assert.equal(correctnessDecision(report.agents).rule, 'cap')

  writeFileSync(lanes.plan.reportPath, 'tampered stale result\nCODEX-RUN-COMPLETE\n')
  const before = readFileSync(latestReport(root, phase).path)
  const stale = runCli(root, ['codex', 'status', String(93762), '--plan'])
  const capped = latestReport(root, phase)
  const beforeFourth = readFileSync(capped.path)
  const fourth = record(root, phase, 4, 'findings-fixed', tenOpen, head(root))
  assert.notEqual(fourth.code, 0, 'the shipped cap refuses a fourth unresolved review round')
  assert.deepEqual(readFileSync(capped.path), beforeFourth, 'cap refusal preserves the third-round evidence byte-for-byte')
  assert.notEqual(stale.code, 0)
  assert.deepEqual(readFileSync(latestReport(root, phase).path), before, 'a stale lane cannot ingest another review round')
})

test('37.6 — ten incomplete criteria converge only after an actual repair HEAD and fresh independent clean round', async () => {
  const phase = 93761
  const root = seed(phase)
  await proveExactLanes(root, phase, 93763)
  const firstHead = head(root)
  assert.equal(record(root, phase, 1, 'findings-fixed', tenOpen, firstHead).code, 0)
  const firstBrief = runCli(root, ['gate', 'round-brief', String(phase), '--json'])
  assert.equal(firstBrief.json.sinceSha, firstHead)
  assert.equal(firstBrief.json.priorFindings.length, 10)

  writeFileSync(`${root}/src/repair.ts`, 'export const repaired = true\n')
  commitPaths(root, `fix: phase ${phase} — repair ten criteria`, ['src/repair.ts'])
  const repairHead = head(root)
  assert.notEqual(repairHead, firstHead)
  const rereview = await exactLane(root, 'review', phase)
  assert.equal(rereview.journal.requestedHead, repairHead, 'fresh review completion binds the actual repair HEAD')
  const rereviewStatus = runCli(root, ['codex', 'status', String(phase), '--review'])
  assert.equal(rereviewStatus.code, 0, rereviewStatus.stderr)
  assert.equal(rereviewStatus.json.reportDigest, rereview.journal.reportDigest)
  assert.equal(record(root, phase, 2, 'clean', [], repairHead, 'independent-code-reviewer').code, 0)
  const brief = runCli(root, ['gate', 'round-brief', String(phase), '--json'])
  assert.equal(brief.json.rule, 'clean')
  assert.equal(brief.json.sinceSha, repairHead)
  assert.deepEqual(brief.json.priorFindings, [])
  const report = latestReport(root, phase).report
  assert.equal(report.agents[0].findings.length, 10)
  assert.equal(correctnessDecision(report.agents).terminal, true)
})

for (const mode of ['retained', 'removed']) test(`37.6 — three ${mode} exact reviews preserve every prior launch artifact and identical archived reuse is a no-op`, async () => {
  const phase = mode === 'retained' ? 93764 : 93768
  const root = seed(phase)
  const snapshots = []
  let current
  for (let round = 1; round <= 3; round += 1) {
    if (round > 1) {
      const rel = `src/three-review-${round}.ts`
      writeFileSync(`${root}/${rel}`, `export const reviewedRound = ${round}\n`)
      commitPaths(root, `fix: phase ${phase} — review repair ${round}`, [rel])
    }
    current = await exactLane(root, 'review', phase)
    assert.equal(current.journal.requestedHead, head(root))
    if (round > 1) {
      for (const prior of snapshots) {
        assert.deepEqual(readFileSync(prior.journalPath), prior.journal)
        assert.deepEqual(readFileSync(prior.promptPath), prior.prompt)
        assert.deepEqual(readFileSync(prior.reportPath), prior.report)
      }
    }
    const status = runCli(root, ['codex', 'status', String(phase), '--review'])
    assert.equal(status.code, 0, status.stderr)
    const archivedJournal = JSON.parse(readFileSync(current.journalPath, 'utf8'))
    if (mode === 'removed') {
      // Explicit fixture retirement exercises archived reuse; GC safety has its own real-Git matrix.
      git(root, 'worktree', 'remove', '--force', current.worktree)
      if (archivedJournal.worktreeIdentity) removeWorktreeIdentity(root, archivedJournal.worktreeIdentity)
    }
    const prefix = current.journalPath.replace(/\.json$/, `.prior.${archivedJournal.launchId}`)
    snapshots.push({
      journalPath: `${prefix}.json`, promptPath: `${prefix}.prompt.txt`, reportPath: `${prefix}.report.md`,
      journal: readFileSync(current.journalPath), prompt: readFileSync(archivedJournal.prompt), report: readFileSync(archivedJournal.archivedReport),
    })
  }

  const beforeNames = readdirSync(`${root}/.building`).filter((name) => name.includes('.prior.')).sort()
  const beforeJournal = readFileSync(current.journalPath)
  const beforeMtime = statSync(current.journalPath).mtimeMs
  const marker = `${root}/.building/identical-archive-native-start`
  const fakeBin = `${root}/fakebin-complete-review`
  writeFileSync(`${fakeBin}/codex`, `#!/bin/sh\nprintf started > "${marker}"\n`)
  const identical = runCli(root, ['codex', 'review', String(phase), '--worktree', current.worktree, '--base', 'develop', '--parent-authority', 'workspace-write'], { PATH: `${fakeBin}:${process.env.PATH}` })
  assert.equal(identical.code, 0, identical.stderr)
  assert.equal(existsSync(current.worktree), mode === 'retained', 'identical archived reuse preserves worktree presence')
  assert.equal(existsSync(marker), false, 'identical archived proof starts no native process')
  assert.deepEqual(readFileSync(current.journalPath), beforeJournal)
  assert.equal(statSync(current.journalPath).mtimeMs, beforeMtime)
  assert.deepEqual(readdirSync(`${root}/.building`).filter((name) => name.includes('.prior.')).sort(), beforeNames, 'no new snapshot is minted')
})

test('37.6 — fresh and archived review launches refuse different primary bytes for a tracked target input', async () => {
  for (const [mode, phase] of [['fresh', 93765], ['archived', 93766], ['retained', 93769]]) {
    const root = seed(phase)
    let worktree = `${root}-exact-review-${phase}`
    if (mode !== 'fresh') {
      const completed = await exactLane(root, 'review', phase)
      const consumed = runCli(root, ['codex', 'status', String(phase), '--review'])
      assert.equal(consumed.code, 0, consumed.stderr)
      worktree = completed.worktree
      if (mode === 'archived') git(root, 'worktree', 'remove', '--force', worktree)
    }
    const rel = `.building/${mode}-tracked-review.md`
    mkdirSync(`${root}/.building`, { recursive: true })
    writeFileSync(`${root}/${rel}`, '# Target-owned review bytes\n')
    git(root, 'add', '-f', rel)
    git(root, 'commit', '-q', '-m', `docs: track ${mode} review input`)
    if (mode === 'fresh') {
      bases.push(worktree)
      git(root, 'worktree', 'add', '-q', '--detach', worktree, 'HEAD')
    }
    writeFileSync(`${root}/${rel}`, '# Different primary bytes\n')
    const journalPath = `${root}/.building/codex-review-${phase}.json`
    const promptPath = `${root}/.building/codex-review-${phase}-prompt.txt`
    const reportPath = `${worktree}/CODEX-REVIEW.md`
    const laneExists = existsSync(worktree)
    const before = {
      head: laneExists ? git(worktree, 'rev-parse', 'HEAD') : null,
      doc: existsSync(`${worktree}/${rel}`) ? readFileSync(`${worktree}/${rel}`) : null,
      journal: existsSync(journalPath) ? readFileSync(journalPath) : null,
      prompt: existsSync(promptPath) ? readFileSync(promptPath) : null,
      report: existsSync(reportPath) ? readFileSync(reportPath) : null,
    }
    const fakeBin = `${root}/fakebin-${mode}-tracked`
    mkdirSync(fakeBin)
    const marker = `${root}/.building/${mode}-tracked-native-start`
    writeFileSync(`${fakeBin}/codex`, `#!/bin/sh\nprintf started > "${marker}"\n`)
    chmodSync(`${fakeBin}/codex`, 0o755)
    const invoked = runCli(root, ['codex', 'review', String(phase), '--doc', `${root}/${rel}`, '--worktree', worktree, '--base', 'develop', '--parent-authority', 'workspace-write'], { PATH: `${fakeBin}:${process.env.PATH}` })
    assert.notEqual(invoked.code, 0, `${mode}: differing tracked bytes must refuse`)
    assert.match(invoked.stderr, /tracked|differ|overwrite|refus|carried|unowned/i, mode)
    assert.equal(existsSync(marker), false, `${mode}: no native process starts`)
    assert.deepEqual(existsSync(journalPath) ? readFileSync(journalPath) : null, before.journal, `${mode}: journal preserved`)
    assert.deepEqual(existsSync(promptPath) ? readFileSync(promptPath) : null, before.prompt, `${mode}: prompt preserved`)
    assert.deepEqual(existsSync(reportPath) ? readFileSync(reportPath) : null, before.report, `${mode}: report preserved`)
    assert.equal(existsSync(worktree), laneExists, `${mode}: worktree presence preserved`)
    if (laneExists) {
      assert.equal(git(worktree, 'rev-parse', 'HEAD'), before.head, `${mode}: HEAD preserved`)
      assert.deepEqual(existsSync(`${worktree}/${rel}`) ? readFileSync(`${worktree}/${rel}`) : null, before.doc, `${mode}: target input presence and bytes preserved`)
    }
  }
})

test('37.6 — archived-only validation refuses a completed review whose worktree still stands', async () => {
  const phase = 93767
  const root = seed(phase)
  const standing = await exactLane(root, 'review', phase)
  const j = standing.journal
  const checked = validateArchivedReviewCompletion(root, [phase], {
    worktree: standing.worktree, requestedRef: j.requestedRef, requestedHead: j.requestedHead,
    laneOwner: j.laneOwner, authorityDigest: j.authorityDigest, governanceDigest: j.governanceDigest,
  })
  assert.equal(checked.valid, false)
  assert.equal(checked.purpose, 'archived-review')
  assert.equal(checked.state, 'unowned')
  assert.ok(existsSync(standing.worktree), 'read-only validation preserves the standing lane')
})

test('37.6 — brand-new plan and review refuse tracked input mismatch before creating a worktree', () => {
  for (const [lane, phase] of [['review', 93768], ['plan', 93769]]) {
    const root = lane === 'review' ? seed(phase) : makeFixtureRepo()
    const rel = `.building/absent-${lane}-input.md`
    mkdirSync(`${root}/.building`, { recursive: true })
    writeFileSync(`${root}/${rel}`, '# Target-owned input bytes\n')
    git(root, 'add', '-f', rel)
    git(root, 'commit', '-q', '-m', `docs: track absent ${lane} input`)
    writeFileSync(`${root}/${rel}`, '# Different primary request bytes\n')
    const worktree = `${root}-absent-${lane}-${phase}`
    bases.push(worktree)
    const journalPath = `${root}/.building/codex-${lane}-${phase}.json`
    const promptPath = `${root}/.building/codex-${lane}-${phase}-prompt.txt`
    const marker = `${root}/.building/absent-${lane}-native-start`
    const fakeBin = `${root}/fakebin-absent-${lane}`
    mkdirSync(fakeBin)
    writeFileSync(`${fakeBin}/codex`, `#!/bin/sh\nprintf started > "${marker}"\n`)
    chmodSync(`${fakeBin}/codex`, 0o755)
    const inputFlag = lane === 'plan' ? '--brief' : '--doc'
    const invoked = runCli(root, ['codex', lane, String(phase), inputFlag, `${root}/${rel}`, '--worktree', worktree, '--base', 'develop', '--parent-authority', 'workspace-write'], { PATH: `${fakeBin}:${process.env.PATH}` })
    assert.notEqual(invoked.code, 0, `${lane}: mismatch refuses`)
    assert.match(invoked.stderr, /tracked|differ|overwrite|refus|carried/i, lane)
    assert.equal(existsSync(worktree), false, `${lane}: refusal occurs before checkout creation`)
    assert.equal(existsSync(marker), false, `${lane}: no native process starts`)
    assert.equal(existsSync(journalPath), false, `${lane}: no journal is minted`)
    assert.equal(existsSync(promptPath), false, `${lane}: no prompt is minted`)
    assert.equal(readFileSync(`${root}/${rel}`, 'utf8'), '# Different primary request bytes\n', `${lane}: primary request bytes remain unchanged`)
    assert.equal(git(root, 'show', `HEAD:${rel}`), '# Target-owned input bytes', `${lane}: requested commit bytes remain unchanged`)
  }
})


test('retained archived review with changed archive bytes refuses before reset or prior-artifact mutation', async () => {
  const phase = 93770
  const root = seed(phase)
  const current = await exactLane(root, 'review', phase)
  const status = runCli(root, ['codex', 'status', String(phase), '--review'])
  assert.equal(status.code, 0, status.stderr)
  const journal = JSON.parse(readFileSync(current.journalPath, 'utf8'))
  writeFileSync(journal.archivedReport, 'corrupt archived bytes\n')
  writeFileSync(`${root}/src/later.ts`, 'export const later = true\n')
  commitPaths(root, `fix: phase ${phase} — later review request`, ['src/later.ts'])
  const before = { journal: readFileSync(current.journalPath), prompt: readFileSync(journal.prompt), head: head(current.worktree) }
  const marker = `${root}/.building/corrupt-archive-native-start`
  const fakeBin = `${root}/fakebin-complete-review`
  writeFileSync(`${fakeBin}/codex`, `#!/bin/sh\nprintf started > "${marker}"\n`)
  const refused = runCli(root, ['codex', 'review', String(phase), '--worktree', current.worktree, '--base', 'develop', '--parent-authority', 'workspace-write'], { PATH: `${fakeBin}:${process.env.PATH}` })
  assert.notEqual(refused.code, 0)
  assert.match(refused.stderr, /archived review|archived report/)
  assert.equal(existsSync(marker), false)
  assert.equal(head(current.worktree), before.head)
  assert.deepEqual(readFileSync(current.journalPath), before.journal)
  assert.deepEqual(readFileSync(journal.prompt), before.prompt)
  assert.equal(readdirSync(`${root}/.building`).some(name => name.includes('.prior.')), false)
  assert.equal(readFileSync(journal.archivedReport, 'utf8'), 'corrupt archived bytes\n')
})
