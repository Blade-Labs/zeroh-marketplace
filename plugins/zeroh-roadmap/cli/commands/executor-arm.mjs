/**
 * roadmap executor-arm <N> --session <id> — write the session-bound executor arm file
 * (the guard's channel (b)) via the ONE lifecycle lib (1737.2). Missing --session is a
 * usage error: an unbound arm is the cross-session fabrication hazard, never written.
 *
 * Returns its exit code to the dispatcher — never hard-exits the process.
 */
import { armExecutor } from '../lib/executor-arm.mjs'
import { gitToplevel } from '../lib/gitroot.mjs'

export default async function run(argv) {
  const phase = argv.find((a) => /^\d+$/.test(a))
  const si = argv.indexOf('--session')
  const session = si >= 0 ? argv[si + 1] : undefined
  if (!phase || !session || session.startsWith('--')) {
    process.stderr.write('roadmap executor-arm: usage: roadmap executor-arm <N> --session <id> (an unbound arm is never written)\n')
    return 1
  }
  const p = armExecutor(gitToplevel(process.cwd()), phase, session)
  process.stderr.write(`roadmap executor-arm: phase ${phase} armed for session ${session} → ${p}\n`)
  return 0
}
