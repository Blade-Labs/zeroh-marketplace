#!/usr/bin/env node
/**
 * TEST-FIRST for cli/lib/sidecar.mjs (module does NOT exist yet — RED on import
 * until implemented). The .building lane-registry writer/reader shared by do-arc
 * — the beacon-stamp contract that the sidecar lands under the MAIN checkout's
 * roadmap/arcs/.building even when armed from a linked worktree, plus the
 * lane-held refusal. Hermetic-tmp-estate + REAL git worktrees, no mocking.
 * Run: node --test cli/lib/sidecar.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mainCheckout, gitCommonDir } from './gitroot.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOD = join(HERE, 'sidecar.mjs')
const {
  buildingDir,
  listSidecars,
  readSidecar,
  armSidecar,
  pauseSidecar,
  removeSidecar,
  writeArcMode,
  clearArcMode,
  releaseClaims,
  readResultClaim,
  listResultClaims,
  claimResultConsumption,
  LaneHeldError,
} = await import(MOD)

const tmps = []
function newTmp(prefix = 'zr-sidecar-') {
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
  return execFileSync(
    'git',
    ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim()
}

/** A tmp MAIN git repo with one seed commit; returns its realpath'd root. */
function newRepo() {
  const d = newTmp()
  git(d, 'init', '-q', '-b', 'develop')
  writeFileSync(join(d, 'seed.txt'), 'seed\n')
  git(d, 'add', 'seed.txt')
  git(d, 'commit', '-qm', 'seed')
  return d
}

/** Add a LINKED worktree on a fresh branch; returns its realpath'd root. */
function addWorktree(mainRepo, branch) {
  const wt = join(newTmp('zr-sidecar-wt-'), 'tree')
  git(mainRepo, 'worktree', 'add', '-q', '-b', branch, wt, 'develop')
  return realpathSync(wt)
}

test('1) armSidecar lands the sidecar under the MAIN checkout, NOT the worktree (beacon-stamp trap)', () => {
  const main = newRepo()
  const wt = addWorktree(main, 'arc/mkt')
  const res = armSidecar(wt, 'ARC', { worktree: wt, branch: 'arc/mkt', mode: 'mixed' })

  const mainSidecar = join(main, 'roadmap', 'arcs', '.building', 'ARC.json')
  const worktreeSidecar = join(wt, 'roadmap', 'arcs', '.building', 'ARC.json')
  assert.ok(existsSync(mainSidecar), 'sidecar must land under the MAIN checkout')
  assert.ok(!existsSync(worktreeSidecar), 'sidecar must NOT land under the linked worktree')
  assert.equal(buildingDir(wt), join(mainCheckout(wt), 'roadmap', 'arcs', '.building'))

  const s = res.sidecar
  assert.equal(s.arcId, 'ARC')
  assert.equal(s.worktree, resolve(wt))
  assert.equal(s.pid, process.pid)
  assert.equal(s.sessionHint, null, 'sessionHint defaults to null when not passed')
  assert.ok(typeof s.armedAt === 'string' && !Number.isNaN(Date.parse(s.armedAt)), 'armedAt ISO stamp')
  assert.equal(s.mode, 'mixed')
})

test('2) foreign-worktree re-arm throws LaneHeldError naming the holder worktree', () => {
  const main = newRepo()
  const wtA = addWorktree(main, 'arc/a')
  armSidecar(wtA, 'ARC', { worktree: wtA, branch: 'arc/a', mode: 'mixed' })

  const other = newTmp('zr-sidecar-other-')
  let err
  try {
    armSidecar(main, 'ARC', { worktree: other, branch: 'arc/b', mode: 'mixed' })
  } catch (e) {
    err = e
  }
  assert.ok(err instanceof LaneHeldError, 'a different worktree must be refused')
  assert.ok(
    err.message.includes(resolve(wtA)),
    `the refusal must name the holder worktree ${resolve(wtA)}; got: ${err.message}`,
  )
})

test('3) same-worktree re-arm is idempotent; a DEAD recorded pid ⇒ warned:false', () => {
  const main = newRepo()
  const wt = addWorktree(main, 'arc/dead')
  // Hand-write an existing sidecar for the SAME worktree carrying a dead pid.
  const dir = join(main, 'roadmap', 'arcs', '.building')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'ARC.json'),
    JSON.stringify({ arcId: 'ARC', worktree: resolve(wt), branch: 'arc/dead', pid: 999999, armedAt: new Date().toISOString() }),
  )
  const res = armSidecar(wt, 'ARC', { worktree: wt, branch: 'arc/dead', mode: 'mixed' })
  assert.equal(res.warned, false, 'a dead recorded pid raises no live-lane warning')
  assert.equal(res.sidecar.worktree, resolve(wt))
})

test('4) same-worktree re-arm with a LIVE recorded pid ⇒ warned:true + livePid', () => {
  const main = newRepo()
  const wt = addWorktree(main, 'arc/live')
  const dir = join(main, 'roadmap', 'arcs', '.building')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'ARC.json'),
    JSON.stringify({ arcId: 'ARC', worktree: resolve(wt), branch: 'arc/live', pid: process.pid, armedAt: new Date().toISOString() }),
  )
  const res = armSidecar(wt, 'ARC', { worktree: wt, branch: 'arc/live', mode: 'mixed' })
  assert.equal(res.warned, true, 'a still-alive recorded pid warns about a live lane')
  assert.equal(res.livePid, process.pid)
})

test('5) pauseSidecar sets paused:true and preserves branch/worktree; readSidecar reflects it', () => {
  const main = newRepo()
  const wt = addWorktree(main, 'arc/pause')
  armSidecar(wt, 'ARC', { worktree: wt, branch: 'arc/pause', mode: 'mixed', note: 'keep me' })
  pauseSidecar(wt, 'ARC')
  const s = readSidecar(wt, 'ARC')
  assert.equal(s.paused, true)
  assert.equal(s.branch, 'arc/pause', 'branch preserved across pause')
  assert.equal(s.worktree, resolve(wt), 'worktree preserved across pause')
  assert.equal(s.note, 'keep me', 'other fields preserved')
  assert.ok(listSidecars(wt).some((x) => x.arcId === 'ARC'), 'listSidecars includes it')
})

test('6) removeSidecar deletes it (readSidecar → null)', () => {
  const main = newRepo()
  const wt = addWorktree(main, 'arc/rm')
  armSidecar(wt, 'ARC', { worktree: wt, branch: 'arc/rm', mode: 'mixed' })
  assert.ok(readSidecar(wt, 'ARC') !== null)
  removeSidecar(wt, 'ARC')
  assert.equal(readSidecar(wt, 'ARC'), null)
})

test('7) writeArcMode/clearArcMode round-trip on <root>/.arc-mode', () => {
  const root = newTmp('zr-arcmode-')
  const flag = join(root, '.arc-mode')
  assert.ok(!existsSync(flag))
  writeArcMode(root)
  assert.ok(existsSync(flag), 'writeArcMode creates <root>/.arc-mode')
  clearArcMode(root)
  assert.ok(!existsSync(flag), 'clearArcMode removes it')
})

test('8) releaseClaims rm claim files best-effort; a missing claim is a no-op', () => {
  const main = newRepo()
  const claimsDir = join(gitCommonDir(main), 'zeroh-roadmap-claims')
  mkdirSync(claimsDir, { recursive: true })
  writeFileSync(join(claimsDir, '1700.claim'), 'x')
  // 1700 exists, 1701 does not — releasing both must not throw and must clear 1700.
  releaseClaims(main, [1700, 1701])
  assert.ok(!existsSync(join(claimsDir, '1700.claim')), 'the present claim is removed')
  assert.ok(!existsSync(join(claimsDir, '1701.claim')), 'a missing claim stays absent, no throw')
})

function claimInChild(repo, input, worker) {
  const program = `
    const mod = await import(process.argv[1])
    const input = JSON.parse(process.argv[3])
    input.owner = { pid: process.pid, sessionId: process.argv[2] }
    process.stdout.write(JSON.stringify(mod.claimResultConsumption(process.argv[4], input)))
  `
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, MOD, worker, JSON.stringify(input), repo], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', rejectResult)
    child.on('close', (code) => {
      if (code !== 0) rejectResult(new Error(`claim worker ${worker} exited ${code}: ${stderr}`))
      else resolveResult(JSON.parse(stdout))
    })
  })
}

test('9) result consumption claim has one cross-process winner and immutable conflict evidence', async () => {
  const repo = newRepo()
  const input = {
    arcId: 'ARC',
    phase: 1702,
    checkpointDigest: 'sha256:checkpoint-one',
    resultDigest: 'sha256:result-one',
    eventId: 'ARC:1702:checkpoint-one',
    authorityRef: { status: 'unknown', reason: 'read-only-projection', sourceRef: null },
  }
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => claimInChild(repo, input, `worker-${index}`)),
  )
  assert.equal(results.filter((result) => result.status === 'claimed').length, 1)
  assert.equal(results.filter((result) => result.status === 'duplicate').length, 7)
  const published = readResultClaim(repo, {
    arcId: input.arcId,
    phase: input.phase,
    checkpointDigest: input.checkpointDigest,
  })
  assert.equal(published.resultDigest, input.resultDigest)
  assert.equal(published.checkpointDigest, input.checkpointDigest)
  assert.ok(results.every((result) => result.claim.resultDigest === input.resultDigest))

  const conflict = claimResultConsumption(repo, {
    ...input,
    resultDigest: 'sha256:different-result',
    eventId: 'ARC:1702:different-result',
    owner: { pid: process.pid, sessionId: 'conflicting-session' },
  })
  assert.equal(conflict.status, 'conflict')
  assert.equal(conflict.claim.resultDigest, input.resultDigest)
  assert.deepEqual(
    readResultClaim(repo, { arcId: input.arcId, phase: input.phase, checkpointDigest: input.checkpointDigest }),
    published,
    'a conflict never overwrites the immutable winning claim',
  )
})

const claimPath = (repo, input) => join(
  buildingDir(repo),
  'result-claims',
  encodeURIComponent(input.arcId),
  `${input.phase}-${encodeURIComponent(input.checkpointDigest)}.json`,
)

test('10) malformed or identity-mismatched existing claim fails without changing its bytes', () => {
  for (const body of [
    '{ malformed json',
    JSON.stringify({
      arcId: 'OTHER',
      phase: 1702,
      checkpointDigest: 'sha256:checkpoint-one',
      resultDigest: 'sha256:result-one',
      eventId: 'foreign',
      owner: { pid: process.pid, sessionId: 'foreign' },
      authorityRef: { status: 'unknown', reason: 'read-only-projection', sourceRef: null },
      claimedAt: new Date().toISOString(),
    }),
  ]) {
    const repo = newRepo()
    const input = {
      arcId: 'ARC',
      phase: 1702,
      checkpointDigest: 'sha256:checkpoint-one',
      resultDigest: 'sha256:result-one',
      eventId: 'event-one',
      owner: { pid: process.pid, sessionId: 'session-one' },
      authorityRef: { status: 'unknown', reason: 'read-only-projection', sourceRef: null },
    }
    const target = claimPath(repo, input)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body)
    assert.throws(() => readResultClaim(repo, input), /malformed|identity/)
    assert.throws(() => claimResultConsumption(repo, input), /malformed|identity/)
    assert.equal(readFileSync(target, 'utf8'), body, 'refusal leaves the existing bytes intact')
  }
})

test('11) result claim refuses existing symlinks without reading or changing outside bytes', () => {
  for (const dangling of [false, true]) {
    const repo = newRepo()
    const input = {
      arcId: 'ARC',
      phase: 1703,
      checkpointDigest: `sha256:symlink-${dangling}`,
      resultDigest: 'sha256:result',
      eventId: `event-symlink-${dangling}`,
      owner: { pid: process.pid, sessionId: 'session-one' },
      authorityRef: { status: 'unknown', reason: 'read-only-projection', sourceRef: null },
    }
    const target = claimPath(repo, input)
    const outside = join(newTmp('zr-claim-outside-'), 'outside.json')
    const outsideBytes = 'outside bytes must remain private\n'
    if (!dangling) writeFileSync(outside, outsideBytes)
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(outside, target)
    assert.throws(() => readResultClaim(repo, input), /symlink/)
    assert.throws(() => claimResultConsumption(repo, input), /symlink/)
    if (!dangling) assert.equal(readFileSync(outside, 'utf8'), outsideBytes)
  }
})

test('12) different results racing for one checkpoint yield one claim and one immutable conflict', async () => {
  const repo = newRepo()
  const base = {
    arcId: 'ARC',
    phase: 1704,
    checkpointDigest: 'sha256:shared-checkpoint',
    authorityRef: { status: 'unknown', reason: 'read-only-projection', sourceRef: null },
  }
  const results = await Promise.all([
    claimInChild(repo, { ...base, resultDigest: 'sha256:left', eventId: 'left' }, 'left-session'),
    claimInChild(repo, { ...base, resultDigest: 'sha256:right', eventId: 'right' }, 'right-session'),
  ])
  assert.deepEqual(results.map((result) => result.status).sort(), ['claimed', 'conflict'])
  const winner = results.find((result) => result.status === 'claimed').claim
  const conflict = results.find((result) => result.status === 'conflict')
  assert.equal(conflict.claim.resultDigest, winner.resultDigest)
  assert.deepEqual(readResultClaim(repo, base), winner)
})

test('13) claim discovery refuses a valid claim stored under a noncanonical filename', () => {
  const repo = newRepo()
  const input = {
    arcId: 'ARC',
    phase: 1705,
    checkpointDigest: 'sha256:canonical-checkpoint',
    resultDigest: 'sha256:canonical-result',
    eventId: 'canonical-event',
    owner: { pid: process.pid, sessionId: 'canonical-session' },
    authorityRef: { status: 'unknown', reason: 'read-only-projection', sourceRef: null },
  }
  const published = claimResultConsumption(repo, input).claim
  const alias = join(dirname(claimPath(repo, input)), 'alias.json')
  const aliasBytes = JSON.stringify(published)
  writeFileSync(alias, aliasBytes)

  assert.throws(() => listResultClaims(repo, input.arcId), /canonical|identity|filename/)
  assert.equal(readFileSync(alias, 'utf8'), aliasBytes, 'refusal leaves alias bytes intact')
  assert.deepEqual(readResultClaim(repo, input), published, 'the canonical claim remains intact')
})
