#!/usr/bin/env node
/**
 * SessionStart hook — the reap-recovery hint. A usage-limit / account-refresh event kills
 * a session's WAKES (Monitors, pollers) while the work state survives on disk (beacons,
 * commits, sidecars, detached workers). When the user restarts, this hook reads the lane
 * registry and prints ONE advisory line per lane whose beacon looks parked/stalled, so the
 * fresh session resumes with `roadmap arc next <id>` instead of rediscovering the corpse
 * by archaeology (2026-07-17: three executor parks died to /login events; every recovery
 * was a manual state-verify + resume — this mechanizes the pointer to it).
 *
 * ADVISORY ONLY: always exit 0, stderr only, hard 3s budget, fail-open on anything.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { roadmapRoot } from '../cli/lib/roadmap-root.mjs'

const STALL_MIN = 20 // matches beacon.ALIVE_MAX_MIN (kept inline: the hook must never throw on an import)

try {
  const cwd = process.cwd()
  let top
  try {
    top = execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeout: 2000 })
      .toString().trim().replace(/\/\.git$/, '')
  } catch {
    process.exit(0) // not a repo — nothing to check
  }
  const registry = join(roadmapRoot(top), 'arcs', '.building')
  if (!existsSync(registry)) process.exit(0)
  const hints = []
  for (const f of readdirSync(registry).filter((f) => f.endsWith('.json'))) {
    let s
    try {
      s = JSON.parse(readFileSync(join(registry, f), 'utf8'))
    } catch {
      continue
    }
    if (!s?.arcId || s.paused) continue
    const beacon = join(registry, `${s.arcId}-executor.jsonl`)
    if (!existsSync(beacon)) continue
    let last
    try {
      const lines = readFileSync(beacon, 'utf8').trim().split('\n')
      last = JSON.parse(lines[lines.length - 1])
    } catch {
      continue
    }
    const ts = typeof last.ts === 'number' ? last.ts : Date.parse(last.ts)
    if (!Number.isFinite(ts)) continue
    const ageMin = (Date.now() - ts) / 60000
    if (ageMin > STALL_MIN)
      hints.push(
        `[roadmap] lane ${s.arcId} is armed with a quiet beacon (${Math.round(ageMin)}m, last: ${last.event}) — if this session replaced a reaped one, resume with \`roadmap arc next ${s.arcId}\` (files-are-truth: nothing was lost, only the wake)`,
      )
  }
  if (hints.length) process.stderr.write(hints.join('\n') + '\n')
} catch {
  /* advisory — never block a session start */
}
process.exit(0)
