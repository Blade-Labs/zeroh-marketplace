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

/** Typed load failure. kind ∈ 'absent' | 'invalid' | 'unreadable'. */
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
})

const TestCadenceShape = z.strictObject({
  enabled: z.boolean().optional(),
  backstop: z.string().optional(),
  floors: z.enum(['blocking', 'advisory', 'none']).optional(),
})

const MergePolicyShape = z.strictObject({
  arcIntegration: z.enum(['autonomous', 'hold']),
  maxOpenFollowups: z.number().int().nonnegative(),
  autonomousPushRefs: z.array(z.string()),
  primaryCheckout: z.string(),
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

/** The full roadmap.config.json shape (ROADCODE-DESIGN.md §1, configVersion 1). */
export const RoadmapConfigShape = z.strictObject({
  $schema: z.string().optional(),
  configVersion: z.literal(1),
  gateCommands: GateCommandsShape,
  testCadence: TestCadenceShape.optional(),
  mergePolicy: MergePolicyShape.optional(),
  modelPolicy: ModelPolicyShape.optional(),
  gateSpecialists: z.array(GateSpecialistShape).optional(),
  validationTiers: ValidationTiersShape.optional(),
  designHomes: DesignHomesShape.optional(),
  reviewFocus: z.array(ReviewFocusShape).optional(),
  testConventions: z.array(z.string()).optional(),
  exec: ExecShape.optional(),
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

/**
 * Load + validate the consumer's roadmap.config.json.
 * @param {string} cwd  a path inside the consumer repo
 * @param {{ baseRef?: string }} [opts]  baseRef enables the pre-cutover diagnostic
 * @returns the parsed, strictly-validated config
 * @throws {ConfigError}
 */
export function loadConfig(cwd, opts = {}) {
  const toplevel = gitToplevel(cwd)
  const configPath = process.env.ROADMAP_CONFIG || join(toplevel, 'roadmap', 'roadmap.config.json')

  let raw
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      const lines = [
        `roadmap: no roadmap/roadmap.config.json at ${toplevel} — this consumer is not configured. Scaffold one: roadmap init --config`,
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
  // silently under-validates against the v1 shape.
  if (typeof parsed.configVersion === 'number' && parsed.configVersion !== 1) {
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
