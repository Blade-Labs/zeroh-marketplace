/**
 * Phase discovery — glob *.phase.ts files and dynamic-import them.
 *
 * Pattern: convention-based discovery via file pattern matching + dynamic
 * import + Zod validation. Scaffolded by roadmap-plugin scaffold-roadmap.sh.
 *
 * Duplicate phase numbers are reported as errors with BOTH colliding file
 * paths so the operator can bisect immediately.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Phase } from './schema'

export interface DiscoveryResult {
  phases: Phase[]
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
