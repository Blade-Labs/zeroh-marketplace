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
 * narrated: it must have a green latest report whose scope + round counts match the file.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const RETAIN = 5

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

const AgentRoundShape = z.object({
  round: z.number().int(),
  agent: z.string(),
  verdict: z.string(),
  summary: z.string(),
  // WHO ran the round — reviewer attribution for the evals; absent = unrecorded, never invented.
  model: z.string().min(1).optional(),
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
})

export function gateDir(toplevel, phase) {
  return join(toplevel, 'roadmap', '.gate', String(phase))
}

function runFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^run-\d+-.*\.json$/.test(f))
    .map((f) => ({ f, seq: Number(f.match(/^run-(\d+)-/)[1]) }))
    .sort((a, b) => a.seq - b.seq)
}

function ensureSelfGitignore(toplevel) {
  const gateRoot = join(toplevel, 'roadmap', '.gate')
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

/** The newest report for a phase, or null. */
export function latestReport(toplevel, phase) {
  const dir = gateDir(toplevel, phase)
  const files = runFiles(dir)
  if (files.length === 0) return null
  const newest = files[files.length - 1].f
  try {
    return { path: join(dir, newest), report: GateRunReportShape.parse(JSON.parse(readFileSync(join(dir, newest), 'utf8'))) }
  } catch {
    return null
  }
}

/** Append an agent round to the LATEST report (no new run file). Returns the updated
 *  report. Throws when there is no report to append to. */
export function appendAgentRound(toplevel, phase, roundInput) {
  const latest = latestReport(toplevel, phase)
  if (!latest) throw new Error(`gate report: no run report for phase ${phase} to record a round into`)
  const round = AgentRoundInputShape.parse(roundInput)
  const updated = {
    ...latest.report,
    agents: [...latest.report.agents, { ...round, recordedAt: new Date().toISOString() }],
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
 * structured gateRounds entries with round >= 1. Returns { ok, problems[] }.
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
  return { ok: problems.length === 0, problems }
}
