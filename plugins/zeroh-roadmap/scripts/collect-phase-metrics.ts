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
 *
 * Time axis (metrics.startedAt / completedAt / haltCount):
 *   DERIVED, never hand-typed, from records that already exist — this script is
 *   the single time source, so nothing else starts a stopwatch. Timestamps are
 *   the author dates of the first/last commit matching the phase grammar,
 *   normalized to UTC. haltCount sums the interruptions the record can EVIDENCE:
 *   executionResult halt statuses plus the beacon's `resume` events.
 *   Each field is OMITTED when its source is absent — a phase that predates the
 *   beacons reports no haltCount rather than a zero that would read as "ran
 *   clean". --historical derives timestamps (commits survive) but never a
 *   haltCount (beacons do not). Every run prints what it derived vs what was
 *   absent, per phase.
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

const cwd = process.cwd()
const configuredRoot = process.env.ROADMAP_ROOT || undefined
const rootCandidates = ['roadmap', 'docs/roadmap']
const markedRoots = rootCandidates.filter((candidate) => {
  const root = path.resolve(cwd, candidate)
  return fs.existsSync(path.resolve(root, 'roadmap.config.json')) || fs.existsSync(path.resolve(root, 'phases'))
})
if (!configuredRoot && markedRoots.length > 1) {
  throw new Error(`ambiguous roadmap root: ${markedRoots.join(', ')}; set ROADMAP_ROOT`)
}
const roadmapRoot = path.resolve(cwd, configuredRoot ?? markedRoots[0] ?? rootCandidates[0])
const PHASES_DIR = path.resolve(roadmapRoot, 'phases')

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

/**
 * The ONE commit lister every phase-scoped derivation below reads. Two properties, both
 * load-bearing, both learned from a measured defect rather than assumed:
 *
 *  1. It matches the SUBJECT only. `git log --grep` searches the whole commit message, and a
 *     release merge's PR body enumerates every phase in the release — so phase 1889 matched two
 *     `release: v0.4x.0 …` merges dated a day after it finished and derived a 1137-minute span
 *     against a real 15.5-minute one, with all seven CONSOLEUX phases inheriting one identical
 *     arc-shaped duration. Anchoring on the subject is what makes the phase grammar a contract
 *     rather than a hint.
 *  2. It drops merges. A merge commit's stat is the whole merged range, so counting one inflates
 *     linesAdded/filesChanged by an entire branch.
 *
 * The subject grammar it reads is the consumer's BINDING commit grammar (do-phase "Commit
 * grammar"), which is also what the CLI parses elsewhere — one grammar, not two.
 */
function phaseCommits(phaseNum: number): { sha: string; authoredAt: string; subject: string }[] {
  const re = new RegExp(`\\bphase ${phaseNum}\\b`)
  try {
    const out = execSync(`git log --no-merges --format="%H%x1f%aI%x1f%s" 2>/dev/null`, {
      encoding: 'utf-8',
      maxBuffer: 200 * 1024 * 1024,
    })
    const rows: { sha: string; authoredAt: string; subject: string }[] = []
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const [sha, authoredAt, ...rest] = line.split('\x1f')
      const subject = rest.join('\x1f')
      if (subject && re.test(subject)) rows.push({ sha, authoredAt, subject })
    }
    return rows
  } catch {
    return []
  }
}

/** Return git commit metrics filtered to this phase number, via the subject-anchored lister. */
function getGitMetrics(phaseNum: number) {
  const shas = phaseCommits(phaseNum).map((c) => c.sha)
  try {
    if (shas.length === 0) return { commits: 0, linesAdded: 0, linesRemoved: 0, filesChanged: 0 }
    const log = execSync(`git show --stat --format="" ${shas.join(' ')} 2>/dev/null`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    })
    const commitCount = String(shas.length)

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

/**
 * The PhaseMetrics time axis, derived from records that already exist — the arc's
 * single-time-source seam, so there is no second stopwatch anywhere.
 *
 * This measures the EXECUTION window, not the span of everything ever said about the phase.
 * `startedAt` is the `roadmap phase start` marker (`docs(roadmap): phase N — move to
 * in-progress`); `completedAt` is the last subject-matching commit at or after it, so the
 * post-completion `fix(scope): phase N gate RX` rounds stay inside the window. Both are
 * normalized to UTC for the schema's `z.string().datetime()`.
 *
 * When the anchor is ABSENT both bounds are absent, and the phase lands in the timing table's
 * `interruptedExcluded` rather than the sample set. The alternative — falling back to the first
 * subject-matching commit — is not a noisier measurement of the same thing, it measures a
 * different thing: plan-time commits (`plan(roadmap): phase N …`, review fixes, queueing) can
 * precede execution by hours, and phase 1889 spans 62 minutes that way against a real 15.5.
 * `computeTimingStats` would fold that into the median planners actually consume, and labelling
 * it "approximate" in a note does not stop it. Absent, not approximated.
 *
 * The subject grammar read here is the consumer's BINDING commit grammar, the same contract the
 * CLI parses for base-SHA derivation and unverified-done detection.
 */
const IN_PROGRESS_MARKER = /move to in-progress/

function getPhaseTimestamps(phaseNum: number): { startedAt?: string; completedAt?: string } {
  const commits = phaseCommits(phaseNum)
  if (commits.length === 0) return {}

  const instantOf = (c: { authoredAt: string }) => new Date(c.authoredAt).getTime()
  const anchors = commits.filter((c) => IN_PROGRESS_MARKER.test(c.subject)).map(instantOf).filter((t) => !Number.isNaN(t))
  if (anchors.length === 0) return {}
  // EARLIEST anchor: a phase respawned after a checkpoint can stamp the marker more than once,
  // and the execution window opens the first time it did.
  const started = Math.min(...anchors)

  // MAX by instant, not by git-log traversal order: a rebase or cherry-pick can leave author
  // dates out of order, and a completedAt before its startedAt would read as a negative
  // elapsed — a fabricated number, which is exactly what this arc forbids.
  const after = commits.map(instantOf).filter((t) => !Number.isNaN(t) && t >= started)
  const toUtc = (t: number) => new Date(t).toISOString()
  return { startedAt: toUtc(started), completedAt: toUtc(Math.max(...after)) }
}

/**
 * `haltCount` — how many interruptions the record can actually EVIDENCE, from two independent
 * markers: the phase file's own `executionResult` halt statuses (checkpoint / escalated) and
 * the executor beacon's `resume` events (a respawn or session-limit wake).
 *
 * Honest-absent is the whole contract here. When NEITHER source exists there is nothing to
 * count, so this returns undefined and the field never reaches the phase file — a phase that
 * simply predates the beacons must not be reported as having run uninterrupted. When at least
 * one source exists the sum is a DERIVED value, so a resulting zero means "evidence present,
 * no halts observed", never "no evidence".
 */
function deriveHaltCount(phaseNum: number, phaseFileContent: string): number | undefined {
  let sources = 0
  let halts = 0

  if (phaseFileContent.includes('executionResult:')) {
    sources++
    halts += (phaseFileContent.match(/status:\s*['"](?:checkpoint|escalated)['"]/g) ?? []).length
  }

  const beaconPath = path.resolve(process.cwd(), '.building', `${phaseNum}-executor.jsonl`)
  if (fs.existsSync(beaconPath)) {
    sources++
    try {
      for (const line of fs.readFileSync(beaconPath, 'utf-8').split('\n')) {
        if (!line.trim()) continue
        try {
          if (JSON.parse(line).event === 'resume') halts++
        } catch {
          // A malformed beacon line is not evidence of a halt — skip it, never guess.
        }
      }
    } catch {
      // An unreadable beacon contributes nothing; the executionResult term still stands.
    }
  }

  return sources === 0 ? undefined : halts
}

/** Date (YYYY-MM-DD) of the LAST commit matching this phase number.
 *  Falls back to today if no commits matched. */
function getLastCommitDate(phaseNum: number): string {
  const instants = phaseCommits(phaseNum)
    .map((c) => new Date(c.authoredAt).getTime())
    .filter((t) => !Number.isNaN(t))
  if (instants.length > 0) return new Date(Math.max(...instants)).toISOString().split('T')[0]
  return new Date().toISOString().split('T')[0]
}

/** Extract gate-round mentions from commits. Looks for "gate R[0-9]" or
 *  "R[0-9]" patterns in commit subjects. Returns a list of summary strings. */
function getGateRoundsFromCommits(phaseNum: number): string[] {
  return phaseCommits(phaseNum)
    .map((c) => c.subject)
    .filter((s) => /\bR[0-9]\b/.test(s))
    .map((s) => s.replace(/^[a-z]+(\(.+?\))?:\s*/, '').slice(0, 200))
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
    // The time axis — every one of these is OPTIONAL because it is derived, and an
    // underivable field is omitted rather than defaulted (see getPhaseTimestamps /
    // deriveHaltCount). JSON.stringify in fmtField drops absent keys for free.
    startedAt?: string
    completedAt?: string
    haltCount?: number
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

/**
 * The phase's own `metrics: { … }` block, located by BRACE MATCHING rather than a regex.
 *
 * A lazy `\{[\s\S]*?\n  \}` looks equivalent and is not: phase files carry the block in two
 * shapes (one-line and multi-line), and against a one-line block the lazy form runs straight
 * past it to the next dedented `}` in the file — which is the end of `executionResult`. That
 * mis-match silently appended the time axis into the WRONG object on the first run of this
 * backfill. Counting braces is the only form that cannot care which shape it is reading.
 */
function findMetricsBlock(content: string): { start: number; end: number; text: string } | null {
  const m = content.match(/\n  metrics:\s*\{/)
  if (!m || m.index === undefined) return null
  const start = m.index + 1 // past the newline, onto `metrics:`
  let depth = 0
  for (let i = content.indexOf('{', start); i < content.length; i++) {
    const ch = content[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { start, end: i + 1, text: content.slice(start, i + 1) }
    }
  }
  return null
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

  // Path 4: MERGE the time axis into an existing, non-placeholder metrics block. Paths 1-3 all
  // write a metrics block WHOLE, so a phase that already recorded real metrics before the time
  // axis existed could never receive it — the run derived startedAt/completedAt, printed them,
  // and discarded them. That is every phase that shipped before this field was added.
  //
  // ADDITIVE ONLY, and that containment is what makes it safe across ~1,900 historical files:
  // it inserts only keys that are ABSENT, never rewrites a recorded value, so it is idempotent
  // and a re-run cannot churn history. `haltCount` follows the same rule and stays out of
  // historical mode entirely (deriveHaltCount returns undefined there), because commits survive
  // and beacons do not — an absent halt count must not become a zero that reads as "ran clean".
  const block = findMetricsBlock(content)
  if (block) {
    // Presence is tested INSIDE the block, never over the whole file: `startedAt` also appears
    // in an executionResult and in free-text transparency prose, and a match there would skip
    // the insert and silently leave the metrics block without its time axis.
    const timeAxis: [string, string | number][] = []
    for (const key of ['startedAt', 'completedAt', 'haltCount'] as const) {
      const value = data.metrics[key]
      if (value === undefined) continue
      if (new RegExp(`\\b${key}:`).test(block.text)) continue
      timeAxis.push([key, value])
    }
    if (timeAxis.length > 0) {
      const lit = (v: string | number) => (typeof v === 'number' ? String(v) : `'${v}'`)
      // Re-emit in the block's OWN shape. A one-line block stays one line and a multi-line block
      // stays indented — the alternative reformats ~1,900 historical records into a diff nobody
      // asked for, and reformatting is how a mechanical backfill becomes unreviewable.
      const inner = block.text.slice(block.text.indexOf('{') + 1, block.text.lastIndexOf('}'))
      const oneLine = !inner.includes('\n')
      const merged = oneLine
        ? `  metrics: { ${inner.trim().replace(/,$/, '')}, ${timeAxis.map(([k, v]) => `${k}: ${lit(v)}`).join(', ')} }`
        : `  metrics: {${inner.replace(/\s*$/, '\n')}${timeAxis.map(([k, v]) => `    ${k}: ${lit(v)},`).join('\n')}\n  }`
      content = content.slice(0, block.start) + merged + content.slice(block.end)
      touched = true
    }
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
  const timestamps = getPhaseTimestamps(phaseNum)
  // --historical never derives a halt count: beacons do not survive, and the executionResult
  // of a phase that predates the contract says nothing about interruptions. Absent, not zero.
  const content = fs.readFileSync(phaseFile, 'utf-8')
  const haltCount = mode === 'historical' ? undefined : deriveHaltCount(phaseNum, content)
  console.log(
    `  Time: startedAt ${timestamps.startedAt ?? 'ABSENT (no matching commits)'}` +
      ` · completedAt ${timestamps.completedAt ?? 'ABSENT (no matching commits)'}` +
      ` · haltCount ${haltCount ?? (mode === 'historical' ? 'ABSENT (historical mode)' : 'ABSENT (no executionResult, no beacon)')}`,
  )

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
      ...timestamps,
      ...(haltCount === undefined ? {} : { haltCount }),
    },
    completedDate,
  }

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
