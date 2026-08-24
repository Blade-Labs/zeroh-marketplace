/**
 * roles — the ONE home for "which model fills which protocol role, and how does THIS driver
 * reach it". The prose homes (agents/software-architect.md, skills/review-phase/SKILL.md) point
 * here; the contract is MULTI-DRIVER.md §1.
 *
 * One ROLES entry per agents/*.md card:
 *   { id, agentCard, spawnSites, class: 'judge'|'builder', tierChain, inlineFallbackLegal }
 *
 * `class` decides who a consumer's `modelPolicy.judgeModel` may re-route: JUDGE-class only —
 * a role returning a verdict on work it did not produce. `tierChain` is model ids best-first,
 * and only `software-architect` carries a real chain, in the user's verbatim order (MULTI-DRIVER.md §1);
 * every other role carries its card's frontmatter alias, which stays on the card as the harness
 * fail-safe. `spawnSites` lists every file that SPAWNS the role — a skill that invokes it or the
 * CLI/library that resolves its card — and is evidence, not a claim: roles.test.mjs reds when a
 * listed file stops naming the role.
 *
 * `resolveRole` drives the chain ITSELF: no harness fallback flag substitutes for it, because
 * claude's `--fallback-model` is single-hop and claude-family-only and so can never reach the
 * openai tier. Falling down the chain never reduces rigor — the same role runs unabridged on the
 * next tier, and the walk is RECORDED.
 */
import { DRIVERS, MODEL_ALIASES, MODEL_IDS, MODEL_DRIVERS, resolveDriver } from './drivers.mjs'

const { FABLE, SONNET, OPUS, SOL } = MODEL_IDS

/** The env var that forces a tier down, so the no-rigor-loss rail can be falsified on demand. */
export const FORCE_UNAVAILABLE_ENV = 'ROADMAP_ROLE_FORCE_UNAVAILABLE'

/** Every tier of a role's chain was unavailable: the stage is UNJUDGED, and stops. */
export class RoleUnjudgedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RoleUnjudgedError'
  }
}

export const ROLES = Object.freeze({
  'software-architect': Object.freeze({
    id: 'software-architect',
    agentCard: 'agents/software-architect.md',
    spawnSites: Object.freeze([
      'skills/do-phase/SKILL.md',
      'skills/plan-phase/SKILL.md',
      'skills/plan-arc/SKILL.md',
      'skills/arc-sweep/SKILL.md',
      'skills/release-sweep/SKILL.md',
    ]),
    class: 'judge',
    tierChain: Object.freeze([FABLE, SOL, OPUS]),
    inlineFallbackLegal: true,
  }),
  'code-reviewer': Object.freeze({
    id: 'code-reviewer',
    agentCard: 'agents/code-reviewer.md',
    spawnSites: Object.freeze([
      'cli/commands/gate.mjs',
      'skills/do-phase/SKILL.md',
      'skills/full-code-review/SKILL.md',
    ]),
    class: 'judge',
    tierChain: Object.freeze([OPUS]),
    inlineFallbackLegal: true,
  }),
  'intent-validator': Object.freeze({
    id: 'intent-validator',
    agentCard: 'agents/intent-validator.md',
    spawnSites: Object.freeze(['skills/validate-arc/SKILL.md']),
    class: 'judge',
    tierChain: Object.freeze([OPUS]),
    // Its card: "never grades work it built". Inline fulfillment IS the builder grading itself.
    inlineFallbackLegal: false,
  }),
  'arc-eval-judge': Object.freeze({
    id: 'arc-eval-judge',
    agentCard: 'agents/arc-eval-judge.md',
    spawnSites: Object.freeze([
      'skills/do-arc/SKILL.md',
      'skills/eval-arc/SKILL.md',
      'cli/commands/eval.mjs',
    ]),
    class: 'judge',
    tierChain: Object.freeze([SONNET]),
    inlineFallbackLegal: true,
  }),
  'phase-executor': Object.freeze({
    id: 'phase-executor',
    agentCard: 'agents/phase-executor.md',
    spawnSites: Object.freeze([
      'skills/do-arc/SKILL.md',
      'skills/do-phase/SKILL.md',
      'cli/lib/executor-arm.mjs',
    ]),
    class: 'builder',
    tierChain: Object.freeze([OPUS]),
    inlineFallbackLegal: true,
  }),
  'software-developer': Object.freeze({
    id: 'software-developer',
    agentCard: 'agents/software-developer.md',
    spawnSites: Object.freeze(['skills/do-arc/SKILL.md']),
    class: 'builder',
    tierChain: Object.freeze([OPUS]),
    inlineFallbackLegal: true,
  }),
  'test-engineer': Object.freeze({
    id: 'test-engineer',
    agentCard: 'agents/test-engineer.md',
    spawnSites: Object.freeze(['skills/do-phase/SKILL.md', 'skills/do-arc/SKILL.md']),
    class: 'builder',
    tierChain: Object.freeze([OPUS]),
    inlineFallbackLegal: true,
  }),
  'quality-pass': Object.freeze({
    id: 'quality-pass',
    agentCard: 'agents/quality-pass.md',
    spawnSites: Object.freeze(['cli/commands/gate.mjs']),
    class: 'builder',
    tierChain: Object.freeze([OPUS]),
    inlineFallbackLegal: true,
  }),
  'ux-designer': Object.freeze({
    id: 'ux-designer',
    agentCard: 'agents/ux-designer.md',
    spawnSites: Object.freeze(['skills/plan-arc/SKILL.md']),
    class: 'builder',
    tierChain: Object.freeze([OPUS]),
    inlineFallbackLegal: true,
  }),
})

/** The ROLES entry for `id`, or a throw naming the offending id and every known one. */
function resolveRoleEntry(id) {
  const entry = Object.hasOwn(ROLES, id) ? ROLES[id] : undefined
  if (!entry) {
    throw new Error(
      `unknown role '${id}' — known roles: ${Object.keys(ROLES).join(', ')}. The role table is committed code: one entry per agents/*.md card in cli/lib/roles.mjs (MULTI-DRIVER.md §1)`,
    )
  }
  return entry
}

/**
 * How `driverId` reaches a model that `runnerId` runs — 'native' | 'child-cli' | 'inline', or
 * null when this driver cannot reach that runner at all (an UNREACHABLE tier, which the walk
 * treats as unavailable rather than pretending someone else answered).
 *
 * BOTH sides are consulted, and they answer different questions: `driverEntry.roleCapabilities
 * .subagents` is whether THIS driver can spawn anything at all, `runnerEntry.roleCapabilities
 * .headlessChild` is whether the target can BE driven as a child. Claiming child-cli off the
 * runner alone would hand a prompts-only harness a model it can never launch.
 *
 * Takes the entries rather than reading the registry so the prompts-only branch is provable:
 * both registered drivers today spawn, so `inline` is only reachable for a driver that declares
 * no spawn mechanism.
 */
export function reachMode(driverId, driverEntry, runnerId, runnerEntry) {
  const subagents = driverEntry.roleCapabilities.subagents
  // An ABSENT key is unproven, never a claim of ability: only an explicit non-'none' spawns.
  const driverSpawns = subagents !== undefined && subagents !== 'none'
  if (runnerId === driverId && subagents === 'native') return 'native'
  if (driverSpawns && runnerEntry.roleCapabilities.headlessChild === true) return 'child-cli'
  if (runnerId === driverId) return 'inline'
  return null
}

/** The forced-unavailable set: the caller's list unioned with the env var, both optional. */
function forcedDown({ forceUnavailable, env }) {
  const fromOpts = Array.isArray(forceUnavailable)
    ? forceUnavailable
    : typeof forceUnavailable === 'string'
      ? forceUnavailable.split(',')
      : []
  const fromEnv = String((env ?? process.env)[FORCE_UNAVAILABLE_ENV] ?? '').split(',')
  return new Set([...fromOpts, ...fromEnv].map((s) => s.trim()).filter((s) => s.length > 0))
}

/**
 * Fill `roleId` from `driverId`: walk the role's tier chain and return the first tier this
 * driver can actually reach, at unreduced rigor.
 *
 * `drivers` / `modelDrivers` default to the registry and exist as parameters because both
 * registered drivers today declare a headless child mechanism: without them the prompts-only
 * arm — inline fulfillment, and the refusal of it for a role that may not grade its own work —
 * would be written but never provable.
 *
 * @param {string} roleId
 * @param {string} driverId
 * @param {{ forceUnavailable?: string[]|string, judgeModel?: string, env?: Record<string,string>,
 *           drivers?: object, modelDrivers?: Record<string,string> }} [opts]
 * @returns {{ role: string, model: string, mode: 'native'|'child-cli'|'inline',
 *             substituted?: { from: string, to: string, reason: string } }}
 */
export function resolveRole(roleId, driverId, opts = {}) {
  const drivers = opts.drivers ?? DRIVERS
  const modelDrivers = opts.modelDrivers ?? MODEL_DRIVERS
  const role = resolveRoleEntry(roleId)
  // Object.hasOwn on both paths: a prototype member ('toString') is not a driver.
  if (!Object.hasOwn(drivers, driverId)) {
    // The registry's own throw carries the verify/register remediation; an injected set has none.
    if (drivers === DRIVERS) resolveDriver(driverId)
    throw new Error(`unknown driver '${driverId}' — known drivers: ${Object.keys(drivers).join(', ')}`)
  }
  const driverEntry = drivers[driverId]
  const down = forcedDown(opts)
  // A judgeModel LEADS a judge seam's chain; a builder seam ignores it (the review-phase HOME
  // rule). It is a tier like any other — unavailable, it falls through and the ask is recorded.
  // Consumers configure the harness ALIAS (`modelPolicy.judgeModel: 'fable'`), so normalise
  // through MODEL_ALIASES first: prepending the raw alias would record the configured judge as
  // substituted away from itself, for want of a driver that runs a word rather than a model.
  const asked = opts.judgeModel != null && Object.hasOwn(MODEL_ALIASES, opts.judgeModel)
    ? MODEL_ALIASES[opts.judgeModel]
    : opts.judgeModel
  const chain = role.class === 'judge' && asked ? [asked, ...role.tierChain] : [...role.tierChain]

  const skipped = []
  for (const model of chain) {
    if (down.has(model)) {
      skipped.push(`${model} (forced unavailable via ${FORCE_UNAVAILABLE_ENV}/forceUnavailable)`)
      continue
    }
    const runnerId = Object.hasOwn(modelDrivers, model) ? modelDrivers[model] : undefined
    if (!runnerId) {
      skipped.push(`${model} (no registered driver runs it — cli/lib/drivers.mjs MODEL_DRIVERS)`)
      continue
    }
    const mode = reachMode(driverId, driverEntry, runnerId, drivers[runnerId])
    if (mode === null) {
      skipped.push(`${model} (driver '${driverId}' declares no way to reach driver '${runnerId}')`)
      continue
    }
    // A role whose card forbids grading its own work cannot be filled by the driver ITSELF, so
    // an inline-only tier is unavailable to it — the walk continues rather than quietly seating
    // the builder as its own judge.
    if (mode === 'inline' && !role.inlineFallbackLegal) {
      skipped.push(`${model} (reachable only INLINE, and ${role.agentCard} forbids grading work it built)`)
      continue
    }
    const resolved = { role: roleId, model, mode }
    if (model !== chain[0]) {
      resolved.substituted = {
        from: chain[0],
        to: model,
        reason: `unavailable: ${skipped.join('; ')} — re-run at UNREDUCED rigor on ${model}`,
      }
    }
    return resolved
  }

  throw new RoleUnjudgedError(
    `role '${roleId}' is UNJUDGED under driver '${driverId}': every tier of its chain was unavailable — ${skipped.join('; ')}. The protocol forbids a silent skip: report the stage UNJUDGED and STOP (MULTI-DRIVER.md §1)`,
  )
}
