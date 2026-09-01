/**
 * roadmap status [roadmap-root] [--json] — the LIVE multi-session lane table.
 * A function-by-function PORT of scripts/arc-status.mjs (ROADCODE §8 risk 5: a wrong
 * derivation mis-sequences a live arc, so this ports the battle-tested ladder rather
 * than reimplementing it). The human output stays BYTE-COMPATIBLE with the old script
 * so the status-parity test can diff them; --json is a new, additive machine shape.
 *
 * Two ADDITIVE divergences from the legacy oracle, both absent whenever their condition is, so
 * the parity estates still diff byte-identical: the post-merge-watch RED banner (postMergeRedLine
 * — the parity estates are never a git repo with a red marker) and the stray-lane count line
 * (surveyLanes — the parity estates carry no lane worktrees).
 *
 * The shared substrate does the reading: phasescan.scanProgress (the progress fold),
 * beacon.lastEvent WITHOUT a worktree (main-registry-only, matching legacy beaconOf
 * :143-145 — the dual-dir scan is watch territory and would break parity here), and
 * the exported liveness thresholds.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { scanProgress, scanPhaseFile } from '../lib/phasescan.mjs'
import { arcProgress } from '../lib/derive.mjs'
import { lastEvent, ALIVE_MAX_MIN, GATE_QUIET_MAX_MIN, WORK_EVENTS } from '../lib/beacon.mjs'
import { staleArms } from '../lib/executor-arm.mjs'
import { surveyLanes } from '../lib/worktree.mjs'

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, timeout: 15_000 }).toString().trim()
  } catch {
    return ''
  }
}

const fmtMin = (m) => (m < 60 ? `${Math.round(m)}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`)

/**
 * Read the consumer's async post-merge sweep marker and return ONE bounded banner
 * line iff it reports RED — the coordinator's "what next" flow sees the async red
 * alongside lane state. Resolution mirrors the consumer watcher's --hook rule
 * (post-merge-watch.mjs): `git rev-parse --git-common-dir` → its parent is the MAIN
 * checkout, so a linked-worktree session reads the main checkout's .test-logs.
 * READ-ONLY, never a second writer. Absent / green / running / unparseable marker,
 * or a non-repo root → null (zero output change).
 */
function postMergeRedLine(root) {
  const common = git(['rev-parse', '--git-common-dir'], root)
  if (!common) return null
  const marker = join(dirname(resolve(root, common)), '.test-logs', 'post-merge-status.json')
  try {
    const m = JSON.parse(readFileSync(marker, 'utf8'))
    if (!m || typeof m !== 'object' || m.result !== 'red') return null
    const sha7 = String(m.sha ?? '').slice(0, 7) || '?'
    const headline = String(m.headline ?? '').replace(/\s+/g, ' ').slice(0, 200) || '(no headline)'
    return `post-merge-watch RED @ ${sha7} (${m.finishedAt ?? '?'}): ${headline}`
  } catch {
    return null // absent or unparseable — the marker is advisory, never an error
  }
}

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

  // 2) Build registrations — deliberately NOT sidecar.listSidecars(): that reader silently
  // skips a corrupt sidecar and derives the main checkout from cwd, while status must
  // REPORT unreadable sidecars (parity with the legacy script) and honor an explicit
  // [roadmap-root] argument.
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
  const progressOf = (id, worktree) => {
    const dir =
      worktree && existsSync(join(worktree, 'roadmap', 'phases'))
        ? join(worktree, 'roadmap', 'phases')
        : join(root, 'phases')
    return arcProgress(dir, id)
  }
  const progressTxt = (id, worktree) => {
    const p = progressOf(id, worktree)
    if (!p) return ''
    const next = p.allDone ? 'all phases done → sweep/validate/land' : `next: ${p.next.join(', ')}`
    return `${p.done}/${p.total} done${p.inprog ? ` (${p.inprog} in-progress)` : ''} · ${next}`
  }
  const evalMissingOf = (id, worktree) => {
    if (!progressOf(id, worktree)?.allDone) return false
    const evals = join(root, 'arc-evals')
    if (!existsSync(evals)) return true
    const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const datedReport = new RegExp(`^${escaped}-\\d{4}-\\d{2}-\\d{2}\\.json$`)
    return !readdirSync(evals).some((file) => datedReport.test(file))
  }

  // 5) Liveness — beacon-first, main-registry-only (parity with legacy beaconOf).
  const ageOf = (wt) => {
    const epoch = Number(git(['log', '-1', '--format=%ct'], wt))
    if (!epoch) return { txt: '?', stale: false }
    const h = (Date.now() / 1000 - epoch) / 3600
    return { txt: h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`, stale: h > 24 }
  }
  // 5b) Advisory divergence + stale-arm detection (1737.3; display-only, never exit codes).
  //  DIVERGED? = the 1702 class: a member phase file still status 'backlog' while carrying
  //  done:true tasks (regex tier — advisory precision is the deliberate trade).
  //  STALE-ARM = a leaked .building/<N>-executor.armed per executor-arm.staleArms.
  const divergedOf = (arcId, phasesDir) => {
    const out = []
    if (!existsSync(phasesDir)) return out
    for (const f of readdirSync(phasesDir).filter((f) => f.endsWith('.phase.ts'))) {
      const p = join(phasesDir, f)
      const r = scanPhaseFile(p)
      if (!r || String(r.arcId) !== String(arcId) || r.status !== 'backlog') continue
      try {
        if (/\bdone:\s*true\b/.test(readFileSync(p, 'utf8'))) out.push(r.phase)
      } catch {
        /* unreadable → skip (advisory) */
      }
    }
    return out
  }
  const staleArmsOf = (wt) => {
    try {
      return staleArms(wt, join(wt, 'roadmap', 'phases')).map((s) => s.file)
    } catch {
      return []
    }
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
    const lanePhases = gone || !existsSync(join(wt, 'roadmap', 'phases')) ? join(root, 'phases') : join(wt, 'roadmap', 'phases')
    const diverged = divergedOf(id, lanePhases)
    const armFiles = gone ? [] : staleArmsOf(wt)
    const evalMissing = evalMissingOf(id, gone ? undefined : wt)
    const flags = [
      gone && 'WORKTREE GONE',
      age.flag,
      diverged.length && `DIVERGED? (phase ${diverged.join(', ')} has done tasks under status backlog)`,
      armFiles.length && `STALE-ARM (${armFiles.join(', ')})`,
    ]
      .filter(Boolean)
      .join(' ')
    rows.push({
      arc: id,
      state: s.paused ? 'PAUSED' : 'BUILDING',
      where: `${s.worktree}${s.branch ? ` @ ${s.branch}` : ''}`,
      age: age.txt,
      ...(diverged.length ? { diverged } : {}),
      ...(armFiles.length ? { staleArms: armFiles } : {}),
      ...(evalMissing ? { evalMissing: true } : {}),
      note: [progressTxt(id, gone ? undefined : wt), evalMissing && 'eval: none', s.note, resumes.get(id) && `resume: ${resumes.get(id).file}`, flags]
        .filter(Boolean)
        .join(' · '),
    })
  }
  for (const [id, r] of resumes) {
    if (seen.has(id)) continue
    seen.add(id)
    const evalMissing = evalMissingOf(id)
    rows.push({
      arc: id,
      state: 'PAUSED',
      where: '(no sidecar — see resume file)',
      age: '-',
      ...(evalMissing ? { evalMissing: true } : {}),
      note: [progressTxt(id), evalMissing && 'eval: none', `resume: ${r.file}`].filter(Boolean).join(' · '),
    })
  }
  for (const [arc, phases] of inProgress) {
    if (seen.has(arc)) continue
    const evalMissing = evalMissingOf(arc)
    rows.push({
      arc,
      state: 'IN-FLIGHT',
      where: '(UNREGISTERED — pre-v0.11 build or skipped Step 3b; likely the MAIN checkout)',
      age: '-',
      ...(evalMissing ? { evalMissing: true } : {}),
      note: [progressTxt(arc), evalMissing && 'eval: none', `in-progress: ${phases.join(', ')}`].filter(Boolean).join(' · '),
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

  // 7) The async post-merge sweep marker (read-only; null in the common case)
  const postMergeRed = postMergeRedLine(root)

  // 8) Stray lane worktrees — the count only, from the ONE classifier (surveyLanes). status is
  // the command every protocol entry already runs, so it is the automatic surfacing seam for lane
  // trees that outlived their run; the per-lane class and remedy stay with `roadmap
  // audit` check 15, which this line points at rather than restating. The pre-existing porcelain
  // parse at (1) is sidecar correlation and predates the seam — this appends, it does not fork it.
  // ZERO is silence, not a zero: the human table is parity-pinned byte-compatible with the legacy
  // scripts/arc-status.mjs, so a lanes-free estate must see no output change at all (the
  // postMergeRedLine precedent — the additive divergence is absent whenever the condition is).
  let strayLanes = 0
  let strayError = null
  if (existsSync(join(repo, '.git'))) {
    try {
      strayLanes = surveyLanes(repo).filter((l) => l.class !== 'live').length
    } catch (e) {
      // Advisory, exactly like the marker above: status never FAILS on a survey. But it never goes
      // quiet either — surveyLanes deliberately lets its enumeration throw because "reporting an
      // empty inventory would be the silent all-clear this whole seam exists to stop", and status is
      // the command every protocol entry runs, so a swallowed failure here is the widest-reach
      // version of exactly that. It travels on BOTH surfaces, like every other advisory in this
      // file (unreadableSidecars, noArcId, postMergeRed): stderr for the human, `warnings` for the
      // machine — a --json consumer reading `warnings: []` is the same silent all-clear.
      strayLanes = 0
      strayError = `stray lane worktrees could not be surveyed in ${repo} — ${e.message}`
    }
  }

  return { derivedAt, repo, rows: rows.sort((a, b) => a.arc.localeCompare(b.arc)), otherWorktrees, noArcId, unreadableSidecars, postMergeRed, strayLanes, strayError }
}

function printHuman(m) {
  for (const w of m.unreadableSidecars) process.stderr.write(`  ⚠ ${w}\n`)
  if (m.strayError) process.stderr.write(`  ⚠ ${m.strayError}\n`)
  const out = []
  out.push(`arc-status — derived ${m.derivedAt} (repo ${m.repo})\n`)
  if (m.postMergeRed) out.push(`  ⚠ ${m.postMergeRed}\n`)
  if (m.rows.length === 0) out.push('No arcs building, paused, or in-flight. All lanes free.')
  for (const r of m.rows) {
    out.push(`  ${r.arc.padEnd(12)} ${r.state.padEnd(10)} ${r.where}`)
    out.push(`  ${''.padEnd(12)} activity: ${r.age}${r.note ? ` · ${r.note}` : ''}`)
  }
  if (m.noArcId.length) out.push(`\n  ⚠ in-progress phase(s) with NO arcId: ${m.noArcId.join(', ')}`)
  if (m.strayLanes > 0) out.push(`\n  strays: ${m.strayLanes} lane worktree(s) past their done-moment — run \`roadmap audit\` for each remedy`)
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
      ...(model.postMergeRed ? [model.postMergeRed] : []),
      ...(model.strayError ? [model.strayError] : []),
    ]
    // Box capacity rides the --json machine shape ONLY (phase 11) — the human table is
    // parity-pinned byte-compatible and never carries it.
    const { probeCapacity, defaultProbes, seamProbes, SeamError, consumerCapacityConfig } =
      await import('../lib/capacity.mjs')
    let capacity
    try {
      capacity = probeCapacity(consumerCapacityConfig(process.cwd()), seamProbes() ?? defaultProbes)
    } catch (e) {
      if (e instanceof SeamError) {
        process.stderr.write(`roadmap status: ${e.message}\n`)
        return 1
      }
      throw e
    }
    process.stdout.write(
      JSON.stringify(
        {
          derivedAt: model.derivedAt,
          repo: model.repo,
          rows: model.rows,
          otherWorktrees: model.otherWorktrees,
          warnings,
          capacity,
          // Present only when there ARE strays: an always-present 0 would read as a measurement
          // taken in a consumer where the survey never ran (no git, a failed enumeration).
          ...(model.strayLanes > 0 ? { strayLanes: model.strayLanes } : {}),
        },
        null,
        2,
      ) + '\n',
    )
    return 0
  }
  printHuman(model)
  return 0
}
