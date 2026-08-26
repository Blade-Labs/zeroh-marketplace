/**
 * roadmap arm <arcId> [--inline] [--note <txt>] [--base-ref <ref>] [--mode <band>] —
 * compose the do-arc Step-3b sidecar and register the build lane (sidecar.mjs owns the
 * mechanics; this command is thin). A lane held by a DIFFERENT worktree is REFUSED with
 * exit 2 (honesty rail: the caller cannot narrate around a taken lane). An idempotent
 * same-worktree re-arm exits 0; a re-arm whose recorded pid is still ALIVE exits 0 but
 * prints a LOUD warning naming the live pid (two sessions may be driving one arc).
 *
 * Returns its exit code to the dispatcher — never hard-exits the process (testability seam).
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { armSidecar, writeArcMode, readSidecar, LaneHeldError } from '../lib/sidecar.mjs'
import { gitToplevel } from '../lib/gitroot.mjs'

function parse(argv) {
  const opts = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--inline') opts.inline = true
    else if (a === '--note') opts.note = argv[++i]
    else if (a === '--base-ref') opts.baseRef = argv[++i]
    else if (a === '--mode') opts.mode = argv[++i]
    else if (!a.startsWith('--')) positional.push(a)
  }
  return { opts, positional }
}

export default async function run(argv) {
  const { opts, positional } = parse(argv)
  const arcId = positional[0]
  if (!arcId) {
    process.stderr.write('roadmap arm: usage: roadmap arm <arcId> [--inline] [--note <txt>] [--base-ref <ref>] [--mode <band>]\n')
    return 1
  }
  const cwd = process.cwd()
  let branch = ''
  try {
    branch = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { timeout: 10_000, encoding: 'utf8' }).trim()
  } catch {
    /* detached / non-repo — branch stays empty, never guessed */
  }

  const wasRearm = readSidecar(cwd, arcId) != null

  let res
  try {
    res = armSidecar(cwd, arcId, {
      worktree: cwd,
      branch,
      baseRef: opts.baseRef, // never guess the arc file's baseRef here — 1657's tsx bridge owns that
      mode: opts.mode ?? 'mixed',
      note: opts.note,
    })
  } catch (e) {
    if (e instanceof LaneHeldError) {
      process.stderr.write(
        `roadmap arm: arc ${arcId} is already armed by another worktree: ${e.holderWorktree} — refusing to overwrite a foreign lane\n`,
      )
      return 2
    }
    throw e
  }

  if (opts.inline) writeArcMode(join(gitToplevel(cwd), 'roadmap'))

  if (res.warned) {
    process.stderr.write(
      `roadmap arm: ⚠ WARNING — arc ${arcId} re-armed but its recorded pid ${res.livePid} is still ALIVE; two sessions may be driving one arc\n`,
    )
  } else if (wasRearm) {
    process.stderr.write(`roadmap arm: arc ${arcId} re-armed (same worktree, idempotent)\n`)
  } else {
    process.stderr.write(`roadmap arm: arc ${arcId} armed → ${res.sidecar.worktree} @ ${branch || '(detached)'}\n`)
  }

  // Capacity advisory (phase 11) — arming is a CLAIM, not a spawn, so a starved box never
  // refuses the arm; one stderr line warns the operator. Advisory math never fails the arm.
  try {
    const { probeCapacity, defaultProbes, seamProbes, consumerCapacityConfig, SeamError } = await import('../lib/capacity.mjs')
    try {
      const verdict = probeCapacity(consumerCapacityConfig(cwd), seamProbes() ?? defaultProbes)
      if (!verdict.canSpawn)
        process.stderr.write(`roadmap arm: box at capacity — ${verdict.reasons[0] ?? 'no headroom'}; this lane may thrash live executors\n`)
    } catch (e) {
      // A broken seam is the OPERATOR's knob — name it (arm still succeeds; advisory only),
      // never go silently advisory-blind. Anything else stays swallowed: advisory math must
      // never fail the arm.
      if (e instanceof SeamError) process.stderr.write(`roadmap arm: ${e.message}\n`)
    }
  } catch {
    /* advisory only — even the import failing never fails the arm */
  }
  return 0
}
