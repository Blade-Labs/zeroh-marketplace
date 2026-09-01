#!/usr/bin/env node
/**
 * debt-census — the whole-estate open-debt ledger, derived (never hand-written).
 *
 * Joins the two machine homes of debt across EVERY phase file:
 *   - tasks[].transparencyReport.{compromises,hardcoded,skipped,limitations} with substantive debt
 *     (the immutable per-task audit — debt CONTENT)
 *   - phase.debtResolutions[] (debt RESOLUTION; absence of a matching ref = OPEN)
 * plus a lightweight open-marker scan of roadmap/followups/*.md (arc-sweep's
 * disposition home, which nothing previously joined back).
 *
 * Classification per debt entry (the release-sweep / 1371 follow-up contract):
 *   OPEN              — no debtResolutions ref matches
 *   OPEN-planned      — status 'planned'; open until its via-phase is done. When the
 *                       note names a phase that IS done, reported as RESOLVABLE
 *                       (a cheap close: re-dispose as fixed with the phase ref).
 *   OPEN-operator     — status 'operator-pending'; open until disposed post-deploy
 *   CLOSED            — 'fixed' | "won't_fix" | 'dismissed' (counted, not listed)
 * Dangling resolutions (a ref with no matching debt field) are a hygiene
 * finding — they usually mean a task was renumbered after the sweep.
 *
 * Parsing: imports the CONSUMER's lib/roadmap/registry.ts (the same
 * discoverPhases/discoverArcs the emit gate uses) — never a second regex parser,
 * so the census can't disagree with the roadmap's own validation.
 *
 * Usage (from the consumer repo, which provides tsx):
 *   node --import tsx <plugin>/scripts/debt-census.ts [repo-root] [--json <out.json>] [--md <out.md>] [--check]
 * Default repo-root: cwd. With no --json/--md, prints the summary + writes
 * reviews/debt-census.json under the repo root.
 *
 * --check — the DEBT RATCHET: compares the fresh census against the committed
 * ceiling at reviews/debt-ceiling.json ({ maxOpen, maxOpenOperator, maxDangling,
 * ratifiedAt, ratifiedBy }) and exits non-zero when any figure RISES above it.
 * New debt is fine (arc-sweep disposes it at merge); new UNDISPOSITIONED debt
 * accumulating past the ceiling is not. When the census comes in BELOW the
 * ceiling, it prints a reminder to ratchet the ceiling down (never auto-lowers —
 * the ceiling is user-ratified).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isExplanatoryEmpty } from '../cli/lib/transparency.mjs'

const args = process.argv.slice(2)
const positional = args.filter((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const repo = resolve(positional[0] ?? '.')
const roadmap = join(repo, 'roadmap')
const registryPath = join(repo, 'lib/roadmap/registry.ts')
if (!existsSync(registryPath)) {
  console.error(`debt-census: no registry at ${registryPath} (run from a scaffolded consumer repo, or pass its root)`)
  process.exit(1)
}

const { discoverPhases, discoverArcs } = await import(pathToFileURL(registryPath).href)
const { phases, errors } = await discoverPhases(join(roadmap, 'phases'))
const { arcs } = await discoverArcs(join(roadmap, 'arcs')).catch(() => ({ arcs: [] }))
if (errors?.length) console.error(`  ⚠ ${errors.length} phase file(s) failed discovery (quarantined by the registry) — census covers the parseable set`)

const DEBT_FIELDS = ['compromises', 'hardcoded', 'skipped', 'limitations'] as const
const CLOSING = new Set(['fixed', "won't_fix", 'dismissed'])

type Entry = {
  phase: number
  phaseStatus: string
  arcId: string | number | null
  version: string | null
  ref: string
  field: string
  state: 'OPEN' | 'OPEN-planned' | 'OPEN-operator' | 'RESOLVABLE'
  note: string | null
  text: string
  archiveVersion?: string
}

// The ONE transparencyReport↔debtResolutions join (the 1371 follow-up contract),
// extracted so it runs verbatim over both the active set and — opt-in — the archive
// set. `lookupById` resolves an OPEN-planned entry's `via: phase-N` to decide
// RESOLVABLE; the caller passes the phase universe the via-ref may point into.
function censusOf(phaseList: any[], lookupById: Map<number, any>) {
  const entries: Entry[] = []
  const dangling: string[] = []
  let closedCount = 0
  let excludedCount = 0
  for (const p of phaseList) {
    const resolutions = new Map<string, any>()
    for (const r of p.debtResolutions ?? []) resolutions.set(r.ref, r) // latest disposition wins (one ref)

    const seenRefs = new Set<string>()
    const excludedRefs = new Set<string>()
    for (const t of p.tasks ?? []) {
      if (t.minimal || !t.transparencyReport) continue
      for (const f of DEBT_FIELDS) {
        const v = t.transparencyReport[f]
        const ref = `${t.id}.${f}`
        if (!v) continue
        if (isExplanatoryEmpty(String(v))) {
          excludedRefs.add(ref)
          excludedCount++
          continue
        }
        seenRefs.add(ref)
        const r = resolutions.get(ref)
        if (r && CLOSING.has(r.status)) {
          closedCount++
          continue
        }
        let state: Entry['state'] = 'OPEN'
        let note: string | null = null
        if (r?.status === 'planned') {
          state = 'OPEN-planned'
          note = r.via ?? null
          const via = /phase[- ](\d+)/i.exec(r.via ?? '')?.[1]
          const viaPhase = via ? lookupById.get(Number(via)) : undefined
          if (viaPhase && ['done', 'historical'].includes(viaPhase.status)) state = 'RESOLVABLE'
        } else if (r?.status === 'operator-pending') {
          state = 'OPEN-operator'
          note = r.via ?? null
        }
        entries.push({
          phase: p.phase,
          phaseStatus: p.status,
          arcId: p.arcId ?? null,
          version: p.version ?? null,
          ref,
          field: f,
          state,
          note,
          text: String(v).replace(/\s+/g, ' ').slice(0, 240),
          ...(p.archiveVersion ? { archiveVersion: p.archiveVersion } : {}),
        })
      }
    }
    for (const ref of resolutions.keys()) {
      if (seenRefs.has(ref)) continue
      dangling.push(
        excludedRefs.has(ref)
          ? `phase ${p.phase}: ${ref} (matching field was excluded as explanatory-empty)`
          : `phase ${p.phase}: ${ref} (resolution with no matching debt field)`,
      )
    }
  }
  entries.sort((a, b) => a.phase - b.phase || a.ref.localeCompare(b.ref))
  return { entries, dangling, closedCount, excludedCount }
}

const phaseById = new Map<number, any>(phases.map((p: any) => [p.phase, p]))
const active = censusOf(phases, phaseById)
const entries = active.entries
const dangling = active.dangling
const closedCount = active.closedCount

// Opt-in archive pass (roadmap audit check 12.3-12.4). Default OFF: the active
// census, its byArc/MD/console output, and the --check debt ratchet are all
// untouched. Emitted as an ADDITIVE census.archive block, never merged into the
// active totals. Filter is archive LOCATION (files under roadmap/archive/<v>/),
// never the version field (active phases may carry a version too).
let archive: { entries: Entry[]; dangling: string[] } | null = null
if (args.includes('--include-archive')) {
  const archiveRoot = join(roadmap, 'archive')
  const archivePhases: any[] = []
  if (existsSync(archiveRoot)) {
    for (const ver of readdirSync(archiveRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const { phases: vp } = await discoverPhases(join(archiveRoot, ver.name))
      for (const p of vp) archivePhases.push({ ...p, archiveVersion: ver.name, location: 'archive' })
    }
  }
  // via-refs may point at active phases, so resolve RESOLVABLE over active+archive.
  const combinedById = new Map<number, any>([...phases, ...archivePhases].map((p: any) => [p.phase, p]))
  const a = censusOf(archivePhases, combinedById)
  archive = { entries: a.entries, dangling: a.dangling }
}

// followups open-marker scan (heuristic, per-file counts — a join hint, not a parse)
const followupsDir = join(roadmap, 'followups')
const followups: { file: string; openMarkers: number; lines: string[] }[] = []
if (existsSync(followupsDir)) {
  for (const f of readdirSync(followupsDir).filter((f) => f.endsWith('.md')).sort()) {
    const body = readFileSync(join(followupsDir, f), 'utf8')
    const lines = body
      .split('\n')
      .filter((l) => /(^|\s)(- \[ \]|OPEN\b|OPERATOR-PENDING|TODO\b|PENDING\b)/.test(l) && !/CLOSED|DONE|RESOLVED|SHIPPED/i.test(l))
    if (lines.length) followups.push({ file: `roadmap/followups/${f}`, openMarkers: lines.length, lines: lines.slice(0, 20).map((l) => l.trim().slice(0, 160)) })
  }
}

entries.sort((a, b) => a.phase - b.phase || a.ref.localeCompare(b.ref))
const byState = (s: Entry['state']) => entries.filter((e) => e.state === s)
const byArc = new Map<string, number>()
for (const e of entries) byArc.set(String(e.arcId ?? '(no arc)'), (byArc.get(String(e.arcId ?? '(no arc)')) ?? 0) + 1)

const census = {
  measuredAt: null as string | null, // stamped by the caller if wanted — kept null for determinism
  repo,
  phasesScanned: phases.length,
  discoveryErrors: errors?.length ?? 0,
  arcs: arcs?.length ?? 0,
  totals: {
    open: byState('OPEN').length,
    openPlanned: byState('OPEN-planned').length,
    openOperator: byState('OPEN-operator').length,
    resolvable: byState('RESOLVABLE').length,
    closed: closedCount,
    excludedExplanatoryEmpty: active.excludedCount,
    danglingResolutions: dangling.length,
    followupFilesWithOpenMarkers: followups.length,
    followupOpenMarkerLines: followups.reduce((s, f) => s + f.openMarkers, 0),
  },
  byArc: Object.fromEntries([...byArc.entries()].sort((a, b) => b[1] - a[1])),
  entries,
  dangling,
  followups,
  archive, // null unless --include-archive; additive, never folded into totals/ratchet
}

const jsonOut = flag('json') ?? join(repo, 'reviews/debt-census.json')
mkdirSync(dirname(jsonOut), { recursive: true })
writeFileSync(jsonOut, JSON.stringify(census, null, 2) + '\n')

const mdOut = flag('md')
if (mdOut) {
  const md = [
    '# Debt census (derived — do not hand-edit; re-run debt-census.ts)',
    '',
    `Phases scanned: ${census.phasesScanned} · open ${census.totals.open} · planned ${census.totals.openPlanned} · operator ${census.totals.openOperator} · resolvable ${census.totals.resolvable} · closed ${census.totals.closed}`,
    '',
    '| phase | status | arc | ref | state | text |',
    '|---|---|---|---|---|---|',
    ...entries.map((e) => `| ${e.phase} | ${e.phaseStatus} | ${e.arcId ?? ''} | ${e.ref} | ${e.state} | ${e.text.replace(/\|/g, '\\|')} |`),
  ].join('\n')
  writeFileSync(mdOut, md + '\n')
}

const t = census.totals
console.log(`debt-census — ${census.phasesScanned} phases scanned (${census.discoveryErrors} discovery errors)`)
console.log(`  OPEN (undispositioned): ${t.open}`)
console.log(`  OPEN-planned: ${t.openPlanned}   OPEN-operator: ${t.openOperator}   RESOLVABLE (via-phase done): ${t.resolvable}`)
console.log(`  CLOSED (fixed/won't_fix/dismissed): ${t.closed}   dangling resolutions: ${t.danglingResolutions}`)
if (t.excludedExplanatoryEmpty > 0) console.log(`  excluded ${t.excludedExplanatoryEmpty} explanatory-empty field(s)`)
console.log(`  followups: ${t.followupFilesWithOpenMarkers} file(s) with ${t.followupOpenMarkerLines} open-marker line(s)`)
console.log(`  top arcs by open debt: ${Object.entries(census.byArc).slice(0, 8).map(([a, n]) => `${a}:${n}`).join('  ')}`)
console.log(`  ledger: ${jsonOut}`)

if (args.includes('--check')) {
  const ceilingPath = join(repo, 'reviews/debt-ceiling.json')
  if (!existsSync(ceilingPath)) {
    console.error(`debt-census --check: no ceiling at ${ceilingPath} — commit one ({ maxOpen, maxOpenOperator, maxDangling, ratifiedAt, ratifiedBy }) to arm the ratchet`)
    process.exit(1)
  }
  const ceiling = JSON.parse(readFileSync(ceilingPath, 'utf8'))
  const breaches: string[] = []
  if (t.open > ceiling.maxOpen) breaches.push(`OPEN ${t.open} > ceiling ${ceiling.maxOpen}`)
  if (t.openOperator > (ceiling.maxOpenOperator ?? Infinity)) breaches.push(`OPEN-operator ${t.openOperator} > ceiling ${ceiling.maxOpenOperator}`)
  if (t.danglingResolutions > (ceiling.maxDangling ?? Infinity)) breaches.push(`dangling ${t.danglingResolutions} > ceiling ${ceiling.maxDangling}`)
  if (breaches.length) {
    console.error(`debt-census --check FAILED (ceiling ratified ${ceiling.ratifiedAt} by ${ceiling.ratifiedBy}):`)
    for (const b of breaches) console.error(`  ✗ ${b}`)
    console.error('  dispose the new debt (debt-dispose.mts / arc-sweep) or get a new ceiling ratified — never bump it silently.')
    process.exit(1)
  }
  const slack = ceiling.maxOpen - t.open
  console.log(`debt-census --check OK (OPEN ${t.open} ≤ ${ceiling.maxOpen}${slack > 25 ? ` — ${slack} under ceiling; consider ratifying it down` : ''})`)
}
