/**
 * gate-report — the GateRunReport shape + writer/reader + the ONE phase-file↔report
 * consistency checker (ROADCODE-DESIGN §2, pre-made decision 4). The report is a NEW
 * plugin artifact (plugin-side Zod), NOT a consumer contract — it does NOT ride the tsx
 * bridge (seam 3 concerns PhaseExecutionResult only).
 *
 * Home: <toplevel>/roadmap/.gate/<phase>/run-<seq>-<ts>.json in the CONSUMER repo. The
 * dir self-gitignores (a .gate/.gitignore containing `*` written on first report — zero
 * consumer .gitignore edits) and retains only the newest 5 runs per phase.
 *
 * checkPhaseConsistency is defined ONCE here and imported by BOTH gate run
 * --verify-complete (1656.5) and phase validate (1656.7) — a done flip can no longer be
 * narrated: it must have a green latest report whose scope + round counts match the file,
 * and in the delegated lane one of those rounds must be someone other than the driver.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { z } from 'zod'
import { roadmapRoot } from './roadmap-root.mjs'

const RETAIN = 5
// Reports attached to phases completed before the no-self-judge rule landed are immutable
// historical evidence. A merely old report cannot waive review for a completion happening now.
const INDEPENDENT_REVIEW_ENFORCEMENT_AT = '2026-09-01T07:30:27.000Z'
const INDEPENDENT_REVIEW_ENFORCEMENT_DATE = INDEPENDENT_REVIEW_ENFORCEMENT_AT.slice(0, 10)

const ScopeTripleShape = z.object({
  derived: z.string(),
  declared: z.string().nullable(),
  effective: z.string(),
})

const SlotRowShape = z.object({
  slot: z.string(),
  command: z.string().optional(),
  files: z.array(z.string()).optional(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().optional(),
  logPath: z.string().nullable().optional(),
  note: z.string().optional(),
  declaredAbsent: z.boolean().optional(),
})

export const GateFindingRecordShape = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  confidence: z.number().int().min(80).max(100).optional(),
  description: z.string().min(10),
  fixedInCommit: z.string().min(7).optional(),
  agent: z.string().min(1).optional(),
})

const AgentRoundShape = z.object({
  round: z.number().int(),
  agent: z.string(),
  verdict: z.string(),
  summary: z.string(),
  // WHO ran the round — reviewer attribution for the evals; absent = unrecorded, never invented.
  model: z.string().min(1).optional(),
  findings: z.array(GateFindingRecordShape).default([]),
  sha: z.string().min(7).optional(),
  recordedAt: z.string(),
})

/** Curation evidence: recorded BEFORE the squash so the granular record —
 *  above all the scratch/revert RED-proof pairs, unreachable after the rewrite — keeps a
 *  durable home review-phase and eval can read. */
const CurationShape = z.object({
  squashedCount: z.number().int(),
  landedSubjects: z.array(z.string()),
  redProofs: z.array(z.object({ scratch: z.string(), revert: z.string(), subject: z.string() })),
})

/** The persisted GateRunReport (plugin-side Zod). */
export const GateRunReportShape = z.object({
  phase: z.number().int().positive(),
  startedAt: z.string(),
  baseSha: z.string(),
  mode: z.string(),
  kind: z.string(),
  testScope: ScopeTripleShape,
  reviewScope: ScopeTripleShape,
  slots: z.array(SlotRowShape),
  agents: z.array(AgentRoundShape).default([]),
  green: z.boolean(),
  notes: z.array(z.string()).default([]),
  curation: CurationShape.optional(),
  /**
   * The --slots value when the run was FILTERED. Its presence means `green` covers a SUBSET of
   * the plan's slots, so the report is a debugging projection, not evidence about the phase.
   * Absent on a full run. Read by checkPhaseConsistency (a subset can never certify a done
   * flip) and by the --verify-complete eval refresh (a subset is not a sample).
   */
  slotFilter: z.string().min(1).optional(),
})

/** The record element gate run --record-round parses (without recordedAt — added on append). */
export const AgentRoundInputShape = z.object({
  round: z.number().int(),
  agent: z.string(),
  verdict: z.string(),
  summary: z.string(),
  model: z.string().min(1).optional(),
  findings: z.array(GateFindingRecordShape).default([]),
})

export function gateDir(toplevel, phase) {
  return join(roadmapRoot(toplevel), '.gate', String(phase))
}

function runFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^run-\d+-.*\.json$/.test(f))
    .map((f) => ({ f, seq: Number(f.match(/^run-(\d+)-/)[1]) }))
    .sort((a, b) => a.seq - b.seq)
}

function ensureSelfGitignore(toplevel) {
  const gateRoot = join(roadmapRoot(toplevel), '.gate')
  mkdirSync(gateRoot, { recursive: true })
  const gi = join(gateRoot, '.gitignore')
  if (!existsSync(gi)) writeFileSync(gi, '*\n')
}

/**
 * Validate + write a GateRunReport; prune to the newest RETAIN runs. Returns
 * { path, report }.
 */
export function writeReport(toplevel, report) {
  const parsed = GateRunReportShape.parse(report)
  const dir = gateDir(toplevel, parsed.phase)
  mkdirSync(dir, { recursive: true })
  ensureSelfGitignore(toplevel)
  const existing = runFiles(dir)
  const seq = (existing.length ? existing[existing.length - 1].seq : 0) + 1
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `run-${String(seq).padStart(6, '0')}-${ts}.json`
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(parsed, null, 2) + '\n')
  // Retain only the newest RETAIN — prune older run-*.json on write.
  const all = runFiles(dir)
  for (const { f } of all.slice(0, Math.max(0, all.length - RETAIN))) rmSync(join(dir, f), { force: true })
  return { path, report: parsed }
}

/** The newest run file EXISTS and will not read — malformed JSON, or valid JSON that misses
 *  GateRunReportShape. Never folded into "no report": an absent report means the gate has not
 *  run, an unreadable one means the evidence is sitting on disk and cannot be trusted, and a
 *  caller that treats them alike certifies a done flip over corruption. */
export class GateReportUnreadableError extends Error {
  constructor(path, cause) {
    super(
      `gate report: the newest run report ${path} could not be read, so this phase's gate evidence is `
        + 'UNREADABLE \u2014 which is NOT the same as a phase with no gate report:\n'
        + `  ${cause?.message ?? cause}\n`
        + 'Read the file: a truncated report is a gate run that died mid-write and a shape refusal is a report '
        + 'that predates a schema change \u2014 delete it if that run is gone, then re-run `roadmap gate run <phase>` '
        + 'to write a fresh one. Nothing may read past it.',
    )
    this.name = 'GateReportUnreadableError'
    this.path = path
    this.cause = cause
  }
}

/**
 * The newest report for a phase, or null when the phase has NO run file at all.
 *
 * The newest file decides alone: falling back to an older readable run would answer with stale
 * evidence for a run whose own record nobody can read. An unreadable newest file THROWS
 * GateReportUnreadableError.
 */
export function latestReport(toplevel, phase) {
  const dir = gateDir(toplevel, phase)
  const files = runFiles(dir)
  if (files.length === 0) return null
  const path = join(dir, files[files.length - 1].f)
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new GateReportUnreadableError(path, e)
  }
  const parsed = GateRunReportShape.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${(i.path ?? []).join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new GateReportUnreadableError(path, new Error(detail))
  }
  const findingsRecorded = Array.isArray(raw.agents)
    ? raw.agents.map((round) => Object.hasOwn(round, 'findings'))
    : []
  return { path, report: parsed.data, findingsRecorded }
}

/** Append an agent round to the LATEST report (no new run file). Returns the updated
 *  report. Throws when there is no report to append to. */
export function appendAgentRound(toplevel, phase, roundInput) {
  const latest = latestReport(toplevel, phase)
  if (!latest) throw new Error(`gate report: no run report for phase ${phase} to record a round into`)
  const round = AgentRoundInputShape.parse(roundInput)
  const updated = {
    ...latest.report,
    agents: [...latest.report.agents, {
      ...round,
      sha: execFileSync('git', ['-C', toplevel, 'rev-parse', 'HEAD'], { timeout: 10_000, encoding: 'utf8' }).trim(),
      recordedAt: new Date().toISOString(),
    }],
  }
  const validated = GateRunReportShape.parse(updated)
  writeFileSync(latest.path, JSON.stringify(validated, null, 2) + '\n')
  return validated
}

/** Attach (or replace) the curation-evidence block on the LATEST report, in place — the
 *  same run file, never a new one. Validates the block through the report shape BEFORE
 *  touching disk, so a malformed block leaves the file byte-identical. Throws when the
 *  phase has no report: curation evidence has nowhere to live, and the caller
 *  (executeCurate) treats that as an abort — evidence before surgery. */
export function recordCuration(toplevel, phase, block) {
  const latest = latestReport(toplevel, phase)
  if (!latest) throw new Error(`gate report: no run report for phase ${phase} to record curation evidence into`)
  const validated = GateRunReportShape.parse({ ...latest.report, curation: block })
  writeFileSync(latest.path, JSON.stringify(validated, null, 2) + '\n')
  return validated
}

/**
 * The ONE done-flip consistency checker. Clauses: (i) report green, (ii) report.phase ===
 * phase.phase, (iii) report scope decisions match the phase's DECLARED test/review scope
 * where declared, (iv) count of agents[] rounds with round >= 1 equals the phase's
 * structured gateRounds entries with round >= 1, (v) no-self-judge — a codex-lane completion
 * that still owes a review carries at least one round>=1 whose agent label is not a self-review
 * variant. Returns
 * { ok, problems[] }.
 */
export function checkPhaseConsistency(parsedPhase, report) {
  const problems = []
  if (!report.green) problems.push('the latest gate report is not green (a done flip needs a green gate run)')
  if (report.slotFilter)
    problems.push(
      `the latest gate report is a --slots ${report.slotFilter} run: its green covers that subset alone, ` +
        'so it cannot certify a done flip (re-run the full gate)',
    )
  if (report.phase !== parsedPhase?.phase)
    problems.push(`report.phase ${report.phase} !== phase ${parsedPhase?.phase} (phase/report mismatch)`)
  if (parsedPhase?.testScope && report.testScope.declared !== parsedPhase.testScope)
    problems.push(
      `scope mismatch: phase declares testScope '${parsedPhase.testScope}' but the report recorded declared '${report.testScope.declared}'`,
    )
  if (parsedPhase?.reviewScope && report.reviewScope.declared !== parsedPhase.reviewScope)
    problems.push(
      `scope mismatch: phase declares reviewScope '${parsedPhase.reviewScope}' but the report recorded declared '${report.reviewScope.declared}'`,
    )
  const reportRounds = report.agents.filter((a) => a.round >= 1).length
  const phaseRounds = (parsedPhase?.gateRounds ?? []).filter(
    (g) => g && typeof g === 'object' && typeof g.round === 'number' && g.round >= 1,
  ).length
  if (reportRounds !== phaseRounds)
    problems.push(
      `gateRounds count mismatch: the report has ${reportRounds} agent round(s) (round>=1) but the phase records ${phaseRounds}`,
    )
  const completedBeforeIndependentReview =
    typeof parsedPhase?.completedDate === 'string' &&
    parsedPhase.completedDate < INDEPENDENT_REVIEW_ENFORCEMENT_DATE &&
    report.startedAt < INDEPENDENT_REVIEW_ENFORCEMENT_AT
  const delegatedReviewRequired =
    parsedPhase?.executionResult?.driver?.lane === 'codex' &&
    parsedPhase?.reviewScope !== 'none' &&
    report.reviewScope?.effective !== 'none' &&
    !completedBeforeIndependentReview
  const hasIndependentRound = report.agents.some(
    (round) => round.round >= 1 && !/self[\s_-]?review/.test(round.agent.toLowerCase()),
  )
  if (delegatedReviewRequired && !hasIndependentRound)
    problems.push(
      `no-self-judge rule: codex-lane completion needs an independent recorded round; ` +
        `record one with gate run ${parsedPhase?.phase ?? report.phase} --record-round (self-review rounds do not satisfy completion)`,
    )
  const terminalRound = report.agents.filter((round) => round.round >= 1).at(-1)
  if (terminalRound?.verdict === 'findings-fixed') {
    const openBlocking = terminalRound.findings.filter(
      (finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH',
    )
    if (openBlocking.length > 0)
      problems.push(
        `terminal findings-fixed round has open ${openBlocking.map((finding) => finding.severity).join('/')} finding(s); `
          + 'CRITICAL/HIGH findings require another correctness round',
      )
  }
  if (terminalRound?.verdict === 'fixed-closed') {
    const invalid = terminalRound.findings.filter(
      (finding) => !['MEDIUM', 'LOW'].includes(finding.severity) || !finding.fixedInCommit,
    )
    if (terminalRound.findings.length === 0 || invalid.length > 0)
      problems.push('terminal fixed-closed round must contain at least one MEDIUM/LOW finding and every finding must name fixedInCommit')
  }
  return { ok: problems.length === 0, problems }
}
