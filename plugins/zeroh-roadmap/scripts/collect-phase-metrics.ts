/**
 * Collect gate results and git metrics for a completed phase.
 *
 * Usage:
 *   npx tsx scripts/collect-phase-metrics.ts <phase-number>
 *     Run live gate checks (lint, type-check, test, build) + git metrics.
 *     Use after a phase just completed.
 *
 *   npx tsx scripts/collect-phase-metrics.ts <phase-number> --historical
 *     Skip live gate checks. Derive everything from git log. Use for
 *     backfilling historical phases that shipped before discipline.
 *     Gate enum fields default to 'clean' (the schema has no "unverified"
 *     enum member) with the honest 'unverified-historical' sentinel stamped
 *     in every notes field, and a placeholder unitTests {0,0}. completedDate
 *     is the date of the LAST commit matching this phase number.
 *
 *   npx tsx scripts/collect-phase-metrics.ts --all-historical
 *     Iterate every done phase that lacks gate/gateRounds/metrics/
 *     completedDate. Apply --historical mode to each. ~30s for 138 phases.
 *
 * Filename resolution:
 *   Globs for `phase-${N}-*.phase.ts` OR `phase-${N}.phase.ts` OR
 *   `phase-${pad3(N)}.phase.ts`. Tolerates the slug-suffix convention
 *   (e.g., `phase-197-remove-client-claimed-current-phase.phase.ts`).
 *
 * Field insertion:
 *   If the phase file already has `gate: undefined` / `metrics: undefined` /
 *   `completedDate: undefined` placeholders, replaces them in place
 *   (preserving the original /plan-phase output shape).
 *   If the fields are MISSING entirely (historical phases), INSERTS them
 *   immediately after the `status: 'done',` line.
 *
 * Idempotent: if all four fields are already present and look populated
 * (no `: undefined`), the script reports "already populated" and exits
 * without modification.
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { readdirSync, statSync } from 'node:fs'

// ── CLI parsing ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const HISTORICAL = argv.includes('--historical')
const ALL_HISTORICAL = argv.includes('--all-historical')

if (!ALL_HISTORICAL && (argv.length === 0 || argv[0].startsWith('--'))) {
  console.error(
    'Usage:\n' +
      '  npx tsx scripts/collect-phase-metrics.ts <phase-number>\n' +
      '  npx tsx scripts/collect-phase-metrics.ts <phase-number> --historical\n' +
      '  npx tsx scripts/collect-phase-metrics.ts --all-historical',
  )
  process.exit(1)
}

const PHASES_DIR = path.resolve(process.cwd(), 'roadmap/phases')

// ── Filename resolution ─────────────────────────────────────────────────────

/** Find the phase file matching a phase number, tolerating slug suffix. */
function resolvePhaseFile(phaseNum: number): string | null {
  const candidates = [
    path.resolve(PHASES_DIR, `phase-${phaseNum}.phase.ts`),
    path.resolve(PHASES_DIR, `phase-${String(phaseNum).padStart(3, '0')}.phase.ts`),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  // Glob: phase-${N}-*.phase.ts (slug-suffix convention)
  if (!fs.existsSync(PHASES_DIR)) return null
  const prefix = `phase-${phaseNum}-`
  for (const f of readdirSync(PHASES_DIR)) {
    if (f.startsWith(prefix) && f.endsWith('.phase.ts')) {
      return path.resolve(PHASES_DIR, f)
    }
  }
  return null
}

// ── Git metrics ─────────────────────────────────────────────────────────────

/** Return git commit metrics filtered to this phase number.
 *  Uses commit-message pattern `phase ${N}` with word boundary so phase 1
 *  doesn't match phase 10/100/etc. Matches both `phase ${N} —` and
 *  `phase ${N}.X` task-suffix forms. */
function getGitMetrics(phaseNum: number) {
  // Pattern: "phase NN " or "phase NN —" or "phase NN." or "phase NN:"
  // \b word boundary excludes phase 10 when searching for phase 1.
  const pattern = `\\bphase ${phaseNum}\\b`
  try {
    const log = execSync(
      `git log --grep="${pattern}" --extended-regexp --stat --format="" 2>/dev/null`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
    )
    const commitCount = execSync(
      `git log --grep="${pattern}" --extended-regexp --oneline 2>/dev/null | wc -l`,
      { encoding: 'utf-8' },
    ).trim()

    let linesAdded = 0
    let linesRemoved = 0
    const filesSet = new Set<string>()

    for (const line of log.split('\n')) {
      const summaryMatch = line.match(
        /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
      )
      if (summaryMatch) {
        linesAdded += Number(summaryMatch[2] ?? 0)
        linesRemoved += Number(summaryMatch[3] ?? 0)
      }
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

/** Date (YYYY-MM-DD) of the LAST commit matching this phase number.
 *  Falls back to today if no commits matched. */
function getLastCommitDate(phaseNum: number): string {
  const pattern = `\\bphase ${phaseNum}\\b`
  try {
    const date = execSync(
      `git log --grep="${pattern}" --extended-regexp --format="%ad" --date=short 2>/dev/null | head -1`,
      { encoding: 'utf-8' },
    ).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  } catch {
    // fall through to today
  }
  return new Date().toISOString().split('T')[0]
}

/** Extract gate-round mentions from commits. Looks for "gate R[0-9]" or
 *  "R[0-9]" patterns in commit subjects. Returns a list of summary strings. */
function getGateRoundsFromCommits(phaseNum: number): string[] {
  const pattern = `\\bphase ${phaseNum}\\b.*\\bR[0-9]\\b`
  try {
    const subjects = execSync(
      `git log --grep="${pattern}" --extended-regexp --format="%s" 2>/dev/null`,
      { encoding: 'utf-8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean)
    if (subjects.length === 0) return []
    return subjects.map((s) => s.replace(/^[a-z]+(\(.+?\))?:\s*/, '').slice(0, 200))
  } catch {
    return []
  }
}

// ── Live gate checks (live mode only) ───────────────────────────────────────

/** Package manager by lockfile sniff — the fallback when no Gate-commands binding exists. */
function detectPackageManager(): 'pnpm' | 'npm' | 'yarn' {
  if (fs.existsSync('pnpm-lock.yaml')) return 'pnpm'
  if (fs.existsSync('yarn.lock')) return 'yarn'
  return 'npm'
}

/** Read the consumer's `## Gate commands` CLAUDE.md block ("- slot: command" lines).
 *  Returns {} when the block is absent — callers fall back to detected-PM defaults.
 *  Line-walk instead of a regex block-capture: a multiline-$ lookahead terminates
 *  the lazy capture at the FIRST line end, silently dropping every slot after
 *  the first — exactly the bind-defeating bug a regex here shipped once. */
function readGateCommands(): Record<string, string> {
  try {
    const lines = fs.readFileSync('CLAUDE.md', 'utf-8').split('\n')
    const start = lines.findIndex((l) => /^## Gate commands\s*$/.test(l))
    if (start === -1) return {}
    const out: Record<string, string> = {}
    for (const line of lines.slice(start + 1)) {
      if (/^## /.test(line)) break
      const m = line.match(/^\s*-\s*(\w+):\s*(.+?)\s*$/)
      if (m) out[m[1]] = m[2]
    }
    return out
  } catch {
    return {}
  }
}

function resolveSlot(slot: string, fallback: string): string {
  return readGateCommands()[slot] ?? fallback
}

function getTestCounts(): { passed: number; failed: number } {
  function parse(output: string) {
    // vitest/jest: "N passed" / "N failed" · node:test TAP: "# pass N" / "# fail N"
    const passed = Number(
      output.match(/(\d+) passed/)?.[1] ?? output.match(/# pass:?\s+(\d+)/)?.[1] ?? 0,
    )
    const failed = Number(
      output.match(/(\d+) failed/)?.[1] ?? output.match(/# fail:?\s+(\d+)/)?.[1] ?? 0,
    )
    return { passed, failed }
  }
  const cmd = resolveSlot('unit', `${detectPackageManager()} test`)
  try {
    const output = execSync(`${cmd} 2>&1`, { encoding: 'utf-8', timeout: 600_000 })
    return parse(output)
  } catch (err) {
    return parse(String(err))
  }
}

function getLiveGateResults() {
  const pm = detectPackageManager()
  const lint = (() => {
    try {
      execSync(`${resolveSlot('lint', `${pm} run lint`)} 2>&1`, { encoding: 'utf-8' })
      return 'clean' as const
    } catch (e) {
      return String(e).includes('error') ? ('errors' as const) : ('warnings' as const)
    }
  })()
  const typeCheck = (() => {
    try {
      execSync(`${resolveSlot('types', `${pm} run type-check`)} 2>&1`, { encoding: 'utf-8' })
      return 'clean' as const
    } catch {
      return 'errors' as const
    }
  })()
  const tests = getTestCounts()
  const build = (() => {
    try {
      execSync(`${resolveSlot('build', `${pm} run build`)} 2>&1`, {
        encoding: 'utf-8',
        timeout: 600_000,
      })
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
      e2eTests: { passed: 0, total: 0, notes: 'Run separately via the e2e slot' },
      build,
    },
    testsAtEnd: tests.passed,
  }
}

// ── Historical gate (no live execution) ─────────────────────────────────────

function getHistoricalGate() {
  // HONESTY NOTE: the lint/typeCheck/build enum values below are ASSUMED, not
  // verified — the schema's GateResultShape enums have no "unverified" member,
  // so 'clean' is the only value a done phase can carry. The sentinel lives in
  // the notes fields (the only free-text slot): every consumer of a historical
  // gate sees 'unverified-historical' stamped there instead of a fabricated
  // verified-looking result. Tests default to 0/0 because we cannot recover
  // historical pass counts without checking out the phase's HEAD and running
  // the suite at that revision (out of scope for backfill).
  const SENTINEL = 'unverified-historical — assumed from done status, never re-run'
  return {
    lint: 'clean' as const,
    typeCheck: 'clean' as const,
    unitTests: { passed: 0, total: 0, notes: SENTINEL },
    integrationTests: { passed: 0, total: 0, notes: SENTINEL },
    e2eTests: { passed: 0, total: 0, notes: SENTINEL },
    build: 'clean' as const,
  }
}

// ── Field insertion / replacement ───────────────────────────────────────────

interface CollectedData {
  gate: ReturnType<typeof getLiveGateResults>['gate'] | ReturnType<typeof getHistoricalGate>
  gateRounds: string[]
  metrics: {
    commits: number
    linesAdded: number
    linesRemoved: number
    filesChanged: number
    testsAtStart: number
    testsAtEnd: number
    testsAdded: number
  }
  completedDate: string
}

/** Pretty-print a value with 4-space indent, suitable for embedding inside
 *  the existing 2-space indented phase object literal. */
function fmtField(value: unknown, indent = 2): string {
  return JSON.stringify(value, null, 4)
    .replace(/\n/g, `\n${' '.repeat(indent)}`)
    .replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, '$1:')
}

function applyData(content: string, data: CollectedData): { newContent: string; touched: boolean } {
  let touched = false

  // Path 1: replace `: undefined` placeholders if present
  if (/gate:\s*undefined/.test(content)) {
    content = content.replace(/gate:\s*undefined/, `gate: ${fmtField(data.gate)}`)
    touched = true
  }
  if (/gateRounds:\s*undefined/.test(content)) {
    content = content.replace(
      /gateRounds:\s*undefined/,
      `gateRounds: ${fmtField(data.gateRounds.length > 0 ? data.gateRounds : ['Historical — gate discipline retrofitted'])}`,
    )
    touched = true
  }
  if (/metrics:\s*undefined/.test(content)) {
    content = content.replace(/metrics:\s*undefined/, `metrics: ${fmtField(data.metrics)}`)
    touched = true
  }
  if (/completedDate:\s*undefined/.test(content)) {
    content = content.replace(/completedDate:\s*undefined/, `completedDate: '${data.completedDate}'`)
    touched = true
  }

  // Path 2: INSERT after `status: 'done',` for any field still missing entirely.
  const insertions: string[] = []
  if (!/\n\s+gate:\s*[\{u]/.test(content)) {
    insertions.push(`  gate: ${fmtField(data.gate)},`)
  }
  if (!/\n\s+gateRounds:\s*[\[u]/.test(content)) {
    const rounds = data.gateRounds.length > 0 ? data.gateRounds : ['Historical — gate discipline retrofitted']
    insertions.push(`  gateRounds: ${fmtField(rounds)},`)
  }
  if (!/\n\s+metrics:\s*[\{u]/.test(content)) {
    insertions.push(`  metrics: ${fmtField(data.metrics)},`)
  }
  if (!/\n\s+completedDate:\s*['"u]/.test(content)) {
    insertions.push(`  completedDate: '${data.completedDate}',`)
  }

  if (insertions.length > 0) {
    const block = '\n' + insertions.join('\n')
    content = content.replace(/(\n  status:\s*['"]done['"],)/, `$1${block}`)
    touched = true
  }

  // Path 3: OVERWRITE existing placeholder retrofits (zero metrics, "Historical
  // — gate discipline retrofitted ..." gateRounds) with real git-derived data.
  // Detection: the metrics block has all-zero numeric values AND we have real
  // git data to replace it with. This is the bulk-recovery case after a prior
  // historical retrofit needs upgrading to real metrics.
  const isPlaceholderMetrics = /metrics:\s*\{\s*[^}]*?commits:\s*0,\s*linesAdded:\s*0/m.test(content)
  if (isPlaceholderMetrics && data.metrics.commits > 0) {
    content = content.replace(
      /metrics:\s*\{[^}]+\}/m,
      `metrics: ${fmtField(data.metrics)}`,
    )
    touched = true
  }

  return { newContent: content, touched }
}

// ── Per-phase processing ────────────────────────────────────────────────────

function processPhase(phaseNum: number, mode: 'live' | 'historical'): boolean {
  const phaseFile = resolvePhaseFile(phaseNum)
  if (!phaseFile) {
    console.error(`  Phase ${phaseNum}: file not found`)
    return false
  }

  const git = getGitMetrics(phaseNum)
  const completedDate = getLastCommitDate(phaseNum)
  const gateRounds = getGateRoundsFromCommits(phaseNum)

  let gate: ReturnType<typeof getLiveGateResults>['gate'] | ReturnType<typeof getHistoricalGate>
  let testsAtEnd = 0
  if (mode === 'live') {
    const live = getLiveGateResults()
    gate = live.gate
    testsAtEnd = live.testsAtEnd
  } else {
    gate = getHistoricalGate()
  }

  const data: CollectedData = {
    gate,
    gateRounds,
    metrics: {
      ...git,
      testsAtStart: 0,
      testsAtEnd,
      testsAdded: 0,
    },
    completedDate,
  }

  const content = fs.readFileSync(phaseFile, 'utf-8')
  const { newContent, touched } = applyData(content, data)

  if (!touched) {
    return false
  }

  fs.writeFileSync(phaseFile, newContent)
  return true
}

// ── Main ────────────────────────────────────────────────────────────────────

if (ALL_HISTORICAL) {
  if (!fs.existsSync(PHASES_DIR)) {
    console.error(`Phases dir not found: ${PHASES_DIR}`)
    process.exit(1)
  }
  let modified = 0
  let scanned = 0
  for (const f of readdirSync(PHASES_DIR)) {
    if (!f.endsWith('.phase.ts')) continue
    const fpath = path.resolve(PHASES_DIR, f)
    if (!statSync(fpath).isFile()) continue
    const src = fs.readFileSync(fpath, 'utf-8')
    if (!/status:\s*['"]done['"]/.test(src)) continue
    const numMatch = f.match(/^phase-(\d+)/)
    if (!numMatch) continue
    const phaseNum = Number(numMatch[1])
    scanned++
    const changed = processPhase(phaseNum, 'historical')
    if (changed) {
      modified++
      const git = getGitMetrics(phaseNum)
      console.log(`  phase ${phaseNum}: ${git.commits} commits, +${git.linesAdded}/-${git.linesRemoved}`)
    }
  }
  console.log(`\nProcessed ${scanned} done phases, modified ${modified}`)
  console.log('Run the types + emit gate slots (type-check + emit:phases) to verify.')
} else {
  const phaseNum = Number(argv[0])
  if (!phaseNum || Number.isNaN(phaseNum)) {
    console.error(`Invalid phase number: ${argv[0]}`)
    process.exit(1)
  }
  console.log(`Collecting metrics for phase ${phaseNum} (mode: ${HISTORICAL ? 'historical' : 'live'})...`)
  const phaseFile = resolvePhaseFile(phaseNum)
  if (!phaseFile) {
    console.error(`Phase file not found for phase ${phaseNum}. Looked in: ${PHASES_DIR}`)
    process.exit(1)
  }
  console.log(`  File: ${phaseFile}`)
  const git = getGitMetrics(phaseNum)
  console.log(`  Git:  ${git.commits} commits, +${git.linesAdded}/-${git.linesRemoved}, ${git.filesChanged} files`)
  if (!HISTORICAL) {
    console.log('  Running live gate checks (lint, type-check, test, build)...')
  }
  const changed = processPhase(phaseNum, HISTORICAL ? 'historical' : 'live')
  if (changed) {
    console.log(`Updated: ${phaseFile}`)
    console.log('Run the types gate slot (type-check) to verify the update compiles.')
  } else {
    console.log('No changes — fields already populated.')
  }
}
