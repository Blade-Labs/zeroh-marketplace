/**
 * arc-plane.workflow.mjs — the §4 per-plane sequencing workflow (ROADCODE-DESIGN §4).
 *
 * ONE deterministic workflow per plane: every transition is a `roadmap` CLI call, every
 * non-done path a TYPED halt (built by cli/lib/workflow-steps.mjs) that ENDS the workflow
 * and hands the session the conversation — nothing auto-proceeds past a halt. This is the
 * code backstop the thin do-skills (1658.3-1658.6) delegate to; do-arc launches it once per
 * plane and control returns between planes (locked decision 2).
 *
 * §4 is the VERBATIM contract (pre-made decision 1). Two mechanical mappings from §4's
 * pseudocode are recorded here (semantics unchanged):
 *   (1) Input is { arcId, planeName, force? } — NOT a plane SNAPSHOT. plane.phases is
 *       re-resolved every iteration from `roadmap arc next`'s `next.plane` (derive.mjs
 *       re-reads the arc file on every call → files-are-truth, locked decision 3), so a
 *       sweep-authored member added to the plane mid-flight is picked up without a relaunch.
 *   (2) The band fed to classifyBandRoute is `next.band` (arc next emits it; `gate plan`
 *       does not), and plane membership is `next.plane === planeName`.
 *
 * The harness supplies the ONE judgment step, `agent()` (the phase-executor spawn) — every
 * other step is a Bash-shaped CLI call. Primitives are INJECTABLE (deps) so the fixture tier
 * (1660) drives every branch with fakes; the defaults shell to the real `roadmap` bin and
 * the harness `agent()` must be provided by the caller.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildHaltPayload,
  reduceArcTransition,
  classifyBandRoute,
  classifyNextAction,
  detectSelfDescope,
  buildExecutorPrompt,
  groomBacklogSource,
} from '../cli/lib/workflow-steps.mjs'
import { gitToplevel } from '../cli/lib/gitroot.mjs'
import { loadConfig } from '../cli/lib/config.mjs'
import { resolveSlot, runSlot } from '../cli/lib/slots.mjs'
import { bridgeImport } from '../cli/lib/tsx-bridge.mjs'
import { readBeaconLine, appendExecutorEvent, readResultTailCompletion } from '../cli/lib/beacon.mjs'
import { armExecutor, disarmExecutor, liveArm, armPath, cardModelAlias, DEFAULT_AGENT_CARD, phaseKeyFiles, productRepoOverlaps } from '../cli/lib/executor-arm.mjs'
import { productRepos } from '../cli/lib/product-repos.mjs'
import { pidAlive, claimResultConsumption, listResultClaims } from '../cli/lib/sidecar.mjs'
import { deriveArcLifecycleTransition } from '../cli/lib/derive.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'roadmap.mjs')
const BACKGROUND_RUN_MAX_MIN = 10 // mirror hooks/executor-result-guard.mjs — one 10-min rule

/** Default `run` primitive: shell one `roadmap <cmd>` string to the bin, returning
 *  { stdout, stderr, exitCode } (never throws — the exit code IS the verdict). */
function defaultRun(cmd, { input, cwd } = {}) {
  const argv = cmd.trim().replace(/^roadmap\s+/, '').split(/\s+/)
  try {
    const stdout = execFileSync('node', [BIN, ...argv], { input, cwd, encoding: 'utf8' })
    return { stdout, stderr: '', exitCode: 0 }
  } catch (e) {
    return { stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '', exitCode: e.status ?? 1 }
  }
}

/** The default `agent()` is provided by the workflow harness (Claude Agent SDK / the session):
 *  it runs the phase-executor AND the backgrounded `roadmap watch` watchdog concurrently and
 *  resolves to { result } (executor returned) OR { watchExit, watchVerdict } (watchdog woke
 *  first). Without a harness there is nothing to run — fail loud, never fabricate a result.
 *
 *  CONTRACT the harness must honour: a repeat call for a phase already in flight (the
 *  keep-waiting branch below) MUST re-await the SAME executor, never spawn a second one. The
 *  workflow arms once, pre-spawn, so a re-spawning harness reproduces the exact double-spawn
 *  the arm exists to prevent, and the arm on disk cannot see it. */
function defaultAgent() {
  throw new Error(
    'arc-plane.workflow: no agent() runner injected — the harness (Claude Agent SDK / the do-arc '
    + 'session) must provide deps.agent to spawn the phase-executor. The workflow composes CLI parts; '
    + 'the ONE judgment step is the caller\'s.',
  )
}

const jsonOf = (r) => JSON.parse(r.stdout)

function lifecycleHalt(kind, { arcId = 'unknown', phase = null, evidence = null, stage = 'phase' } = {}) {
  const authorityRef = { status: 'unknown', reason: 'read-only-projection', sourceRef: null }
  const prior = {
    arcId: String(arcId),
    stage,
    status: 'active',
    processedEventIds: [],
    lastHalt: null,
    authorityRef,
  }
  const event = {
    eventId: `workflow:${arcId}:${kind}:${phase ?? '-'}:${createHash('sha256').update(JSON.stringify(evidence)).digest('hex')}`,
    arcId: String(arcId),
    source: 'arc-plane-workflow',
    type: kind,
    ...(phase == null ? {} : { phase }),
    evidence,
    authorityRef,
  }
  const transitionReceipt = reduceArcTransition(prior, event)
  return {
    ...buildHaltPayload(kind, { phase, evidence }),
    transitionReceipt,
    trace: { state: transitionReceipt.next, receipts: [transitionReceipt] },
  }
}

function withTransition(payload, transitionReceipt, priorReceipts = []) {
  return {
    ...payload,
    transitionReceipt,
    trace: { state: transitionReceipt.next, receipts: [...priorReceipts, transitionReceipt] },
  }
}

function commandFailure(kind, field, result, context) {
  const evidence = { [field]: result.stderr || result.stdout || `${field} exited ${result.exitCode}` }
  return lifecycleHalt(kind, { ...context, evidence })
}

function currentHead(worktree) {
  try {
    return execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}


function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`

function duplicateResultOutput({ arcId, phase, evidence, eventId, authorityRef }) {
  const prior = {
    arcId: String(arcId),
    stage: 'phase',
    status: 'active',
    processedEventIds: [eventId],
    lastHalt: null,
    authorityRef,
  }
  const event = { eventId, arcId: String(arcId), source: 'result-consumption', type: 'done', phase, evidence, authorityRef }
  const transitionReceipt = reduceArcTransition(prior, event)
  return {
    ...buildHaltPayload('blocked', { phase, evidence }),
    transitionReceipt,
    trace: { state: transitionReceipt.next, receipts: [transitionReceipt] },
  }
}

/** The latest beacon event for the phase, or null. A fresh `background-run` with a live `log`
 *  means a detached run is alive — the STALLED probe uses this to KEEP WAITING, never halt. */
function latestPhaseBeacon(worktree, phase) {
  return readBeaconLine(join(worktree, '.building', `${phase}-executor.jsonl`))
}

/**
 * A background-run beacon that demonstrably proves external work is STILL ALIVE — the ONLY
 * ground for suppressing a STALLED watch-wake halt (the design §N8/N9 contract, mirroring the
 * Stop-hook's licensed-yield rule). It must be a `background-run` with a `log`, YOUNGER than
 * the 10-min window, AND — when it records a pid — that pid must be live. A stale (>10 min) or
 * dead-pid beacon is NOT proof of life, so the wake becomes the typed stalled halt.
 */
function backgroundRunAlive(b) {
  if (!b || b.event !== 'background-run' || !b.log) return false
  // readBeaconLine already parsed the age; b.ts is a number (ms), so never re-Date.parse it.
  const ageMin = Number.isFinite(b.ageMin) ? b.ageMin : (Date.now() - b.ts) / 60000
  if (!Number.isFinite(ageMin) || ageMin >= BACKGROUND_RUN_MAX_MIN) return false
  // pidAlive is a signal-0 liveness PROBE (in sidecar.mjs) — the workflow never holds the kill
  // primitive itself (its "never kills a process" invariant). A recorded-but-dead pid ⇒ not alive.
  if (b.pid != null && !pidAlive(b.pid)) return false
  return true
}

/** Read the phase's + arc's acceptanceCriteria + the arc designRefs via the typed bridge
 *  (the same seam validate-roadmap-file proves). Best-effort: a bridge miss yields empty
 *  arrays (detectSelfDescope then no-ops rather than false-firing). */
function readPhaseAndArcMeta(repoRoot, arcId, phase) {
  const meta = { acceptanceCriteria: [], tasks: [], arcCriteria: [], designRefs: [] }
  const pf = join(repoRoot, 'roadmap', 'phases', `phase-${phase}.phase.ts`)
  const pimp = bridgeImport(pf, { consumerRoot: repoRoot })
  if (pimp.ok) {
    meta.acceptanceCriteria = pimp.parsed?.acceptanceCriteria ?? []
    meta.tasks = pimp.parsed?.tasks ?? []
  }
  const af = join(repoRoot, 'roadmap', 'arcs', `${arcId}.arc.ts`)
  const aimp = bridgeImport(af, { consumerRoot: repoRoot })
  if (aimp.ok) {
    meta.arcCriteria = (aimp.parsed?.acceptanceCriteria ?? []).map((c) => c.job ?? c.signal ?? c)
    meta.designRefs = aimp.parsed?.designRefs ?? []
  }
  return meta
}

/**
 * serializeSharedMutation(phase) — the orchestrator-owned, serial-by-construction tail (§4):
 * groom roadmap/backlog.ts via the pure groomBacklogSource ({ error } → a typed halt, NEVER a
 * silent skip — pre-made decision 2) + run the consumer's `emit` slot through the ONE
 * config/slots seam (singleSeam 1). It runs between executor spawns, never concurrently.
 */
async function serializeSharedMutation(phase, { repoRoot, cfg, arcId }) {
  const backlogPath = join(repoRoot, 'roadmap', 'backlog.ts')
  if (existsSync(backlogPath)) {
    const groomed = groomBacklogSource(readFileSync(backlogPath, 'utf8'), phase, { allowAbsent: true })
    if (groomed.error) return buildHaltPayload('failed', { phase, evidence: { backlogGroom: groomed.error } })
    writeFileSync(backlogPath, groomed.source)
  }
  const emit = resolveSlot(cfg, 'emit')
  // A MISSING emit binding fails loud (the arc honesty rail: a missing gate slot never
  // silently no-ops); a `declaredAbsent` ('none') emit is a deliberate consumer opt-out.
  if (emit.refused) return buildHaltPayload('failed', { phase, evidence: { emitSlot: emit.refused } })
  if (emit.command) {
    // runSlot's exitCode is DATA (never thrown) — a red emit must map to a typed halt,
    // exactly as gate.mjs / landing.mjs treat their runSlot returns; discarding it would
    // narrate around a red the honesty rail exists to catch.
    const er = await runSlot(emit, { cwd: repoRoot })
    if (er.exitCode !== 0) return buildHaltPayload('failed', { phase, evidence: { emitSlot: er } })
  }
  return null
}

/**
 * arcPlaneWorkflow({ arcId, planeName, force }, deps) — the §4 loop. deps = { run, agent, bg,
 * cwd } (all optional; defaults shell to the real bin). Returns { done } | { planeDone } |
 * { handoff } | { handoffInline } | a typed halt payload.
 */
export default async function arcPlaneWorkflow(input, deps = {}) {
  const { arcId, planeName, force, pauseAfter, recovery } = input
  const run = deps.run ?? defaultRun
  const agent = deps.agent ?? defaultAgent
  const warn = deps.warn ?? ((message) => process.stderr.write(message))
  const cwd = deps.cwd ?? process.cwd()
  const workflowHalt = (kind, detail = {}) => lifecycleHalt(kind, { arcId, ...detail })
  if (pauseAfter !== undefined && (!Number.isInteger(pauseAfter) || pauseAfter < 1)) {
    return workflowHalt('failed', { evidence: { pauseAfter: 'must be a positive phase number' } })
  }
  const recoveryKinds = new Set(['failed', 'stalled', 'exited', 'unobserved'])
  const recoveryEvidenceValid = recovery?.kind === 'failed'
    ? recovery?.evidence?.inspected === true
    : recovery?.evidence?.reconciled === true
  if (recovery !== undefined && (!recoveryKinds.has(recovery?.kind)
    || !Number.isInteger(recovery?.phase) || recovery.phase < 1
    || !recoveryEvidenceValid)) {
    return workflowHalt('failed', { evidence: { recovery: 'requires failed+inspected or watch-halt+reconciled evidence for a positive phase' } })
  }
  const repoRoot = gitToplevel(cwd)
  const cfg = loadConfig(cwd)
  const worktree = repoRoot
  const completedClaims = new Set()
  const lifecycleReceipts = []
  if (recovery) {
    const authorityRef = { status: 'unknown', reason: 'read-only-projection', sourceRef: null }
    const active = { arcId: String(arcId), stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef }
    const haltReceipt = reduceArcTransition(active, {
      eventId: `recovery-cause:${arcId}:${recovery.phase}`,
      arcId: String(arcId), source: 'arc-plane-workflow', type: recovery.kind,
      phase: recovery.phase, evidence: { recovery: recovery.kind }, authorityRef,
    })
    if (haltReceipt.rejection) return workflowHalt('failed', { phase: recovery.phase, evidence: { recovery: haltReceipt.rejection } })
    if (existsSync(armPath(worktree, recovery.phase))) {
      return {
        ...buildHaltPayload(recovery.kind, { phase: recovery.phase, evidence: { executorArm: 'standing executor arm remains unresolved' } }),
        resume: haltReceipt.resume,
        transitionReceipt: haltReceipt,
        trace: { state: haltReceipt.next, receipts: [haltReceipt] },
      }
    }
    const resumeReceipt = reduceArcTransition(haltReceipt.next, {
      eventId: `recovery:${arcId}:${recovery.phase}`,
      arcId: String(arcId), source: 'arc-plane-workflow', type: 'resume',
      phase: recovery.phase, evidence: recovery.evidence, authorityRef,
    })
    if (resumeReceipt.rejection) return workflowHalt('failed', { phase: recovery.phase, evidence: { recovery: resumeReceipt.rejection } })
    lifecycleReceipts.push(haltReceipt, resumeReceipt)
  }

  // fail-loud before anything (§4: `roadmap config check`).
  const cfgCheck = run('roadmap config check', { cwd })
  if (cfgCheck.exitCode !== 0) return commandFailure('failed', 'configCheck', cfgCheck, { arcId })
  // arm the lane (no-op if this session already holds it).
  const arcArm = run(`roadmap arm ${arcId}`, { cwd })
  if (arcArm.exitCode !== 0) return commandFailure('blocked', 'arcArm', arcArm, { arcId })

  const plane = { name: planeName } // NO snapshot — membership is next.plane, re-resolved each iteration

  while (true) {
    // A claim proves only that result consumption began. Before deriving any next
    // action, require the exact durable tail-completion marker or stop for inspection.
    let pendingClaims
    try {
      pendingClaims = listResultClaims(worktree, arcId)
    } catch (e) {
      return workflowHalt('failed', { evidence: { resultConsumptionInterrupted: e.message } })
    }
    for (const claim of pendingClaims) {
      if (completedClaims.has(claim.eventId)) continue
      const completion = readResultTailCompletion(worktree, claim.phase, claim)
      if (!completion) {
        return workflowHalt('failed', {
          phase: claim.phase,
          evidence: { resultConsumptionInterrupted: { claim, reason: 'result tail completion is not durably proven' } },
        })
      }
    }

    const arcNext = run(`roadmap arc next ${arcId} --json`, { cwd })
    if (arcNext.exitCode !== 0 || !arcNext.stdout?.trim()) {
      return commandFailure('failed', 'arcNext', arcNext, { arcId })
    }
    let next
    try {
      next = jsonOf(arcNext)
    } catch (e) {
      return workflowHalt('failed', { arcId, evidence: { arcNext: `invalid JSON: ${e.message}` } })
    }
    let decision
    try {
      decision = classifyNextAction(next, plane)
    } catch (e) {
      return workflowHalt('failed', { evidence: { arcNext: e.message } })
    }
    // Recompute from the read-only projection. CLI JSON is evidence, not authority
    // over lifecycle state, so an injected or stale receipt cannot drive the workflow.
    const transitionReceipt = deriveArcLifecycleTransition(next)
    if (transitionReceipt.rejection) {
      return workflowHalt('failed', { phase: next.phase ?? null, evidence: { lifecycleProjection: transitionReceipt.rejection } })
    }

    if (decision === 'complete') return withTransition({ done: true, arc: arcId }, transitionReceipt, lifecycleReceipts)
    if (decision === 'halt') {
      const kind = next.action === 'gaps' ? 'gaps' : next.action === 'land-unproven' ? 'land-unproven' : 'blocked'
      return {
        ...buildHaltPayload(kind, { phase: next.phase ?? null, evidence: next }),
        resume: transitionReceipt.resume,
        transitionReceipt,
        trace: { state: transitionReceipt.next, receipts: [...lifecycleReceipts, transitionReceipt] },
      }
    }
    if (decision === 'plane-done') return withTransition({ planeDone: true, plane: planeName }, transitionReceipt, lifecycleReceipts)
    if (decision === 'handoff') return withTransition({ handoff: next.action, next }, transitionReceipt, lifecycleReceipts)

    // decision === 'run' (run-phase | resume-phase)
    const phase = next.phase
    const preflightArm = liveArm(worktree, phase)
    if (preflightArm) {
      const who = preflightArm.executorId
        ? `executor '${preflightArm.executorId}'`
        : `an executor it does not name (beacon '${preflightArm.beaconEvent ?? 'unresolved'}')`
      const halt = workflowHalt('blocked', {
        phase,
        evidence: {
          executorArm:
            `arc-plane: phase ${phase} is already armed to ${who} — refusing to continue over its working tree and branch. Reconcile the arm before resuming.`,
        },
      })
      return { ...halt, resume: halt.transitionReceipt.resume }
    }
    const prestartHead = next.action === 'run-phase' ? currentHead(worktree) : null
    if (next.action === 'run-phase' && !prestartHead) {
      return workflowHalt('failed', { phase, evidence: { baseline: 'cannot resolve exact pre-start HEAD' } })
    }
    const planCommand = prestartHead
      ? `roadmap gate plan ${phase} --base ${prestartHead} --json`
      : `roadmap gate plan ${phase} --json`
    const gatePlan = run(planCommand, { cwd })
    if (gatePlan.exitCode !== 0 || !gatePlan.stdout?.trim()) {
      return commandFailure('failed', 'gatePlan', gatePlan, { arcId, phase })
    }
    let plan
    try {
      plan = jsonOf(gatePlan)
    } catch (e) {
      return workflowHalt('failed', { arcId, phase, evidence: { gatePlan: `invalid JSON: ${e.message}` } })
    }
    plan = { ...plan, baselineKind: prestartHead ? 'pre-start-head' : 'phase-start', baseHead: prestartHead }
    const bandRoute = classifyBandRoute(next.band, force)
    if (bandRoute.route === 'handoff-inline') {
      // trivial/heavy (or --inline forced) → the session runs this phase INLINE under the thin
      // do-phase arc-mode / inline-supervised rules; only `mid` spawns an executor.
      return withTransition({ handoffInline: bandRoute, phase, plan }, transitionReceipt, lifecycleReceipts)
    }

    // ── the executor spawn (the ONE agent() judgment step) ──
    const meta = readPhaseAndArcMeta(repoRoot, arcId, phase)
    const phaseFilePath = join(repoRoot, 'roadmap', 'phases', `phase-${phase}.phase.ts`)
    const phaseSource = existsSync(phaseFilePath) ? readFileSync(phaseFilePath, 'utf8') : ''
    const beacon = latestPhaseBeacon(worktree, phase)
    const prompt = buildExecutorPrompt({
      phaseFilePath,
      phaseSource,
      gatePlan: plan,
      designRefs: meta.designRefs,
      beaconEvents: beacon ? [beacon] : [],
    })
    const contract = run('roadmap contract show --json-schema', { cwd })
    if (contract.exitCode !== 0 || !contract.stdout?.trim()) return commandFailure('failed', 'contractShow', contract, { arcId, phase })
    let schema
    try {
      schema = jsonOf(contract)
    } catch (e) {
      return workflowHalt('failed', { phase, evidence: { contractShow: `invalid JSON: ${e.message}` } })
    }

    // Arm the guard BEFORE the spawn, through the ONE lifecycle lib both lanes share. The id is
    // minted per SPAWN, not per session: one session spawns many executors, and the 2026-08-17
    // double-spawn is exactly the case a session-bound arm cannot tell apart (executor-arm.mjs).
    // No session id ⇒ arm NOTHING: the guard treats an unbound arm as inert, so writing one only
    // litters .building, and the lib refuses to write one at all (the 2026-07-17 hazard).
    const sessionId = deps.sessionId ?? input.sessionId ?? null
    const executorId = randomUUID()
    const workflowKeys = phaseKeyFiles(worktree, phase)
    if (workflowKeys === null) warn(`arc-plane: phase ${phase}'s own phase file is missing, unreadable, or has underivable keyFiles — no product-tree claim derived\n`)
    const repos = productRepos(workflowKeys ?? [], { worktree, maxRepos: Infinity })
    let productClaim
    try {
      productClaim = productRepoOverlaps(worktree, phase, repos)
    } catch (e) {
      return workflowHalt('blocked', { phase, evidence: { productRepoOverlap: `overlap scan failed: ${e.message}` } })
    }
    for (const note of productClaim.notes) warn(note)
    if (productClaim.overlaps.length > 0) {
      const evidence = productClaim.overlaps
        .map((hit) => `phase ${hit.phase} in ${hit.root} shares ${hit.repos.join(', ')}`)
        .join('; ')
      return workflowHalt('blocked', {
        phase,
        evidence: { productRepoOverlap: `arc-plane: phase ${phase} product-tree overlap — ${evidence}` },
      })
    }
    // The incumbent CHECK is UNCONDITIONAL. D1 governs only the WRITE, but refusing to spawn onto
    // a phase another executor still owns must not depend on whether this lane happens to know its
    // own session id — a caller without one is precisely the lane that walked into the 2026-08-17
    // double-spawn. liveArm is the lib's own judgement (an arm naming an executor, or one whose
    // beacon still reads work in flight), so the CHECK door is never laxer than the disarm door.
    const armed = Boolean(sessionId)
    if (armed) {
      try {
        // Same alias the CLI records: this workflow is the other door onto the arm, and an
        // alias-less arm here silently no-ops the reconcile at line ~280 (`result check`).
        armExecutor(worktree, phase, sessionId, { executorId, expectedModelAlias: cardModelAlias(DEFAULT_AGENT_CARD) })
      } catch (e) {
        // The belt for a race between the read above and this write (the lib is the same rule).
        return workflowHalt('blocked', { phase, evidence: { executorArm: e.message } })
      }
    }

    let spawn
    let rc
    try {
    while (true) {
      // agent() resolves on executor return OR on the backgrounded `roadmap watch` watchdog
      // exit (3 STALLED / 4 EXITED / 5 UNOBSERVED). The workflow NEVER kills a process.
      spawn = await agent('phase-executor', {
        env: { ROADMAP_EXECUTOR_PHASE: String(phase) }, // arms the 1656 Stop-hook guard (env channel)
        prompt,
        schema,
        watchdog: deps.bg ? deps.bg(`roadmap watch ${arcId}`) : `roadmap watch ${arcId}`,
      })
      if (spawn.result !== undefined) break
      if (spawn.watchExit === 3) {
        // STALLED — probe the beacon FIRST: a demonstrably-alive background-run (fresh + live
        // pid) ⇒ external work is alive, keep waiting (never a false halt on a healthy 40-min
        // capbuild). A stale/dead-pid beacon is NOT proof of life → fall through to the halt.
        const b = latestPhaseBeacon(worktree, phase)
        // `continue` re-awaits the SAME still-running executor (the watchdog woke us, the
        // executor did not return) — so the once-built `prompt` is not re-sent and needs no
        // re-render; only a fresh spawn (a relaunch by the session after a halt) rebuilds it.
        if (backgroundRunAlive(b)) continue
        return workflowHalt('stalled', { phase, evidence: spawn.watchVerdict })
      }
      if (spawn.watchExit === 4) {
        return workflowHalt('exited', { phase, evidence: spawn.watchVerdict })
      }
      if (spawn.watchExit === 5) {
        // UNOBSERVED — no life signal could be probed. Behaviourally a halt like stalled, but the
        // session must judge it with the evidence in hand: relabelling it `stalled` is exactly the
        // over-claim that nearly put a second executor on a live phase (2026-08-18).
        return workflowHalt('unobserved', { phase, evidence: spawn.watchVerdict })
      }
      // an unrecognized wake with no result — treat as a stall, evidence in hand
      return workflowHalt('stalled', { phase, evidence: spawn })
    }

    // ── the result tail (§4 order) ──
    rc = run(`roadmap result check --phase ${phase}`, { cwd, input: JSON.stringify(spawn.result) }) // parse or die
    if (rc.exitCode === 0 && rc.stdout?.trim()) {
      try {
        appendExecutorEvent(worktree, phase, 'result-returned')
      } catch (e) {
        process.stderr.write(`arc-plane: phase ${phase} result-returned not stamped — ${e.message}\n`)
      }
    }
    } finally {
      // Disarm ONLY the arm THIS workflow wrote, and ONLY once OUR executor handed something back
      // (spawn.result present — even an unparseable one: it returned, so it is gone, and its arm
      // would otherwise strand where staleArms cannot reach it). Both are first-hand facts; the
      // beacon is inference, and disarmExecutor lets a MISSING beacon through (no evidence is not
      // proof), so an executor that died before its first beacon would have had its LIVE arm
      // cleared here. Every watchdog exit therefore leaves the arm STANDING on purpose: that
      // standing arm is what blocks the next spawn until a human or staleArms judges it. The lib
      // call stays as the belt (a work-event beacon still refuses) and its refusal is RECORDED.
      if (armed && spawn?.result !== undefined) {
        try {
          disarmExecutor(worktree, phase)
        } catch (e) {
          process.stderr.write(`arc-plane: phase ${phase} arm left standing — ${e.message}\n`)
        }
      }
    }
    if (rc.exitCode !== 0 || !rc.stdout?.trim()) return workflowHalt('failed', { phase, evidence: { resultCheck: rc.stderr || rc.stdout || 'invalid PhaseExecutionResult' } })
    let result
    try {
      result = jsonOf(rc)
    } catch (e) {
      return workflowHalt('failed', { phase, evidence: { resultCheck: `invalid JSON: ${e.message}` } })
    }
    if (result.status !== 'done') {
      // escalated/failed → the workflow ENDS; the session owns the conversation and surfaces it.
      return workflowHalt(result.status === 'escalated' ? 'escalated' : 'failed', { phase, evidence: result })
    }
    const descope = detectSelfDescope(result, { acceptanceCriteria: meta.acceptanceCriteria, tasks: meta.tasks, arcCriteria: meta.arcCriteria })
    if (descope.length > 0) return workflowHalt('self-descope', { phase, evidence: descope }) // bounce/ratify stays HUMAN

    const authorityRef = transitionReceipt.authorityRef
    const checkpointDigest = next.sourceCheckpoint?.digest
      ?? sha256(JSON.stringify({ arcId, phase, head: prestartHead ?? currentHead(worktree), action: next.action }))
    const resultDigest = sha256(canonicalJson(result))
    const eventId = `result:${arcId}:${phase}:${checkpointDigest}`
    const resultReceipt = reduceArcTransition(transitionReceipt.next, {
      eventId,
      arcId: String(arcId),
      source: 'result-consumption',
      type: 'done',
      phase,
      evidence: { checkpointDigest, resultDigest },
      authorityRef,
    })
    if (resultReceipt.rejection) {
      return workflowHalt('failed', { phase, evidence: { lifecycleResult: resultReceipt.rejection } })
    }
    lifecycleReceipts.push(resultReceipt)
    let consumption
    try {
      consumption = claimResultConsumption(worktree, {
        arcId,
        phase,
        checkpointDigest,
        resultDigest,
        eventId,
        owner: { pid: process.pid, sessionId: String(sessionId ?? `pid-${process.pid}`) },
        authorityRef,
      })
    } catch (e) {
      return workflowHalt('failed', { phase, evidence: { resultConsumption: e.message } })
    }
    if (consumption.status === 'duplicate') {
      return duplicateResultOutput({ arcId, phase, eventId, authorityRef, evidence: { resultConsumption: consumption } })
    }
    if (consumption.status === 'conflict') {
      return workflowHalt('failed', { phase, evidence: { resultConsumption: consumption } })
    }
    // phase-file / gate-report consistency (the anti-narration check, DESIGN §2). A red
    // verify-complete (exit 2 = inconsistent) must halt, not be silently accepted.
    const vc = run(`roadmap gate run ${phase} --verify-complete`, { cwd })
    if (vc.exitCode !== 0) return workflowHalt('failed', { phase, evidence: { verifyComplete: vc.stderr || vc.stdout } })

    const mut = await serializeSharedMutation(phase, { repoRoot, cfg, arcId }) // groom backlog + emit — the loop's final step
    if (mut) return workflowHalt(mut.halt ?? 'failed', { phase, evidence: mut.evidence })
    try {
      appendExecutorEvent(worktree, phase, 'phase-complete', {
        resultTailComplete: true,
        checkpointDigest,
        resultDigest,
      })
    } catch (e) {
      return workflowHalt('failed', {
        phase,
        evidence: { resultConsumptionInterrupted: { claim: consumption.claim, reason: `completion beacon failed: ${e.message}` } },
      })
    }
    completedClaims.add(eventId)
    if (pauseAfter === phase) {
      const pauseReceipt = reduceArcTransition(resultReceipt.next, {
        eventId: `pause:${arcId}:${phase}:${checkpointDigest}`,
        arcId: String(arcId),
        source: 'arc-plane-workflow',
        type: 'pause-after',
        phase,
        evidence: { pauseAfter: phase },
        authorityRef,
      })
      if (pauseReceipt.rejection) {
        return workflowHalt('failed', { phase, evidence: { lifecyclePause: pauseReceipt.rejection } })
      }
      return {
        ...buildHaltPayload('pause-after', { phase, evidence: { pauseAfter: phase } }),
        resume: pauseReceipt.resume,
        transitionReceipt: pauseReceipt,
        trace: { state: pauseReceipt.next, receipts: [...lifecycleReceipts, pauseReceipt] },
      }
    }
  }
}
