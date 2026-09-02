/**
 * roadmap executor-disarm <N> [--force] | --sweep — remove one executor arm file, or sweep
 * exactly the STALE set (terminal phase / terminal beacon / bare-legacy format),
 * naming each removal's reason. A live in-flight arm is NEVER swept (1737.2).
 *
 * Disarming a phase whose executor never returned a result is REFUSED with exit 2 and the beacon
 * evidence on stderr: clearing a live arm is what let a second executor be spawned onto a phase
 * the first still owned (2026-08-17). --force is the deliberate override, taken after reading that
 * evidence rather than instead of reading it.
 *
 * Returns its exit code to the dispatcher — never hard-exits the process.
 */
import { join } from 'node:path'
import { disarmExecutor, staleArms } from '../lib/executor-arm.mjs'
import { gitToplevel } from '../lib/gitroot.mjs'
import { roadmapRoot } from '../lib/roadmap-root.mjs'

export default async function run(argv) {
  const worktree = gitToplevel(process.cwd())
  if (argv.includes('--sweep')) {
    const stale = staleArms(worktree, join(roadmapRoot(worktree), 'phases'))
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
    process.stderr.write('roadmap executor-disarm: usage: roadmap executor-disarm <N> [--force] | --sweep\n')
    return 1
  }
  try {
    disarmExecutor(worktree, phase, { force: argv.includes('--force') })
  } catch (err) {
    process.stderr.write(`roadmap executor-disarm: ${err.message}\n`)
    return 2
  }
  process.stderr.write(`roadmap executor-disarm: phase ${phase} disarmed\n`)
  return 0
}
