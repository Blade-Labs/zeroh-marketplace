import {assertCurrentDeliverySummary} from './delivery-evaluation.mjs'
/**
 * derive — THE position-derivation function (arc ROADCODE singleSeam 2). ONE
 * derive-from-disk implementation that `roadmap status` (1657.2 refactor) and
 * `roadmap arc next` share; nothing else reads lane state. Implements the do-phase
 * Step 1b resume rules and the do-arc "which phase next" plane-order reasoning as
 * CODE (ROADCODE-DESIGN §2 `arc next`), so a fresh session fast-forwards from disk
 * with no narrated re-derivation (acceptance criterion resume-by-rederive).
 *
 * Two reading tiers, deliberately (pre-made decision 1):
 *  - REGEX tier (phasescan.scanPhaseFile — status: only, zero toolchain) does the BULK
 *    done/backlog sweep. Phase `status:` is safe to regex (the field precedes notes);
 *    task-level done:/executionResult key-presence is NOT (phase files carry literal
 *    `done:true`/`executionResult` inside notes strings), so —
 *  - TYPED tier (tsx-bridge import) RE-READS the arc file always, and the CANDIDATE /
 *    in-progress member always, before any task-level truth (done flags, executionResult,
 *    deps) is trusted. `arc next` SEQUENCES where status only displayed, so a false read
 *    mis-runs a live arc. A STRICT context — tsx absent ⇒ loud DeriveError (exit-1).
 *
 * Action ladder (decision 4, first match wins): blocked → resume-phase → run-phase →
 * sweep → validate → land → complete. Census/verdict reads run ONLY when the member
 * ladder is exhausted (all done), so phase sequencing stays regex-tier fast (decision 2).
 */
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { scanPhaseFile, scanProgress } from './phasescan.mjs'
import { bridgeImport, bridgeImportMany, bridgeParseShape, consumerSchemaPath, TSX_ABSENT_HINT, resolveTsxInvocation } from './tsx-bridge.mjs'
import { derivePhaseStartSha, GitScanError } from './gitscan.mjs'
import { readSidecar, pidAlive } from './sidecar.mjs'
import { readLandJournal, classifyLandJournal, landJournalPath } from './landing.mjs'
import { classifyBand } from './ladder.mjs'
import { defaultExec } from './exec.mjs'
import { roadmapRoot } from './roadmap-root.mjs'
import { loadArcDelivery, assertReachedDeliveryTerminal, assertExactCurrentPullRequest } from './delivery.mjs'
import { reduceArcTransition } from './workflow-steps.mjs'

/** A typed derivation failure. kind ∈ 'tsx-absent' | 'load' | 'malformed-artifact'. */
export class DeriveError extends Error {
  constructor(kind, messageLines, { exitCode = 1 } = {}) {
    super(messageLines.join('\n'))
    this.name = 'DeriveError'
    this.kind = kind
    this.messageLines = messageLines
    this.exitCode = exitCode
  }
}

const pluginRoot = () => resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arcFilePath = (repoRoot, arcId) => join(roadmapRoot(repoRoot), 'arcs', `${arcId}.arc.ts`)
const phaseFilePath = (repoRoot, n) => join(roadmapRoot(repoRoot), 'phases', `phase-${n}.phase.ts`)

/** Typed read of a roadmap file through the consumer tsx — STRICT (tsx absent ⇒ loud). */
function typedRead(path, repoRoot) {
  if (!existsSync(path)) {
    throw new DeriveError('load', [`roadmap: no file at ${path}`])
  }
  const res = bridgeImport(path, { consumerRoot: repoRoot })
  if (res.ok) return res.parsed
  if (res.kind === 'tsx-absent') {
    throw new DeriveError('tsx-absent', [`roadmap: cannot typed-read ${path} — tsx unavailable in ${repoRoot}`, TSX_ABSENT_HINT])
  }
  throw new DeriveError('load', [`roadmap: failed to typed-read ${path}`, (res.stderr ?? '').trim()])
}

/** roadmap/.gate/arc-<arcId>/validate.json → { arcId, verdict, at, note? } | null. Strict parse. */
export function readValidateVerdict(repoRoot, arcId) {
  const p = join(roadmapRoot(repoRoot), '.gate', `arc-${arcId}`, 'validate.json')
  if (!existsSync(p)) return null
  let raw
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'))
  } catch (e) {
    throw new DeriveError('malformed-artifact', [`roadmap: malformed validate artifact ${p}: ${e.message}`])
  }
  if (String(raw.arcId) !== String(arcId) || !['PASS', 'GAPS', 'no-op'].includes(raw.verdict)) {
    throw new DeriveError('malformed-artifact', [
      `roadmap: invalid validate artifact ${p} — expected { arcId: "${arcId}", verdict: PASS|GAPS|no-op }`,
    ])
  }
  if(raw.correction?.bounds!==undefined){
    const parsed=bridgeParseShape(repoRoot,consumerSchemaPath(repoRoot),'CorrectionCheckpointShape',raw)
    if(!parsed.ok)throw new DeriveError('malformed-artifact',[`roadmap: invalid typed correction checkpoint ${p}`])
    return parsed.parsed
  }
  if (raw.correction !== undefined) {
    const correction = raw.correction
    const validHead = (value) => typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
    const valid = correction && typeof correction === 'object' && !Array.isArray(correction)
      && ['awaiting-repair', 'needs-sweep'].includes(correction.state)
      && validHead(correction.validationHead)
      && (correction.state === 'awaiting-repair'
        ? correction.repairHead === undefined && correction.readyAt === undefined
        : validHead(correction.repairHead) && correction.repairHead !== correction.validationHead
          && typeof correction.readyAt === 'string' && !Number.isNaN(Date.parse(correction.readyAt)))
    if (raw.verdict !== 'GAPS' || !valid) {
      throw new DeriveError('malformed-artifact', [`roadmap: invalid correction state in validate artifact ${p}`])
    }
  }
  return raw
}

/**
 * Invoke the consumer's debt-census.mts by INVOCATION (it is a CLI, never imported —
 * assumption A5) and slice the ledger to the arc's member phases (entry.arcId === arcId).
 * Returns { open, openPlanned, openOperator, entries } or null on any invocation/parse
 * failure (decision 6: unable-to-count is NEVER a fabricated zero — the caller treats
 * null as "not swept / over budget", fail-closed).
 */
export function runDebtCensus(repoRoot, arcId, { exec = defaultExec } = {}) {
  const data = debtCensusJson(repoRoot, { exec })
  if (!data) return null
  const entries = (data.entries ?? []).filter((e) => String(e.arcId) === String(arcId))
  // `limitations` are EXEMPT from the arc budget (arc-sweep SKILL.md: a permanent design
  // constraint is not arc-disposable — release-sweep walks it pre-archive; counting it here
  // coerced arcs into disposing limitations at sweep time, the exact laundering the split
  // exists to prevent). Counted separately so the report + RunnerSummary still surface them.
  return {
    open: entries.filter((e) => e.state === 'OPEN' && e.field !== 'limitations').length,
    openPlanned: entries.filter((e) => e.state === 'OPEN-planned').length,
    openOperator: entries.filter((e) => e.state === 'OPEN-operator').length,
    openLimitations: entries.filter((e) => e.state === 'OPEN' && e.field === 'limitations').length,
    entries,
  }
}

/**
 * The ONE debt-census INVOCATION seam — runs the consumer's debt-census.mts CLI and
 * returns its full parsed census JSON (or null on any invocation/parse failure — decision
 * 6: unable-to-count is never a fabricated zero). `runDebtCensus` (arc-slice summary) and
 * `roadmap audit` check 12.3-12.4 (`includeArchive: true` → the additive census.archive
 * block) both go through here so the census is never invoked or parsed twice.
 */
export function debtCensusJson(repoRoot, { includeArchive = false, exec = defaultExec } = {}) {
  const censusScript = join(pluginRoot(), 'scripts', 'debt-census.mts')
  const tmp = mkdtempSync(join(tmpdir(), 'roadmap-census-'))
  const outFile = join(tmp, 'census.json')
  try {
    const invocation = resolveTsxInvocation(repoRoot)
    const argv = [...invocation.prefix, censusScript, repoRoot, '--json', outFile]
    if (includeArchive) argv.push('--include-archive')
    const r = exec(invocation.file, argv, { cwd: repoRoot })
    if (r.status !== 0 || !existsSync(outFile)) return null
    return JSON.parse(readFileSync(outFile, 'utf8'))
  } catch {
    return null
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** roadmap/arc-summary.json (the latest pointer) iff it names THIS arc. */
function readArcSummary(repoRoot, arcId) {
  const p = join(roadmapRoot(repoRoot), 'arc-summary.json')
  if (!existsSync(p)) return null
  try {
    const bytes = readFileSync(p)
    const s = JSON.parse(bytes.toString('utf8'))
    if (String(s.arcId) !== String(arcId)) return null
    const checked = bridgeParseShape(repoRoot, consumerSchemaPath(repoRoot), 'RunnerSummaryShape', s)
    return checked.ok ? { summary: checked.parsed, bytes, path: p } : null
  } catch {
    return null
  }
}

function latestArcArtifact(repoRoot, arcId, suffix = '', shapeName = null) {
  const dir = join(roadmapRoot(repoRoot), 'arc-evals')
  if (!existsSync(dir)) return null
  const escaped = String(arcId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rx = new RegExp(`^${escaped}-\\d{4}-\\d{2}-\\d{2}${suffix}\\.json$`)
  const name = readdirSync(dir).filter((entry) => rx.test(entry)).sort().at(-1)
  if (!name) return null
  const path = join(dir, name)
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'))
    if (!shapeName) return { path, doc }
    const checked = bridgeParseShape(repoRoot, consumerSchemaPath(repoRoot), shapeName, doc)
    return checked.ok ? { path, doc: checked.parsed } : null
  } catch { return null }
}

function correctionSweepFresh(repoRoot, arcId, verdict, exec) {
  const correction = verdict?.correction
  if (correction?.state !== 'needs-sweep') return false
  const sweep = latestArcArtifact(repoRoot, arcId, '-sweep', 'SweepReportShape')
  const binding = sweep?.doc?.correction
  if (sweep?.doc?.overall !== 'green' || String(sweep.doc.arcId) !== String(arcId)
    || binding?.validationAt !== verdict.at
    || binding?.validationHead !== correction.validationHead
    || binding?.repairHead !== correction.repairHead
    || !/^[0-9a-f]{40,64}$/.test(binding?.reviewedHead ?? '')) return false
  const ancestor = exec('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', correction.repairHead, binding.reviewedHead])
  if (ancestor.status !== 0) return false
  if (exec('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', binding.reviewedHead, 'HEAD']).status !== 0) return false
  const changed = exec('git', ['-C', repoRoot, 'diff', '--name-only', binding.reviewedHead])
  const untracked = exec('git', ['-C', repoRoot, 'ls-files', '--others', '--exclude-standard'])
  if (changed.status !== 0 || untracked.status !== 0) return false
  const allowed = new Set([
    relative(repoRoot, join(roadmapRoot(repoRoot), '.gate', `arc-${arcId}`, 'validate.json')),
    sweep.path.slice(repoRoot.length + 1),
  ])
  return [...changed.stdout.split('\n'), ...untracked.stdout.split('\n')]
    .map((entry) => entry.trim()).filter(Boolean)
    .filter((entry) => entry !== 'node_modules' && !entry.startsWith('node_modules/'))
    .filter((entry) => !entry.startsWith(relative(repoRoot, join(roadmapRoot(repoRoot), '.gate', '.typed-cache')) + '/'))
    .every((entry) => allowed.has(entry))
}

function currentEvaluationComplete(repoRoot, arcId, summaryProof) {
  if (!summaryProof) return false
  const report = latestArcArtifact(repoRoot, arcId, '', 'ArcEvalReportShape')
  const doc = report?.doc
  if (!doc || String(doc.arcId) !== String(arcId) || !Array.isArray(doc.ratchet)
    || !doc.attribution || typeof doc.dimensions !== 'object' || doc.dimensions === null
    || Object.keys(doc.dimensions).length !== 7) return false
  const digest = sha256(summaryProof.bytes)
  if (doc.landSummaryDigest !== digest) return false
  return Object.values(doc.dimensions).every((dimension) =>
    dimension && !['pending-judge', 'unjudged-backfill'].includes(dimension.sentinel))
}

function readLandingJournalState(repoRoot, arcId) {
  const home = process.env.ZEROH_LAND_JOURNAL_HOME ?? repoRoot
  const journal = readLandJournal(home, arcId)
  if (journal && typeof journal.exitCode !== 'number' && (!Number.isInteger(journal.pid) || journal.pid < 1)) {
    return { state: 'unresolved', journal }
  }
  return classifyLandJournal(journal, { isAlive: pidAlive })
}

/** done:true task commit verification (decision 2): commit: field via cat-file, else --grep taskId. */
function verifyTaskCommit(worktree, task, exec) {
  if (task.commit) {
    const r = exec('git', ['-C', worktree, 'cat-file', '-e', `${task.commit}^{commit}`])
    if (r.status === 0) return true
  }
  const r = exec('git', ['-C', worktree, 'log', '--oneline', '--fixed-strings', `--grep=${task.id}`])
  return r.status === 0 && r.stdout.trim().length > 0
}

/** Resume derivation (decisions 2-3): commit-verified doneTasks, unverifiedDoneFlags, startSha. */
function deriveResume(worktree, phaseNum, parsed, exec) {
  const doneTasks = []
  const unverifiedDoneFlags = []
  for (const t of parsed.tasks ?? []) {
    if (t?.done !== true) continue
    if (verifyTaskCommit(worktree, t, exec)) doneTasks.push(t.id)
    else unverifiedDoneFlags.push(t.id)
  }
  let startSha = null
  try {
    startSha = derivePhaseStartSha(worktree, phaseNum)
  } catch (e) {
    if (!(e instanceof GitScanError)) throw e // no-match ⇒ null (phase not yet committed)
  }
  return { midPhase: true, doneTasks, unverifiedDoneFlags, startSha }
}

/** Bulk regex status for any phase number (in-arc member or an out-of-arc dep). */
function statusOf(repoRoot, n) {
  const f = phaseFilePath(repoRoot, n)
  if (!existsSync(f)) return null
  return scanPhaseFile(f)?.status ?? null
}
const isDone = (s) => s === 'done' || s === 'historical'

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

const lifecyclePriorStage = {
  'run-phase': 'phase',
  'resume-phase': 'phase',
  blocked: 'phase',
  gaps: 'validate',
  sweep: 'phase',
  validate: 'sweep',
  land: 'validate',
  deliver: 'validate',
  'awaiting-ci': 'delivery',
  'land-unproven': 'land',
  evaluate: 'delivery',
  complete: 'evaluate',
}

/** Project one disk-derived position through the canonical reducer. No lifecycle
 * state is persisted: equal disk checkpoints reconstruct equal receipts. */
export function deriveArcLifecycleTransition(position, priorState) {
  const authorityRef = { status: 'unknown', reason: 'read-only-projection', sourceRef: null }
  const stage = lifecyclePriorStage[position?.action] ?? 'phase'
  const checkpoint = position?.sourceCheckpoint ?? { head: null, digest: sha256(stableJson(position)) }
  const eventId = `disk:${position?.arc ?? '?'}:${checkpoint.digest}`
  const prior = priorState ?? {
    arcId: String(position?.arc ?? ''),
    stage,
    status: 'active',
    processedEventIds: [],
    lastHalt: null,
    authorityRef,
  }
  const event = {
    eventId,
    arcId: String(position?.arc ?? ''),
    source: 'disk-checkpoint',
    type: position?.action,
    ...(position?.phase == null ? {} : { phase: position.phase }),
    evidence: { checkpoint },
    authorityRef,
  }
  return reduceArcTransition(prior, event)
}

/**
 * derive the ONE next action for an arc from disk. Output is the §2 JSON sketch:
 * { arc, action, phase?, band?, plane?, resume?, done[], remaining[], gates{swept,validated,suiteGreen} }.
 */
export function deriveArcPosition({ repoRoot, arcId, config, worktree = repoRoot, exec = defaultExec }) {
  const arc = typedRead(arcFilePath(repoRoot, arcId), repoRoot) // STRICT typed arc read
  const memberNums = (arc.planes ?? []).flatMap((p) => p.phases ?? [])
  const planeOf = (n) => (arc.planes ?? []).find((p) => (p.phases ?? []).includes(n))?.name ?? null
  const hasCriteria = Array.isArray(arc.acceptanceCriteria) && arc.acceptanceCriteria.length > 0

  const members = memberNums.map((n) => {
    const f = phaseFilePath(repoRoot, n)
    return { num: n, file: f, exists: existsSync(f), status: existsSync(f) ? scanPhaseFile(f)?.status ?? null : null, plane: planeOf(n) }
  })
  const done = members.filter((m) => isDone(m.status)).map((m) => m.num)
  const head = exec('git', ['-C', worktree, 'rev-parse', 'HEAD'])
  if (head.status !== 0 || !head.stdout.trim()) {
    throw new DeriveError('load', [`roadmap: cannot resolve the current HEAD for arc ${arcId}`, (head.stderr ?? '').trim()])
  }
  const sourceBytes = [arcFilePath(repoRoot, arcId), ...members.filter((member) => member.exists).map((member) => member.file)]
    .map((path) => ({ path, digest: sha256(readFileSync(path)) }))
  const base = (extra) => {
    const projection = {
      arc: arcId,
      done,
      remaining: members.filter((m) => !isDone(m.status)).map((m) => m.num),
      gates: { swept: false, validated: false, suiteGreen: null },
      ...extra,
    }
    const evidenceFiles = [
      join(roadmapRoot(repoRoot), '.gate', 'arc-' + arcId, 'validate.json'),
      join(roadmapRoot(repoRoot), 'arc-summary.json'),
      landJournalPath(process.env.ZEROH_LAND_JOURNAL_HOME ?? repoRoot, arcId),
      latestArcArtifact(repoRoot, arcId, '-sweep')?.path,
      latestArcArtifact(repoRoot, arcId)?.path,
    ].filter((path) => path && existsSync(path)).map((path) => ({ path, digest: sha256(readFileSync(path)) }))
    const sourceCheckpoint = {
      head: head.stdout.trim(),
      digest: sha256(stableJson({ head: head.stdout.trim(), sourceBytes, evidenceFiles, projection })),
    }
    const position = { ...projection, sourceCheckpoint }
    const transitionReceipt = deriveArcLifecycleTransition(position)
    return { ...position, transitionReceipt }
  }
  const blocked = (reason) => base({ action: 'blocked', reason, remaining: members.filter((m) => !isDone(m.status)).map((m) => m.num) })

  // 1) BLOCKED — malformed/missing member file.
  const malformed = members.find((m) => !m.exists || !m.status)
  if (malformed) {
    return blocked(malformed.exists ? `member phase ${malformed.num} is malformed (no status:)` : `member phase ${malformed.num} file is missing`)
  }
  // 1b) BLOCKED — foreign lane: a sidecar armed to a DIFFERENT worktree (never run under a sibling).
  const sidecar = readSidecar(repoRoot, arcId)
  if (sidecar && resolve(sidecar.worktree ?? '') !== resolve(worktree)) {
    return blocked(`foreign lane — arc ${arcId} is armed to a different worktree: ${sidecar.worktree}`)
  }

  // 2) RESUME-PHASE — a member in-progress (typed re-read: real tasks/executionResult, decision 1).
  const inProg = members.find((m) => m.status === 'in-progress')
  if (inProg) {
    const parsed = typedRead(inProg.file, repoRoot)
    const resume = deriveResume(worktree, inProg.num, parsed, exec)
    return base({
      action: 'resume-phase',
      phase: inProg.num,
      plane: inProg.plane,
      band: classifyBand(parsed, config).band,
      resume,
      remaining: members.filter((m) => !isDone(m.status) && m.num !== inProg.num).map((m) => m.num),
    })
  }

  // 3) RUN-PHASE — the next backlog member in plane order whose deps are done (typed candidate re-read).
  const backlog = members.filter((m) => !isDone(m.status)) // status 'backlog' (in-progress handled above)
  if (backlog.length > 0) {
    // Batch-read ALL candidates in ONE tsx process BEFORE the loop (reads are side-effect-free).
    // The DeriveError is thrown LAZILY — only when the selection loop actually CONSULTS a failed
    // entry: today's loop returns on the first runnable candidate, so a broken file positioned
    // AFTER it is never read; an eager throw at batch time would be a behavior change.
    const batch = bridgeImportMany(backlog.map((m) => m.file), { consumerRoot: repoRoot })
    if (!batch.ok) {
      // tsx-absent / eval-error is a whole-toolchain failure — loud immediately, as a single read would be.
      if (batch.kind === 'tsx-absent') {
        throw new DeriveError('tsx-absent', [`roadmap: cannot typed-read backlog candidates — tsx unavailable in ${repoRoot}`, TSX_ABSENT_HINT])
      }
      throw new DeriveError('load', ['roadmap: failed to batch typed-read backlog candidates', (batch.stderr ?? '').trim()])
    }
    let anyRunnable = false
    for (const m of backlog) {
      const r = batch.byPath[m.file]
      if (!r || !r.ok) {
        // LAZY: this candidate is being consulted now → surface its failure exactly as typedRead would.
        if (!r || r.kind === 'tsx-absent') {
          throw new DeriveError('tsx-absent', [`roadmap: cannot typed-read ${m.file} — tsx unavailable in ${repoRoot}`, TSX_ABSENT_HINT])
        }
        throw new DeriveError('load', [`roadmap: failed to typed-read ${m.file}`, (r.stderr ?? '').trim()])
      }
      const parsed = r.parsed // TYPED candidate — wins over any regex prose false-positive
      if (isDone(parsed.status)) continue // typed truth: not actually backlog
      const deps = parsed.dependsOn ?? []
      const depsMet = deps.every((d) => isDone(statusOf(repoRoot, d)))
      if (!depsMet) continue
      anyRunnable = true
      return base({
        action: 'run-phase',
        phase: m.num,
        plane: m.plane,
        band: classifyBand(parsed, config).band,
        remaining: backlog.filter((b) => b.num !== m.num).map((b) => b.num),
      })
    }
    if (!anyRunnable) {
      return blocked(`unmet cross-phase dependency — no backlog member of ${arcId} has all deps done`)
    }
  }

  // Proven landing resumes post-land work even if pre-land artifacts were cleaned up.
  const strategies=config?.deliveryPolicy?.branchStrategy??{}
  const member=strategies[String(arcId)]
  const deliveryOwner=member?.kind==='grouped'?Object.keys(strategies).find(id=>strategies[id].kind==='grouped'&&strategies[id].groupId===member.groupId&&strategies[id].order===0):String(arcId)
  if(!deliveryOwner)throw new DeriveError('load',['Delivery group has no order-zero owner.'])
  const delivery=loadArcDelivery(repoRoot,deliveryOwner)
  const prRoute=delivery!==null||config?.deliveryPolicy!==undefined
  const summary = readArcSummary(repoRoot, arcId)
  const landingJournal = readLandingJournalState(repoRoot, arcId)
  const landedGates = summary?.summary.outcome === 'shipped'
    ? { swept: summary.summary.gateSignals.arcSweepClean, validated: summary.summary.gateSignals.validateArcPassed, suiteGreen: summary.summary.gateSignals.fullSuiteGreen }
    : { swept: false, validated: false, suiteGreen: null }
  if (landingJournal.state === 'live') {
    return base({ action: 'land-unproven', gates: landedGates, reason: 'a landing process is still live; reconcile its journal before post-land work' })
  }
  if (!prRoute && summary?.summary.outcome === 'shipped') {
    return currentEvaluationComplete(repoRoot, arcId, summary)
      ? base({ action: 'complete', gates: landedGates })
      : base({ action: 'evaluate', gates: landedGates })
  }
  if (landingJournal.state !== 'none') {
    return base({
      action: 'land-unproven',
      gates: landedGates,
      reason: 'landing journal exists without a valid shipped summary; branch identity or bookkeeping proof is incomplete',
    })
  }

  // 4) TERMINAL LADDER (all members done) — census/verdict reads happen ONLY here (decision 2).
  const census = runDebtCensus(repoRoot, arcId, { exec })
  const swept = census !== null && census.open === 0
  const gates = { swept, validated: false, suiteGreen: null }
  if (!swept) return base({ action: 'sweep', gates, census: census ?? { error: 'census unavailable — cannot confirm swept' } })

  const verdict = readValidateVerdict(repoRoot, arcId)
  const validated = !hasCriteria || verdict?.verdict === 'PASS' || verdict?.verdict === 'no-op'
  gates.validated = validated
  if (hasCriteria && verdict === null) {
    return base({ action: 'validate', gates, reason: 'no verdict artifact' })
  }
  if (verdict?.verdict === 'GAPS') {
    if (verdict.correction?.state === 'needs-sweep') {
      return correctionSweepFresh(repoRoot, arcId, verdict, exec)
        ? base({ action: 'validate', gates, reason: 'correction resweep is green and current' })
        : base({ action: 'sweep', gates, reason: 'corrected validation gap requires a current bound resweep' })
    }
    return base({ action: 'gaps', gates, reason: 'verdict GAPS awaiting an explicit correction-ready record' })
  }

  // New arcs deliver a PR. Legacy shipped summaries above retain their old completion path.
  if(delivery){
    const evidence={ownerArcId:deliveryOwner,deliveryKey:delivery.deliveryKey,revision:delivery.revision,terminal:delivery.terminal.status,headSha:delivery.target.currentHeadSha,pullRequest:delivery.pullRequest}
    try{
      assertReachedDeliveryTerminal(delivery)
      gates.suiteGreen=true
      try{if(!summary)throw Error('missing summary');assertCurrentDeliverySummary(repoRoot,summary.summary)}catch{return base({action:'deliver',gates,delivery:evidence,reason:'Run deliver --resume to bind the current PR, sweep and intent evidence for evaluation.'})}
      return base({action:currentEvaluationComplete(repoRoot,arcId,summary)?'complete':'evaluate',gates,delivery:evidence})
    }catch{}
    let exactPr=false
    try{assertExactCurrentPullRequest(delivery);exactPr=true}catch{}
    return base({action:exactPr?'awaiting-ci':'deliver',gates,delivery:evidence})
  }
  return base({action:'deliver',gates})
}

/**
 * Per-arc progress projection (done/total/next) for `roadmap status` (1657.2) — the
 * lane-state read lives HERE, never re-implemented in bin. Regex tier only (advisory).
 */
export function arcProgress(phasesDir, arcId) {
  const p = scanProgress(phasesDir).progress.get(arcId)
  if (!p) return null
  return { done: p.done, total: p.total, inprog: p.inprog, next: p.next.slice(0, 3), allDone: p.done === p.total }
}
