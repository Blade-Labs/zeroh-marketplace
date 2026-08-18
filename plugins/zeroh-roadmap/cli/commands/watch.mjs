/**
 * roadmap watch <arcId|sidecar.json> [--once] [--json] [--interval-min N] [--max-hours N]
 *   [--transcript-dir <dir>]
 *
 * Absorbs scripts/executor-liveness.mjs + executor-watch.mjs (arc ROADCODE 1657.6,
 * decision 11). Arg duality: a `.json` path is a sidecar used directly; anything else is
 * an arcId resolved to <roadmap>/arcs/.building/<arcId>.json. `--once` = one readLiveness
 * → JSON → exit 0 (the liveness contract). Loop mode ports executor-watch: a 2-consecutive-
 * STALLED debounce, and the exit vocabulary 0 (sidecar gone / max-hours) · 3 STALLED · 4
 * EXITED · 5 UNOBSERVED · 2 usage. Every LIVENESS_* env seam passes through so the ported tests
 * stay hermetic.
 *
 * 5 is its own exit rather than a 3 (2384.2): the two verdicts demand OPPOSITE reactions. A 3 says
 * an independent life probe came back negative, so respawning is defensible; a 5 says nothing could
 * be probed, and respawning on it is how two executors land on one live phase. Same 2-consecutive
 * debounce, because one poll of either is still a boundary artifact.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readLiveness } from '../lib/liveness.mjs'
import { buildingDir } from '../lib/sidecar.mjs'

const flagVal = (argv, name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

/** Resolve the target arg to a sidecar path (decision 11 duality). */
function resolveSidecar(arg) {
  if (arg.endsWith('.json')) return arg
  try {
    return join(buildingDir(process.cwd()), `${arg}.json`)
  } catch {
    return join('roadmap', 'arcs', '.building', `${arg}.json`) // best-effort when cwd is not a repo
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async function run(argv) {
  const target = argv.find((a) => !a.startsWith('--'))
  if (!target) {
    process.stderr.write('usage: roadmap watch <arcId|sidecar.json> [--once] [--json] [--interval-min N] [--max-hours N] [--transcript-dir <dir>]\n')
    return 2
  }
  const sidecarPath = resolveSidecar(target)
  const transcriptDir = flagVal(argv, '--transcript-dir') ?? null
  const json = argv.includes('--json')

  // ── --once: a single liveness read ──
  if (argv.includes('--once')) {
    if (!existsSync(sidecarPath)) {
      process.stderr.write(`roadmap watch: no sidecar at ${sidecarPath}\n`)
      return 2
    }
    const result = await readLiveness({ sidecarPath, transcriptDir, env: process.env })
    if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    else {
      process.stdout.write(`${result.verdict} — arc ${result.arcId} (${result.worktree})\n`)
      for (const [k, v] of Object.entries(result.evidence)) process.stdout.write(`  ${k}: ${v}\n`)
    }
    return 0
  }

  // ── loop mode (executor-watch) ──
  const intervalMs = Number(process.env.LIVENESS_WATCH_INTERVAL_MS ?? Number(flagVal(argv, '--interval-min') ?? 5) * 60_000)
  const maxMs = Number(flagVal(argv, '--max-hours') ?? 6) * 3_600_000
  const started = Date.now()
  let consecutiveStalled = 0
  let consecutiveUnobserved = 0

  while (true) {
    if (!existsSync(sidecarPath)) {
      process.stdout.write(JSON.stringify({ watch: 'sidecar gone — arc exited', sidecarPath }) + '\n')
      return 0
    }
    let result = null
    try {
      result = await readLiveness({ sidecarPath, transcriptDir, env: process.env })
    } catch {
      result = null // a transient read failure is not a verdict — keep watching
    }
    if (result) {
      if (result.verdict.endsWith('STALLED')) {
        // Debounce: one STALLED read can be a boundary artifact; two consecutive is a stall.
        consecutiveStalled += 1
        if (consecutiveStalled >= 2) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return 3
        }
      } else {
        consecutiveStalled = 0
      }
      if (result.verdict.endsWith('UNOBSERVED')) {
        consecutiveUnobserved += 1
        if (consecutiveUnobserved >= 2) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return 5
        }
      } else {
        consecutiveUnobserved = 0
      }
      if (result.verdict.endsWith('EXITED')) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        return 4
      }
    }
    if (Date.now() - started >= maxMs) {
      process.stdout.write(JSON.stringify({ watch: 'max duration reached with a live executor', last: result }) + '\n')
      return 0
    }
    await sleep(intervalMs)
  }
}
