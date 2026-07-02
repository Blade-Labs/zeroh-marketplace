#!/usr/bin/env node
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
 *   - STALE? — a registered worktree whose HEAD hasn't moved in >24h
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

const rows = []
const seen = new Set()
for (const [id, s] of sidecars) {
  seen.add(id)
  const wt = resolve(s.worktree ?? '')
  const gone = !worktrees.has(wt)
  const age = gone ? { txt: '-', stale: false } : ageOf(wt)
  const flags = [gone && 'WORKTREE GONE', age.stale && 'STALE?'].filter(Boolean).join(' ')
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
  console.log(`  ${''.padEnd(12)} last commit: ${r.age}${r.note ? ` · ${r.note}` : ''}`)
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
