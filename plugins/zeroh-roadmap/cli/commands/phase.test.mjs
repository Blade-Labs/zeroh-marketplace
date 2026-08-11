#!/usr/bin/env node
/**
 * TEST-FIRST for `roadmap phase start <N>` (cli/commands/phase.mjs today implements
 * only `validate`; `start` is a not-yet-implemented stub → RED until it lands). The
 * thin status→in-progress convenience: flip the phase file's FIRST `status:` match,
 * commit it with the canonical move-to-in-progress subject, and stamp an
 * executor-start beacon. The move-commit subject is LOAD-BEARING: cli/lib/gitscan.mjs
 * derivePhaseStartSha keys its Tier-1 (newest-move-commit) base derivation off it, so
 * this suite asserts the cross-contract directly.
 *
 * Seeded tmp git repos (execFileSync git, never a shell string) driven through the
 * REAL bin/roadmap.mjs — the makeRepo idiom from cli/commands/gate.test.mjs. Run:
 *   capbuild node --test cli/commands/phase.test.mjs
 *
 * TEST-FIRST for `roadmap phase curate <N>` (phase 2145.5; runCurate does not exist yet
 * → RED until it lands) at the bottom. Curation REWRITES history, so the properties are
 * the ones a destructive tool has to earn: it shows its hand FIRST (the default is a dry
 * run that prints the base, every classified commit, the group boundaries and the exact
 * messages it would land, with HEAD byte-identical afterwards), the hand it showed is
 * the hand it plays (--apply lands precisely the subjects the dry run printed), the
 * group split is by TASK ID rather than commit position (non-task commits fold into the
 * nearest preceding task, so a gate fix lands with the task it fixed), and every refusal
 * — a foreign interleave, an over-wide --groups spec — happens BEFORE any ref moves and
 * names what it refused on. Exercised through the injectable impl (the landArc house
 * pattern: cli/lib/landing.mjs landArc + a thin CLI wrapper), with loadPhase injected so
 * a fixture never needs tsx, and out/err captured so the printed plan is assertable.
 *
 * TEST-FIRST for `roadmap phase land <N>` (phase 2146.4; runLand does not exist yet → RED until
 * it lands) at the bottom. Land is the worktree lane's exit door: curate the phase's granular
 * history in the WORKTREE, then move those 1-3 curated commits onto the integration branch. Its
 * invariants are the ones a one-way door owes: it REFUSES under executionIsolation 'primary'
 * (landing is a worktree-lane act, and an absent knob reads primary — fail closed) with nothing
 * moved; the base ref it advances comes from the CONSUMER's mergePolicy.autonomousPushRefs[0]
 * (the fixtures name that ref 'integration' precisely so a hardcoded 'develop' cannot pass) with
 * 'develop' only as the documented fallback; it goes THROUGH curate --apply, so the integration
 * branch gains exactly ONE curated commit and the gate report carries the curation evidence; and
 * when curate refuses (no gate report — evidence before surgery) the base ref never moves and the
 * granular history survives for a retry.
 *
 * PINNED for the implementer: a worktree-executed phase reads and writes its gate reports under
 * the WORKTREE's own toplevel — runLand is handed cwd === toplevel === the worktree dir (which is
 * what gitToplevel returns inside a linked worktree, and the worktree carries the whole roadmap
 * tree). Push is out of scope for the fixtures: they have no origin remote, so a land that
 * completes locally is a pass.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { derivePhaseStartSha } from '../lib/gitscan.mjs'
import { deriveCurationRange, composeLandedMessage } from '../lib/curate.mjs'
import { writeReport, latestReport } from '../lib/gate-report.mjs'
import { ensureWorktree } from '../lib/worktree.mjs'
import * as phaseCmd from './phase.mjs'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

/** A git repo with a roadmap/phases/ dir and a root commit (so every later commit has a parent). */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'zr-phase-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  const git = (...a) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })
  git('init', '-q')
  writeFileSync(join(root, '.gitkeep'), '')
  git('add', '.gitkeep')
  git('commit', '-q', '-m', 'root')
  return { root, git }
}

const phaseFile = (root, n) => join(root, 'roadmap', 'phases', `phase-${n}.phase.ts`)

/** Write a phase-<n>.phase.ts fixture and commit it in its own seed commit; returns the HEAD sha. */
function seedPhase(root, git, n, body) {
  writeFileSync(phaseFile(root, n), body)
  git('add', join('roadmap', 'phases', `phase-${n}.phase.ts`))
  git('commit', '-q', '-m', `seed phase-${n} file`)
  return git('rev-parse', 'HEAD').trim()
}

/** A backlog phase carrying a DECOY `status: 'backlog'` inside a notes string (must survive the flip). */
const backlogWithDecoy = (n) =>
  [
    'export default {',
    `  phase: ${n},`,
    "  status: 'backlog',",
    "  arcId: 'PHZ',",
    `  notes: "an earlier note said status: 'backlog' verbatim — keep it",`,
    '}',
    '',
  ].join('\n')

const phaseStart = (root, ...args) =>
  spawnSync('node', [BIN, 'phase', 'start', ...args], { cwd: root, encoding: 'utf8' })

// ── the happy path ────────────────────────────────────────────────────────────────

test('phase start — flips the FIRST status backlog→in-progress and leaves the notes-string decoy untouched', () => {
  const { root, git } = makeRepo()
  seedPhase(root, git, 4001, backlogWithDecoy(4001))

  const res = phaseStart(root, '4001')
  assert.equal(res.status, 0, `phase start must exit 0; stderr:\n${res.stderr}`)

  const after = readFileSync(phaseFile(root, 4001), 'utf8')
  const first = after.match(/status:\s*'([a-z-]+)'/)
  assert.ok(first, 'a status field remains after the flip')
  assert.equal(first[1], 'in-progress', 'the FIRST status: match is what flips')
  assert.equal((after.match(/status: 'in-progress'/g) || []).length, 1, 'exactly ONE status flipped (not a global replace)')
  assert.ok(
    after.includes("status: 'backlog' verbatim"),
    `the decoy status literal inside notes must be untouched (first-match-only); got:\n${after}`,
  )
})

test("phase start — a status literal in the DOC-COMMENT header never shadows the field (phase 1787 false refusal)", () => {
  const { root, git } = makeRepo()
  seedPhase(
    root,
    git,
    4008,
    [
      '/**',
      " * Earlier this arc was status:'suspended' while the base rework landed — prose only.",
      ' */',
      'export const phase = definePhase({',
      '  phase: 4008,',
      "  status: 'backlog',",
      "  arcId: 'PHZ',",
      '})',
      'function definePhase(x) { return x }',
      'export default phase',
      '',
    ].join('\n'),
  )
  const res = phaseStart(root, '4008')
  assert.equal(res.status, 0, `phase start must flip the FIELD, not refuse on doc-comment prose; stderr:\n${res.stderr}`)
  const after = readFileSync(phaseFile(root, 4008), 'utf8')
  assert.ok(after.includes("status: 'in-progress'"), 'the field flipped')
  assert.ok(after.includes("status:'suspended'"), 'the doc-comment prose is untouched')
})

test('phase start — commits the flip with the canonical move-to-in-progress subject', () => {
  const { root, git } = makeRepo()
  seedPhase(root, git, 4002, backlogWithDecoy(4002))

  const res = phaseStart(root, '4002')
  assert.equal(res.status, 0, `phase start must exit 0; stderr:\n${res.stderr}`)
  const subject = git('log', '-1', '--format=%s').trim()
  assert.equal(subject, 'docs(roadmap): phase 4002 — move to in-progress', `unexpected move-commit subject: ${subject}`)
})

test('phase start — stamps an executor-start beacon whose last line carries phase as a JSON number', () => {
  const { root, git } = makeRepo()
  seedPhase(root, git, 4003, backlogWithDecoy(4003))

  const res = phaseStart(root, '4003')
  assert.equal(res.status, 0, `phase start must exit 0; stderr:\n${res.stderr}`)
  const beacon = join(root, '.building', '4003-executor.jsonl')
  assert.ok(existsSync(beacon), `the executor beacon must be written at ${beacon}`)
  const lines = readFileSync(beacon, 'utf8').trim().split('\n').filter(Boolean)
  const last = JSON.parse(lines[lines.length - 1])
  assert.equal(last.event, 'executor-start', 'the last beacon event is executor-start')
  assert.equal(typeof last.phase, 'number', `phase must serialize as a JSON number; got ${typeof last.phase}`)
  assert.equal(last.phase, 4003, 'the beacon names the started phase')
})

// ── the load-bearing cross-contract: derivePhaseStartSha keys off the move-commit ──

test('CROSS-CONTRACT — after start, derivePhaseStartSha resolves to the PARENT of the move-commit (Tier-1 preference)', () => {
  const { root, git } = makeRepo()
  seedPhase(root, git, 4004, backlogWithDecoy(4004))
  // An ANCIENT `phase 4004 —` mention that is NOT a move commit — under the fallback
  // (oldest-match) rule its parent would win; Tier-1 must ignore it in favour of the move.
  writeFileSync(join(root, 'early.txt'), 'early\n')
  git('add', 'early.txt')
  git('commit', '-q', '-m', 'docs: phase 4004 — early mention')
  const moveParent = git('rev-parse', 'HEAD').trim() // parent-to-be of the move commit

  const res = phaseStart(root, '4004')
  assert.equal(res.status, 0, `phase start must exit 0; stderr:\n${res.stderr}`)
  // A later correctly-formed work commit also matches `phase 4004 —`.
  writeFileSync(join(root, 'work.txt'), 'work\n')
  git('add', 'work.txt')
  git('commit', '-q', '-m', 'feat(x): phase 4004 — 4004.1 something')

  assert.equal(
    derivePhaseStartSha(root, 4004),
    moveParent,
    'the base is the parent of the NEWEST move-to-in-progress commit, never the ancient mention',
  )
})

// ── refusals + idempotency ──────────────────────────────────────────────────────────

test('phase start — a DONE phase refuses with exit 2, no flip, no new commit', () => {
  const { root, git } = makeRepo()
  const body = ['export default {', '  phase: 4005,', "  status: 'done',", "  arcId: 'PHZ',", '}', ''].join('\n')
  seedPhase(root, git, 4005, body)
  const headBefore = git('rev-parse', 'HEAD').trim()

  const res = phaseStart(root, '4005')
  assert.equal(res.status, 2, `a done phase cannot be restarted → exit 2; stderr:\n${res.stderr}`)
  assert.equal(readFileSync(phaseFile(root, 4005), 'utf8'), body, 'the done phase file is unchanged')
  assert.equal(git('rev-parse', 'HEAD').trim(), headBefore, 'no commit is created on the refusal path')
})

test('phase start — a phase with NO backlog|in-progress status pattern refuses with exit 1', () => {
  const { root, git } = makeRepo()
  const body = ['export default {', '  phase: 4006,', "  arcId: 'PHZ',", '}', ''].join('\n') // no status: field
  seedPhase(root, git, 4006, body)
  const headBefore = git('rev-parse', 'HEAD').trim()

  const res = phaseStart(root, '4006')
  assert.equal(res.status, 1, `a missing flip-source pattern is a usage/malformed error → exit 1; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /status|backlog|in-progress|pattern/i, `stderr must name the missing pattern; got:\n${res.stderr}`)
  assert.equal(git('rev-parse', 'HEAD').trim(), headBefore, 'no commit on the exit-1 path')
})

test('phase start — an already in-progress phase is an idempotent no-op: exit 0, no second flip, no second commit', () => {
  const { root, git } = makeRepo()
  const body = ['export default {', '  phase: 4007,', "  status: 'in-progress',", "  arcId: 'PHZ',", '}', ''].join('\n')
  seedPhase(root, git, 4007, body)
  const headBefore = git('rev-parse', 'HEAD').trim()

  const res = phaseStart(root, '4007')
  assert.equal(res.status, 0, `already in-progress is not an error → exit 0; stderr:\n${res.stderr}`)
  assert.equal(readFileSync(phaseFile(root, 4007), 'utf8'), body, 'no second flip on an already-in-progress phase')
  assert.equal(git('rev-parse', 'HEAD').trim(), headBefore, 'no second move-commit on the idempotent path')
})

test('phase start — a FAILED move-commit reverts the flip and exits 2 (never flipped-but-uncommitted; a retry re-attempts cleanly)', () => {
  const { root, git } = makeRepo()
  const body = backlogWithDecoy(4008)
  seedPhase(root, git, 4008, body)
  const headBefore = git('rev-parse', 'HEAD').trim()
  // A failing pre-commit hook simulates index-lock/hook contention at commit time.
  const hookDir = join(root, '.git', 'hooks')
  mkdirSync(hookDir, { recursive: true })
  writeFileSync(join(hookDir, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })

  const res = phaseStart(root, '4008')
  assert.equal(res.status, 2, `a failed move-commit refuses with exit 2; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /move-commit FAILED.*flip reverted/s, 'stderr names the failure + the revert')
  assert.equal(readFileSync(phaseFile(root, 4008), 'utf8'), body, 'the flip is REVERTED — never flipped-but-uncommitted')
  assert.equal(git('rev-parse', 'HEAD').trim(), headBefore, 'no commit landed')
  assert.equal(existsSync(join(root, '.building', '4008-executor.jsonl')), false, 'no beacon on the failure path')

  // The retry (hook removed) re-attempts CLEANLY — the 1702-class silent no-op is impossible.
  rmSync(join(hookDir, 'pre-commit'))
  const retry = phaseStart(root, '4008')
  assert.equal(retry.status, 0, `the retry lands; stderr:\n${retry.stderr}`)
  assert.match(readFileSync(phaseFile(root, 4008), 'utf8'), /status: 'in-progress'/, 'retry flips')
  assert.match(git('log', '-1', '--format=%s').trim(), /^docs\(roadmap\): phase 4008 — move to in-progress$/, 'retry lands the move-commit')
})

// ── roadmap phase curate <N> (2145.5) ───────────────────────────────────────────────

// runCurate lands with 2145.5. Resolving it lazily off the namespace (not as a static
// named import) keeps the missing export a per-test RED instead of a link-time
// SyntaxError that would stop every `phase start` test above from running at all.
const runCurate = (opts) => {
  assert.equal(
    typeof phaseCmd.runCurate,
    'function',
    'cli/commands/phase.mjs must export runCurate({ cwd, toplevel, phaseNum, apply, groupsSpec, loadPhase, out, err })',
  )
  return phaseCmd.runCurate(opts)
}

/** A minimal writable seam: runCurate writes its plan through out/err, so tests read it back. */
function sink() {
  const chunks = []
  return {
    write(s) {
      chunks.push(String(s))
      return true
    },
    get text() {
      return chunks.join('')
    },
  }
}

/** Seed the minimal green gate report an --apply requires: the ritual runs curate AFTER
 *  the gate, so evidence-before-surgery needs a report to land in. */
function seedGateReport(toplevel, phase) {
  writeReport(toplevel, {
    phase,
    startedAt: new Date().toISOString(),
    baseSha: 'fixture',
    mode: 'inline',
    kind: 'logic',
    testScope: { derived: 'relevant', declared: 'relevant', effective: 'relevant' },
    reviewScope: { derived: 'full', declared: 'full', effective: 'full' },
    slots: [],
    green: true,
  })
}

/**
 * A git repo carrying a curatable phase range: root commit, a committed phase file that
 * sits UNDER the base, and the tree/parent archaeology the squash trades in. Kept apart
 * from makeRepo() above because curation runs git commit-tree, which refuses without a
 * repo identity (executeCurate spawns its own git with no -c flags).
 */
function makeCurateRepo(phaseNum) {
  const root = mkdtempSync(join(tmpdir(), 'zr-phase-curate-'))
  bases.push(root)
  const git = (...a) =>
    execFileSync('git', ['-C', root, ...a], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')

  let n = 0
  /** One commit per call; each writes its own file, so no two commits share a tree. */
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
  commit('root: seed the tree', '.gitkeep')
  // The phase file the injected loadPhase stands in for; its commit subject carries no
  // em-dash boundary, so it stays below the derived base.
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(
    join(root, 'roadmap', 'phases', `phase-${phaseNum}.phase.ts`),
    `export default { phase: ${phaseNum}, status: 'in-progress' }\n`,
  )
  git('add', join('roadmap', 'phases', `phase-${phaseNum}.phase.ts`))
  git('commit', '-q', '-m', `seed phase-${phaseNum} file`)

  return {
    root,
    git,
    commit,
    revert,
    phaseFile: join(root, 'roadmap', 'phases', `phase-${phaseNum}.phase.ts`),
    head: () => git('rev-parse', 'HEAD'),
    tree: (sha) => git('rev-parse', `${sha}^{tree}`),
    subject: (sha) => git('log', '-1', '--format=%s', sha),
    fullMessage: (sha) => git('log', '-1', '--format=%B', sha),
    parent: (sha) => git('rev-parse', `${sha}^`),
    rangeShas: (base) => git('rev-list', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean),
    // -uall so an untracked directory is not collapsed to `?? dir/`.
    status: () => git('status', '--porcelain', '-uall'),
    // executeCurate stamps one of these before it touches anything; a dry run must not.
    rescueRefs: () => git('for-each-ref', '--format=%(refname)', 'refs/curate-rescue'),
  }
}

/** The phase record the injected loader hands back — task ids match the fixture's commits. */
function recordOf(phase, name, tasks) {
  return { phase, name, tasks }
}

/** A loader that records EVERY call, so the tests can assert which file it was asked for. */
function recordingLoader(record) {
  const calls = []
  const loadPhase = (file) => {
    calls.push(file)
    return record
  }
  return { loadPhase, calls }
}

test('phase curate — the DRY RUN prints the base, every classified commit and the composed message, and leaves HEAD byte-identical', () => {
  const r = makeCurateRepo(80)
  r.commit('docs(roadmap): phase 80 — move to in-progress')
  r.commit('feat(cli): phase 80 — 80.1 derive the curation range')
  const scratch = r.commit('scratch(cli): phase 80 — prove the foreign tripwire bites')
  r.revert(scratch)
  r.commit('feat(cli): phase 80 — 80.2 squash the derived range')
  r.commit('fix(cli): phase 80 gate R0 — quality-pass findings')
  r.commit('docs(roadmap): phase 80 — record the transparency report')

  const range = deriveCurationRange(r.root, 80)
  assert.equal(range.ok, true, 'fixture bug: the range must derive before it can be planned')
  const preHead = r.head()
  const preStatus = r.status()
  const record = recordOf(80, 'Curate a phase into landed history', [
    { id: '80.1', title: 'Derive the curation range', transparencyReport: { whatWasDone: 'walked base..HEAD oldest-first', compromises: 'None' } },
    { id: '80.2', title: 'Squash the derived range', transparencyReport: { whatWasDone: 'commit-tree plus update-ref', compromises: 'None' } },
  ])
  const { loadPhase, calls } = recordingLoader(record)
  const out = sink()
  const err = sink()
  // cwd is a SUBDIRECTORY of the checkout: the phase file must be resolved off toplevel,
  // never off the cwd the operator happened to run from.
  const sub = join(r.root, 'work')

  const code = runCurate({ cwd: sub, toplevel: r.root, phaseNum: 80, loadPhase, out, err })

  assert.equal(code, 0, `a clean range plans cleanly → exit 0; stderr:\n${err.text}`)
  assert.ok(calls.length >= 1, 'the injected loadPhase is what supplies the phase record — nothing else may read the file')
  for (const file of calls) {
    assert.equal(file, r.phaseFile, `loadPhase must be handed toplevel's phase file, got: ${file}`)
  }

  const text = out.text
  assert.ok(text.includes(range.base.slice(0, 7)), `the plan must print the base sha ${range.base.slice(0, 7)}; got:\n${text}`)
  for (const c of range.commits) {
    assert.ok(text.includes(c.sha.slice(0, 7)), `commit ${c.sha.slice(0, 7)} must be listed; got:\n${text}`)
    assert.ok(text.includes(c.subject), `the subject "${c.subject}" must be listed; got:\n${text}`)
    assert.ok(text.includes(c.kind), `commit ${c.sha.slice(0, 7)} must be listed with its kind "${c.kind}"; got:\n${text}`)
  }
  // No --groups → ONE group over the whole range, its message composed by the shared
  // composer (a hand-rolled subject here would drift from what --apply lands).
  const expected = composeLandedMessage(record, { commits: range.commits })
  assert.ok(text.includes(expected.subject), `the composed subject must be printed verbatim: ${expected.subject}\ngot:\n${text}`)
  assert.match(text, /phase 80 —/, 'the printed subject carries the boundary every downstream scan greps on')
  assert.ok(
    text.includes('walked base..HEAD oldest-first') && text.includes('commit-tree plus update-ref'),
    `the composed BODY is part of the hand a destructive tool has to show; got:\n${text}`,
  )

  // Nothing executed: a dry run is a dry run.
  assert.equal(r.head(), preHead, 'HEAD is byte-for-byte unchanged after a dry run')
  assert.deepEqual(r.rangeShas(range.base), range.commits.map((c) => c.sha), 'the granular history is untouched, commit for commit')
  assert.equal(r.rescueRefs(), '', 'a dry run never even stamps a rescue ref — it performs no surgery to rescue from')
  assert.equal(r.status(), preStatus, 'index and worktree are untouched')
})

test('phase curate --apply — lands ONE curated commit over the base, tree-identical, and names the tip it landed', () => {
  const r = makeCurateRepo(81)
  r.commit('docs(roadmap): phase 81 — move to in-progress')
  r.commit('feat(cli): phase 81 — 81.1 derive the curation range')
  r.commit('feat(cli): phase 81 — 81.2 squash the derived range')
  r.commit('fix(cli): phase 81 gate R0 — quality-pass findings')
  r.commit('docs(roadmap): phase 81 — record the transparency report')

  const range = deriveCurationRange(r.root, 81)
  assert.equal(range.ok, true, 'fixture bug: the range must derive before it can be curated')
  const preHead = r.head()
  const preTree = r.tree(preHead)
  const branch = r.git('rev-parse', '--abbrev-ref', 'HEAD')
  const record = recordOf(81, 'Curate a phase into landed history', [
    { id: '81.1', title: 'Derive the curation range', transparencyReport: { whatWasDone: 'walked base..HEAD oldest-first', compromises: 'None' } },
    { id: '81.2', title: 'Squash the derived range', transparencyReport: { whatWasDone: 'commit-tree plus update-ref', compromises: 'None' } },
  ])

  // The hand the tool showed…
  const dry = sink()
  assert.equal(
    runCurate({ cwd: r.root, toplevel: r.root, phaseNum: 81, loadPhase: () => record, out: dry, err: sink() }),
    0,
  )
  assert.equal(r.head(), preHead, 'the preceding dry run left HEAD alone')

  // …must be the hand it plays.
  seedGateReport(r.root, 81)
  const out = sink()
  const err = sink()
  const code = runCurate({ cwd: r.root, toplevel: r.root, phaseNum: 81, apply: true, loadPhase: () => record, out, err })

  assert.equal(code, 0, `--apply on a clean range exits 0; stderr:\n${err.text}`)
  const landed = r.rangeShas(range.base)
  assert.equal(landed.length, 1, `a default one-group curate lands exactly ONE commit over the base, got ${landed.length}`)
  const tip = landed[0]
  assert.equal(tip, r.head(), 'the landed commit IS the new HEAD')
  assert.notEqual(tip, preHead, 'history was actually rewritten — a no-op would satisfy every tree check vacuously')
  assert.equal(r.tree(tip), preTree, 'the curated tip carries the pre-curation tree, byte for byte')
  assert.equal(r.parent(tip), range.base, 'the curated commit is parented on the derived base')
  assert.equal(r.git('rev-parse', branch), tip, 'the BRANCH ref advanced, not merely HEAD')

  const expected = composeLandedMessage(record, { commits: range.commits })
  assert.equal(r.fullMessage(tip).trim(), `${expected.subject}\n\n${expected.body}`.trim(), 'the landed message is the composed message, verbatim')
  assert.ok(out.text.includes(tip.slice(0, 7)), `--apply must name the landed tip ${tip.slice(0, 7)}; got:\n${out.text}`)
  assert.ok(out.text.includes(expected.subject), `--apply must name the landed subject; got:\n${out.text}`)
  assert.ok(
    dry.text.includes(expected.subject),
    `the dry run must have printed the SAME subject --apply landed — a plan that differs from the act is not a plan; dry:\n${dry.text}`,
  )

  // The production wiring, not just the lib: --apply records the curation evidence.
  const after = latestReport(r.root, 81)
  assert.ok(after?.report.curation, 'a successful --apply records the curation block into the gate report')
  assert.equal(after.report.curation.squashedCount, range.commits.length, 'squashedCount counts every commit in the range')
  assert.deepEqual(after.report.curation.landedSubjects, [expected.subject], 'landedSubjects carries the composed subject')
})

test('phase curate --apply with NO gate report refuses — evidence before surgery, history intact', () => {
  const r = makeCurateRepo(85)
  r.commit('docs(roadmap): phase 85 — move to in-progress')
  r.commit('feat(cli): phase 85 — 85.1 the only task')
  const record = { phase: 85, name: 'The evidence ordering phase', tasks: [{ id: '85.1', title: 'The only task' }] }
  const preHead = r.head()
  const range = deriveCurationRange(r.root, 85)
  const err = sink()
  const code = runCurate({ cwd: r.root, toplevel: r.root, phaseNum: 85, apply: true, loadPhase: () => record, out: sink(), err })
  assert.notEqual(code, 0, 'an --apply with nowhere to record evidence must not succeed')
  assert.equal(r.head(), preHead, 'HEAD is unmoved')
  assert.deepEqual(r.rangeShas(range.base), r.rangeShas(range.base), 'sanity')
  assert.ok(/no run report/.test(err.text), `the refusal names the missing report; got:\n${err.text}`)
})

test('phase curate --apply --groups "1,2-3" — task 1 and its gate fix land first, tasks 2-3 second (non-task commits fold into the nearest preceding task)', () => {
  const r = makeCurateRepo(82)
  const move = r.commit('docs(roadmap): phase 82 — move to in-progress')
  const t1 = r.commit('feat(cli): phase 82 — 82.1 derive the curation range')
  const gateFix = r.commit('fix(cli): phase 82 gate R0 — quality-pass findings')
  const t2 = r.commit('feat(cli): phase 82 — 82.2 squash the derived range')
  const t3 = r.commit('feat(cli): phase 82 — 82.3 compose the landed message')
  const state = r.commit('docs(roadmap): phase 82 — record the transparency report')

  const range = deriveCurationRange(r.root, 82)
  assert.equal(range.ok, true, 'fixture bug: the range must derive before it can be curated')
  const preHead = r.head()
  const preTree = r.tree(preHead)
  const record = recordOf(82, 'Curate a phase into landed history', [
    { id: '82.1', title: 'Derive the curation range', transparencyReport: { whatWasDone: 'walked base..HEAD oldest-first', compromises: 'None' } },
    { id: '82.2', title: 'Squash the derived range', transparencyReport: { whatWasDone: 'commit-tree plus update-ref', compromises: 'None' } },
    { id: '82.3', title: 'Compose the landed message', transparencyReport: { whatWasDone: 'majority type and scope', compromises: 'None' } },
  ])
  const bySha = (sha) => range.commits.find((c) => c.sha === sha)
  // The split the spec asks for: task 82.1 alone (the move commit precedes every task, so
  // it falls to the FIRST group; the gate fix follows 82.1, so it lands with 82.1), then
  // 82.2-82.3 plus the trailing state commit.
  const expectedGroups = [
    { commits: [move, t1, gateFix].map(bySha) },
    { commits: [t2, t3, state].map(bySha) },
  ]
  assert.notEqual(r.tree(gateFix), r.tree(t1), 'fixture bug: the boundary trees must differ or the tree assertions prove nothing')

  const dry = sink()
  assert.equal(
    runCurate({ cwd: r.root, toplevel: r.root, phaseNum: 82, groupsSpec: '1,2-3', loadPhase: () => record, out: dry, err: sink() }),
    0,
    `the two-group plan must dry-run cleanly; dry:\n${dry.text}`,
  )
  const expectedMessages = expectedGroups.map((g) => composeLandedMessage(record, g))
  assert.match(dry.text, /group/i, 'the dry run names the group boundaries it would cut on')
  // Both groups compose the SAME subject (it is derived from the phase name), so the
  // count is what proves two groups were planned rather than one silently dropped, and
  // the BODIES are what prove which commits fell on which side of the boundary.
  assert.ok(
    dry.text.split(expectedMessages[0].subject).length - 1 >= 2,
    `one composed subject per group must be printed; got:\n${dry.text}`,
  )
  const g1At = dry.text.indexOf('Derive the curation range') // group 1's body, task 82.1
  const g2At = dry.text.indexOf('Squash the derived range') // group 2's body, task 82.2
  assert.ok(g1At >= 0 && g2At >= 0, `both groups' composed bodies must be printed; got:\n${dry.text}`)
  assert.ok(g1At < g2At, `the groups print in plan order, oldest first; got:\n${dry.text}`)
  assert.ok(
    dry.text.includes('Compose the landed message'),
    `task 82.3 is in group 2 and its body line must be shown too; got:\n${dry.text}`,
  )
  assert.equal(r.head(), preHead, 'the dry run with --groups still touches nothing')

  seedGateReport(r.root, 82)
  const out = sink()
  const err = sink()
  const code = runCurate({ cwd: r.root, toplevel: r.root, phaseNum: 82, apply: true, groupsSpec: '1,2-3', loadPhase: () => record, out, err })

  assert.equal(code, 0, `--apply with a valid --groups spec exits 0; stderr:\n${err.text}`)
  const landed = r.rangeShas(range.base)
  assert.equal(landed.length, 2, `a "1,2-3" spec lands exactly TWO commits, got ${landed.length}`)
  assert.equal(r.parent(landed[0]), range.base, 'the chain starts on the derived base')
  assert.equal(r.parent(landed[1]), landed[0], 'linear chain, oldest-first')
  assert.equal(r.tree(landed[1]), preTree, 'the tip is tree-identical to the pre-curation HEAD — the trailing state commit is inside group 2')
  // The boundary IS the tree: group 1 ending on the gate fix is what proves the gate fix
  // folded into the task it fixed rather than into the group that follows it.
  assert.equal(
    r.tree(landed[0]),
    r.tree(gateFix),
    'the first curated commit carries the tree of the GATE FIX — the non-task commit folded into task 82.1’s group',
  )
  for (const [i, expected] of expectedMessages.entries()) {
    assert.equal(r.fullMessage(landed[i]).trim(), `${expected.subject}\n\n${expected.body}`.trim(), `curated commit ${i + 1} carries its own composed message`)
  }
  // Attribution: a group may only claim the work it actually swallowed.
  assert.ok(r.fullMessage(landed[0]).includes('Derive the curation range'), 'group 1 names task 82.1')
  assert.ok(!r.fullMessage(landed[0]).includes('Squash the derived range'), 'group 1 must NOT claim task 82.2 — that work is in the next commit')
  assert.ok(
    r.fullMessage(landed[1]).includes('Squash the derived range') && r.fullMessage(landed[1]).includes('Compose the landed message'),
    'group 2 names both tasks 82.2 and 82.3',
  )
  assert.ok(!r.fullMessage(landed[1]).includes('Derive the curation range'), 'group 2 must NOT claim task 82.1')
})

test('phase curate — a foreign interleave refuses with exit 2 naming every foreign sha, dry and --apply identically', () => {
  const r = makeCurateRepo(83)
  r.commit('docs(roadmap): phase 83 — move to in-progress')
  r.commit('feat(cli): phase 83 — 83.1 derive the curation range')
  const sibling = r.commit('feat(web): the console gains a corpus filter') // another session's work
  const neighbour = r.commit('feat(cli): phase 834 — 834.1 an unrelated phase') // the em-dash boundary: 834 is not 83
  r.commit('docs(roadmap): phase 83 — record the transparency report')

  const refusal = deriveCurationRange(r.root, 83)
  assert.equal(refusal.ok, false, 'fixture bug: this range must be a refusal')
  assert.equal(refusal.foreign.length, 2, 'fixture bug: both foreign commits must be in the range')
  const preHead = r.head()
  const preShas = r.git('rev-list', '--reverse', `${derivePhaseStartSha(r.root, 83)}..HEAD`).split('\n').filter(Boolean)
  const preStatus = r.status()
  const record = recordOf(83, 'Curate a phase into landed history', [{ id: '83.1', title: 'Derive the curation range' }])

  for (const apply of [false, true]) {
    const out = sink()
    const err = sink()
    const code = runCurate({ cwd: r.root, toplevel: r.root, phaseNum: 83, apply, loadPhase: () => record, out, err })

    assert.equal(code, 2, `a foreign interleave refuses with exit 2 (apply=${apply}); stderr:\n${err.text}`)
    assert.match(err.text, /foreign/i, `the refusal names its reason (apply=${apply}); got:\n${err.text}`)
    for (const f of refusal.foreign) {
      assert.ok(
        err.text.includes(f.sha.slice(0, 7)),
        `every foreign sha must be named so the operator can go look at it (apply=${apply}): ${f.sha.slice(0, 7)}; got:\n${err.text}`,
      )
      assert.ok(err.text.includes(f.subject), `foreign ${f.sha.slice(0, 7)} must be named with its subject (apply=${apply}); got:\n${err.text}`)
    }
    assert.ok(err.text.includes(sibling.slice(0, 7)) && err.text.includes(neighbour.slice(0, 7)), 'both offenders, not just the first')

    assert.equal(r.head(), preHead, `HEAD is unmoved on the refusal (apply=${apply}) — a partial squash would rewrite someone else's work`)
    assert.deepEqual(r.git('rev-list', '--reverse', `${derivePhaseStartSha(r.root, 83)}..HEAD`).split('\n').filter(Boolean), preShas, 'the granular history is intact, commit for commit')
    assert.equal(r.rescueRefs(), '', `a refused curate performs no surgery, so it stamps no rescue ref (apply=${apply})`)
    assert.equal(r.status(), preStatus, `index and worktree untouched (apply=${apply})`)
  }
})

test('phase curate — a --groups spec asking for FOUR groups refuses with exit 1 before any surgery', () => {
  const r = makeCurateRepo(84)
  r.commit('docs(roadmap): phase 84 — move to in-progress')
  r.commit('feat(cli): phase 84 — 84.1 derive the curation range')
  r.commit('feat(cli): phase 84 — 84.2 squash the derived range')
  r.commit('feat(cli): phase 84 — 84.3 compose the landed message')
  r.commit('feat(cli): phase 84 — 84.4 wire the command surface')

  const range = deriveCurationRange(r.root, 84)
  assert.equal(range.ok, true, 'fixture bug: the range itself must be clean, so the spec is the ONLY thing being refused')
  const preHead = r.head()
  const preShas = range.commits.map((c) => c.sha)
  const record = recordOf(84, 'Curate a phase into landed history', [
    { id: '84.1', title: 'Derive the curation range' },
    { id: '84.2', title: 'Squash the derived range' },
    { id: '84.3', title: 'Compose the landed message' },
    { id: '84.4', title: 'Wire the command surface' },
  ])

  for (const apply of [false, true]) {
    const out = sink()
    const err = sink()
    const code = runCurate({ cwd: r.root, toplevel: r.root, phaseNum: 84, apply, groupsSpec: '1,2,3,4', loadPhase: () => record, out, err })

    assert.equal(code, 1, `a 4-group spec is a usage error → exit 1 (apply=${apply}); stderr:\n${err.text}`)
    assert.match(err.text, /group/i, `the refusal names groups as the problem (apply=${apply}); got:\n${err.text}`)
    assert.match(err.text, /\b(3|three)\b/i, `the refusal names the ceiling it enforces (apply=${apply}); got:\n${err.text}`)
    assert.equal(r.head(), preHead, `HEAD is unmoved (apply=${apply}) — the spec is validated BEFORE any ref surgery`)
    assert.deepEqual(r.rangeShas(range.base), preShas, `the granular history is intact (apply=${apply})`)
    assert.equal(r.rescueRefs(), '', `no rescue ref, because nothing was attempted (apply=${apply})`)
  }
})

test('phase curate --groups "2,3" with task 1 in the range refuses \u2014 an uncovered task never buckets silently', () => {
  const r = makeCurateRepo(86)
  r.commit('docs(roadmap): phase 86 \u2014 move to in-progress')
  r.commit('feat(cli): phase 86 \u2014 86.1 first task')
  r.commit('feat(cli): phase 86 \u2014 86.2 second task')
  r.commit('feat(cli): phase 86 \u2014 86.3 third task')
  const record = {
    phase: 86,
    name: 'The coverage phase',
    tasks: [
      { id: '86.1', title: 'First' },
      { id: '86.2', title: 'Second' },
      { id: '86.3', title: 'Third' },
    ],
  }
  const preHead = r.head()
  const err = sink()
  const code = runCurate({ cwd: r.root, toplevel: r.root, phaseNum: 86, apply: true, groupsSpec: '2,3', loadPhase: () => record, out: sink(), err })
  assert.equal(code, 1, 'a spec leaving a task uncovered refuses before any surgery')
  assert.ok(/task index\(es\) 1/.test(err.text), `the refusal names the uncovered index; got:\n${err.text}`)
  assert.equal(r.head(), preHead, 'HEAD untouched')
})

test('phase curate --apply records CORRECTLY PAIRED red proofs when two scratch pairs interleave', () => {
  const r = makeCurateRepo(87)
  r.commit('docs(roadmap): phase 87 \u2014 move to in-progress')
  r.commit('feat(cli): phase 87 \u2014 87.1 the task')
  const sA = r.commit('scratch(cli): phase 87 \u2014 prove guard A bites')
  const sB = r.commit('scratch(cli): phase 87 \u2014 prove guard B bites')
  const rB = r.commit('Revert "scratch(cli): phase 87 \u2014 prove guard B bites"')
  const rA = r.commit('Revert "scratch(cli): phase 87 \u2014 prove guard A bites"')
  const record = { phase: 87, name: 'The pairing phase', tasks: [{ id: '87.1', title: 'The task' }] }
  seedGateReport(r.root, 87)
  const err = sink()
  const code = runCurate({ cwd: r.root, toplevel: r.root, phaseNum: 87, apply: true, loadPhase: () => record, out: sink(), err })
  assert.equal(code, 0, `stderr:\n${err.text}`)
  const rep = latestReport(r.root, 87)
  assert.deepEqual(
    rep.report.curation.redProofs,
    [
      { scratch: sA, revert: rA, subject: 'scratch(cli): phase 87 \u2014 prove guard A bites' },
      { scratch: sB, revert: rB, subject: 'scratch(cli): phase 87 \u2014 prove guard B bites' },
    ],
    'each scratch pairs with ITS OWN revert by inner subject, each revert consumed once',
  )
})

test('phase curate: an ABORTED apply leaves no false curation evidence in the report', () => {
  const r = makeCurateRepo(88)
  r.commit('docs(roadmap): phase 88 \u2014 move to in-progress')
  r.commit('feat(cli): phase 88 \u2014 88.1 first task')
  r.commit('feat(cli): phase 88 \u2014 88.2 second task')
  const record = {
    phase: 88,
    name: 'The abort phase',
    tasks: [
      { id: '88.1', title: 'First' },
      { id: '88.2', title: 'Second' },
    ],
  }
  seedGateReport(r.root, 88)
  const preHead = r.head()
  // A reversed spec assembles a chain whose tip carries group "1"'s tree \u2014 a legitimate
  // tree mismatch, the same abort class a tamper produces.
  const err = sink()
  const code = runCurate({ cwd: r.root, toplevel: r.root, phaseNum: 88, apply: true, groupsSpec: '2,1', loadPhase: () => record, out: sink(), err })
  assert.notEqual(code, 0, 'the reversed spec must abort on the tree assertion')
  assert.equal(r.head(), preHead, 'HEAD unmoved')
  const rep = latestReport(r.root, 88)
  assert.equal(rep.report.curation, undefined, `an aborted curate must leave NO curation block; got ${JSON.stringify(rep.report.curation)}`)
})

test('phase curate: a scratch subject that PREFIXES another still pairs with its own revert exactly', () => {
  const r = makeCurateRepo(89)
  r.commit('docs(roadmap): phase 89 \u2014 move to in-progress')
  r.commit('feat(cli): phase 89 \u2014 89.1 the task')
  const short = r.commit('scratch(cli): phase 89 \u2014 prove the tripwire bites')
  const long = r.commit('scratch(cli): phase 89 \u2014 prove the tripwire bites twice')
  const rvLong = r.commit('Revert "scratch(cli): phase 89 \u2014 prove the tripwire bites twice"')
  const rvShort = r.commit('Revert "scratch(cli): phase 89 \u2014 prove the tripwire bites"')
  const record = { phase: 89, name: 'The prefix phase', tasks: [{ id: '89.1', title: 'The task' }] }
  seedGateReport(r.root, 89)
  const err = sink()
  const code = runCurate({ cwd: r.root, toplevel: r.root, phaseNum: 89, apply: true, loadPhase: () => record, out: sink(), err })
  assert.equal(code, 0, `stderr:\n${err.text}`)
  assert.deepEqual(
    latestReport(r.root, 89).report.curation.redProofs,
    [
      { scratch: short, revert: rvShort, subject: 'scratch(cli): phase 89 \u2014 prove the tripwire bites' },
      { scratch: long, revert: rvLong, subject: 'scratch(cli): phase 89 \u2014 prove the tripwire bites twice' },
    ],
    'exact inner-subject matching: the shorter scratch never steals the longer one\u2019s twin, and BOTH pairs are recorded',
  )
})

// \u2500\u2500 roadmap phase land <N> (2146.4) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

// runLand lands with 2146.4. Same lazy resolution as runCurate above: a missing export must be
// a per-test RED naming the contract, never a link-time SyntaxError that reds the whole file.
const runLand = (opts) => {
  assert.equal(
    typeof phaseCmd.runLand,
    'function',
    'cli/commands/phase.mjs must export runLand({ cwd, toplevel, phaseNum, loadPhase, config, out, err })',
  )
  return phaseCmd.runLand(opts)
}

/** The integration ref the land fixtures advance. Deliberately NOT 'develop': the config-read
 *  case must be able to fail when the implementation hardcodes the fallback. */
const LAND_BASE = 'integration'
const SEED_SUBJECT = 'seed: the integration branch exists'

/** git in any checkout (worktree or primary), identity pinned on the command line. */
const gitAt = (dir, ...a) =>
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  }).trim()

/** One commit in any checkout; each writes its own file so no two commits share a tree. */
function commitAt(dir, msg, rel) {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, `${msg}\n`)
  gitAt(dir, 'add', '--', rel)
  gitAt(dir, 'commit', '-q', '-m', msg)
  return gitAt(dir, 'rev-parse', 'HEAD')
}

/** Subjects of a ref in a checkout, newest first \u2014 the WHOLE list, because "gained ours" is not
 *  the invariant: a land that dropped the base's own history also gains ours. */
const subjectsAt = (dir, ref) =>
  gitAt(dir, 'log', '--format=%s', ref)
    .split('\n')
    .filter(Boolean)

/** -uall so an untracked directory is not collapsed to `?? dir/`. */
const statusAt = (dir) => gitAt(dir, 'status', '--porcelain', '-uall')

/**
 * The post-gate state `phase land` is handed: a repo whose integration branch is a NON-checked-out
 * ref, plus slot 1's real worktree (built with the shipped cli/lib/worktree.mjs) carrying the
 * phase's granular history \u2014 move commit, one task commit, the transparency-report commit.
 */
function landFixture(phaseNum, baseName = LAND_BASE) {
  const root = mkdtempSync(join(tmpdir(), 'zr-phase-land-'))
  bases.push(root)
  for (let k = 1; k <= 3; k += 1) bases.push(`${root}-wt-${k}`)
  gitAt(root, 'init', '-q')
  gitAt(root, 'config', 'user.email', 't@t')
  gitAt(root, 'config', 'user.name', 't')
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(
    join(root, 'roadmap', 'phases', `phase-${phaseNum}.phase.ts`),
    `export default { phase: ${phaseNum}, status: 'in-progress' }\n`,
  )
  writeFileSync(join(root, '.gitignore'), '.building/\n')
  gitAt(root, 'add', '-A')
  gitAt(root, 'commit', '-q', '-m', SEED_SUBJECT)
  const seed = gitAt(root, 'rev-parse', 'HEAD')
  // Host-independent: whatever init.defaultBranch is, the primary must not sit ON the base ref.
  if (gitAt(root, 'rev-parse', '--abbrev-ref', 'HEAD') === baseName) gitAt(root, 'branch', '-m', `${baseName}-primary`)
  gitAt(root, 'branch', baseName)
  const primaryBranch = gitAt(root, 'rev-parse', '--abbrev-ref', 'HEAD')

  const { dir: wt } = ensureWorktree(root, 1, { baseRef: baseName })
  const granular = [
    commitAt(wt, `docs(roadmap): phase ${phaseNum} \u2014 move to in-progress`, 'roadmap/move.txt'),
    commitAt(wt, `feat(cli): phase ${phaseNum} \u2014 ${phaseNum}.1 the task`, 'cli/lib/thing.txt'),
    commitAt(wt, `docs(roadmap): phase ${phaseNum} \u2014 record the transparency report`, 'roadmap/report.txt'),
  ]
  const granularSubjects = granular.map((sha) => gitAt(wt, 'log', '-1', '--format=%s', sha))
  const range = deriveCurationRange(wt, phaseNum)
  assert.equal(range.ok, true, `fixture bug: the worktree range must derive before it can be landed: ${range.reason ?? ''}`)
  assert.equal(range.base, seed, 'fixture bug: the curation base is the integration tip the worktree branched from')

  const record = recordOf(phaseNum, 'Land a phase from the session worktree', [
    {
      id: `${phaseNum}.1`,
      title: 'The task',
      transparencyReport: { whatWasDone: 'built it in the session worktree', compromises: 'None' },
    },
  ])

  return {
    root,
    wt,
    seed,
    baseName,
    primaryBranch,
    record,
    range,
    granularSubjects,
    git: (...a) => gitAt(root, ...a),
    baseTip: () => gitAt(root, 'rev-parse', `refs/heads/${baseName}`),
    baseSubjects: () => subjectsAt(root, `refs/heads/${baseName}`),
  }
}

/** The mergePolicy block a consumer carries; autonomousPushRefs[0] is the ref land advances. */
const mergePolicyFor = (root, ref) => ({
  arcIntegration: 'autonomous',
  maxOpenFollowups: 0,
  autonomousPushRefs: [ref],
  primaryCheckout: root,
})

test('phase land \u2014 under executionIsolation "primary" (and under an ABSENT knob) it refuses with exit 1 naming the knob, and nothing moves', () => {
  const f = landFixture(90)
  seedGateReport(f.wt, 90) // the evidence is present: the KNOB is the only thing refusing here

  // Absent reads primary (executionIsolationOf) \u2014 a land that ran on an unconfigured consumer
  // would rewrite the shared checkout's history behind the operator's back.
  for (const config of [{ executionIsolation: 'primary', mergePolicy: mergePolicyFor(f.root, f.baseName) }, {}]) {
    const out = sink()
    const err = sink()
    const code = runLand({ cwd: f.wt, toplevel: f.wt, phaseNum: 90, loadPhase: () => f.record, config, out, err })

    const named = JSON.stringify(config)
    assert.equal(code, 1, `landing outside the worktree lane is a configuration refusal \u2192 exit 1 (config ${named}); stderr:\n${err.text}`)
    assert.match(err.text, /executionIsolation/, `the refusal must name the knob the operator has to flip (config ${named}); got:\n${err.text}`)
    assert.equal(f.baseTip(), f.seed, `the integration ref never moved (config ${named})`)
    assert.deepEqual(
      subjectsAt(f.wt, 'HEAD'),
      [...f.granularSubjects].reverse().concat(SEED_SUBJECT),
      `nothing was curated either (config ${named}) \u2014 a refusal that had already rewritten history is not a refusal`,
    )
  }
})

test('phase land \u2014 under "worktree" it lands the CURATED scratch head on the ref mergePolicy names, leaving the worktree clean on the new tip', () => {
  const f = landFixture(91)
  const expected = composeLandedMessage(f.record, { commits: f.range.commits })
  seedGateReport(f.wt, 91)
  // The protocol order: curate is its OWN step before the done flip; land lands whatever
  // the scratch head carries.
  assert.equal(
    runCurate({ cwd: f.wt, toplevel: f.wt, phaseNum: 91, apply: true, loadPhase: () => f.record, out: sink(), err: sink() }),
    0,
    'fixture: the pre-land curate must succeed',
  )
  const out = sink()
  const err = sink()

  const code = runLand({
    cwd: f.wt,
    toplevel: f.wt,
    phaseNum: 91,
    loadPhase: () => f.record,
    config: { executionIsolation: 'worktree', mergePolicy: mergePolicyFor(f.root, f.baseName) },
    out,
    err,
  })

  assert.equal(code, 0, `a clean land exits 0; stderr:\n${err.text}`)
  assert.deepEqual(
    f.baseSubjects(),
    [expected.subject, SEED_SUBJECT],
    'the integration branch gained EXACTLY the curated commit, with its own history intact underneath \u2014 not the granular task commits, and not a second copy',
  )
  assert.equal(f.git('rev-list', '--count', `${f.seed}..refs/heads/${f.baseName}`), '1', 'one curated commit, one new commit on the base')
  assert.equal(f.git('rev-list', '--merges', `${f.seed}..refs/heads/${f.baseName}`), '', 'the land is a rebase + fast-forward \u2014 a merge commit means the ff discipline was abandoned')
  for (const subject of f.granularSubjects) {
    assert.ok(!f.baseSubjects().includes(subject), `the granular subject "${subject}" must NOT reach the integration branch \u2014 that is what curate is for`)
  }

  assert.equal(gitAt(f.wt, 'rev-parse', 'HEAD'), f.baseTip(), 'the worktree ends on the new tip \u2014 the next phase starts from what actually landed')
  assert.equal(f.git('rev-parse', 'refs/heads/wt/1'), f.baseTip(), 'and the wt/1 BRANCH moved with it, not merely a detached HEAD')
  assert.equal(gitAt(f.wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'wt/1', 'still on the scratch head')
  assert.equal(statusAt(f.wt), '', 'the worktree ends CLEAN \u2014 a session that inherits rebase wreckage cannot start its next phase')

  // The curate STEP recorded the evidence; land must not have disturbed it.
  const rep = latestReport(f.wt, 91)
  assert.ok(rep?.report.curation, 'the gate report still carries the curation block the curate step recorded')
  assert.deepEqual(rep.report.curation.landedSubjects, [expected.subject], 'landedSubjects is the subject that reached the branch')
  assert.equal(rep.report.curation.squashedCount, f.range.commits.length, 'squashedCount counts every commit the land swallowed')
  assert.ok(out.text.includes(f.baseName), `land must name the ref it advanced \u2014 the operator reports it; got:\n${out.text}`)

  // The primary checkout belongs to a sibling session mid-phase.
  assert.equal(f.git('rev-parse', 'HEAD'), f.seed, 'the primary checkout\u2019s HEAD never moves \u2014 only the base REF does')
  assert.equal(f.git('rev-parse', '--abbrev-ref', 'HEAD'), f.primaryBranch, 'nor its branch')
  assert.equal(statusAt(f.root), '', 'and the primary is left clean')
})

test('phase land \u2014 with NO mergePolicy the base ref falls back to develop (the documented default), not to whatever ref happens to exist', () => {
  const f = landFixture(92, 'develop')
  const expected = composeLandedMessage(f.record, { commits: f.range.commits })
  seedGateReport(f.wt, 92)
  assert.equal(
    runCurate({ cwd: f.wt, toplevel: f.wt, phaseNum: 92, apply: true, loadPhase: () => f.record, out: sink(), err: sink() }),
    0,
    'fixture: the pre-land curate must succeed',
  )
  const err = sink()

  const code = runLand({
    cwd: f.wt,
    toplevel: f.wt,
    phaseNum: 92,
    loadPhase: () => f.record,
    config: { executionIsolation: 'worktree' },
    out: sink(),
    err,
  })

  assert.equal(code, 0, `the fallback base must land, not refuse; stderr:\n${err.text}`)
  assert.deepEqual(f.baseSubjects(), [expected.subject, SEED_SUBJECT], 'develop is the fallback integration ref when the consumer names none')
  assert.equal(gitAt(f.wt, 'rev-parse', 'HEAD'), f.baseTip(), 'and the worktree follows the landed tip')
})

test('phase land \u2014 the documented order (curate, then the completion commit, then land) lands BOTH, never refusing on its own closing commits', () => {
  // The regression the reviewer proved: a land that re-curated would read the
  // mark-complete commit (no em-dash boundary) as FOREIGN and refuse every
  // properly-sequenced phase. Land is the LAND act only.
  const f = landFixture(93)
  const expected = composeLandedMessage(f.record, { commits: f.range.commits })
  seedGateReport(f.wt, 93)
  assert.equal(
    runCurate({ cwd: f.wt, toplevel: f.wt, phaseNum: 93, apply: true, loadPhase: () => f.record, out: sink(), err: sink() }),
    0,
    'fixture: the curate step succeeds',
  )
  const completion = commitAt(f.wt, 'docs(roadmap): mark phase 93 complete', 'roadmap/complete.txt')
  const err = sink()

  const code = runLand({
    cwd: f.wt,
    toplevel: f.wt,
    phaseNum: 93,
    loadPhase: () => f.record,
    config: { executionIsolation: 'worktree', mergePolicy: mergePolicyFor(f.root, f.baseName) },
    out: sink(),
    err,
  })

  assert.equal(code, 0, `the documented sequence must land; stderr:\n${err.text}`)
  assert.deepEqual(
    f.baseSubjects(),
    ['docs(roadmap): mark phase 93 complete', expected.subject, SEED_SUBJECT],
    'the base gains the curated commit AND the completion commit, in order',
  )
  assert.equal(gitAt(f.wt, 'rev-parse', 'HEAD'), f.baseTip(), 'the worktree follows the landed tip')
  assert.equal(f.git('rev-parse', `${completion}^{commit}`), f.baseTip(), 'the completion commit IS the landed tip')
})

test('phase land \u2014 refuses master and main: a release branch is a held human act, never a lane act', () => {
  const f = landFixture(94, 'master')
  seedGateReport(f.wt, 94)
  for (const ref of ['master', 'main']) {
    const err = sink()
    const code = runLand({
      cwd: f.wt,
      toplevel: f.wt,
      phaseNum: 94,
      loadPhase: () => f.record,
      config: { executionIsolation: 'worktree', mergePolicy: mergePolicyFor(f.root, ref) },
      out: sink(),
      err,
    })
    assert.equal(code, 1, `landing onto ${ref} must refuse`)
    assert.match(err.text, new RegExp(ref), `the refusal names ${ref}; got:\n${err.text}`)
  }
  assert.equal(f.baseTip(), f.seed, 'the ref never moved')
})

test('phase \u2014 the dispatcher advertises `land <N>` beside validate/start/curate', () => {
  const { root } = makeRepo()

  const res = spawnSync('node', [BIN, 'phase'], { cwd: root, encoding: 'utf8' })

  assert.equal(res.status, 1, `a bare \`roadmap phase\` is a usage error \u2192 exit 1; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /land <N>/, `the usage line must advertise the land subcommand; got:\n${res.stderr}`)
  for (const sub of ['validate', 'start', 'curate']) {
    assert.ok(res.stderr.includes(sub), `the existing subcommand '${sub}' must stay advertised; got:\n${res.stderr}`)
  }
})
