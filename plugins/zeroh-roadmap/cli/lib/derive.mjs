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
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { scanPhaseFile, scanProgress } from './phasescan.mjs'
import { bridgeImport, TSX_ABSENT_HINT } from './tsx-bridge.mjs'
import { derivePhaseStartSha, GitScanError } from './gitscan.mjs'
import { readSidecar } from './sidecar.mjs'
import { classifyBand } from './ladder.mjs'
import { defaultExec } from './exec.mjs'

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
const arcFilePath = (repoRoot, arcId) => join(repoRoot, 'roadmap', 'arcs', `${arcId}.arc.ts`)
const phaseFilePath = (repoRoot, n) => join(repoRoot, 'roadmap', 'phases', `phase-${n}.phase.ts`)

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
  const p = join(repoRoot, 'roadmap', '.gate', `arc-${arcId}`, 'validate.json')
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
  const censusScript = join(pluginRoot(), 'scripts', 'debt-census.mts')
  const tmp = mkdtempSync(join(tmpdir(), 'roadmap-census-'))
  const outFile = join(tmp, 'census.json')
  try {
    // `npx --no-install tsx` resolves tsx from the consumer's local node_modules first,
    // then the global install (the proven tsx-bridge resolution) — so census runs against
    // a production consumer AND a bare scratch fixture. debt-census.mts is a CLI invoked
    // by argv, never imported (assumption A5): plugin carries no second census parser.
    const r = exec('npx', ['--no-install', 'tsx', censusScript, repoRoot, '--json', outFile], { cwd: repoRoot })
    if (r.status !== 0 || !existsSync(outFile)) return null
    const data = JSON.parse(readFileSync(outFile, 'utf8'))
    const entries = (data.entries ?? []).filter((e) => String(e.arcId) === String(arcId))
    return {
      open: entries.filter((e) => e.state === 'OPEN').length,
      openPlanned: entries.filter((e) => e.state === 'OPEN-planned').length,
      openOperator: entries.filter((e) => e.state === 'OPEN-operator').length,
      entries,
    }
  } catch {
    return null
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** roadmap/arc-summary.json (the latest pointer) iff it names THIS arc. */
function readArcSummary(repoRoot, arcId) {
  const p = join(repoRoot, 'roadmap', 'arc-summary.json')
  if (!existsSync(p)) return null
  try {
    const s = JSON.parse(readFileSync(p, 'utf8'))
    return String(s.arcId) === String(arcId) ? s : null
  } catch {
    return null
  }
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
  const base = (extra) => ({
    arc: arcId,
    done,
    remaining: members.filter((m) => !isDone(m.status)).map((m) => m.num),
    gates: { swept: false, validated: false, suiteGreen: null },
    ...extra,
  })
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
    let anyRunnable = false
    for (const m of backlog) {
      const parsed = typedRead(m.file, repoRoot) // TYPED candidate — wins over any regex prose false-positive
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

  // 4) TERMINAL LADDER (all members done) — census/verdict reads happen ONLY here (decision 2).
  const census = runDebtCensus(repoRoot, arcId, { exec })
  const swept = census !== null && census.open === 0
  const gates = { swept, validated: false, suiteGreen: null }
  if (!swept) return base({ action: 'sweep', gates, census: census ?? { error: 'census unavailable — cannot confirm swept' } })

  const verdict = readValidateVerdict(repoRoot, arcId)
  const validated = !hasCriteria || verdict?.verdict === 'PASS' || verdict?.verdict === 'no-op'
  gates.validated = validated
  if (hasCriteria && (verdict === null || verdict.verdict === 'GAPS')) {
    return base({ action: 'validate', gates, reason: verdict === null ? 'no verdict artifact' : 'verdict GAPS' })
  }

  const summary = readArcSummary(repoRoot, arcId)
  if (summary?.outcome === 'shipped' && !sidecar) {
    return base({ action: 'complete', gates })
  }
  return base({ action: 'land', gates })
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
