#!/usr/bin/env node
/**
 * executor-watch.mjs — the arm-once fallback wake for an arc executor. The
 * orchestrator backgrounds ONE of these right after spawning a phase-executor;
 * it loops executor-liveness.mjs and EXITS on the first actionable state, so
 * the process exit (not a remembered cadence) re-invokes the orchestrator.
 * Both field failures — the 2026-07-03 false STALLED and the 2026-07-09
 * five-hour false ALIVE — came from hand-improvised watchers; this replaces
 * them. The executor's own return stays the PRIMARY wake; this is the backstop.
 *
 * Usage: executor-watch.mjs <sidecar.json> [--interval-min N] [--max-hours N]
 *        [--transcript-dir <dir>]
 *
 * Exit codes (the orchestrator branches on these):
 *   0 — sidecar gone (the arc exited cleanly) or --max-hours elapsed
 *   3 — STALLED  → the recovery ladder (nudge → respawn-with-resume → fail)
 *   4 — EXITED   → resume-with-directive (the executor ended its turn on prose)
 * The final liveness JSON is printed on stdout either way.
 *
 * Injectable seams (hermetic tests): LIVENESS_WATCH_INTERVAL_MS overrides the
 * tick delay; the child inherits env, so the liveness seams pass through.
 */
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIVENESS = join(dirname(fileURLToPath(import.meta.url)), 'executor-liveness.mjs')

const args = process.argv.slice(2)
const sidecarPath = args.find((a) => !a.startsWith('--'))
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
if (!sidecarPath) {
  console.error('usage: executor-watch.mjs <sidecar.json> [--interval-min N] [--max-hours N] [--transcript-dir <dir>]')
  process.exit(2)
}

const intervalMs = Number(process.env.LIVENESS_WATCH_INTERVAL_MS ?? Number(flag('--interval-min', 5)) * 60_000)
const maxMs = Number(flag('--max-hours', 6)) * 3_600_000
const transcriptDir = flag('--transcript-dir', null)
const started = Date.now()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

while (true) {
  if (!existsSync(sidecarPath)) {
    console.log(JSON.stringify({ watch: 'sidecar gone — arc exited', sidecarPath }))
    process.exit(0)
  }
  let result
  try {
    const out = execFileSync(
      'node',
      [LIVENESS, sidecarPath, '--json', ...(transcriptDir ? ['--transcript-dir', transcriptDir] : [])],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    result = JSON.parse(out)
  } catch {
    result = null // a transient read failure is not a verdict — keep watching
  }
  if (result) {
    if (result.verdict.endsWith('STALLED')) {
      console.log(JSON.stringify(result, null, 2))
      process.exit(3)
    }
    if (result.verdict.endsWith('EXITED')) {
      console.log(JSON.stringify(result, null, 2))
      process.exit(4)
    }
  }
  if (Date.now() - started >= maxMs) {
    console.log(JSON.stringify({ watch: `max duration reached with a live executor`, last: result }))
    process.exit(0)
  }
  await sleep(intervalMs)
}
