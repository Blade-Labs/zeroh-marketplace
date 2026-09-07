/**
 * Phase & arc discovery — glob *.phase.ts / *.arc.ts files and dynamic-import them.
 *
 * Pattern: convention-based discovery via file pattern matching + dynamic
 * import + Zod validation. Scaffolded by roadmap-plugin scaffold-roadmap.sh.
 *
 * Duplicate phase numbers are reported as errors with BOTH colliding file
 * paths so the operator can bisect immediately. `crossValidate` is a pure
 * (I/O-free) check that the discovered phases and arcs reference each other
 * consistently.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  ArcInputShape,
  normalizeArc,
  type Arc,
  type Phase,
  type PhaseExecutionResult,
} from './schema'

/** Shared discriminant for the one FATAL discovery error class. emit.ts filters
 *  on this exact prefix to keep duplicates exit-1 while quarantining parse
 *  failures — a shared constant so the wording cannot drift into a silent
 *  fatal→warning downgrade. */
export const DUPLICATE_PHASE_NUMBER_PREFIX = 'Duplicate phase number'

export interface DiscoveryResult {
  phases: Phase[]
  errors: { file: string; error: string }[]
}

export interface ArcDiscoveryResult {
  arcs: Arc[]
  errors: { file: string; error: string }[]
}

export interface ResultDiscoveryResult {
  results: PhaseExecutionResult[]
  errors: { file: string; error: string }[]
}

/**
 * Discover all .phase.ts files, import them, and return validated Phase objects.
 * Each file must `export default definePhase({...})`.
 */
export async function discoverPhases(
  rootDir: string = path.resolve(process.cwd(), 'docs/roadmap/phases'),
): Promise<DiscoveryResult> {
  const files = fs
    .readdirSync(rootDir)
    .filter((f) => f.endsWith('.phase.ts'))
    .sort()
    .map((f) => path.join(rootDir, f))

  // Track (phase, file) tuples so duplicate detection can surface both paths
  const phasesWithFiles: { phase: Phase; file: string }[] = []
  const errors: { file: string; error: string }[] = []

  for (const file of files) {
    try {
      const mod = await import(file)
      const phase = mod.default as Phase
      if (!phase || typeof phase.phase !== 'number') {
        errors.push({ file, error: 'No valid default export (must use definePhase())' })
        continue
      }
      phasesWithFiles.push({ phase, file })
    } catch (err) {
      errors.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Detect duplicate phase numbers — report ALL colliding file paths per number
  const byNumber = new Map<number, string[]>()
  for (const { phase, file } of phasesWithFiles) {
    const existing = byNumber.get(phase.phase) ?? []
    existing.push(file)
    byNumber.set(phase.phase, existing)
  }

  for (const [num, filePaths] of byNumber) {
    if (filePaths.length > 1) {
      errors.push({
        file: filePaths.join(', '),
        error: `${DUPLICATE_PHASE_NUMBER_PREFIX} ${num} in ${filePaths.length} files: ${filePaths.join(' and ')}`,
      })
    }
  }

  // Sort by phase number for stable output
  const phases = phasesWithFiles.map((p) => p.phase).sort((a, b) => a.phase - b.phase)

  return { phases, errors }
}

/**
 * Re-read the persisted `PhaseExecutionResult` roll-ups from the phase files.
 *
 * `do-arc` accumulates these in-context as it runs an arc, but that array is
 * ordinary conversation state — lost if the run is resumed or its context
 * compacts (exactly the long-arc case recursion mode targets). do-phase arc-mode
 * persists each phase's roll-up to `phase.executionResult`, so `arc-sweep` can
 * reconstruct the set durably instead of depending on the in-context hand-off.
 * Reuses `discoverPhases` so discovery/validation lives in one place.
 */
export async function discoverResults(
  rootDir: string = path.resolve(process.cwd(), 'docs/roadmap/phases'),
): Promise<ResultDiscoveryResult> {
  const { phases, errors } = await discoverPhases(rootDir)
  const results = phases
    .map((p) => p.executionResult)
    .filter((r): r is PhaseExecutionResult => r != null)
  return { results, errors }
}

/**
 * Discover all .arc.ts files, import them, and return validated Arc objects.
 * Each file must `export default defineArc({...})`.
 *
 * Unlike discoverPhases (which relies on definePhase parsing at import time), an
 * .arc.ts file could export a raw object literal, so the registry parses
 * defensively with `ArcInputShape` (accepting both the `planes` and flat `phases`
 * forms) and normalizes the result, routing failures into `errors`. A missing
 * `export default` is reported with the same clarity as the phase path. Duplicate
 * arc ids across files are reported with BOTH colliding paths (mirroring the
 * duplicate-phase-number check). A missing roadmap/arcs directory is not an error
 * — arcs are optional.
 */
export async function discoverArcs(
  rootDir: string = path.resolve(process.cwd(), 'docs/roadmap/arcs'),
): Promise<ArcDiscoveryResult> {
  if (!fs.existsSync(rootDir)) {
    return { arcs: [], errors: [] }
  }

  const files = fs
    .readdirSync(rootDir)
    .filter((f) => f.endsWith('.arc.ts'))
    .sort()
    .map((f) => path.join(rootDir, f))

  const arcsWithFiles: { arc: Arc; file: string }[] = []
  const errors: { file: string; error: string }[] = []

  for (const file of files) {
    try {
      const mod = await import(file)
      if (mod.default == null) {
        errors.push({ file, error: 'No valid default export (must use defineArc())' })
        continue
      }
      const parsed = ArcInputShape.safeParse(mod.default)
      if (!parsed.success) {
        errors.push({ file, error: parsed.error.message })
        continue
      }
      arcsWithFiles.push({ arc: normalizeArc(parsed.data), file })
    } catch (err) {
      errors.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Detect duplicate arc ids — report ALL colliding file paths per id. `id` is
  // `number | string`; key by its string form so `1` and `'1'` (ambiguous to
  // do-arc's CLI id resolution) are caught as a collision too.
  const byId = new Map<string, string[]>()
  for (const { arc, file } of arcsWithFiles) {
    const key = String(arc.id)
    const existing = byId.get(key) ?? []
    existing.push(file)
    byId.set(key, existing)
  }

  for (const [id, filePaths] of byId) {
    if (filePaths.length > 1) {
      errors.push({
        file: filePaths.join(', '),
        error: `Duplicate arc id ${id} in ${filePaths.length} files: ${filePaths.join(' and ')}`,
      })
    }
  }

  const arcs = arcsWithFiles.map((a) => a.arc)
  return { arcs, errors }
}

/**
 * Pure cross-check (no I/O) between discovered phases and arcs. Membership is
 * expressed twice — forward via `arc.planes[].phases`, back via `phase.arcId` —
 * and this guards every way the two can disagree. Returns one error string per
 * inconsistency:
 *  1. a phase whose `arcId` is set but matches no discovered arc id;
 *  2. an arc plane referencing a phase number no discovered phase defines;
 *  3. a phase claimed by more than one arc plane (two arcs, or twice within one
 *     arc) — a phase belongs to exactly one plane;
 *  4. a phase whose `arcId` names an arc that does NOT list it in its planes
 *     (the back-reference and the forward list disagree).
 *
 * Pure so the schema harness can exercise it directly without fixture files.
 */
export function crossValidate(phases: Phase[], arcs: Arc[]): string[] {
  const errors: string[] = []
  const arcIds = new Set<number | string>(arcs.map((a) => a.id))

  // (1) dangling arcId
  for (const phase of phases) {
    if (phase.arcId != null && !arcIds.has(phase.arcId)) {
      errors.push(`Phase ${phase.phase} declares arcId ${phase.arcId} but no arc has that id`)
    }
  }

  // (2) dangling plane phase + build the phase -> owning-arc-ids index
  const phaseNumbers = new Set(phases.map((p) => p.phase))
  const owners = new Map<number, (number | string)[]>()
  for (const arc of arcs) {
    for (const plane of arc.planes) {
      for (const num of plane.phases) {
        if (!phaseNumbers.has(num)) {
          errors.push(
            `Arc ${arc.id} plane "${plane.name}" references phase ${num} but no such phase exists`,
          )
        }
        const list = owners.get(num) ?? []
        list.push(arc.id)
        owners.set(num, list)
      }
    }
  }

  // (3) a phase claimed by more than one plane slot
  for (const [num, ownerIds] of owners) {
    if (ownerIds.length > 1) {
      errors.push(
        `Phase ${num} is claimed by ${ownerIds.length} arc planes (${ownerIds.join(', ')}) — a phase belongs to exactly one arc plane`,
      )
    }
  }

  // (4) arcId must name the arc whose planes actually list the phase (skip when
  // arcId is dangling — (1) already reports that, no need to double-flag)
  for (const phase of phases) {
    if (phase.arcId == null || !arcIds.has(phase.arcId)) continue
    const ownerIds = owners.get(phase.phase) ?? []
    if (!ownerIds.includes(phase.arcId)) {
      errors.push(
        `Phase ${phase.phase} declares arcId ${phase.arcId} but that arc's planes do not list it`,
      )
    }
  }

  return errors
}
