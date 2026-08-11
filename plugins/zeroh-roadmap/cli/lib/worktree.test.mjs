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
 * landPhase(worktreeDir, baseRef, { retries, onRetry, beforeSwap }) — the other end of the
 * lane (2146.2): the phase's 1-3 curated commits leave the worktree and BECOME the integration
 * branch's tip. Two things go wrong on a box where four sessions land into one branch, and both
 * are the contract here. (a) A LOST RACE: the swap must be the compare-and-swap update-ref form
 * (update-ref <ref> <new> <expected-old>), so a base that advanced between the rebase and the
 * swap is DETECTED and re-tried, never clobbered — which is why every case asserts the base's
 * FULL subject list, oldest sibling commit included, and not merely that it gained ours: a plain
 * `update-ref <ref> <new>` would satisfy a count-only assertion while deleting the sibling's
 * work. (b) A genuine file CONFLICT is not ours to resolve: it halts with a typed error whose
 * discriminator is DISTINCT from race exhaustion (the CLI retries one and hands the other to a
 * human), and the worktree comes back on its pre-land commits — no detached head, no rebase-merge
 * directory, no MERGE files, because a worktree left mid-rebase silently blocks the session's
 * NEXT phase. `retries` counts RETRIES (total swap attempts = retries + 1) and onRetry announces
 * each retry actually taken; `beforeSwap` is the injected seam that makes the race DETERMINISTIC
 * — the fixture advances the base from inside it, exactly where a sibling's swap would land.
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
const landPhase = async (...args) =>
  (await resolveExport('landPhase', 'landPhase(worktreeDir, baseRef, { retries, onRetry, beforeSwap })'))(...args)

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

  const second = await claimSlot(r.root, { pid: other.pid, owner: 'session-b' })

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

  const first = await claimSlot(r.root, { pid: mine.pid, owner: 'session-m' })
  const again = await claimSlot(r.root, { pid: mine.pid, owner: 'session-m' })

  assert.deepEqual(again, first, 'a re-claim is idempotent — `roadmap worktree up` runs at every phase start')
  assert.deepEqual(readSlots(r.root), [{ slot: 1, pid: mine.pid }], 'one claimer, ONE registry row — a repeat claim must not stack rows')

  const other = await claimSlot(r.root, { pid: neighbour.pid, owner: 'session-n' })
  assert.equal(other.slot, 2, 'the repeat claim consumed no second slot, so the next session still lands on 2')
})

test('claimSlot: a dead claimer’s slot is reclaimed (lowest free wins) while live neighbours keep theirs', async () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  const crashed = liveClaimer()
  const held = liveClaimer()

  assert.equal((await claimSlot(r.root, { pid: crashed.pid, owner: `pid:${crashed.pid}` })).slot, 1)
  assert.equal((await claimSlot(r.root)).slot, 2)
  assert.equal((await claimSlot(r.root, { pid: held.pid, owner: 'session-h' })).slot, 3)

  await reap(crashed)
  const successor = liveClaimer()
  const reclaimed = await claimSlot(r.root, { pid: successor.pid, owner: 'session-s' })

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
    (await claimSlot(r.root, { pid: fourth.pid, owner: 'session-f' })).slot,
    4,
    'with 1-3 all held by LIVE pids the next claim allocates 4 — reclamation must be liveness, never round-robin reuse',
  )
})

test('claimSlot: a session claim SURVIVES its CLI pid — two sessions with dead spawn pids never share a slot', async () => {
  // THE lane-premise pin: `roadmap worktree up` runs in a short-lived CLI process whose
  // pid is dead seconds later. If liveness were pid-only, every later session would
  // reclaim slot 1 and two sessions would share one worktree — the exact shared-dirt
  // hazard the lane exists to remove.
  const r = makeRepo()
  r.commit('root: seed the tree')
  const spawnA = liveClaimer()
  const spawnB = liveClaimer()
  const a = await claimSlot(r.root, { pid: spawnA.pid, owner: 'session-a' })
  await reap(spawnA)
  const b = await claimSlot(r.root, { pid: spawnB.pid, owner: 'session-b' })
  await reap(spawnB)
  assert.equal(a.slot, 1)
  assert.equal(b.slot, 2, 'session-a’s claim outlives its dead spawn pid — session-b must NOT reclaim slot 1')
  const again = await claimSlot(r.root, { pid: process.pid, owner: 'session-a' })
  assert.equal(again.slot, 1, 'session-a’s next spawn (a different live pid) still resolves to ITS slot')
})

test('claimSlot: five PARALLEL claimers get five distinct slots and the registry survives untorn', async () => {
  const r = makeRepo()
  r.commit('root: seed the tree')
  const script = `
    import('${'file://'}${'/home/patrik/zeroh-marketplace/plugins/zeroh-roadmap/cli/lib/worktree.mjs'}').then((m) => {
      const out = m.claimSlot(process.argv[1], { owner: process.argv[2] })
      console.log(JSON.stringify(out))
    })
  `
  const runs = await Promise.all(
    ['pa', 'pb', 'pc', 'pd', 'pe'].map(
      (owner) =>
        new Promise((resolve) => {
          const c = spawn('node', ['--input-type=module', '-e', script, r.root, owner], { stdio: ['ignore', 'pipe', 'pipe'] })
          let outText = ''
          let errText = ''
          c.stdout.on('data', (d) => (outText += d))
          c.stderr.on('data', (d) => (errText += d))
          c.on('exit', (code) => resolve({ code, outText, errText }))
        }),
    ),
  )
  for (const run of runs) assert.equal(run.code, 0, `a parallel claim crashed (a torn registry read?): ${run.errText}`)
  const slots = runs.map((run) => JSON.parse(run.outText.trim()).slot).sort()
  assert.deepEqual(slots, [1, 2, 3, 4, 5], 'five concurrent claimers must serialize onto five DISTINCT slots — a duplicate is a shared worktree')
  assert.equal(readSlots(r.root).length, 5, 'all five rows survive — no lost update')
})

test('claimSlot: an EXPIRED session row is reclaimed only when its worktree cannot lose work', async () => {
  const r = makeRepo()
  const base = r.commit('root: seed the tree')
  // Three expired claims, three worktree states: missing (reclaimable), clean-and-landed
  // (reclaimable), clean-but-carrying-unlanded-commits (KEPT — the reset would orphan them).
  // The rows must record a DEAD pid (the live test-runner pid would keep them alive
  // regardless of the calendar — exactly the deployment shape, where the recorded pid
  // is a long-dead CLI spawn).
  const spawnPid = liveClaimer()
  await reap(spawnPid)
  await claimSlot(r.root, { owner: 'gone-missing', pid: spawnPid.pid })
  await claimSlot(r.root, { owner: 'gone-clean', pid: spawnPid.pid })
  await claimSlot(r.root, { owner: 'gone-working', pid: spawnPid.pid })
  await ensureWorktree(r.root, 2, { baseRef: base })
  await ensureWorktree(r.root, 3, { baseRef: base })
  execFileSync('git', ['-C', `${r.root}-wt-3`, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'a week of unlanded phase work'], { stdio: 'ignore' })
  // Backdate all three rows past the TTL.
  const regPath = join(r.root, REGISTRY_REL)
  const rows = JSON.parse(readFileSync(regPath, 'utf8'))
  for (const row of rows) row.claimedAt = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString()
  writeFileSync(regPath, JSON.stringify(rows, null, 2) + '\n')

  const fresh = await claimSlot(r.root, { owner: 'newcomer' })
  assert.equal(fresh.slot, 1, 'the missing-worktree slot is the lowest reclaimable one')
  const after = readSlots(r.root).map((row) => row.slot).sort()
  assert.deepEqual(after, [1, 3], 'clean-landed slot 2 was also pruned; slot 3 with UNLANDED commits kept its row — reclamation never orphans committed work')
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

// ── landPhase: the curated commits reach the integration branch, race and all ─────────

/** The integration branch every land case advances. It is a REF ONLY — no checkout sits on it. */
const BASE = 'develop'

/** The integration branch's current tip, read from the shared repo the worktree belongs to. */
const baseTip = (r) => r.git('rev-parse', `refs/heads/${BASE}`)

/** Subjects of a ref in a given checkout, newest-first — the WHOLE list, because "gained ours"
 *  is not the invariant: a swap that deleted a sibling's commit also gains ours. */
const subjectsOf = (dir, ref) =>
  gitIn(dir, 'log', '--format=%s', ref)
    .split('\n')
    .filter(Boolean)

/**
 * A repo whose integration branch is a bare ref, plus slot 1's worktree carrying `curated`
 * commits on top of that ref's tip — the post-curate state landPhase is handed.
 *
 * Nothing is checked out on BASE: sibling sessions commit in the primary checkout and the ref
 * is fast-forwarded onto their work (siblingLands), which is precisely how another session's
 * swap looks from ours — the ref moved, no worktree of ours involved.
 */
async function landFixture(curated, { seedFile = 'src/seed.txt' } = {}) {
  const r = makeRepo()
  const seed = commitIn(r.root, 'seed: the integration branch exists', seedFile)
  // Host-independent: whatever init.defaultBranch is, the primary must not sit ON the base ref.
  if (r.branch() === BASE) r.git('branch', '-m', `${BASE}-primary`)
  r.git('branch', BASE)
  assert.notEqual(r.branch(), BASE, 'fixture bug: the primary must not be checked out on the integration branch')

  const wt = await ensureWorktree(r.root, 1, { baseRef: BASE, installDeps: () => {} })
  const shas = curated.map(({ subject, rel }) => commitIn(wt.dir, subject, rel))
  assert.equal(gitIn(wt.dir, 'rev-parse', 'HEAD'), shas[shas.length - 1], 'fixture bug: the curated commits must be on the scratch head')

  return { r, wt, seed, shas, subjects: curated.map((c) => c.subject) }
}

/**
 * Another session's land: a commit authored in the primary checkout, with the integration ref
 * fast-forwarded onto it via the SAME compare-and-swap form landPhase must use — so a fixture
 * that has itself raced (a stale expectation) fails loudly here rather than as a mystery later.
 */
function siblingLands(r, subject, rel) {
  const before = baseTip(r)
  const sha = commitIn(r.root, subject, rel)
  r.git('update-ref', `refs/heads/${BASE}`, sha, before)
  return sha
}

/** No rebase may be left in flight: the next `roadmap worktree up` would inherit the wreckage. */
function assertSettled(r, wtDir, why) {
  for (const rel of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD']) {
    const p = gitIn(wtDir, 'rev-parse', '--git-path', rel)
    const abs = isAbsolute(p) ? p : join(wtDir, p)
    assert.equal(existsSync(abs), false, `${why}: ${rel} must be gone — a worktree left mid-rebase blocks the session's NEXT phase`)
  }
  assert.equal(
    gitIn(wtDir, 'rev-parse', '--abbrev-ref', 'HEAD'),
    'wt/1',
    `${why}: HEAD is back on the scratch branch — a rebase leaves a DETACHED head, and the next commit made there is orphaned`,
  )
  assert.equal(r.status(wtDir), '', `${why}: the worktree is clean`)
}

/** A land failure must be branchable without grepping prose: name/code/reason is the discriminator. */
const discriminator = (err) => `${err?.name}|${err?.code ?? ''}|${err?.reason ?? ''}`

test('landPhase: a clean land fast-forwards the base ref by exactly the curated commits and leaves the worktree on the new tip', async () => {
  const { r, wt, seed, subjects } = await landFixture([
    { subject: 'feat(cli): phase 2146 — 2146.2 rebase-onto-tip then compare-and-swap', rel: 'cli/lib/land.txt' },
    { subject: 'test(cli): phase 2146 — 2146.2 the race and conflict cases', rel: 'cli/lib/land-test.txt' },
    { subject: 'docs(roadmap): phase 2146 — 2146.2 transparency report', rel: 'roadmap/report.txt' },
  ])
  const retries = []
  assert.equal(baseTip(r), seed, 'fixture: the base still sits where the worktree branched from')

  const out = await landPhase(wt.dir, BASE, { onRetry: (...a) => retries.push(a) })

  assert.deepEqual(Object.keys(out).sort(), ['landed', 'tip'], 'landPhase returns exactly { tip, landed }')
  assert.equal(out.landed, 3, 'landed counts the commits that reached the base — the caller reports it, so a wrong count is a wrong transparency report')
  assert.match(out.tip, /^[0-9a-f]{40}$/, 'tip is a full sha the caller can quote in the gate report')
  assert.equal(out.tip, baseTip(r), 'the returned tip IS the integration branch tip — not the pre-swap candidate')

  assert.deepEqual(
    subjectsOf(r.root, `refs/heads/${BASE}`),
    [...subjects].reverse().concat('seed: the integration branch exists'),
    'the base gained EXACTLY the curated commits, newest last-curated first, with its own history intact underneath',
  )
  assert.equal(r.git('rev-list', '--count', `${seed}..refs/heads/${BASE}`), '3', 'three curated commits, three new commits on the base')
  assert.equal(r.git('rev-list', '--merges', `${seed}..refs/heads/${BASE}`), '', 'the land is a REBASE onto the tip — a merge commit means the ff discipline was abandoned')
  assert.deepEqual(retries, [], 'an uncontended land retries nothing')

  assert.equal(gitIn(wt.dir, 'rev-parse', 'HEAD'), out.tip, 'the scratch head is reset onto the new base tip — the next phase starts from what actually landed')
  assert.equal(r.git('rev-parse', 'refs/heads/wt/1'), out.tip, 'and the wt/1 BRANCH moved with it, not just a detached HEAD')
  assert.equal(
    gitIn(wt.dir, 'rev-parse', 'HEAD^{tree}'),
    r.git('rev-parse', `refs/heads/${BASE}^{tree}`),
    'the landed tree is the worktree tree — the commits carried their CONTENT, not just their subjects',
  )
  assertSettled(r, wt.dir, 'clean land')

  // The primary checkout belongs to another session mid-phase; landing must not touch it.
  assert.equal(r.head(), seed, 'the primary checkout’s HEAD never moves — only the base REF does')
  assert.equal(r.status(r.root), '', 'and the primary is left clean')
})

test('landPhase: landing onto a base CHECKED OUT in the primary keeps that checkout coherent — no phantom deletions, no eatable index', async () => {
  // THE deployment pin (reviewer repro fx2): the azure primary keeps develop checked out.
  // A bare update-ref there desyncs the primary\u2019s index — `git status` shows every landed
  // file as a staged deletion and a sibling\u2019s ordinary commit then DELETES the landed work.
  // The advance must go through the primary\u2019s own porcelain when it holds the ref.
  const r = makeRepo()
  const seed = commitIn(r.root, 'seed: the integration branch exists', 'src/seed.txt')
  if (r.branch() !== BASE) r.git('checkout', '-q', '-b', BASE)
  assert.equal(r.branch(), BASE, 'fixture: the primary IS on the integration branch — the shipped azure topology')

  const wt = await ensureWorktree(r.root, 1, { baseRef: BASE, installDeps: () => {} })
  commitIn(wt.dir, 'feat(cli): phase 2146 — 2146.2 the landed feature', 'cli/lib/feature.txt')

  const out = await landPhase(wt.dir, BASE)

  assert.equal(r.git('rev-parse', `refs/heads/${BASE}`), out.tip, 'the base ref advanced')
  assert.equal(r.head(), out.tip, 'the primary checkout FOLLOWED its branch — ref and checkout move together')
  assert.equal(r.status(r.root), '', 'the primary shows NO phantom staged deletions')
  assert.ok(existsSync(join(r.root, 'cli/lib/feature.txt')), 'the landed file is ON DISK in the primary — the working tree moved with the ref')

  // The kill shot the desync enabled: a sibling\u2019s ordinary explicit-path commit must not
  // silently delete the landed work.
  const sibling = commitIn(r.root, 'feat(web): a sibling lands its own file', 'web/sibling.txt')
  const tree = r.git('ls-tree', '--name-only', '-r', sibling)
  assert.ok(tree.includes('cli/lib/feature.txt'), `the landed file SURVIVES a sibling commit; tree was:\n${tree}`)
  assert.equal(r.git('rev-list', '--count', `${seed}..${sibling}`), '2', 'land + sibling = two commits over the seed')
})

test('landPhase: a REAL git failure is not laundered as a race — it rethrows once with the underlying stderr', async () => {
  // The bare-catch hazard: a primary holding the base with CONFLICTING dirty changes makes
  // merge --ff-only refuse; retrying that 4 times and reporting "kept advancing" would send
  // the operator hunting a phantom race. The error must carry git\u2019s own words.
  const r = makeRepo()
  commitIn(r.root, 'seed: the integration branch exists', 'src/seed.txt')
  if (r.branch() !== BASE) r.git('checkout', '-q', '-b', BASE)
  const wt = await ensureWorktree(r.root, 1, { baseRef: BASE, installDeps: () => {} })
  commitIn(wt.dir, 'feat(cli): phase 2146 — 2146.2 rewrites the seed file', 'src/seed.txt')
  writeFileSync(join(r.root, 'src/seed.txt'), 'primary dirt on the very file the land touches\n')

  let caught = null
  try {
    await landPhase(wt.dir, BASE)
  } catch (e) {
    caught = e
  }
  assert.ok(caught, 'the land must fail — the primary would be clobbered')
  assert.notEqual(caught.name, 'WorktreeRaceError', 'a local-changes refusal is NOT a race')
  assert.equal(caught.raceLoss, undefined, 'nor marked as a race loss internally')
  assert.match(caught.message, /overwritten|local changes/i, `the error carries git\u2019s real reason; got: ${caught.message}`)
  assert.equal(r.git('rev-parse', `refs/heads/${BASE}`) === gitIn(wt.dir, 'rev-parse', 'HEAD'), false, 'the base did not advance')
})

test('landPhase: a base that advances between rebase and swap is DETECTED, retried once, and the sibling’s commit survives underneath', async () => {
  const { r, wt, seed, subjects } = await landFixture([
    { subject: 'feat(cli): phase 2146 — 2146.2 the land half', rel: 'cli/lib/land.txt' },
    { subject: 'test(cli): phase 2146 — 2146.2 the land cases', rel: 'cli/lib/land-test.txt' },
  ])
  const swaps = []
  const retries = []
  let sibling = null
  // The race, made deterministic: the base moves exactly where a sibling session's swap would
  // land it — after our rebase read the tip, before our own swap.
  const beforeSwap = () => {
    swaps.push(baseTip(r))
    if (sibling === null) sibling = siblingLands(r, 'feat(cli): another session landed first', 'cli/lib/sibling.txt')
  }
  const onRetry = () => retries.push(baseTip(r))

  const out = await landPhase(wt.dir, BASE, { retries: 3, onRetry, beforeSwap })

  assert.equal(retries.length, 1, 'exactly one lost race means exactly one retry — onRetry announces retries TAKEN, and a silent retry is an unexplained rewritten sha')
  assert.deepEqual(retries, [sibling], 'the retry happens AFTER the base moved: it re-reads the advanced tip rather than replaying the stale one')
  assert.equal(swaps.length, 2, 'two swap attempts: the lost one and the winning one — the seam runs per ATTEMPT, so a persistent racer keeps racing')

  assert.equal(out.landed, 2, 'a retried land still reports the curated commits, never the sibling’s')
  assert.equal(out.tip, baseTip(r), 'the returned tip is the base tip after the winning swap')
  assert.deepEqual(
    subjectsOf(r.root, `refs/heads/${BASE}`),
    [...subjects].reverse().concat('feat(cli): another session landed first', 'seed: the integration branch exists'),
    'the sibling’s commit sits UNDER ours: our commits were rebased onto it, not swapped over the top of it (a non-CAS update-ref would delete it)',
  )
  assert.equal(r.git('rev-list', '--count', `${seed}..refs/heads/${BASE}`), '3', 'one sibling commit plus two curated — nothing dropped, nothing duplicated')
  assert.equal(r.git('rev-list', '--merges', `${seed}..refs/heads/${BASE}`), '', 'still linear: the retry rebases, it does not merge the sibling in')

  assert.equal(gitIn(wt.dir, 'rev-parse', 'HEAD'), out.tip, 'the scratch head follows the winning tip')
  assert.equal(r.git('rev-parse', 'refs/heads/wt/1'), out.tip, 'and so does wt/1')
  assert.equal(existsSync(join(wt.dir, 'cli', 'lib', 'sibling.txt')), true, 'the sibling’s file is in our worktree afterwards — proof we rebased ONTO their work')
  assertSettled(r, wt.dir, 'race')
})

test('landPhase: a base that advances on EVERY attempt exhausts the retry budget and throws typed, with the base never clobbered', async () => {
  const { r, wt, seed, subjects } = await landFixture([
    { subject: 'feat(cli): phase 2146 — 2146.2 the land half', rel: 'cli/lib/land.txt' },
    { subject: 'test(cli): phase 2146 — 2146.2 the land cases', rel: 'cli/lib/land-test.txt' },
  ])
  const swaps = []
  const retries = []
  let n = 0
  const beforeSwap = () => {
    n += 1
    swaps.push(siblingLands(r, `feat(cli): sibling land ${n}`, `cli/lib/sibling-${n}.txt`))
  }

  const err = await refusal(
    () => landPhase(wt.dir, BASE, { retries: 2, onRetry: () => retries.push(baseTip(r)), beforeSwap }),
    'a base that moves on every attempt must EXHAUST the budget and THROW — a land that quietly gave up would leave the phase unmerged behind a green exit code',
  )

  assert.ok(err instanceof Error, `the exhaustion failure must be an Error, got ${JSON.stringify(err)}`)
  assert.notEqual(err.name, 'Error', `the exhaustion failure must be TYPED so the CLI can tell it from a conflict, got a bare Error: ${err.message}`)
  assert.match(
    discriminator(err),
    /race|retr|contention|exhaust|busy/i,
    `the branchable discriminator (name/code/reason) must say the land lost a RACE; got ${discriminator(err)}`,
  )
  assert.doesNotMatch(
    discriminator(err),
    /conflict/i,
    'race exhaustion and a file conflict need DIFFERENT discriminators: one is retryable by a machine, the other needs a human',
  )
  assert.match(err.message, new RegExp(BASE), 'the message must name the ref it could not advance — an operator cannot act on "failed"')

  assert.equal(retries.length, 2, 'retries: 2 means two retries TAKEN (the initial attempt is not a retry), then the budget is spent')
  assert.equal(swaps.length, 3, 'three swap attempts for a budget of two retries — attempts = retries + 1')

  assert.deepEqual(
    subjectsOf(r.root, `refs/heads/${BASE}`),
    ['feat(cli): sibling land 3', 'feat(cli): sibling land 2', 'feat(cli): sibling land 1', 'seed: the integration branch exists'],
    'the base carries ONLY the siblings’ work: a land that gives up must leave the branch exactly as the winners left it',
  )
  assert.equal(baseTip(r), swaps[2], 'the base ref is the last sibling’s commit — never rewound, never overwritten')
  for (const subject of subjects) {
    assert.ok(
      !subjectsOf(r.root, `refs/heads/${BASE}`).includes(subject),
      `nothing curated may reach the base on a failed land (${subject}) — a half-landed phase is worse than an unlanded one`,
    )
  }

  // The session keeps its work: the phase is re-landable once the contention passes.
  assertSettled(r, wt.dir, 'exhaustion')
  assert.deepEqual(
    subjectsOf(wt.dir, 'HEAD').slice(0, subjects.length).reverse(),
    subjects,
    'the curated commits are still on the scratch head, in order — an exhausted land must not consume the work it failed to land',
  )
  assert.equal(existsSync(join(wt.dir, 'cli', 'lib', 'land.txt')), true, 'and their files are still on disk in the worktree')
})

test('landPhase: a real file conflict halts typed and distinct, with the worktree restored to its pre-land commits', async () => {
  const { r, wt, subjects, shas } = await landFixture(
    [{ subject: 'feat(cli): phase 2146 — 2146.2 our edit to the shared line', rel: 'src/shared.txt' }],
    { seedFile: 'src/shared.txt' },
  )
  const preLand = gitIn(wt.dir, 'rev-parse', 'HEAD')
  assert.equal(preLand, shas[0], 'fixture: the scratch head is the curated commit')
  const ourBytes = readFileSync(join(wt.dir, 'src', 'shared.txt'))

  // A sibling rewrote the same single line first: overlapping files are exactly the case that
  // is NOT ours to resolve.
  const sibling = siblingLands(r, 'feat(cli): a sibling rewrote the same shared line', 'src/shared.txt')
  const baseBefore = subjectsOf(r.root, `refs/heads/${BASE}`)

  const err = await refusal(
    () => landPhase(wt.dir, BASE, { retries: 3 }),
    'a rebase conflict must HALT — auto-resolving another session’s overlapping edit is how work silently disappears',
  )

  assert.ok(err instanceof Error, `the conflict failure must be an Error, got ${JSON.stringify(err)}`)
  assert.notEqual(err.name, 'Error', `the conflict failure must be TYPED, got a bare Error: ${err.message}`)
  assert.match(discriminator(err), /conflict/i, `the discriminator (name/code/reason) must say CONFLICT; got ${discriminator(err)}`)
  assert.doesNotMatch(
    discriminator(err),
    /race|exhaust|contention/i,
    'a conflict is not a lost race: retrying it forever would burn the budget on a failure only a human can clear',
  )
  const named = `${err.message} ${JSON.stringify(err.conflicts ?? err.files ?? err.paths ?? null)}`
  assert.ok(named.includes('src/shared.txt'), `the halt must NAME the conflicting path so the executor can open it; got: ${named}`)

  assertSettled(r, wt.dir, 'conflict')
  assert.doesNotMatch(
    gitIn(wt.dir, 'status'),
    /rebase in progress|interactive rebase|You are currently rebasing/i,
    'the rebase was ABORTED, not merely reported: `git status` must not still be walking a rebase',
  )
  assert.equal(gitIn(wt.dir, 'rev-parse', 'HEAD'), preLand, 'the scratch head is byte-for-byte its pre-land commit — an aborted rebase rewrites nothing')
  assert.equal(r.git('rev-parse', 'refs/heads/wt/1'), preLand, 'and wt/1 still points there')
  assert.deepEqual(subjectsOf(wt.dir, 'HEAD').slice(0, 1), subjects, 'the curated commit survives the halt, ready to be re-landed once the conflict is resolved')
  assert.deepEqual(readFileSync(join(wt.dir, 'src', 'shared.txt')), ourBytes, 'our version of the file is intact — no conflict markers written into the session’s tree')

  assert.equal(baseTip(r), sibling, 'the base ref did not move: a conflicted land lands NOTHING')
  assert.deepEqual(subjectsOf(r.root, `refs/heads/${BASE}`), baseBefore, 'and the base’s history is exactly what the sibling left')
})
