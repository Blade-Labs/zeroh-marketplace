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

const git = (cwd, args, opts = {}) =>
  execFileSync('git', ['-C', cwd, ...args], { timeout: 15_000, encoding: 'utf8', ...opts }).trim()

/** A typed curation failure. `rescueRef` names the ref holding the untouched pre-curation HEAD. */
export class CurateError extends Error {
  constructor(message, rescueRef) {
    super(message)
    this.name = 'CurateError'
    this.rescueRef = rescueRef
  }
}

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

/**
 * Execute a curation plan: rewrite plan.base..HEAD into one curated commit per group,
 * each group's tree being its LAST original commit's tree, provably lossless.
 *
 * Safety order is the whole design:
 *  1. a rescue ref captures the pre-curation HEAD before anything else;
 *  2. the chain is assembled with git commit-tree — pure object writes, nothing moves;
 *  3. the assembled tip's tree is asserted equal to the pre-curation HEAD tree; a
 *     mismatch throws CurateError naming the rescue ref with HEAD unmoved;
 *  4. only then does the branch advance, via update-ref — NEVER reset --hard, so the
 *     index and worktree (a sibling session's uncommitted dirt included) are untouched;
 *     the trees are identical by the step-3 assertion, so the checkout stays coherent.
 *
 * plan = { base, groups: [{ commits: [{sha, subject, kind}], message: {subject, body} }] }
 * Returns { tip, rescueRef }.
 */
export function executeCurate(cwd, plan) {
  const preHead = git(cwd, ['rev-parse', 'HEAD'])
  const preTree = git(cwd, ['rev-parse', 'HEAD^{tree}'])
  const rescueRef = `refs/curate-rescue/${preHead.slice(0, 12)}`
  git(cwd, ['update-ref', rescueRef, preHead])

  let parent = git(cwd, ['rev-parse', `${plan.base}^{commit}`])
  for (const group of plan.groups) {
    const last = group.commits[group.commits.length - 1]
    const tree = git(cwd, ['rev-parse', `${last.sha}^{tree}`])
    const [aName, aEmail, aDate] = git(cwd, ['show', '-s', '--format=%an%x00%ae%x00%aI', last.sha]).split('\0')
    parent = git(cwd, ['commit-tree', tree, '-p', parent, '-m', `${group.message.subject}\n\n${group.message.body}`], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: aName,
        GIT_AUTHOR_EMAIL: aEmail,
        GIT_AUTHOR_DATE: aDate,
      },
    })
  }

  const tipTree = git(cwd, ['rev-parse', `${parent}^{tree}`])
  if (tipTree !== preTree) {
    throw new CurateError(
      `curate: the assembled chain's tree (${tipTree.slice(0, 12)}) differs from the pre-curation tree (${preTree.slice(0, 12)}) — HEAD is unmoved; the original history is at ${rescueRef}`,
      rescueRef,
    )
  }

  git(cwd, ['update-ref', 'HEAD', parent, preHead])
  return { tip: parent, rescueRef }
}

const SUBJECT_MAX = 72
const TRAILER = 'Co-Authored-By: Claude <noreply@anthropic.com>'

/** Majority vote over the WORK commits' `type(scope):` prefixes — task and gate-fix rows
 *  only (state bookkeeping, scratch/revert pairs and unparseable subjects never vote);
 *  ties break by first occurrence. */
function majorityPrefix(commits) {
  const votes = { type: new Map(), scope: new Map() }
  for (const c of commits) {
    if (c.kind !== 'task' && c.kind !== 'gate-fix') continue
    const m = /^([a-z]+)\(([a-z0-9-]+)\):/.exec(c.subject)
    if (!m) continue
    for (const [key, val] of [
      ['type', m[1]],
      ['scope', m[2]],
    ]) {
      const map = votes[key]
      if (!map.has(val)) map.set(val, { count: 0, first: map.size })
      map.get(val).count += 1
    }
  }
  const pick = (map, fallback) => {
    let best = null
    for (const [val, v] of map) {
      if (!best || v.count > best.v.count) best = { val, v }
    }
    return best ? best.val : fallback
  }
  return { type: pick(votes.type, 'chore'), scope: pick(votes.scope, 'repo') }
}

/**
 * Compose the landed commit message for one curated group: the message IS the product.
 * Subject: `type(scope): phase N — <imperative summary>` — majority type/scope, summary
 * from the phase name (leading article dropped, first letter lowercased unless an
 * acronym), truncated on WORD boundaries so the whole subject stays ≤72 chars. Body:
 * every task whose `N.x` token appears in the group's task commits — title +
 * whatWasDone + any real (non-'None') compromises — closed by exactly one
 * Co-Authored-By trailer. Nothing lands unlisted.
 */
export function composeLandedMessage(phaseRecord, group) {
  const { type, scope } = majorityPrefix(group.commits)
  const head = `${type}(${scope}): phase ${phaseRecord.phase} — `

  let words = String(phaseRecord.name).trim().split(/\s+/)
  if (/^(the|a|an)$/i.test(words[0] ?? '')) words = words.slice(1)
  if (words[0] && !/^[A-Z]{2,}/.test(words[0])) words[0] = words[0][0].toLowerCase() + words[0].slice(1)
  while (words.length > 1 && head.length + words.join(' ').length > SUBJECT_MAX) words = words.slice(0, -1)
  const subject = `${head}${words.join(' ')}`

  const inGroup = (taskId) => {
    const token = new RegExp(`\\b${taskId.replace('.', '\\.')}\\b`)
    return group.commits.some((c) => c.kind === 'task' && token.test(c.subject))
  }
  const lines = []
  for (const task of phaseRecord.tasks ?? []) {
    if (!inGroup(task.id)) continue
    lines.push(`${task.id} ${task.title}`)
    const report = task.transparencyReport
    if (report?.whatWasDone) lines.push('', report.whatWasDone)
    if (report?.compromises && report.compromises !== 'None') lines.push('', `Compromise: ${report.compromises}`)
    lines.push('')
  }
  lines.push(TRAILER)
  return { subject, body: lines.join('\n') }
}
