#!/usr/bin/env node
/**
 * TEST-FIRST for cli/lib/curate.mjs deriveCurationRange(cwd, phaseNum) — the range the
 * do-phase squash step is allowed to rewrite (phase 2145.1; curate.mjs does not exist yet
 * → RED until it lands). Curation rewrites history, so the range must be EXACT: base comes
 * from the one archaeology seam (cli/lib/gitscan.mjs derivePhaseStartSha), the walk is
 * base-exclusive..HEAD-inclusive oldest-first, every commit in it must match the phase's
 * own grammar, and a single commit that does not (a sibling session's work, a neighbouring
 * phase number) turns the whole answer into a typed refusal naming every offender — never
 * a partial squash over someone else's commit.
 *
 * Real seeded git repos (execFileSync git, never a shell string), the makeRepo idiom from
 * cli/commands/gate.test.mjs — the em-dash boundary and revert pairing only mean anything
 * against a real git. Run: capbuild node --test cli/lib/curate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { deriveCurationRange } from './curate.mjs'

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

/** A git repo with a root commit, plus commit()/revert() helpers returning the new SHA. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'zr-curate-'))
  bases.push(root)
  const git = (...a) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim()
  git('init', '-q')
  let n = 0
  /** One commit per call; each writes its own file so no commit is empty. */
  const commit = (msg, rel) => {
    const path = rel ?? `work/f${++n}.txt`
    const abs = join(root, path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, `${msg}\n`)
    git('add', '-A')
    git('commit', '-q', '-m', msg)
    return git('rev-parse', 'HEAD')
  }
  const revert = (sha) => {
    git('revert', '--no-edit', sha)
    return git('rev-parse', 'HEAD')
  }
  const subject = (sha) => git('log', '-1', '--format=%s', sha)
  /** Every commit in base..HEAD, oldest-first — the ground truth the walk must reproduce. */
  const rangeShas = (base) => git('rev-list', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean)
  return { root, git, commit, revert, subject, rangeShas }
}

test('a clean phase range derives: base is the move commit parent, every commit classified oldest-first', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  const preBase = r.commit('seed phase-21 file') // no em-dash → not phase-own, sits under the base

  const move = r.commit('docs(roadmap): phase 21 — move to in-progress')
  const t1 = r.commit('feat(cli): phase 21 — 21.1 derive the curation range')
  const scratch = r.commit('scratch(cli): phase 21 — prove the foreign tripwire bites')
  const unscratch = r.revert(scratch)
  const t2 = r.commit('feat(cli): phase 21 — 21.2 squash the range')
  const gateFix = r.commit('fix(cli): phase 21 gate R0 — quality-pass findings')
  const gateFix2 = r.commit('fix(cli): phase 21 gate R1 — code-review findings')
  const state = r.commit('docs(roadmap): phase 21 — record the transparency report')

  const res = deriveCurationRange(r.root, 21)

  assert.equal(res.ok, true)
  assert.deepEqual(Object.keys(res).sort(), ['base', 'commits', 'ok'], 'the ok branch carries exactly base + commits')
  assert.equal(res.base, preBase, 'base = the parent of the move-to-in-progress commit (gitscan tier 1)')
  assert.deepEqual(
    res.commits,
    [
      { sha: move, subject: r.subject(move), kind: 'state' },
      { sha: t1, subject: r.subject(t1), kind: 'task' },
      { sha: scratch, subject: r.subject(scratch), kind: 'scratch' },
      { sha: unscratch, subject: r.subject(unscratch), kind: 'scratch' },
      { sha: t2, subject: r.subject(t2), kind: 'task' },
      { sha: gateFix, subject: r.subject(gateFix), kind: 'gate-fix' },
      { sha: gateFix2, subject: r.subject(gateFix2), kind: 'gate-fix' },
      { sha: state, subject: r.subject(state), kind: 'state' },
    ],
    'oldest-first, the move commit included (base is its PARENT), the revert paired as scratch',
  )
  // completeness: the walk reproduces git's own base..HEAD, nothing dropped or invented
  assert.deepEqual(res.commits.map((c) => c.sha), r.rangeShas(res.base))
  assert.equal(res.commits.at(-1).sha, r.git('rev-parse', 'HEAD'), 'the range is HEAD-inclusive')
})

test('an interleaved foreign commit REFUSES the range and names every foreign sha + subject', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  r.commit('seed phase-21 file')

  r.commit('docs(roadmap): phase 21 — move to in-progress')
  r.commit('feat(cli): phase 21 — 21.1 derive the curation range')
  const sibling = r.commit('feat(web): the console gains a corpus filter') // another session's work
  r.commit('fix(cli): phase 21 gate R0 — quality-pass findings')
  const neighbour = r.commit('feat(cli): phase 214 — 214.1 an unrelated phase') // em-dash boundary: 214 is not 21
  const nearMiss = r.commit('chore: bump deps for phase 21 rollout') // says "phase 21", carries no task id
  r.commit('docs(roadmap): phase 21 — record the transparency report')

  const res = deriveCurationRange(r.root, 21)

  assert.equal(res.ok, false, 'one foreign commit in the range refuses the WHOLE range — never a partial squash')
  assert.deepEqual(Object.keys(res).sort(), ['foreign', 'ok', 'reason'], 'the refusal branch carries exactly reason + foreign')
  assert.equal(typeof res.reason, 'string')
  assert.ok(res.reason.length > 0, 'the refusal is named, not empty')
  assert.match(res.reason, /foreign/i)
  assert.deepEqual(
    res.foreign,
    [
      { sha: sibling, subject: r.subject(sibling) },
      { sha: neighbour, subject: r.subject(neighbour) },
      { sha: nearMiss, subject: r.subject(nearMiss) },
    ],
    'every foreign commit is named, oldest-first, with its subject',
  )
})

test('a docs-only roadmap range derives cleanly — state commits curate too', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  const preBase = r.commit('seed phase-30 file')

  const move = r.commit('docs(roadmap): phase 30 — move to in-progress')
  const s1 = r.commit('docs(roadmap): phase 30 — record the transparency report')
  const s2 = r.commit('docs(roadmap): phase 30 — move to done')

  const res = deriveCurationRange(r.root, 30)

  assert.equal(res.ok, true, 'a range of nothing but state commits still curates')
  assert.equal(res.base, preBase)
  assert.deepEqual(res.commits, [
    { sha: move, subject: r.subject(move), kind: 'state' },
    { sha: s1, subject: r.subject(s1), kind: 'state' },
    { sha: s2, subject: r.subject(s2), kind: 'state' },
  ])
})

test('a roadmap-repo task commit (docs(roadmap) + a task id) is curatable, never foreign', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  r.commit('seed phase-31 file')

  r.commit('docs(roadmap): phase 31 — move to in-progress')
  const dual = r.commit('docs(roadmap): phase 31 — 31.1 queue the follow-up') // task grammar AND state grammar

  const res = deriveCurationRange(r.root, 31)

  // Which of the two overlapping kinds wins is the implementation's call; that it is
  // NOT foreign is the safety property — a docs-repo phase must never refuse itself.
  assert.equal(res.ok, true)
  const row = res.commits.find((c) => c.sha === dual)
  assert.deepEqual({ sha: row?.sha, subject: row?.subject }, { sha: dual, subject: r.subject(dual) })
  assert.ok(['task', 'state'].includes(row.kind), `a docs(roadmap) task commit must classify task|state, got ${row.kind}`)
})

test('the range is base-EXCLUSIVE: foreign commits under the base are out of scope (tier-2 base, no move commit)', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  r.commit('feat(web): a sibling session lands a filter') // foreign, but BELOW the base
  const preBase = r.commit('fix(api): another session fixes a 404') // the commit the base resolves to

  // No move commit → gitscan tier 2: base = the parent of the OLDEST `phase 40 —` match.
  const t1 = r.commit('feat(cli): phase 40 — 40.1 first task')
  const t2 = r.commit('feat(cli): phase 40 — 40.2 second task')

  const res = deriveCurationRange(r.root, 40)

  assert.equal(res.ok, true, 'foreign history under the base must not refuse the phase range')
  assert.equal(res.base, preBase, 'tier-2 base = parent of the oldest phase-own commit')
  assert.deepEqual(res.commits, [
    { sha: t1, subject: r.subject(t1), kind: 'task' },
    { sha: t2, subject: r.subject(t2), kind: 'task' },
  ])
})
