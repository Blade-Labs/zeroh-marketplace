/**
 * curate — `roadmap phase curate <N>`: the do-phase squash step that lands a phase's
 * task/gate/scratch history as 1-3 logical commits (the born-clean ruling).
 *
 * Range derivation wraps gitscan's derivePhaseStartSha (the ONE em-dash rule home —
 * never a second grammar) and walks base..HEAD oldest-first. Every commit in the range
 * must belong to the phase; a sibling session's commit inside it would make a squash
 * rewrite someone else's work, so the ONLY safe answer to a foreign interleave is a
 * typed refusal naming the offenders — history staying granular is the honest fallback
 * until the session-worktree lane makes interleaves impossible.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

import { derivePhaseStartSha, phaseOwnPatterns, SUBJECT_GRAMMAR } from './gitscan.mjs'
import { recordCuration, latestReport } from './gate-report.mjs'

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
 * Ownership comes from gitscan's phaseOwnPatterns (canonical + the tolerated legacy
 * classes); the checks here only pick the KIND. The boundary after the phase number is
 * load-bearing everywhere a bare number would collide: phase 21 never matches
 * `phase 214 — …`, and prose that merely mentions "phase 21" stays foreign. Gate fixes
 * use their own bounded form (`phase N gate R<d>`), the one place with no dash at all.
 */
function classifySubject(subject, phaseNum) {
  const P = String(phaseNum)
  const { dash, type } = SUBJECT_GRAMMAR
  // Every ownership test is ANCHORED to the subject's own prefix: a subject that merely
  // QUOTES the grammar mid-sentence must stay foreign, or the squash rewrites a sibling's
  // commit that happened to mention it.
  const prefix = '^[a-z]+(\\([^)]*\\))?: '
  const isRevert = /^Revert "/.test(subject)
  const inner = isRevert ? subject.slice('Revert "'.length) : subject
  if (new RegExp(`^scratch(\\([^)]*\\))?: phase ${P} ${dash}`).test(inner)) return 'scratch'
  if (isRevert) return null // a revert of anything but this phase's scratch work is foreign
  if (new RegExp(`${prefix}phase ${P} gate R\\d+`).test(subject)) return 'gate-fix'
  // The batchMode step grammar (`… phase N task N.X (k/M) — <step>`) carries its boundary
  // in the task token, not the dash phrase.
  if (new RegExp(`${prefix}phase ${P} task ${P}\\.\\d+ \\(\\d+/\\d+\\) ${dash}`).test(subject)) return 'task'
  if (!phaseOwnPatterns(P).test(subject)) return null
  if (new RegExp(`^${type}\\(phase-${P}\\): gate R\\d+`).test(subject)) return 'gate-fix'
  if (new RegExp(`^docs\\(roadmap\\): mark phase ${P} complete$`).test(subject)) return 'state'
  if (subject.startsWith('docs(roadmap):')) {
    // The task-id grammar (`N.x`) also appears on roadmap-repo task commits; both kinds
    // curate identically, so 'task' wins only on an explicit task id.
    return new RegExp(`^docs\\(roadmap\\): phase ${P} ${dash} ${P}\\.\\d+`).test(subject) ? 'task' : 'state'
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
 * evidence (optional) = { toplevel, phase, redProofs: [{scratch, revert, subject}] }:
 * when present, the curation block is recorded into the phase's latest gate report
 * BEFORE any surgery — the squashed SHAs (the RED-proof pairs above all) become
 * unreachable afterwards, so a report that cannot be written aborts the curate with
 * the granular history intact. Returns { tip, rescueRef }.
 */
export function executeCurate(cwd, plan, evidence) {
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

  // Evidence lands AFTER the tree assertion (an aborted curate must leave no false
  // "squashed" claim in the report) and BEFORE the ref move (the destructive step the
  // evidence must precede). The only window left is a failed update-ref — restored below.
  let prevLatest = null
  if (evidence) {
    prevLatest = latestReport(evidence.toplevel, evidence.phase)
    recordCuration(evidence.toplevel, evidence.phase, {
      squashedCount: plan.groups.reduce((n, g) => n + g.commits.length, 0),
      landedSubjects: plan.groups.map((g) => g.message.subject),
      redProofs: evidence.redProofs ?? [],
    })
  }

  try {
    git(cwd, ['update-ref', 'HEAD', parent, preHead])
  } catch (e) {
    // The old-value guard refused (the branch moved underneath): the squash did NOT land,
    // so the report must not say it did.
    if (prevLatest) writeFileSync(prevLatest.path, JSON.stringify(prevLatest.report, null, 2) + '\n')
    throw e
  }
  return { tip: parent, rescueRef }
}

const SUBJECT_MAX = 72
const TRAILER = 'Co-Authored-By: Claude <noreply@anthropic.com>'

/** Majority vote over the WORK commits' `type(scope):` prefixes — task and gate-fix rows
 *  only (state bookkeeping, scratch/revert pairs and unparseable subjects never vote);
 *  ties break by first occurrence. */
function majorityPrefix(commits) {
  const types = new Map()
  const scopes = new Map()
  for (const c of commits) {
    if (c.kind !== 'task' && c.kind !== 'gate-fix') continue
    const m = /^([a-z]+)\(([a-z0-9-]+)\):/.exec(c.subject)
    if (!m) continue
    types.set(m[1], (types.get(m[1]) ?? 0) + 1)
    scopes.set(m[2], (scopes.get(m[2]) ?? 0) + 1)
  }
  // Map iteration is insertion-ordered, so a STRICT > keeps the first-seen winner on a tie.
  const pick = (map, fallback) => {
    let best = null
    for (const [val, count] of map) {
      if (!best || count > best.count) best = { val, count }
    }
    return best ? best.val : fallback
  }
  return { type: pick(types, 'chore'), scope: pick(scopes, 'repo') }
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
