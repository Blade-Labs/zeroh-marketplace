/**
 * Generate docs-site/docs/changelog.md from reviews/changelog.json.
 *
 * Usage: npx tsx scripts/generate-changelog-md.ts
 *
 * The changelog.json is emitted by lib/roadmap/emit.ts from .phase.ts data.
 * This script renders it to Docusaurus-compatible markdown.
 */

import fs from 'node:fs'
import path from 'node:path'

const CHANGELOG_JSON = path.resolve(process.cwd(), 'reviews/changelog.json')
const CHANGELOG_MD = path.resolve(process.cwd(), process.argv[2] || 'CHANGELOG.md')

interface ChangelogEntry {
  name: string
  description: string
}

interface ChangelogVersion {
  version: string
  date: string
  sections: {
    features: ChangelogEntry[]
    fixes: ChangelogEntry[]
    internal: ChangelogEntry[]
  }
}

function formatDate(isoDate: string): string {
  if (!isoDate) return ''
  const d = new Date(isoDate)
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
}

function renderSection(title: string, entries: ChangelogEntry[]): string {
  if (entries.length === 0) return ''
  const items = entries.map((e) => `- **${e.name}** — ${e.description}`).join('\n')
  return `### ${title}\n\n${items}\n`
}

function generate() {
  if (!fs.existsSync(CHANGELOG_JSON)) {
    console.error(`ERROR: ${CHANGELOG_JSON} not found. Run pnpm emit:phases first.`)
    process.exit(1)
  }

  const data = JSON.parse(fs.readFileSync(CHANGELOG_JSON, 'utf-8')) as {
    versions: ChangelogVersion[]
  }

  const lines: string[] = [
    '---',
    'sidebar_position: 99',
    'title: Changelog',
    '---',
    '',
    '<!-- GENERATED — do not edit. Run: pnpm emit:changelog -->',
    '',
    '# Changelog',
    '',
    'All notable changes to this project.',
    '',
    '---',
    '',
  ]

  for (const ver of data.versions) {
    const dateStr = ver.date ? ` — ${formatDate(ver.date)}` : ''
    lines.push(`## v${ver.version}${dateStr}`)
    lines.push('')

    const features = renderSection("What's New", ver.sections.features)
    const fixes = renderSection('Fixed', ver.sections.fixes)
    const internal = renderSection('Under the Hood', ver.sections.internal)

    if (features) lines.push(features)
    if (fixes) lines.push(fixes)
    if (internal) lines.push(internal)

    lines.push('---')
    lines.push('')
  }

  // Optional: Add a "Foundation" section for initial build history
  // Customize this block per project or remove it entirely
  lines.push('---')
  lines.push('')

  const content = lines.join('\n')
  fs.writeFileSync(CHANGELOG_MD, content)
  console.log(`Generated: ${CHANGELOG_MD}`)
  console.log(`  ${data.versions.length} versions`)
}

generate()
