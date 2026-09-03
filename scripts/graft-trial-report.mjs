#!/usr/bin/env node
/**
 * The slicing instrument for the pre-registered GRAFT trial
 * (roadmap/experiments/GRAFT-TRIAL.md), which is the source of truth for arms,
 * cohorts, metrics and the decision bar.
 *
 * Every metric DEFINITION is imported from the plugin — a second metrics dialect is
 * the drift this repo's singleSeam discipline exists to kill. What lives here is the
 * before/after slicing the scorecard has no notion of.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readPhaseEvalSamples } from '../plugins/zeroh-roadmap/cli/lib/eval-collect.mjs'
import { bandFor, spanMinutes, surfaceOf } from '../plugins/zeroh-roadmap/cli/lib/eval-score.mjs'
import { SCORECARD_N_FLOOR } from '../plugins/zeroh-roadmap/cli/lib/eval-scorecard.mjs'
import { roadmapRoot } from '../plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs'

/** The sentinel the scorecard uses when no record in an arm carries halt evidence. */
const NO_HALT_EVIDENCE = 'no-halt-evidence'

const PEVAL_NAME_RE = /^phase-(\d+)\.peval\.json$/

/** The usual middle; an even count averages the two middles rather than picking a side —
 *  the scorecard's convention, whose own median is module-private. */
function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * `readPhaseEvalSamples` returns projections that drop `gate`, so the gate-derived
 * metrics are read from the same files it validated. Reading a field it chose not to
 * project is not a second dialect — no metric is recomputed here.
 */
function readGatesByPhase(evalDir) {
  const gates = new Map()
  for (const f of readdirSync(evalDir)) {
    if (!PEVAL_NAME_RE.test(f)) continue
    const doc = JSON.parse(readFileSync(join(evalDir, f), 'utf8'))
    gates.set(doc.phase, doc.gate)
  }
  return gates
}

/**
 * Build the before/after report. `cut` is a phase number: `phase <= cut` is baseline,
 * `> cut` is treatment (GRAFT-TRIAL.md section 3 explains why the cut is a phase number
 * and which sha it stands for).
 *
 * `exclude` drops phases from BOTH arms before any aggregate is computed — the protocol's
 * transition phases, which straddle the cut and belong to neither. Listing them in the
 * rendered cell is not enough: a reader can see a contaminating phase in the member list
 * but cannot subtract it back out of a median, and the median is what the decision bar is
 * read off.
 *
 * A record the reader could not validate ABORTS the run naming the file. The scorecard
 * degrades gracefully because a missing sample only widens its error bars; a trial arm
 * silently missing a phase would move the very number the decision bar is read off, so
 * here the only honest response is to stop.
 *
 * @throws {Error} naming every offending file, on any unreadable or invalid record.
 */
export function buildTrialReport(repoRoot, { cut, exclude = [] }) {
  if (!Number.isInteger(cut)) {
    throw new Error(`graft-trial-report: --cut must be an integer phase number, got ${cut}`)
  }
  for (const p of exclude) {
    if (!Number.isInteger(p)) {
      throw new Error(`graft-trial-report: --exclude takes integer phase numbers, got ${p}`)
    }
  }
  const excluded = new Set(exclude)

  const { samples, warnings: readWarnings } = readPhaseEvalSamples(repoRoot)
  if (readWarnings.length > 0) {
    throw new Error(
      'graft-trial-report: refusing to slice an incomplete corpus, a dropped record would move '
        + `the arm it belongs to:\n  ${readWarnings.join('\n  ')}`,
    )
  }

  const gates = readGatesByPhase(join(roadmapRoot(repoRoot), 'arc-evals'))

  const buckets = new Map()
  const dropped = new Set()
  for (const sample of samples) {
    if (excluded.has(sample.phase)) {
      dropped.add(sample.phase)
      continue
    }
    const arm = sample.phase <= cut ? 'baseline' : 'treatment'
    const band = bandFor(sample.taskCount)
    const surface = surfaceOf(sample)
    const key = `${arm} ${band} ${surface}`
    if (!buckets.has(key)) buckets.set(key, { arm, band, surface, members: [] })
    buckets.get(key).members.push({ ...sample, gate: gates.get(sample.phase) })
  }

  const cells = [...buckets.values()]
    .map(({ arm, band, surface, members }) => {
      const phases = members.map((m) => m.phase).sort((a, b) => a - b)
      const base = { arm, band, surface, n: members.length, phases }
      if (members.length < SCORECARD_N_FLOOR) return { ...base, abstain: true }

      // Absent halt evidence is NOT evidence of a clean run: those phases stay out of the
      // denominator entirely rather than entering it as zeroes (the scorecard's rule).
      const withHalt = members.filter((m) => m.metrics?.haltCount !== undefined)
      const unitMs = members
        .map((m) => m.gate?.slots?.find((s) => s.slot === 'unit')?.durationMs)
        .filter((ms) => typeof ms === 'number')

      return {
        ...base,
        abstain: false,
        medianSpanMinutes: median(
          members.map((m) => spanMinutes(m.metrics)).filter((v) => v !== null),
        ),
        haltRate:
          withHalt.length === 0
            ? NO_HALT_EVIDENCE
            : withHalt.filter((m) => m.metrics.haltCount > 0).length / withHalt.length,
        unitSlotMedianMs: median(unitMs),
        greenRate: members.filter((m) => m.gate?.green === true).length / members.length,
      }
    })
    .sort(
      (a, b) =>
        a.arm.localeCompare(b.arm)
        || a.band.localeCompare(b.band)
        || Number(a.surface) - Number(b.surface),
    )

  const cohorts = new Map()
  for (const c of cells) {
    const key = `${c.band} ${c.surface}`
    if (!cohorts.has(key)) cohorts.set(key, { band: c.band, surface: c.surface, arms: new Set() })
    cohorts.get(key).arms.add(c.arm)
  }
  const warnings = [...cohorts.values()]
    .filter((c) => c.arms.size < 2)
    .map((c) => `cohort ${c.band}/${c.surface}: ${[...c.arms][0]} arm only, nothing to compare against`)

  // An exclusion that is not printed is indistinguishable from a corpus that never held
  // the phase. Report what was DROPPED, not what was asked for: a requested phase with no
  // record is routine here (phase 26's record does not exist yet) but reporting it as
  // excluded would claim a subtraction that never happened.
  if (excluded.size > 0) {
    const asc = (s) => [...s].sort((a, b) => a - b).join(', ')
    const absent = [...excluded].filter((p) => !dropped.has(p))
    warnings.unshift(
      `excluded from both arms: ${dropped.size > 0 ? `phase ${asc(dropped)}` : 'nothing matched'}`
        + (absent.length > 0 ? ` (requested ${asc(excluded)}; no record in this corpus for ${asc(absent)})` : ''),
    )
  }

  return { cells, warnings }
}

/** Render the report. An abstaining cell shows `ABSTAIN(n=<k>)` and NO metric numbers —
 *  reading numbers off an under-floor cell is the failure the trial's bar exists to prevent. */
export function formatTrialReport(report) {
  const lines = ['GRAFT trial cohort report (see roadmap/experiments/GRAFT-TRIAL.md)', '']
  for (const c of report.cells) {
    const head = `${c.arm} ${c.band} surface=${c.surface} phases=[${c.phases.join(',')}]`
    lines.push(
      c.abstain
        ? `  ${head} ABSTAIN(n=${c.n})`
        : `  ${head} n=${c.n} medianSpanMinutes=${c.medianSpanMinutes} haltRate=${c.haltRate}`
          + ` unitSlotMedianMs=${c.unitSlotMedianMs} greenRate=${c.greenRate}`,
    )
  }
  if (report.cells.length === 0) lines.push('  (no records)')
  if (report.warnings.length > 0) lines.push('', 'notes:', ...report.warnings.map((w) => `  ${w}`))
  return lines.join('\n')
}

const USAGE = 'usage: graft-trial-report.mjs --cut <phaseNumber> [--exclude <n,n>] [--root <path>]'

/**
 * One occurrence per flag, and its value is never flag-shaped. `--exclude 7 --exclude 26`
 * reads as asking for both, but a first-match lookup honours only one — the same fail-open
 * class as a missing value, and on the same field.
 *
 * @returns {{ value?: string, absent?: true, error?: string }}
 */
function flagValue(argv, flag) {
  const hits = argv.flatMap((a, i) => (a === flag ? [i] : []))
  if (hits.length > 1) {
    return { error: `${flag} given ${hits.length} times — pass ONE value (comma-separated where a list is allowed)` }
  }
  if (hits.length === 0) return { absent: true }
  const value = argv[hits[0] + 1]
  if (value === undefined || value.startsWith('--')) {
    return { error: `${flag} needs a value, got ${value === undefined ? '(nothing)' : JSON.stringify(value)}` }
  }
  return { value }
}

/** CLI entry: `--cut <phaseNumber>` (required), `--exclude <n,n>` and `--root <path>`. */
export function main(argv) {
  const read = { cut: flagValue(argv, '--cut'), root: flagValue(argv, '--root'), exclude: flagValue(argv, '--exclude') }
  for (const r of Object.values(read)) {
    if (r.error) {
      process.stderr.write(`graft-trial-report: ${r.error}\n${USAGE}\n`)
      return 2
    }
  }
  if (read.cut.absent) {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }

  // `--exclude` must FAIL, never fail open: a malformed value silently reinstates the
  // transition phases, and the run would print a contaminated median under a command line
  // that looks like it asked for a clean one.
  let exclude = []
  if (!read.exclude.absent) {
    const parts = read.exclude.value.split(',')
    if (parts.some((p) => p.trim() === '')) {
      process.stderr.write(
        `graft-trial-report: --exclude needs a comma-separated list of phase numbers, got ${JSON.stringify(read.exclude.value)}\n`,
      )
      return 2
    }
    exclude = parts.map(Number)
  }

  const root = read.root.absent ? process.cwd() : read.root.value
  process.stdout.write(`${formatTrialReport(buildTrialReport(root, { cut: Number(read.cut.value), exclude }))}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main(process.argv.slice(2)))
}
