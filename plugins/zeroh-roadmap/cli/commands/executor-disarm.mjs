/**
 * roadmap executor-disarm <N> | --sweep — remove one executor arm file, or sweep
 * exactly the STALE set (terminal phase / terminal beacon / bare-legacy format),
 * naming each removal's reason. A live in-flight arm is NEVER swept (1737.2).
 *
 * Returns its exit code to the dispatcher — never hard-exits the process.
 */
import { join } from 'node:path'
import { disarmExecutor, staleArms } from '../lib/executor-arm.mjs'
import { gitToplevel } from '../lib/gitroot.mjs'

export default async function run(argv) {
  const worktree = gitToplevel(process.cwd())
  if (argv.includes('--sweep')) {
    const stale = staleArms(worktree, join(worktree, 'roadmap', 'phases'))
    if (stale.length === 0) {
      process.stderr.write('roadmap executor-disarm: sweep — no stale arms\n')
      return 0
    }
    for (const s of stale) {
      disarmExecutor(worktree, s.phase)
      process.stderr.write(`roadmap executor-disarm: swept phase ${s.phase} — ${s.reason} (${s.file})\n`)
    }
    return 0
  }
  const phase = argv.find((a) => /^\d+$/.test(a))
  if (!phase) {
    process.stderr.write('roadmap executor-disarm: usage: roadmap executor-disarm <N> | --sweep\n')
    return 1
  }
  disarmExecutor(worktree, phase)
  process.stderr.write(`roadmap executor-disarm: phase ${phase} disarmed\n`)
  return 0
}
