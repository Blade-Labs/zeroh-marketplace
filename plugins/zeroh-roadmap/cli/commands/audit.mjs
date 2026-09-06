/**
 * roadmap audit [repo-root] [--json] — audit-roadmap's 17 structural checks, mechanized
 * (ROADCODE 1659.2, replacing skills/audit-roadmap's hand-run prose). Read-only: never
 * opens source code, never fixes — reports findings + a verdict.
 *
 * Two tiers (ROADCODE §2): the typed structural checks (1-3, 5-6, 8-12.2, 13 + crossValidate)
 * run in cli/audit-checks.mts under the consumer's tsx so they reuse the consumer registry's
 * discoverPhases/crossValidate + the plugin's suggestKind — never a second parser. This
 * orchestrator owns the checks that need git or raw file:line, and reuses the debt-census
 * join (via derive.debtCensusJson --include-archive) for 12.3-12.4:
 *   4  [NEEDS CLARIFICATION] markers — LIVE phases only, terminated token (':' or ']'); an
 *      unterminated guard string is data. file:line; CRITICAL when the phase is queued
 *   7  stale in-progress phases (git log staleness > 30 days)
 *   12.3 archived phase with unresolved/planned-not-done/operator-pending debt (HIGH)
 *   12.4 dangling debtResolution on an archived phase (MEDIUM)
 *   14 followup hygiene: untriaged orphans (MEDIUM), spent/superseded-but-REFERENCED (HIGH),
 *      spent orphans + past-review files (LOW)
 *   15 stray lane worktrees (surveyLanes): a non-live lane past its done-moment — MEDIUM with
 *      that lane's own runnable close, LOW for legacy/unknown. Report-only, never removes.
 *   16 consumer schema drift: a template export absent from the consumer's vendored
 *      lib/roadmap/schema.ts (HIGH each) — the same inventory reader `config check` uses.
 *   17 queued/in-progress phase without durable or commit-backed plan-review evidence (HIGH),
 *      with phases created before the evidence rule grandfathered.
 *
 * Exit contract (design §2): 0 = CLEAN or HAS ISSUES (MEDIUM/LOW only) · 2 = BROKEN (any
 * CRITICAL/HIGH) · 1 = usage / tsx-absent in this strict context.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { debtCensusJson } from '../lib/derive.mjs'
import { TSX_ABSENT_HINT, resolveTsxInvocation } from '../lib/tsx-bridge.mjs'
import { censusFollowups } from './followups.mjs'
import { isTerminalPhaseSource } from '../lib/phasescan.mjs'
import { surveyLanes } from '../lib/worktree.mjs'
import { missingSchemaExports, unresolvedSchemaExports } from './config.mjs'
import { roadmapRoot, roadmapRootRel, consumerSchemaPath } from '../lib/roadmap-root.mjs'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
const PLAN_REVIEW_EVIDENCE_CUTOFF = '2026-09-01T00:00:00Z'

// The subjects review rounds landed under BEFORE reviewRecord existed (task 22.1). They are
// HISTORICAL evidence only — read from commits that predate PLAN_REVIEW_EVIDENCE_CUTOFF. After
// the cutoff the durable record is the sole evidence: the queue subject in particular is what an
// UNREVIEWED queue writes too (review-phase SKILL.md Step 8 names it as the queue commit), so
// crediting it post-cutoff would silence the exact shape this check exists to catch.
const REVIEW_SUBJECTS = [
  /^docs\(roadmap\): phase (\d+) — address review findings(?:\s+.*)?$/,
  /^plan\(roadmap\): phase (\d+) review fixes(?:\s+.*)?$/,
  /^(?:docs|plan)\(roadmap\): queue phase (\d+)(?:\s+.*)?$/,
]
const MULTI_PHASE_REVIEW_SUBJECT = /^plan\(roadmap\): phases (\d+(?:\+\d+)*) review fixes(?: — .*)?$/

function gitLines(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function queueEntryAddedAt(repo, phase) {
  const backlog = `${roadmapRootRel(repo)}/backlog.ts`
  const pattern = `phase[[:space:]]*:[[:space:]]*${phase}([^0-9]|$)`
  const addedLine = new RegExp(`^\\+.*\\bphase\\s*:\\s*${phase}(?:\\D|$)`)
  const removedLine = new RegExp(`^-.*\\bphase\\s*:\\s*${phase}(?:\\D|$)`)
  let addedAt
  let present = false
  for (const row of gitLines(repo, ['log', '--reverse', '--format=%H%x09%aI', '-G', pattern, '--', backlog])) {
    const [commit, date] = row.split('\t')
    if (!commit || !date) continue
    const patch = gitLines(repo, ['show', '--format=', '--unified=0', commit, '--', backlog])
    const added = patch.some((line) => !line.startsWith('+++') && addedLine.test(line))
    const removed = patch.some((line) => !line.startsWith('---') && removedLine.test(line))
    if (added && !present) addedAt = date
    present = added || (present && !removed)
  }
  return addedAt
}

export default async function run(argv) {
  const json = argv.includes('--json')
  const repo = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')
  const roadmap = roadmapRoot(repo)
  const phasesDir = join(roadmap, 'phases')

  if (!existsSync(phasesDir)) {
    process.stderr.write(`roadmap audit: no ${phasesDir}\n`)
    return 1
  }

  // ── Typed tier (cli/audit-checks.mts under the consumer's tsx) ──────────────
  const checksScript = join(PLUGIN_ROOT, 'cli', 'audit-checks.mts')
  let typed
  try {
    const invocation = resolveTsxInvocation(repo)
    const out = execFileSync(invocation.file, [...invocation.prefix, checksScript, repo], {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 180_000,
    })
    typed = JSON.parse(out)
  } catch (err) {
    const stderr = err?.stderr?.toString?.() ?? ''
    if (err?.code === 'ENOENT' || /not found|could not determine executable/i.test(stderr)) {
      process.stderr.write(`roadmap audit: tsx not available — ${TSX_ABSENT_HINT}\n`)
      return 1
    }
    process.stderr.write(`roadmap audit: structural checks failed:\n${stderr || err}\n`)
    return 1
  }

  const findings = [...typed.findings]
  const aux = typed.aux
  const backlogSet = new Set(aux.backlogPhases ?? [])

  // ── Check 4: [NEEDS CLARIFICATION] markers (file:line; marker grammar + live phases only) ──
  // Two suppressors: a TERMINAL phase cannot be executed again, so its recorded question is
  // history, never an open marker (isTerminalPhaseSource — the census reads the same rule); and
  // the token must be TERMINATED — '[NEEDS CLARIFICATION:' (question inline) or the documented
  // bare '[NEEDS CLARIFICATION]'. An UNTERMINATED occurrence is a guard string naming the token
  // ("markerGuards: ['[NEEDS CLARIFICATION'"), never a marker. Both terminated forms must fire:
  // missing a real unresolved question in a queued phase is the dangerous direction, and this
  // check is the only CODE enforcement of the marker rule.
  for (const f of readdirSync(phasesDir).filter((n) => n.endsWith('.phase.ts')).sort()) {
    const full = join(phasesDir, f)
    const src = readFileSync(full, 'utf8')
    if (isTerminalPhaseSource(src)) continue
    const lines = src.split('\n')
    const num = Number(f.match(/phase-(\d+)/)?.[1] ?? 0) || null
    lines.forEach((line, i) => {
      if (/\[NEEDS CLARIFICATION[:\]]/.test(line)) {
        const queued = num != null && backlogSet.has(num)
        findings.push({
          check: 4,
          severity: queued ? 'CRITICAL' : 'MEDIUM',
          phase: num,
          location: `${full}:${i + 1}`,
          message: `Phase ${num} has an unresolved marker: ${line.trim().slice(0, 140)}${queued ? ' — and it is QUEUED for execution.' : ' Phase cannot be executed.'}`,
        })
      }
    })
  }

  // ── Check 7: stale in-progress phases (git staleness > 30 days) ────────────
  const now = Date.now() / 1000
  for (const ip of aux.inProgress ?? []) {
    const ts = gitLines(repo, ['log', '-n', '1', '--format=%ct', '--grep', `phase ${ip.phase}`])[0] ?? ''
    if (!ts) {
      findings.push({ check: 7, severity: 'LOW', phase: ip.phase, message: `Phase ${ip.phase} is in-progress but has no related commit history (unknown age). Resume, or set status: 'cancelled'.` })
    } else {
      const days = (now - Number(ts)) / 86_400
      if (days > 30) findings.push({ check: 7, severity: 'LOW', phase: ip.phase, message: `Phase ${ip.phase} has been in-progress ${Math.round(days)} days since its last related commit. Resume, or set status: 'cancelled'.` })
    }
  }

  // ── Check 12.3 / 12.4: archived-phase debt (reused debt-census join) ───────
  if (aux.archiveExists) {
    const census = debtCensusJson(repo, { includeArchive: true })
    if (census?.archive) {
      for (const e of census.archive.entries ?? []) {
        if (['OPEN', 'OPEN-planned', 'OPEN-operator'].includes(e.state)) {
          findings.push({ check: 12, severity: 'HIGH', phase: e.phase, message: `Phase ${e.phase} at roadmap/archive/${e.archiveVersion ?? '?'}/ has unresolved debt — ${e.ref} is ${e.state} (archive should not have closed over it).` })
        }
      }
      for (const d of census.archive.dangling ?? []) {
        findings.push({ check: 12, severity: 'MEDIUM', phase: null, message: `Archive dangling debtResolution — ${d}` })
      }
    }
  }

  // ── Check 14: followup hygiene (reuse the command's one census) ──────────
  const today = new Date().toISOString().slice(0, 10)
  for (const row of censusFollowups(repo).rows) {
    if (row.status === 'UNTRIAGED' && row.orphan) {
      findings.push({ check: 14, severity: 'MEDIUM', phase: null, message: `Followup ${row.file} is UNTRIAGED and orphaned; disposition it or add an inbound roadmap reference.` })
    }
    // A spent/superseded stamp on a file something still POINTS AT is the dangerous shape: the
    // stamp authorizes deletion, and deleting it breaks the referrer (phase 2423 deleted the plan
    // input of three QUEUED phases this way, one whose step-verify greps the file). Orphanhood is
    // therefore a precondition of the deletion verdict, not a detail — HIGH, and it BREAKS the audit.
    if ((row.status === 'spent' || row.status === 'superseded') && !row.orphan) {
      const refs = Object.entries(row.refs ?? {})
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ')
      findings.push({ check: 14, severity: 'HIGH', phase: null, message: `Followup ${row.file} is status: ${row.status} but NOT orphaned (referenced from ${refs || 'the roadmap'}); deleting it breaks the referrer — re-verify the stamp or clear the references first.` })
    }
    if (row.status === 'spent' && row.orphan) {
      findings.push({ check: 14, severity: 'LOW', phase: null, message: `Followup ${row.file} is status: spent, orphaned and still present; delete it (git history is the archive).` })
    }
    if (row.reviewBy && row.reviewBy < today) {
      findings.push({ check: 14, severity: 'LOW', phase: null, message: `Followup ${row.file} passed review-by ${row.reviewBy}; refresh or disposition it.` })
    }
  }

  // ── Check 15: stray lane worktrees (report-only) ──────────────────────────
  // The catalogue above never looked at worktrees, so the leak class surveyLanes documents was
  // invisible to every review flow that runs this command. It fires HERE rather than behind a new
  // verb by the operator ruling: a sweep verb nobody runs is what the census was measuring.
  // REPORT-ONLY — nothing below removes, prunes or deletes anything.
  //
  // Severity is the honest distinction between "a done-moment exists" and "somebody must look":
  // a stale or closed lane names its own runnable close (MEDIUM), while a legacy or unreadable
  // one can only be inspected (LOW). Neither is BROKEN — a lane an operator forgot to land must
  // never block every /do-phase in the consumer.
  if (existsSync(join(repo, '.git'))) {
    try {
      for (const row of surveyLanes(repo)) {
        if (row.class === 'live') continue // work in flight is not a stray
        const actionable = row.class !== 'legacy' && row.class !== 'unknown'
        findings.push({
          check: 15,
          severity: actionable ? 'MEDIUM' : 'LOW',
          phase: null,
          location: row.dir,
          message:
            `Stray lane worktree ${row.dir} (class ${row.class}${row.branch ? `, branch ${row.branch}` : ', detached'}) `
            + (actionable
              ? `is past its done-moment — journal ${row.journalPath}. `
              : `${row.journalPath ? `has a journal that cannot be read (${row.journalPath})` : 'has no journal naming it'}, so only inspection is honest. `)
            + `Remedy: ${row.remedy}`,
        })
      }
    } catch (err) {
      // A git repo whose worktrees cannot be enumerated is a real problem, and reporting nothing
      // for it would be the silent all-clear this check exists to end.
      findings.push({ check: 15, severity: 'LOW', phase: null, message: `Lane worktrees could not be surveyed in ${repo} — ${err.message}` })
    }
  }

  // ── Check 16: consumer schema drift ──────────────────────────────────────
  for (const target of unresolvedSchemaExports(repo)) {
    findings.push({
      check: 16,
      severity: 'HIGH',
      phase: null,
      location: consumerSchemaPath(repo),
      message: `Could not resolve export-star target ${target}; the schema export inventory is incomplete — repair the consumer schema barrel or re-vendor it.`,
    })
  }
  for (const name of missingSchemaExports(repo)) {
    findings.push({
      check: 16,
      severity: 'HIGH',
      phase: null,
      location: consumerSchemaPath(repo),
      message: `${name} is missing from the consumer schema, so phase eval records cannot emit and scorecard samples go silent — re-vendor ${consumerSchemaPath(repo)} from the plugin template.`,
    })
  }

  // ── Check 17: queued/in-progress phases without plan-review evidence ──────
  const reviewRequired = new Set([...backlogSet, ...(aux.inProgress ?? []).map((p) => p.phase)])
  // Both halves of this check read git (queue dates for the grandfather rule, historical review
  // subjects). Unusable git is ONE LOW naming the cause, never a HIGH per phase: the check-7
  // precedent ("unknown age") — reading git's silence as guilt would flip the verdict to BROKEN
  // and tell the operator not to run /do-phase without once mentioning git.
  const reviewVerdicts = aux.reviewVerdicts ?? {}
  // A durable record earns the queue ONLY at READY — backlog.ts's own docblock: review-phase
  // queues a phase only when the verdict is READY, so a queued NEEDS_WORK/BLOCKER record is a
  // louder violation than a missing one.
  const reviewedPhases = new Set(
    Object.entries(reviewVerdicts).filter(([, verdict]) => verdict === 'READY').map(([phase]) => Number(phase)),
  )
  // git is consulted only for phases a READY record does not already cover.
  const needsGit = [...reviewRequired].filter((phase) => !reviewedPhases.has(phase))
  const gitUsable = needsGit.length === 0 || gitLines(repo, ['rev-parse', '--git-dir']).length > 0
  if (!gitUsable) {
    findings.push({
      check: 17,
      severity: 'LOW',
      phase: null,
      location: repo,
      message: `Plan-review evidence check skipped: git is unusable at ${repo}, so queue dates and review commits cannot be read — ${needsGit.length} queued/in-progress phase(s) without a READY reviewRecord left unjudged.`,
    })
  }
  // Historical subject scan, bounded to commits BEFORE the cutoff (see REVIEW_SUBJECTS).
  const historical = gitUsable && needsGit.length
    ? gitLines(repo, ['log', `--before=${PLAN_REVIEW_EVIDENCE_CUTOFF}`, '--format=%s'])
    : []
  for (const subject of historical) {
    for (const pattern of REVIEW_SUBJECTS) {
      const match = subject.match(pattern)
      if (match) reviewedPhases.add(Number(match[1]))
    }
    const multi = subject.match(MULTI_PHASE_REVIEW_SUBJECT)
    if (multi) for (const phase of multi[1].split('+')) reviewedPhases.add(Number(phase))
  }
  for (const phase of gitUsable ? reviewRequired : []) {
    const phaseFile = join(phasesDir, `phase-${phase}.phase.ts`)
    if (reviewedPhases.has(phase)) continue
    const queuedAt = queueEntryAddedAt(repo, phase)
    if (queuedAt && Date.parse(queuedAt) < Date.parse(PLAN_REVIEW_EVIDENCE_CUTOFF)) continue
    const verdict = reviewVerdicts[phase]
    findings.push({
      check: 17,
      severity: 'HIGH',
      phase,
      location: phaseFile,
      message: verdict
        ? `Phase ${phase} is queued or in-progress with a reviewRecord verdict of ${verdict} — only READY earns the queue. Re-run /review-phase ${phase} and queue on a READY record.`
        : `Phase ${phase} is queued or in-progress without plan-review evidence. Run /review-phase ${phase}; a user-waived review records reviewRecord via:'waived'.`,
    })
  }

  // ── Verdict + exit (design §2 universal contract) ──────────────────────────
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1
  const broken = counts.CRITICAL > 0 || counts.HIGH > 0
  const verdict = findings.length === 0 ? 'CLEAN' : broken ? 'BROKEN' : 'HAS ISSUES'
  const exitCode = broken ? 2 : 0

  if (json) {
    process.stdout.write(
      JSON.stringify({ generatedAt: new Date().toISOString(), summary: { phases: aux.phaseCount, byStatus: aux.statusCounts, findings: counts }, findings, verdict }, null, 2) + '\n',
    )
  } else {
    process.stdout.write(renderReport({ findings, counts, verdict, aux }))
  }
  return exitCode
}

function renderReport({ findings, counts, verdict, aux }) {
  const byStatus = Object.entries(aux.statusCounts ?? {}).map(([k, v]) => `${v} ${k}`).join(', ')
  const lines = [
    `# Roadmap Audit — ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## Summary',
    '',
    `- Total active phases: ${aux.phaseCount} (${byStatus})`,
    `- Findings: ${counts.CRITICAL} CRITICAL, ${counts.HIGH} HIGH, ${counts.MEDIUM} MEDIUM, ${counts.LOW} LOW`,
    '',
  ]
  for (const sev of SEVERITIES) {
    const group = findings.filter((f) => f.severity === sev)
    if (!group.length) continue
    lines.push(`## ${sev} (${group.length})`, '')
    for (const f of group) lines.push(`- **[Phase ${f.phase ?? '—'}, Check ${f.check}]** ${f.message}${f.location ? `\n  ${f.location}` : ''}`)
    lines.push('')
  }
  lines.push(`## Verdict: ${verdict}`, '')
  if (verdict === 'BROKEN') lines.push('> Do not run `/do-phase` or cut a release until the CRITICAL/HIGH findings are resolved.', '')
  return lines.join('\n')
}
