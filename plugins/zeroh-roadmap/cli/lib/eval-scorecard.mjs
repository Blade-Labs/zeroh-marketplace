/**
 * eval-scorecard — PER-ACTOR outcome slicing (arc EVALLOOP). `assembleAttribution` already
 * records who planned, who drove and who reviewed; this turns that capture into outcomes without turning it
 * into a leaderboard.
 *
 * Three rails decide every design choice here:
 *
 *  - COHORT NORMALISATION. Work is not randomly assigned to actors, so a pooled mean is a lie:
 *    an actor handed every 7+ surface phase would look worse than one handed 1-3 CLI phases no
 *    matter how well it worked. Every cell is keyed by the SAME two axes the timing table uses,
 *    IMPORTED from eval-score.mjs rather than restated — if the bands move, the scorecard and
 *    the timing table must move together or the two stop being comparable. No function in this
 *    module aggregates across cohorts, which is also why there is no summary row to put such a
 *    figure in.
 *  - THE N FLOOR. Below `SCORECARD_N_FLOOR` a cell ABSTAINS and carries no `metrics` key at
 *    all, so nothing can be read as a score. Same logic as `MIN_COMPARABLE_PRIORS`' "one prior
 *    is an anecdote", applied at cell grain.
 *  - THE ANTI-ZERO RAIL. An unmeasurable signal is a NAMED string, never 0: a zeroed escape
 *    rate reads as a spotless actor and a zeroed recall reads as a useless one, and both are
 *    claims the data did not make.
 *
 * This module SLICES, it never re-judges: no judge model is consulted and no score is minted.
 */
import { defaultExec } from './exec.mjs'
import { bandFor, surfaceOf, UNRECORDED_DRIVER, spanMinutes } from './eval-score.mjs'

/**
 * Below this many samples a cell abstains. A RULING, not a tuning knob — it is stamped into
 * every scorecard (the SPEED_REFERENCE discipline) so that changing it is a visible change to
 * the model rather than a silent re-ranking of every actor.
 */
export const SCORECARD_N_FLOOR = 5

/** The unmeasurable-signal vocabulary. Each says WHICH input was missing, because "0" and
 *  "we could not look" are different claims and only one of them is about the actor. */
const SENTINEL = {
  scanUnavailable: 'scan-unavailable',
  noGateRounds: 'no-gate-rounds',
  noHaltEvidence: 'no-halt-evidence',
  noTimestamps: 'no-timestamps',
  noFindings: 'no-findings',
}

/** NUL joins composite keys because it cannot occur in any half — a printable separator would
 *  let a model id containing it collide two distinct cells (the assembleAttribution rule). */
const SEP = '\u0000'

const sum = (xs) => xs.reduce((a, b) => a + b, 0)

/**
 * Does `subject` name `phase` at a DIGIT BOUNDARY? `phase 900` must never match `phase 9001`
 * or `phase 90` — the same discipline eval-collect's `memberPhaseRe` uses, and the reason a
 * loose substring match would attribute another arc's escape to this actor.
 */
const namesPhase = (subject, phase) => new RegExp(`(?:^|[^0-9])phase ${phase}(?:[^0-9]|$)`).test(String(subject))

/**
 * The gate-fix correlation keys: which `{phase, round}` pairs the recorded commit grammar
 * (`… phase N gate RX …`) says produced a real fix. This is what separates a reviewer finding
 * that CHANGED something from one that did not — the correlation is read off the commit
 * history, never guessed by a model.
 *
 * ONE bounded `git log` per phase (`--grep` is a server-side bound; an unfiltered full-history
 * log overruns the exec buffer on a real repo). `exec` is injected so tests run without git,
 * and a non-zero status yields NO pairs for that phase rather than a throw: a scan that failed
 * must not read as a phase with no gate fixes, and one failing phase must not abort the sweep.
 */
export function findGateFixCommits(repoRoot, phaseNums, { exec = defaultExec } = {}) {
  const pairs = []
  for (const n of phaseNums ?? []) {
    const res = exec('git', ['-C', repoRoot, 'log', '--no-merges', '--format=%s', `--grep=phase ${n}`])
    if (res.status !== 0) continue
    for (const line of String(res.stdout ?? '').split('\n')) {
      // EVERY construct in the subject, not just the first: a fix naming two phases
      // ("phase 2015 gate R1 and phase 2016 gate R1") would otherwise drop the second, and a
      // gate fix that reads as absent turns its reviewer round into a spurious false positive.
      // The grep is only a PREFILTER — it matches `phase 20150` too — so comparing the parsed
      // capture against the phase asked for is what actually enforces the digit boundary.
      for (const m of line.matchAll(/(?:^|[^0-9])phase (\d+) gate R(\d+)/g)) {
        if (Number(m[1]) !== Number(n)) continue
        pairs.push({ phase: Number(n), round: Number(m[2]) })
      }
    }
  }
  return pairs
}

/** Every gate run of a phase, oldest first as recorded. */
const runsOf = (phase) => phase.gateRuns ?? []

/** The run that let the work out: the LAST run that ended green. A clean verdict on an earlier
 *  RED run is not what allowed an escape — that run was not the one that opened the door. */
const finalGreenRun = (phase) => [...runsOf(phase)].reverse().find((r) => r.green === true)

/**
 * A cell's shared cohort/keying pass. `cells` is the map being built; `make` supplies the
 * identity fields so the driver, planner and reviewer axes share one accumulation rule and cannot
 * drift into two definitions of a cohort.
 */
function cellFor(cells, key, identity) {
  if (!cells.has(key))
    cells.set(key, {
      ...identity,
      phases: [],
      rounds: [],
      // Whether any trace feeding this cell could not complete its escape scan. Tracked per
      // CELL rather than per trace: a cell fed by a degraded trace cannot claim an escape rate
      // even if its other contributor was clean.
      scanDegraded: false,
    })
  return cells.get(key)
}

/** Attach the identity fields every emitted cell carries, in a fixed key order. */
const emit = (identity, samples, nFloor, metrics) => {
  const abstained = samples < nFloor
  // The XOR is structural, not conditional prose: an abstaining cell never gets the key, so no
  // reader can mistake an under-sampled figure for a measurement.
  return abstained ? { ...identity, samples, abstained } : { ...identity, samples, abstained, metrics: metrics() }
}

/**
 * computeScorecard — the slice. `traces` are ArcTraces (the collector's output); `gateFixes`
 * are `findGateFixCommits` pairs across every member phase.
 *
 * `generatedAt` is INJECTED by the caller for the same reason the timing table's is: a
 * committed projection that mints its own wall clock shows a spurious diff on every re-run
 * over identical inputs.
 */
export function computeScorecard(traces, gateFixes, { nFloor = SCORECARD_N_FLOOR, generatedAt } = {}) {
  const drivers = new Map()
  const planners = new Map()
  const reviewers = new Map()
  const fixes = gateFixes ?? []

  for (const trace of traces ?? []) {
    const degraded = trace?.git?.escapeScan === 'unavailable'
    const escapeFixes = trace?.git?.escapeFixes ?? []

    for (const phase of trace?.phases ?? []) {
      const band = bandFor(phase.taskCount)
      const surface = surfaceOf(phase)
      // An executor that did not self-report attributes to the literal `unrecorded`, never a
      // guess: a wrong attribution is worse than a named gap, because only the gap is visible.
      const d = phase.executionResult?.driver ?? UNRECORDED_DRIVER
      const escapes = escapeFixes.filter((f) => namesPhase(f.subject, phase.phase)).length

      const driver = cellFor(drivers, [d.model, d.lane, band, surface].join(SEP), {
        model: d.model,
        lane: d.lane,
        taskCountBand: band,
        surface,
      })
      driver.phases.push({ phase, escapes })
      if (degraded) driver.scanDegraded = true

      // Planner cells mirror driver cells minus lane (planning has no lane); absence
      // attributes to the literal 'unrecorded', the same honest-gap discipline.
      const plannerModel = phase.plannedBy?.model ?? 'unrecorded'
      const planner = cellFor(planners, [plannerModel, band, surface].join(SEP), {
        model: plannerModel,
        taskCountBand: band,
        surface,
      })
      planner.phases.push({ phase, escapes })
      if (degraded) planner.scanDegraded = true

      const green = finalGreenRun(phase)
      // A reviewer is charged a miss only where it signed THIS phase's final green run clean.
      const cleanOnGreen = new Set((green?.rounds ?? []).filter((r) => r.verdict === 'clean').map((r) => r.agent))

      for (const run of runsOf(phase))
        for (const round of run.rounds ?? []) {
          const cell = cellFor(reviewers, [round.agent, band, surface].join(SEP), {
            agent: round.agent,
            taskCountBand: band,
            surface,
          })
          cell.rounds.push({ phase: phase.phase, round: round.round, verdict: round.verdict, green: run.green === true })
          if (degraded) cell.scanDegraded = true
        }

      // Charge the escape once per reviewer that cleared the final green run, and only there.
      for (const agent of cleanOnGreen) {
        const cell = cellFor(reviewers, [agent, band, surface].join(SEP), {
          agent,
          taskCountBand: band,
          surface,
        })
        cell.misses = (cell.misses ?? 0) + escapes
      }
    }
  }

  return {
    generatedAt: generatedAt ?? new Date().toISOString(),
    nFloor,
    drivers: [...drivers.values()].map((c) => {
      const { model, lane, taskCountBand, surface } = c
      return emit({ model, lane, taskCountBand, surface }, c.phases.length, nFloor, () => driverMetrics(c))
    }),
    planners: [...planners.values()].map((c) => {
      const { model, taskCountBand, surface } = c
      return emit({ model, taskCountBand, surface }, c.phases.length, nFloor, () => driverMetrics(c))
    }),
    reviewers: [...reviewers.values()].map((c) => {
      const { agent, taskCountBand, surface } = c
      return emit({ agent, taskCountBand, surface }, c.rounds.length, nFloor, () => reviewerMetrics(c, fixes))
    }),
    notes: [
      'cells are cohort-scoped (task-count band × surface) because assignment is NOT random — no figure here is comparable across cohorts',
      'planner cells measure the EXECUTION of phases that planner planned — plan quality shows through the executor, never directly',
      'the surface axis is the timing table\'s HEURISTIC over each phase keyFiles (web/, office/, spa/ paths), not a declared field',
      `cells under ${nFloor} samples ABSTAIN and carry no metrics — an abstained cell is not a zero score`,
    ],
  }
}

/** The four driver signals, each with its own named absence. */
function driverMetrics(cell) {
  const phases = cell.phases.map((p) => p.phase)

  const recordedRounds = phases
    .map((p) => p.executionResult?.gateRounds)
    .filter((n) => typeof n === 'number')
  // A phase that recorded nothing is not a zero-round phase; counting it as one would flatter
  // the driver by dividing its real rework over a larger denominator.
  const gateRoundsMean = recordedRounds.length === 0 ? SENTINEL.noGateRounds : sum(recordedRounds) / recordedRounds.length

  const escapeFixesPerPhase = cell.scanDegraded
    ? SENTINEL.scanUnavailable
    : sum(cell.phases.map((p) => p.escapes)) / cell.phases.length

  // Absent halt evidence is NOT evidence of a clean run: those phases stay out of the
  // denominator entirely rather than entering it as zeroes.
  const withHaltEvidence = phases.filter((p) => p.metrics?.haltCount !== undefined)
  const haltRate =
    withHaltEvidence.length === 0
      ? SENTINEL.noHaltEvidence
      : withHaltEvidence.filter((p) => p.metrics.haltCount > 0).length / withHaltEvidence.length

  // Elapsed time on a shared box is not effort, so a recorded halt takes the phase out of the
  // pool (the scoreSpeed rule). A phase with no halt record is not known-halted and stays in.
  const haltFree = phases.filter((p) => spanMinutes(p.metrics) !== null && !(p.metrics.haltCount > 0))
  const minutesPerTask =
    haltFree.length === 0
      ? SENTINEL.noTimestamps
      : // A phase with no task list still represents at least one unit of work; counting it as
        // zero tasks would divide by zero and read as infinitely slow.
        sum(haltFree.map((p) => spanMinutes(p.metrics))) / sum(haltFree.map((p) => Math.max(1, p.taskCount ?? 0)))

  return { gateRoundsMean, escapeFixesPerPhase, haltRate, minutesPerTask }
}

/**
 * The reviewer eval. `catches` is every non-clean round — a false positive is still a finding,
 * so it is not quietly subtracted here; it is reported beside it.
 *
 * A `falsePositive` is a non-clean round whose findings produced NO gate fix at that exact
 * `{phase, round}` on a run that nonetheless ended GREEN. Both halves matter: without the
 * commit-grammar correlation this would be model guesswork, and without the green requirement
 * a finding on a run that never converged would be scored as noise when it may simply have
 * been the reason the run stayed red.
 */
function reviewerMetrics(cell, gateFixes) {
  const backed = new Set(gateFixes.map((f) => `${f.phase}${SEP}${f.round}`))
  const nonClean = cell.rounds.filter((r) => r.verdict !== 'clean')

  const catches = nonClean.length
  const falsePositives = nonClean.filter((r) => r.green && !backed.has(`${r.phase}${SEP}${r.round}`)).length
  const misses = cell.misses ?? 0

  // Recall answers "of the defects that were CATCHABLE here, how many did you catch?" With no
  // catches and no misses there were none, so the answer is not 0 — it is undefined, and 0 is
  // the one rendering a reader would read as "this reviewer catches nothing". That misreading is
  // not hypothetical: on the real corpus quality-pass and code-reviewer sit in the same cohort,
  // and a 0 beside a 1 invites exactly the comparison the data cannot support. Where the escape
  // scan did not run the denominator is UNKNOWABLE for a different reason, and says so.
  const recall = cell.scanDegraded
    ? SENTINEL.scanUnavailable
    : catches + misses === 0
      ? SENTINEL.noFindings
      : catches / (catches + misses)

  return { catches, falsePositives, misses, recall }
}
