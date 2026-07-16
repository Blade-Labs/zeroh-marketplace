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
 * The phase-start SHA = the PARENT (^) of the OLDEST commit matching `phase <N> —`
 * (the move-to-in-progress commit, ordinarily). `--base` overrides: it is rev-parsed,
 * falling back to the literal on a resolve failure. A root commit with no parent falls
 * back to the commit itself. No matching commit ⇒ GitScanError('no-match'); a git
 * failure ⇒ GitScanError('git-error'). Returns the resolved SHA string.
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
    out = git(cwd, ['log', '--reverse', `--grep=${grep}`, '--format=%H'])
  } catch (e) {
    throw new GitScanError('git-error', [`gitscan: git log failed in ${cwd}: ${e.message}`])
  }
  const oldest = out.split('\n').filter(Boolean)[0]
  if (!oldest) {
    throw new GitScanError('no-match', [`no commit matching "phase ${phaseNum} —"`])
  }
  try {
    return git(cwd, ['rev-parse', `${oldest}^`])
  } catch {
    return oldest // root commit — no parent
  }
}
