/**
 * exec — the injectable process seam derive.mjs and landing.mjs run git / the debt
 * census / the arc-end suite through (arc ROADCODE). Tests inject a recorder to assert
 * the exact argv stream (e.g. landing's "no ':' refspec token ever" proof) and to feed
 * canned exit codes; production uses defaultExec.
 *
 * Contract: exec(file, args, { cwd?, input? }) → { status, stdout, stderr }. NEVER
 * throws on a non-zero exit — the exit code is DATA the caller branches on (honesty
 * rail: exit codes never lie, so they must be observable, not swallowed as exceptions).
 */
import { execFileSync } from 'node:child_process'

// execFileSync's 1 MiB default silently truncates and THEN throws ENOBUFS, which a caller
// reads as "the command failed" — indistinguishable from "the command found nothing". A git
// log over a real repo's history clears 1 MiB easily (the flagship consumer's is ~2.9 MB), so
// the seam carries headroom by default: ~100k commit subjects.
export function defaultExec(file, args, { cwd, input, timeout = 120_000, maxBuffer = 16 * 1024 * 1024 } = {}) {
  try {
    const stdout = execFileSync(file, args, {
      cwd,
      input,
      encoding: 'utf8',
      timeout,
      maxBuffer,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    return {
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout?.toString?.() ?? '',
      stderr: e.stderr?.toString?.() ?? String(e.message ?? e),
    }
  }
}
