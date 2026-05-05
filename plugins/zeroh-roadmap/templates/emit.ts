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
import { discoverPhases } from './registry'
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

  // All discovery errors are fatal — duplicate phase numbers included.
  // Silent tolerance of duplicates causes non-deterministic lookups-by-number,
  // so any collision halts emission.
  if (errors.length > 0) {
    console.error('Discovery errors:')
    for (const e of errors) console.error(`  ${e.file}: ${e.error}`)
    process.exit(1)
  }

  const changelog = computeChangelog(phases)
  const changelogJson = `${JSON.stringify({ versions: changelog }, null, 2)}\n`

  fs.mkdirSync(path.dirname(CHANGELOG_PATH), { recursive: true })
  fs.writeFileSync(CHANGELOG_PATH, changelogJson)

  console.log(`Changelog: ${CHANGELOG_PATH}`)
  console.log(`  ${phases.length} phases scanned, ${changelog.length} versions emitted`)
}

emit().catch((err) => {
  console.error('Emission failed:', err)
  process.exit(1)
})
