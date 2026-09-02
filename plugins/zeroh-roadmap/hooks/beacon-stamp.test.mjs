#!/usr/bin/env node
/**
 * beacon-stamp.test.mjs — the commit BEACON hook, driven end to end over real git estates.
 *
 * The hook is a PostToolUse (Bash) shell script: it reads the tool payload on stdin, fires only on
 * a real `git … commit` segment, resolves the MAIN checkout from the commit target via the git
 * COMMON dir, finds the sidecar whose `.worktree` contains that target, and appends one JSONL line
 * to <registry>/<ARC-ID>-executor.jsonl. Everything asserted here is an OBSERVABLE effect: the exit
 * code, which files exist afterwards, and what is inside them — never the script's internals.
 *
 * The registry lives under the consumer's ROADMAP ROOT, which is discovered, not pinned: `roadmap/`
 * then `docs/roadmap/`, first one carrying a marker (roadmap.config.json or phases/), ROADMAP_ROOT
 * overriding both, and an ambiguous tree refused — the same rules cli/lib/roadmap-root.mjs applies.
 * A docs/roadmap consumer whose executors stamp into a toplevel roadmap/ nothing reads is silent by
 * construction: every lane-liveness row reports its arcs dead while they are working.
 *
 * And the refusal must stay FAIL-SOFT. This hook rides a commit; a beacon that exits non-zero or
 * hangs turns a bookkeeping miss into a failed commit, so ambiguity costs one stderr line and exit 0.
 *
 * Run: capbuild node --test hooks/beacon-stamp.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, 'beacon-stamp.sh')
const ARC = 'ARC-2600-beacon'

// A hermetic git identity: no global/system config, so a contributor's hooksPath, gpgsign or
// commit template can never reach into a fixture repo.
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

const tmps = []
process.on('exit', () => {
  for (const d of tmps) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
})

function newTmp() {
  const d = mkdtempSync(join(tmpdir(), 'zr-beacon-'))
  tmps.push(d)
  return realpathSync(d)
}

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore', env: { ...process.env, ...GIT_ENV } })

/** A main checkout with one commit plus a LINKED worktree — the real arc shape: the sidecars live
 *  only in the main checkout, the commit lands in the worktree. */
function makeRepo() {
  const base = newTmp()
  const main = join(base, 'main')
  mkdirSync(main, { recursive: true })
  git(base, ['init', '-q', '-b', 'main', main])
  writeFileSync(join(main, 'README.md'), '# fixture\n')
  git(main, ['add', 'README.md'])
  git(main, ['commit', '-qm', 'chore: seed'])
  const wt = join(base, 'wt')
  git(main, ['worktree', 'add', '-q', '-b', 'arc/lane', wt])
  return { base, main, wt }
}

let commitSeq = 0
/** Land a real commit carrying `subject`, and return `%h %s` — what the beacon's detail must be. */
function commitIn(dir, subject) {
  const name = `work-${++commitSeq}.txt`
  writeFileSync(join(dir, name), `${commitSeq}\n`)
  git(dir, ['add', name])
  git(dir, ['commit', '-qm', subject])
  return execFileSync('git', ['-C', dir, 'log', '-1', '--format=%h %s'], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim()
}

/** A roadmap root at `<parent>/<rel>` with an arcs/.building registry, marked as a root by default
 *  (a roadmap.config.json inside it — one of the two markers roadmap-root.mjs probes for). */
function makeRoot(parent, rel, { mark = true } = {}) {
  const root = join(parent, rel)
  mkdirSync(join(root, 'arcs', '.building'), { recursive: true })
  if (mark) writeFileSync(join(root, 'roadmap.config.json'), JSON.stringify({ configVersion: 1 }))
  return root
}

const registerArc = (root, worktree, arcId = ARC) =>
  writeFileSync(join(root, 'arcs', '.building', `${arcId}.json`), JSON.stringify({ arcId, worktree, phase: 2600, status: 'building' }))

const beaconPath = (root, arcId = ARC) => join(root, 'arcs', '.building', `${arcId}-executor.jsonl`)

/** The beacon lines at `root`, or [] when no beacon file was ever created. */
function beaconLines(root, arcId = ARC) {
  const p = beaconPath(root, arcId)
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

/** Drive the REAL hook: the tool payload on stdin, exactly as Claude Code delivers it. */
function runHook({ cwd, command, sessionId = 'sess-beacon', env = {} }) {
  const childEnv = { ...process.env, ...GIT_ENV }
  delete childEnv.ROADMAP_ROOT // never inherit the operator's own override into a default-layout case
  Object.assign(childEnv, env)
  const payload = { cwd, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command } }
  if (sessionId !== null) payload.session_id = sessionId
  const r = spawnSync('bash', [HOOK], { cwd, input: JSON.stringify(payload), encoding: 'utf8', timeout: 60_000, env: childEnv })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const stderrLines = (s) => s.split('\n').filter((l) => l.trim() !== '')

// ── 1. the default layout, pinned exactly as it behaves today ────────────────────────────────

test('1) default layout: a commit in a registered worktree appends ONE beacon under roadmap/arcs/.building', () => {
  const { main, wt } = makeRepo()
  const root = makeRoot(main, 'roadmap')
  registerArc(root, wt)
  const detail = commitIn(wt, 'feat(lane): phase 2600 — 2600.1 the task')
  assert.equal(existsSync(beaconPath(root)), false, 'no beacon before the hook runs')

  const r = runHook({ cwd: wt, command: 'git commit -m "feat(lane): phase 2600 — 2600.1 the task"' })

  assert.equal(r.code, 0, `hook must exit 0; stderr: ${r.stderr}`)
  const lines = beaconLines(root)
  assert.equal(lines.length, 1, `exactly one beacon line, got ${JSON.stringify(lines)}`)
  assert.deepEqual(Object.keys(lines[0]).sort(), ['detail', 'event', 'phase', 'session_id', 'ts'])
  assert.equal(lines[0].event, 'commit')
  assert.equal(lines[0].phase, 2600, 'the phase number is READ from the commit subject')
  assert.equal(lines[0].detail, detail, 'detail is the real `%h %s` of the commit that just landed')
  assert.equal(lines[0].session_id, 'sess-beacon')
  assert.match(lines[0].ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
})

test('2) default layout: a subject with no phase stamps phase NULL, and a payload with no session_id omits the key', () => {
  const { main, wt } = makeRepo()
  const root = makeRoot(main, 'roadmap')
  registerArc(root, wt)
  const detail = commitIn(wt, 'chore: tidy the fixture tree')

  const r = runHook({ cwd: wt, command: 'git commit -m "chore: tidy the fixture tree"', sessionId: null })

  assert.equal(r.code, 0)
  const lines = beaconLines(root)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].phase, null, 'a number is never fabricated for a subject that carries none')
  assert.equal('phase' in lines[0], true, 'the key is present and null, not dropped')
  assert.equal('session_id' in lines[0], false, 'session_id appears only when the payload carries one')
  assert.equal(lines[0].detail, detail)
})

// ── 2. the docs/roadmap consumer — the reason this hook needs root discovery ──────────────────

test('3) docs/roadmap layout: the beacon lands under docs/roadmap/arcs/.building, and NOTHING at the toplevel', () => {
  const { main, wt } = makeRepo()
  const root = makeRoot(main, join('docs', 'roadmap'))
  registerArc(root, wt)
  const detail = commitIn(wt, 'feat(lane): phase 2600 — 2600.2 the docs-rooted task')

  const r = runHook({ cwd: wt, command: 'git commit -m "feat(lane): phase 2600 — 2600.2 the docs-rooted task"' })

  assert.equal(r.code, 0, `hook must exit 0; stderr: ${r.stderr}`)
  const lines = beaconLines(root)
  assert.equal(lines.length, 1, `the beacon must land where arc-status reads it: ${beaconPath(root)}`)
  assert.equal(lines[0].event, 'commit')
  assert.equal(lines[0].phase, 2600)
  assert.equal(lines[0].detail, detail)
  assert.equal(existsSync(join(main, 'roadmap')), false, 'a toplevel roadmap/ was never created — a beacon nothing reads is silence')
})

// ── 3. ambiguity — refuse, name it once, and never block the commit ───────────────────────────

test('4) ambiguous layout (both roots marked): exit 0, NO beacon anywhere, exactly one line on stderr', () => {
  const { main, wt } = makeRepo()
  const top = makeRoot(main, 'roadmap')
  const docs = makeRoot(main, join('docs', 'roadmap'))
  registerArc(top, wt)
  registerArc(docs, wt)
  commitIn(wt, 'feat(lane): phase 2600 — 2600.3 into an ambiguous tree')

  const r = runHook({ cwd: wt, command: 'git commit -m "feat(lane): phase 2600 — 2600.3 into an ambiguous tree"' })

  assert.equal(r.code, 0, 'a beacon failure must never fail the commit that carried it')
  assert.deepEqual(beaconLines(top), [], 'guessing a root is how half a consumer\'s records go unread')
  assert.deepEqual(beaconLines(docs), [], 'and the other root is not a safe guess either')
  const lines = stderrLines(r.stderr)
  assert.equal(lines.length, 1, `exactly one line of diagnosis, got: ${JSON.stringify(lines)}`)
  assert.match(lines[0], /roadmap/, 'the line names the subject')
  assert.match(lines[0], /ambig|more than one|multiple/i, 'the line names the PROBLEM, not some downstream symptom')
})

// ── 4. the override, which is also the remedy the refusal advertises ──────────────────────────

test('5) ROADMAP_ROOT (relative) wins over a marked roadmap/ and is resolved against the main checkout', () => {
  const { main, wt } = makeRepo()
  const decoy = makeRoot(main, 'roadmap')
  const named = makeRoot(main, join('ops', 'roadmap'), { mark: false })
  registerArc(decoy, wt)
  registerArc(named, wt)
  const detail = commitIn(wt, 'feat(lane): phase 2600 — 2600.4 under an override')

  const r = runHook({
    cwd: wt,
    command: 'git commit -m "feat(lane): phase 2600 — 2600.4 under an override"',
    env: { ROADMAP_ROOT: 'ops/roadmap' },
  })

  assert.equal(r.code, 0, `hook must exit 0; stderr: ${r.stderr}`)
  const lines = beaconLines(named)
  assert.equal(lines.length, 1, `the override names the root: ${beaconPath(named)}`)
  assert.equal(lines[0].detail, detail)
  assert.deepEqual(beaconLines(decoy), [], 'the override outranks a marked candidate; it is not a fallback')
})

test('6) ROADMAP_ROOT (absolute) is used AS-IS, never joined onto the checkout', () => {
  const { base, main, wt } = makeRepo()
  const decoy = makeRoot(main, 'roadmap')
  const outside = makeRoot(base, 'elsewhere', { mark: false })
  registerArc(decoy, wt)
  registerArc(outside, wt)
  const detail = commitIn(wt, 'feat(lane): phase 2600 — 2600.5 under an absolute override')

  const r = runHook({
    cwd: wt,
    command: 'git commit -m "feat(lane): phase 2600 — 2600.5 under an absolute override"',
    env: { ROADMAP_ROOT: outside },
  })

  assert.equal(r.code, 0, `hook must exit 0; stderr: ${r.stderr}`)
  assert.equal(beaconLines(outside).length, 1, `the absolute override is the root: ${beaconPath(outside)}`)
  assert.equal(beaconLines(outside)[0].detail, detail)
  assert.deepEqual(beaconLines(decoy), [])
  assert.equal(existsSync(join(main, 'elsewhere')), false, 'an absolute override is not resolved against the checkout')
})

// ── 5. fail-soft, unchanged: the hook rides a commit and may never cost one ────────────────────

test('7) fail-soft: a command that is not a `git commit` exits 0 and stamps nothing', () => {
  const { main, wt } = makeRepo()
  const root = makeRoot(main, 'roadmap')
  registerArc(root, wt)
  commitIn(wt, 'feat(lane): phase 2600 — 2600.6 already landed')

  for (const command of ['git status --porcelain', 'ls -la', 'git commit-graph write', 'echo "git commit -m x"']) {
    const r = runHook({ cwd: wt, command })
    assert.equal(r.code, 0, `${command} must exit 0`)
    assert.deepEqual(beaconLines(root), [], `${command} is not a commit and must stamp nothing`)
  }
})

test('8) fail-soft: a commit OUTSIDE every registered worktree exits 0 and stamps nothing', () => {
  const { base, main, wt } = makeRepo()
  const root = makeRoot(main, 'roadmap')
  registerArc(root, join(base, 'some-other-worktree')) // the sidecar does not own this commit target
  commitIn(wt, 'feat(lane): phase 2600 — 2600.7 an unclaimed commit')

  const r = runHook({ cwd: wt, command: 'git commit -m "feat(lane): phase 2600 — 2600.7 an unclaimed commit"' })

  assert.equal(r.code, 0)
  assert.deepEqual(beaconLines(root), [], 'an unregistered lane vouches for no arc')
})

test('9) fail-soft: no roadmap root at all exits 0 and creates nothing', () => {
  const { main, wt } = makeRepo()
  commitIn(wt, 'feat(lane): phase 2600 — 2600.8 in a non-consumer tree')

  const r = runHook({ cwd: wt, command: 'git commit -m "feat(lane): phase 2600 — 2600.8 in a non-consumer tree"' })

  assert.equal(r.code, 0)
  assert.equal(existsSync(join(main, 'roadmap')), false, 'a hook never scaffolds a registry it did not find')
  assert.equal(existsSync(join(main, 'docs')), false)
})
