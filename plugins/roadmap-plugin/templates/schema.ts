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

import { z } from 'zod'

// ── Gate Result (permissive — for in-progress / recording) ─────────────────

export const GateResultShape = z.object({
  lint: z.enum(['clean', 'warnings', 'errors']),
  typeCheck: z.enum(['clean', 'errors']),
  unitTests: z.object({
    passed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
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
  /** Whether the task is complete */
  done: z.boolean(),
  /** ISO date when completed */
  doneDate: z.string().date().optional(),
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
  category: z.enum(['feature', 'fix', 'refactor', 'test', 'docs', 'infra']),
  /** Semver of the release this phase ships in */
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
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
  /** Execution mode: sequential = one task at a time with commit between each (default). parallel = agent batching allowed for truly independent tasks. */
  executionMode: z.enum(['sequential', 'parallel']).default('sequential'),
  /** Structured tasks (full or minimal for historical phases) */
  tasks: z.array(z.union([PhaseTaskShape, MinimalTaskShape])),
  /** Unstructured investigation notes, architecture decisions, analysis (preserved from markdown) */
  notes: z.string().optional(),
} as const

/** Gate fields for non-done phases — all optional */
const OptionalGateFields = {
  gate: GateResultShape.optional(),
  gateRounds: z.array(z.string()).optional(),
  metrics: PhaseMetricsShape.optional(),
  completedDate: z.string().date().optional(),
} as const

/** Done phase: gate results required + must pass, validation agents ≥1 round */
const DonePhaseShape = z.object({
  ...BasePhaseFields,
  status: z.literal('done'),
  gate: PassingGateResultShape,
  gateRounds: z.array(z.string()).min(1, 'Validation agents must run at least 1 round'),
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

export const PhaseShape = z.discriminatedUnion('status', [
  DonePhaseShape,
  BacklogPhaseShape,
  InProgressPhaseShape,
  CancelledPhaseShape,
])

export type Phase = z.output<typeof PhaseShape>
export type DonePhase = z.output<typeof DonePhaseShape>

/** Type guard — narrows Phase to DonePhase with required gate/metrics */
export function isDonePhase(phase: Phase): phase is DonePhase {
  return phase.status === 'done'
}

// ── Backlog (ordered execution queue) ───────────────────────────────────────

export const BacklogEntryShape = z.object({
  /** Phase number — foreign key to a .phase.ts file */
  phase: z.number().int().positive(),
  /** Human-readable name (cosmetic — phase file is authoritative) */
  name: z.string().min(5),
})

export type BacklogEntry = z.output<typeof BacklogEntryShape>

export const BacklogShape = z
  .array(BacklogEntryShape)
  .refine(
    (arr) => new Set(arr.map((e) => e.phase)).size === arr.length,
    { message: 'Backlog must not contain duplicate phase numbers' },
  )

export type Backlog = z.output<typeof BacklogShape>

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
 * Use in backlog.ts: `export default defineBacklog([...])`
 *
 * First entry is next to execute. No duplicate phase numbers allowed.
 */
export function defineBacklog(input: z.input<typeof BacklogShape>): Backlog {
  return BacklogShape.parse(input)
}
