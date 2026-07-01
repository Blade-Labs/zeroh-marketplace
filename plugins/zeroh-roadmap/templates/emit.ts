/**
 * Changelog emission — derives reviews/changelog.json from .phase.ts files.
 *
 * Discovers all phases via `discoverPhases()`, groups done phases by version
 * into features/fixes/internal sections, and writes a single small JSON file
 * consumed by `scripts/generate-changelog-md.ts`.
 *
 * Usage:
 *   npx tsx lib/roadmap/emit.ts
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { crossValidate, discoverArcs, discoverPhases, DUPLICATE_PHASE_NUMBER_PREFIX } from './registry'
import type { Phase } from './schema'

// ── Changelog computation ───────────────────────────────────────────────────

interface ChangelogVersion {
  version: string
  date: string
  sections: {
    features: { name: string; description: string }[]
    fixes: { name: string; description: string }[]
    internal: { name: string; description: string }[]
  }
}

function computeChangelog(phases: Phase[]): ChangelogVersion[] {
  // Group done phases by version
  const byVersion = new Map<string, Phase[]>()
  for (const p of phases) {
    if (p.status !== 'done' || !p.version) continue
    const existing = byVersion.get(p.version) ?? []
    existing.push(p)
    byVersion.set(p.version, existing)
  }

  // Sort versions descending (newest first)
  const versions = [...byVersion.keys()].sort((a, b) => {
    const [aMaj, aMin, aPat] = a.split('.').map(Number)
    const [bMaj, bMin, bPat] = b.split('.').map(Number)
    return bMaj - aMaj || bMin - aMin || (bPat ?? 0) - (aPat ?? 0)
  })

  return versions.map((version) => {
    const vPhases = byVersion.get(version) ?? []
    const features: { name: string; description: string }[] = []
    const fixes: { name: string; description: string }[] = []
    const internal: { name: string; description: string }[] = []

    for (const p of vPhases) {
      const entry = { name: p.name, description: p.stakeholderDemo }
      if (p.category === 'feature') features.push(entry)
      else if (p.category === 'fix') fixes.push(entry)
      else internal.push(entry)
    }

    // Find date: try phase completedDate first, fall back to git tag date
    const latestPhaseDate = vPhases
      .map((p) => p.completedDate)
      .filter(Boolean)
      .sort()
      .pop()

    let date = latestPhaseDate ?? ''
    if (!date) {
      try {
        const tagDate = execSync(`git log -1 --format=%ci v${version} 2>/dev/null`, {
          encoding: 'utf-8',
        }).trim()
        if (tagDate) date = tagDate.split(' ')[0] // YYYY-MM-DD
      } catch {
        // No git tag for this version
      }
    }

    return { version, date, sections: { features, fixes, internal } }
  })
}

// ── Main emission ───────────────────────────────────────────────────────────

const CHANGELOG_PATH = path.resolve(process.cwd(), 'reviews/changelog.json')

async function emit() {
  const { phases, errors } = await discoverPhases()

  // Duplicate phase numbers stay FATAL: silent tolerance causes
  // non-deterministic lookups-by-number, so any collision halts emission.
  // Every other discovery error (a sibling's parse/import failure) is
  // QUARANTINED — warned, excluded, emission proceeds — so one malformed file
  // can't block every session's phase completion.
  const duplicates = errors.filter((e) => e.error.startsWith(DUPLICATE_PHASE_NUMBER_PREFIX))
  const quarantined = errors.filter((e) => !e.error.startsWith(DUPLICATE_PHASE_NUMBER_PREFIX))

  if (duplicates.length > 0) {
    console.error('Discovery errors (duplicate numbers are fatal):')
    for (const e of duplicates) console.error(`  ${e.file}: ${e.error}`)
    process.exit(1)
  }
  if (quarantined.length > 0) {
    console.error('QUARANTINED (excluded from emission — fix these files):')
    for (const e of quarantined) console.error(`  ${e.file}: ${e.error}`)
  }

  // Arc ↔ phase integrity: emit is the early signal (warnings only);
  // audit-roadmap remains the enforcement surface.
  const { arcs, errors: arcErrors } = await discoverArcs()
  for (const e of arcErrors) console.error(`  arc warning — ${e.file}: ${e.error}`)
  for (const v of crossValidate(phases, arcs)) console.error(`  cross-validate warning — ${v}`)

  const changelog = computeChangelog(phases)
  const changelogJson = `${JSON.stringify({ versions: changelog }, null, 2)}\n`

  fs.mkdirSync(path.dirname(CHANGELOG_PATH), { recursive: true })
  fs.writeFileSync(CHANGELOG_PATH, changelogJson)

  console.log(`Changelog: ${CHANGELOG_PATH}`)
  console.log(`  ${phases.length} phases scanned, ${changelog.length} versions emitted`)
  if (quarantined.length > 0) {
    console.log(
      `  WARNING: ${quarantined.length} file(s) quarantined and NOT emitted: ${quarantined.map((e) => e.file).join(', ')}`,
    )
  }
}

emit().catch((err) => {
  console.error('Emission failed:', err)
  process.exit(1)
})
