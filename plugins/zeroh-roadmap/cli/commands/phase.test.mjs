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
