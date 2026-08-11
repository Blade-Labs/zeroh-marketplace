#!/usr/bin/env node
/**
 * TEST-FIRST for cli/lib/worktree.mjs (phase 2146.1 — the session worktree lane; the module
 * does not exist yet → RED until it lands). Three seams, one job: give a session an
 * IDEMPOTENT way into its own worktree, on a box where four sibling sessions are doing the
 * same thing against the same repo at the same time.
 *
 * claimSlot(root, { pid }) — the lowest FREE slot wins, a claim is durable (it lands in
 * <root>/.building/worktree-slots.json), the same pid re-claiming gets ITS slot back rather
 * than eating a second one, and a slot whose claimer is DEAD is reclaimed (kill(0) liveness,
 * the codex-journal pattern). The properties that matter are exclusivity (two live sessions
 * never share a slot) and no leakage (a crashed session's slot must come back, or the box
 * grows a worktree per crash). Both are proven with REAL pids — a live spawned child, then
 * the same child reaped — never a hand-written registry, because the registry's LAYOUT is
 * the implementation's call and only its PATH is contract.
 *
 * ensureWorktree(root, slot, { baseRef, installDeps }) — creates once, reuses forever. The
 * dangerous bug this pins is a `worktree add -B` that runs on EVERY call: it would silently
 * reset a scratch head holding a half-done phase, so the re-ensure case commits work in the
 * worktree first and demands that commit still be HEAD afterwards. installDeps is an
 * injected recorder (no npm in a unit test) asserted on its ARGUMENT and its call COUNT —
 * once per worktree lifetime, after the checkout exists, never per phase.
 *
 * resetForPhase(worktreeDir, baseRef) — the one destructive act in the lane (reset --hard),
 * so its invariant is the REFUSAL: untracked, unstaged AND staged dirt each stop it with
 * HEAD unmoved and the work byte-intact, because the alternative is silently deleting a
 * session's uncommitted phase. On a clean worktree it is a real hard reset: the branch ref
 * moves, the tip's files appear, and the previous phase's scratch commit is gone.
 *
 * Real seeded git repos (execFileSync git with -c identity, the makeRepo idiom from
 * cli/lib/curate.test.mjs); worktree dirs land NEXT TO the repo root and are swept with it.
 * Run: capbuild node --test cli/lib/worktree.test.mjs
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, isAbsolute } from 'node:path'

const bases = []
const kids = []
const killKids = () => {
  for (const c of kids) {
    try {
      c.kill('SIGKILL')
    } catch {
      /* already reaped */
    }
  }
}
// The spawned claimers stay REF'd (an unref'd handle lets node drain the loop out from under
// the `await once(child, 'exit')` in reap()), so the file must hand their handles back at the
// end or the runner never exits — hence an `after` hook, with the exit sweep as backstop.
after(killKids)
process.on('exit', () => {
  killKids()
  bases.forEach((b) => rmSync(b, { recursive: true, force: true }))
})

// The module lands in 2146.1 and grows landPhase in 2146.2. Resolving it lazily (a dynamic
// import behind a per-export guard, not a static named import) keeps a missing module/export
// a per-test RED with a named message, instead of one link-time error that stops the whole
// file from reporting which contract is unmet — and lets 2146.2 append its cases here.
const load = () => import('./worktree.mjs')
const resolveExport = async (name, signature) => {
  const mod = await load()
  assert.equal(typeof mod[name], 'function', `worktree.mjs must export ${signature}`)
  return mod[name]
}
const claimSlot = async (...args) => (await resolveExport('claimSlot', 'claimSlot(root, { pid })'))(...args)
const ensureWorktree = async (...args) =>
  (await resolveExport('ensureWorktree', 'ensureWorktree(root, slot, { baseRef, installDeps })'))(...args)
const resetForPhase = async (...args) => (await resolveExport('resetForPhase', 'resetForPhase(worktreeDir, baseRef)'))(...args)

/** The one thing the contract fixes about the registry: WHERE it lives. */
const REGISTRY_REL = join('.building', 'worktree-slots.json')

/** kill(0) liveness, mirroring cli/lib/sidecar.mjs pidAlive — EPERM means it exists but is not ours. */
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM'
  }
}

/** A real, long-lived process this test owns — the only honest way to say "a live claimer". */
function liveClaimer() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' })
  kids.push(child)
  assert.ok(alive(child.pid), 'fixture bug: the spawned claimer must be alive')
  return child
}

/** Reap a claimer and prove its pid is genuinely dead before any reclamation is asserted. */
async function reap(child) {
  child.kill('SIGKILL')
  await once(child, 'exit')
  assert.equal(alive(child.pid), false, `fixture bug: pid ${child.pid} must be dead before reclamation is asserted`)
}

/**
 * The registry read back as {slot, pid} rows. Tolerant of the LAYOUT worktree.mjs picks (an
 * array, a {slots: …} wrapper, or a slot-keyed map) because only the path is contract — but
 * strict about yielding rows: a reader that returned [] on an unrecognised shape would make
 * every count assertion below vacuously green.
 */
function readSlots(root) {
  const p = join(root, REGISTRY_REL)
  assert.ok(existsSync(p), `a claim must be DURABLE — expected the registry at ${REGISTRY_REL}, found nothing at ${p}`)
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  const inner = raw && typeof raw === 'object' && !Array.isArray(raw) && raw.slots !== undefined ? raw.slots : raw
  let rows = null
  if (Array.isArray(inner)) rows = inner.map((r) => ({ slot: Number(r?.slot ?? r?.k ?? r?.n), pid: Number(r?.pid) }))
  else if (inner && typeof inner === 'object') {
    rows = Object.entries(inner)
      .filter(([k]) => /^\d+$/.test(k))
      .map(([k, v]) => ({ slot: Number(k), pid: Number(v && typeof v === 'object' ? v.pid : v) }))
  }
  assert.ok(
    Array.isArray(rows) && rows.length > 0 && rows.every((r) => Number.isInteger(r.slot) && Number.isInteger(r.pid)),
    `the registry must read back as {slot, pid} rows (an array, a {slots: …} wrapper, or a slot-keyed map); got ${JSON.stringify(raw)}`,
  )
  return rows.sort((a, b) => a.slot - b.slot)
}

/** git in any checkout, identity pinned on the command line (the fixture never leans on the host's). */
const gitIn = (cwd, ...a) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  }).trim()

/** Write a file under any checkout, returning the bytes written. */
function writeIn(dir, rel, text) {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  const bytes = Buffer.from(text, 'utf8')
  writeFileSync(abs, bytes)
  return bytes
}

/** One commit in any checkout; each writes its own file so no commit is empty. */
function commitIn(dir, msg, rel) {
  writeIn(dir, rel, `${msg}\n`)
  gitIn(dir, 'add', '--', rel)
  gitIn(dir, 'commit', '-q', '-m', msg)
  return gitIn(dir, 'rev-parse', 'HEAD')
}

/** A git repo with a root commit. Slot worktrees land next to it, so they are swept with it. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'zr-wt-'))
  bases.push(root)
  for (let k = 1; k <= 6; k += 1) bases.push(`${root}-wt-${k}`)
  gitIn(root, 'init', '-q')
  gitIn(root, 'config', 'user.email', 't@t')
  gitIn(root, 'config', 'user.name', 't')
  // -uall: a bare --porcelain collapses an untracked directory to `?? dir/`, hiding files.
  // .building is gitignored in every consumer repo, so registry writes are not "dirt" here.
  const status = (dir) =>
    gitIn(dir, 'status', '--porcelain', '-uall')
      .split('\n')
      .filter((l) => l.trim() && !l.includes('.building/'))
      .join('\n')
  return {
    root,
    git: (...a) => gitIn(root, ...a),
    commit: (msg, rel) => commitIn(root, msg, rel ?? `work/${msg.replace(/\W+/g, '-')}.txt`),
    head: () => gitIn(root, 'rev-parse', 'HEAD'),
    branch: () => gitIn(root, 'rev-parse', '--abbrev-ref', 'HEAD'),
    status,
    /** Absolute paths of every worktree git knows about, main checkout first. */
    worktrees: () =>
      gitIn(root, 'worktree', 'list', '--porcelain')
        .split('\n')
        .filter((l) => l.startsWith('worktree '))
        .map((l) => l.slice('worktree '.length)),
    scratchBranches: () =>
      gitIn(root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/wt').split('\n').filter(Boolean).sort(),
  }
}

/** Run something that must REFUSE; the lazy-guard AssertionError is never the refusal. */
async function refusal(fn, why) {
  let caught = null
  try {
    await fn()
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err
    caught = err
  }
  assert.ok(caught, why)
  return caught
}

/** A dirty-worktree refusal must be TYPED and must say WHAT is dirty — an operator cannot act on "no". */
function assertDirtyRefusal(caught, rel, kind) {
  assert.ok(caught instanceof Error, `${kind}: the refusal must be an Error, got ${JSON.stringify(caught)}`)
  assert.notEqual(
    caught.name,
    'Error',
    `${kind}: the refusal must be a TYPED error the caller can branch on (a named class), got a bare Error: ${caught.message}`,
  )
  assert.match(caught.message, /dirty|uncommitted|unstaged|untracked|not clean/i, `${kind}: the refusal must name the dirty state`)
  const named = `${caught.message} ${JSON.stringify(caught.dirty ?? caught.files ?? caught.status ?? null)}`
  assert.ok(named.includes(rel), `${kind}: the refusal must name what is dirty (${rel}), got: ${named}`)
}

// ── claimSlot: slot identity across concurrent sessions ──────────────────────────────

test('claimSlot: a fresh claim takes slot 1, a second LIVE claimer takes slot 2, and claiming creates no directory', async () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  const other = liveClaimer()

  const first = await claimSlot(r.root)

  assert.deepEqual(Object.keys(first).sort(), ['dir', 'slot'], 'claimSlot returns exactly { slot, dir }')
  assert.equal(first.slot, 1, 'the lowest free slot on an unclaimed repo is 1')
  assert.equal(first.dir, `${r.root}-wt-1`, 'the slot dir is the repo root plus the -wt-<k> suffix, beside the checkout')
  assert.ok(isAbsolute(first.dir), 'the dir is absolute — sessions cd into it from anywhere')
  assert.equal(
    existsSync(first.dir),
    false,
    'claiming is a REGISTRY act: creating the checkout is ensureWorktree’s job, so a claim that loses a race costs nothing',
  )

  const second = await claimSlot(r.root, { pid: other.pid })

  assert.equal(second.slot, 2, 'slot 1 is held by a LIVE claimer, so the next session gets 2 — two sessions never share a worktree')
  assert.equal(second.dir, `${r.root}-wt-2`)
  assert.deepEqual(
    readSlots(r.root),
    [
      { slot: 1, pid: process.pid },
      { slot: 2, pid: other.pid },
    ],
    'the registry records each slot against its claimer pid — the default claimer is process.pid',
  )
})

test('claimSlot: the same pid re-claiming gets ITS slot back and consumes exactly one registry row', async () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  const mine = liveClaimer()
  const neighbour = liveClaimer()

  const first = await claimSlot(r.root, { pid: mine.pid })
  const again = await claimSlot(r.root, { pid: mine.pid })

  assert.deepEqual(again, first, 'a re-claim is idempotent — `roadmap worktree up` runs at every phase start')
  assert.deepEqual(readSlots(r.root), [{ slot: 1, pid: mine.pid }], 'one claimer, ONE registry row — a repeat claim must not stack rows')

  const other = await claimSlot(r.root, { pid: neighbour.pid })
  assert.equal(other.slot, 2, 'the repeat claim consumed no second slot, so the next session still lands on 2')
})

test('claimSlot: a dead claimer’s slot is reclaimed (lowest free wins) while live neighbours keep theirs', async () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  const crashed = liveClaimer()
  const held = liveClaimer()

  assert.equal((await claimSlot(r.root, { pid: crashed.pid })).slot, 1)
  assert.equal((await claimSlot(r.root)).slot, 2)
  assert.equal((await claimSlot(r.root, { pid: held.pid })).slot, 3)

  await reap(crashed)
  const successor = liveClaimer()
  const reclaimed = await claimSlot(r.root, { pid: successor.pid })

  assert.equal(reclaimed.slot, 1, 'a dead claimer frees its slot — otherwise every crashed session leaks a worktree onto a 16GB box')
  assert.equal(reclaimed.dir, `${r.root}-wt-1`)
  assert.deepEqual(
    readSlots(r.root),
    [
      { slot: 1, pid: successor.pid },
      { slot: 2, pid: process.pid },
      { slot: 3, pid: held.pid },
    ],
    'the reclaim rewrites only the dead row; the live neighbours are untouched',
  )

  const fourth = liveClaimer()
  assert.equal(
    (await claimSlot(r.root, { pid: fourth.pid })).slot,
    4,
    'with 1-3 all held by LIVE pids the next claim allocates 4 — reclamation must be liveness, never round-robin reuse',
  )
})

// ── ensureWorktree: create once, reuse forever ───────────────────────────────────────

test('ensureWorktree: creates wt/<k> at baseRef and installs deps ONCE; a second call reuses without resetting the scratch head', async () => {
  const r = makeRepo()
  const base = r.commit('root: seed the tree')
  const primaryBranch = r.branch()
  const calls = []
  // Recorded WITH readiness: deps installed before the checkout exists would land in an
  // empty directory, which no later assertion about `created` would ever catch.
  const installDeps = (dir) => calls.push({ dir, ready: existsSync(join(dir, '.git')) })

  const out = await ensureWorktree(r.root, 1, { installDeps })

  assert.deepEqual(Object.keys(out).sort(), ['created', 'dir'], 'ensureWorktree returns exactly { dir, created }')
  assert.equal(out.created, true, 'the first call creates')
  assert.equal(out.dir, `${r.root}-wt-1`)
  assert.ok(existsSync(join(out.dir, '.git')), 'the slot dir is a real linked worktree')
  assert.ok(r.worktrees().includes(out.dir), `git itself must know the worktree: ${r.worktrees().join(', ')}`)
  assert.equal(gitIn(out.dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'wt/1', 'the worktree sits on its scratch head, never detached')
  assert.equal(gitIn(out.dir, 'rev-parse', 'HEAD'), base, 'the scratch head starts at baseRef')
  assert.equal(r.git('rev-parse', 'refs/heads/wt/1'), base, 'the branch wt/1 exists and points at baseRef')
  assert.deepEqual(calls, [{ dir: out.dir, ready: true }], 'installDeps runs once, against the WORKTREE dir, after the checkout exists')

  // The primary checkout is a bystander: another session is working in it right now.
  assert.equal(r.head(), base, 'ensureWorktree never moves the primary checkout’s HEAD')
  assert.equal(r.branch(), primaryBranch, 'nor its branch')
  assert.equal(r.status(r.root), '', 'nor leaves dirt in it')

  // A phase's worth of work sits on the scratch head when the next `worktree up` runs.
  const inFlight = commitIn(out.dir, 'feat(cli): phase 2146 — 2146.1 half-done work', 'work/in-flight.txt')

  const again = await ensureWorktree(r.root, 1, { installDeps })

  assert.equal(again.created, false, 'the second call reuses — created:false is how the caller knows not to re-install')
  assert.equal(again.dir, out.dir)
  assert.equal(calls.length, 1, 'deps install once per worktree LIFETIME, not once per phase')
  assert.equal(
    gitIn(out.dir, 'rev-parse', 'HEAD'),
    inFlight,
    'a re-ensure must NOT reset the scratch head — an unconditional `worktree add -B` would silently drop the in-flight phase (resetting is resetForPhase’s job, and it refuses when dirty)',
  )
  assert.equal(r.worktrees().length, 2, 'main checkout + one slot: reuse, never accumulate')
  assert.deepEqual(r.scratchBranches(), ['wt/1'], 'one scratch branch per slot — no wt/1-2, no per-phase branches')
})

test('ensureWorktree: a non-default baseRef is where the scratch head starts, and slots coexist', async () => {
  const r = makeRepo()
  const first = r.commit('root: seed the tree', 'src/seed.txt')
  const tip = r.commit('the integration branch moves on', 'src/tip.txt')
  assert.notEqual(first, tip, 'fixture bug: baseRef must differ from the tip or the assertion below is vacuous')

  const older = await ensureWorktree(r.root, 2, { baseRef: first, installDeps: () => {} })

  assert.equal(older.dir, `${r.root}-wt-2`)
  assert.equal(older.created, true)
  assert.equal(gitIn(older.dir, 'rev-parse', 'HEAD'), first, 'the scratch head starts at the REQUESTED ref, not at the repo tip')
  assert.equal(existsSync(join(older.dir, 'src', 'seed.txt')), true, 'the checkout is real: baseRef’s files are on disk')
  assert.equal(existsSync(join(older.dir, 'src', 'tip.txt')), false, 'and the tip’s files are not')

  // installDeps is an OPTIONAL seam — omitting it must not throw.
  const current = await ensureWorktree(r.root, 3)

  assert.equal(current.dir, `${r.root}-wt-3`)
  assert.equal(gitIn(current.dir, 'rev-parse', 'HEAD'), tip, 'baseRef defaults to HEAD')
  assert.deepEqual(r.worktrees().slice(1).sort(), [older.dir, current.dir].sort(), 'both slots coexist as sibling worktrees')
  assert.deepEqual(r.scratchBranches(), ['wt/2', 'wt/3'], 'one scratch branch per slot, named by slot')
})

// ── resetForPhase: the one destructive act, so the refusal is the invariant ──────────

test('resetForPhase: untracked, unstaged AND staged dirt each REFUSE, with HEAD unmoved and the work byte-intact', async () => {
  const r = makeRepo()
  r.commit('root: seed the tree', 'src/shared.txt')
  const wt = await ensureWorktree(r.root, 1, { installDeps: () => {} })
  const before = gitIn(wt.dir, 'rev-parse', 'HEAD')
  const tip = r.commit('the integration branch moves on', 'src/tip.txt')
  assert.notEqual(before, tip, 'fixture bug: the reset must have somewhere to go, or "HEAD unmoved" proves nothing')

  // (a) untracked — the classic loss: `git diff --quiet` alone does not see this file.
  const scratchBytes = writeIn(wt.dir, 'scratch/notes.md', 'a session’s half-done notes\né—\n')
  const untracked = await refusal(
    () => resetForPhase(wt.dir, tip),
    'an untracked file in the worktree must REFUSE the reset — a hard reset would be silent data loss',
  )
  assertDirtyRefusal(untracked, 'scratch/notes.md', 'untracked')
  assert.equal(gitIn(wt.dir, 'rev-parse', 'HEAD'), before, 'untracked: HEAD is unmoved after the refusal')
  assert.deepEqual(readFileSync(join(wt.dir, 'scratch', 'notes.md')), scratchBytes, 'untracked: the file survives byte-identical')

  rmSync(join(wt.dir, 'scratch'), { recursive: true, force: true })

  // (b) modified-unstaged
  const editedBytes = writeIn(wt.dir, 'src/shared.txt', 'a session edited this tracked file and has not staged it\n')
  const unstaged = await refusal(() => resetForPhase(wt.dir, tip), 'a modified tracked file must REFUSE the reset')
  assertDirtyRefusal(unstaged, 'src/shared.txt', 'unstaged')
  assert.equal(gitIn(wt.dir, 'rev-parse', 'HEAD'), before, 'unstaged: HEAD is unmoved after the refusal')
  assert.deepEqual(readFileSync(join(wt.dir, 'src', 'shared.txt')), editedBytes, 'unstaged: the edit survives byte-identical')

  // (c) staged — `git diff` (unstaged only) would miss this one.
  gitIn(wt.dir, 'add', '--', 'src/shared.txt')
  assert.equal(gitIn(wt.dir, 'diff', '--name-only'), '', 'fixture: with the edit staged there is nothing left UNstaged to see')
  const staged = await refusal(() => resetForPhase(wt.dir, tip), 'a STAGED change must refuse too — the index is state a reset would erase')
  assertDirtyRefusal(staged, 'src/shared.txt', 'staged')
  assert.equal(gitIn(wt.dir, 'rev-parse', 'HEAD'), before, 'staged: HEAD is unmoved after the refusal')
  assert.equal(gitIn(wt.dir, 'diff', '--cached', '--name-only'), 'src/shared.txt', 'staged: the index is exactly as the session left it')
  assert.deepEqual(readFileSync(join(wt.dir, 'src', 'shared.txt')), editedBytes, 'staged: the edit survives byte-identical')
})

test('resetForPhase: a clean worktree resets HARD to the integration tip — branch ref moves, tip files land, last phase’s commit goes', async () => {
  const r = makeRepo()
  r.commit('root: seed the tree', 'src/shared.txt')
  const wt = await ensureWorktree(r.root, 1, { installDeps: () => {} })

  // Last phase's work, already landed and curated elsewhere: the scratch head is disposable.
  const stale = commitIn(wt.dir, 'feat(cli): phase 2145 — 2145.1 last phase’s work', 'work/last-phase.txt')
  const tip = r.commit('the integration branch moves on', 'src/tip.txt')
  const integration = r.branch()
  assert.notEqual(stale, tip)

  await resetForPhase(wt.dir, integration) // by NAME: the caller passes the integration branch, not a sha

  assert.equal(gitIn(wt.dir, 'rev-parse', 'HEAD'), tip, 'the worktree HEAD is the integration tip')
  assert.equal(r.git('rev-parse', 'refs/heads/wt/1'), tip, 'the scratch BRANCH ref moved — not a detached HEAD the next commit would orphan')
  assert.equal(gitIn(wt.dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'wt/1', 'and the worktree is still on wt/1')
  assert.equal(r.status(wt.dir), '', 'the worktree is clean after the reset')
  assert.equal(existsSync(join(wt.dir, 'src', 'tip.txt')), true, 'a HARD reset brings the tip’s files into the worktree')
  assert.equal(existsSync(join(wt.dir, 'work', 'last-phase.txt')), false, 'last phase’s file is gone from the worktree')
  assert.ok(
    !gitIn(wt.dir, 'rev-list', 'HEAD').split('\n').includes(stale),
    'last phase’s commit is no longer reachable from the scratch head — nothing accumulates across phases',
  )

  // The primary checkout, where a sibling session is working, is untouched by all of this.
  assert.equal(r.head(), tip, 'the integration branch itself did not move')
  assert.equal(r.status(r.root), '', 'and the primary checkout is still clean')
})
