/**
 * curate — `roadmap phase curate <N>`: the do-phase squash step that lands a phase's
 * task/gate/scratch history as 1-3 logical commits (phase 2145, the born-clean ruling).
 *
 * Range derivation wraps gitscan's derivePhaseStartSha (the ONE em-dash rule home —
 * never a second grammar) and walks base..HEAD oldest-first. Every commit in the range
 * must belong to the phase; a sibling session's commit inside it would make a squash
 * rewrite someone else's work, so the ONLY safe answer to a foreign interleave is a
 * typed refusal naming the offenders — history staying granular is the honest fallback
 * until the session-worktree lane (phase 2146) makes interleaves impossible.
 */
import { execFileSync } from 'node:child_process'

import { derivePhaseStartSha } from './gitscan.mjs'

const git = (cwd, args) =>
  execFileSync('git', ['-C', cwd, ...args], { timeout: 15_000, encoding: 'utf8' }).trim()

/**
 * Classify one subject against phase N's own commit grammar.
 * Returns 'task' | 'gate-fix' | 'scratch' | 'state' | null (foreign).
 *
 * The em-dash boundary (`phase N —`) is load-bearing everywhere a bare number would
 * collide: `phase 21 —` never matches `phase 214 — …`, and prose that merely mentions
 * "phase 21" (no boundary) stays foreign. Gate fixes use their own bounded form
 * (`phase N gate R<d>`), the one place the landed grammar has no em dash.
 */
function classifySubject(subject, phaseNum) {
  const dash = `phase ${phaseNum} —`
  const isRevert = /^Revert "/.test(subject)
  const inner = isRevert ? subject.slice('Revert "'.length) : subject
  if (/^scratch(\(|:)/.test(inner) && inner.includes(dash)) return 'scratch'
  if (isRevert) return null // a revert of anything but this phase's scratch work is foreign
  if (new RegExp(`: phase ${phaseNum} gate R\\d+`).test(subject)) return 'gate-fix'
  if (!subject.includes(dash)) return null
  if (/^docs\(roadmap\):/.test(subject)) {
    // The task-id grammar (`N.x`) also appears on roadmap-repo task commits; both kinds
    // curate identically, so 'task' wins only on an explicit task id.
    return new RegExp(`${dash} ${phaseNum}\\.\\d+`).test(subject) ? 'task' : 'state'
  }
  return 'task'
}

/**
 * Derive phase N's curation range: { ok:true, base, commits:[{sha, subject, kind}] }
 * oldest-first, or the typed refusal { ok:false, reason, foreign:[{sha, subject}] }
 * with EVERY foreign commit named. The range is base-EXCLUSIVE — whatever sits at or
 * below the derived base is out of scope by construction.
 */
export function deriveCurationRange(cwd, phaseNum) {
  const base = derivePhaseStartSha(cwd, phaseNum)
  const out = git(cwd, ['rev-list', '--reverse', '--format=%H%x09%s', `${base}..HEAD`])
  const commits = []
  const foreign = []
  for (const line of out.split('\n')) {
    if (!line || line.startsWith('commit ')) continue
    const tab = line.indexOf('\t')
    const sha = line.slice(0, tab)
    const subject = line.slice(tab + 1)
    const kind = classifySubject(subject, phaseNum)
    if (kind === null) foreign.push({ sha, subject })
    else commits.push({ sha, subject, kind })
  }
  if (foreign.length > 0) {
    return {
      ok: false,
      reason: `refusing to curate phase ${phaseNum}: ${foreign.length} foreign commit(s) interleave the range ${base.slice(0, 7)}..HEAD — a squash would rewrite work that is not this phase's`,
      foreign,
    }
  }
  return { ok: true, base, commits }
}
