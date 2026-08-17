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
      // force: staleArms has ALREADY applied the definition of stale, so the live-arm guard would
      // only re-litigate a judgement that is made. Without this the sweep would block on its own
      // guard for the stale classes whose last beacon event happens to be a work event.
      disarmExecutor(worktree, s.phase, { force: true })
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
