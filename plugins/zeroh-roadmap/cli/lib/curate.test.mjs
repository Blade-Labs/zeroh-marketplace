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
 * TEST-FIRST for the evidence argument executeCurate(cwd, plan, evidence) gains in phase
 * 2145.4: a scratch/revert pair is the proof a tripwire actually bit, and the squash makes
 * those SHAs unreachable — so the pair, the squashed count and the landed subjects must be
 * in the phase's gate report BEFORE the rewrite, or the proof dies with the SHAs. That
 * makes the ORDER the property: a gate report that cannot be written aborts the curate
 * with HEAD unmoved and the granular history still there, because history-with-no-evidence
 * is the one outcome nobody can undo. A 2-arg call keeps today's behaviour exactly.
 *
 * TEST-FIRST for composeLandedMessage(phaseRecord, group) (phase 2145.3) at the bottom:
 * the curated message IS the product, so the properties are (a) the subject stays inside
 * git's 72-char subject budget while still carrying `phase N —`, the one boundary every
 * downstream scan (gitscan, gate, derive) greps on, and truncation never severs a word;
 * (b) the type(scope) is the MAJORITY of the work commits the group actually squashed,
 * so the landed commit still says what kind of change it was; (c) the body names EVERY
 * task the group swallowed — after curation those task SHAs are gone, so a title missing
 * from the body is work that vanished from history.
 *
 * Real seeded git repos (execFileSync git, never a shell string), the makeRepo idiom from
 * cli/commands/gate.test.mjs — the em-dash boundary and revert pairing only mean anything
 * against a real git. The composer is pure, so its records are built inline; one case
 * still round-trips a composed subject through a real repo, because "parses with the
 * existing grammar" is only proven by the existing grammar.
 * Run: capbuild node --test cli/lib/curate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { deriveCurationRange } from './curate.mjs'
import * as curate from './curate.mjs'
import { writeReport, latestReport, gateDir } from './gate-report.mjs'

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
// 2145.3 lands composeLandedMessage — same lazy guard, same reason.
const composeLandedMessage = (...args) => {
  assert.equal(
    typeof curate.composeLandedMessage,
    'function',
    'curate.mjs must export composeLandedMessage(phaseRecord, group)',
  )
  return curate.composeLandedMessage(...args)
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

/**
 * The green gate report a phase already has by the time curation runs — curation edits the
 * LATEST report, it never opens a new gate run.
 */
function seedGateReport(toplevel, phase) {
  return writeReport(toplevel, {
    phase,
    startedAt: '2026-08-11T10:00:00.000Z',
    baseSha: 'seeded',
    mode: 'phase',
    kind: 'logic',
    testScope: { derived: 'relevant', declared: null, effective: 'relevant' },
    reviewScope: { derived: 'full', declared: null, effective: 'full' },
    slots: [{ slot: 'types', command: 'npm run type-check', exitCode: 0, durationMs: 12, logPath: null }],
    agents: [{ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: '0 findings', recordedAt: '2026-08-11T10:05:00.000Z' }],
    green: true,
    notes: [],
  })
}

/** Run files under a phase's gate dir — curation must not add one. */
const runFileCount = (toplevel, phase) => readdirSync(gateDir(toplevel, phase)).filter((f) => f.endsWith('.json')).length

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

test('anchoring + the batch grammar: a quoted mention stays foreign, a batch step commit is the phase\u2019s own', () => {
  const r = makeRepo()
  r.commit('docs(roadmap): phase 93 \u2014 move to in-progress')
  r.commit('feat(cli): phase 93 \u2014 93.1 the real task')
  r.commit('chore(repo): phase 93 task 93.2 (1/3) \u2014 a batch step lands')
  const quoted = r.commit('docs(skills): document the "phase 93 \u2014 <desc>" commit grammar')
  const out = deriveCurationRange(r.root, 93)
  assert.equal(out.ok, false, 'a subject that merely QUOTES the grammar mid-sentence must refuse the range')
  assert.deepEqual(
    out.foreign.map((f) => f.sha),
    [quoted],
    'exactly the quoting commit is foreign \u2014 the batch-grammar step commit is the phase\u2019s own work',
  )
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

// ── executeCurate + evidence: the curation record (2145.4) ───────────────────────────

test('executeCurate: with evidence, the curation block lands in the phase’s LATEST gate report', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  r.commit('seed phase-60 file')

  r.commit('docs(roadmap): phase 60 — move to in-progress')
  r.commit('feat(cli): phase 60 — 60.1 the range')
  const scratch = r.commit('scratch(cli): phase 60 — prove the foreign tripwire bites')
  const revert = r.revert(scratch)
  r.commit('feat(cli): phase 60 — 60.2 the executor')
  r.commit('fix(cli): phase 60 gate R0 — quality-pass findings')
  r.commit('docs(roadmap): phase 60 — record the transparency report')

  const range = deriveCurationRange(r.root, 60)
  assert.equal(range.ok, true, 'fixture bug: the range must derive before it can be curated')
  assert.equal(range.commits.length, 7)
  const preTree = r.tree(r.head())
  const messages = [
    { subject: 'feat(cli): phase 60 — derive the curation range', body: 'The base and the walk.' },
    { subject: 'feat(cli): phase 60 — squash the range losslessly', body: 'commit-tree plus update-ref.' },
    { subject: 'feat(cli): phase 60 — record the curation evidence', body: 'The gate report keeps the proof.' },
  ]
  const plan = planFrom(range, [3, 2, 2], messages)
  const { path: reportPath } = seedGateReport(r.root, 60)
  const redProofs = [{ scratch, revert, subject: r.subject(scratch) }]

  const out = executeCurate(r.root, plan, { toplevel: r.root, phase: 60, redProofs })

  // The curate itself is unchanged by carrying evidence.
  assert.equal(r.tree(out.tip), preTree, 'the curated tip is still tree-identical to the pre-curation HEAD')
  assert.equal(r.rangeShas(range.base).length, 3, 'the three-group plan still landed three commits')

  const latest = latestReport(r.root, 60)
  assert.ok(latest, 'the phase report must still be readable after curation')
  assert.equal(latest.path, reportPath, 'the SAME report was amended — curation does not open a new gate run')
  assert.equal(runFileCount(r.root, 60), 1, 'no new run file')
  assert.ok(latest.report.curation, 'the latest gate report must carry the curation block')
  // 7 commits swallowed by 3 groups: an implementation that recorded the GROUP count (3) or
  // the landed-subject count would pass a laxer assertion than this one.
  assert.equal(
    latest.report.curation.squashedCount,
    7,
    'squashedCount is every commit the plan swallowed, not the number of groups',
  )
  assert.deepEqual(
    latest.report.curation.landedSubjects,
    messages.map((m) => m.subject),
    'the landed subjects are recorded in plan order — the report is how anyone maps the old range onto the new commits',
  )
  assert.deepEqual(latest.report.curation.redProofs, redProofs, 'the scratch/revert pair is recorded verbatim')
  assert.equal(latest.report.agents.length, 1, 'the gate rounds already in the report survive the curation write')
  assert.equal(latest.report.green, true)

  // Why the block exists at all: those SHAs are gone now, so the report is their only record.
  const reachable = r.git('rev-list', 'HEAD').split('\n')
  assert.ok(!reachable.includes(scratch), 'the scratch commit is unreachable from HEAD after the squash')
  assert.ok(!reachable.includes(revert), 'so is its revert — the RED proof survives only in the gate report')
  assert.ok(
    !r.git('log', '--format=%s', `${range.base}..HEAD`).includes('prove the foreign tripwire bites'),
    'the curated history no longer narrates the scratch pair',
  )
})

test('executeCurate: a gate report that cannot be written ABORTS — evidence before surgery', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  r.commit('seed phase-61 file')

  r.commit('docs(roadmap): phase 61 — move to in-progress')
  r.commit('feat(cli): phase 61 — 61.1 the range')
  const scratch = r.commit('scratch(cli): phase 61 — prove the tripwire bites')
  const revert = r.revert(scratch)
  r.commit('feat(cli): phase 61 — 61.2 the executor')
  r.commit('docs(roadmap): phase 61 — record the transparency report')

  const range = deriveCurationRange(r.root, 61)
  assert.equal(range.ok, true, 'fixture bug: the range must derive before it can be curated')
  const preHead = r.head()
  const preTree = r.tree(preHead)
  const preShas = range.commits.map((c) => c.sha)
  const branch = r.git('rev-parse', '--abbrev-ref', 'HEAD')
  const plan = planFrom(range, [range.commits.length], [
    { subject: 'feat(cli): phase 61 — land the executor', body: 'One curated commit.' },
  ])
  // No gate report for phase 61: the evidence has nowhere to go.
  assert.equal(latestReport(r.root, 61), null, 'fixture: the phase must have no gate report')

  let caught = null
  try {
    executeCurate(r.root, plan, { toplevel: r.root, phase: 61, redProofs: [{ scratch, revert, subject: r.subject(scratch) }] })
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err // the missing-export guard, not the refusal
    caught = err
  }

  assert.ok(caught, 'unrecordable evidence must ABORT the curate — a squash whose proof was never written is unrecoverable')
  assert.match(caught.message, /report/i, 'the abort names the gate report as the reason')

  assert.equal(r.head(), preHead, 'HEAD is UNMOVED — the evidence write happens BEFORE any ref surgery')
  assert.equal(r.git('rev-parse', branch), preHead, 'the branch ref is unmoved too')
  assert.equal(r.tree(r.head()), preTree)
  assert.deepEqual(r.rangeShas(range.base), preShas, 'the original granular history is intact, commit for commit')
  assert.ok(r.git('rev-list', 'HEAD').split('\n').includes(scratch), 'the scratch commit is still reachable — nothing was rewritten')
})

test('executeCurate: an UNWRITABLE gate report aborts too, with no partial evidence and history intact', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  r.commit('seed phase-62 file')

  r.commit('docs(roadmap): phase 62 — move to in-progress')
  r.commit('feat(cli): phase 62 — 62.1 the range')
  r.commit('feat(cli): phase 62 — 62.2 the executor')
  r.commit('docs(roadmap): phase 62 — record the transparency report')

  const range = deriveCurationRange(r.root, 62)
  assert.equal(range.ok, true, 'fixture bug: the range must derive before it can be curated')
  const preHead = r.head()
  const preTree = r.tree(preHead)
  const preShas = range.commits.map((c) => c.sha)
  const branch = r.git('rev-parse', '--abbrev-ref', 'HEAD')
  const plan = planFrom(range, [range.commits.length], [
    { subject: 'feat(cli): phase 62 — land the executor', body: 'One curated commit.' },
  ])

  const { path: reportPath } = seedGateReport(r.root, 62)
  const dir = gateDir(r.root, 62)
  // Read-only report AND read-only dir: an in-place write and a write-temp-then-rename
  // both fail, so the test does not silently depend on which one the writer picked.
  chmodSync(reportPath, 0o444)
  chmodSync(dir, 0o555)

  let caught = null
  try {
    executeCurate(r.root, plan, { toplevel: r.root, phase: 62, redProofs: [] })
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err
    caught = err
  } finally {
    chmodSync(dir, 0o755)
    chmodSync(reportPath, 0o644)
  }

  assert.ok(caught, 'an unwritable gate report must abort the curate before it rewrites anything')
  assert.equal(r.head(), preHead, 'HEAD is UNMOVED')
  assert.equal(r.git('rev-parse', branch), preHead)
  assert.equal(r.tree(r.head()), preTree)
  assert.deepEqual(r.rangeShas(range.base), preShas, 'the original granular history is intact')
  assert.equal(latestReport(r.root, 62).report.curation, undefined, 'no half-written curation block was left behind')
  assert.equal(runFileCount(r.root, 62), 1, 'and no second run file was invented to route around the failure')
})

test('executeCurate: a 2-arg call curates exactly as before and records NO curation block', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  r.commit('seed phase-63 file')

  r.commit('docs(roadmap): phase 63 — move to in-progress')
  r.commit('feat(cli): phase 63 — 63.1 the executor')
  r.commit('docs(roadmap): phase 63 — record the transparency report')

  const range = deriveCurationRange(r.root, 63)
  assert.equal(range.ok, true, 'fixture bug: the range must derive before it can be curated')
  const preHead = r.head()
  const preTree = r.tree(preHead)
  const { path: reportPath } = seedGateReport(r.root, 63)

  const out = executeCurate(r.root, planFrom(range, [range.commits.length], [
    { subject: 'feat(cli): phase 63 — land the executor', body: 'One curated commit.' },
  ]))

  assert.deepEqual(r.rangeShas(range.base), [out.tip], 'the un-evidenced curate behaves exactly as it does today')
  assert.equal(r.tree(out.tip), preTree)
  assert.notEqual(out.tip, preHead)
  assert.equal(r.git('rev-parse', out.rescueRef), preHead)
  const latest = latestReport(r.root, 63)
  assert.equal(latest.path, reportPath)
  assert.equal(latest.report.curation, undefined, 'no caller evidence means no block — a fabricated one would be invented evidence')
})

// ── composeLandedMessage: the landed message (2145.3) ────────────────────────────────

/** git's own subject budget — the number every one of these subjects must live inside. */
const SUBJECT_MAX = 72

/**
 * A group as deriveCurationRange hands it over: [subject, kind] pairs, synthetic SHAs.
 * The composer is pure, so nothing here needs a repo — but the kinds are real, because
 * "majority over the TASK/GATE-FIX commits" is only testable if state and scratch rows
 * are present to be ignored.
 */
function groupOf(rows) {
  return {
    commits: rows.map(([subject, kind], i) => ({ sha: String(i + 1).padStart(40, 'a'), subject, kind })),
  }
}

/** Everything after the `phase N —` boundary: the summary the composer derived. */
function summaryOf(subject, phaseNum) {
  const dash = `phase ${phaseNum} —`
  const at = subject.indexOf(dash)
  assert.ok(at >= 0, `the subject must carry the "${dash}" boundary every downstream scan greps on, got: ${subject}`)
  return subject.slice(at + dash.length).trim()
}

/** The trailer test's currency — git reads trailers from the end of the message. */
function lastNonEmptyLine(body) {
  const line = body.split('\n').reverse().find((l) => l.trim() !== '')
  assert.ok(line !== undefined, 'the body must not be empty')
  return line
}

/**
 * Assert the composed subject is a landed subject: inside the budget, one line, and
 * carrying the em-dash boundary for phase N.
 */
function assertSubjectShape(subject, phaseNum) {
  assert.equal(typeof subject, 'string')
  assert.ok(!subject.includes('\n'), 'the subject is ONE line — executeCurate joins it to the body with a blank line')
  assert.ok(
    subject.length <= SUBJECT_MAX,
    `the subject must fit git's ${SUBJECT_MAX}-char budget, got ${subject.length}: ${subject}`,
  )
  assert.match(subject, /^[a-z]+\([a-z0-9-]+\): phase \d+ — \S/, 'type(scope): phase N — summary')
  assert.equal(subject, subject.trim(), 'no leading/trailing whitespace — a truncation must not leave the space it cut on')
  assert.ok(!subject.includes('  '), `no doubled spaces in the subject: ${subject}`)
  summaryOf(subject, phaseNum)
}

test('composeLandedMessage: the subject takes the MAJORITY type(scope) of the WORK commits and reads as phase grammar', () => {
  // fix(cli) is the majority only if state commits do not vote: docs(roadmap) is 3 rows
  // (a tie with fix on type, and the FIRST occurrence on scope), so an implementation
  // that counted every commit would land docs(roadmap) here.
  const group = groupOf([
    ['docs(roadmap): phase 70 — move to in-progress', 'state'],
    ['feat(cli): phase 70 — 70.1 derive the curation range', 'task'],
    ['fix(web): phase 70 — 70.2 the console lane', 'task'],
    ['scratch(web): phase 70 — prove the foreign tripwire bites', 'scratch'],
    ['Revert "scratch(web): phase 70 — prove the foreign tripwire bites"', 'scratch'],
    ['fix(cli): phase 70 gate R0 — quality-pass findings', 'gate-fix'],
    ['fix(cli): phase 70 gate R1 — code-review findings', 'gate-fix'],
    ['docs(roadmap): phase 70 — record the transparency report', 'state'],
    ['docs(roadmap): phase 70 — move to done', 'state'],
  ])
  const phaseRecord = {
    phase: 70,
    name: 'Squash the phase into landed history',
    tasks: [
      { id: '70.1', title: 'Derive the curation range', transparencyReport: { whatWasDone: 'walked base..HEAD', compromises: 'None' } },
      { id: '70.2', title: 'The console lane', transparencyReport: { whatWasDone: 'wired the lane', compromises: 'None' } },
    ],
  }

  const out = composeLandedMessage(phaseRecord, group)

  assert.deepEqual(Object.keys(out).sort(), ['body', 'subject'], 'the composer returns exactly subject + body')
  assertSubjectShape(out.subject, 70)
  assert.ok(
    out.subject.startsWith('fix(cli): phase 70 — '),
    `type and scope are each the majority over task+gate-fix commits (fix 3:1, cli 3:1), got: ${out.subject}`,
  )
  // The summary is derived from the phase NAME, not a constant: its tail survives verbatim
  // at this length (21 prefix chars + a 36-char name is well inside the budget).
  assert.ok(
    out.subject.includes('landed history'),
    `the summary must come from phaseRecord.name, got: ${out.subject}`,
  )
})

test('composeLandedMessage: type/scope ties break by FIRST occurrence, and unparseable prefixes never vote', () => {
  const group = groupOf([
    ['refactor(gate): phase 72 — 72.1 lift the report writer', 'task'],
    ['feat(gate): phase 72 — 72.2 the new lane', 'task'],
    ['merged develop into the phase branch', 'task'], // no conventional prefix → no vote
    ['scratch(web): phase 72 — prove the tripwire bites', 'scratch'],
    ['Revert "scratch(web): phase 72 — prove the tripwire bites"', 'scratch'],
    ['feat(web): phase 72 — 72.3 the console row', 'task'],
  ])
  const phaseRecord = {
    phase: 72,
    name: 'Lift the gate report writer',
    tasks: [
      { id: '72.1', title: 'Lift the report writer' },
      { id: '72.2', title: 'The new lane' },
      { id: '72.3', title: 'The console row' },
    ],
  }

  const out = composeLandedMessage(phaseRecord, group)

  assertSubjectShape(out.subject, 72)
  // type: refactor 1, feat 2 → feat outright. scope: gate 2, web 1 → gate outright.
  // Neither the merge line nor the scratch/revert pair may vote: if the scratch pair's
  // `scratch(web)` counted, web would reach 3 and BEAT gate — scratch commits are proof
  // of a tripwire, never a statement about what the phase changed.
  assert.ok(
    out.subject.startsWith('feat(gate): phase 72 — '),
    `majority type + majority scope, votes only from parseable work prefixes, got: ${out.subject}`,
  )

  // A genuine tie: feat 2 : fix 2, feat first → feat. Scope cli 2 : api 2, cli first → cli.
  const tie = groupOf([
    ['feat(cli): phase 72 — 72.1 the first', 'task'],
    ['fix(api): phase 72 — 72.2 the second', 'task'],
    ['fix(api): phase 72 gate R0 — quality-pass findings', 'gate-fix'],
    ['feat(cli): phase 72 — 72.3 the third', 'task'],
  ])
  const tied = composeLandedMessage(phaseRecord, tie)
  assertSubjectShape(tied.subject, 72)
  assert.ok(
    tied.subject.startsWith('feat(cli): phase 72 — '),
    `a 2:2 tie breaks to the FIRST occurrence, got: ${tied.subject}`,
  )
})

test('composeLandedMessage: a 62-word phase name truncates at a WORD boundary, ≤72 chars, em dash intact', () => {
  const rest =
    'irreproachably readable landed commit messages from the phase record and the '
    + 'squashed commit group, deriving the majority type and scope from the commit '
    + 'subjects themselves, an imperative summary from the phase name, and a body '
    + 'enumerating every task title, transparency report, and compromise the phase '
    + 'recorded, because after curation those granular commits become unreachable '
    + 'archaeology nobody can run again'
  // THREE heads of length L, L+1, L+3: the same char offset falls mid-word in at least
  // one of them for every cut position 36..58, so a naive slice-at-N truncation cannot
  // get lucky on all three the way it can on a single fixture.
  const names = [
    `The composer assembling ${rest}`,
    `The composers assembling ${rest}`,
    `The subcomposer assembling ${rest}`,
  ]
  const group = groupOf([
    ['feat(cli): phase 73 — 73.1 compose the landed message', 'task'],
    ['feat(cli): phase 73 gate R0 — quality-pass findings', 'gate-fix'],
  ])

  for (const name of names) {
    const tokens = name.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g)
    const words = new Set(tokens)
    assert.ok(tokens.length >= 60, `fixture bug: the name must be long enough to force truncation (${tokens.length} words)`)
    const phaseRecord = { phase: 73, name, tasks: [{ id: '73.1', title: 'Compose the landed message' }] }

    const out = composeLandedMessage(phaseRecord, group)

    assertSubjectShape(out.subject, 73) // carries the ≤72 and `phase 73 —` assertions
    const summary = summaryOf(out.subject, 73)
    assert.ok(summary.length > 0, 'truncation must not eat the whole summary')
    assert.ok(
      out.subject.length > 55,
      `a 62-word name must FILL the subject rather than collapse to a stub, got ${out.subject.length}: ${out.subject}`,
    )
    // Word boundary: strip an optional trailing ellipsis/punctuation, then the final token
    // must be a WHOLE word of the phase name — a mid-word cut leaves a fragment that is not.
    const tail = summary.replace(/[….]+$/u, '').trim().split(/\s+/).at(-1).replace(/[^a-z0-9'-]+$/iu, '').toLowerCase()
    assert.ok(
      words.has(tail),
      `truncation must land on a word boundary — "${tail}" is not a whole word of the phase name (${out.subject})`,
    )
    // Imperative: the pinned, mechanically checkable subset is that the summary does not
    // open with an article — "The composer assembling…" is a label, not an instruction.
    assert.doesNotMatch(summary, /^(the|a|an)\s/i, `the summary must read imperative, got: ${summary}`)
  }
})

test('composeLandedMessage: a composed subject re-derives as the phase’s OWN commit through deriveCurationRange', () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  const preBase = r.commit('seed phase-74 file')

  const group = groupOf([
    ['feat(cli): phase 74 — 74.1 derive the range', 'task'],
    ['fix(cli): phase 74 gate R0 — quality-pass findings', 'gate-fix'],
  ])
  const phaseRecord = {
    phase: 74,
    name: 'Curate a phase into landed history',
    tasks: [{ id: '74.1', title: 'Derive the range', transparencyReport: { whatWasDone: 'walked the range', compromises: 'None' } }],
  }

  const out = composeLandedMessage(phaseRecord, group)
  const landed = r.commit(out.subject)

  // One grammar, not two: the composed subject must survive the SAME scan that built the
  // range, or a curated phase becomes unresumable/foreign to its own tooling.
  const res = deriveCurationRange(r.root, 74)
  assert.equal(res.ok, true, `a curated commit must not read as foreign to its own phase: ${out.subject}`)
  assert.equal(res.base, preBase)
  assert.deepEqual(res.commits.map((c) => c.sha), [landed])
  assert.equal(res.commits[0].kind, 'task', 'a landed work commit classifies as the phase’s own work')
  assert.equal(r.subject(landed), out.subject, 'git kept the subject verbatim — no wrap, no truncation on its side')
})

test('composeLandedMessage: the body names every squashed task + whatWasDone; a "None" compromise contributes no line', () => {
  // Every fixture string is short on purpose: the assertions are about PRESENCE, and a
  // body wrapper must not be able to split them mid-string.
  const phaseRecord = {
    phase: 75,
    name: 'Land the curated history',
    tasks: [
      {
        id: '75.1',
        title: 'Derive the curation range',
        transparencyReport: {
          whatWasDone: 'walked base..HEAD oldest-first',
          compromises: 'None',
          skipped: 'nothing skipped here',
          hardcoded: 'the em-dash boundary string',
          limitations: 'single-branch ranges only',
        },
      },
      {
        id: '75.2',
        title: 'Squash the range losslessly',
        transparencyReport: {
          whatWasDone: 'commit-tree plus update-ref',
          compromises: 'reused the gate rescue-ref naming',
          skipped: 'no reflog pruning',
          hardcoded: 'the rescue ref prefix',
          limitations: 'no octopus merges',
        },
      },
      { id: '75.3', title: 'A task that filed no report' }, // no transparencyReport at all
    ],
  }
  const group = groupOf([
    ['docs(roadmap): phase 75 — move to in-progress', 'state'],
    ['feat(cli): phase 75 — 75.1 derive the curation range', 'task'],
    ['feat(cli): phase 75 — 75.2 squash the range losslessly', 'task'],
    ['feat(cli): phase 75 — 75.3 a task that filed no report', 'task'],
    ['fix(cli): phase 75 gate R0 — quality-pass findings', 'gate-fix'],
  ])

  const out = composeLandedMessage(phaseRecord, group)

  // Nothing lands unlisted: after curation the task SHAs are gone, so a title absent from
  // the body is work that disappeared from history.
  for (const t of phaseRecord.tasks) {
    assert.ok(out.body.includes(t.title), `the body must name task ${t.id} ("${t.title}"), got:\n${out.body}`)
  }
  assert.ok(out.body.includes('walked base..HEAD oldest-first'), '75.1 whatWasDone must be in the body')
  assert.ok(out.body.includes('commit-tree plus update-ref'), '75.2 whatWasDone must be in the body')
  assert.ok(out.body.includes('reused the gate rescue-ref naming'), 'a REAL compromise must survive into the landed body')
  // 'None' is the only occurrence of that token anywhere in the fixture, so its absence is
  // exactly the "a None compromise contributes no line" rule.
  assert.ok(
    !/none/i.test(out.body),
    `a compromises value of "None" must contribute NO line, got:\n${out.body}`,
  )
})

test('composeLandedMessage: a multi-group split lists only ITS group’s tasks, matched on the N.x token (76.1 ≠ 76.10)', () => {
  const phaseRecord = {
    phase: 76,
    name: 'Split the phase across landed commits',
    tasks: [
      { id: '76.1', title: 'The excluded first task', transparencyReport: { whatWasDone: 'excluded groundwork', compromises: 'None' } },
      { id: '76.2', title: 'The included second task', transparencyReport: { whatWasDone: 'included groundwork', compromises: 'None' } },
      { id: '76.3', title: 'The included third task', transparencyReport: { whatWasDone: 'included follow-through', compromises: 'None' } },
      { id: '76.4', title: 'The other excluded task', transparencyReport: { whatWasDone: 'excluded follow-through', compromises: 'None' } },
      { id: '76.10', title: 'The included tenth task', transparencyReport: { whatWasDone: 'included tenth work', compromises: 'None' } },
    ],
  }
  // 76.10 is in the group and 76.1 is NOT: a prefix match on "76.1" would drag the first
  // task's title into a commit that never contained its work.
  const group = groupOf([
    ['feat(cli): phase 76 — 76.2 the included second task', 'task'],
    ['feat(cli): phase 76 — 76.3 the included third task', 'task'],
    ['feat(cli): phase 76 — 76.10 the included tenth task', 'task'],
    ['fix(cli): phase 76 gate R0 — quality-pass findings', 'gate-fix'],
  ])

  const out = composeLandedMessage(phaseRecord, group)

  for (const id of ['76.2', '76.3', '76.10']) {
    const t = phaseRecord.tasks.find((x) => x.id === id)
    assert.ok(out.body.includes(t.title), `task ${id} is in the group and must be named, got:\n${out.body}`)
    assert.ok(out.body.includes(t.transparencyReport.whatWasDone), `task ${id}'s whatWasDone must be in the body`)
  }
  for (const id of ['76.1', '76.4']) {
    const t = phaseRecord.tasks.find((x) => x.id === id)
    assert.ok(
      !out.body.includes(t.title),
      `task ${id} has no commit in this group — claiming it would attribute work to the wrong commit, got:\n${out.body}`,
    )
    assert.ok(!out.body.includes(t.transparencyReport.whatWasDone), `task ${id}'s whatWasDone belongs to another group`)
  }
})

test('composeLandedMessage: the Co-Authored-By trailer is the LAST non-empty line, exactly once', () => {
  const phaseRecord = {
    phase: 77,
    name: 'Preserve the co-author trailer',
    tasks: [
      { id: '77.1', title: 'First task', transparencyReport: { whatWasDone: 'did the first thing', compromises: 'None' } },
      { id: '77.2', title: 'Second task', transparencyReport: { whatWasDone: 'did the second thing', compromises: 'a real compromise here' } },
    ],
  }
  const group = groupOf([
    ['feat(cli): phase 77 — 77.1 first task', 'task'],
    ['feat(cli): phase 77 — 77.2 second task', 'task'],
  ])

  const out = composeLandedMessage(phaseRecord, group)

  const lines = out.body.split('\n')
  const trailers = lines.filter((l) => l.startsWith('Co-Authored-By:'))
  assert.equal(trailers.length, 1, `exactly one Co-Authored-By trailer, not one per squashed task, got ${trailers.length}`)
  assert.match(trailers[0], /^Co-Authored-By: .+ <[^ >]+@[^ >]+>$/, 'the trailer keeps git\'s name <email> shape')
  assert.equal(lastNonEmptyLine(out.body), trailers[0], 'the trailer is the LAST non-empty line — git only reads trailers at the end')
  assert.ok(lines.indexOf(trailers[0]) > 0, 'the trailer follows the body content, it is not the whole body')
  assert.ok(out.body.includes('did the second thing'), 'the trailer rule must not have swallowed the content')
})
