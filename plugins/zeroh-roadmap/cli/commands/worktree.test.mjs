#!/usr/bin/env node
/**
 * TEST-FIRST for `roadmap worktree up|status|reset` (phase 2146.4 — cli/commands/worktree.mjs
 * does not exist yet, so bin/roadmap.mjs answers "unknown command" and every case below is RED
 * until it lands). The lib underneath (cli/lib/worktree.mjs) is already green; what this file
 * pins is the COMMAND SURFACE a session actually types, driven through the REAL bin the way
 * phase.test.mjs drives `phase start`.
 *
 * Three properties carry the lane, and each is a hazard if it slips:
 *  - `up` is what the session cds into. Its last stdout line must be the BARE path (a session
 *    runs `cd "$(roadmap worktree up)"`, so a prefix, a quote or a trailing banner breaks it),
 *    and a re-run must return the SAME dir with the scratch head UNTOUCHED — an `up` that
 *    resets (or re-creates) would silently eat the half-done phase living in that worktree.
 *    Deps: production installDeps runs `npm ci`, so the fixture repo carries NO package.json
 *    anywhere and the test asserts that shape — nothing installed, exit still 0.
 *  - `status` is the leak detector: it prints one row per REGISTRY slot with the claimer pid
 *    and its liveness, and it must NOT prune dead rows (a spawned CLI's pid is dead by the time
 *    the next command runs, and a pruning status would hide exactly the leaked worktrees an
 *    operator is looking for). The row is asserted on its vocabulary, never on a liveness verdict
 *    the test cannot own.
 *  - `reset` is the one destructive act. On a clean worktree it hard-resets the scratch head to
 *    the requested base; on a DIRTY one the lib's typed refusal must surface as exit 2 with the
 *    path named on stderr — a reset that ate uncommitted work is the failure the lane exists to
 *    prevent. With no --base it falls back to the consumer's integration ref
 *    (mergePolicy.autonomousPushRefs[0]); the fixture names that ref `trunk` and has NO develop
 *    branch at all, so a hardcoded 'develop' fails loudly instead of passing by coincidence.
 *
 * PINNED for the implementer: every subcommand is run from the PRIMARY checkout and resolves
 * the repo root from there (gitToplevel/mainCheckout both answer the same thing at that cwd);
 * `reset` finds its target through the slot registry (the caller's claim), not by inspecting cwd.
 *
 * Real seeded git repos (execFileSync git, never a shell string), worktrees land beside the root
 * and are swept with it. Run:
 *   capbuild node --test cli/commands/worktree.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

/** The fixture's integration ref. Deliberately NOT 'develop': the no---base case must prove the
 *  config is READ, and a hardcoded fallback has no branch to land on here. */
const INTEGRATION = 'trunk'

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

/** git in any checkout, identity pinned on the command line. */
const gitIn = (cwd, ...a) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  }).trim()

/** One commit in any checkout; each writes its own file so no commit is empty. */
function commitIn(dir, msg, rel) {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, `${msg}\n`)
  gitIn(dir, 'add', '--', rel)
  gitIn(dir, 'commit', '-q', '-m', msg)
  return gitIn(dir, 'rev-parse', 'HEAD')
}

/** The minimal §1 config a command may load, with the worktree lane armed and the integration
 *  ref named. Written into the repo so loadConfig(cwd) resolves from the primary AND from any
 *  worktree of it (the file is committed, so the checkout carries it). */
const configFor = (root) => ({
  configVersion: 1,
  gateCommands: {
    lint: 'true',
    types: 'true',
    unit: 'true',
    integration: 'true',
    build: 'true',
    e2e: 'none',
    emit: 'true',
  },
  executionIsolation: 'worktree',
  mergePolicy: {
    arcIntegration: 'autonomous',
    maxOpenFollowups: 0,
    autonomousPushRefs: [INTEGRATION],
    primaryCheckout: root,
  },
})

/**
 * A configured consumer repo: one seed commit, the integration ref as a NON-checked-out branch
 * (the primary sits elsewhere, exactly as a session's checkout does), and NO package.json in the
 * tree — production installDeps (`npm ci`) must therefore have nothing to do.
 */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'zr-wtcmd-'))
  bases.push(root)
  for (let k = 1; k <= 4; k += 1) bases.push(`${root}-wt-${k}`)
  gitIn(root, 'init', '-q')
  gitIn(root, 'config', 'user.email', 't@t')
  gitIn(root, 'config', 'user.name', 't')
  mkdirSync(join(root, 'roadmap'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'roadmap.config.json'), JSON.stringify(configFor(root), null, 2) + '\n')
  writeFileSync(join(root, '.gitignore'), '.building/\n')
  writeFileSync(join(root, 'src.txt'), 'seed\n')
  gitIn(root, 'add', '-A')
  gitIn(root, 'commit', '-q', '-m', 'seed: the integration branch exists')
  const seed = gitIn(root, 'rev-parse', 'HEAD')
  if (gitIn(root, 'rev-parse', '--abbrev-ref', 'HEAD') === INTEGRATION) gitIn(root, 'branch', '-m', `${INTEGRATION}-primary`)
  gitIn(root, 'branch', INTEGRATION)
  assert.equal(
    existsSync(join(root, 'package.json')),
    false,
    'fixture precondition: no package.json anywhere, so a production dep install has nothing to install',
  )
  return {
    root,
    seed,
    git: (...a) => gitIn(root, ...a),
    commit: (msg, rel) => commitIn(root, msg, rel ?? `work/${msg.replace(/\W+/g, '-')}.txt`),
    head: () => gitIn(root, 'rev-parse', 'HEAD'),
    branch: () => gitIn(root, 'rev-parse', '--abbrev-ref', 'HEAD'),
    integrationTip: () => gitIn(root, 'rev-parse', `refs/heads/${INTEGRATION}`),
    /** -uall so an untracked directory is not collapsed to `?? dir/`. */
    status: (dir) => gitIn(dir, 'status', '--porcelain', '-uall'),
    /** Absolute paths of every worktree git knows about, main checkout first. */
    worktrees: () =>
      gitIn(root, 'worktree', 'list', '--porcelain')
        .split('\n')
        .filter((l) => l.startsWith('worktree '))
        .map((l) => l.slice('worktree '.length)),
  }
}

/** Drive the REAL bin. A timeout guards the npm-ci hazard: a hung install must fail the test,
 *  never hang the tier. */
function runWt(cwd, ...args) {
  const res = spawnSync('node', [BIN, 'worktree', ...args], { cwd, encoding: 'utf8', timeout: 120_000 })
  assert.ok(!res.error, `roadmap worktree ${args.join(' ')} failed to run: ${res.error?.message}`)
  return res
}

const lastLine = (text) =>
  text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .pop() ?? ''

// ── up ────────────────────────────────────────────────────────────────────────────────

test('worktree up — claims slot 1, prints the BARE dir as its last stdout line, and creates a real wt/1 worktree without installing deps', () => {
  const r = makeRepo()

  const res = runWt(r.root, 'up')

  assert.equal(res.status, 0, `up must exit 0 on a fresh repo; stderr:\n${res.stderr}`)
  const dir = lastLine(res.stdout)
  assert.ok(
    isAbsolute(dir) && existsSync(dir),
    `the LAST stdout line must be the worktree path itself — the session runs cd "$(roadmap worktree up)"; got: ${JSON.stringify(dir)}\nfull stdout:\n${res.stdout}`,
  )
  assert.equal(dir, `${r.root}-wt-1`, 'the first claim is slot 1, whose dir is the root plus the -wt-<k> suffix')
  assert.deepEqual(r.worktrees(), [r.root, dir], `git itself must know the worktree: ${r.worktrees().join(', ')}`)
  assert.equal(gitIn(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'wt/1', 'the worktree sits on its scratch head wt/1, never detached')
  assert.equal(gitIn(dir, 'rev-parse', 'HEAD'), r.seed, 'the scratch head starts at the integration tip (= the repo tip in this fixture)')
  assert.equal(existsSync(join(dir, 'src.txt')), true, 'the checkout is real: the base ref’s files are on disk')

  // Deps: a repo with no package.json must not trigger `npm ci` — and if it were attempted
  // anyway it would fail, which the exit code above already refuses to hide.
  assert.equal(existsSync(join(dir, 'node_modules')), false, 'nothing to install means nothing installed')
  assert.equal(existsSync(join(dir, 'package.json')), false, 'and the command invents no package.json')

  // The primary checkout belongs to a sibling session mid-phase.
  assert.equal(r.head(), r.seed, 'up never moves the primary checkout’s HEAD')
  assert.equal(
    r.status(r.root)
      .split('\n')
      .filter((l) => l.trim() && !l.includes('.building/'))
      .join('\n'),
    '',
    'nor leaves dirt in it (the slot registry under .building is gitignored)',
  )
})

test('worktree up — a second run returns the SAME dir and leaves in-flight work on the scratch head untouched', () => {
  const r = makeRepo()
  const first = runWt(r.root, 'up')
  assert.equal(first.status, 0, `the first up must exit 0; stderr:\n${first.stderr}`)
  const dir = lastLine(first.stdout)

  // A phase's worth of work is sitting in the worktree when the next `worktree up` runs.
  const inFlight = commitIn(dir, 'feat(cli): phase 2146 — 2146.4 half-done work', 'work/in-flight.txt')
  const scratchNotes = join(dir, 'scratch', 'notes.md')
  mkdirSync(dirname(scratchNotes), { recursive: true })
  writeFileSync(scratchNotes, 'uncommitted session state\n')

  const again = runWt(r.root, 'up')

  assert.equal(again.status, 0, `a re-run of up must exit 0 — it runs at every phase start; stderr:\n${again.stderr}`)
  assert.equal(lastLine(again.stdout), dir, 'the same session gets the same worktree back (the dead prior claimer’s slot is reclaimed, not a second one)')
  assert.equal(r.worktrees().length, 2, 'main checkout + ONE slot: up reuses, it never accumulates worktrees')
  assert.equal(
    gitIn(dir, 'rev-parse', 'HEAD'),
    inFlight,
    'up must NOT reset the scratch head — resetting is `worktree reset`’s job, and an unconditional reset here would drop the in-flight phase',
  )
  assert.equal(readFileSync(scratchNotes, 'utf8'), 'uncommitted session state\n', 'nor touch the worktree’s uncommitted files')
})

// ── status ────────────────────────────────────────────────────────────────────────────

test('worktree status — prints one row per REGISTRY slot carrying slot, dir, claimer pid and live|dead (dead rows are never pruned)', () => {
  const r = makeRepo()
  const up = runWt(r.root, 'up')
  assert.equal(up.status, 0, `up must exit 0; stderr:\n${up.stderr}`)
  const dir = lastLine(up.stdout)
  const claimer = up.pid
  assert.ok(Number.isInteger(claimer), 'fixture: the spawned CLI’s pid is the claimer the registry recorded')

  const res = runWt(r.root, 'status')

  assert.equal(res.status, 0, `status must exit 0 whenever it can read the registry; stderr:\n${res.stderr}`)
  const rows = res.stdout.split('\n').filter((l) => l.includes(dir))
  assert.equal(
    rows.length,
    1,
    `exactly one row for the claimed slot must be printed — a status that PRUNES the dead claimer hides precisely the leaked worktrees an operator is hunting; stdout:\n${res.stdout}`,
  )
  const row = rows[0]
  assert.ok(
    new RegExp(`(^|\\D)${claimer}(\\D|$)`).test(row),
    `the row must name the CLAIMER pid ${claimer} (the registry's identity column), got: ${row}`,
  )
  assert.match(row, /\b(live|dead)\b/i, `the row must carry the live|dead liveness vocabulary, got: ${row}`)
  const beforeDir = row.slice(0, row.indexOf(dir))
  assert.match(
    beforeDir,
    /(^|\D)1(\D|$)/,
    `the row must lead with its SLOT number (1) before the dir, got: ${row}`,
  )
})

test('worktree status — a repo with no claims exits 0 and prints no slot row', () => {
  const r = makeRepo()

  const res = runWt(r.root, 'status')

  assert.equal(res.status, 0, `an empty registry is not an error — "no slots claimed" is a fine answer; stderr:\n${res.stderr}`)
  assert.equal(
    res.stdout.split('\n').filter((l) => l.includes(`${r.root}-wt-`)).length,
    0,
    `nothing is claimed, so no slot row may be printed; stdout:\n${res.stdout}`,
  )
  assert.equal(r.worktrees().length, 1, 'status is READ-ONLY: it must never create a worktree as a side effect')
})

// ── reset ─────────────────────────────────────────────────────────────────────────────

test('worktree reset --base <sha> — hard-resets the clean scratch head onto the sha, moving the wt/1 ref and dropping last phase’s commit', () => {
  const r = makeRepo()
  const up = runWt(r.root, 'up')
  assert.equal(up.status, 0, `up must exit 0; stderr:\n${up.stderr}`)
  const dir = lastLine(up.stdout)

  // Last phase's work, already landed and curated elsewhere: the scratch head is disposable.
  const stale = commitIn(dir, 'feat(cli): phase 2145 — 2145.1 last phase’s work', 'work/last-phase.txt')
  const tip = r.commit('the integration branch moves on', 'src/tip.txt')
  assert.notEqual(stale, tip, 'fixture bug: the reset must have somewhere to go')

  const res = runWt(r.root, 'reset', '--base', tip)

  assert.equal(res.status, 0, `a clean worktree resets cleanly → exit 0; stderr:\n${res.stderr}`)
  assert.equal(gitIn(dir, 'rev-parse', 'HEAD'), tip, 'the worktree HEAD is the requested base')
  assert.equal(r.git('rev-parse', 'refs/heads/wt/1'), tip, 'the scratch BRANCH ref moved — not a detached HEAD the next commit would orphan')
  assert.equal(gitIn(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'wt/1', 'and the worktree is still on wt/1')
  assert.equal(existsSync(join(dir, 'src', 'tip.txt')), true, 'a HARD reset brings the base’s files into the worktree')
  assert.equal(existsSync(join(dir, 'work', 'last-phase.txt')), false, 'last phase’s file is gone — nothing accumulates across phases')
  assert.ok(
    !gitIn(dir, 'rev-list', 'HEAD').split('\n').includes(stale),
    'last phase’s commit is no longer reachable from the scratch head',
  )
  assert.equal(r.status(dir), '', 'the worktree is clean afterwards')
  assert.equal(r.head(), tip, 'the primary checkout’s own HEAD is untouched by the reset')
})

test('worktree reset with no --base — falls back to the consumer’s integration ref (mergePolicy.autonomousPushRefs[0]), never a hardcoded develop', () => {
  const r = makeRepo()
  const up = runWt(r.root, 'up')
  assert.equal(up.status, 0, `up must exit 0; stderr:\n${up.stderr}`)
  const dir = lastLine(up.stdout)

  // The integration ref advances while the session was mid-phase; the primary is NOT on it.
  const advanced = r.commit('a sibling landed on the integration branch', 'src/sibling.txt')
  r.git('update-ref', `refs/heads/${INTEGRATION}`, advanced)
  assert.equal(r.integrationTip(), advanced, 'fixture bug: the integration ref must have moved')
  assert.notEqual(gitIn(dir, 'rev-parse', 'HEAD'), advanced, 'fixture bug: the worktree must be behind, or the reset proves nothing')
  let hasDevelop = true
  try {
    gitIn(r.root, 'rev-parse', '--verify', 'refs/heads/develop')
  } catch {
    hasDevelop = false
  }
  assert.equal(hasDevelop, false, 'fixture bug: there must be NO develop branch — that is what makes a hardcoded fallback fail loudly')

  const res = runWt(r.root, 'reset')

  assert.equal(res.status, 0, `a bare reset must resolve its base from the config, not refuse; stderr:\n${res.stderr}`)
  assert.equal(gitIn(dir, 'rev-parse', 'HEAD'), advanced, `the default base is ${INTEGRATION} — the ref the consumer's mergePolicy names`)
  assert.equal(existsSync(join(dir, 'src', 'sibling.txt')), true, 'the sibling’s landed file is in the worktree afterwards')
})

test('worktree reset — a DIRTY worktree refuses with exit 2 naming the path, HEAD unmoved and the work byte-intact', () => {
  const r = makeRepo()
  const up = runWt(r.root, 'up')
  assert.equal(up.status, 0, `up must exit 0; stderr:\n${up.stderr}`)
  const dir = lastLine(up.stdout)
  const before = gitIn(dir, 'rev-parse', 'HEAD')
  const tip = r.commit('the integration branch moves on', 'src/tip.txt')
  assert.notEqual(before, tip, 'fixture bug: the reset must have somewhere to go, or "HEAD unmoved" proves nothing')

  // Untracked is the classic loss: `git diff --quiet` alone never sees this file.
  const notes = join(dir, 'scratch', 'notes.md')
  mkdirSync(dirname(notes), { recursive: true })
  const bytes = Buffer.from('a session’s half-done notes\n', 'utf8')
  writeFileSync(notes, bytes)

  const res = runWt(r.root, 'reset', '--base', tip)

  assert.equal(res.status, 2, `the lib’s typed dirty refusal must surface as exit 2 (refused), not 0 and not a stack trace; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /dirty|uncommitted|unstaged|untracked|not clean/i, `stderr must say WHY it refused; got:\n${res.stderr}`)
  assert.ok(
    res.stderr.includes('scratch/notes.md'),
    `stderr must NAME what is dirty — an operator cannot act on "no"; got:\n${res.stderr}`,
  )
  assert.equal(gitIn(dir, 'rev-parse', 'HEAD'), before, 'HEAD is unmoved after the refusal')
  assert.deepEqual(readFileSync(notes), bytes, 'the uncommitted work survives byte-identical')
})

// ── the command surface itself ─────────────────────────────────────────────────────────

test('worktree — an unknown subcommand is a usage refusal (exit 1) naming up|status|reset, and creates nothing', () => {
  const r = makeRepo()

  const res = runWt(r.root, 'upp')

  assert.equal(res.status, 1, `an unknown subcommand is a usage error → exit 1; stderr:\n${res.stderr}`)
  for (const sub of ['up', 'status', 'reset']) {
    assert.match(res.stderr, new RegExp(`\\b${sub}\\b`), `the usage line must name the '${sub}' subcommand; got:\n${res.stderr}`)
  }
  assert.equal(
    r.worktrees().length,
    1,
    'a mistyped subcommand must not fall through to `up` — creating a worktree on a typo is a side effect nobody asked for',
  )
})

test('roadmap --help lists every mounted command — a command bin auto-mounts but never advertises is undiscoverable', () => {
  const mounted = readdirSync(HERE)
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
    .map((f) => f.replace(/\.mjs$/, ''))
  assert.ok(mounted.length > 5, `fixture bug: the command dir must enumerate; got ${mounted.join(', ')}`)
  // `worktree` is named explicitly as well as scanned: the TREE row is owed by this phase, and
  // the scan alone would only start biting AFTER the module lands.
  const expected = [...new Set([...mounted, 'worktree'])].sort()

  const res = spawnSync('node', [BIN, '--help'], { cwd: HERE, encoding: 'utf8', timeout: 30_000 })
  assert.equal(res.status, 0, `--help must exit 0; stderr:\n${res.stderr}`)

  const missing = expected.filter((name) => !new RegExp(`(^|\\s)${name}(\\s|$)`, 'm').test(res.stdout))
  assert.deepEqual(missing, [], `every mounted cli/commands/<name>.mjs must appear in the --help tree; missing: ${missing.join(', ')}`)
})
