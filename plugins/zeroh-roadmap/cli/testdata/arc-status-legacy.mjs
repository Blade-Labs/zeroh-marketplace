#!/usr/bin/env node
// FROZEN FOR PARITY (ROADCODE 1655) — VERBATIM pre-shim body of scripts/arc-status.mjs;
// the status-parity test diffs `roadmap status` against THIS. Deleted with the shims at 1661.
/**
 * arc-status — derive the LIVE multi-session lane state. Never hand-written,
 * so it cannot go stale: reads the machine truth and prints the table the
 * coordination board used to carry as prose.
 *
 * Sources (all already maintained by the do-arc protocol or git itself):
 *   - roadmap/arcs/.building/<ID>.json   (build registration; v0.11.0 Step 3b)
 *   - roadmap/arcs/<ID>-RESUME.md        (pause handoffs)
 *   - roadmap/phases/*.phase.ts          (status: 'in-progress' + arcId)
 *   - git worktree list --porcelain      (what actually exists on disk)
 *
 * Flags it raises (silence is not success):
 *   - UNREGISTERED — in-progress phases whose arc has no .building sidecar
 *     (a pre-v0.11 build, or a session that skipped Step 3b)
 *   - WORKTREE GONE — a sidecar naming a worktree that no longer exists
 *   - STALLED? — beacon-evidenced: the executor heartbeat (<ID>-executor.jsonl)
 *     has aged past the liveness thresholds (a mid-gate-quiet gate-stage-start
 *     beacon is NOT stalled). Falls back to STALE? (>24h commit age, labeled
 *     `pre-beacon`) only when no beacon exists — so a long gate no longer
 *     false-positives on commit age alone.
 *
 * Usage: node <plugin>/scripts/arc-status.mjs [roadmap-root]   (default ./roadmap)
 * Decisions (priorities, release gates) are NOT here — read the short board in
 * roadmap/backlog.ts's header; this script is state only.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'roadmap')
if (!existsSync(join(root, 'phases'))) {
  console.error(`arc-status: no roadmap at ${root} (pass the roadmap root as arg)`)
  process.exit(1)
}

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, timeout: 15_000 }).toString().trim()
  } catch {
    return ''
  }
}

// 1) Worktrees on disk (repo of the roadmap root)
const repo = git(['rev-parse', '--show-toplevel'], root) || resolve(root, '..')
const worktrees = new Map() // path -> branch
for (const block of git(['worktree', 'list', '--porcelain'], repo).split('\n\n')) {
  const path = block.match(/^worktree (.+)$/m)?.[1]
  const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? '(detached)'
  if (path) worktrees.set(resolve(path), branch)
}

// 2) Build registrations
const buildingDir = join(root, 'arcs', '.building')
const sidecars = new Map() // arcId -> sidecar
if (existsSync(buildingDir)) {
  for (const f of readdirSync(buildingDir).filter((f) => f.endsWith('.json'))) {
    try {
      const s = JSON.parse(readFileSync(join(buildingDir, f), 'utf8'))
      if (s?.arcId) sidecars.set(String(s.arcId), s)
    } catch {
      console.error(`  ⚠ unreadable sidecar: ${join(buildingDir, f)}`)
    }
  }
}

// 3) Pause handoffs
const resumes = new Map() // arcId -> {file, headline}
const arcsDir = join(root, 'arcs')
if (existsSync(arcsDir)) {
  for (const f of readdirSync(arcsDir).filter((f) => f.endsWith('-RESUME.md'))) {
    const id = f.replace(/-RESUME\.md$/, '')
    const headline = readFileSync(join(arcsDir, f), 'utf8').split('\n')[0].replace(/^#\s*/, '')
    resumes.set(id, { file: `roadmap/arcs/${f}`, headline })
  }
}

// 4) Per-arc phase progress, derived from the phase files themselves (the cheap
//    greps discovery uses). Positions are NEVER hand-written anywhere — this is
//    the single source for "how far along is arc X". An isolated-worktree arc's
//    statuses live on ITS branch, so progress is scanned from the arc's OWN
//    worktree when one is registered — never from the coordinating tree alone.
const scanCache = new Map() // phasesDir -> {inProgress, progress}
const scanProgress = (phasesDir) => {
  if (scanCache.has(phasesDir)) return scanCache.get(phasesDir)
  const inProgress = new Map() // arcId|'?' -> [phase numbers]
  const progress = new Map() // arcId -> {done, inprog, backlog, total, next[]}
  const out = { inProgress, progress }
  scanCache.set(phasesDir, out)
  if (!existsSync(phasesDir)) return out
  for (const f of readdirSync(phasesDir).filter((f) => f.endsWith('.phase.ts'))) {
    const src = readFileSync(join(phasesDir, f), 'utf8')
    const status = src.match(/status:\s*'([a-z-]+)'/)?.[1]
    if (!status) continue
    const num = src.match(/(?:^|[{,])\s*phase:\s*(\d+)\s*,/m)?.[1] ?? f.match(/phase-(\d+)/)?.[1]
    const arc = src.match(/arcId:\s*'([^']+)'/)?.[1]
    if (arc) {
      const p = progress.get(arc) ?? { done: 0, inprog: 0, backlog: 0, total: 0, next: [] }
      p.total++
      if (status === 'done' || status === 'historical') p.done++
      else if (status === 'in-progress') { p.inprog++; p.next.unshift(num) }
      else { p.backlog++; p.next.push(num) }
      progress.set(arc, p)
    }
    if (status === 'in-progress') {
      const key = arc ?? '?'
      inProgress.set(key, [...(inProgress.get(key) ?? []), num])
    }
  }
  return out
}
const local = scanProgress(join(root, 'phases'))
const inProgress = local.inProgress
const progressTxt = (id, worktree) => {
  // Prefer the arc's own tree when it has one — its statuses are authoritative.
  const dir = worktree && existsSync(join(worktree, 'roadmap', 'phases'))
    ? join(worktree, 'roadmap', 'phases')
    : join(root, 'phases')
  const p = scanProgress(dir).progress.get(id)
  if (!p) return ''
  const next = p.done === p.total ? 'all phases done → sweep/validate/land' : `next: ${p.next.slice(0, 3).join(', ')}`
  return `${p.done}/${p.total} done${p.inprog ? ` (${p.inprog} in-progress)` : ''} · ${next}`
}

// 5) Compose the lane table
const ageOf = (wt) => {
  const epoch = Number(git(['log', '-1', '--format=%ct'], wt))
  if (!epoch) return { txt: '?', stale: false }
  const h = (Date.now() / 1000 - epoch) / 3600
  return { txt: h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`, stale: h > 24 }
}

// Beacon-first liveness — the STALE? flag on commit-age alone false-positives on any
// arc inside a long multi-agent gate (legitimately commit-quiet for an hour+). When
// the executor beacon (<ID>-executor.jsonl, phase 1368) exists, staleness reads IT:
// STALLED? only on beacon evidence, never commit age. Thresholds mirror the
// executor-liveness.mjs verdict table (kept in sync by name).
const ALIVE_MAX_MIN = 20
const GATE_QUIET_MAX_MIN = 45
const WORK_EVENTS = new Set(['gate-stage-start', 'task-start', 'background-run'])
const fmtMin = (m) => (m < 60 ? `${Math.round(m)}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`)
const beaconOf = (arcId) => {
  const p = join(buildingDir, `${arcId}-executor.jsonl`)
  if (!existsSync(p)) return null
  let lines
  try {
    lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return null // an I/O error must degrade to the commit-age fallback, never crash the whole board
  }
  if (lines.length === 0) return null
  try {
    const last = JSON.parse(lines[lines.length - 1])
    return { ageMin: (Date.now() - Date.parse(last.ts)) / 60000, event: last.event }
  } catch {
    return null
  }
}
const livenessOf = (arcId, wt) => {
  const b = beaconOf(arcId)
  if (b) {
    const alive = b.ageMin < ALIVE_MAX_MIN
    const quiet = b.ageMin < GATE_QUIET_MAX_MIN && WORK_EVENTS.has(b.event)
    const stalled = !alive && !quiet
    return { txt: `${fmtMin(b.ageMin)} beacon (${b.event})`, stale: stalled, flag: stalled ? 'STALLED?' : '' }
  }
  const a = ageOf(wt)
  return { txt: `${a.txt} (pre-beacon)`, stale: a.stale, flag: a.stale ? 'STALE?' : '' }
}

const rows = []
const seen = new Set()
for (const [id, s] of sidecars) {
  seen.add(id)
  const wt = resolve(s.worktree ?? '')
  const gone = !worktrees.has(wt)
  const age = gone ? { txt: '-', stale: false, flag: '' } : livenessOf(id, wt)
  const flags = [gone && 'WORKTREE GONE', age.flag].filter(Boolean).join(' ')
  rows.push({
    arc: id,
    state: s.paused ? 'PAUSED' : 'BUILDING',
    where: `${s.worktree}${s.branch ? ` @ ${s.branch}` : ''}`,
    age: age.txt,
    note: [progressTxt(id, gone ? undefined : wt), s.note, resumes.get(id) && `resume: ${resumes.get(id).file}`, flags]
      .filter(Boolean)
      .join(' · '),
  })
}
for (const [id, r] of resumes) {
  if (seen.has(id)) continue
  seen.add(id)
  rows.push({ arc: id, state: 'PAUSED', where: '(no sidecar — see resume file)', age: '-', note: [progressTxt(id), `resume: ${r.file}`].filter(Boolean).join(' · ') })
}
for (const [arc, phases] of inProgress) {
  if (seen.has(arc)) continue
  rows.push({
    arc,
    state: 'IN-FLIGHT',
    where: '(UNREGISTERED — pre-v0.11 build or skipped Step 3b; likely the MAIN checkout)',
    age: '-',
    note: [progressTxt(arc), `in-progress: ${phases.join(', ')}`].filter(Boolean).join(' · '),
  })
}

console.log(`arc-status — derived ${new Date().toISOString()} (repo ${repo})\n`)
if (rows.length === 0) console.log('No arcs building, paused, or in-flight. All lanes free.')
for (const r of rows.sort((a, b) => a.arc.localeCompare(b.arc))) {
  console.log(`  ${r.arc.padEnd(12)} ${r.state.padEnd(10)} ${r.where}`)
  console.log(`  ${''.padEnd(12)} activity: ${r.age}${r.note ? ` · ${r.note}` : ''}`)
}
const inProgressRegistered = [...inProgress.entries()].filter(([a]) => seen.has(a) || a === '?')
for (const [arc, phases] of inProgressRegistered) {
  if (arc === '?') console.log(`\n  ⚠ in-progress phase(s) with NO arcId: ${phases.join(', ')}`)
}
console.log(`\nOther worktrees on disk (context — may be unrelated to arcs):`)
for (const [path, branch] of worktrees) {
  if (![...sidecars.values()].some((s) => resolve(s.worktree ?? '') === path)) console.log(`  ${path} @ ${branch}`)
}
console.log(`\nDecisions (priorities, release gates): roadmap/backlog.ts header board.`)
