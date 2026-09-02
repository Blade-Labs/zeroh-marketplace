/**
 * config — THE roadmap.config.json loader (arc ROADCODE singleSeam #1). Every CLI
 * command, both hooks, and every workflow script obtain consumer bindings through
 * loadConfig(cwd); nothing anywhere re-parses consumer markdown heading blocks, ever.
 *
 * Contract (ROADCODE-DESIGN.md §1, locked decisions 1-2):
 *  - Fixed path <git-toplevel>/roadmap/roadmap.config.json (NOT configurable).
 *    ROADMAP_CONFIG=<path> overrides the path for FIXTURES/TESTS ONLY.
 *  - Strict Zod at EVERY object level — a typo'd key is an error, never a silent no-op.
 *  - Fail loud: absence / parse / validation each throw a typed ConfigError; the CLI
 *    maps it to exit 1 and prints messageLines to stderr. No markdown-heading
 *    fallback, no guessed defaults, no dual-read — ever.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { z } from 'zod'
import { gitToplevel } from './gitroot.mjs'
import { roadmapRoot, RoadmapRootError } from './roadmap-root.mjs'

/** Typed load failure. kind ∈ 'absent' | 'invalid' | 'unreadable' | 'ambiguous'. */
export class ConfigError extends Error {
  constructor(kind, messageLines) {
    super(messageLines.join('\n'))
    this.name = 'ConfigError'
    this.kind = kind
    this.messageLines = messageLines
  }
}

const nonEmpty = z.string().min(1)

const GateCommandsShape = z.strictObject({
  lint: nonEmpty,
  types: nonEmpty,
  unit: nonEmpty,
  integration: nonEmpty,
  build: nonEmpty,
  e2e: nonEmpty, // a real command OR the literal "none" (absent-by-declaration; "none" is non-empty)
  emit: nonEmpty,
  // optional scoped/impacted slots — {files}/{range} placeholders, substituted verbatim by slots.mjs (1656)
  'unit-scoped': nonEmpty.optional(),
  'integration-scoped': nonEmpty.optional(),
  'unit-impacted': nonEmpty.optional(),
  'integration-impacted': nonEmpty.optional(),
  // optional hygiene/conditional/sweep slots (1792): lint-diff runs diff-scoped at every phase
  // gate ({base} placeholder); types-web is a gateConditionalSlots target; ratchets is the
  // arc-sweep estate pack. Unbound => a NAMED skip, never a silent hole.
  'lint-diff': nonEmpty.optional(),
  'types-web': nonEmpty.optional(),
  ratchets: nonEmpty.optional(),
})

const TestCadenceShape = z.strictObject({
  enabled: z.boolean().optional(),
  backstop: z.string().optional(),
  floors: z.enum(['blocking', 'advisory', 'none']).optional(),
  // build-slot cadence: absent = 'phase' (build runs at every phase gate, today's
  // behavior); 'arc-end' defers the inline build slot to the arc-end run, where
  // ARC_SLOTS/do-arc Step 8 still runs it unconditionally (ladder.mjs gateCell).
  build: z.enum(['phase', 'arc-end']).optional(),
})

const MergePolicyShape = z.strictObject({
  arcIntegration: z.enum(['autonomous', 'hold']),
  maxOpenFollowups: z.number().int().nonnegative(),
  autonomousPushRefs: z.array(z.string()),
  primaryCheckout: z.string(),
  // arc-land refusal ceiling on commits-behind-baseRef; default 100 applied at the
  // use-site in landing.mjs (`?? 100`, the maxOpenFollowups idiom) — MECHRATCHET rank 6.
  staleBaseCeiling: z.number().int().positive().optional(),
  // arc-end suite scope: default 'full' applied at the landing.mjs use-site (the
  // staleBaseCeiling `??` idiom), honored for EVERY integration model (the direct-only
  // guard is retired — user ruling 2026-07-21: arcs land on touched-scope tests, CI's
  // pipeline is the full-suite gate). 'defer-ci' skips local suites entirely; the
  // RunnerSummary records the deferral honestly (never a fake green).
  arcEndSuite: z.enum(['full', 'impacted', 'defer-ci']).optional(),
  // validate-arc GAPS handling under do-arc (user ruling 2026-07-18): 'autonomous' = run the
  // bounded corrective loop unattended (plan -> do -> re-validate until PASS) and land on the
  // judge's PASS; 'hold' (default, fail-safe) = pause for the user's go. Bound exhaustion and
  // descope ratification ALWAYS stop for the user regardless of this key.
  gapsCorrection: z.enum(['autonomous', 'hold']).optional(),
})

const ModelPolicyShape = z.strictObject({
  judgeModel: z.string(),
})

const GateSpecialistShape = z.strictObject({
  paths: z.array(z.string()),
  agent: z.string(),
})

const ValidationTierShape = z.strictObject({
  command: z.string(),
  scopedSlot: z.string().optional(),
  variants: z.record(z.string(), z.string()).optional(),
  notes: z.string().optional(),
})

const ValidationTiersShape = z.strictObject({
  wired: ValidationTierShape.optional(),
  'live-ui': ValidationTierShape.optional(),
  'live-host': ValidationTierShape.optional(),
})

const DesignHomesShape = z.strictObject({
  architecture: z
    .strictObject({ home: z.string(), extendProtocol: z.string().optional() })
    .optional(),
  ux: z
    .strictObject({
      canon: z.array(z.string()).optional(),
      qualityExemplar: z.string().optional(),
      copyRules: z.string().optional(),
      bindingDesignSystem: z.string().optional(),
      superseded: z.string().optional(),
    })
    .optional(),
})

const ReviewFocusShape = z.strictObject({
  id: z.string(),
  signature: z.string(),
  guidance: z.string(),
})

const ExecShape = z.strictObject({
  preReview: z.string().nullable().optional(),
  longRunWrapper: z.string().nullable().optional(),
})

/** Per-box executor-admission policy bounds (phase 11). ALL optional — an absent field keeps
 *  the DEFAULT_CAPACITY value in cli/lib/capacity.mjs (no shape-level defaults, so the parse
 *  round-trips byte-faithful and never overwrites the lib defaults with invented values).
 *  Positive integers only: a zero bound would divide the admission math by zero. */
const CapacityConfigShape = z.strictObject({
  memPerExecutorMb: z.number().int().positive().optional(),
  minFreeMemMb: z.number().int().positive().optional(),
  loadPerExecutor: z.number().int().positive().optional(),
  maxExecutors: z.number().int().positive().optional(),
})

/** The full roadmap.config.json shape (ROADCODE-DESIGN.md §1, configVersion 1). */
export const RoadmapConfigShape = z.strictObject({
  $schema: z.string().optional(),
  configVersion: z.literal(1),
  gateCommands: GateCommandsShape,
  // Conditional gate slots (1792.2) — the generic diff-triggered mechanism: when ANY changed path
  // matches an entry's globs, the named slot joins the phase gate (uc02 binds ONE instance:
  // src/contracts/** -> types-web, the web exhaustive-vocabulary catch). Optional; absent = none.
  gateConditionalSlots: z
    .array(z.strictObject({ whenDiffMatches: z.array(nonEmpty).min(1), slot: nonEmpty }))
    .optional(),
  // Estate filter for the lint-diff hygiene slot (optional): only phase-own files matching one
  // of these globs reach the linter — a linter handed files OUTSIDE its configured estate
  // (biome on a roadmap-only diff) exits non-zero over nothing. Empty after filtering ⇒ the
  // NAMED estate skip, never a red. Glob semantics = ladder.mjs matchGlobPath (the one matcher).
  lintDiffMatches: z.array(nonEmpty).min(1).optional(),
  // Where phases EXECUTE: 'primary' = today's shared-checkout behavior (the kill-switch is
  // flipping back to it); 'worktree' = each session claims a per-session worktree and lands
  // curated commits via `roadmap phase land`. Optional (not defaulted) so the parse
  // round-trips byte-faithful; read through executionIsolationOf().
  executionIsolation: z.enum(['primary', 'worktree']).optional(),
  testCadence: TestCadenceShape.optional(),
  mergePolicy: MergePolicyShape.optional(),
  modelPolicy: ModelPolicyShape.optional(),
  gateSpecialists: z.array(GateSpecialistShape).optional(),
  validationTiers: ValidationTiersShape.optional(),
  designHomes: DesignHomesShape.optional(),
  reviewFocus: z.array(ReviewFocusShape).optional(),
  testConventions: z.array(z.string()).optional(),
  exec: ExecShape.optional(),
  capacity: CapacityConfigShape.optional(),
})

/** True iff `<baseRef>:roadmap/roadmap.config.json` exists (a pre-cutover branch). */
function baseTipHasConfig(toplevel, baseRef) {
  try {
    execFileSync('git', ['-C', toplevel, 'cat-file', '-e', `${baseRef}:roadmap/roadmap.config.json`], {
      timeout: 10_000,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/** The effective execution-isolation mode: absent reads 'primary' (exactly today's
 *  behavior — the deliberate opt-in is writing 'worktree' into the consumer config). */
export function executionIsolationOf(config) {
  return config?.executionIsolation ?? 'primary'
}

/** The integration ref phases reset onto and land back on: the FIRST push-authorized ref, with
 *  'develop' the documented fallback when a consumer names none. The one reader — `worktree
 *  reset` and `phase land` must never disagree about which branch the lane targets. */
export function integrationRefOf(config) {
  return config?.mergePolicy?.autonomousPushRefs?.[0] ?? 'develop'
}

/**
 * Load + validate the consumer's roadmap.config.json.
 * @param {string} cwd  a path inside the consumer repo
 * @param {{ baseRef?: string }} [opts]  baseRef enables the pre-cutover diagnostic
 * @returns the parsed, strictly-validated config
 * @throws {ConfigError}
 */
export function loadConfig(cwd, opts = {}) {
  const toplevel = gitToplevel(cwd)
  // The config lives INSIDE the root it would otherwise have to name, so the root is
  // DISCOVERED (roadmap-root.mjs), never configured. ROADMAP_CONFIG still wins outright —
  // fixtures and tests point it at an explicit file.
  let configPath
  try {
    configPath = process.env.ROADMAP_CONFIG || join(roadmapRoot(toplevel), 'roadmap.config.json')
  } catch (e) {
    if (e instanceof RoadmapRootError) throw new ConfigError('ambiguous', e.messageLines)
    throw e
  }

  let raw
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      const lines = [
        `roadmap: no roadmap.config.json at ${configPath} — this consumer is not configured. Scaffold one: roadmap init --config`,
      ]
      if (opts.baseRef && baseTipHasConfig(toplevel, opts.baseRef)) {
        lines.push(
          `this branch predates the config cutover — merge ${opts.baseRef} or copy roadmap/roadmap.config.json from it`,
        )
      }
      throw new ConfigError('absent', lines)
    }
    throw new ConfigError('unreadable', [`roadmap: cannot read ${configPath}: ${e?.message ?? e}`])
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new ConfigError('invalid', [configPath, `JSON parse error: ${e?.message ?? e}`])
  }

  // configVersion migration guard — a future version fails loud with a pointer, never
  // silently under-validates against the v1 shape. A non-object top level (null, array,
  // primitive) is left to the strict-Zod parse below, which reports it cleanly rather
  // than dereferencing and crashing with a raw TypeError.
  if (
    parsed !== null
    && typeof parsed === 'object'
    && typeof parsed.configVersion === 'number'
    && parsed.configVersion !== 1
  ) {
    throw new ConfigError('invalid', [
      configPath,
      `configVersion: unsupported configVersion ${parsed.configVersion} — this plugin speaks configVersion 1; migrate the config (no automatic migration path exists yet)`,
    ])
  }

  const result = RoadmapConfigShape.safeParse(parsed)
  if (!result.success) {
    const lines = [configPath]
    for (const issue of result.error.issues) {
      const dotted = issue.path.join('.')
      lines.push(`${dotted}: ${issue.message}`)
    }
    throw new ConfigError('invalid', lines)
  }
  return result.data
}
