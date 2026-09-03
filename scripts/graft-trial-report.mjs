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
 * A record the reader could not validate ABORTS the run naming the file. The scorecard
 * degrades gracefully because a missing sample only widens its error bars; a trial arm
 * silently missing a phase would move the very number the decision bar is read off, so
 * here the only honest response is to stop.
 *
 * @throws {Error} naming every offending file, on any unreadable or invalid record.
 */
export function buildTrialReport(repoRoot, { cut }) {
  if (!Number.isInteger(cut)) {
    throw new Error(`graft-trial-report: --cut must be an integer phase number, got ${cut}`)
  }

  const { samples, warnings: readWarnings } = readPhaseEvalSamples(repoRoot)
  if (readWarnings.length > 0) {
    throw new Error(
      'graft-trial-report: refusing to slice an incomplete corpus, a dropped record would move '
        + `the arm it belongs to:\n  ${readWarnings.join('\n  ')}`,
    )
  }

  const gates = readGatesByPhase(join(roadmapRoot(repoRoot), 'arc-evals'))

  const buckets = new Map()
  for (const sample of samples) {
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

/** CLI entry: `--cut <phaseNumber>` (required), `--root <path>` (defaults to cwd). */
export function main(argv) {
  const cutIdx = argv.indexOf('--cut')
  const rootIdx = argv.indexOf('--root')
  if (cutIdx === -1 || argv[cutIdx + 1] === undefined) {
    process.stderr.write('usage: graft-trial-report.mjs --cut <phaseNumber> [--root <path>]\n')
    return 2
  }
  const cut = Number(argv[cutIdx + 1])
  const root = rootIdx === -1 ? process.cwd() : argv[rootIdx + 1]
  process.stdout.write(`${formatTrialReport(buildTrialReport(root, { cut }))}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main(process.argv.slice(2)))
}
