/**
 * roadmap audit [repo-root] [--json] — audit-roadmap's 14 structural checks, mechanized
 * (ROADCODE 1659.2, replacing skills/audit-roadmap's hand-run prose). Read-only: never
 * opens source code, never fixes — reports findings + a verdict.
 *
 * Two tiers (ROADCODE §2): the typed structural checks (1-3, 5-6, 8-12.2, 13 + crossValidate)
 * run in cli/audit-checks.mts under the consumer's tsx so they reuse the consumer registry's
 * discoverPhases/crossValidate + the plugin's suggestKind — never a second parser. This
 * orchestrator owns the checks that need git or raw file:line, and reuses the debt-census
 * join (via derive.debtCensusJson --include-archive) for 12.3-12.4:
 *   4  [NEEDS CLARIFICATION] markers (raw grep → file:line; CRITICAL when the phase is queued)
 *   7  stale in-progress phases (git log staleness > 30 days)
 *   12.3 archived phase with unresolved/planned-not-done/operator-pending debt (HIGH)
 *   12.4 dangling debtResolution on an archived phase (MEDIUM)
 *   14 followup hygiene: untriaged orphans (MEDIUM), spent/superseded-but-REFERENCED (HIGH),
 *      spent orphans + past-review files (LOW)
 *
 * Exit contract (design §2): 0 = CLEAN or HAS ISSUES (MEDIUM/LOW only) · 2 = BROKEN (any
 * CRITICAL/HIGH) · 1 = usage / tsx-absent in this strict context.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { debtCensusJson } from '../lib/derive.mjs'
import { TSX_ABSENT_HINT } from '../lib/tsx-bridge.mjs'
import { censusFollowups } from './followups.mjs'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export default async function run(argv) {
  const json = argv.includes('--json')
  const repo = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')
  const roadmap = join(repo, 'roadmap')
  const phasesDir = join(roadmap, 'phases')

  if (!existsSync(phasesDir)) {
    process.stderr.write(`roadmap audit: no roadmap/phases at ${repo}\n`)
    return 1
  }

  // ── Typed tier (cli/audit-checks.mts under the consumer's tsx) ──────────────
  const checksScript = join(PLUGIN_ROOT, 'cli', 'audit-checks.mts')
  let typed
  try {
    const out = execFileSync('npx', ['--no-install', 'tsx', checksScript, repo], {
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

  // ── Check 4: [NEEDS CLARIFICATION] markers (raw, file:line) ────────────────
  for (const f of readdirSync(phasesDir).filter((n) => n.endsWith('.phase.ts')).sort()) {
    const full = join(phasesDir, f)
    const lines = readFileSync(full, 'utf8').split('\n')
    const num = Number(f.match(/phase-(\d+)/)?.[1] ?? 0) || null
    lines.forEach((line, i) => {
      if (line.includes('[NEEDS CLARIFICATION')) {
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
    let ts = ''
    try {
      ts = execFileSync('git', ['-C', repo, 'log', '-n', '1', '--format=%ct', '--grep', `phase ${ip.phase}`], { encoding: 'utf8' }).trim()
    } catch {
      /* no git / no history */
    }
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
