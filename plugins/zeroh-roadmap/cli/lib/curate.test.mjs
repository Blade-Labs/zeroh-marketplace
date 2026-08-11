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
 * TEST-FIRST for executeCurate(cwd, plan) (phase 2145.2) below: the squash is only allowed
 * to be a re-parenting, so the property under test is LOSSLESSNESS — the curated tip's tree
 * hash equals the pre-curation HEAD tree hash, each intermediate curated commit's tree is
 * its group's last original commit's tree, and a chain that would not satisfy that aborts
 * with HEAD unmoved and a rescue ref that still reaches the original history. Because the
 * mechanism is commit-tree + update-ref (never reset --hard), a sibling session's untracked
 * and modified-unstaged files in the shared checkout must come through byte-identical.
 *
 * Real seeded git repos (execFileSync git, never a shell string), the makeRepo idiom from
 * cli/commands/gate.test.mjs — the em-dash boundary and revert pairing only mean anything
 * against a real git. Run: capbuild node --test cli/lib/curate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { deriveCurationRange } from './curate.mjs'
import * as curate from './curate.mjs'

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

// 2145.2 lands executeCurate/CurateError. Resolving them lazily (not as static named
// imports) keeps a missing export a per-test RED instead of a link-time SyntaxError that
// would stop the 2145.1 tests above from running at all.
const executeCurate = (...args) => {
  assert.equal(typeof curate.executeCurate, 'function', 'curate.mjs must export executeCurate(cwd, plan)')
  return curate.executeCurate(...args)
}
const CurateError = () => {
  assert.equal(typeof curate.CurateError, 'function', 'curate.mjs must export the CurateError class')
  return curate.CurateError
}

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
  // executeCurate spawns its OWN git (no -c identity flags), and commit-tree refuses
  // without one — pin the identity on the repo so the fixture does not lean on the host's.
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
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
  const head = () => git('rev-parse', 'HEAD')
  /** The tree hash a commit points at — the losslessness currency of the whole squash. */
  const tree = (sha) => git('rev-parse', `${sha}^{tree}`)
  const fullMessage = (sha) => git('log', '-1', '--format=%B', sha).trim()
  const parent = (sha) => git('rev-parse', `${sha}^`)
  // -uall: a bare --porcelain collapses an untracked directory to `?? dir/`, which would
  // hide the loss of an individual sibling file.
  const status = () => git('status', '--porcelain', '-uall')
  const write = (rel, text) => {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text)
    return abs
  }
  return { root, git, commit, revert, subject, rangeShas, head, tree, fullMessage, parent, status, write }
}

/**
 * Split a derived range into consecutive groups of the given sizes (oldest-first, together
 * covering the WHOLE range — a plan that dropped commits would be a different bug) and hang
 * one landed message off each.
 */
function planFrom(range, sizes, messages) {
  const total = sizes.reduce((a, b) => a + b, 0)
  assert.equal(total, range.commits.length, 'fixture bug: the groups must cover the whole derived range')
  assert.equal(sizes.length, messages.length, 'fixture bug: one message per group')
  const groups = []
  let i = 0
  for (const [gi, n] of sizes.entries()) {
    groups.push({ commits: range.commits.slice(i, i + n), message: messages[gi] })
    i += n
  }
  return { base: range.base, groups }
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

// ── executeCurate: the squash executor (2145.2) ──────────────────────────────────────

test('executeCurate: a one-group plan lands a SINGLE commit over the base, tree-identical to the old HEAD', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  r.commit('seed phase-50 file')

  r.commit('docs(roadmap): phase 50 — move to in-progress')
  r.commit('feat(cli): phase 50 — 50.1 derive the curation range')
  r.commit('feat(cli): phase 50 — 50.2 squash the derived range')
  r.commit('fix(cli): phase 50 gate R0 — quality-pass findings')
  r.commit('docs(roadmap): phase 50 — record the transparency report')

  const range = deriveCurationRange(r.root, 50)
  assert.equal(range.ok, true, 'fixture bug: the range must derive before it can be curated')
  const preHead = r.head()
  const preTree = r.tree(preHead)
  const branch = r.git('rev-parse', '--abbrev-ref', 'HEAD')
  const message = {
    subject: 'feat(cli): phase 50 — curate a phase into landed history',
    body: 'Derive the range, squash it, prove the tree.\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
  }

  const out = executeCurate(r.root, planFrom(range, [range.commits.length], [message]))

  // Losslessness: the ONE property the whole mechanism exists to guarantee.
  assert.equal(r.tree(out.tip), preTree, 'the curated tip carries the pre-curation tree hash, byte for byte')
  assert.equal(out.tip, r.head(), 'the returned tip IS the new HEAD')
  assert.deepEqual(r.rangeShas(range.base), [out.tip], 'exactly one commit spans base..HEAD after a one-group plan')
  assert.equal(r.parent(out.tip), range.base, 'the curated commit is parented on the plan base, not on the old chain')
  assert.notEqual(out.tip, preHead, 'history was actually rewritten — a no-op would pass every tree check vacuously')

  assert.equal(r.fullMessage(out.tip), `${message.subject}\n\n${message.body}`, 'subject, blank line, body — verbatim')

  // The rescue ref is a real ref (not a returned sha string) and still reaches every original commit.
  assert.equal(typeof out.rescueRef, 'string')
  assert.match(r.git('rev-parse', '--symbolic-full-name', out.rescueRef), /^refs\//, 'the rescue is a REF, so the old chain survives gc')
  assert.equal(r.git('rev-parse', out.rescueRef), preHead, 'the rescue ref resolves to the original pre-curation HEAD')
  const rescued = r.git('rev-list', out.rescueRef).split('\n')
  for (const c of range.commits) {
    assert.ok(rescued.includes(c.sha), `the rescue ref must still reach the original ${c.sha.slice(0, 7)} (${c.subject})`)
  }

  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), branch, 'still on the same branch — curation never detaches HEAD')
  assert.equal(r.git('rev-parse', branch), out.tip, 'the BRANCH ref advanced, not merely HEAD')
})

test('executeCurate: a three-group plan lands three commits, each carrying its group’s LAST source tree', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  r.commit('seed phase-51 file')

  r.commit('docs(roadmap): phase 51 — move to in-progress')
  r.commit('feat(cli): phase 51 — 51.1 the range')
  r.commit('feat(cli): phase 51 — 51.2 the executor')
  r.commit('fix(cli): phase 51 gate R0 — quality-pass findings')
  r.commit('feat(cli): phase 51 — 51.3 the composer')
  r.commit('docs(roadmap): phase 51 — record the transparency report')

  const range = deriveCurationRange(r.root, 51)
  assert.equal(range.ok, true, 'fixture bug: the range must derive before it can be curated')
  assert.equal(range.commits.length, 6)
  const preHead = r.head()
  const preTree = r.tree(preHead)
  const messages = [
    { subject: 'feat(cli): phase 51 — derive the curation range', body: 'The base and the walk.' },
    { subject: 'feat(cli): phase 51 — squash the range losslessly', body: 'commit-tree plus update-ref.' },
    { subject: 'feat(cli): phase 51 — compose the landed message', body: 'Subject, body, trailer.' },
  ]
  const plan = planFrom(range, [2, 2, 2], messages)

  const out = executeCurate(r.root, plan)

  const landed = r.rangeShas(range.base)
  assert.equal(landed.length, 3, 'a three-group plan yields exactly three commits')
  assert.equal(out.tip, landed.at(-1))
  assert.equal(r.tree(out.tip), preTree, 'the tip is STILL tree-identical to the pre-curation HEAD')

  // Each boundary commit is a checkpoint of real work: its tree is its group's last original commit's tree.
  for (const [i, group] of plan.groups.entries()) {
    const sourceTip = group.commits.at(-1)
    assert.equal(
      r.tree(landed[i]),
      r.tree(sourceTip.sha),
      `curated commit ${i + 1} must carry the tree of its group’s last source commit (${sourceTip.subject})`,
    )
    assert.equal(r.subject(landed[i]), messages[i].subject, `curated commit ${i + 1} keeps its own subject`)
    assert.equal(r.fullMessage(landed[i]), `${messages[i].subject}\n\n${messages[i].body}`)
  }
  assert.equal(
    new Set(landed.map((s) => r.tree(s))).size,
    3,
    'the three trees genuinely differ — otherwise the per-group tree assertion above proves nothing',
  )

  assert.equal(r.parent(landed[0]), range.base, 'the chain starts on the plan base')
  assert.equal(r.parent(landed[1]), landed[0], 'linear chain, oldest-first')
  assert.equal(r.parent(landed[2]), landed[1])
  assert.equal(r.git('rev-parse', out.rescueRef), preHead)
})

test('executeCurate: a plan whose tip tree would DIFFER aborts with CurateError, HEAD unmoved, rescue ref intact', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  r.commit('seed phase-52 file')

  r.commit('docs(roadmap): phase 52 — move to in-progress')
  r.commit('feat(cli): phase 52 — 52.1 the range')
  r.commit('feat(cli): phase 52 — 52.2 the executor')
  r.commit('fix(cli): phase 52 gate R0 — quality-pass findings')
  r.commit('docs(roadmap): phase 52 — record the transparency report')

  const range = deriveCurationRange(r.root, 52)
  assert.equal(range.ok, true, 'fixture bug: the range must derive before it can be curated')
  const preHead = r.head()
  const preTree = r.tree(preHead)
  const preStatus = r.status()
  const branch = r.git('rev-parse', '--abbrev-ref', 'HEAD')

  const plan = planFrom(range, [3, 2], [
    { subject: 'feat(cli): phase 52 — first half', body: 'One.' },
    { subject: 'feat(cli): phase 52 — second half', body: 'Two.' },
  ])
  // Doctor the plan: the last group now ENDS on an earlier commit, so the assembled tip
  // tree is legitimately not the pre-curation tree — exactly the lossy squash to refuse.
  const stale = range.commits[1]
  plan.groups.at(-1).commits[plan.groups.at(-1).commits.length - 1] = stale
  assert.notEqual(r.tree(stale.sha), preTree, 'fixture bug: the doctored tip tree must actually differ')

  let caught = null
  try {
    executeCurate(r.root, plan)
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err // the missing-export guard, not the refusal
    caught = err
  }

  assert.ok(caught, 'a tip-tree mismatch must ABORT — landing it would silently drop work')
  assert.ok(caught instanceof CurateError(), `expected a CurateError, got ${caught?.constructor?.name}`)
  assert.equal(typeof caught.rescueRef, 'string')
  assert.ok(caught.rescueRef.length > 0, 'the refusal names the rescue ref')
  assert.ok(
    caught.message.includes(caught.rescueRef),
    `the abort message must name the rescue ref so the operator can recover, got: ${caught.message}`,
  )

  assert.equal(r.head(), preHead, 'HEAD is UNMOVED after the refusal')
  assert.equal(r.git('rev-parse', branch), preHead, 'the branch ref is unmoved too')
  assert.equal(r.tree(r.head()), preTree)
  assert.deepEqual(r.rangeShas(range.base), range.commits.map((c) => c.sha), 'the original granular history is intact')
  assert.equal(r.git('rev-parse', caught.rescueRef), preHead, 'the rescue ref survives the abort, pointing at the original HEAD')
  assert.equal(r.status(), preStatus, 'a refused curation touches neither index nor worktree')
})

test('executeCurate: a sibling session’s untracked + modified-unstaged files survive the squash byte-identical', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  r.commit('seed phase-53 file', 'src/shared.txt')

  r.commit('docs(roadmap): phase 53 — move to in-progress')
  r.commit('feat(cli): phase 53 — 53.1 the executor')
  r.commit('docs(roadmap): phase 53 — record the transparency report')

  const range = deriveCurationRange(r.root, 53)
  assert.equal(range.ok, true, 'fixture bug: the range must derive before it can be curated')
  const preHead = r.head()
  const preTree = r.tree(preHead)

  // The shared checkout as it really is: another session mid-edit.
  const untrackedBytes = Buffer.from('a sibling session’s scratch notes\né—\n', 'utf8')
  r.write('sibling/notes.md', untrackedBytes)
  const modifiedBytes = Buffer.from('another session edited this tracked file and has not staged it\n', 'utf8')
  r.write('src/shared.txt', modifiedBytes)
  const preStatus = r.status()
  const untracked = () => r.git('ls-files', '--others', '--exclude-standard')
  const unstaged = () => r.git('diff', '--name-only')
  assert.equal(untracked(), 'sibling/notes.md', 'fixture: the sibling file must be UNTRACKED')
  assert.equal(unstaged(), 'src/shared.txt', 'fixture: the tracked edit must be MODIFIED-UNSTAGED')
  assert.equal(r.git('diff', '--cached', '--name-only'), '', 'fixture: nothing is staged going in')

  const out = executeCurate(r.root, planFrom(range, [range.commits.length], [
    { subject: 'feat(cli): phase 53 — land the executor', body: 'One curated commit.' },
  ]))

  assert.notEqual(out.tip, preHead, 'the squash really happened — otherwise survival is vacuous')
  assert.deepEqual(r.rangeShas(range.base), [out.tip])
  assert.equal(r.tree(out.tip), preTree)

  // update-ref, not reset --hard: a reset would have reverted src/shared.txt and a stash
  // would have taken both files with it.
  assert.deepEqual(readFileSync(join(r.root, 'sibling', 'notes.md')), untrackedBytes, 'the untracked file is byte-identical')
  assert.deepEqual(readFileSync(join(r.root, 'src', 'shared.txt')), modifiedBytes, 'the unstaged edit is byte-identical')
  assert.equal(untracked(), 'sibling/notes.md', 'the untracked file is still untracked — curation never swept it into a commit')
  assert.equal(unstaged(), 'src/shared.txt', 'the tracked edit is still MODIFIED-UNSTAGED — a reset --hard would have erased it')
  assert.equal(r.status(), preStatus, 'index and worktree state are exactly as the sibling left them')
  assert.equal(r.git('diff', '--cached', '--name-only'), '', 'curation staged nothing on the sibling’s behalf')
})
