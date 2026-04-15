/**
 * Phase registry emission — deterministic JSON with SHA256 digest.
 *
 * Pattern: deterministic emission with sorted keys, no timestamps in
 * digested content, SHA256 integrity. Scaffolded by roadmap-plugin
 * scaffold-roadmap.sh.
 *
 * Duplicate phase numbers are fatal — emission fails with exit 1 and
 * reports BOTH colliding file paths so the operator can bisect.
 *
 * Usage:
 *   npx tsx lib/roadmap/emit.ts           # Emit registry
 *   npx tsx lib/roadmap/emit.ts --check   # CI drift detection
 */

import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { discoverPhases } from './registry'
import type { Phase } from './schema'

// ── Helpers ─────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`
}

// ── Summary computation ─────────────────────────────────────────────────────

function computeSummary(phases: Phase[]) {
  const byStatus = { backlog: 0, 'in-progress': 0, done: 0, cancelled: 0 }
  let totalTestsAdded = 0
  let totalLinesRemoved = 0

  for (const p of phases) {
    byStatus[p.status]++
    if (p.metrics) {
      totalTestsAdded += p.metrics.testsAdded
      totalLinesRemoved += p.metrics.linesRemoved
    }
  }

  return {
    total: phases.length,
    ...byStatus,
    totalTestsAdded,
    totalLinesRemoved,
    latestTestCount:
      phases.filter((p) => p.metrics?.testsAtEnd).sort((a, b) => b.phase - a.phase)[0]?.metrics
        ?.testsAtEnd ?? 0,
  }
}

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

const REGISTRY_PATH = path.resolve(process.cwd(), 'reviews/phase-registry.json')
const CHANGELOG_PATH = path.resolve(process.cwd(), 'reviews/changelog.json')

async function emit() {
  const checkMode = process.argv.includes('--check')
  const { phases, errors } = await discoverPhases()

  // All discovery errors are fatal — duplicate phase numbers included.
  // Silent tolerance of duplicates causes registry drift and non-deterministic
  // lookups-by-number, so any collision halts emission.
  if (errors.length > 0) {
    console.error('Discovery errors:')
    for (const e of errors) console.error(`  ${e.file}: ${e.error}`)
    process.exit(1)
  }

  const summary = computeSummary(phases)
  const changelog = computeChangelog(phases)

  // Strip non-deterministic fields for digest (none currently, but future-proof)
  const registryContent = JSON.stringify({ summary, phases }, null, 2)
  const digest = sha256(registryContent)

  const registry = { digest, summary, phases }
  const registryJson = `${JSON.stringify(registry, null, 2)}\n`

  const changelogJson = `${JSON.stringify({ versions: changelog }, null, 2)}\n`

  if (checkMode) {
    // Compare digest to committed version
    if (fs.existsSync(REGISTRY_PATH)) {
      const existing = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))
      if (existing.digest === digest) {
        console.log('emit:phases:check — no drift detected')
        process.exit(0)
      }
      console.error(`emit:phases:check — DRIFT DETECTED`)
      console.error(`  committed: ${existing.digest}`)
      console.error(`  computed:  ${digest}`)
      console.error(`  Run: pnpm emit:phases`)
      process.exit(2)
    }
    console.error('emit:phases:check — no committed registry found')
    process.exit(2)
  }

  // Write files
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true })
  fs.writeFileSync(REGISTRY_PATH, registryJson)
  fs.writeFileSync(CHANGELOG_PATH, changelogJson)

  console.log(`Phase registry: ${REGISTRY_PATH}`)
  console.log(
    `  ${summary.total} phases (${summary.done} done, ${summary.backlog} backlog, ${summary['in-progress']} in-progress)`,
  )
  console.log(`  ${summary.totalTestsAdded} tests added across all phases`)
  console.log(`  Digest: ${digest}`)
  console.log(`Changelog: ${CHANGELOG_PATH}`)
  console.log(`  ${changelog.length} versions`)
}

emit().catch((err) => {
  console.error('Emission failed:', err)
  process.exit(1)
})
