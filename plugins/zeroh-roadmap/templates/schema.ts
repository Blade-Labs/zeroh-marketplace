/**
 * Roadmap shape definitions — TypeScript-native phase data.
 *
 * These Zod schemas are the single source of truth for phase structure.
 * `pnpm type-check` validates all .phase.ts files against these shapes.
 * Zod `.parse()` in `definePhase()` provides runtime validation at import time.
 *
 * Enforcement: PhaseShape is a discriminated union on `status`. When
 * status is 'done', gate results (typeCheck clean, lint clean, tests
 * pass) and at least 1 validation agent round are REQUIRED — both at
 * the TypeScript level (tsc) and at runtime (Zod parse).
 *
 * Pattern: zeroh2 golden shapes (heuristic — ZeroH-originated construct).
 */

// @zeroh-roadmap-schema v7
// Bump this marker whenever the canonical schema gains a feature. The
// SessionStart drift check in using-zeroh-roadmap greps for this exact line
// to decide whether a target repo is behind the plugin. Keep the comment
// literal (no template syntax) so a simple grep is sufficient.

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
})

export type GateFinding = z.output<typeof GateFindingShape>

/** Structured record of one round of validation agents + the findings they raised. */
export const StructuredGateRoundShape = z.object({
  round: z.number().int().positive(),
  findings: z.array(GateFindingShape).default([]),
  summary: z.string().min(5).optional(),
})

export type StructuredGateRound = z.output<typeof StructuredGateRoundShape>

/** A gate round may be the legacy free-form string (pre-schema-extension phases)
 *  or the new structured form. Both are accepted to preserve backwards
 *  compatibility with existing .phase.ts files. */
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
})

export type TransparencyReport = z.output<typeof TransparencyReportShape>

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
 *  - `gateRounds`: how many correctness rounds the gate took (0 for mockup). */
export const PhaseExecutionResultShape = z.object({
  phase: z.number().int().positive(),
  status: z.enum(['done', 'escalated', 'failed']),
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
})

export type PhaseExecutionResult = z.output<typeof PhaseExecutionResultShape>

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
   *  "none" = no separate test step (default for docs, infra, config tasks). */
  testMode: z.enum(['tdd', 'e2e', 'none']).default('none'),
  /** Task IDs from the same phase that must complete before this task can run.
   *  Empty / omitted = strict sequential (previous task is the implicit dep).
   *  Use an explicit list when a task can start earlier than its position suggests
   *  or has a non-obvious dependency. Cross-phase deps go on the Phase, not the Task. */
  dependsOn: z.array(z.string().regex(/^\d+\.\d+$/)).default([]),
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
  /** Transparency report from execution — what was done, what was compromised, what was skipped.
   *  Populated by do-phase after each task completes. Absence on a done task = report not captured. */
  transparencyReport: TransparencyReportShape.optional(),
})

export type PhaseTask = z.output<typeof PhaseTaskShape>

// ── Minimal Task (for migrated historical phases with no structured data) ───

export const MinimalTaskShape = z.object({
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
  /** Execution mode: sequential = one task at a time with commit between each (default). parallel = agent batching allowed for truly independent tasks. */
  executionMode: z.enum(['sequential', 'parallel']).default('sequential'),
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
          status: z.enum(['fixed', "won't_fix", 'dismissed']),
          /** Required for 'fixed' (≥7 chars: commit SHA or phase ref) and
           *  'won't_fix' (≥20 chars: substantive reason). Optional for
           *  'dismissed' — when present, the schema accepts any string (no min
           *  length enforced); operators are encouraged but not required to
           *  leave a one-line note. */
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
  label: z.string().min(5),
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

export const ArcShape = z.object({
  id: z.union([z.number().int().positive(), z.string().min(1)]),
  name: z.string().min(5),
  baseRef: z.string().min(1),
  worktree: z.string().min(1).optional(),
  singleSeams: z.array(z.string().min(10)).default([]),
  honestyRails: z.array(z.string().min(10)).default([]),
  planes: z.array(ArcPlaneShape).min(1),
  status: z.enum(['planning', 'executing', 'swept', 'merged']).default('planning'),
})

export type Arc = z.output<typeof ArcShape>

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
