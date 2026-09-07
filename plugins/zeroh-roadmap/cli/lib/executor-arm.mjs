/**
 * executor-arm — the CLI-owned .building/<N>-executor.armed lifecycle (1737.2).
 * The arm file is the executor-result-guard's session-bound channel (b): content is
 * JSON { sessionId, armedAt } — the exact shape detectArm parses. An unbound arm is
 * the 2026-07-17 cross-session fabrication hazard, so armExecutor REFUSES to write
 * without a session id, and staleArms treats any non-JSON/bare body as stale by
 * definition (the pre-session-binding format is inert under the guard and pure noise).
 *
 * Staleness = the arm outlived its executor: the phase is terminal (status done/
 * historical), OR the beacon's last event is phase-complete (read through beacon.mjs's
 * readBeaconLine so legacy terminal aliases count), OR the body is UNBOUND. Unbound is
 * judged by the GUARD's own contract (detectArm): JSON {sessionId} and a raw non-empty
 * string are BOTH bound formats (the raw string is the pre-1737 prose format the guard
 * honors — sweeping it on a live phase would disarm a running executor, the 1703
 * near-miss); truly unbound = empty body, unreadable, JSON without a sessionId, or a
 * purely-numeric body (the pre-D9 phase-number fossil, e.g. a file containing `1713`).
 *
 * EXCLUSIVITY CONTRACT (2026-08-17 scar). The arm used to bind a SESSION, but one session spawns
 * many executors: two were spawned onto the same phase by the same session, so the session id
 * matched and a disarm-then-rearm looked entirely legitimate. Both then shared one working tree and
 * one branch. The unit of exclusivity is therefore the EXECUTOR, guarded at two doors:
 *   - disarmExecutor REFUSES while the phase beacon's last event is anything but phase-complete or
 *     result-returned. This is the load-bearing one: disarm is the door the orchestrator actually
 *     walked through. result-returned is stamped by the executor-result-guard hook only when an
 *     executor ended with a valid typed PhaseExecutionResult, so the allow-set is exactly "this
 *     executor handed something back".
 *   - armExecutor REFUSES over an existing arm naming a different executorId — the belt for the
 *     no-disarm path.
 * AGE is deliberately not a rule input anywhere: 93 minutes of beacon silence is what a healthy
 * cross-repo executor looked like, so age is reported as evidence for a human and nothing more.
 * NO beacon at all means no evidence, and no evidence is not proof, so that disarm proceeds.
 * staleArms and its definition of stale are CONSUMED by this guard, never changed: the sweep
 * passes force because staleArms has already made the judgement.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, lstatSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBeaconLine } from './beacon.mjs'
import { scanPhaseFile } from './phasescan.mjs'
import { productRepos } from './product-repos.mjs'
import { listWorktrees } from './worktree.mjs'
import { roadmapRoot } from './roadmap-root.mjs'
import { publishImmutableFile } from './sidecar.mjs'
import { readRunReceipt } from './run-receipt.mjs'
import { isDeepStrictEqual } from 'node:util'

/** The one home for the arm-file path: `roadmap result check` reconciles against the same file. */
export function armPath(worktree, phase) {
  return join(worktree, '.building', `${phase}-executor.armed`)
}

export const DEFAULT_AGENT_CARD = fileURLToPath(new URL('../../agents/phase-executor.md', import.meta.url))

/** A phase's declared keyFiles; null means the file is absent, unreadable, or its declaration is underivable. */
export function phaseKeyFiles(worktree, phase) {
  const file = join(roadmapRoot(worktree), 'phases', `phase-${phase}.phase.ts`)
  if (!existsSync(file)) return null
  const parsed = scanPhaseFile(file)
  if (parsed === null) return null
  if (parsed.keyFiles.length > 0) return parsed.keyFiles
  let source
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const declaration = source.match(/(?:^|[{,]\s*)keyFiles\s*:\s*\[([\s\S]*?)\]/m)
  if (!declaration) {
    return /(?:^|[{,]\s*)keyFiles\s*:/m.test(source) ? null : []
  }
  const withoutComments = declaration[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim()
  if (withoutComments.length === 0) return []
  return null // a declaration the lightweight scanner could not resolve is underivable, never empty
}

/** Every registered worktree root, including prunable entries, in porcelain order. */
function worktreeRoots(worktree) {
  return listWorktrees(worktree).map(({ dir }) => dir)
}

/** Live sibling arms whose derived foreign product trees intersect this phase's trees. */
export function productRepoOverlaps(worktree, phase, repos) {
  const overlaps = []
  const notes = []
  if (repos.length === 0) return { overlaps, notes }
  for (const root of worktreeRoots(worktree)) {
    if (!existsSync(root)) {
      notes.push(`roadmap executor-arm: skipped missing or pruned sibling worktree ${root}\n`)
      continue
    }
    let arms
    try {
      arms = readdirSync(join(root, '.building'))
    } catch {
      continue
    }
    const stalePhases = new Set(staleArms(root, join(roadmapRoot(root), 'phases')).map((arm) => arm.phase))
    for (const name of arms) {
      const match = name.match(/^(\d+)-executor\.armed$/)
      if (!match) continue
      const siblingPhase = Number(match[1])
      if (root === worktree && String(siblingPhase) === String(phase)) continue
      if (stalePhases.has(siblingPhase)) continue
      if (!liveArm(root, siblingPhase)) continue
      const siblingKeys = phaseKeyFiles(root, siblingPhase)
      if (siblingKeys === null) {
        notes.push(`roadmap executor-arm: skipped sibling phase ${siblingPhase} in ${root} — phase file missing, unreadable, or keyFiles underivable\n`)
        continue
      }
      const siblingRepos = productRepos(siblingKeys, { worktree: root, maxRepos: Infinity })
      const shared = repos.filter((repo) => siblingRepos.includes(repo))
      if (shared.length > 0) overlaps.push({ phase: siblingPhase, root, repos: shared })
    }
  }
  return { overlaps, notes }
}

/**
 * The model alias an agent card DECLARES, or null.
 *
 * Bounded to the frontmatter block and line-anchored on the `model:` key: cards discuss their own
 * pin in prose (agents/arc-eval-judge.md says `model: sonnet` on three lines, one of them the
 * declaration), and a card's `description:` may quote a model id, so a first-match-anywhere search
 * records a sentence fragment as the request. Absent card, absent fence or absent key => null,
 * never a guess.
 */
export function cardModelAlias(cardPath) {
  if (!existsSync(cardPath)) return null
  let text
  try {
    text = readFileSync(cardPath, 'utf8')
  } catch {
    return null
  }
  const lines = text.split('\n')
  if (lines[0].trim() !== '---') return null
  const end = lines.indexOf('---', 1)
  if (end < 0) return null
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^model:[ \t]*(\S+)[ \t]*$/)
    if (m) return m[1]
  }
  return null
}

/** The beacon events that mean "this executor handed something back", and so the only ones under
 *  which an arm may be cleared silently. Closed on purpose: anything else is work in flight. */
const DISARM_ALLOWED = new Set(['phase-complete', 'result-returned'])

/** The executorId recorded in an existing arm, or null for a missing / legacy / non-JSON body. */
function armedExecutorId(worktree, phase) {
  try {
    const raw = readFileSync(armPath(worktree, phase), 'utf8').trim()
    if (!raw.startsWith('{')) return null // the raw prose format predates executor ids
    const id = JSON.parse(raw).executorId
    return typeof id === 'string' && id.length > 0 ? id : null
  } catch {
    return null // absent or unreadable — nothing to defend
  }
}

/**
 * The arm a NEW executor must not be spawned over → { executorId, beaconEvent }, or null when the
 * phase is free. The CHECK door cannot afford the WRITE door's leniency: armExecutor overwrites an
 * arm carrying no executorId so nothing already on disk breaks, but SPAWNING over one puts two
 * executors on one working tree and one branch (2026-08-17). So an arm is live when it names an
 * executor OR when the beacon says its work is still in flight — the same allow-set disarm uses,
 * read through beacon.mjs so legacy terminal aliases count. An id-less, beacon-QUIET arm is
 * deliberately not live: that is a fossil, and judging fossils is staleArms' job, not this one's.
 */
export function liveArm(worktree, phase) {
  if (!existsSync(armPath(worktree, phase))) return null
  const executorId = armedExecutorId(worktree, phase)
  const beacon = readBeaconLine(join(worktree, '.building', `${phase}-executor.jsonl`))
  const working = Boolean(beacon) && !DISARM_ALLOWED.has(beacon.event)
  if (!executorId && !working) return null
  return { executorId, beaconEvent: beacon?.event ?? null }
}

/**
 * Write the session-bound arm file; missing/empty sessionId THROWS (never an unbound arm).
 *
 * Refuses when an existing arm names a DIFFERENT executorId than the incoming one, unless
 * `force`. An incoming arm with no executorId cannot prove it is the incumbent, so it refuses
 * too; an EXISTING arm carrying no executorId never refuses, so nothing already on disk breaks.
 *
 * `expectedModelAlias` records the model the launcher REQUESTED (the agent card's alias), which
 * makes this file the session lane's launch journal: a spawner cannot know the executor's exact
 * model id, but it knows what it asked for, and `roadmap result check` reconciles the two by
 * family. It is NOT an exclusivity axis — a re-arm may change it without refusing — and an empty
 * alias records nothing, because a blank request is not a request.
 */
export function readExecutorRunArm(worktree, phase) {
  const path = armPath(worktree, phase)
  if (!existsSync(path)) return { status: 'missing', path }
  if (lstatSync(path).isSymbolicLink()) throw new Error('executor-arm: unsafe arm symlink')
  let arm
  const raw = readFileSync(path, 'utf8').trim()
  try { arm = JSON.parse(raw) } catch {
    return { status: 'partial', path, arm: null }
  }
  if (!arm || typeof arm !== 'object' || Array.isArray(arm)) return { status: 'partial', path, arm }
  const keys = Object.keys(arm).sort()
  const exact = JSON.stringify(keys) === JSON.stringify(['armedAt', 'executorId', 'requestFingerprint', 'runId', 'sessionId'])
  const strings = ['armedAt', 'executorId', 'requestFingerprint', 'runId', 'sessionId'].every((field) => typeof arm[field] === 'string' && arm[field].trim())
  return { status: exact && strings && !Number.isNaN(Date.parse(arm.armedAt)) ? 'valid' : 'partial', path, arm }
}

export function claimExecutorRun(worktree, phase, { sessionId, executorId, runReceipt } = {}) {
  if (!Number.isInteger(Number(phase)) || Number(phase) <= 0 || typeof sessionId !== 'string' || !sessionId.trim()
    || typeof executorId !== 'string' || !executorId.trim()) throw new Error('executor run claim requires phase, sessionId, and executorId')
  if (!runReceipt || typeof runReceipt.path !== 'string' || !runReceipt.path.trim() || !runReceipt.snapshot) {
    throw new Error('executor run claim requires a canonical receipt path and snapshot')
  }
  const canonical = readRunReceipt(worktree, { arcId: runReceipt.snapshot.arcId, runId: runReceipt.snapshot.runId }, { revision: 0 })
  if (!canonical || resolve(runReceipt.path) !== resolve(canonical.path)
    || runReceipt.digest !== canonical.digest || !isDeepStrictEqual(runReceipt.snapshot, canonical.snapshot)) {
    throw new Error('executor run claim canonical receipt path, digest or snapshot mismatch')
  }
  const snapshot = canonical.snapshot
  if (snapshot.request.phase !== Number(phase) || resolve(snapshot.request.worktree) !== resolve(worktree)) {
    throw new Error('executor run claim phase or worktree mismatch')
  }
  if (snapshot.request.executorId !== executorId) return { status: 'conflict', reason: 'run receipt executorId does not match arm executorId' }
  if (snapshot.revision !== 0 || snapshot.previousDigest !== null || snapshot.pendingOperation?.kind !== 'start'
    || snapshot.nativeSessionId !== null || snapshot.outcome !== 'pending') {
    throw new Error('executor run claim requires the canonical pre-start receipt')
  }
  const p = armPath(worktree, phase)
  const dir = dirname(p)
  if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error('executor-arm: unsafe .building symlink')
  mkdirSync(dir, { recursive: true })
  const body = { sessionId, executorId, runId: snapshot.runId, requestFingerprint: snapshot.requestFingerprint, armedAt: new Date().toISOString() }
  if (publishImmutableFile(p, JSON.stringify(body) + '\n')) return { status: 'recorded', path: p, arm: body }
  const evidence = readExecutorRunArm(worktree, phase)
  const existing = evidence.arm
  if (evidence.status !== 'valid') return { status: 'hold', path: p, arm: existing, reason: 'legacy partial executor arm lacks runId or requestFingerprint' }
  const same = existing.sessionId === sessionId && existing.executorId === executorId
    && existing.runId === snapshot.runId && existing.requestFingerprint === snapshot.requestFingerprint
  return { status: same ? 'duplicate' : 'conflict', path: p, arm: existing,
    ...(same ? {} : { reason: 'executor arm is already held by different stable run identity' }) }
}

export function armExecutor(worktree, phase, sessionId, opts = {}) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('executor-arm: sessionId is required — an unbound arm file is never written (the 2026-07-17 fabrication hazard)')
  }
  const { executorId, expectedModelAlias, force = false } = opts
  const incumbent = armedExecutorId(worktree, phase)
  if (!force && incumbent && incumbent !== executorId) {
    throw new Error(
      `executor-arm: phase ${phase} is already armed to executor '${incumbent}'`
        + `${executorId ? `, not '${executorId}'` : " and the incoming arm names no executor id ('--executor-id')"}`
        + ' — a second executor on one phase shares its working tree and branch with the first (2026-08-17).'
        + ' Pass force only after establishing that the incumbent executor is genuinely gone.',
    )
  }
  const p = armPath(worktree, phase)
  mkdirSync(dirname(p), { recursive: true })
  const alias = typeof expectedModelAlias === 'string' ? expectedModelAlias.trim() : ''
  const body = {
    sessionId,
    ...(executorId ? { executorId } : {}),
    ...(alias ? { expectedModelAlias: alias } : {}),
    armedAt: new Date().toISOString(),
  }
  writeFileSync(p, JSON.stringify(body) + '\n')
  return p
}

/**
 * Remove the arm file. A missing file is a silent no-op.
 *
 * REFUSES while the phase beacon's last event is a work event: clearing a live arm is what let a
 * second executor be spawned onto a phase the first still owned. A missing beacon still disarms —
 * no evidence is not proof. `force` is the deliberate override, and the sweep passes it because
 * staleArms has already applied its own definition of stale.
 */
export function disarmExecutor(worktree, phase, opts = {}) {
  const p = armPath(worktree, phase)
  if (!opts.force && existsSync(p)) {
    const beacon = readBeaconLine(join(worktree, '.building', `${phase}-executor.jsonl`))
    if (beacon && !DISARM_ALLOWED.has(beacon.event)) {
      const ageMin = (Date.now() - beacon.ts) / 60000
      throw new Error(
        `executor-disarm: phase ${phase} is armed and its executor never returned a result — the beacon's last event is`
          + ` '${beacon.event}' (${ageMin.toFixed(1)}min ago), not phase-complete or result-returned.`
          + ' Age is evidence, not permission: on 2026-08-17 a 93min-quiet beacon belonged to a healthy cross-repo'
          + ' executor, and disarming it put two executors on one branch. Read the beacon, then pass force if the'
          + ' executor is genuinely gone.',
      )
    }
  }
  rmSync(p, { force: true })
}

/** True iff the phase file at phasesDir reads terminal (regex tier — status: precedes notes). */
function phaseTerminal(phasesDir, phase) {
  const f = join(phasesDir, `phase-${phase}.phase.ts`)
  if (!existsSync(f)) return false
  const status = scanPhaseFile(f)?.status ?? null
  return status === 'done' || status === 'historical'
}

/**
 * Scan <worktree>/.building/*-executor.armed → the stale set, each entry
 * { file, phase, reason }. A live arm (JSON-bound, non-terminal phase, no terminal
 * beacon) is never returned.
 */
export function staleArms(worktree, phasesDir) {
  const dir = join(worktree, '.building')
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out = []
  for (const f of entries) {
    const m = f.match(/^(\d+)-executor\.armed$/)
    if (!m) continue
    const phase = Number(m[1])
    const file = join(dir, f)

    let bound = false
    try {
      const raw = readFileSync(file, 'utf8').trim()
      if (raw.startsWith('{')) bound = typeof JSON.parse(raw).sessionId === 'string'
      else bound = raw.length > 0 && !/^\d+$/.test(raw) // raw session id = the old BOUND prose format (guard detectArm honors it)
    } catch {
      /* unreadable = unbound */
    }
    if (!bound) {
      out.push({ file, phase, reason: 'unbound arm (empty / phase-number fossil / JSON without sessionId) — stale by definition' })
      continue
    }
    if (phaseTerminal(phasesDir, phase)) {
      out.push({ file, phase, reason: `phase ${phase} is terminal (status done/historical) — the arm outlived its executor` })
      continue
    }
    const beacon = readBeaconLine(join(dir, `${phase}-executor.jsonl`))
    if (beacon?.event === 'phase-complete') {
      out.push({ file, phase, reason: `beacon terminal (phase-complete) — the arm outlived its executor` })
    }
  }
  return out
}
