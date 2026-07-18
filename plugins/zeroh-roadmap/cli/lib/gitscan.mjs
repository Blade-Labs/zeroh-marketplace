/**
 * gitscan — the ONE git-archaeology helper for phase-start-SHA derivation (arc
 * ROADCODE, do-phase SKILL.md Step 1b.3, now code). Extracted from 1656's
 * cli/commands/gate.mjs deriveBaseSha (pre-made decision 3): the em-dash rule is
 * NEVER duplicated — gate.mjs (baseSha) and derive.mjs (resume.startSha) both call
 * derivePhaseStartSha, so the 1656 em-dash fixture and the 1657 kill/resume fixtures
 * exercise the SAME code.
 *
 * The em-dash boundary (`phase <N> —`) prevents a phase-number prefix collision:
 * resuming 136 must not match 1369's commits (do-phase SKILL.md:127-135).
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
  execFileSync('git', ['-C', cwd, ...args], { timeout: 15_000, encoding: 'utf8' }).trim()

/**
 * The phase-start SHA, derived by a two-tier rule over commits matching `phase <N> —`
 * (the em-dash boundary). TIER 1: among those matches, the ones whose subject ALSO says
 * "move to in-progress" / "set in-progress" are the move-commit set; when non-empty the
 * base is the PARENT (^) of the NEWEST such commit — this kills the D1 over-broadening
 * where a phase number that appeared in ancient history derived a huge foreign range.
 * TIER 2 (fallback): no move-commit → the PARENT of the OLDEST `phase <N> —` match, the
 * original rule verbatim. `--base` overrides both: it is rev-parsed, falling back to the
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
  const grep = `phase ${phaseNum} —` // em-dash boundary
  let out
  try {
    // Default (newest-first) order + subjects, so the move-commit set can pick its newest.
    out = git(cwd, ['log', `--grep=${grep}`, '--format=%H%x09%s'])
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
