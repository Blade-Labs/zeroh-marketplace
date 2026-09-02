/**
 * Roadmap shape definitions — TypeScript-native phase data.
 *
 * These Zod schemas are the single source of truth for phase structure.
 * The consumer's type-check (its `types` gate slot) validates all .phase.ts files against these shapes.
 * Zod `.parse()` in `definePhase()` provides runtime validation at import time.
 *
 * Enforcement: PhaseShape is a discriminated union on `status`. When
 * status is 'done', gate results (typeCheck clean, lint clean, tests
 * pass) and at least 1 validation agent round are REQUIRED — both at
 * the TypeScript level (tsc) and at runtime (Zod parse).
 *
 * Pattern: zeroh2 golden shapes (heuristic — ZeroH-originated construct).
 */

// v13 migration notes (consumers syncing from v12 — additive enum widening;
// historical files keep parsing unmodified):
// - StructuredGateRoundShape.agent adds 'software-architect' and 'self-review'.
//   The five existing identities remain valid.

// v12 migration notes (consumers syncing from v11 — ONE REMOVAL, not additive):
// - BasePhaseFields DROPS `executionMode` (phase 11; nothing ever consulted it). Zod
//   still parses old files (unknown keys strip on the non-strict shape), but a consumer
//   .phase.ts OBJECT LITERAL still carrying `executionMode:` becomes a tsc
//   excess-property error the moment the schema syncs — sweep the key from phase files
//   (one grep) before or with the sync.
//
// v11 migration notes (consumers syncing from v10 — additive/optional, historical
// files keep parsing unmodified):
// - PhaseTask gains optional `interfaces` ({consumes[], produces[]} — exact symbol/
//   contract names for cross-task dependencies, precise enough for a reviewer to
//   grep -F them against the steps).
//
// v10 migration notes (consumers syncing from v9 — all additive/optional, so
// historical files keep parsing unmodified):
// - TransparencyReport gains `decisionRef` (provenance for a non-"None"
//   compromise/skipped — the validator requires it ≥ the enforcement floor).
// - Phase gains `userFacing` + `flag` ({id} | {bootWired, justification}) and
//   `assumptions[]` ({claim, verify, onFalse: 'ESCALATE'} — plan-time tripwires).
// - Arc gains `descopes[]` ({item, ratifiedBy, ratifiedAt}) + `criteriaRatifications[]`.
// - RunnerSummary gains `openFollowups`.
// - debtResolutions status enum widens to add 'planned' + 'operator-pending' (the
//   follow-up contract) — a reader that treats any matching ref as CLOSED MUST
//   re-check these two (planned = open until its via-phase is done; operator-pending
//   = open until disposed post-deploy).
//
// v9 migration notes (consumers syncing from v8):
// - MinimalTask now requires an explicit `minimal: true` discriminant — a task
//   missing PhaseTaskShape's rich fields no longer silently degrades to 3-field
//   validation. Add `minimal: true` to genuinely-minimal historical tasks.
// - Backlog tier labels cap at 200 chars — move blueprint narratives into
//   roadmap/followups/<arcId>.md (arc-sweep's disposition home) and keep one
//   pointer line in the label.
// - StructuredGateRoundShape gains optional `agent` + `verdict`; the bare-string
//   gate-round form is deprecated for newly-done phases (still parses).
// - RunnerSummaryShape.arcId widens to number|string (parity with Arc.id).
// - PhaseTask gains optional `commit` (the task's landed sha) so
//   one-task-one-commit is mechanically verifiable.

import { z } from 'zod'

// ── Gate Result (permissive — for in-progress / recording) ─────────────────

export const GateResultShape = z.object({
  lint: z.enum(['clean', 'warnings', 'errors']),
  typeCheck: z.enum(['clean', 'errors']),
  unitTests: z.object({
    passed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    notes: z.string().optional(),
  }),
  integrationTests: z.object({
    passed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    notes: z.string().optional(),
  }),
  e2eTests: z.object({
    passed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative().optional(),
    notes: z.string().optional(),
  }),
  build: z.enum(['clean', 'errors']),
  preReview: z.enum(['clean', 'errors']).optional(),
})

export type GateResult = z.output<typeof GateResultShape>

// ── Gate Result (strict — required for done phases) ────────────────────────

/** Gate result that enforces all checks pass. Field-by-field:
 *  - lint: 'clean' | 'warnings' (no 'errors')
 *  - typeCheck: 'clean' (literal — 'errors' is a TS error)
 *  - unitTests: passed === total (runtime refine)
 *  - build/integrationTests/e2eTests: recorded but not value-constrained */
export const PassingGateResultShape = z
  .object({
    lint: z.enum(['clean', 'warnings']),
    typeCheck: z.literal('clean'),
    unitTests: z.object({
      passed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      notes: z.string().optional(),
    }),
    integrationTests: z.object({
      passed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      notes: z.string().optional(),
    }),
    e2eTests: z.object({
      passed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative().optional(),
      notes: z.string().optional(),
    }),
    build: z.enum(['clean', 'errors']),
    preReview: z.enum(['clean', 'errors']).optional(),
  })
  .refine((g) => g.unitTests.passed === g.unitTests.total, {
    message: 'All unit tests must pass (passed must equal total)',
    path: ['unitTests'],
  })

export type PassingGateResult = z.output<typeof PassingGateResultShape>

// ── Gate Finding + Round (structured) ──────────────────────────────────────

/** A single actionable finding produced by a code-review agent during a gate round.
 *  Populated by do-phase Step 5 / full-code-review Phase 4. `fixedInCommit` is set
 *  in the subsequent round if the finding was remediated. */
export const GateFindingShape = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  confidence: z.number().int().min(80).max(100).optional(),
  description: z.string().min(10),
  fixedInCommit: z.string().min(7).optional(),
  /** Which spawn reported this finding — 'reviewer-1' / 'reviewer-2' for the
   *  parallel generalists, the specialist's name under a `## Gate specialists`
   *  swap, 'quality-pass' for a Round-0 noted bug a reviewer confirmed. What
   *  makes per-stage gate yield auditable (does reviewer #2 ever catch what
   *  reviewer #1 missed?). Omit when the source is unclear. */
  agent: z.string().min(1).optional(),
})

export type GateFinding = z.output<typeof GateFindingShape>

/** Structured record of one round of validation agents + the findings they raised. */
export const StructuredGateRoundShape = z.object({
  // 0 is valid: the gate numbers the one-shot simplify pass "Round 0", correctness rounds 1..N.
  round: z.number().int().nonnegative(),
  /** Which gate agent produced this round — makes "which gates actually ran"
   *  queryable instead of remembered. Optional for pre-v9 rounds.
   *  'quality-pass' is the merged Round-0 agent (v0.15.0); 'architect-critique'
   *  and 'simplifier' remain valid for phases gated before the merge.
   *  'software-architect' records the Decision-Contract/RESHAPE reviewer.
   *  'self-review' honestly records a driver reviewing its own work. */
  agent: z.enum(['quality-pass', 'architect-critique', 'simplifier', 'code-reviewer', 'test-engineer', 'software-architect', 'self-review']).optional(),
  /** The round's outcome at a glance (clean = zero actionable findings). */
  verdict: z.enum(['clean', 'findings-fixed', 'skipped']).optional(),
  findings: z.array(GateFindingShape).default([]),
  summary: z.string().min(5).optional(),
})

export type StructuredGateRound = z.output<typeof StructuredGateRoundShape>

/** A gate round may be the legacy free-form string (pre-schema-extension phases)
 *  or the new structured form. Both are accepted to preserve backwards
 *  compatibility with existing .phase.ts files.
 *  DEPRECATED for newly-done phases: the bare-string form defeats gate
 *  auditability ('gate passed ok' satisfies a done phase). New phases record
 *  StructuredGateRoundShape entries with `agent` set; audit-roadmap flags
 *  string-form rounds on recently-completed phases. */
export const GateRoundShape = z.union([z.string().min(5), StructuredGateRoundShape])

export type GateRound = z.output<typeof GateRoundShape>

// ── Phase Metrics ───────────────────────────────────────────────────────────

export const PhaseMetricsShape = z.object({
  commits: z.number().int().nonnegative(),
  linesAdded: z.number().int().nonnegative(),
  linesRemoved: z.number().int().nonnegative(),
  filesChanged: z.number().int().nonnegative(),
  testsAtStart: z.number().int().nonnegative(),
  testsAtEnd: z.number().int().nonnegative(),
  testsAdded: z.number().int(),
  /** Time axis — DERIVED by collect-phase-metrics.ts, never hand-typed.
   *  `startedAt`/`completedAt` are the author dates of the first/last commit matching the
   *  phase commit grammar; `haltCount` counts the interruptions the record can actually
   *  evidence (executionResult checkpoints/escalations plus the beacon resume vocabulary
   *  when a beacon file survives). All three are OPTIONAL and follow the honest-absent
   *  convention: a phase whose record cannot support a field carries NO field rather than a
   *  zero standing in for absent data. Presence is deliberately NOT co-required — a
   *  historical phase can have derivable timestamps and an underivable haltCount. */
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  haltCount: z.number().int().min(0).optional(),
})

export type PhaseMetrics = z.output<typeof PhaseMetricsShape>

// ── Transparency Report ─────────────────────────────────────────────────────

/** Structured honesty report written by do-phase after each task executes.
 *  Was previously output only in the conversation; persisting it on the task
 *  makes compromises and shortcuts queryable after the session ends.
 *
 *  ## Field meanings (strict — release-sweep treats all four as debt sources)
 *
 *  - `compromises`: trade-offs accepted under pressure or forced by architect-gate
 *    escalation. Example: "Switched to USD-only because BDT exchange rate API was
 *    blocked by network policy and architect ruled this phase out of scope to fix."
 *  - `hardcoded`: values that should be configurable but aren't (yet). Example:
 *    "1000ms poll interval in lib/services/sync.ts:42 — needs config registry."
 *  - `skipped`: acceptance criteria not fully addressed in this task. Example:
 *    "AC #3 (mobile viewport) not verified — Playwright mobile profile not yet set up."
 *  - `limitations`: PERMANENT design constraints or informational notes — NOT
 *    deferred work. Example: "Composer is single-threaded by design — parallel
 *    invocation would race the catalog cache."
 *
 *  **Anti-pattern caught by audit:** entries in `limitations` containing phrases
 *  like "pre-pilot acceptable", "post-pilot, consider…", "until proper X ships",
 *  "deferred to follow-up", "operator action documented" are disguised debt — they
 *  belong in `compromises` or `skipped`, not `limitations`. release-sweep's
 *  informational-status flag exists for the *truly* permanent case; using it to
 *  launder deferred work is operator drift, not a feature.
 *
 *  Constraints:
 *  - `whatWasDone` and `how` are always content (no null semantics) — require
 *    at least 10 characters so a terse "ok" or "." can't pass.
 *  - `compromises`, `skipped`, `hardcoded`, `limitations` are naturally nullable.
 *    Use the **literal string `"None"`** when a section has nothing to report;
 *    any other content must be at least 10 characters. Short tokens like
 *    "n/a", ".", "tbd" intentionally fail — they're the noise this schema
 *    exists to reject. */
export const TransparencyReportShape = z.object({
  whatWasDone: z.string().min(10),
  how: z.string().min(10),
  compromises: z.union([z.literal('None'), z.string().min(10)]),
  skipped: z.union([z.literal('None'), z.string().min(10)]),
  hardcoded: z.union([z.literal('None'), z.string().min(10)]),
  limitations: z.union([z.literal('None'), z.string().min(10)]),
  /** Provenance for a scope-narrowing trade-off: the architect verdict
   *  (`PROCEED_WITH_FIX`/`ESCALATE_TO_USER` ref) or the user ratification that
   *  authorized it. validate-roadmap-file v2 REQUIRES this whenever `compromises`
   *  or `skipped` is non-`"None"` on a phase planned after arc ROADOPUS (the
   *  ENFORCEMENT_FLOOR) — a compromise recorded only in a commit message (the
   *  1343.6 audit defect) can no longer reach `done`. Optional so the historical
   *  corpus keeps parsing. */
  decisionRef: z.string().min(8).optional(),
})

export type TransparencyReport = z.output<typeof TransparencyReportShape>

// ── Driver (WHO acted) ──────────────────────────────────────────────────────

/** WHO acted and how it was launched. Defined ONCE and referenced by both writers —
 *  PhaseExecutionResult stamps it at completion, PhaseEvalRecord snapshots it into the
 *  measurement record — so the two can never disagree about what an actor id is.
 *
 *  `lane` is an OPEN string: a phase file must load whichever driver wrote it, and a closed
 *  enum makes an unrecognised lane an import-time parse failure indistinguishable from a
 *  corrupt file. Whether a lane is KNOWN is a validation question, answered by the engine at
 *  cli/lib/validate.mjs, which reads the driver registry and WARNS by name. */
export const DriverShape = z.object({
  model: z.string().min(1),
  lane: z.string().min(1),
})

export type Driver = z.output<typeof DriverShape>

// ── Phase Execution Result ──────────────────────────────────────────────────

/** Typed projection of do-phase Step-4b, returned by the phase-executor for one
 *  phase so `do-arc` can mechanically aggregate an arc without re-parsing the
 *  free-text phase `compromises` string (which audit/release-sweep still own).
 *
 *  - `status`: 'done' (gate passed, phase complete), 'escalated' (architect
 *    returned ESCALATE_TO_USER — `escalation` carries the question/options), or
 *    'failed' (gate could not be reached green).
 *  - `compromises`/`skipped`/`hardcoded`: the same four debt categories the
 *    transparency report uses, lifted to arc scope so it composes with
 *    release-sweep. (`limitations` is intentionally omitted — permanent design
 *    notes are not arc-level debt.)
 *  - `surfaced`: architect-critique SURFACED entries worth knowing before deploy.
 *  - `hardStops`: architect-critique HARD-STOP entries by tag — `do-arc` keys its
 *    pre-merge decision on `[MULTI-REPO]` in particular.
 *  - `gateRounds`: how many recorded gate rounds the phase took, INCLUDING round 0 (the
 *    quality pass) — i.e. the length of the `gateRounds[]` array on the phase. One
 *    convention, because `eval-score` means over this number: counting agent rounds only
 *    (round >= 1) made phases 1/2/4/5 read one round cheaper than their siblings until
 *    phase 13.8 trued them. 0 only when no gate agent ran at all (mockup). */
export const PhaseExecutionResultShape = z.object({
  phase: z.number().int().positive(),
  status: z.enum(['done', 'escalated', 'failed', 'checkpoint']),
  /** WHO produced this result — self-reported at result-write time, while the executor still
   *  knows. The workflow runs heterogeneous actors (session models, the detached codex lane),
   *  and outcome-to-actor attribution cannot be reconstructed afterwards from commits alone.
   *  `model` is honest-best-effort (the id the executor believes it runs as); for lane
   *  'codex' the `.building/codex-*.json` journal is the corroborating evidence. Optional so
   *  historical results keep parsing — an absent driver on a NEW result is a gap the
   *  collector can SEE, never a silent zero. Capture only in this arc; the cross-actor
   *  comparisons are EVALLOOP's job. */
  driver: DriverShape.optional(),
  /** The effective role-model policy and where it came from, captured at launch time. */
  modelPolicy: z.object({
    source: z.enum(['invocation', 'config', 'table']),
    preset: z.string().min(1).optional(),
    default: z.string().min(1).optional(),
    roles: z.record(z.string(), z.string().min(1)).optional(),
    judgeModel: z.string().min(1).optional(),
  }).optional(),
  /** WHICH model filled each protocol role, and HOW that role was fulfilled. The role resolver
   *  is the only writer; nothing writes this yet. `via` records resolveRole's `mode` return —
   *  same three values, so an inline fulfillment is never indistinguishable from a native one.
   *  `substituted` is present only when a role fell down its tier chain, and names who was
   *  asked, who answered, and why. Optional: absent means no bindings were recorded, which a
   *  reader must be able to tell apart from zero bindings recorded. */
  roles: z
    .array(
      z.object({
        role: z.string().min(1),
        model: z.string().min(1),
        via: z.enum(['native', 'child-cli', 'inline']),
        substituted: z
          .object({ from: z.string().min(1), to: z.string().min(1), reason: z.string().min(1) })
          .optional(),
      }),
    )
    .optional(),
  /** The honest unbounded-work hand-off (two-exit turn contract): committed state + what to
   *  watch + the exact next step. do-arc respawns on a checkpoint UNCONDITIONALLY — the wake is
   *  owned by contract. committedSha proves the lossless-respawn precondition. REQUIRED when
   *  status === 'checkpoint' (the superRefine below); meaningless otherwise. */
  checkpoint: z
    .object({
      committedSha: z.string().min(7),
      reason: z.string().min(10),
      resume: z.string().min(10),
      watch: z
        .object({
          log: z.string().min(1).optional(),
          pid: z.number().int().positive().optional(),
          doneMarker: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),
  escalation: z
    .object({
      question: z.string().min(10),
      options: z.array(z.string().min(1)),
    })
    .optional(),
  compromises: z.array(z.string().min(10)).default([]),
  skipped: z.array(z.string().min(10)).default([]),
  hardcoded: z.array(z.string().min(10)).default([]),
  surfaced: z.array(z.string().min(10)).default([]),
  hardStops: z
    .array(
      z.object({
        tag: z.enum(['[MULTI-REPO]', '[SCOPED-OUT]', '[PRODUCT]', '[SPECULATIVE]']),
        text: z.string().min(10),
      }),
    )
    .default([]),
  gateRounds: z.number().int().nonnegative(),
}).superRefine((r, ctx) => {
  // A payload-free checkpoint is a nap with a typed costume — the committed sha is the whole
  // point of the hand-off, so the cross-requirement is schema-enforced, never advisory.
  if (r.status === 'checkpoint' && r.checkpoint === undefined) {
    ctx.addIssue({ code: 'custom', path: ['checkpoint'], message: "status 'checkpoint' requires the checkpoint field (committedSha + reason + resume)" })
  }
})

export type PhaseExecutionResult = z.output<typeof PhaseExecutionResultShape>

// ── Runner Summary (the converged arc result the governed-coding runner reads, phase 1045) ──────────

/** The four compromise-disposition tokens — the pre-merge arc-sweep debt vocabulary. The SAME set the
 *  governed-coding consumer single-sources in its CodingJobCallback contract; defined once here so
 *  RunnerSummaryShape reuses it rather than forking a parallel taxonomy. */
export const CompromiseDispositionShape = z.enum(['ACCEPT', 'OPERATOR-PENDING', 'RESOLVE-NOW', 'PLAN-PHASE'])
export type CompromiseDisposition = z.output<typeof CompromiseDispositionShape>

/**
 * RunnerSummaryShape — the ONE typed converged-arc artifact `do-arc` serializes to roadmap/arc-summary.json
 * (Step 8b) and the governed-coding runner reads (fail-closed) into a DriveTerminal. A deliberate
 * near-isomorphism with the runner's DriveTerminal + CodingJobCallback: the runner maps it 1:1 and BLOCKS
 * on any unreadability rather than fabricating a clean arc. `gateSignals` feeds the runner's existing
 * normalizeGateResults unchanged (a malformed/absent signal ⇒ not green ⇒ deploy blocked). `receiptRef` is
 * min(1) so a missing receipt fails .parse() → block; the artifact URLs are optional → honest-absent. The
 * artifact is regenerable + gitignored + written every run, like the Step-1 arc-prompts/ artifact.
 */
export const RunnerSummaryShape = z.object({
  // Same number|string union as Arc.id — a numeric-id arc must not fail Step 8b's parse.
  arcId: z.union([z.number().int().positive(), z.string().min(1)]),
  outcome: z.enum(['shipped', 'halted', 'blocked']),
  reason: z.string().min(1).optional(),
  compromiseDisposition: z.array(
    z.object({ item: z.string().min(1), disposition: CompromiseDispositionShape }),
  ),
  gateSignals: z.object({
    arcSweepClean: z.boolean(),
    validateArcPassed: z.boolean(),
    fullSuiteGreen: z.boolean(),
  }),
  /** Governance-receipt reference for the arc. Required (min 1) — a missing
   *  receipt must fail `.parse()`, never be faked. A consumer with no governance
   *  receipt surface uses the honest literal `'none'` sentinel (parallel to the
   *  `unsigned`/version-0 honest-gap convention), never a fabricated id. */
  receiptRef: z.string().min(1),
  /** Follow-ups the arc left open at close — the count do-arc's ## Merge policy
   *  checks against `max-open-followups` before an autonomous land (phase 1370),
   *  and the follow-up contract (phase 1371) keeps honest. Optional (absent ⇒ not
   *  reported). */
  openFollowups: z.number().int().min(0).optional(),
  screenshotUrl: z.string().url().optional(),
  prUrl: z.string().url().optional(),
  releaseUrl: z.string().url().optional(),
})

export type RunnerSummary = z.output<typeof RunnerSummaryShape>

/**
 * SweepReportShape — arc-sweep Step 3's aggregate, PERSISTED. This IS the merge-readiness
 * report, not a summary of it: the skill assembles this document first and renders the chat
 * report FROM it, so the two can never fork. A fact absent from this file does not exist for
 * any downstream eval — the arc-eval collector reads only disk, never chat history.
 * Recorded by `roadmap eval record-sweep --arc <ID>` into the COMMITTED roadmap/arc-evals/
 * home (roadmap/arc-summaries/ is gitignored by design and holds only the regenerable
 * RunnerSummary). `disposition` reuses CompromiseDispositionShape — one debt vocabulary
 * across the sweep, the runner summary and the transparency reports, never a parallel set.
 */
export const SweepReportShape = z.object({
  // Same number|string union as Arc.id — a numeric-id arc must not fail record-time parse.
  arcId: z.union([z.number().int().positive(), z.string().min(1)]),
  /** ISO date the sweep ran — supplied by the caller; the recorder never mints wall-clock
   *  silently, so a re-recorded sweep is an explicit, visible act. */
  date: z.string().min(10),
  /** Estate-ratchet outcome. `skipped-not-bound` is the honest sentinel for an arc whose
   *  consumer binds no ratchets — never a green standing in for "did not run". */
  estateRatchets: z.enum(['green', 'disposed', 'skipped-not-bound']),
  phaseGates: z
    .array(z.object({ phase: z.number().int().positive(), done: z.boolean(), gateGreen: z.boolean() }))
    .min(1, 'a sweep covers at least one phase'),
  debtDispositions: z.array(
    z.object({ item: z.string().min(1), disposition: CompromiseDispositionShape, ref: z.string().optional() }),
  ),
  /** The whole-arc architect verdict. Free-form but MANDATORY — an arc with no designRefs
   *  records the honest literal ('no designRefs'), never an empty string. */
  architectVerdict: z.string().min(1),
  deferredToReleaseSweep: z.array(z.string()),
  overall: z.enum(['green', 'blocked']),
  blockers: z.array(z.string()),
})

export type SweepReport = z.output<typeof SweepReportShape>

// ── Per-phase eval record (arc POLYSEAT plane 1) ─────────────────────────────

/**
 * PhaseEvalRecordShape — what `roadmap gate run` leaves at
 * roadmap/arc-evals/phase-<N>.peval.json on EVERY run, and what `roadmap eval scorecard`
 * ingests beside the arc traces.
 *
 * The scorecard's driver/planner cells are fed by ARC traces alone, so a consumer that
 * executes ordinary phases without arcs renders zero cells however much work it does
 * (measured in mudarabah2: 0 records, every family under the N-floor). This
 * record is the per-phase inlet that fills them.
 *
 * DETERMINISTIC + ATTRIBUTION ONLY (the arc's ruling): gate slot results, metrics, and an
 * attribution snapshot — zero judge tokens per phase. Judge-scored dimensions stay arc-level
 * in ArcEvalReportShape; a field here that needed a judge call would put a model call on the
 * critical path of every gate run, which is the cost this record exists to avoid.
 *
 * `taskCount` and `keyFiles` are COHORT KEYS, not description: computeScorecard keys every
 * cell on bandFor(taskCount) x surfaceOf(keyFiles). A record omitting them does not lose
 * detail, it MIS-COHORTS into the smallest band and the non-surface cell — contaminating two
 * cells that never saw the work.
 *
 * `date` is CALLER-SUPPLIED, the SweepReportShape discipline: a recorder that mints its own
 * wall clock makes a silent re-record indistinguishable from the original.
 *
 * Every level DECLARED HERE is a strictObject: an unknown key is a parse ERROR, never a silent
 * strip, because a dropped key in a measurement record is a number no later reader can even
 * discover is missing.
 *
 * `metrics` is the ONE exception, and deliberately so: it REUSES PhaseMetricsShape rather than
 * restating it, so a widening there reaches this record for free — and that shape is a plain
 * object, so a key it does not know is stripped. Cloning it strict would make an emit REFUSE
 * every record from a consumer whose plugin is one version ahead, trading a lost key for a lost
 * record. The exception is named here and pinned by scripts/schema.test.ts rather than left for
 * a reader to discover.
 */
export const PhaseEvalRecordShape = z.strictObject({
  phase: z.number().int().positive(),
  /** ISO date the gate run that produced this record happened — supplied by the caller. */
  date: z.string().min(10),
  /** Which consumer produced it, so cross-consumer cells stay comparable. Same three
   *  components ArcEvalReportShape.fingerprint carries, derived offline by
   *  assembleConsumerFingerprint. */
  consumerFingerprint: z.strictObject({
    repo: z.string().min(1),
    language: z.string().min(1),
    corpusSize: z.number().int().nonnegative(),
  }),
  taskCount: z.number().int().nonnegative(),
  keyFiles: z.array(z.string()).default([]),
  /** The slot results AS RUN. A projection of the GateRunReport's rows, not the report: the
   *  plugin-side report shape is not a consumer contract, and the eval reads only these
   *  fields. `exitCode` absent means the slot did not RUN (declared-absent / skipped) — a
   *  zero there would invent a pass. */
  gate: z.strictObject({
    green: z.boolean(),
    slots: z
      .array(
        z.strictObject({
          slot: z.string().min(1),
          exitCode: z.number().int().optional(),
          durationMs: z.number().nonnegative().optional(),
          declaredAbsent: z.boolean().optional(),
        }),
      )
      .default([]),
  }),
  metrics: PhaseMetricsShape.optional(),
  /** WHO planned, drove and filled each role. Read off the phase file at emit time, so it is
   *  as complete as the file is: at execute time usually only `plannedBy` exists, and the
   *  --verify-complete refresh is what adds `driver` once the completion is written. Absent
   *  stays absent — the scorecard maps that to its `unrecorded` cohort, never a guess.
   *  `roles` is the POLYSEAT role-binding snapshot; the role resolver that fills it lands in
   *  plane 4, and until then an emitter that has no bindings writes no key. */
  attribution: z
    .strictObject({
      plannedBy: z.strictObject({ model: z.string().min(1) }).optional(),
      /** `.strict()` CLONES DriverShape strict for this record only. Making the shared
       *  definition strict would retroactively REJECT any consumer phase file whose
       *  executionResult.driver carries an extra key that parses (and is dropped) today —
       *  a contract tightening this phase did not plan and cannot verify across consumers. */
      driver: DriverShape.strict().optional(),
      roles: z.record(z.string().min(1), z.strictObject({ model: z.string().min(1) })).optional(),
    })
    .optional(),
})

export type PhaseEvalRecord = z.output<typeof PhaseEvalRecordShape>

/** The BATCH read shape. The archive is validated through the consumer schema over the tsx
 *  bridge (the plugin carries no second copy of a consumer contract), and a spawn per file
 *  would make reading the archive cost more than producing it — so the whole directory rides
 *  one parse and a bad element is named by its ARRAY INDEX in the issue path. */
export const PhaseEvalRecordListShape = z.array(PhaseEvalRecordShape)

export type PhaseEvalRecordList = z.output<typeof PhaseEvalRecordListShape>

// ── Phase Task ──────────────────────────────────────────────────────────────

export const PhaseTaskShape = z.object({
  /** Task ID: "171.1", "171.2", etc. */
  id: z.string().regex(/^\d+\.\d+$/, 'Task ID must be N.N format (e.g., "171.1")'),
  /** Verb-phrase title */
  title: z.string().min(10, 'Task title must be at least 10 characters'),
  /** Problem context — why this task exists */
  problem: z.string().min(30, 'Problem description must be at least 30 characters'),
  /** Implementation steps — each must reference a specific file */
  steps: z
    .array(
      z.object({
        file: z.string().min(1, 'Step must reference a file path'),
        description: z.string().min(10, 'Step description must be at least 10 characters'),
        line: z.number().int().positive().optional(),
      }),
    )
    .min(1, 'Task must have at least one step with a file path'),
  /** Observable outcomes to verify the task worked */
  acceptanceCriteria: z
    .array(z.string().min(10))
    .min(1, 'At least 1 acceptance criterion required')
    .max(4, 'Maximum 4 acceptance criteria per task'),
  /** Files this task modifies */
  files: z.array(z.string().min(1)).min(1, 'Task must list at least one file'),
  /** Test mode — determines test-engineer involvement during /do-phase execution.
   *  "tdd" = test-engineer writes failing tests BEFORE code (red → green).
   *  "e2e" = test-engineer writes E2E AFTER implementation (blind to source).
   *  "none" = no separate test step (default for docs, infra, config tasks, which author
   *  no test files — a data/docs guard rides the consumer's ratchets/lint lane). */
  testMode: z.enum(['tdd', 'e2e', 'none']).default('none'),
  /** Task IDs from the same phase that must complete before this task can run.
   *  Empty / omitted = strict sequential (previous task is the implicit dep).
   *  Use an explicit list when a task can start earlier than its position suggests
   *  or has a non-obvious dependency. Cross-phase deps go on the Phase, not the Task. */
  dependsOn: z.array(z.string().regex(/^\d+\.\d+$/)).default([]),
  /** Cross-task contract, filled ONLY when this task consumes a sibling task's
   *  output or produces one a later task relies on. Entries are exact symbol/
   *  contract names ("makeWorkIqClient(fetch?) from N.1"), never prose. The wired
   *  reader is EXECUTION-side: the executor grep -F's each consumed terminal
   *  identifier before building (do-phase step 1); produces has no wired grep.
   *  Omit entirely for self-contained tasks. */
  interfaces: z
    .object({
      consumes: z.array(z.string().min(1)).default([]),
      produces: z.array(z.string().min(1)).default([]),
    })
    .optional(),
  /** Opt into batch execution. Defaults false.
   *
   *  Set to true ONLY for genuinely mechanical multi-commit work where the
   *  unit of intent is one task but the unit of commit is many — e.g. rename
   *  Foo to Bar across 22 files, author N parallel shapes from a template.
   *
   *  When true, do-phase enters batch protocol: TaskCreate per step, commit
   *  per step, type-check between, transparency report aggregates across
   *  commits. Sub-agent forks remain forbidden — batchMode is permission to
   *  make many commits inline, not permission to spawn agents.
   *
   *  Plan-time size lint (plan-phase / review-phase) refuses tasks with
   *  files.length > 10 OR steps.length > 6 unless batchMode === true.
   *  When in doubt, split the task instead. */
  batchMode: z.boolean().default(false),
  /** Whether the task is complete */
  done: z.boolean(),
  /** ISO date when completed */
  doneDate: z.string().date().optional(),
  /** The landed commit sha for this task (short or full) — makes the
   *  one-task-one-commit discipline mechanically verifiable. Recorded by
   *  do-phase at task completion; absence on a done task = not captured. */
  commit: z.string().min(7).optional(),
  /** Transparency report from execution — what was done, what was compromised, what was skipped.
   *  Populated by do-phase after each task completes. Absence on a done task = report not captured. */
  transparencyReport: TransparencyReportShape.optional(),
})

export type PhaseTask = z.output<typeof PhaseTaskShape>

// ── Minimal Task (for migrated historical phases with no structured data) ───

/** The `minimal: true` literal is the REQUIRED discriminant (v9): without it, a
 *  rich task missing `problem`/`steps`/`files` would silently degrade to this
 *  3-field validation and every plan-quality rail would evaporate. Only
 *  genuinely-minimal (usually historical) tasks carry the flag. */
export const MinimalTaskShape = z.object({
  minimal: z.literal(true),
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
})

export type MinimalTask = z.output<typeof MinimalTaskShape>

// ── Phase (discriminated union on status) ───────────────────────────────────

/** Fields shared by all phase statuses */
const BasePhaseFields = {
  /** Phase number (unique across all phases) */
  phase: z.number().int().positive(),
  /** Human-readable name */
  name: z.string().min(5),
  /** The PLANNER is an actor too — the model that authored this phase, self-reported at
   *  authoring time and carried through to done. Plan-quality slicing joins on it: without
   *  it, "which planner produces plans that execute cleanly" is unanswerable after the fact.
   *  Optional/additive so every historical phase file keeps parsing. */
  plannedBy: z.object({ model: z.string().min(1) }).optional(),
  /** Durable plan-review evidence. `via: 'executed'` is written only after Mode A actually runs;
   *  `via: 'waived'` records a user `--skip-review` decision with the report line. */
  reviewRecord: z.object({
    date: z.string().min(8),
    model: z.string().min(2),
    verdict: z.enum(['READY', 'NEEDS_WORK', 'BLOCKER']),
    via: z.enum(['executed', 'waived']),
  }).optional(),
  /** Changelog category — determines release note section */
  category: z.enum(['feature', 'fix', 'refactor', 'test', 'docs', 'infra', 'spike']),
  /** Phase kind — drives gate selection in do-phase.
   *  - mockup: UI-only / visual; gate is typecheck + biome only.
   *  - logic: behaviour, business rules, algorithms; full architect→simplifier→reviewer gate. (Default — safe for legacy phases predating v3.)
   *  - hardening: bug fixes, refactors, persistence work; full gate + integration rerun closure (review-phase Mode B 2b).
   *  - release: version cuts, changelog, infra; full gate + e2e in Round 1.
   *  Picker rules in plan-phase. When in doubt between logic and hardening, pick hardening.
   *
   *  The default exists so the v2 → v3 schema bump is non-breaking — legacy
   *  phases parse cleanly and run the full logic gate. New phases must still
   *  pick deliberately at plan time (the picker table is mandatory in
   *  plan-phase Step 3) and migrate/audit.ts surfaces unbackfilled phases. */
  kind: z.enum(['mockup', 'logic', 'hardening', 'release']).default('logic'),
  /** Test-scope ladder for the gate's MECHANICAL test slots (the agent chain
   *  is scoped separately, via `reviewScope` below). Optional: absent →
   *  the gate derives the scope from the diff's path classes (cli/lib/ladder.mjs
   *  deriveTestScope); a declared value may only RAISE the derived floor,
   *  and a `gateSpecialists` config path always forces 'full'. Honored ONLY
   *  when the consumer's roadmap.config.json sets `testCadence` — without it
   *  the gate keeps today's full-suite default, so the field is inert until
   *  a consumer opts in.
   *  static  — lint/types/emit only (docs/data/generated-artifact diffs)
   *  scoped  — tests in/colocated with the diff + `scopedTests` globs
   *  relevant— scoped + the suites exercising the touched modules
   *  full    — the whole kind × mode cell (today's behavior) */
  testScope: z.enum(['static', 'scoped', 'relevant', 'full']).optional(),
  /** Explicit test files/globs the `scoped` tier runs in addition to the
   *  diff-colocated tests (the planner enumerates them; review-phase vetoes
   *  under-scoping). */
  scopedTests: z.array(z.string().min(1)).optional(),
  /** Review-scope ladder for the gate's AGENT chain (cli/lib/ladder.mjs
   *  deriveReviewScope) — the planner's assessment of what review is
   *  genuinely high-value for THIS phase's diff, made at plan time and
   *  ratified by review-phase Mode A (an unjustified low rung = NEEDS WORK).
   *  none  — no review agents; mechanical checks + compromise summary only
   *  light — ONE code-reviewer correctness loop; skip the quality pass
   *  full  — quality pass → 2 reviewers (the default chain)
   *  Absent → the gate derives the rung from the diff. Unlike `testScope`, a
   *  declared value may LOWER the derived rung — except the hard floor: a diff
   *  touching a `## Gate specialists` path always runs 'full' (the gate
   *  refuses a lower declaration rather than honoring it). */
  reviewScope: z.enum(['none', 'light', 'full']).optional(),
  /** Semver of the release this phase ships in */
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  /** Back-reference to the Arc this phase belongs to — mirrors `Arc.id`, so it
   *  accepts the same `number | string` union (an arc may use a letter id like
   *  `"B"`). Optional so every existing .phase.ts across all consumer repos keeps
   *  parsing. do-arc and audit use it to map a phase to its arc; registry
   *  `crossValidate` rejects an arcId with no matching arc and an arcId that
   *  disagrees with the arc whose `planes` list the phase. */
  arcId: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
  /** True when this phase ships user-facing behaviour — the consumer's
   *  flag-first-delivery rule, made schema-visible. The planner sets it; the
   *  validator (v2) ties it to `flag` for phases ≥ ENFORCEMENT_FLOOR. Optional
   *  so historical + non-user-facing phases parse unchanged. */
  userFacing: z.boolean().optional(),
  /** The kill-switch plan for a userFacing phase: either a runtime FlagId
   *  (`{ id }`) or a justified boot-wiring (`{ bootWired: true, justification }`
   *  — a route-mount/sink-construction that can't hot-flip, which then joins the
   *  feature manifest). validate-roadmap-file v2 requires ONE variant when
   *  userFacing:true on a phase ≥ ENFORCEMENT_FLOOR (the 1345 unflagged-feature
   *  audit defect). Optional overall (non-user-facing phases omit it). */
  flag: z
    .union([
      z.object({ id: z.string().min(3) }),
      z.object({ bootWired: z.literal(true), justification: z.string().min(20) }),
    ])
    .optional(),
  /** Plan-time tripwires: falsifiable assumptions the plan rests on, each with a
   *  one-command `verify` and `onFalse: 'ESCALATE'` (a false assumption stops the
   *  phase in its first minute instead of after a quiet five-hour workaround). The
   *  SHAPE lands here so schema changes ship once; the AUTHORING + tripwire
   *  execution land in phase 1372. Optional → additive. */
  assumptions: z
    .array(
      z.object({
        claim: z.string().min(10),
        verify: z.string().min(5),
        onFalse: z.literal('ESCALATE'),
      }),
    )
    .optional(),
  /** Where this phase came from (review, bug report, user request) */
  source: z.string().min(5),
  /** Priority level */
  priority: z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']),
  /** Phase numbers this depends on */
  dependsOn: z.array(z.number().int()),
  /** Phase numbers this conflicts with */
  conflictsWith: z.array(z.number().int()),
  /** Key files touched */
  keyFiles: z.array(z.string()),
  /** One-sentence user-facing description (becomes changelog entry) */
  stakeholderDemo: z.string().min(10),
  /** Structured tasks (full or minimal for historical phases) */
  tasks: z.array(z.union([PhaseTaskShape, MinimalTaskShape])),
  /** Unstructured investigation notes, architecture decisions, analysis (preserved from markdown) */
  notes: z.string().optional(),
  /** Aggregated compromise summary from do-phase — trade-offs, skipped criteria, and
   *  hardcoded values accumulated across tasks. Promoted from commit body so that
   *  phase-level honesty survives outside git. */
  compromises: z.string().optional(),
  /** Closed-debt log. Records resolution lifecycle for non-`"None"` entries in
   *  `tasks[].transparencyReport.{compromises,hardcoded,skipped,limitations}`.
   *
   *  Debt CONTENT lives in transparency reports (immutable per-task audit).
   *  Debt RESOLUTION lives here. Absence of a ref-matching entry = debt is open.
   *
   *  release-sweep walks transparency reports, cross-joins against this array, and
   *  prompts for resolution on any non-`"None"` entry without a matching ref.
   *  Archive refuses while any open debt remains. Release is NOT gated.
   *
   *  Resolution statuses (vocabulary lifted from GitHub Code Scanning):
   *    - 'fixed'     — code change closed it. `via` carries the commit SHA (≥7)
   *                    or phase ref (e.g. "phase-470", ≥7 chars).
   *    - 'won't_fix' — kept as-is for a substantive reason. `via` carries the
   *                    reason (≥20 chars enforced by refinement).
   *    - 'dismissed' — entry was never debt; it was a permanent design constraint
   *                    or informational note logged in the wrong field (or
   *                    correctly in `limitations`). One-click close with optional
   *                    `via` note. Treat high counts as a signal that field
   *                    discipline is slipping.
   *
   *  A clean phase has `debtResolutions: []` until release-sweep runs. */
  debtResolutions: z
    .array(
      z
        .object({
          /** Pointer: `"<taskId>.<field>"` — e.g. `"467.5.hardcoded"` or
           *  `"467.3.compromises"`. Must reference an existing transparencyReport
           *  field with a non-`"None"` value on a task in this phase. */
          ref: z
            .string()
            .regex(
              /^\d+\.\d+\.(compromises|hardcoded|skipped|limitations)$/,
              'ref must be "<taskId>.<field>" (field ∈ compromises|hardcoded|skipped|limitations)',
            ),
          status: z.enum(['fixed', "won't_fix", 'dismissed', 'planned', 'operator-pending']),
          /** Required for 'fixed' (≥7 chars: commit SHA or phase ref) and
           *  'won't_fix' (≥20 chars: substantive reason). Optional for
           *  'dismissed', 'planned', and 'operator-pending' — when present, the
           *  schema accepts any string (no min length enforced); operators are
           *  encouraged but not required to leave a one-line note (e.g. the
           *  authored follow-up phase for 'planned', the deploy step for
           *  'operator-pending'). */
          via: z.string().optional(),
          date: z.string().date(),
        })
        .superRefine((r, ctx) => {
          if (r.status === 'fixed') {
            if (r.via == null) {
              ctx.addIssue({
                code: 'custom',
                path: ['via'],
                message: "'fixed' requires `via` (commit SHA or phase ref ≥7 chars)",
              })
            } else if (r.via.length < 7) {
              ctx.addIssue({
                code: 'custom',
                path: ['via'],
                message: "'fixed' `via` must be ≥7 chars (commit SHA or phase ref)",
              })
            }
          } else if (r.status === "won't_fix") {
            if (r.via == null) {
              ctx.addIssue({
                code: 'custom',
                path: ['via'],
                message: "'won't_fix' requires `via` (substantive reason ≥20 chars)",
              })
            } else if (r.via.length < 20) {
              ctx.addIssue({
                code: 'custom',
                path: ['via'],
                message: "'won't_fix' `via` must be ≥20 chars (substantive reason)",
              })
            }
          }
          // dismissed: via is optional; no length check
        }),
    )
    .default([]),
  /** The typed Step-4b roll-up the phase-executor produced for this phase, when
   *  it ran under an arc (do-phase arc-mode persists it; an inline run leaves it
   *  unset). Makes `do-arc`'s in-context hand-off an OPTIMIZATION rather than the
   *  system of record: a resumed or context-compacted arc reconstructs each
   *  phase's roll-up via `discoverResults()` instead of losing it. Mirrors the
   *  free-text `compromises` string (which stays for audit/release-sweep) with a
   *  machine-readable projection `arc-sweep` aggregates. Optional → non-breaking. */
  executionResult: PhaseExecutionResultShape.optional(),
} as const

/** Gate fields for non-done phases — all optional */
const OptionalGateFields = {
  gate: GateResultShape.optional(),
  gateRounds: z.array(GateRoundShape).optional(),
  metrics: PhaseMetricsShape.optional(),
  completedDate: z.string().date().optional(),
} as const

/** Done phase: gate results required + must pass, validation agents ≥1 round */
const DonePhaseShape = z.object({
  ...BasePhaseFields,
  status: z.literal('done'),
  gate: PassingGateResultShape,
  gateRounds: z.array(GateRoundShape).min(1, 'Validation agents must run at least 1 round'),
  metrics: PhaseMetricsShape,
  completedDate: z.string().date(),
})

const BacklogPhaseShape = z.object({
  ...BasePhaseFields,
  status: z.literal('backlog'),
  ...OptionalGateFields,
})

const InProgressPhaseShape = z.object({
  ...BasePhaseFields,
  status: z.literal('in-progress'),
  ...OptionalGateFields,
})

const CancelledPhaseShape = z.object({
  ...BasePhaseFields,
  status: z.literal('cancelled'),
  ...OptionalGateFields,
})

/**
 * Historical phase: a phase that completed BEFORE the current gate-discipline schema
 * (no gate/gateRounds, partial gate, legacy category/kind vocabulary, or a documented
 * pre-existing red that makes passed≠total). It parses LOOSE so legacy records are
 * accepted AS-RECORDED — never rewritten or falsified to fit the strict DonePhaseShape.
 * Terminal like 'done' (not in the execution backlog), but excluded from the version
 * changelog. The migration protocol's sanctioned alternative to backfilling every phase.
 */
const HistoricalPhaseShape = z.object({
  ...BasePhaseFields,
  // Legacy vocabulary accepted as-is — old phases predate the current category/kind enums.
  category: z.string(),
  kind: z.string().optional(),
  status: z.literal('historical'),
  // Gate data is preserved exactly as recorded (any legacy shape), never required.
  gate: z.unknown().optional(),
  gateRounds: z.unknown().optional(),
  metrics: z.unknown().optional(),
  completedDate: z.string().optional(),
})

export const PhaseShape = z.discriminatedUnion('status', [
  DonePhaseShape,
  BacklogPhaseShape,
  InProgressPhaseShape,
  CancelledPhaseShape,
  HistoricalPhaseShape,
])

export type Phase = z.output<typeof PhaseShape>
export type DonePhase = z.output<typeof DonePhaseShape>

/** Type guard — narrows Phase to DonePhase with required gate/metrics */
export function isDonePhase(phase: Phase): phase is DonePhase {
  return phase.status === 'done'
}

// ── Backlog (ordered execution queue, optionally tiered) ───────────────────

export const BacklogEntryShape = z.object({
  /** Phase number — foreign key to a .phase.ts file */
  phase: z.number().int().positive(),
  /** Human-readable name (cosmetic — phase file is authoritative) */
  name: z.string().min(5),
})

export type BacklogEntry = z.output<typeof BacklogEntryShape>

/** Flat backlog — ordered array of entries. Back-compat input form. */
export const BacklogFlatShape = z.array(BacklogEntryShape)

/** A tier groups related entries under a human-readable header for UI
 *  rendering. `tier` is the sort key (lower runs first); `label` is the
 *  display title; `items` are the entries in execution order within the tier. */
export const BacklogTierShape = z.object({
  tier: z.number().int().nonnegative(),
  /** ONE line. Blueprint narratives live in roadmap/followups/<arcId>.md (the
   *  arc-sweep disposition home) — the label points there. The 200-char cap is
   *  the mechanical enforcement of the backlog's own queue-only rule. */
  label: z.string().min(5).max(200),
  items: z.array(BacklogEntryShape),
})

export type BacklogTier = z.output<typeof BacklogTierShape>

/** Tiered backlog — `{ tiers: [{ tier, label, items }, ...] }`. */
export const BacklogTieredShape = z.object({
  tiers: z.array(BacklogTierShape),
})

export type BacklogTiered = z.output<typeof BacklogTieredShape>

/** Backlog input — either form is accepted. Duplicate phase numbers across
 *  the whole queue (including across tiers) are rejected. `defineBacklog()`
 *  normalizes the parse result to BacklogTiered. */
export const BacklogShape = z
  .union([BacklogFlatShape, BacklogTieredShape])
  .superRefine((value, ctx) => {
    const all = Array.isArray(value) ? value : value.tiers.flatMap((t) => t.items)
    const phases = all.map((e) => e.phase)
    if (new Set(phases).size !== phases.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Backlog must not contain duplicate phase numbers',
      })
    }
  })

/** Output of `defineBacklog()` — always normalized to the tiered form so
 *  consumers have one shape to render. Flat input collapses into a single
 *  `{ tier: 0, label: 'Default', items: [...] }` tier. */
export type Backlog = BacklogTiered

// ── Arc ─────────────────────────────────────────────────────────────────────

/** An Arc is a named, contiguous block of phases shipped as one unit — the
 *  formalization of the hand-rolled "arc" convention (a phase range planned,
 *  executed, swept, and merged together). `do-arc` executes an arc, `plan-arc`
 *  authors one, and `arc-sweep` judges it before merge.
 *
 *  ## Field meanings
 *  - `id`: arc identifier — a positive number or a short string (e.g. `"B"`).
 *    Strings let arcs use a letter namespace distinct from phase numbers.
 *  - `name`: human-readable arc title.
 *  - `baseRef`: the git ref the arc was cut from — the merge target and the
 *    diff base `arc-sweep` reviews against.
 *  - `worktree`: optional path to the git worktree the arc executes in, when it
 *    runs in isolation rather than on `baseRef` directly.
 *  - `singleSeams`: the "hold these single" invariants — seams (a config, a
 *    factory, a shared type) that must stay a SINGLE implementation across the
 *    whole arc. `arc-sweep` judges the arc diff for drift against each one
 *    (3 hardcodes that should have been 1 config, two parallel JSX blocks, …).
 *  - `honestyRails`: honesty constraints the arc must uphold end-to-end (carried
 *    into every phase's gate), e.g. "no phase-numbered comments", "errors surfaced".
 *  - `acceptanceCriteria`: the experience-level Definition of Done — the JTBD as
 *    observable signals (NOT per-phase code DoD). plan-arc authors them WITH the
 *    user; the `validate-arc` stage drives the real flow and an independent judge
 *    scores each. Optional (defaults `[]`) so existing arcs keep parsing.
 *  - `designRefs`: what the arc was DESIGNED against — the front-gate record
 *    (mirror of `acceptanceCriteria`'s back gate). plan-arc's design-first gate
 *    writes one per design decision: an existing pattern it `reused` or a new one
 *    it `designed`; plan-phase phases cite them and `arc-sweep` judges the build's
 *    conformance. Optional (defaults `[]`) so existing arcs keep parsing.
 *  - `planes`: named groups of the arc's phases — the canonical storage form.
 *    **v1 executes phases in `dependsOn` order** (Step 4 of do-arc); a plane is a
 *    presentational grouping surfaced in the execution-prompt and the arc-level
 *    task subjects (`Phase N — Plane X`). A future version will run separate
 *    planes in parallel — until then the grouping does not change execution order.
 *    Don't author this by hand for a single-track arc: pass a flat `phases:
 *    number[]` to `defineArc` and it normalizes to one `Default` plane (the same
 *    flat→tiered convenience `defineBacklog` provides). At least one plane, at
 *    least one phase per plane.
 *  - `status`: arc lifecycle — planning → executing → swept → merged. */
export const ArcPlaneShape = z.object({
  name: z.string().min(1),
  phases: z.array(z.number().int().positive()).min(1),
})

/** A single experience-level acceptance criterion — the job-to-be-done expressed
 *  as an OBSERVABLE signal, not per-phase code DoD. Structured rather than a bare
 *  string because the `validate-arc` orchestrator must read `tier` to choose how to
 *  drive the flow and `signal`/`bar` to brief the independent judge.
 *  - `id`: stable handle (an `IntentVerdict` references it back).
 *  - `job`: the JTBD in user terms ("draft a reply a rep can send unedited").
 *  - `surfaces`: the surface id(s) the job lives on — generic strings the consumer
 *    defines ("console", "office-pane", "chat", …).
 *  - `signal`: the observable proof the job is fulfilled — what the judge looks for.
 *  - `tier`: the cheapest tier that can HONESTLY judge it — `wired` (in-process
 *    logic), `live-ui` (rendered UX needing a screenshot), `live-host` (real
 *    model/masking). The consumer binds each tier to a concrete command.
 *  - `bar`: the UX/quality bar beyond "it works" — what "good" feels like. */
export const AcceptanceCriterionShape = z.object({
  id: z.string().min(1),
  job: z.string().min(10),
  surfaces: z.array(z.string().min(1)).min(1),
  signal: z.string().min(10),
  tier: z.enum(['wired', 'live-ui', 'live-host']),
  bar: z.string().min(10),
})

export type AcceptanceCriterion = z.output<typeof AcceptanceCriterionShape>

/** One design decision the arc was built against — the design-first gate's record,
 *  structured (not a prose note) so plan-phase can cite the exact ref a phase
 *  implements and `arc-sweep` can judge conformance per-ref.
 *  - `kind`: `architecture` (a system pattern in the consumer's arch docs) or `ux`
 *    (a layout/preview in the consumer's UX canon).
 *  - `ref`: a pointer to the design home — an arch-doc section path, or a UX design
 *    note / preview path.
 *  - `status`: `reused` (an existing pattern was cited) or `designed` (a new
 *    pattern/layout was created and the doc extended) — drives the pattern-reuse-first
 *    honesty rail.
 *  - `summary`: one line — what the pattern/design IS, so a reader needn't open the ref. */
export const DesignRefShape = z.object({
  kind: z.enum(['architecture', 'ux']),
  ref: z.string().min(1),
  status: z.enum(['reused', 'designed']),
  summary: z.string().min(10),
  /** Supersession stamp — a later arc that replaces or contradicts this design
   *  STAMPS the old entry rather than silently leaving both current. A stamped
   *  ref is history, never a reuse candidate; the prior-arc search skips it. */
  supersededBy: z
    .object({ byArc: z.string().min(1), reason: z.string().min(10), date: z.string().min(10) })
    .optional(),
})

export type DesignRef = z.output<typeof DesignRefShape>

export const ArcShape = z.object({
  id: z.union([z.number().int().positive(), z.string().min(1)]),
  name: z.string().min(5),
  baseRef: z.string().min(1),
  worktree: z.string().min(1).optional(),
  singleSeams: z.array(z.string().min(10)).default([]),
  honestyRails: z.array(z.string().min(10)).default([]),
  acceptanceCriteria: z.array(AcceptanceCriterionShape).default([]),
  designRefs: z.array(DesignRefShape).default([]),
  /** Typed, user-ratified descopes — the ONLY legitimate way an arc narrows what
   *  it promised. Each records WHAT was dropped, WHO ratified it, and WHEN. A
   *  descope buried in followups prose (never surfaced to the user) is the
   *  scope-leak this closes; arc-sweep's PLAN-PHASE disposition writes here (or
   *  authors the follow-up in-arc) instead. Optional → additive. */
  descopes: z
    .array(
      z.object({
        item: z.string().min(10),
        ratifiedBy: z.string().min(2),
        ratifiedAt: z.string().min(8),
      }),
    )
    .optional(),
  /** Typed rejected alternatives — options a human (or a recorded Decision
   *  Contract verdict) already ruled OUT: interview rulings, losing design-gate
   *  arms, architect-verdict rejects. `decidedBy` carries provenance ('user' |
   *  'software-architect verdict <date>') — decided, not ratified: architect
   *  rejects are recorded decisions, not user ratifications. Append-only (a
   *  rejection is history; validate reds any HEAD entry deleted or rewritten
   *  on a building arc). A future
   *  planner greps this before proposing — a rejection surviving only as
   *  LOCKED-DECISIONS prose is the resurrection-leak this closes.
   *  Optional → additive. */
  rejectedAlternatives: z
    .array(
      z.object({
        option: z.string().min(10),
        why: z.string().min(10),
        decidedBy: z.string().min(2),
        decidedAt: z.string().min(8),
      }),
    )
    .optional(),
  /** Append-only log of legitimate post-planning acceptanceCriteria changes —
   *  each entry is a dated "why". validate-roadmap-file v2 rejects a criteria
   *  edit on a building arc UNLESS this array grew (the 1343.6 silent-drift
   *  defect). Optional → additive. */
  criteriaRatifications: z.array(z.string().min(10)).optional(),
  planes: z.array(ArcPlaneShape).min(1),
  status: z.enum(['planning', 'executing', 'swept', 'merged']).default('planning'),
})

export type Arc = z.output<typeof ArcShape>

/** The independent judge's verdict on ONE acceptance criterion — the typed return
 *  of the `intent-validator` agent that `validate-arc` `.parse()`s (never free prose).
 *  - `criterionId`: the `AcceptanceCriterion.id` this judges.
 *  - `status`: `met` or `gap`.
 *  - `tierUsed`: which tier actually ran — the tier-honesty rail (a `bar`/UX
 *    criterion reported `met` from a `wired` logic run alone is suspect).
 *  - `evidence`: concrete proof the judge observed — a transcript line, a screenshot
 *    path + what it shows, a live response body. Mandatory (min length 1): a `met`
 *    with empty evidence is invalid by construction, so "met without evidence" can't
 *    be expressed.
 *  - `gap`: present iff `status === 'gap'` — what is missing + the suggested fix
 *    (which seeds a corrective phase in the validate→correct loop).
 *  - `confidence`: the judge's confidence in the verdict. */
export const IntentVerdictShape = z
  .object({
    criterionId: z.string().min(1),
    status: z.enum(['met', 'gap']),
    tierUsed: z.enum(['wired', 'live-ui', 'live-host']),
    evidence: z.string().min(1),
    gap: z
      .object({
        whatsMissing: z.string().min(10),
        suggestedFix: z.string().min(10),
      })
      .optional(),
    confidence: z.enum(['high', 'medium', 'low']),
  })
  .refine((v) => v.status === 'met' || !!v.gap, {
    message: 'a gap verdict must describe the gap (whatsMissing + suggestedFix)',
  })

export type IntentVerdict = z.output<typeof IntentVerdictShape>

/**
 * ArcVerdictsFileShape — validate-arc's judge panel, PERSISTED. The panel already `.parse()`s
 * every IntentVerdict at one point and then drops them into chat; this wrapper gives that
 * exact set a disk home so the verified-vs-intent eval dimension is scoreable from the repo
 * alone. Recorded by `roadmap eval record-verdicts --arc <ID>` beside the sweep report.
 * `judgeModel` is the model the panel ACTUALLY ran as (read off the spawn, never a
 * hardcoded default) — a report compared across different judge models is baseline-reset
 * material, so the model has to travel with the verdicts. Defined after IntentVerdictShape
 * because it composes it verbatim rather than restating the judge's contract.
 */
export const ArcVerdictsFileShape = z.object({
  // Same number|string union as Arc.id.
  arcId: z.union([z.number().int().positive(), z.string().min(1)]),
  date: z.string().min(10),
  judgeModel: z.string().min(1),
  /** Every verdict the panel returned, including both sides of a split-panel GAP exactly as
   *  reported. `.min(1)` — a verdicts file with no verdicts is a record of nothing. */
  verdicts: z.array(IntentVerdictShape).min(1, 'a verdicts file records at least one verdict'),
  /** Descopes the user ratified during the validate→correct loop, so a later reader can tell
   *  a ratified narrowing from an unaddressed gap. */
  ratifiedDescopes: z.array(z.string()).optional(),
})

export type ArcVerdictsFile = z.output<typeof ArcVerdictsFileShape>

// ── Arc eval engine (arc EVALCORE) ──────────────────────────────────────────

/**
 * The CLOSED seven-dimension vocabulary an arc is scored on. Closed by construction:
 * `dimensions` below is a record over THIS enum, so a scorer can neither invent an
 * eighth dimension nor silently drop one — both fail `.parse()`. Ownership is per
 * report (the `owner` field), not baked into the key, because a dimension the
 * deterministic scorer cannot compute for a given arc still has to appear.
 */
export const EvalDimensionKeyShape = z.enum([
  'code-confidence',
  'verified-vs-intent',
  'standards-adherence',
  'doc-brevity',
  'composability-testability',
  'speed',
  'plan-quality',
])

export type EvalDimensionKey = z.output<typeof EvalDimensionKeyShape>

/**
 * The CLOSED absent-signal vocabulary. A free-string sentinel drifts ("no data",
 * "n/a", "TBD" all mean the same thing to a human and nothing to a reader), so the
 * six real absences are enumerated: awaiting the judge pass, a backfilled report the
 * judge will never see, no verdicts file, no gate records, no derivable timestamps,
 * and too few comparable priors to form a baseline.
 */
export const EvalSentinelShape = z.enum([
  'pending-judge',
  'unjudged-backfill',
  'no-verdicts-file',
  'no-gate-records',
  'no-timestamps',
  'no-baseline',
])

export type EvalSentinel = z.output<typeof EvalSentinelShape>

/**
 * One scored (or honestly unscored) dimension. `score` XOR `sentinel` is enforced,
 * not documented: a dimension carrying both would let a fabricated number travel
 * beside its own disclaimer, and one carrying neither is silence dressed as data.
 * `sourceRefs` is `.min(1)` for the reproducibility bar — every number in a report
 * names at least one artifact it came from.
 */
export const EvalDimensionShape = z
  .object({
    owner: z.enum(['deterministic', 'judge']),
    score: z.number().min(0).max(100).optional(),
    sentinel: EvalSentinelShape.optional(),
    /** The raw inputs behind the score — numbers or short labels, kept so a reader can
     *  re-derive the value without re-running the collector. */
    signals: z.record(z.string(), z.union([z.number(), z.string()])),
    sourceRefs: z.array(z.string().min(1)).min(1),
    /** The judge's quoted proof. Optional: a deterministic dimension's proof IS its signals. */
    evidence: z.string().optional(),
  })
  .refine((d) => (d.score === undefined) !== (d.sentinel === undefined), {
    message: 'a dimension carries EXACTLY one of score / sentinel (both = a number beside its own disclaimer; neither = silence dressed as data)',
  })

export type EvalDimension = z.output<typeof EvalDimensionShape>

/**
 * One rolling-baseline comparison row. `baseline`/`value`/`delta` are nullable rather
 * than optional so an incomparable dimension is a PRESENT row saying so, never a
 * missing row a reader could mistake for "not regressed". The refine keeps the
 * no-baseline case honest: a regression nobody can quantify is not a regression.
 */
export const EvalRatchetRowShape = z
  .object({
    dimension: EvalDimensionKeyShape,
    baseline: z.number().nullable(),
    value: z.number().nullable(),
    delta: z.number().nullable(),
    regression: z.boolean(),
    /** Why this row is what it is — carries the `no-baseline` sentinel word for the
     *  fewer-than-2-comparable-priors case (the row itself has no sentinel field). */
    note: z.string().optional(),
  })
  .refine((r) => !r.regression || r.delta !== null, {
    message: 'a regression must have a computable delta (a flagged regression with no delta is an unfalsifiable claim)',
  })

export type EvalRatchetRow = z.output<typeof EvalRatchetRowShape>

/**
 * ArcEvalReportShape — the persisted per-arc eval, one dated file under the COMMITTED
 * roadmap/arc-evals/ home. `judgeModel` is absent until the judge pass fills the
 * judge-owned dimensions; recording it per report is what makes a cross-model
 * comparison a visible baseline reset rather than a silent one.
 *
 * `attribution` is CAPTURE-ONLY in this arc: it records which driver produced which
 * phases and which reviewers ran how many rounds, so a later per-actor analysis
 * (EVALLOOP) has real data instead of reconstructing it from commits. An absent
 * driver is recorded as the literal 'unrecorded' model, never a guessed id.
 */
export const ArcEvalReportShape = z.object({
  // Same number|string union as Arc.id.
  arcId: z.union([z.number().int().positive(), z.string().min(1)]),
  date: z.string().min(10),
  judgeModel: z.string().min(1).optional(),
  /** A record over the CLOSED key enum: all seven required, no eighth accepted. */
  dimensions: z.record(EvalDimensionKeyShape, EvalDimensionShape),
  ratchet: z.array(EvalRatchetRowShape),
  attribution: z.object({
    drivers: z.array(
      z.object({
        model: z.string().min(1),
        lane: z.string().min(1),
        phases: z.array(z.number().int().positive()),
      }),
    ),
    /** Planner attribution (mirrors drivers, no lane). OPTIONAL: archived reports predate it. */
    planners: z
      .array(z.object({ model: z.string().min(1), phases: z.array(z.number().int().positive()) }))
      .optional(),
    reviewers: z.array(z.object({ agent: z.string().min(1), rounds: z.number().int().min(0) })),
  }),
  /**
   * The workflow profile the arc ran under. One value today (`prod-grade`); the per-profile
   * seam stays unbuilt until a second profile exists. A RESTAMPABLE fact — it describes how
   * the arc was run, which the corpus knows retroactively.
   */
  profile: z.string().min(1).optional(),
  /**
   * Which BUILD produced this report, so a score shift is attributable to a workflow change
   * rather than to the actor. Stamped ONLY at production time and never backfilled: the build
   * behind a historical report was not recorded, and writing today's sha onto it would
   * fabricate provenance. An absent block is a NAMED gap in `notes`.
   */
  workflow: z
    .object({
      pluginVersion: z.string().min(1),
      pluginSha: z.string().min(7),
      protocolLoadTokens: z.number().int().nonnegative(),
      profile: z.string().min(1),
    })
    .optional(),
  /**
   * Which CONSUMER produced this report, so cross-consumer numbers are comparable. All three
   * components are derivable offline from the checkout, so this is a RESTAMPABLE fact.
   */
  fingerprint: z
    .object({
      repo: z.string().min(1),
      language: z.string().min(1),
      corpusSize: z.number().int().nonnegative(),
    })
    .optional(),
  /** Every gap the report knows about, named in prose for the human reader. */
  notes: z.array(z.string()).default([]),
})
  .refine((r) => !(r.profile && r.workflow) || r.workflow.profile === r.profile, {
    message:
      'workflow.profile must equal profile — the block snapshots the profile its producing workflow ran, so a disagreement is two claims about one fact',
    path: ['workflow', 'profile'],
  })

export type ArcEvalReport = z.output<typeof ArcEvalReportShape>

/**
 * ArcTraceShape — the collector's output: everything the scorer is allowed to look at,
 * read from DISK ONLY (phase files, roadmap/.gate run records, the recorded sweep +
 * verdicts, the regenerable RunnerSummary, git). Every leaf reuses an existing shape
 * rather than restating it, so a widening upstream reaches the eval for free.
 *
 * Absence is expressed as the field being absent (`.optional()`), never as a zero or an
 * empty string — the SCORER owns the single absence→sentinel mapping, so the vocabulary
 * has exactly one application site.
 */
export const ArcTraceShape = z.object({
  // Same number|string union as Arc.id.
  arcId: z.union([z.number().int().positive(), z.string().min(1)]),
  collectedAt: z.string().datetime(),
  phases: z.array(
    z.object({
      phase: z.number().int().positive(),
      executionResult: PhaseExecutionResultShape.optional(),
      metrics: PhaseMetricsShape.optional(),
      plannedBy: z.object({ model: z.string().min(1) }).optional(),
      /** Verbatim from the phase file — the surface-cohort heuristic in the timing stats
       *  reads these paths, and the report names the heuristic as such. */
      keyFiles: z.array(z.string()).default([]),
      taskCount: z.number().int().nonnegative(),
      transparency: z.array(TransparencyReportShape).default([]),
      /** Flattened GateRunReport summaries — the eval needs the rounds and the failure
       *  count, not the full slot payload, and flattening here keeps the plugin-side
       *  GateRunReport shape out of the consumer contract. */
      gateRuns: z
        .array(
          z.object({
            startedAt: z.string().min(1),
            green: z.boolean(),
            rounds: z.array(
              z.object({ round: z.number().int(), agent: z.string().min(1), verdict: z.string().min(1), model: z.string().min(1).optional() }),
            ),
            slotFailures: z.number().int().nonnegative(),
          }),
        )
        .default([]),
      /** Why this phase's record is incomplete. A phase file that will not import is
       *  RECORDED as a parse failure, never dropped: a silently missing phase would
       *  quietly improve every average it should have dragged down. */
      parseError: z.string().min(1).optional(),
    }),
  ),
  sweep: SweepReportShape.optional(),
  verdicts: ArcVerdictsFileShape.optional(),
  summary: RunnerSummaryShape.optional(),
  git: z.object({
    landedAt: z.string().datetime().optional(),
    /** Whether the post-land scan actually RAN. Required, and not defaultable: an empty
     *  `escapeFixes` means "zero escapes" only when this says `complete`. Without it a git
     *  failure would be indistinguishable from a clean arc — and a clean arc scores HIGHER,
     *  so the silent version of this field turns a broken scan into a reward. */
    escapeScan: z.enum(['complete', 'unavailable']),
    /** Fix commits AFTER the arc landed whose SUBJECT names one of the arc's member phases
     *  — the scored escape rate. `sha` min(7) matches the checkpoint sha bar. */
    escapeFixes: z.array(
      z.object({
        sha: z.string().min(7),
        subject: z.string().min(1),
        files: z.number().int().nonnegative(),
      }),
    ),
    /** The count under the previous, unbounded rule: any post-land fix touching any file the
     *  arc touched. It grew with how long ago the arc landed rather than with the arc's
     *  quality, so it is recorded but NOT scored — kept because a scoring-model change whose
     *  old number vanishes cannot be audited. Absent when the scan did not run. */
    escapeFixesFileIntersection: z.number().int().nonnegative().optional(),
    /** What bounds the post-land window. `merge-anchored`: a merge carried the arc's newest
     *  member commit in, so commits after it are genuinely post-land. `tip-anchored`: no such
     *  merge exists (the arc reached the branch by direct commits), so the window is EMPTY by
     *  construction — an empty `escapeFixes` there is an absent measurement, not a clean
     *  record, and the scorer says so in the report notes rather than banking the difference.
     *  `land-record-anchored`: the window is bounded by the dated RunnerSummary's land date — a
     *  NON-member source, so a phase-named post-land fix can no longer become the tip the
     *  boundary derives from and close the window it belongs behind. There an empty
     *  `escapeFixes` IS a measured clean record, and the scorer scores it. */
    escapeWindow: z.enum(['merge-anchored', 'tip-anchored', 'land-record-anchored']).optional(),
  }),
})

export type ArcTrace = z.output<typeof ArcTraceShape>

/**
 * TimingStatsShape — the reference-class table plan-phase / plan-arc cite when they
 * estimate. A PROJECTION, regenerated on every eval run (the dated reports are the
 * archive), so it lives at one un-dated path. `interruptedExcluded` is a first-class
 * count beside `samples`, never folded into it: elapsed time on a shared box is not
 * effort, and a phase that halted is excluded VISIBLY.
 */
export const TimingStatsShape = z.object({
  generatedAt: z.string().datetime(),
  cohorts: z.array(
    z.object({
      taskCountBand: z.string().min(1),
      surface: z.boolean(),
      samples: z.number().int().nonnegative(),
      medianMinutes: z.number().nonnegative(),
      p80Minutes: z.number().nonnegative(),
      interruptedExcluded: z.number().int().nonnegative(),
    }),
  ),
  /** Named caveats — the surface-cohort heuristic and any excluded-phase reasons. */
  notes: z.array(z.string()).default([]),
})

export type TimingStats = z.output<typeof TimingStatsShape>

/**
 * LessonShape — one durable lesson, one JSON document per LINE of the committed
 * roadmap/arc-evals/lessons.jsonl sidecar. JSONL rather than a JSON array because the file is
 * APPEND-ONLY across concurrent sessions on a shared tree: a read-modify-write array would race,
 * and the loser of that race silently drops the lesson it was written to keep.
 *
 * `origin` is the write-provenance groundwork. The consolidating loop may touch ONLY artifacts
 * carrying its own `kind: 'eval-loop'`; a `kind: 'session'` lesson is upstream content it archives
 * and cites but never edits. `writer` is SELF-REPORTED and carries the literal `unrecorded` when
 * the caller does not say — a named gap, never a guessed actor id.
 */
export const LessonShape = z.object({
  ts: z.string().datetime(),
  phase: z.number().int().positive().optional(),
  text: z.string().min(1),
  origin: z.object({
    writer: z.string().min(1),
    kind: z.enum(['session', 'eval-loop']),
  }),
})

export type Lesson = z.output<typeof LessonShape>

/**
 * The CLOSED vocabulary of recurring findings the clustering pass may recognize. An open
 * string here would let the pass invent a class nobody ratified and then rank it against the
 * ones that were — the enum is what keeps the importance rulings table exhaustive.
 */
export const FindingClassShape = z.enum([
  /** The same dimension flagged `regression: true` in >=2 reports' ratchet rows. */
  'recurring-regression',
  /** The same (dimension x sentinel) pair in >=2 reports — a MEASUREMENT gap, not a bad score. */
  'recurring-sentinel',
  /** The same dimension scored below the low-score threshold in >=2 reports. */
  'recurring-low-score',
  /** >=2 lessons sharing one extracted key (a file path or a backticked token). */
  'recurring-lesson-key',
  /** The workflow stamp's protocolLoadTokens over the DIET budget in >=2 stamped reports. */
  'protocol-load-over-budget',
])

/**
 * Which repo a proposal is asking to change. A lane-less proposal is NOT ready (arc EVALLOOP
 * locked decision): without a home, "improve this" is an observation, and the reader has to
 * re-derive the routing the loop already knew.
 */
export const ProposalLaneShape = z.enum(['plugin-generic', 'consumer-specific'])

/** What SHAPE of change is being proposed — closed, because each kind carries a different
 *  payload obligation the ProposalShape refine enforces. */
export const ProposalKindShape = z.enum([
  'review-focus-candidate',
  'skill-amendment',
  'schema-tightening',
  'process-change',
  'reduction',
])

/**
 * The proposal lifecycle. The pass emits ONLY `surfaced` and may flip its OWN surfaced files to
 * `archived`; `ratified` and `rejected` are USER acts. That split is the whole ratify-only
 * guarantee expressed in one field: a status the loop cannot write is a decision it cannot make.
 */
export const ProposalStatusShape = z.enum(['surfaced', 'ratified', 'rejected', 'archived'])

/**
 * One citation behind a proposal. All three fields are load-bearing: the file says WHICH report,
 * the jsonPath says which field inside it, and the excerpt lets a reader judge without opening
 * anything. A proposal whose evidence cannot be re-opened is an opinion wearing a number.
 */
export const ProposalEvidenceShape = z.object({
  /** Repo-relative path of the report or lessons sidecar the finding came from. */
  file: z.string().min(1),
  /** Where inside that document, e.g. `ratchet[2]` or `dimensions.speed.sentinel`. */
  jsonPath: z.string().min(1),
  excerpt: z.string().min(1),
})

/**
 * The prioritizer (design doc, Numbers program): score = importance + max(importance - satisfaction, 0).
 * `importance` comes from the versioned rulings table; `satisfaction` is MEASURED from the corpus,
 * or `null` when the corpus cannot measure it.
 *
 * The refine is the honesty rail: when satisfaction is unmeasured the score is EXACTLY importance.
 * Any other arithmetic on a null would let an unmeasurable class out-rank a measured one on a
 * number nobody computed — the fabricated-figure failure, applied to ranking instead of to scores.
 */
export const OpportunityShape = z
  .object({
    importance: z.number().min(0).max(10),
    satisfaction: z.number().min(0).max(10).nullable(),
    score: z.number().min(0),
    rulingId: z.string().min(1),
    rulingsVersion: z.number().int().positive(),
    /** Names the corpus computation behind `satisfaction`, or the literal unmeasured source. */
    satisfactionSource: z.string().min(1),
  })
  .refine((o) => o.satisfaction !== null || o.score === o.importance, {
    message:
      'an unmeasured satisfaction (null) binds score to importance exactly — any other value ranks this ' +
      'proposal on arithmetic nobody performed',
    path: ['score'],
  })

/** One importance ruling: a class, its 0-10 weight, and WHY. The rationale floor exists because
 *  a weight without a reason cannot be argued with, only obeyed. */
export const ImportanceRulingShape = z.object({
  id: z.string().min(1),
  findingClass: FindingClassShape,
  importance: z.number().min(0).max(10),
  rationale: z.string().min(10),
})

/**
 * The versioned rulings table. Static DATA, not configuration (the SPEED_REFERENCE precedent):
 * two machines must not be able to produce incomparable priorities. Bumping `version` is how a
 * knowing re-prioritization becomes visible instead of silent.
 */
export const ImportanceRulingsTableShape = z.object({
  version: z.number().int().positive(),
  ratified: z.string().min(10),
  rulings: z.array(ImportanceRulingShape).min(1),
})

/**
 * ProposalShape — the ONE contract crossing the plugin/consumer boundary: written by the plugin
 * CLI, committed and read in the consumer repo, and one day ratified into either home.
 *
 * `evidence.min(2)` is the rule-of-three discipline made STRUCTURAL: a single-source finding is
 * an anecdote, and a loop that can emit anecdotes will bury its real findings under them. The
 * floor is enforced here rather than in the clustering code so no second caller can lower it.
 *
 * `writeOrigin` is the provenance seam consolidation checks before touching anything. It is a
 * LITERAL, not an enum: the loop can recognize exactly one origin as its own, and every other
 * value — including one it has never seen — is somebody else's file.
 *
 * The superRefine makes payload/kind pairing TWO-directional. A kind that promises a payload must
 * carry it, and a kind that promises none must not: a process-change smuggling a reviewFocus
 * candidate would route a config edit through a kind the reader believes cannot cause one.
 */
export const ProposalShape = z
  .object({
    /** Slug-shaped and derived from (class, cluster key), so a re-run over the same corpus lands
     *  on the same file instead of accumulating near-duplicates. */
    id: z.string().regex(/^[a-z0-9-]+$/),
    findingClass: FindingClassShape,
    lane: ProposalLaneShape,
    kind: ProposalKindShape,
    title: z.string().min(10),
    rationale: z.string().min(10),
    evidence: z.array(ProposalEvidenceShape).min(2),
    opportunity: OpportunityShape,
    /** The consumer roadmap.config.json reviewFocus entry shape — a CANDIDATE payload only. The
     *  loop never opens that config for writing; ratification is what moves this across. */
    candidateReviewFocus: z
      .object({ id: z.string().min(1), signature: z.string().min(1), guidance: z.string().min(1) })
      .optional(),
    /** Measured tokens against a measured budget, with the ledger that recorded both — never a
     *  fabricated dollar figure (arc honesty rail). */
    reductionTarget: z
      .object({
        flow: z.string().min(1),
        measuredTokens: z.number().int().positive(),
        budgetTokens: z.number().int().positive(),
        ledger: z.string().min(1),
      })
      .optional(),
    writeOrigin: z.literal('roadmap-eval-loop'),
    status: ProposalStatusShape,
    createdAt: z.string().min(10),
    updatedAt: z.string().min(10),
    supersededBy: z.string().min(1).optional(),
    /** Required on `archived`: the pass archives instead of deleting, and an archive with no
     *  stated reason is a deletion that merely left the bytes behind. */
    archivedReason: z.string().min(10).optional(),
  })
  .superRefine((p, ctx) => {
    const PAYLOADS = [
      { kind: 'review-focus-candidate', field: 'candidateReviewFocus' },
      { kind: 'reduction', field: 'reductionTarget' },
    ] as const
    for (const { kind, field } of PAYLOADS) {
      const present = p[field] !== undefined
      if (p.kind === kind && !present)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `kind '${kind}' REQUIRES ${field} — the kind is the promise of that payload`,
        })
      if (p.kind !== kind && present)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message:
            `${field} belongs only to kind '${kind}' — carrying it under '${p.kind}' hides the change's real ` +
            'shape from a reader who filtered on kind',
        })
    }
    if (p.status === 'archived' && p.archivedReason === undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['archivedReason'],
        message: 'status archived REQUIRES archivedReason — an unexplained archive is a silent delete',
      })
  })

export type Proposal = z.output<typeof ProposalShape>
export type ProposalEvidence = z.output<typeof ProposalEvidenceShape>
export type Opportunity = z.output<typeof OpportunityShape>
export type ImportanceRulingsTable = z.output<typeof ImportanceRulingsTableShape>

/** Metrics on a scorecard cell: numbers or NAMED string sentinels, the EvalDimensionShape
 *  `signals` idiom — an unmeasurable metric says so in words rather than reporting a 0. */
const ScorecardMetricsShape = z.record(z.string(), z.union([z.number(), z.string()]))

/** One driver cohort cell: a model/lane pair WITHIN one reference class, never across. */
const ScorecardDriverCellShape = z.object({
  model: z.string().min(1),
  lane: z.string().min(1),
  taskCountBand: z.string().min(1),
  surface: z.boolean(),
  samples: z.number().int().nonnegative(),
  abstained: z.boolean(),
  metrics: ScorecardMetricsShape.optional(),
})

/** One planner cohort cell — ScorecardDriverCellShape minus lane (planning has no lane). */
const ScorecardPlannerCellShape = z.object({
  model: z.string().min(1),
  taskCountBand: z.string().min(1),
  surface: z.boolean(),
  samples: z.number().int().nonnegative(),
  abstained: z.boolean(),
  metrics: ScorecardMetricsShape.optional(),
})

/** One reviewer cohort cell. `samples` counts ROUNDS SAT, not phases: a reviewer's evidence
 *  is the rounds it actually judged. */
const ScorecardReviewerCellShape = z.object({
  agent: z.string().min(1),
  taskCountBand: z.string().min(1),
  surface: z.boolean(),
  samples: z.number().int().nonnegative(),
  abstained: z.boolean(),
  metrics: ScorecardMetricsShape.optional(),
})

/** The two rails every cell obeys, enforced identically on both arrays so the reviewer axis
 *  can never drift into a laxer standard than the driver axis. */
function refineScorecardCells(
  cells: { samples: number; abstained: boolean; metrics?: unknown }[],
  key: 'drivers' | 'planners' | 'reviewers',
  nFloor: number,
  ctx: z.RefinementCtx,
): void {
  cells.forEach((cell, i) => {
    if (cell.abstained !== cell.samples < nFloor)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key, i, 'abstained'],
        message:
          `abstained must be exactly (samples < nFloor): samples ${cell.samples}, nFloor ${nFloor}. ` +
          'Below the floor a cell is an anecdote and must abstain; at or above it, abstaining hides a real reading.',
      })
    if (cell.abstained === (cell.metrics !== undefined))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key, i, 'metrics'],
        message:
          'a cell carries EXACTLY one of metrics / abstention — an abstained cell with metrics lets an ' +
          'under-sampled number travel beside its own disclaimer, and a scored cell with none is a rank with nothing behind it',
      })
  })
}

/**
 * ScorecardShape — the per-actor outcome slices. `nFloor` is STAMPED into the document so a
 * change to the floor is a visible model change rather than a silent re-ranking, the same
 * discipline the SPEED_REFERENCE declared resets follow.
 *
 * Cells are COHORT-SCOPED (taskCountBand × surface, the TimingStats axes) because work is not
 * randomly assigned to actors: a driver handed the hard phases would look slow in any pooled
 * mean. No field of this shape may ever carry a cross-cohort raw mean — comparison is within a
 * cohort or not at all, which is why there is no summary row to put one in.
 *
 * The root superRefine is what makes an abstained cell unmistakable BY CONSTRUCTION rather than
 * by convention: it can never carry a number a reader could mistake for a zero score.
 */
export const ScorecardShape = z
  .object({
    generatedAt: z.string().datetime(),
    nFloor: z.number().int().positive(),
    drivers: z.array(ScorecardDriverCellShape),
    /** Planner cells (OPTIONAL: archived scorecards predate the axis). */
    planners: z.array(ScorecardPlannerCellShape).optional(),
    reviewers: z.array(ScorecardReviewerCellShape),
    notes: z.array(z.string()).default([]),
  })
  .superRefine((card, ctx) => {
    refineScorecardCells(card.drivers, 'drivers', card.nFloor, ctx)
    if (card.planners) refineScorecardCells(card.planners, 'planners', card.nFloor, ctx)
    refineScorecardCells(card.reviewers, 'reviewers', card.nFloor, ctx)
  })

export type Scorecard = z.output<typeof ScorecardShape>

/**
 * The dimensions a judge verdict is REQUIRED to cover. Ownership itself stays per REPORT
 * (`EvalDimension.owner`) — this list is the judge's COVERAGE obligation, not a claim about
 * who owns a given report's dimensions, which is why `eval merge-judge` adjudicates the
 * ownership seam against the report rather than the shape doing it here.
 * `JUDGE_DIMENSIONS` in cli/lib/eval-score.mjs is the mjs-side mirror of this list.
 */
export const JUDGE_OWNED_DIMENSION_KEYS = [
  'standards-adherence',
  'doc-brevity',
  'composability-testability',
  'plan-quality',
] as const

/**
 * One judged dimension. `evidence` is `.min(30)` for the same reason IntentVerdict makes
 * evidence mandatory: a score nobody can trace back to a file:line or a diff hunk is an
 * opinion wearing a number's clothes, and averaging it into a baseline launders it.
 */
const ArcEvalJudgeDimensionShape = z.object({
  score: z.number().min(0).max(100),
  evidence: z.string().min(30),
  confidence: z.enum(['high', 'medium', 'low']),
})

/**
 * ArcEvalJudgeVerdictShape — what the pinned arc-eval-judge returns, and the ONLY door its
 * output uses to reach a report (`eval merge-judge`). `judgeModel` is SELF-REPORTED: the
 * agent says what it ran as and merge-judge cross-checks it against the pin, so a
 * wrong-model pass becomes a loud baseline reset instead of a silent average.
 *
 * ## Coverage is TOTAL, and that is what makes `skipped` real
 * Every key in `JUDGE_OWNED_DIMENSION_KEYS` must appear EXACTLY ONCE — scored in
 * `dimensions`, or listed in `skipped` with a reason. Neither is a silent omission (the
 * failure this contract exists to stop); both is a dimension carrying a score beside its own
 * disclaimer, the same incoherence `EvalDimensionShape`'s score-XOR-sentinel refine forbids
 * one level down. A judge that cannot honestly score something therefore has a REACHABLE
 * downgrade path and never has to guess.
 *
 * ## Why `dimensions` is keyed by z.string() and validated in the refine
 * `z.record(EvalDimensionKeyShape, …optional())` looks like the obvious spelling and is a
 * trap: zod materializes EVERY enum key in the output, so an omitted key comes back present
 * with value `undefined`. A coverage check written over `Object.keys` or `key in` would then
 * pass every verdict vacuously — enforcement that reads as implemented and enforces nothing.
 * A string-keyed record keeps "absent" genuinely absent, keeps the value REQUIRED (so an
 * explicit `undefined` is rejected and absence has one wire representation), and moves the
 * closed-vocabulary check into the refine where it can name the offending key.
 *
 * Deterministic-owned keys are deliberately ACCEPTED here: ownership is per report, so the
 * shape cannot know it, and `eval merge-judge` refuses them with its own exit code and the
 * seam named. A second, weaker copy of that rule in the shape could only disagree with it.
 */
export const ArcEvalJudgeVerdictShape = z
  .object({
    // Same number|string union as Arc.id.
    arcId: z.union([z.number().int().positive(), z.string().min(1)]),
    judgeModel: z.string().min(1),
    dimensions: z.record(z.string(), ArcEvalJudgeDimensionShape),
    skipped: z.array(z.object({ dimension: EvalDimensionKeyShape, why: z.string().min(10) })).optional(),
  })
  .superRefine((v, ctx) => {
    const scored = new Set(Object.keys(v.dimensions ?? {}))
    for (const key of scored)
      if (!EvalDimensionKeyShape.safeParse(key).success)
        ctx.addIssue({
          code: 'custom',
          path: ['dimensions', key],
          message: `'${key}' is not one of the seven scored dimensions — a judge cannot invent a dimension`,
        })

    const skippedKeys = (v.skipped ?? []).map((s) => s.dimension)
    if (new Set(skippedKeys).size !== skippedKeys.length)
      ctx.addIssue({
        code: 'custom',
        path: ['skipped'],
        message: 'a dimension is skipped twice — two contradictory reasons for one skip is silence dressed as data',
      })
    const skipped = new Set(skippedKeys)

    for (const key of JUDGE_OWNED_DIMENSION_KEYS) {
      if (scored.has(key) && skipped.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['skipped'],
          message: `'${key}' is both scored and skipped — a score beside its own disclaimer`,
        })
      else if (!scored.has(key) && !skipped.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['dimensions', key],
          message: `'${key}' is neither scored nor skipped — a judge-owned dimension may not be silently omitted (skip it with a reason instead)`,
        })
    }
  })

export type ArcEvalJudgeVerdict = z.output<typeof ArcEvalJudgeVerdictShape>

/** Flat authoring form: a single-track arc lists its phases directly via
 *  `phases: number[]` instead of spelling out a one-plane `planes` array.
 *  `defineArc` collapses it to a single `Default` plane — mirroring how
 *  `defineBacklog` collapses a flat entry array into one `tier: 0` tier. */
export const ArcFlatInputShape = ArcShape.omit({ planes: true }).extend({
  phases: z.array(z.number().int().positive()).min(1),
})

/** Accepted `defineArc` input — either the canonical `planes` form or the flat
 *  `phases` form. The output is always normalized to the `planes` form (`Arc`). */
export const ArcInputShape = z.union([ArcShape, ArcFlatInputShape])

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Define a phase with compile-time type checking and runtime Zod validation.
 * Use in .phase.ts files: `export default definePhase({ ... })`
 *
 * When status is 'done', the following are enforced at both compile-time
 * and runtime:
 *  - gate.typeCheck must be 'clean'
 *  - gate.lint must be 'clean' or 'warnings'
 *  - gate.unitTests.passed must equal total
 *  - gateRounds must have at least 1 entry
 *  - metrics and completedDate must be present
 */
export function definePhase(input: z.input<typeof PhaseShape>): Phase {
  return PhaseShape.parse(input)
}

/**
 * Define the ordered execution backlog with runtime Zod validation.
 *
 * Use in backlog.ts in either form:
 * ```ts
 * // 1. Flat (back-compat)
 * defineBacklog([{ phase: 18, name: 'Foo' }])
 * // 2. Tiered (renderable headers)
 * defineBacklog({
 *   tiers: [
 *     { tier: 0, label: 'Sentinel becomes daily driver', items: [...] },
 *   ],
 * })
 * ```
 *
 * Returns the normalized tiered form. Flat input becomes a single
 * `{ tier: 0, label: 'Default', items: [...] }` tier so callers always see
 * one shape. First entry of the lowest tier is next to execute. Duplicate
 * phase numbers across the whole queue are rejected.
 */
export function defineBacklog(input: z.input<typeof BacklogShape>): Backlog {
  const parsed = BacklogShape.parse(input)
  if (Array.isArray(parsed)) {
    return { tiers: [{ tier: 0, label: 'Default', items: parsed }] }
  }
  return parsed
}

/**
 * Normalize a flat `phases` input (single-track arc) to the canonical `planes`
 * form. Shared by `defineArc` and the registry's defensive arc discovery so the
 * two never drift on what "flat" means.
 */
export function normalizeArc(parsed: z.output<typeof ArcInputShape>): Arc {
  if ('planes' in parsed) return parsed
  const { phases, ...rest } = parsed
  return { ...rest, planes: [{ name: 'Default', phases }] }
}

/**
 * Define an Arc with compile-time type checking and runtime Zod validation.
 * Use in .arc.ts files: `export default defineArc({ ... })`
 *
 * Accepts either the canonical `planes` form or the flat `phases` form (a
 * single-track arc), applies defaults (`singleSeams`/`honestyRails` → `[]`,
 * `status` → 'planning'), normalizes to the `planes` output, and rejects an arc
 * with no phases or an empty plane at import time.
 */
export function defineArc(input: z.input<typeof ArcInputShape>): Arc {
  return normalizeArc(ArcInputShape.parse(input))
}
