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

test('executor-arm --worktree writes a lane journal with session driver and resolved model', () => {
  const repo = newRepo()
  writePhaseFile(repo, 2380)
  git(repo, 'add', 'roadmap')
  git(repo, 'commit', '-qm', 'seed phase')
  const lane = `${repo}-session-2380`
  tmps.push(lane)
  git(repo, 'worktree', 'add', '-q', '-b', 'session/2380', lane, 'HEAD')
  const res = roadmap(repo, 'executor-arm', '2380', '--session', 'sess-a', '--worktree', lane)
  assert.equal(res.status, 0, res.stderr)
  const journal = JSON.parse(readFileSync(join(repo, '.building', 'codex-2380.json'), 'utf8'))
  assert.equal(journal.worktree, lane)
  assert.equal(journal.driver.lane, 'session')
  assert.equal(typeof journal.driver.model, 'string')
  assert.ok(journal.driver.model.length > 0)
})

test('executor-arm labels allow two same-phase worktree arms; an unlabeled live name refuses', () => {
  const repo = newRepo()
  writePhaseFile(repo, 2381)
  const laneA = join(repo, 'lane-a'); const laneB = join(repo, 'lane-b')
  mkdirSync(laneA); mkdirSync(laneB)
  assert.equal(roadmap(repo, 'executor-arm', '2381', '--session', 'a', '--worktree', laneA, '--label', 'opus').status, 0)
  assert.equal(roadmap(repo, 'executor-arm', '2381', '--session', 'b', '--worktree', laneB, '--label', 'fable').status, 0)
  assert.ok(existsSync(join(repo, '.building', 'codex-2381.opus.json')))
  assert.ok(existsSync(join(repo, '.building', 'codex-2381.fable.json')))
  assert.equal(roadmap(repo, 'executor-arm', '2382', '--session', 'a', '--worktree', laneA).status, 0)
  const second = roadmap(repo, 'executor-arm', '2382', '--session', 'b', '--worktree', laneB)
  assert.equal(second.status, 2)
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

test('2d) an unreadable OWN phase file is named instead of printing a false local-only all-clear', () => {
  const repo = newRepo()
  writeFileSync(join(repo, 'roadmap', 'phases', 'phase-2377.phase.ts'), 'export default { keyFiles: [\n')
  const res = roadmap(repo, 'executor-arm', '2377', '--session', 'sess-abc', '--executor-id', 'exec-1')
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stderr, /phase 2377.*own phase file.*missing, unreadable/i)
  assert.match(res.stderr, /preflight.*undetermined/i)
  assert.doesNotMatch(res.stderr, /all in this worktree's repository/i)
})

test('2e) a declared but non-literal keyFiles field is underivable, never silently empty', () => {
  const repo = newRepo()
  writeFileSync(join(repo, 'roadmap', 'phases', 'phase-2378.phase.ts'), "const files = ['/tmp/product/x.ts']\nexport default { phase: 2378, status: 'in-progress', keyFiles: files }\n")
  const res = roadmap(repo, 'executor-arm', '2378', '--session', 'sess-abc', '--executor-id', 'exec-1')
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stderr, /phase 2378.*own phase file.*underivable keyFiles/i)
})

test('2f) comments and prose mentioning keyFiles do not turn an honestly empty declaration into an error', () => {
  const repo = newRepo()
  writeFileSync(join(repo, 'roadmap', 'phases', 'phase-2379.phase.ts'), "export default { phase: 2379, status: 'in-progress', keyFiles: [ // intentionally empty\n ], notes: 'mentions keyFiles: in prose' }\n")
  const res = roadmap(repo, 'executor-arm', '2379', '--session', 'sess-abc', '--executor-id', 'exec-1')
  assert.equal(res.status, 0, res.stderr)
  assert.doesNotMatch(res.stderr, /underivable keyFiles/i)
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

test('10d) --agent-card with a FLAG-shaped value is a usage error, never a silent fall back to the default card', () => {
  // Falling back to the default here records the default card's alias against an executor the
  // caller meant to point elsewhere, and `result check` would then red an honest return. The
  // sibling --executor-id parse already treats this shape as omitted; this one must not guess.
  const repo = newRepo('zr-cli-execarm-')
  const res = roadmap(repo, 'executor-arm', '2375', '--session', 'sess-abc', '--agent-card', '--force')
  assert.equal(res.status, 1, `a flag-shaped card path is malformed input; stderr: ${res.stderr}`)
  assert.match(res.stderr, /--agent-card/, `the usage line names the flag; stderr: ${res.stderr}`)
  assert.ok(!existsSync(armPath(repo, 2375)), 'and no arm is written on a usage error')
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

// ── 19.2 — THE PRODUCT-TREE CLAIM. The exclusivity guard above is per-PHASE, so it never sees the
// 2333 shape: two DIFFERENT phases, armed from two different lanes, whose keyFiles point into the
// SAME foreign checkout. "Two executors then shared one working tree and one branch" — and the
// cross-repo preflight, which already derives those repos, only narrated them.
//
// So the arm must CLAIM the trees it will write, and refuse when the claim overlaps a sibling arm's.
// The registry of sibling arms is every worktree of this repository: `.building` is PER-WORKTREE, so
// a scan of one root is structurally blind to the lane next door — which is exactly the lane a
// parallel arc executor runs in. And because the claim is derived (a sibling arm resolves through
// ITS OWN root's phase file), the derivation can fail: a sibling arm whose phase file is gone, or a
// worktree git still lists but the filesystem no longer has. Neither may ever block an arm — missing
// evidence is not evidence of a conflict — but neither may be silent either, or a scan that never
// ran is indistinguishable from a scan that found nothing.

/** A linked worktree of `repo` on its own branch: a sibling LANE, with its own `.building`. */
function newLane(repo, branch) {
  const lane = join(newTmp('zr-cli-execarm-lane-'), branch)
  git(repo, 'worktree', 'add', '-q', '-b', branch, lane)
  mkdirSync(join(lane, 'roadmap', 'phases'), { recursive: true })
  return realpathSync(lane)
}

/** A real file inside a foreign product repo, so the derived claim has something to stand on. */
function productKeyFile(product, rel) {
  const p = join(product, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, 'export {}\n')
  return p
}

test('11) a second arm whose product repos OVERLAP a live sibling arm is refused, naming both phases and the shared repo', () => {
  const repo = newRepo()
  const product = newRepo('zr-cli-execarm-product-')
  writePhaseFile(repo, 5731, { keyFiles: [productKeyFile(product, join('src', 'relay', 'a.ts'))] })
  writePhaseFile(repo, 5732, { keyFiles: [productKeyFile(product, join('src', 'relay', 'b.ts'))] })
  assert.equal(roadmap(repo, 'executor-arm', '5731', '--session', 'sess-1', '--executor-id', 'exec-first').status, 0)

  const res = roadmap(repo, 'executor-arm', '5732', '--session', 'sess-2', '--executor-id', 'exec-second')
  assert.equal(res.status, 2, `a second claim on one working tree is REFUSED → exit 2; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /overlap/i, `the refusal names the condition; got:\n${res.stderr}`)
  assert.ok(res.stderr.includes('5731'), `names the phase already holding the tree; got:\n${res.stderr}`)
  assert.ok(res.stderr.includes('5732'), `names the phase being refused; got:\n${res.stderr}`)
  assert.ok(res.stderr.includes(product), `names the shared repo — the tree both would write; got:\n${res.stderr}`)
  assert.match(res.stderr, /force/, 'the message points at the deliberate override')
  assert.ok(!/\bat\s+\w+\s+\(/.test(res.stderr), `a refusal is a message, never a stack; got:\n${res.stderr}`)
  assert.equal(existsSync(armPath(repo, 5732)), false, 'a REFUSED arm is not written — the refusal is the whole point')
  assert.ok(existsSync(armPath(repo, 5731)), 'and the incumbent arm is untouched')
})

test('12) THE CROSS-LANE DIRECTION — the sibling arm lives in ANOTHER worktree of this repo and is still found', () => {
  // The registry has to be the repository's worktree list. Each lane keeps its own `.building`, so
  // an arm scan rooted at the arming worktree sees nothing here and permits two different phases,
  // one executing in the main checkout and one spawned in the adjacent lane, to write the same
  // product checkout.
  const repo = newRepo()
  const lane = newLane(repo, 'lane-b')
  const product = newRepo('zr-cli-execarm-product-')
  writePhaseFile(repo, 5741, { keyFiles: [productKeyFile(product, join('src', 'a.ts'))] })
  writePhaseFile(lane, 5742, { keyFiles: [productKeyFile(product, join('src', 'b.ts'))] })
  assert.equal(roadmap(repo, 'executor-arm', '5741', '--session', 'sess-1', '--executor-id', 'exec-first').status, 0)

  const res = roadmap(lane, 'executor-arm', '5742', '--session', 'sess-2', '--executor-id', 'exec-second')
  assert.equal(res.status, 2, `the sibling lane's arm is as binding as one in this root; stderr:\n${res.stderr}`)
  assert.ok(res.stderr.includes('5741'), `names the phase already holding the tree; got:\n${res.stderr}`)
  assert.ok(res.stderr.includes(product), `names the shared repo; got:\n${res.stderr}`)
  assert.ok(res.stderr.includes(repo), `and names the LANE holding the incumbent arm, or the refusal is unactionable; got:\n${res.stderr}`)
  assert.equal(existsSync(armPath(lane, 5742)), false, 'no arm is written in this lane')
  assert.ok(existsSync(armPath(repo, 5741)), 'and the other lane keeps its arm')
})

test('13) --force arms over the overlap and RECORDS on stderr what it overrode', () => {
  const repo = newRepo()
  const product = newRepo('zr-cli-execarm-product-')
  writePhaseFile(repo, 5751, { keyFiles: [productKeyFile(product, join('src', 'a.ts'))] })
  writePhaseFile(repo, 5752, { keyFiles: [productKeyFile(product, join('src', 'b.ts'))] })
  assert.equal(roadmap(repo, 'executor-arm', '5751', '--session', 'sess-1', '--executor-id', 'exec-first').status, 0)

  const forced = roadmap(repo, 'executor-arm', '5752', '--session', 'sess-2', '--executor-id', 'exec-second', '--force')
  assert.equal(forced.status, 0, `--force is the deliberate override; stderr:\n${forced.stderr}`)
  assert.ok(existsSync(armPath(repo, 5752)), 'the forced arm is written')
  assert.match(forced.stderr, /overrid|forc/i, `the override is stated, not silent; got:\n${forced.stderr}`)
  assert.ok(forced.stderr.includes('5751'), `and it names the arm it overrode; got:\n${forced.stderr}`)
  assert.ok(forced.stderr.includes(product), `and the tree that is now double-claimed; got:\n${forced.stderr}`)
  assert.ok(existsSync(armPath(repo, 5751)), 'forcing past an overlap never clears the sibling arm — that is disarm\'s job, with its own guard')
})

test('14) DISJOINT product repos are untouched — two lanes writing different trees both arm', () => {
  const repo = newRepo()
  const lane = newLane(repo, 'lane-c')
  const productA = newRepo('zr-cli-execarm-product-')
  const productB = newRepo('zr-cli-execarm-product-')
  writePhaseFile(repo, 5761, { keyFiles: [productKeyFile(productA, join('src', 'a.ts'))] })
  writePhaseFile(lane, 5762, { keyFiles: [productKeyFile(productB, join('src', 'b.ts'))] })
  assert.equal(roadmap(repo, 'executor-arm', '5761', '--session', 'sess-1', '--executor-id', 'exec-first').status, 0)

  const res = roadmap(lane, 'executor-arm', '5762', '--session', 'sess-2', '--executor-id', 'exec-second')
  assert.equal(res.status, 0, `two executors on two different trees is the sanctioned parallel path; stderr:\n${res.stderr}`)
  assert.ok(existsSync(armPath(lane, 5762)), 'the disjoint arm is written')
  assert.ok(existsSync(armPath(repo, 5761)), 'and the sibling arm is untouched')
})

test('15) LOCAL-only phases never trip it — "no product repos" is not "the same product repos"', () => {
  // Nearly every phase in this consumer declares keyFiles in its own repository and derives an
  // EMPTY product set. An intersection test that treats empty-∩-empty as a hit would refuse the
  // entire roadmap the moment two lanes were armed at once.
  const repo = newRepo()
  const lane = newLane(repo, 'lane-d')
  writePhaseFile(repo, 5771, { keyFiles: [join(repo, 'roadmap', 'backlog.ts')] })
  writePhaseFile(lane, 5772, { keyFiles: [join(lane, 'roadmap', 'backlog.ts'), join(lane, 'cli', 'lib', 'x.mjs')] })
  assert.equal(roadmap(repo, 'executor-arm', '5771', '--session', 'sess-1', '--executor-id', 'exec-first').status, 0)

  const res = roadmap(lane, 'executor-arm', '5772', '--session', 'sess-2', '--executor-id', 'exec-second')
  assert.equal(res.status, 0, `a single-repo phase claims no foreign tree at all; stderr:\n${res.stderr}`)
  assert.ok(existsSync(armPath(lane, 5772)), 'the local arm is written')
  assert.ok(existsSync(armPath(repo, 5771)), 'and the sibling local arm is untouched')
})

test('16) a STALE sibling arm — its phase file is gone — never blocks, and the skip is NAMED on stderr', () => {
  // The sibling arm outlived the phase file the claim would be derived from, so there is nothing
  // left to compare. Blocking on that would strand every lane behind the first arm anyone forgot
  // to sweep; staying silent would make it look like the scan cleared the tree.
  const repo = newRepo()
  const lane = newLane(repo, 'lane-e')
  const product = newRepo('zr-cli-execarm-product-')
  writePhaseFile(repo, 5781, { keyFiles: [productKeyFile(product, join('src', 'a.ts'))] })
  writePhaseFile(lane, 5782, { keyFiles: [productKeyFile(product, join('src', 'b.ts'))] })
  assert.equal(roadmap(repo, 'executor-arm', '5781', '--session', 'sess-1', '--executor-id', 'exec-first').status, 0)
  rmSync(join(repo, 'roadmap', 'phases', 'phase-5781.phase.ts'))

  const res = roadmap(lane, 'executor-arm', '5782', '--session', 'sess-2', '--executor-id', 'exec-second')
  assert.equal(res.status, 0, `an underivable sibling claim is NO overlap, never a block; stderr:\n${res.stderr}`)
  assert.ok(existsSync(armPath(lane, 5782)), 'the arm is written')
  assert.ok(res.stderr.includes('5781'), `the skipped sibling arm is named; got:\n${res.stderr}`)
  assert.match(res.stderr, /skip|stale|no phase file|unread|missing/i, `and the skip says what it is; got:\n${res.stderr}`)
})

test('16b) a terminal sibling arm is stale and never blocks an overlapping phase', () => {
  const repo = newRepo()
  const product = newRepo('zr-cli-execarm-product-')
  writePhaseFile(repo, 5783, { status: 'done', keyFiles: [productKeyFile(product, join('src', 'a.ts'))] })
  writePhaseFile(repo, 5784, { keyFiles: [productKeyFile(product, join('src', 'b.ts'))] })
  mkdirSync(join(repo, '.building'), { recursive: true })
  writeFileSync(armPath(repo, 5783), JSON.stringify({ sessionId: 'old', executorId: 'finished', armedAt: isoAgo(60) }) + '\n')
  const res = roadmap(repo, 'executor-arm', '5784', '--session', 'new', '--executor-id', 'next')
  assert.equal(res.status, 0, `a terminal phase's fossil arm is not a live product claim; stderr:\n${res.stderr}`)
  assert.ok(existsSync(armPath(repo, 5784)))
})

test('16c) safety overlap scans are not truncated at the liveness four-repository cap', () => {
  const repo = newRepo()
  const products = Array.from({ length: 5 }, () => newRepo('zr-cli-execarm-product-'))
  const firstKeys = products.map((product, i) => productKeyFile(product, join('src', `${i}.ts`)))
  writePhaseFile(repo, 5785, { keyFiles: firstKeys })
  writePhaseFile(repo, 5786, { keyFiles: [productKeyFile(products[4], join('src', 'shared.ts'))] })
  assert.equal(roadmap(repo, 'executor-arm', '5785', '--session', 'first', '--executor-id', 'first').status, 0)
  const res = roadmap(repo, 'executor-arm', '5786', '--session', 'second', '--executor-id', 'second')
  assert.equal(res.status, 2, `the fifth declared repo remains safety-relevant; stderr:\n${res.stderr}`)
  assert.ok(res.stderr.includes(products[4]))
})

test('17) a PRUNED sibling worktree — git still lists it, the disk no longer has it — never blocks, with a stderr note', () => {
  const repo = newRepo()
  const lane = newLane(repo, 'lane-f')
  const product = newRepo('zr-cli-execarm-product-')
  writePhaseFile(lane, 5791, { keyFiles: [productKeyFile(product, join('src', 'a.ts'))] })
  writePhaseFile(repo, 5792, { keyFiles: [productKeyFile(product, join('src', 'b.ts'))] })
  assert.equal(roadmap(lane, 'executor-arm', '5791', '--session', 'sess-1', '--executor-id', 'exec-first').status, 0)
  rmSync(lane, { recursive: true, force: true }) // the lane is gone; `git worktree list` still reports it, prunable

  const res = roadmap(repo, 'executor-arm', '5792', '--session', 'sess-2', '--executor-id', 'exec-second')
  assert.equal(res.status, 0, `an unreadable sibling root is skipped, never a block; stderr:\n${res.stderr}`)
  assert.ok(existsSync(armPath(repo, 5792)), 'the arm is written')
  assert.ok(res.stderr.includes(lane), `the unreadable root is named; got:\n${res.stderr}`)
  assert.match(res.stderr, /skip|prun|unread|missing|gone/i, `and the note says what happened to it; got:\n${res.stderr}`)
})

test('18) an UNREADABLE sibling phase file never collapses to an empty claim silently', () => {
  const repo = newRepo()
  const lane = newLane(repo, 'lane-g')
  const product = newRepo('zr-cli-execarm-product-')
  writeFileSync(join(lane, 'roadmap', 'phases', 'phase-5793.phase.ts'), 'export default { keyFiles: [\n')
  mkdirSync(join(lane, '.building'), { recursive: true })
  writeFileSync(armPath(lane, 5793), JSON.stringify({ sessionId: 'sess-1', executorId: 'exec-first', armedAt: new Date().toISOString() }) + '\n')
  writeBeacon(lane, 5793, [{ ts: new Date().toISOString(), phase: 5793, event: 'task-start', task: '5793.1' }])
  writePhaseFile(repo, 5794, { keyFiles: [productKeyFile(product, join('src', 'b.ts'))] })

  const res = roadmap(repo, 'executor-arm', '5794', '--session', 'sess-2', '--executor-id', 'exec-second')
  assert.equal(res.status, 0, `underivable sibling evidence is a note, not a fabricated conflict; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /phase 5793.*missing, unreadable, or keyFiles underivable/i, `the failed scan is named; got:\n${res.stderr}`)
})
