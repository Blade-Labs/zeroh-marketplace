#!/usr/bin/env node
/**
 * audit-checks — the typed-tier half of `roadmap audit` (ROADCODE 1659.2). Runs under
 * the CONSUMER's tsx (invoked by cli/commands/audit.mjs via `npx --no-install tsx`), so
 * it can `import` the consumer's own lib/roadmap/registry.ts — the SAME discoverPhases /
 * discoverArcs / crossValidate the emit gate uses, never a second parser (arc singleSeam).
 *
 * Owns the checks that need typed phase/task/arc data or the reuse seams:
 *   1 dangling phase dependsOn · 2 dependency cycles · 3 backlog→missing phase ·
 *   5 done-phase incomplete tasks · 6 task dependsOn bad IDs · 8 duplicate phase numbers
 *   (active+archive) · 9 missing kind (raw scan + reused suggestKind) · 10 stale backlog
 *   entries · 11 oversized tasks without batchMode · 12.1 archive status · 12.2 archive
 *   version↔dir · 13 limitations disposed pre-archive (WARN) · plus crossValidate()
 *   arc↔phase consistency (verbatim, as a bonus section).
 * Checks 4 (NEEDS CLARIFICATION, needs file:line), 7 (git staleness), and 12.3/12.4
 * (the debt-census join over archived phases) stay in the .mjs orchestrator.
 *
 * Prints ONE JSON object to stdout: { findings: Finding[], aux: {...} }. Findings carry
 * check id + severity + phase + message; aux carries what the .mjs half needs (in-progress
 * phase files for git, backlog phase set for the check-4 escalation, status counts).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
interface Finding {
  check: number | string
  severity: Severity
  phase: number | null
  message: string
  location?: string
}

const repo = process.argv[2] ?? '.'
const roadmap = join(repo, 'roadmap')
const phasesDir = join(roadmap, 'phases')
const archiveDir = join(roadmap, 'archive')
const registryPath = join(repo, 'lib', 'roadmap', 'registry.ts')

if (!existsSync(registryPath)) {
  process.stderr.write(`audit-checks: no consumer registry at ${registryPath}\n`)
  process.exit(4)
}

const { discoverPhases, discoverArcs, crossValidate, DUPLICATE_PHASE_NUMBER_PREFIX } = await import(
  pathToFileURL(registryPath).href
)
const DUP_PREFIX = DUPLICATE_PHASE_NUMBER_PREFIX ?? 'Duplicate phase number'

// suggestKind — the single-source kind backfill (check 9). Imported from the plugin's
// migration audit; main-guarded there so the import does not run the migration report.
const { suggestKind } = await import(pathToFileURL(join(import.meta.dirname, '..', 'scripts', 'migrate', 'audit.ts')).href)

const findings: Finding[] = []
const add = (f: Finding) => findings.push(f)

// ── Discover active + archive ────────────────────────────────────────────────
const { phases: activePhases, errors: activeErrors } = await discoverPhases(phasesDir)
for (const e of activeErrors ?? []) {
  // A duplicate error is surfaced by check 8 (cross-namespace); other discovery
  // failures are a real HIGH — a phase file the roadmap cannot parse.
  if (String(e.error).startsWith(DUP_PREFIX)) continue
  add({ check: 'discovery', severity: 'HIGH', phase: null, message: `${e.file}: ${e.error}` })
}

interface ArchPhase {
  phase: number
  status?: string
  version?: string
  archiveVersion: string
  file: string
}
const archivePhases: ArchPhase[] = []
let archiveExists = false
if (existsSync(archiveDir)) {
  archiveExists = true
  for (const ver of readdirSync(archiveDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const dir = join(archiveDir, ver.name)
    const { phases: vp } = await discoverPhases(dir)
    for (const p of vp) archivePhases.push({ ...p, archiveVersion: ver.name, file: join(dir, `phase-${p.phase}.phase.ts`) })
  }
}

// number → { location, status } across the whole namespace (for existence / dep targets)
const allByNumber = new Map<number, { location: 'active' | 'archive'; status?: string; version?: string }>()
for (const p of activePhases) allByNumber.set(p.phase, { location: 'active', status: p.status })
for (const p of archivePhases) if (!allByNumber.has(p.phase)) allByNumber.set(p.phase, { location: 'archive', status: p.status, version: p.archiveVersion })

// ── Check 1: dangling phase-level dependsOn ──────────────────────────────────
for (const p of activePhases) {
  for (const dep of p.dependsOn ?? []) {
    if (!allByNumber.has(dep)) add({ check: 1, severity: 'CRITICAL', phase: p.phase, message: `Phase ${p.phase} depends on phase ${dep}, which does not exist.` })
  }
}

// ── Check 2: dependency cycles (DFS over active + archive) ────────────────────
{
  const graph = new Map<number, number[]>()
  for (const p of [...activePhases, ...archivePhases]) graph.set(p.phase, (p as any).dependsOn ?? [])
  const WHITE = 0, GREY = 1, BLACK = 2
  const color = new Map<number, number>()
  const stack: number[] = []
  const reported = new Set<string>()
  const dfs = (n: number) => {
    color.set(n, GREY)
    stack.push(n)
    for (const m of graph.get(n) ?? []) {
      if (!graph.has(m)) continue
      const c = color.get(m) ?? WHITE
      if (c === GREY) {
        const i = stack.indexOf(m)
        const cyc = stack.slice(i).concat(m)
        const key = [...cyc].sort((a, b) => a - b).join('-')
        if (!reported.has(key)) {
          reported.add(key)
          add({ check: 2, severity: 'CRITICAL', phase: n, message: `Cycle detected: ${cyc.join(' → ')}.` })
        }
      } else if (c === WHITE) dfs(m)
    }
    stack.pop()
    color.set(n, BLACK)
  }
  for (const n of graph.keys()) if ((color.get(n) ?? WHITE) === WHITE) dfs(n)
}

// ── Backlog (typed import; handles flat + tiered forms) ──────────────────────
const backlogPath = join(roadmap, 'backlog.ts')
let backlogPhases: number[] = []
if (existsSync(backlogPath)) {
  try {
    const mod = await import(pathToFileURL(backlogPath).href)
    const bl = mod.default ?? mod.backlog ?? mod
    const tiers = bl?.tiers ?? (Array.isArray(bl) ? [{ items: bl }] : [])
    backlogPhases = tiers.flatMap((t: any) => (t.items ?? []).map((i: any) => i.phase)).filter((n: any) => typeof n === 'number')
  } catch (e) {
    add({ check: 'discovery', severity: 'HIGH', phase: null, message: `roadmap/backlog.ts failed to load: ${(e as Error).message}` })
  }
}

// ── Check 3: backlog refers to a missing phase ───────────────────────────────
for (const n of backlogPhases) {
  if (!allByNumber.has(n)) add({ check: 3, severity: 'HIGH', phase: n, message: `Backlog queues phase ${n}, but phase-${n}.phase.ts does not exist.` })
}

// ── Check 5: done phases with incomplete tasks (historical exempt) ────────────
for (const p of activePhases) {
  if (p.status !== 'done') continue
  for (const t of p.tasks ?? []) {
    if (t.minimal) continue
    if (t.done !== true) add({ check: 5, severity: 'HIGH', phase: p.phase, message: `Phase ${p.phase} is marked done, but task ${t.id} has done: false.` })
  }
}

// ── Check 6: task-level dependsOn referencing bad IDs ────────────────────────
for (const p of activePhases) {
  const ids = (p.tasks ?? []).map((t: any) => t.id)
  const pos = new Map<string, number>(ids.map((id: string, i: number) => [id, i]))
  ;(p.tasks ?? []).forEach((t: any, i: number) => {
    for (const dep of t.dependsOn ?? []) {
      if (!/^\d+\.\d+/.test(String(dep))) {
        add({ check: 6, severity: 'MEDIUM', phase: p.phase, message: `Phase ${p.phase} task ${t.id} has dependsOn: [${dep}] that looks like a phase number, not a task ID (expected "N.M").` })
      } else if (!pos.has(dep)) {
        add({ check: 6, severity: 'HIGH', phase: p.phase, message: `Phase ${p.phase} task ${t.id} depends on ${dep}, which does not exist in this phase.` })
      } else if ((pos.get(dep) ?? -1) >= i) {
        add({ check: 6, severity: 'HIGH', phase: p.phase, message: `Phase ${p.phase} task ${t.id} depends on ${dep}, which appears later in the task list (forward reference).` })
      }
    }
  })
}

// ── Check 8: duplicate phase numbers across active + archive ──────────────────
{
  const byNum = new Map<number, string[]>()
  for (const p of activePhases) byNum.set(p.phase, [...(byNum.get(p.phase) ?? []), join(phasesDir, `phase-${p.phase}.phase.ts`)])
  for (const p of archivePhases) byNum.set(p.phase, [...(byNum.get(p.phase) ?? []), p.file])
  for (const [num, files] of byNum) {
    if (files.length > 1) add({ check: 8, severity: 'CRITICAL', phase: num, message: `${DUP_PREFIX} ${num} in ${files.length} files: ${files.join(' and ')}. emit will refuse to build the registry until this is resolved.` })
  }
}

// ── Check 9: missing kind (raw scan + reused suggestKind) ─────────────────────
if (existsSync(phasesDir)) {
  for (const f of readdirSync(phasesDir).filter((n) => n.endsWith('.phase.ts')).sort()) {
    const full = join(phasesDir, f)
    const text = readFileSync(full, 'utf8')
    // `kind:` after a brace/comma/whitespace with a quoted value — matches both a
    // one-line object literal and a real multi-line definePhase({ … kind: 'logic' … }).
    if (!/[\s{,]kind\s*:\s*['"]/.test(text)) {
      const num = Number(text.match(/(?:^|[{,])\s*phase:\s*(\d+)/m)?.[1] ?? f.match(/phase-(\d+)/)?.[1] ?? 0)
      add({ check: 9, severity: 'HIGH', phase: num || null, message: `Phase ${num} at ${full} is missing the kind field. Backfill with: ${suggestKind(text)}.`, location: full })
    }
  }
}

// ── Check 10: stale terminal / archived entries in backlog ───────────────────
for (const n of backlogPhases) {
  const rec = allByNumber.get(n)
  if (!rec) continue // check 3 owns non-existence
  if (rec.location === 'archive') add({ check: 10, severity: 'HIGH', phase: n, message: `Backlog queues phase ${n}, but it is archived at roadmap/archive/${rec.version}/. Archived phases are terminal — remove from backlog.` })
  else if (rec.status === 'done') add({ check: 10, severity: 'MEDIUM', phase: n, message: `Backlog queues phase ${n}, but phase-${n}.phase.ts is status: 'done'. Remove the backlog entry.` })
  else if (rec.status === 'cancelled') add({ check: 10, severity: 'LOW', phase: n, message: `Backlog queues phase ${n}, but phase-${n}.phase.ts is status: 'cancelled'. Remove the backlog entry.` })
  else if (rec.status === 'historical') add({ check: 10, severity: 'LOW', phase: n, message: `Backlog queues phase ${n}, but phase-${n}.phase.ts is status: 'historical'. Historical phases are terminal — remove the backlog entry.` })
}

// ── Check 11: oversized tasks without batchMode (done tasks exempt) ───────────
for (const p of activePhases) {
  for (const t of p.tasks ?? []) {
    if (t.minimal || t.done === true || t.batchMode === true) continue
    if ((t.files?.length ?? 0) > 10) add({ check: 11, severity: 'HIGH', phase: p.phase, message: `Phase ${p.phase} task ${t.id} has files.length=${t.files.length} (>10) without batchMode.` })
    if ((t.steps?.length ?? 0) > 6) add({ check: 11, severity: 'HIGH', phase: p.phase, message: `Phase ${p.phase} task ${t.id} has steps.length=${t.steps.length} (>6) without batchMode.` })
  }
}

// ── Check 12.1 / 12.2: archive structural integrity ──────────────────────────
for (const p of archivePhases) {
  if (p.status !== 'done') add({ check: 12, severity: 'CRITICAL', phase: p.phase, message: `Phase ${p.phase} archived at roadmap/archive/${p.archiveVersion}/ has status: '${p.status}' (expected 'done').` })
  if (p.version != null && p.version !== p.archiveVersion) add({ check: 12, severity: 'CRITICAL', phase: p.phase, message: `Phase ${p.phase} at roadmap/archive/${p.archiveVersion}/ has version: '${p.version}' — directory says ${p.archiveVersion}.` })
}

// ── Check 13: limitations disposed pre-archive (release-sweep's walk) ─────────
// A `limitations` census field is by design NOT arc-disposable — release-sweep walks it
// pre-archive. A CLOSING resolution (fixed/dismissed/won't_fix) on a `.limitations` ref of
// an UNARCHIVED phase is the MEASURE 2026-07-17 drift class. WARN (MEDIUM, exit stays 0);
// planned / operator-pending are legitimate open dispositions, NOT findings.
for (const p of activePhases) {
  for (const r of (p as any).debtResolutions ?? []) {
    if (!r.ref?.endsWith('.limitations')) continue
    if (r.status !== 'fixed' && r.status !== 'dismissed' && r.status !== "won't_fix") continue
    add({
      check: 13,
      severity: 'MEDIUM',
      phase: p.phase,
      message: `Phase ${p.phase} disposed ${r.ref} as ${r.status} while UNARCHIVED — limitations disposed pre-archive (release-sweep's walk, not the arc's; MEASURE 2026-07-17 drift class).`,
    })
  }
}

// ── crossValidate() arc↔phase consistency (bonus section, verbatim) ──────────
{
  let arcs: any[] = []
  try {
    const r = await discoverArcs(join(roadmap, 'arcs'))
    arcs = r.arcs ?? []
  } catch {
    /* arcs optional */
  }
  for (const err of crossValidate(activePhases, arcs)) add({ check: 'arc-consistency', severity: 'HIGH', phase: null, message: err })
}

// ── aux for the .mjs orchestrator ─────────────────────────────────────────────
const statusCounts: Record<string, number> = {}
for (const p of activePhases) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1
const aux = {
  phaseCount: activePhases.length,
  statusCounts,
  archiveExists,
  backlogPhases,
  inProgress: activePhases
    .filter((p: any) => p.status === 'in-progress')
    .map((p: any) => ({ phase: p.phase, file: join(phasesDir, `phase-${p.phase}.phase.ts`) })),
}

process.stdout.write(JSON.stringify({ findings, aux }))
