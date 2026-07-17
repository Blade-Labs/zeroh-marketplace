/**
 * roadmap status [roadmap-root] [--json] — the LIVE multi-session lane table.
 * A function-by-function PORT of scripts/arc-status.mjs (ROADCODE §8 risk 5: a wrong
 * derivation mis-sequences a live arc, so this ports the battle-tested ladder rather
 * than reimplementing it). The human output stays BYTE-COMPATIBLE with the old script
 * so the status-parity test can diff them; --json is a new, additive machine shape.
 *
 * The shared substrate does the reading: phasescan.scanProgress (the progress fold),
 * beacon.lastEvent WITHOUT a worktree (main-registry-only, matching legacy beaconOf
 * :143-145 — the dual-dir scan is watch territory and would break parity here), and
 * the exported liveness thresholds.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { scanProgress } from '../lib/phasescan.mjs'
import { arcProgress } from '../lib/derive.mjs'
import { lastEvent, ALIVE_MAX_MIN, GATE_QUIET_MAX_MIN, WORK_EVENTS } from '../lib/beacon.mjs'

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, timeout: 15_000 }).toString().trim()
  } catch {
    return ''
  }
}

const fmtMin = (m) => (m < 60 ? `${Math.round(m)}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`)

function derive(root) {
  const derivedAt = new Date().toISOString()

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
  const unreadableSidecars = []
  if (existsSync(buildingDir)) {
    for (const f of readdirSync(buildingDir).filter((f) => f.endsWith('.json'))) {
      try {
        const s = JSON.parse(readFileSync(join(buildingDir, f), 'utf8'))
        if (s?.arcId) sidecars.set(String(s.arcId), s)
      } catch {
        unreadableSidecars.push(`unreadable sidecar: ${join(buildingDir, f)}`)
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

  // 4) Per-arc phase progress (worktree-preferred). The projection lives in derive.mjs
  //    (arcProgress) so status and `arc next` share ONE lane-state reader (singleSeam 2);
  //    scanProgress here supplies only the in-progress map for the IN-FLIGHT rows.
  const local = scanProgress(join(root, 'phases'))
  const inProgress = local.inProgress
  const progressTxt = (id, worktree) => {
    const dir =
      worktree && existsSync(join(worktree, 'roadmap', 'phases'))
        ? join(worktree, 'roadmap', 'phases')
        : join(root, 'phases')
    const p = arcProgress(dir, id)
    if (!p) return ''
    const next = p.allDone ? 'all phases done → sweep/validate/land' : `next: ${p.next.join(', ')}`
    return `${p.done}/${p.total} done${p.inprog ? ` (${p.inprog} in-progress)` : ''} · ${next}`
  }

  // 5) Liveness — beacon-first, main-registry-only (parity with legacy beaconOf).
  const ageOf = (wt) => {
    const epoch = Number(git(['log', '-1', '--format=%ct'], wt))
    if (!epoch) return { txt: '?', stale: false }
    const h = (Date.now() / 1000 - epoch) / 3600
    return { txt: h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`, stale: h > 24 }
  }
  const livenessOf = (arcId, wt) => {
    const b = lastEvent(arcId, { mainRoot: root })
    if (b) {
      const alive = b.ageMin < ALIVE_MAX_MIN
      const quiet = b.ageMin < GATE_QUIET_MAX_MIN && WORK_EVENTS.has(b.event)
      const stalled = !alive && !quiet
      return { txt: `${fmtMin(b.ageMin)} beacon (${b.event})`, stale: stalled, flag: stalled ? 'STALLED?' : '' }
    }
    const a = ageOf(wt)
    return { txt: `${a.txt} (pre-beacon)`, stale: a.stale, flag: a.stale ? 'STALE?' : '' }
  }

  // 6) Compose the lane table
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
    rows.push({
      arc: id,
      state: 'PAUSED',
      where: '(no sidecar — see resume file)',
      age: '-',
      note: [progressTxt(id), `resume: ${r.file}`].filter(Boolean).join(' · '),
    })
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

  const noArcId = []
  const inProgressRegistered = [...inProgress.entries()].filter(([a]) => seen.has(a) || a === '?')
  for (const [arc, phases] of inProgressRegistered) {
    if (arc === '?') noArcId.push(...phases)
  }

  const otherWorktrees = []
  for (const [path, branch] of worktrees) {
    if (![...sidecars.values()].some((s) => resolve(s.worktree ?? '') === path)) {
      otherWorktrees.push({ path, branch })
    }
  }

  return { derivedAt, repo, rows: rows.sort((a, b) => a.arc.localeCompare(b.arc)), otherWorktrees, noArcId, unreadableSidecars }
}

function printHuman(m) {
  for (const w of m.unreadableSidecars) process.stderr.write(`  ⚠ ${w}\n`)
  const out = []
  out.push(`arc-status — derived ${m.derivedAt} (repo ${m.repo})\n`)
  if (m.rows.length === 0) out.push('No arcs building, paused, or in-flight. All lanes free.')
  for (const r of m.rows) {
    out.push(`  ${r.arc.padEnd(12)} ${r.state.padEnd(10)} ${r.where}`)
    out.push(`  ${''.padEnd(12)} activity: ${r.age}${r.note ? ` · ${r.note}` : ''}`)
  }
  if (m.noArcId.length) out.push(`\n  ⚠ in-progress phase(s) with NO arcId: ${m.noArcId.join(', ')}`)
  out.push(`\nOther worktrees on disk (context — may be unrelated to arcs):`)
  for (const { path, branch } of m.otherWorktrees) out.push(`  ${path} @ ${branch}`)
  out.push(`\nDecisions (priorities, release gates): roadmap/backlog.ts header board.`)
  process.stdout.write(out.join('\n') + '\n')
}

export default async function run(argv) {
  const json = argv.includes('--json')
  const root = resolve(argv.find((a) => !a.startsWith('--')) ?? 'roadmap')
  if (!existsSync(join(root, 'phases'))) {
    process.stderr.write(`arc-status: no roadmap at ${root} (pass the roadmap root as arg)\n`)
    return 1
  }
  const model = derive(root)
  if (json) {
    const warnings = [
      ...model.unreadableSidecars,
      ...(model.noArcId.length ? [`in-progress phase(s) with NO arcId: ${model.noArcId.join(', ')}`] : []),
    ]
    process.stdout.write(
      JSON.stringify(
        { derivedAt: model.derivedAt, repo: model.repo, rows: model.rows, otherWorktrees: model.otherWorktrees, warnings },
        null,
        2,
      ) + '\n',
    )
    return 0
  }
  printHuman(model)
  return 0
}
