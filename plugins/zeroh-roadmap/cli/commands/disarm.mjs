/**
 * roadmap disarm <arcId> [--paused] — the sidecar lifecycle as an exit-coded command.
 *  default: removeSidecar + clear <toplevel>/roadmap/.arc-mode + release ONLY those
 *    claim numbers whose phase file now EXISTS (phasescan proves the number landed; an
 *    unlanded claim is LEFT — it may be another session's reservation).
 *  --paused: rewrite the sidecar paused:true, leave .arc-mode + claims untouched (the
 *    lane stays visibly claimed — do-arc Step-4c semantics).
 * Disarming a nonexistent lane exits 2 naming what was not found (exit codes never lie).
 *
 * Returns its exit code to the dispatcher — never hard-exits the process.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readSidecar, removeSidecar, pauseSidecar, clearArcMode, releaseClaims } from '../lib/sidecar.mjs'
import { gitToplevel, gitCommonDir } from '../lib/gitroot.mjs'
import { scanPhaseFile } from '../lib/phasescan.mjs'
import { roadmapRoot } from '../lib/roadmap-root.mjs'

function landedNumbers(roadmapRoot) {
  const phasesDir = join(roadmapRoot, 'phases')
  const set = new Set()
  if (!existsSync(phasesDir)) return set
  for (const f of readdirSync(phasesDir).filter((f) => f.endsWith('.phase.ts'))) {
    const r = scanPhaseFile(join(phasesDir, f))
    if (r?.phase != null) set.add(String(r.phase))
  }
  return set
}

function releaseLandedClaims(cwd, roadmapRoot) {
  let claimsDir
  try {
    claimsDir = join(gitCommonDir(cwd), 'zeroh-roadmap-claims')
  } catch {
    return []
  }
  if (!existsSync(claimsDir)) return []
  const landed = landedNumbers(roadmapRoot)
  const toRelease = []
  for (const f of readdirSync(claimsDir)) {
    const m = f.match(/^(\d+)\.claim$/)
    if (m && landed.has(m[1])) toRelease.push(Number(m[1]))
  }
  if (toRelease.length) releaseClaims(cwd, toRelease)
  return toRelease
}

export default async function run(argv) {
  const paused = argv.includes('--paused')
  const arcId = argv.find((a) => !a.startsWith('--'))
  if (!arcId) {
    process.stderr.write('roadmap disarm: usage: roadmap disarm <arcId> [--paused]\n')
    return 1
  }
  const cwd = process.cwd()

  if (!readSidecar(cwd, arcId)) {
    process.stderr.write(`roadmap disarm: no sidecar for arc ${arcId} found — nothing to disarm (not found)\n`)
    return 2
  }

  if (paused) {
    pauseSidecar(cwd, arcId)
    process.stderr.write(`roadmap disarm: arc ${arcId} paused — the lane stays claimed (.arc-mode + claims untouched)\n`)
    return 0
  }

  removeSidecar(cwd, arcId)
  const root = roadmapRoot(gitToplevel(cwd))
  clearArcMode(root)
  const released = releaseLandedClaims(cwd, root)
  process.stderr.write(
    `roadmap disarm: arc ${arcId} disarmed${released.length ? `; released landed claims ${released.join(', ')}` : ''}\n`,
  )
  return 0
}
