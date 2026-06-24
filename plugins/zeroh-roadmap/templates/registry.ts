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
import { ArcShape, type Arc, type Phase, type PhaseExecutionResult } from './schema'

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
  rootDir: string = path.resolve(process.cwd(), 'roadmap/phases'),
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
        error: `Duplicate phase number ${num} in ${filePaths.length} files: ${filePaths.join(' and ')}`,
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
  rootDir: string = path.resolve(process.cwd(), 'roadmap/phases'),
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
 * defensively with ArcShape.safeParse and routes failures into `errors`. A
 * missing roadmap/arcs directory is not an error — arcs are optional.
 */
export async function discoverArcs(
  rootDir: string = path.resolve(process.cwd(), 'roadmap/arcs'),
): Promise<ArcDiscoveryResult> {
  if (!fs.existsSync(rootDir)) {
    return { arcs: [], errors: [] }
  }

  const files = fs
    .readdirSync(rootDir)
    .filter((f) => f.endsWith('.arc.ts'))
    .sort()
    .map((f) => path.join(rootDir, f))

  const arcs: Arc[] = []
  const errors: { file: string; error: string }[] = []

  for (const file of files) {
    try {
      const mod = await import(file)
      const parsed = ArcShape.safeParse(mod.default)
      if (!parsed.success) {
        errors.push({ file, error: parsed.error.message })
        continue
      }
      arcs.push(parsed.data)
    } catch (err) {
      errors.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { arcs, errors }
}

/**
 * Pure cross-check (no I/O) between discovered phases and arcs. Returns one
 * error string per inconsistency:
 *  - a phase whose `arcId` is set but matches no discovered arc id, and
 *  - an arc plane referencing a phase number no discovered phase defines.
 *
 * Pure so the schema harness can exercise it directly without fixture files.
 */
export function crossValidate(phases: Phase[], arcs: Arc[]): string[] {
  const errors: string[] = []

  const arcIds = new Set<number | string>(arcs.map((a) => a.id))
  for (const phase of phases) {
    if (phase.arcId != null && !arcIds.has(phase.arcId)) {
      errors.push(`Phase ${phase.phase} declares arcId ${phase.arcId} but no arc has that id`)
    }
  }

  const phaseNumbers = new Set(phases.map((p) => p.phase))
  for (const arc of arcs) {
    for (const plane of arc.planes) {
      for (const num of plane.phases) {
        if (!phaseNumbers.has(num)) {
          errors.push(
            `Arc ${arc.id} plane "${plane.name}" references phase ${num} but no such phase exists`,
          )
        }
      }
    }
  }

  return errors
}
