/**
 * Collect gate results and git metrics for a completed phase.
 *
 * Usage: npx tsx scripts/collect-phase-metrics.ts <phase-number>
 *
 * Reads git log for phase commits, runs pnpm test to get test count,
 * and updates the .phase.ts file's gate + metrics fields.
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const phaseNum = Number(process.argv[2])
if (!phaseNum || Number.isNaN(phaseNum)) {
  console.error('Usage: npx tsx scripts/collect-phase-metrics.ts <phase-number>')
  process.exit(1)
}

const PHASE_FILE = path.resolve(
  process.cwd(),
  `roadmap/phases/phase-${String(phaseNum).padStart(3, '0')}.phase.ts`,
)

// Also check non-padded filename
const PHASE_FILE_ALT = path.resolve(process.cwd(), `roadmap/phases/phase-${phaseNum}.phase.ts`)

const phaseFile = fs.existsSync(PHASE_FILE) ? PHASE_FILE : PHASE_FILE_ALT

if (!fs.existsSync(phaseFile)) {
  console.error(`Phase file not found: ${PHASE_FILE} or ${PHASE_FILE_ALT}`)
  process.exit(1)
}

// ── Git metrics ─────────────────────────────────────────────────────────────

function getGitMetrics() {
  try {
    const log = execSync(`git log --grep="phase ${phaseNum}" --stat --format="" 2>/dev/null`, {
      encoding: 'utf-8',
    })

    const commitCount = execSync(
      `git log --grep="phase ${phaseNum}" --oneline 2>/dev/null | wc -l`,
      { encoding: 'utf-8' },
    ).trim()

    let linesAdded = 0
    let linesRemoved = 0
    const filesSet = new Set<string>()

    for (const line of log.split('\n')) {
      // Match: " 3 files changed, 45 insertions(+), 12 deletions(-)"
      const summaryMatch = line.match(
        /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
      )
      if (summaryMatch) {
        linesAdded += Number(summaryMatch[2] ?? 0)
        linesRemoved += Number(summaryMatch[3] ?? 0)
      }
      // Match file lines: " lib/roadmap/schema.ts | 147 +++"
      const fileMatch = line.match(/^\s+(.+?)\s+\|/)
      if (fileMatch) filesSet.add(fileMatch[1].trim())
    }

    return {
      commits: Number(commitCount) || 0,
      linesAdded,
      linesRemoved,
      filesChanged: filesSet.size,
    }
  } catch {
    return { commits: 0, linesAdded: 0, linesRemoved: 0, filesChanged: 0 }
  }
}

// ── Test counts ─────────────────────────────────────────────────────────────

function getTestCounts(): { passed: number; failed: number } {
  function parse(output: string) {
    const passed = Number(output.match(/(\d+) passed/)?.[1] ?? 0)
    const failed = Number(output.match(/(\d+) failed/)?.[1] ?? 0)
    return { passed, failed }
  }
  try {
    const output = execSync('pnpm test 2>&1', { encoding: 'utf-8', timeout: 120_000 })
    return parse(output)
  } catch (err) {
    // Test output is in stderr/stdout even on failure
    return parse(String(err))
  }
}

// ── Gate results ────────────────────────────────────────────────────────────

function getGateResults() {
  const lint = (() => {
    try {
      execSync('pnpm biome check . 2>&1', { encoding: 'utf-8' })
      return 'clean' as const
    } catch (e) {
      return String(e).includes('error') ? ('errors' as const) : ('warnings' as const)
    }
  })()

  const typeCheck = (() => {
    try {
      execSync('pnpm type-check 2>&1', { encoding: 'utf-8' })
      return 'clean' as const
    } catch {
      return 'errors' as const
    }
  })()

  const tests = getTestCounts()

  const build = (() => {
    try {
      execSync('pnpm build 2>&1', { encoding: 'utf-8', timeout: 300_000 })
      return 'clean' as const
    } catch {
      return 'errors' as const
    }
  })()

  return {
    gate: {
      lint,
      typeCheck,
      unitTests: { passed: tests.passed, total: tests.passed + tests.failed },
      integrationTests: { passed: 0, total: 0, notes: 'Included in unit test count' },
      e2eTests: { passed: 0, total: 0, notes: 'Run separately via pnpm e2e:local' },
      build,
    },
    testsAtEnd: tests.passed,
  }
}

// ── Update phase file ───────────────────────────────────────────────────────

function updatePhaseFile() {
  console.log(`Collecting metrics for phase ${phaseNum}...`)

  const git = getGitMetrics()
  console.log(
    `  Git: ${git.commits} commits, +${git.linesAdded}/-${git.linesRemoved}, ${git.filesChanged} files`,
  )

  console.log('  Running gate checks (lint, type-check, test, build)...')
  const { gate, testsAtEnd } = getGateResults()
  console.log(`  Tests: ${testsAtEnd} passed`)
  console.log(`  Lint: ${gate.lint}, Type-check: ${gate.typeCheck}, Build: ${gate.build}`)

  const metrics = {
    ...git,
    testsAtStart: 0, // TODO: read from previous phase's metrics
    testsAtEnd,
    testsAdded: 0, // Computed after testsAtStart is known
  }

  const today = new Date().toISOString().split('T')[0]

  // Read the phase file and inject gate + metrics
  let content = fs.readFileSync(phaseFile, 'utf-8')

  // Replace `gate: undefined` with actual gate data
  content = content.replace(
    /gate:\s*undefined/,
    `gate: ${JSON.stringify(gate, null, 4).replace(/\n/g, '\n  ')}`,
  )

  // Replace `metrics: undefined` with actual metrics data
  content = content.replace(
    /metrics:\s*undefined/,
    `metrics: ${JSON.stringify(metrics, null, 4).replace(/\n/g, '\n  ')}`,
  )

  // Replace `completedDate: undefined` with today
  content = content.replace(/completedDate:\s*undefined/, `completedDate: '${today}'`)

  fs.writeFileSync(phaseFile, content)
  console.log(`\nUpdated: ${phaseFile}`)
  console.log('Run pnpm type-check to verify the update compiles.')
}

updatePhaseFile()
