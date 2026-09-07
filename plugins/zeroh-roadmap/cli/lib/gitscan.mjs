/**
 * gitscan — the ONE git-archaeology helper for phase-start-SHA derivation (arc
 * ROADCODE, do-phase SKILL.md Step 1b.3, now code). Extracted from 1656's
 * cli/commands/gate.mjs deriveBaseSha (pre-made decision 3): the em-dash rule is
 * NEVER duplicated — gate.mjs (baseSha) and derive.mjs (resume.startSha) both call
 * derivePhaseStartSha, so the 1656 em-dash fixture and the 1657 kill/resume fixtures
 * exercise the SAME code.
 *
 * Ownership is read through phaseOwnPatterns — the ONE home for the subject grammar
 * (canonical + the recorded legacy classes). The boundary after the phase number
 * prevents a prefix collision: resuming 136 must not match 1369's commits.
 */
import { execFileSync } from 'node:child_process'

/** A typed git-archaeology failure. kind ∈ 'no-match' | 'git-error'. */
export class GitScanError extends Error {
  constructor(kind, messageLines) {
    super(messageLines.join('\n'))
    this.name = 'GitScanError'
    this.kind = kind
    this.messageLines = messageLines
  }
}

const git = (cwd, args) =>
  execFileSync('git', ['-C', cwd, ...args], { timeout: 15_000, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()

/**
 * The subject-grammar fragments every reader shares, ERE- and JS-compatible. They live
 * here because curate's classifier and gate's deviant-class scan bind on the same
 * literals: a second copy is how the grammar forks again.
 */
export const SUBJECT_GRAMMAR = {
  /** em (the canonical boundary) · en · ASCII hyphen — the recorded D4 variants. */
  dash: '(—|–|-)',
  /** The conventional-commit type, before any `(scope)`. */
  type: '[A-Za-z0-9_-]+',
  /** `type(scope): ` — the ordinary subject prefix. */
  typePrefix: '[A-Za-z0-9_-]+(\\([^)]*\\))?: ',
}

/**
 * Commit-subject ownership grammar shared by git's ERE engine and JavaScript.
 * Canonical writers use the em dash; readers also recognize recorded legacy forms.
 */
export function phaseOwnPatterns(phaseNum) {
  const phase = String(phaseNum)
  if (!/^[0-9]+$/.test(phase)) {
    throw new TypeError(`phase number must contain digits only, got: ${phase}`)
  }

  const { dash, type, typePrefix: ordinaryPrefix } = SUBJECT_GRAMMAR
  const phasePrefix = `phase ${phase}`
  const canonicalOrTask =
    `${phasePrefix} (`
    + `${dash}`
    + `|task ${phase}\\.[0-9]+ \\([0-9]+/[0-9]+\\) ${dash}`
    + `|task ${phase}\\.[0-9]+ ${dash}`
    + `|${phase}\\.[0-9]+ ${dash}`
    + ')'
  const canonicalGateFix = `${phasePrefix} gate R[0-9]+( ${dash})?`
  const scopeCarried = `${type}\\(phase-${phase}\\):`
  const state = `docs\\(roadmap\\): mark ${phasePrefix} complete$`
  const ere = `^(${ordinaryPrefix}(${canonicalOrTask}|${canonicalGateFix})|${scopeCarried}|${state})`
  const subjectPattern = new RegExp(ere)

  return { ere, test: (subject) => subjectPattern.test(subject) }
}

/**
 * The phase-start SHA, derived by a two-tier rule over the commits phaseOwnPatterns(N)
 * reads as this phase's own (canonical + tolerated legacy forms). TIER 1: among those
 * matches, the ones whose subject ALSO says "move to in-progress" / "set in-progress"
 * are the move-commit set; when non-empty the base is the PARENT (^) of the NEWEST such
 * commit — this kills the D1 over-broadening where a phase number that appeared in
 * ancient history derived a huge foreign range.
 * TIER 2 (fallback): no move-commit → the PARENT of the OLDEST own match, the original
 * rule verbatim. `--base` overrides both: it is rev-parsed, falling back to the
 * literal on a resolve failure. A root commit with no parent falls back to the commit
 * itself. No matching commit ⇒ GitScanError('no-match'); a git failure ⇒
 * GitScanError('git-error'). Returns the resolved SHA string.
 */
export function derivePhaseStartSha(cwd, phaseNum, { base } = {}) {
  if (base) {
    try {
      return git(cwd, ['rev-parse', base])
    } catch {
      return base
    }
  }
  const own = phaseOwnPatterns(phaseNum)
  let out
  try {
    // Default (newest-first) order + subjects, so the move-commit set can pick its newest.
    out = git(cwd, ['log', '-E', `--grep=${own.ere}`, '--format=%H%x09%s'])
  } catch (e) {
    throw new GitScanError('git-error', [`gitscan: git log failed in ${cwd}: ${e.message}`])
  }
  const rows = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t')
      return { sha: line.slice(0, tab), subject: tab < 0 ? '' : line.slice(tab + 1) }
    })
    .filter((row) => own.test(row.subject))
  if (rows.length === 0) {
    throw new GitScanError('no-match', [`no commit matching "phase ${phaseNum} —"`])
  }
  const moveRe = /move to in-progress|set in-progress/
  const moveCommits = rows.filter((r) => moveRe.test(r.subject))
  // Tier 1: newest move-commit (rows are newest-first). Tier 2: oldest match (last row).
  const chosen = moveCommits.length > 0 ? moveCommits[0].sha : rows[rows.length - 1].sha
  try {
    return git(cwd, ['rev-parse', `${chosen}^`])
  } catch {
    return chosen // root commit — no parent
  }
}

/** Exact terminal task notation shares one parser across ownership readers. */
export function phaseTaskSuffix(subject) {
  return new RegExp(`^${SUBJECT_GRAMMAR.typePrefix}.+ \\(([0-9]+\\.[0-9]+)\\)$`).exec(subject)?.at(-1) ?? null
}

export function hasPhaseTaskSuffix(subject, phaseNum, taskIds = []) {
  phaseOwnPatterns(phaseNum)
  const task = phaseTaskSuffix(subject)
  return Boolean(task && task.startsWith(String(phaseNum) + '.') && taskIds.includes(task))
}

function historyReachability(cwd) {
  const ordinary = (ancestor, descendant) => {
    try { git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]); return true }
    catch (error) { if (error.status === 1) return false; throw error }
  }
  const rescued = git(cwd, ['for-each-ref', '--format=%(objectname) %(objecttype)', 'refs/curate-rescue/'])
  const tips = rescued ? rescued.split('\n').map(row => {
    const [tip, type] = row.split(' ')
    if (type !== 'commit' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(tip)) throw new Error('curation rescue does not name a commit')
    return { tip, tree: git(cwd, ['show', '-s', '--format=%T', tip]) }
  }) : []
  const trees = new Map(), closures = new Map(), ancestry = new Map()
  const related = (ancestor, descendant) => {
    const key = ancestor + ':' + descendant
    if (!ancestry.has(key)) ancestry.set(key, ordinary(ancestor, descendant))
    return ancestry.get(key)
  }
  const histories = head => {
    if (closures.has(head)) return closures.get(head)
    const reached = new Set([head]), pending = [head]
    while (pending.length) {
      const tip = pending.pop()
      if (!trees.has(tip)) trees.set(tip, new Set(git(cwd, ['log', '--format=%T', tip]).split('\n')))
      for (const rescue of tips) if (!reached.has(rescue.tip) && trees.get(tip).has(rescue.tree)) {
        reached.add(rescue.tip); pending.push(rescue.tip)
      }
    }
    closures.set(head, reached)
    return reached
  }
  return (ancestor, descendant) => related(ancestor, descendant) || [...histories(descendant)].some(tip => related(ancestor, tip))
}

/** Existing rescue refs connect tree-identical rewrites without inventing ancestry. */
export function curationAncestry(cwd, ancestor, descendant) {
  try {
    for (const value of [ancestor, descendant]) {
      if (typeof value !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value) || git(cwd, ['rev-parse', '--verify', value + '^{commit}']) !== value) throw new Error('history comparison requires exact commit IDs')
    }
    return historyReachability(cwd)(ancestor, descendant)
  } catch (error) { throw new GitScanError('git-error', ['curation history could not be verified: ' + error.message]) }
}

export function isCuratedTreeReplacement(cwd, original, replacement) {
  try {
    return curationAncestry(cwd, original, replacement)
      && git(cwd, ['show', '-s', '--format=%T', original]) === git(cwd, ['show', '-s', '--format=%T', replacement])
  } catch (error) {
    if (error instanceof GitScanError) throw error
    throw new GitScanError('git-error', ['curation trees could not be verified: ' + error.message])
  }
}
