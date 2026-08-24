#!/usr/bin/env node
/**
 * TEST-FIRST, WIRED for `roadmap executor-arm` + `roadmap executor-disarm` (2375.5). These spawn
 * bin/roadmap.mjs as a REAL subprocess against a hermetic tmp git estate, because the guards added
 * in 2375.4 are only worth anything if they are reachable from the CLI the orchestrator actually
 * types: the refusal has to become an exit code, the beacon evidence has to reach stderr, and the
 * sweep must not be blocked by its own guard.
 *
 * This suite is also the phase's INTEGRATION-LEVEL CLOSURE for the 2026-08-17 incident: case 5
 * drives the real evidence shape (an arm whose beacon's last event is task-start) through the
 * actual command and asserts the disarm refuses with exit 2 and leaves the arm on disk.
 *
 * Hermetic-tmp-git-estate pattern from cli/commands/arm-disarm.test.mjs (mkdtempSync +
 * realpathSync + process.on('exit') cleanup; REAL `git init`, no mocking).
 * Run: node --test cli/commands/executor-arm-disarm.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

// A stray path override would defeat the git-toplevel resolution the CLI exercises.
delete process.env.ROADMAP_CONFIG

const tmps = []
function newTmp(prefix = 'zr-cli-execarm-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  return realpathSync(d)
}
process.on('exit', () => {
  for (const d of tmps) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
})

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

/** A tmp git repo with a seed commit and roadmap/phases/; realpath'd root. */
function newRepo(prefix) {
  const d = newTmp(prefix)
  git(d, 'init', '-q', '-b', 'develop')
  writeFileSync(join(d, 'seed.txt'), 'seed\n')
  git(d, 'add', 'seed.txt')
  git(d, 'commit', '-qm', 'seed')
  mkdirSync(join(d, 'roadmap', 'phases'), { recursive: true })
  return d
}

function roadmap(cwd, ...args) {
  return spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8' })
}

const armPath = (worktree, phase) => join(worktree, '.building', `${phase}-executor.armed`)
const isoAgo = (min) => new Date(Date.now() - min * 60_000).toISOString()

function writeBeacon(worktree, phase, lines) {
  const dir = join(worktree, '.building')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${phase}-executor.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

/** A phase file in the repo declaring `keyFiles`, so the preflight has something to derive from. */
function writePhaseFile(repo, phase, { status = 'in-progress', arcId = 'ARCX', keyFiles = [] } = {}) {
  const body = keyFiles.map((k) => `    '${k}',`).join('\n')
  writeFileSync(
    join(repo, 'roadmap', 'phases', `phase-${phase}.phase.ts`),
    `export default definePhase({\n  phase: ${phase},\n  status: '${status}',\n  arcId: '${arcId}',\n`
      + (keyFiles.length ? `  keyFiles: [\n${body}\n  ],\n` : '')
      + '})\n',
  )
}

test('1) executor-arm --executor-id records the id in the arm file', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-abc', '--executor-id', 'exec-1')
  assert.equal(res.status, 0, `arm must exit 0; stderr:\n${res.stderr}`)
  const rec = JSON.parse(readFileSync(armPath(repo, 2375), 'utf8'))
  assert.equal(rec.sessionId, 'sess-abc')
  assert.equal(rec.executorId, 'exec-1', 'the executor identity is what makes exclusivity meaningful')
})

test('2) executor-arm prints the CROSS-REPO PREFLIGHT: the derived product repo and the newest keyFile age', () => {
  // D6: no CLI can compute "newer than YOUR spawn" (that fact lives only in the agent's head), so
  // the CLI carries its half as OUTPUT — the orchestrator sees the tell before it spawns.
  const repo = newRepo()
  const product = newRepo('zr-cli-execarm-product-')
  const kf = join(product, 'src', 'relay', 'governed-turn.ts')
  mkdirSync(dirname(kf), { recursive: true })
  writeFileSync(kf, 'export {}\n')
  writePhaseFile(repo, 2375, { keyFiles: [kf, join(repo, 'roadmap', 'backlog.ts')] })

  const res = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-abc', '--executor-id', 'exec-1')
  assert.equal(res.status, 0, `arm must exit 0; stderr:\n${res.stderr}`)
  assert.ok(res.stderr.includes(product), `the preflight must NAME the product repo; got:\n${res.stderr}`)
  assert.ok(!res.stderr.includes(`${repo} `), 'the arc worktree own repo is not a product repo')
  assert.match(res.stderr, /keyFile/i, `the preflight must report the newest keyFile age; got:\n${res.stderr}`)
})

test('2b) executor-arm on a single-repo phase says so explicitly rather than staying silent', () => {
  const repo = newRepo()
  writePhaseFile(repo, 2375, { keyFiles: [join(repo, 'roadmap', 'backlog.ts')] })
  const res = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-abc', '--executor-id', 'exec-1')
  assert.equal(res.status, 0, `arm must exit 0; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /none/i, `an explicit none, so the reader knows the preflight ran; got:\n${res.stderr}`)
})

test('2c) a phase file that does not exist at all does not break the arm', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-abc', '--executor-id', 'exec-1')
  assert.equal(res.status, 0, `the preflight is diagnostic, never a gate; stderr:\n${res.stderr}`)
  assert.ok(existsSync(armPath(repo, 2375)), 'the arm is still written')
})

test('3) a re-arm with a DIFFERENT --executor-id exits 2 and names BOTH ids', () => {
  const repo = newRepo()
  assert.equal(roadmap(repo, 'executor-arm', '2375', '--session', 'sess-shared', '--executor-id', 'exec-first').status, 0)

  const res = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-shared', '--executor-id', 'exec-second')
  assert.equal(res.status, 2, `a conflicting re-arm is REFUSED → exit 2; stderr:\n${res.stderr}`)
  assert.ok(res.stderr.includes('exec-first'), `names the incumbent; got:\n${res.stderr}`)
  assert.ok(res.stderr.includes('exec-second'), `names the challenger; got:\n${res.stderr}`)
  assert.ok(!/\bat\s+\w+\s+\(/.test(res.stderr), `a refusal is a message, never a stack; got:\n${res.stderr}`)
  assert.equal(JSON.parse(readFileSync(armPath(repo, 2375), 'utf8')).executorId, 'exec-first', 'the incumbent arm is untouched')

  const forced = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-shared', '--executor-id', 'exec-second', '--force')
  assert.equal(forced.status, 0, `--force is the deliberate override; stderr:\n${forced.stderr}`)
  assert.equal(JSON.parse(readFileSync(armPath(repo, 2375), 'utf8')).executorId, 'exec-second')
})

test('4) executor-disarm on a LIVE beacon exits 2, leaves the arm, and puts the evidence on stderr', () => {
  const repo = newRepo()
  assert.equal(roadmap(repo, 'executor-arm', '2375', '--session', 'sess-abc', '--executor-id', 'exec-1').status, 0)
  writeBeacon(repo, 2375, [
    { ts: isoAgo(120), event: 'executor-start', phase: 2375 },
    { ts: isoAgo(93), event: 'task-start', phase: 2375, detail: '2375.4 mid-task' },
  ])

  const res = roadmap(repo, 'executor-disarm', '2375')
  assert.equal(res.status, 2, `disarming a live arm is REFUSED → exit 2; stderr:\n${res.stderr}`)
  assert.ok(res.stderr.includes('task-start'), `the beacon event must reach stderr; got:\n${res.stderr}`)
  assert.match(res.stderr, /93/, 'the age is reported as evidence for the human')
  assert.match(res.stderr, /force/, 'the message points at the deliberate override')
  assert.ok(existsSync(armPath(repo, 2375)), 'a REFUSED disarm leaves the arm exactly where it was')

  const forced = roadmap(repo, 'executor-disarm', '2375', '--force')
  assert.equal(forced.status, 0, `--force clears it; stderr:\n${forced.stderr}`)
  assert.equal(existsSync(armPath(repo, 2375)), false)
})

test('5) THE 2026-08-17 CLOSURE — the real incident evidence shape, driven through the real command', () => {
  // The two files read at plan time, reproduced: an arm bound to ONE session id for what became
  // two executors, and a beacon whose last line is a WORK event 93 minutes old. This is the exact
  // disarm the orchestrator performed before spawning the second executor onto the live phase.
  const repo = newRepo()
  mkdirSync(join(repo, '.building'), { recursive: true })
  writeFileSync(
    armPath(repo, 2333),
    JSON.stringify({ sessionId: 'ea584379-4810-40b6-bb67-20906c8bf6d3', armedAt: isoAgo(120) }) + '\n',
  )
  writeBeacon(repo, 2333, [
    { ts: isoAgo(120), event: 'executor-start', phase: 2333 },
    { ts: isoAgo(93), event: 'task-start', phase: 2333, detail: '2333.4 dual-lane parity proof, then the deletion' },
  ])

  const res = roadmap(repo, 'executor-disarm', '2333')
  assert.equal(res.status, 2, `the incident disarm must now be REFUSED; stderr:\n${res.stderr}`)
  assert.ok(existsSync(armPath(repo, 2333)), 'the live arm survives, so no second executor can be armed onto this phase')

  // And the belt: even without the disarm, arming a second executor over it is refused.
  writeFileSync(
    armPath(repo, 2333),
    JSON.stringify({ sessionId: 'ea584379-4810-40b6-bb67-20906c8bf6d3', executorId: 'exec-first', armedAt: isoAgo(120) }) + '\n',
  )
  const rearm = roadmap(repo, 'executor-arm', '2333', '--session', 'ea584379-4810-40b6-bb67-20906c8bf6d3', '--executor-id', 'exec-second')
  assert.equal(rearm.status, 2, `the SAME session spawning a second executor is refused; stderr:\n${rearm.stderr}`)
})

test('6) executor-disarm --sweep still removes exactly the stale set, and is not blocked by the new guard', () => {
  const repo = newRepo()
  // 2001: terminal phase, but its last beacon event is WORK — the shape that would deadlock the
  // sweep against its own guard if the sweep did not pass force (staleArms has already judged it).
  assert.equal(roadmap(repo, 'executor-arm', '2001', '--session', 'sess-1', '--executor-id', 'e1').status, 0)
  writePhaseFile(repo, 2001, { status: 'done' })
  writeBeacon(repo, 2001, [{ ts: isoAgo(200), event: 'task-start', phase: 2001 }])

  // 2002: live in-progress arm with a work beacon — NOT stale, must survive the sweep.
  assert.equal(roadmap(repo, 'executor-arm', '2002', '--session', 'sess-2', '--executor-id', 'e2').status, 0)
  writePhaseFile(repo, 2002, { status: 'in-progress' })
  writeBeacon(repo, 2002, [{ ts: isoAgo(5), event: 'task-start', phase: 2002 }])

  const res = roadmap(repo, 'executor-disarm', '--sweep')
  assert.equal(res.status, 0, `the sweep must not be blocked by the live-arm guard; stderr:\n${res.stderr}`)
  assert.equal(existsSync(armPath(repo, 2001)), false, 'the stale arm on a done phase is swept')
  assert.ok(existsSync(armPath(repo, 2002)), 'the live arm is never swept — the stale definition is unchanged')
})

test('7) the help tree lists the new flag sets', () => {
  const repo = newRepo()
  const res = roadmap(repo, '--help')
  const lines = (res.stdout + res.stderr).split('\n')
  const armLine = lines.find((l) => l.includes('executor-arm'))
  const disarmLine = lines.find((l) => l.includes('executor-disarm'))
  assert.ok(armLine && armLine.includes('--executor-id'), `executor-arm must advertise --executor-id; got:\n${armLine}`)
  assert.ok(disarmLine && disarmLine.includes('--force'), `executor-disarm must advertise --force; got:\n${disarmLine}`)
})

// ── 3.4 — THE ARMED CARD ALIAS. `executor-arm` is the session lane's pre-spawn chokepoint, so it
// is where the REQUESTED model is recorded: a do-arc orchestrator that asserts driver.model
// 'claude-fable-5' in the spawn prompt of an executor whose card declares `model: opus` cannot
// be contradicted by anything downstream. The alias must therefore be read
// MECHANICALLY off the agent card — never taken from a caller, never guessed — and PRINTED, so the
// launcher's own record of what it asked for is visible at the moment it asks.
//
// The parse is bounded to the FRONTMATTER block. That bound is the whole difficulty:
// agents/arc-eval-judge.md carries the string `model: sonnet` on three lines (one frontmatter, two
// prose), and agent cards routinely mention a model inside `description:` — an unbounded search
// reads whichever line it hits first and records a sentence fragment as launcher truth.

const CARD = join(HERE, '..', '..', 'agents', 'phase-executor.md')

/** The alias declared in a card's FRONTMATTER block (fixture precondition only). */
function frontmatterAlias(cardPath) {
  const lines = readFileSync(cardPath, 'utf8').split('\n')
  const end = lines.indexOf('---', 1)
  const block = lines.slice(1, end < 0 ? 1 : end)
  const line = block.find((l) => /^model:\s*\S/.test(l))
  return line ? line.replace(/^model:\s*/, '').trim() : null
}

/** Write a card fixture: frontmatter lines + body lines, ---fenced. */
function writeCard(dir, name, { frontmatter = [], body = [] } = {}) {
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  writeFileSync(p, ['---', ...frontmatter, '---', '', ...body, ''].join('\n'))
  return p
}

const FAMILY_WORDS = /\b(opus|sonnet|haiku|fable)\b/

test('8) executor-arm records the DEFAULT card alias and prints what it recorded', () => {
  const repo = newRepo()
  assert.equal(frontmatterAlias(CARD), 'opus', `fixture precondition: ${CARD} must declare model: opus in its frontmatter`)

  const res = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-abc', '--executor-id', 'exec-1')
  assert.equal(res.status, 0, `arm must exit 0; stderr:\n${res.stderr}`)
  const rec = JSON.parse(readFileSync(armPath(repo, 2375), 'utf8'))
  assert.equal(
    rec.expectedModelAlias,
    'opus',
    'the alias is read from agents/phase-executor.md resolved beside the plugin CLI — the launcher never asks the caller',
  )
  assert.ok(res.stderr.includes('opus'), `the command must PRINT the alias it recorded; got:\n${res.stderr}`)
  assert.equal(rec.sessionId, 'sess-abc', 'the session binding is untouched')
  assert.equal(rec.executorId, 'exec-1', 'the executor binding is untouched')
})

test('9) --agent-card overrides, and the parse is bounded to the FRONTMATTER block', () => {
  // The arc-eval-judge.md shape reproduced: the declared alias in the frontmatter, and PROSE below
  // that discusses other model aliases. Only the frontmatter declaration is a declaration.
  const repo = newRepo()
  const card = writeCard(newTmp('zr-cli-execarm-card-'), 'judge-shaped.md', {
    frontmatter: ['name: shaped', 'description: scores a landed arc', 'tools: Glob, Grep', 'model: haiku', 'user_callable: false'],
    body: [
      '> **Pin note.** The frontmatter `model: haiku` is a harness ALIAS.',
      '',
      'model: opus',
      '',
      'Never restate a model in prose; a reader that does would record `model: sonnet` here.',
    ],
  })

  const res = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-abc', '--agent-card', card)
  assert.equal(res.status, 0, `arm must exit 0; stderr:\n${res.stderr}`)
  const rec = JSON.parse(readFileSync(armPath(repo, 2375), 'utf8'))
  assert.equal(rec.expectedModelAlias, 'haiku', 'the FRONTMATTER declaration wins over every prose mention below the fence')
})

test('9b) a `model:` token inside the frontmatter DESCRIPTION never wins over the declaration', () => {
  // The first-match-anywhere killer: the decoy precedes the real declaration, so a search that is
  // not bounded to a line-anchored frontmatter key records a fragment of an English sentence.
  const repo = newRepo()
  const card = writeCard(newTmp('zr-cli-execarm-card-'), 'decoy-first.md', {
    frontmatter: [
      'name: decoy',
      'description: returns a PhaseExecutionResult whose driver names the model: claude-fable-5 it actually ran as',
      'model: opus',
    ],
    body: ['Body prose.'],
  })

  const res = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-abc', '--agent-card', card)
  assert.equal(res.status, 0, `arm must exit 0; stderr:\n${res.stderr}`)
  const rec = JSON.parse(readFileSync(armPath(repo, 2375), 'utf8'))
  assert.equal(
    rec.expectedModelAlias,
    'opus',
    'a description mentioning a model id is prose — only a line-anchored frontmatter `model:` key is a declaration',
  )
})

test('10) a card with NO frontmatter model line records NOTHING — never a guess from prose', () => {
  const repo = newRepo()
  const card = writeCard(newTmp('zr-cli-execarm-card-'), 'undeclared.md', {
    frontmatter: ['name: undeclared', 'description: inherits the harness model', 'tools: "*"'],
    body: ['This card deliberately declares no model.', '', 'model: sonnet'],
  })

  const res = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-abc', '--agent-card', card)
  assert.equal(res.status, 0, `an undeclared alias is not an error; stderr:\n${res.stderr}`)
  const rec = JSON.parse(readFileSync(armPath(repo, 2375), 'utf8'))
  assert.equal('expectedModelAlias' in rec, false, 'absent means absent — the reconciler must be able to tell "no request recorded" apart')
  assert.ok(!FAMILY_WORDS.test(res.stderr), `nothing may be printed as recorded when nothing was; got:\n${res.stderr}`)
})

test('10b) a card path that does not exist records nothing and still ARMS (the arm is never a card gate)', () => {
  const repo = newRepo()
  const missing = join(newTmp('zr-cli-execarm-card-'), 'no-such-card.md')

  const res = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-abc', '--agent-card', missing)
  assert.equal(res.status, 0, `a missing card must not block the arm — exclusivity outranks attribution; stderr:\n${res.stderr}`)
  assert.ok(existsSync(armPath(repo, 2375)), 'the arm is still written')
  const rec = JSON.parse(readFileSync(armPath(repo, 2375), 'utf8'))
  assert.equal('expectedModelAlias' in rec, false, 'no card ⇒ no recorded request')
  assert.ok(!FAMILY_WORDS.test(res.stderr), `and no alias is invented for the printed line; got:\n${res.stderr}`)
})

test('10c) the recorded alias survives the OTHER arm paths — a forced re-arm re-reads the card', () => {
  const repo = newRepo()
  assert.equal(roadmap(repo, 'executor-arm', '2375', '--session', 'sess-1', '--executor-id', 'exec-first').status, 0)
  const forced = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-2', '--executor-id', 'exec-second', '--force')
  assert.equal(forced.status, 0, `--force is the deliberate override; stderr:\n${forced.stderr}`)
  const rec = JSON.parse(readFileSync(armPath(repo, 2375), 'utf8'))
  assert.equal(rec.expectedModelAlias, 'opus', 'every write of the arm records the request — a forced re-arm is still a spawn')
  assert.equal(rec.executorId, 'exec-second', 'and the exclusivity semantics are unchanged')
})
