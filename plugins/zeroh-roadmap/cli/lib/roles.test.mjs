#!/usr/bin/env node
/**
 * Fixtures for cli/lib/roles.mjs — the ONE home for "which model fills which protocol role,
 * and how does THIS driver reach it" (MULTI-DRIVER.md §1). Blocks, in order:
 *
 *  1. THE TABLE — the architect's tier chain is the user's ruling in VERBATIM order; every
 *     other role carries a 1-entry chain equal to its card's frontmatter alias, cross-checked
 *     against the card itself so the two sources must agree.
 *  2. THE WALK — resolveRole returns the first AVAILABLE tier, at unreduced rigor, and a
 *     non-head result is RECORDED (`substituted: { from, to, reason }`), never silent. Proven
 *     by INJECTED unavailability (opts.forceUnavailable / opts.env), never by observation.
 *  3. UNJUDGED — every tier down is a named RoleUnjudgedError, never a quiet skip.
 *  4. judgeModel — the consumer's override prepends for JUDGE-class roles and is IGNORED for
 *     BUILDER-class roles (review-phase's HOME rule: judge seams only).
 *  5. POLICY — a consumer's modelPolicy LEADS a role's chain: preset (claude|codex|codex-full),
 *     per-repo default, per-role pick, legacy judgeModel — precedence roles[id] > judgeModel
 *     (judge seams) > default, with `arc-eval-judge` PINNED to sonnet: presets and defaults
 *     pass it by, an explicit override is REFUSED (PinnedRoleError).
 *  6. REACH — `mode` is native | child-cli | inline, derived from the driver registry; inline
 *     is first-class and RECORDED, never indistinguishable from native.
 *  7. REFUSAL — unknown role / unknown driver throw naming the offending id and the known set.
 *  8. NO ROT — every agentCard and every spawnSite path exists on disk, spawnSites MENTION the
 *     role (inventory as evidence), roles map 1:1 onto agents/*.md, and the chain has exactly
 *     one home (the two prose files may not restate it).
 *  9. PROTOCOL PARITY — the codex envelope and the claude manifest deliver the SAME protocol set
 *     (SKILL.md + its references/ tree; agents/*.md cards excluded by a NAMED, PRINTED rule), and
 *     the envelope's byte overhead over that protocol is bounded. MEASURED, with the re-derivation
 *     command printed alongside the numbers (POLYSEAT no-claude-privilege).
 *
 * The registry is REAL (cli/lib/drivers.mjs) and the files are the REAL files on disk — nothing
 * here is mocked. Ambient env is fenced out with an explicit `env: {}` wherever a case must not
 * be perturbed by the host, and the env-var path is driven through `opts.env` so process.env is
 * never mutated.
 *
 * The codex model id is NEVER written as a literal here — cli/lib/drivers.test.mjs ratchets
 * that literal to the registry. It arrives as MODEL_IDS.SOL / DRIVERS.codex.model.
 *
 * Run: node --test cli/lib/roles.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driverTrailer } from './roles.mjs'

test('driverTrailer maps Claude families, Codex ids, and the generic fallback', () => {
  assert.equal(driverTrailer('claude-opus-5'), 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')
  assert.equal(driverTrailer('claude-fable-5-1'), 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')
  assert.equal(driverTrailer(MODEL_IDS.SOL), `Co-Authored-By: Codex ${MODEL_IDS.SOL} <noreply@openai.com>`)
  assert.equal(driverTrailer(null), 'Co-Authored-By: Claude <noreply@anthropic.com>')
})
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrompt } from '../commands/codex.mjs'
import { DRIVERS, MODEL_ALIASES, MODEL_DRIVERS, MODEL_IDS } from './drivers.mjs'
import { PINNED_JUDGE_MODEL } from '../commands/eval.mjs'
import { MODEL_PRESETS, PINNED_ROLES, PinnedRoleError, ROLES, RoleUnjudgedError, reachMode, resolveRole } from './roles.mjs'

const PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (rel) => readFileSync(join(PLUGIN_ROOT, rel), 'utf8')

const FABLE = MODEL_IDS.FABLE
const OPUS = MODEL_IDS.OPUS
const SONNET = MODEL_IDS.SONNET
const SOL = MODEL_IDS.SOL

/** The harness alias vocabulary a CARD may carry -> the registry model id it means. */
const ALIAS_TO_MODEL = { fable: FABLE, opus: OPUS, sonnet: SONNET }

/**
 * The full registry alias vocabulary: the card aliases PLUS `sol`, the config-only spelling of
 * the codex model. A card's frontmatter is a Claude-harness fail-safe and can never carry `sol`
 * (nothing in that harness would run it), but a consumer's modelPolicy must be able to name it —
 * without the alias, "run the builders on codex" is inexpressible.
 */
const EXPECTED_ALIASES = { ...ALIAS_TO_MODEL, sol: SOL, astra: 'gpt-6-astra' }

/** Written out in full — the expectation must not be rebuilt from the table under test. */
const EXPECTED_CHAINS = {
  'arc-eval-judge': [SONNET],
  'code-reviewer': [OPUS],
  'intent-validator': [FABLE], // a 1-entry chain: the card's frontmatter fail-safe equals the judge tier
  'phase-executor': [OPUS],
  'quality-pass': [OPUS],
  'software-architect': [FABLE, SOL, OPUS],
  'software-developer': [OPUS],
  'test-engineer': [OPUS],
  'ux-designer': [OPUS],
}

/** review-phase HOME rule: judgeModel re-routes judge seams ONLY. */
const EXPECTED_CLASSES = {
  'arc-eval-judge': 'judge',
  'code-reviewer': 'judge',
  'intent-validator': 'judge',
  'phase-executor': 'builder',
  'quality-pass': 'builder',
  'software-architect': 'judge',
  'software-developer': 'builder',
  'test-engineer': 'builder',
  'ux-designer': 'builder',
}

const JUDGE_ROLES = Object.keys(EXPECTED_CLASSES).filter((id) => EXPECTED_CLASSES[id] === 'judge')
const BUILDER_ROLES = Object.keys(EXPECTED_CLASSES).filter((id) => EXPECTED_CLASSES[id] === 'builder')

// ── 1. THE TABLE ──────────────────────────────────────────────────────────────────────

test("ROLES['software-architect'].tierChain is the user's ruled order, VERBATIM — fable, then the codex model, then opus", () => {
  assert.deepEqual(
    ROLES['software-architect'].tierChain,
    [FABLE, SOL, OPUS],
    "the architect chain is a user ruling (2026-08-23, MULTI-DRIVER.md §1) and its ORDER is the ruling — fix cli/lib/roles.mjs ROLES['software-architect'].tierChain, never this fixture",
  )
})

test("tier 2 of the architect chain IS the registry's pinned codex model — not a stray look-alike string", () => {
  assert.equal(
    SOL,
    DRIVERS.codex.model,
    'MODEL_IDS.SOL and the codex entry\'s pinned model must be one value — a divergence means roles.mjs names a model no launcher will ever pin (cli/lib/drivers.mjs)',
  )
  assert.equal(ROLES['software-architect'].tierChain[1], DRIVERS.codex.model)
})

test('every non-architect role carries a 1-entry chain — exactly its card default, no invented fallbacks', () => {
  for (const [id, chain] of Object.entries(EXPECTED_CHAINS)) {
    assert.ok(ROLES[id], `no ROLES entry for '${id}' — add it in cli/lib/roles.mjs, one entry per agents/*.md card`)
    assert.deepEqual(
      ROLES[id].tierChain,
      chain,
      `${id}: tierChain drifted from today's ruled behaviour — fix cli/lib/roles.mjs ROLES['${id}'].tierChain`,
    )
    if (id !== 'software-architect') {
      assert.equal(
        ROLES[id].tierChain.length,
        1,
        `${id}: only software-architect carries a real chain (MULTI-DRIVER.md §1) — a second tier here is a new user ruling, not a refactor`,
      )
    }
  }
})

test("each card's frontmatter model alias and its chain HEAD are one decision — two sources that must agree", () => {
  for (const id of Object.keys(EXPECTED_CHAINS)) {
    const card = read(`agents/${id}.md`)
    const m = card.match(/^model:[ \t]*(\S+)[ \t]*$/m)
    assert.ok(m, `agents/${id}.md carries no frontmatter 'model:' alias — the harness fail-safe is missing`)
    const mapped = ALIAS_TO_MODEL[m[1]]
    assert.ok(
      mapped,
      `agents/${id}.md declares alias '${m[1]}', which this fixture's ALIAS_TO_MODEL does not map — add the alias here AND to cli/lib/roles.mjs if it is a real new harness alias`,
    )
    assert.equal(
      ROLES[id].tierChain[0],
      mapped,
      `${id}: frontmatter alias '${m[1]}' (=${mapped}) drifted from the chain head ${ROLES[id].tierChain[0]} — fix whichever is wrong in agents/${id}.md or cli/lib/roles.mjs`,
    )
  }
})

test('the registry OWNS the alias vocabulary this fixture spells out — one map, not two', () => {
  assert.deepEqual(
    { ...MODEL_ALIASES },
    EXPECTED_ALIASES,
    'MODEL_ALIASES in cli/lib/drivers.mjs must equal the alias map written out above: a card frontmatter, a consumer modelPolicy and a --models argument all carry aliases, and resolveRole normalises through the registry copy — a drift here means one of those readers resolves a word no driver runs',
  )
  for (const alias of Object.keys(ALIAS_TO_MODEL)) {
    assert.ok(
      Object.hasOwn(MODEL_ALIASES, alias),
      `alias '${alias}' is carried by an agent card's frontmatter — dropping it from MODEL_ALIASES strands that card's fail-safe`,
    )
  }
})

test('every tier named in every chain is a model some registered driver can run', () => {
  for (const [id, entry] of Object.entries(ROLES)) {
    assert.ok(entry.tierChain.length > 0, `${id}: an empty tierChain can never resolve — cli/lib/roles.mjs`)
    for (const model of entry.tierChain) {
      assert.ok(
        Object.hasOwn(MODEL_DRIVERS, model),
        `${id}: tier '${model}' routes to no driver — add it to MODEL_DRIVERS in cli/lib/drivers.mjs or stop naming it in cli/lib/roles.mjs`,
      )
    }
  }
})

test('role class is declared per the review-phase HOME rule — judge seams vs builder seams, exhaustively', () => {
  assert.deepEqual(
    Object.keys(ROLES).sort(),
    Object.keys(EXPECTED_CLASSES).sort(),
    'a role was added or removed without updating this fixture — every role must be classed judge or builder deliberately (cli/lib/roles.mjs + this table)',
  )
  for (const [id, cls] of Object.entries(EXPECTED_CLASSES)) {
    assert.equal(
      ROLES[id].class,
      cls,
      `${id}: class must be '${cls}' — class decides whether a consumer's modelPolicy.judgeModel may re-route this seam (MULTI-DRIVER.md §1); fix cli/lib/roles.mjs`,
    )
  }
})

test('inlineFallbackLegal is a strict boolean on every entry — an absent flag is not a permission', () => {
  for (const [id, entry] of Object.entries(ROLES)) {
    assert.equal(
      typeof entry.inlineFallbackLegal,
      'boolean',
      `${id}: inlineFallbackLegal must be an explicit true/false in cli/lib/roles.mjs — undefined would read as "not forbidden" and let a role grade its own work`,
    )
  }
})

// ── 2. THE WALK ───────────────────────────────────────────────────────────────────────

test('resolveRole returns the chain HEAD with NO substituted key when the head is available', () => {
  const res = resolveRole('software-architect', 'codex', { env: {} })
  assert.deepEqual(
    res,
    { role: 'software-architect', model: FABLE, mode: 'child-cli' },
    'an unforced architect resolution is the chain head reached by a headless child claude — extra or missing keys break the recording contract (cli/lib/roles.mjs resolveRole)',
  )
  assert.equal(
    Object.hasOwn(res, 'substituted'),
    false,
    'substituted must be ABSENT when nothing was substituted — a present key (even undefined) would make every journal entry read like a fallback',
  )
})

test('resolveRole × every driver — the exact model and reach mode for all 18 role/driver pairs', () => {
  const ROWS = [
    ['arc-eval-judge', 'codex', SONNET, 'child-cli'],
    ['arc-eval-judge', 'claude', SONNET, 'child-cli'],
    ['code-reviewer', 'codex', OPUS, 'child-cli'],
    ['code-reviewer', 'claude', OPUS, 'child-cli'],
    // the head is FABLE — the card's frontmatter fail-safe equals the judge tier
    ['intent-validator', 'codex', FABLE, 'child-cli'],
    ['intent-validator', 'claude', FABLE, 'child-cli'],
    ['phase-executor', 'codex', OPUS, 'child-cli'],
    ['phase-executor', 'claude', OPUS, 'child-cli'],
    ['quality-pass', 'codex', OPUS, 'child-cli'],
    ['quality-pass', 'claude', OPUS, 'child-cli'],
    ['software-architect', 'codex', FABLE, 'child-cli'],
    ['software-architect', 'claude', FABLE, 'child-cli'],
    ['software-developer', 'codex', OPUS, 'child-cli'],
    ['software-developer', 'claude', OPUS, 'child-cli'],
    ['test-engineer', 'codex', OPUS, 'child-cli'],
    ['test-engineer', 'claude', OPUS, 'child-cli'],
    ['ux-designer', 'codex', OPUS, 'child-cli'],
    ['ux-designer', 'claude', OPUS, 'child-cli'],
  ]
  assert.equal(
    ROWS.length,
    Object.keys(ROLES).length * Object.keys(DRIVERS).length,
    'this table must cover every role × every registered driver — a new role or driver needs its rows written out here deliberately',
  )
  for (const [roleId, driverId, model, mode] of ROWS) {
    assert.deepEqual(
      resolveRole(roleId, driverId, { env: {} }),
      { role: roleId, model, mode },
      `${roleId} under driver '${driverId}' must resolve to ${model} via ${mode} — fix cli/lib/roles.mjs (chain) or cli/lib/drivers.mjs roleCapabilities (reach)`,
    )
  }
})

test('an INJECTED unavailable head walks to the next tier at full rigor and RECORDS the substitution', () => {
  const res = resolveRole('software-architect', 'codex', { forceUnavailable: [FABLE], env: {} })
  assert.equal(res.role, 'software-architect', 'the SAME role runs on the next tier — rigor is never reduced, the seam is never skipped')
  assert.equal(res.model, SOL, `head down must land on tier 2 of the ruled chain, got ${res.model}`)
  assert.deepEqual(
    Object.keys(res).sort(),
    ['mode', 'model', 'role', 'substituted'],
    'a non-head resolution carries exactly role/model/mode/substituted (cli/lib/roles.mjs resolveRole)',
  )
  assert.deepEqual(
    Object.keys(res.substituted).sort(),
    ['from', 'reason', 'to'],
    'substituted is { from, to, reason } — MULTI-DRIVER.md §1 "the walk is RECORDED"',
  )
  assert.equal(res.substituted.from, FABLE, 'from is the CHAIN HEAD that was asked for first')
  assert.equal(res.substituted.to, res.model, 'to is the model that actually judged — the deciding model is evidence')
  assert.equal(typeof res.substituted.reason, 'string')
  assert.ok(res.substituted.reason.trim().length > 0, 'an empty reason records nothing — name why the tier was skipped')
  assert.ok(
    res.substituted.reason.includes(FABLE),
    `reason must name the skipped tier ${FABLE}: ${res.substituted.reason}`,
  )
})

test('two tiers down lands on opus and the reason names BOTH skipped tiers', () => {
  const res = resolveRole('software-architect', 'codex', { forceUnavailable: [FABLE, SOL], env: {} })
  assert.equal(res.model, OPUS, `both upper tiers down must land on the chain's last tier, got ${res.model}`)
  assert.equal(res.substituted.from, FABLE, 'from is always the head that was asked for first, never the previous tier')
  assert.equal(res.substituted.to, OPUS)
  for (const skipped of [FABLE, SOL]) {
    assert.ok(
      res.substituted.reason.includes(skipped),
      `reason must name EVERY skipped tier (missing ${skipped}): ${res.substituted.reason}`,
    )
  }
})

test('forceUnavailable accepts a comma-separated string identically to the array form', () => {
  const viaString = resolveRole('software-architect', 'codex', { forceUnavailable: `${FABLE},${SOL}`, env: {} })
  const viaArray = resolveRole('software-architect', 'codex', { forceUnavailable: [FABLE, SOL], env: {} })
  assert.deepEqual(
    viaString,
    viaArray,
    'the string and array forms of forceUnavailable are one input shape — fix the parse in cli/lib/roles.mjs',
  )
  assert.equal(viaString.model, OPUS)
})

test('ROADMAP_ROLE_FORCE_UNAVAILABLE in opts.env drives the same walk, read from opts.env not process.env', () => {
  const res = resolveRole('software-architect', 'codex', {
    env: { ROADMAP_ROLE_FORCE_UNAVAILABLE: FABLE },
  })
  assert.equal(res.model, SOL, 'the env var must force the head unavailable exactly like opts.forceUnavailable')
  assert.equal(res.substituted.from, FABLE)
  assert.equal(
    resolveRole('software-architect', 'codex', { env: {} }).model,
    FABLE,
    'an EMPTY opts.env must fence the ambient host out entirely — a leak to process.env makes every other case here host-dependent',
  )
})

test('resolveRole mutates neither its opts object nor process.env', () => {
  const before = JSON.stringify(process.env)
  const opts = Object.freeze({
    forceUnavailable: Object.freeze([FABLE]),
    env: Object.freeze({ ROADMAP_ROLE_FORCE_UNAVAILABLE: '' }),
  })
  resolveRole('software-architect', 'codex', opts)
  assert.deepEqual(opts.forceUnavailable, [FABLE], 'resolveRole must not normalise its caller\'s array in place')
  assert.equal(
    JSON.stringify(process.env),
    before,
    'resolveRole must never write process.env — a resolver with a side effect makes concurrent lanes read each other\'s forcing',
  )
})

// ── 3. UNJUDGED ───────────────────────────────────────────────────────────────────────

test('RoleUnjudgedError is a named Error subclass a caller can catch by name', () => {
  const err = new RoleUnjudgedError('x')
  assert.ok(err instanceof Error, 'RoleUnjudgedError must extend Error')
  assert.equal(err.name, 'RoleUnjudgedError', 'the name is the catch handle callers switch on — set it in the constructor')
})

test('every tier down throws RoleUnjudgedError naming the role and EVERY tier tried', () => {
  assert.throws(
    () => resolveRole('software-architect', 'codex', { forceUnavailable: [FABLE, SOL, OPUS], env: {} }),
    (err) => {
      assert.ok(err instanceof RoleUnjudgedError, `an exhausted chain must throw RoleUnjudgedError, got ${err?.name}: ${err?.message}`)
      assert.ok(
        err.message.includes('software-architect'),
        `message must name the UNJUDGED role: ${err.message}`,
      )
      for (const tier of [FABLE, SOL, OPUS]) {
        assert.ok(err.message.includes(tier), `message must name tier ${tier} as tried: ${err.message}`)
      }
      return true
    },
    'an exhausted chain must STOP and report UNJUDGED — silently returning any model would certify an unjudged stage (cli/lib/roles.mjs resolveRole)',
  )
})

test('a 1-entry chain with its only tier down is UNJUDGED too — no borrowing another role\'s tiers', () => {
  assert.throws(
    () => resolveRole('code-reviewer', 'claude', { forceUnavailable: [OPUS], env: {} }),
    (err) => {
      assert.ok(err instanceof RoleUnjudgedError, `got ${err?.name}: ${err?.message}`)
      assert.ok(err.message.includes('code-reviewer'), `message must name the role: ${err.message}`)
      assert.ok(err.message.includes(OPUS), `message must name the tier tried: ${err.message}`)
      return true
    },
    'only software-architect carries a real chain — every other role falls to UNJUDGED, it does not inherit the architect ladder',
  )
})

// ── 4. judgeModel — JUDGE-CLASS ONLY ──────────────────────────────────────────────────

test('judgeModel prepends to the chain for every unpinned judge-class role', () => {
  assert.ok(JUDGE_ROLES.length >= 4, `fixture precondition: expected the judge seams, got ${JUDGE_ROLES.join(', ')}`)
  for (const id of JUDGE_ROLES.filter((roleId) => !PINNED_ROLES.includes(roleId))) {
    const res = resolveRole(id, 'claude', { judgeModel: FABLE, env: {} })
    assert.equal(
      res.model,
      FABLE,
      `${id} is judge-class, so the consumer's modelPolicy.judgeModel must lead its chain — fix cli/lib/roles.mjs resolveRole`,
    )
    assert.equal(
      Object.hasOwn(res, 'substituted'),
      false,
      `${id}: an honoured judgeModel IS the head — nothing was substituted, so nothing may be recorded as one`,
    )
  }
})

test('judgeModel is IGNORED for EVERY builder-class role — the HOME rule is judge seams only', () => {
  assert.ok(BUILDER_ROLES.length >= 5, `fixture precondition: expected the builder seams, got ${BUILDER_ROLES.join(', ')}`)
  for (const id of BUILDER_ROLES) {
    const withOverride = resolveRole(id, 'claude', { judgeModel: FABLE, env: {} })
    assert.deepEqual(
      withOverride,
      resolveRole(id, 'claude', { env: {} }),
      `${id} is builder-class: judgeModel must change NOTHING about its resolution (review-phase HOME statement — "never phase-executor/software-developer/test-engineer")`,
    )
    assert.deepEqual(
      withOverride,
      { role: id, model: ROLES[id].tierChain[0], mode: 'child-cli' },
      `${id}: a builder runs on its own card default regardless of the consumer's judgeModel`,
    )
  }
})

test('a judgeModel configured as a harness ALIAS leads the chain — never recorded as substituted away from itself', () => {
  // roadmap.config.json and test/fixture-consumer/harness.mjs both set judgeModel: 'fable'; the
  // spawner passes that value straight through. Prepending it RAW would make every judge seam
  // record { from: 'fable', to: 'claude-fable-5', reason: 'no registered driver runs it' } — a
  // fabricated substitution away from the very model that answered.
  for (const [alias, model] of Object.entries(ALIAS_TO_MODEL)) {
    const res = resolveRole('code-reviewer', 'claude', { judgeModel: alias, env: {} })
    assert.equal(
      res.model,
      model,
      `judgeModel '${alias}' must resolve to ${model} — normalise the alias through MODEL_ALIASES in cli/lib/roles.mjs before prepending it to the chain`,
    )
    assert.equal(
      Object.hasOwn(res, 'substituted'),
      false,
      `judgeModel '${alias}' WAS honoured, so nothing was substituted — recording one would tell the scorecard a model failed that never did`,
    )
  }
})

test('an UNAVAILABLE judgeModel falls back down the role\'s own chain and records from: the judgeModel', () => {
  const res = resolveRole('code-reviewer', 'claude', { judgeModel: FABLE, forceUnavailable: [FABLE], env: {} })
  assert.equal(res.model, OPUS, `a downed judgeModel must fall to the card default, got ${res.model}`)
  assert.equal(
    res.substituted.from,
    FABLE,
    'from is the head that was asked for — with an override in play, that head IS the judgeModel',
  )
  assert.equal(res.substituted.to, OPUS)
  assert.ok(res.substituted.reason.includes(FABLE), `reason must name the skipped judgeModel: ${res.substituted.reason}`)
})

test('a judgeModel no registered driver can run is UNAVAILABLE, not a crash and not a silent pass', () => {
  const PHANTOM = 'gemini-4-titan'
  assert.equal(
    Object.hasOwn(MODEL_DRIVERS, PHANTOM),
    false,
    `fixture precondition: ${PHANTOM} must be unroutable — registering it in cli/lib/drivers.mjs voids this test, pick another unroutable id`,
  )
  const res = resolveRole('code-reviewer', 'claude', { judgeModel: PHANTOM, env: {} })
  assert.equal(res.model, OPUS, `an unroutable judgeModel is an unavailable tier, so the walk continues, got ${res.model}`)
  assert.equal(res.substituted.from, PHANTOM, 'the config asked for a model no driver runs — RECORD that, do not pretend it was never asked')
  assert.ok(res.substituted.reason.includes(PHANTOM), `reason must name the unroutable model: ${res.substituted.reason}`)
})

// ── 5. POLICY — presets, per-role leads, per-repo defaults, and the ONE pinned role ───

/**
 * The three named presets, spelled out as RESOLUTIONS rather than as a copy of MODEL_PRESETS:
 * every cell is `[roleId, model, mode]` for that preset under that driver. Written out in full —
 * a table rebuilt from the constant under test would assert nothing.
 *
 * Under driver `codex` the codex model is reached NATIVELY (DRIVERS.codex declares
 * subagents: 'native'); under driver `claude` the very same policy reaches it as a headless
 * child, because the claude entry spawns children but never natively. arc-eval-judge is sonnet
 * in every column: it is PINNED (the eval trend's baseline judge).
 */
const PRESET_MATRIX = {
  codex: {
    codex: [
      ['arc-eval-judge', SONNET, 'child-cli'],
      ['code-reviewer', SOL, 'native'],
      ['intent-validator', SOL, 'native'],
      ['phase-executor', SOL, 'native'],
      ['quality-pass', SOL, 'native'],
      ['software-architect', FABLE, 'child-cli'],
      ['software-developer', SOL, 'native'],
      ['test-engineer', SOL, 'native'],
      ['ux-designer', SOL, 'native'],
    ],
    claude: [
      ['arc-eval-judge', SONNET, 'child-cli'],
      ['code-reviewer', SOL, 'child-cli'],
      ['intent-validator', SOL, 'child-cli'],
      ['phase-executor', SOL, 'child-cli'],
      ['quality-pass', SOL, 'child-cli'],
      ['software-architect', FABLE, 'child-cli'],
      ['software-developer', SOL, 'child-cli'],
      ['test-engineer', SOL, 'child-cli'],
      ['ux-designer', SOL, 'child-cli'],
    ],
  },
  'codex-full': {
    codex: [
      ['arc-eval-judge', SONNET, 'child-cli'],
      ['code-reviewer', SOL, 'native'],
      ['intent-validator', SOL, 'native'],
      ['phase-executor', SOL, 'native'],
      ['quality-pass', SOL, 'native'],
      ['software-architect', SOL, 'native'],
      ['software-developer', SOL, 'native'],
      ['test-engineer', SOL, 'native'],
      ['ux-designer', SOL, 'native'],
    ],
    claude: [
      ['arc-eval-judge', SONNET, 'child-cli'],
      ['code-reviewer', SOL, 'child-cli'],
      ['intent-validator', SOL, 'child-cli'],
      ['phase-executor', SOL, 'child-cli'],
      ['quality-pass', SOL, 'child-cli'],
      ['software-architect', SOL, 'child-cli'],
      ['software-developer', SOL, 'child-cli'],
      ['test-engineer', SOL, 'child-cli'],
      ['ux-designer', SOL, 'child-cli'],
    ],
  },
}

test('MODEL_PRESETS is exactly the three ruled names, frozen, and every model it names is routable', () => {
  assert.deepEqual(
    Object.keys(MODEL_PRESETS).sort(),
    ['claude', 'codex', 'codex-full'],
    'the preset vocabulary is a user ruling (phase 24 source, MULTI-DRIVER.md §1): claude / codex / codex-full — a fourth name is a new ruling, not a refactor (cli/lib/roles.mjs)',
  )
  assert.equal(Object.isFrozen(MODEL_PRESETS), true, 'MODEL_PRESETS must be Object.freeze()d — a caller must not be able to redefine a preset at runtime')
  assert.deepEqual(
    MODEL_PRESETS.claude,
    {},
    "preset 'claude' IS the roles table as it stands — an empty policy, so naming it can never change an answer (cli/lib/roles.mjs)",
  )
  for (const [name, preset] of Object.entries(MODEL_PRESETS)) {
    assert.equal(Object.isFrozen(preset), true, `preset '${name}' must be frozen too`)
    const named = [preset.default, ...Object.values(preset.roles ?? {})].filter((m) => m != null)
    for (const model of named) {
      assert.ok(
        Object.hasOwn(MODEL_DRIVERS, model) || Object.hasOwn(MODEL_ALIASES, model),
        `preset '${name}' names '${model}', which is neither a routable model id nor a harness alias — every preset value must resolve (cli/lib/drivers.mjs MODEL_DRIVERS / MODEL_ALIASES)`,
      )
    }
    for (const roleId of Object.keys(preset.roles ?? {})) {
      assert.ok(Object.hasOwn(ROLES, roleId), `preset '${name}' names role '${roleId}', which has no ROLES entry`)
    }
  }
})

test('PINNED_ROLES is exactly arc-eval-judge, and its pin IS the model the eval scorer compares against', () => {
  assert.deepEqual(
    [...PINNED_ROLES],
    ['arc-eval-judge'],
    'exactly one role is pinned (owner ruling 2026-09-02): arc-eval-judge, the baseline the eval trend compares against — pinning a second seam, or unpinning this one, is a user ruling (cli/lib/roles.mjs)',
  )
  for (const id of PINNED_ROLES) {
    assert.ok(Object.hasOwn(ROLES, id), `pinned role '${id}' has no ROLES entry — a pin on a role that does not exist protects nothing`)
    assert.equal(
      ROLES[id].tierChain.length,
      1,
      `${id}: a pinned role's chain is the pin — a second tier would mean the "pinned" model can be walked away from`,
    )
  }
  assert.equal(
    ROLES['arc-eval-judge'].tierChain[0],
    PINNED_JUDGE_MODEL,
    "the pinned chain head and cli/commands/eval.mjs PINNED_JUDGE_MODEL are ONE decision: the scorer flags every verdict off that model as baseline-reset material, so a drift here silently rebases the eval trend",
  )
  assert.equal(ROLES['arc-eval-judge'].tierChain[0], SONNET, 'the pin is sonnet (owner ruling) — fix cli/lib/roles.mjs, never this fixture')
})

test('PinnedRoleError is a named Error subclass a caller can catch by name', () => {
  const err = new PinnedRoleError('x')
  assert.ok(err instanceof Error, 'PinnedRoleError must extend Error')
  assert.equal(err.name, 'PinnedRoleError', 'the name is the catch handle the config check and the --models parse switch on — set it in the constructor')
})

for (const [presetName, byDriver] of Object.entries(PRESET_MATRIX)) {
  for (const [driverId, rows] of Object.entries(byDriver)) {
    test(`preset '${presetName}' under driver '${driverId}' — the exact model and reach for every role`, () => {
      assert.equal(
        rows.length,
        Object.keys(ROLES).length,
        `this table must cover EVERY role under preset '${presetName}' — a new role needs its cell written out here deliberately`,
      )
      for (const [roleId, model, mode] of rows) {
        assert.deepEqual(
          resolveRole(roleId, driverId, { policy: { preset: presetName }, env: {} }),
          { role: roleId, model, mode },
          `preset '${presetName}': ${roleId} under driver '${driverId}' must be ${model} via ${mode} — fix the lead in cli/lib/roles.mjs (MODEL_PRESETS/leadFor) or the reach in cli/lib/drivers.mjs roleCapabilities`,
        )
      }
    })
  }
}

test("preset 'claude', an empty policy, and NO policy at all are one answer — today's table, unchanged", () => {
  for (const roleId of Object.keys(ROLES)) {
    for (const driverId of Object.keys(DRIVERS)) {
      const today = { role: roleId, model: EXPECTED_CHAINS[roleId][0], mode: 'child-cli' }
      assert.deepEqual(
        resolveRole(roleId, driverId, { env: {} }),
        today,
        `${roleId}/${driverId}: no policy must resolve exactly as it did before the policy seam existed`,
      )
      for (const policy of [{ preset: 'claude' }, {}, { roles: {} }]) {
        assert.deepEqual(
          resolveRole(roleId, driverId, { policy, env: {} }),
          today,
          `${roleId}/${driverId} under policy ${JSON.stringify(policy)}: a policy that names no lead must not change a single answer — a preset/default that leaks here silently re-routes every repo that never opted in`,
        )
      }
    }
  }
})

test('a per-role lead beats the default and wins for THAT ROLE ONLY — both spelled as harness aliases', () => {
  const policy = { default: 'sol', roles: { 'test-engineer': 'opus' } }
  assert.deepEqual(
    resolveRole('test-engineer', 'codex', { policy, env: {} }),
    { role: 'test-engineer', model: OPUS, mode: 'child-cli' },
    "roles['test-engineer'] must beat the default: the whole point of a per-role policy is \"codex builders, but this one on opus\" (cli/lib/roles.mjs leadFor)",
  )
  for (const roleId of ['quality-pass', 'software-developer', 'code-reviewer', 'software-architect']) {
    assert.deepEqual(
      resolveRole(roleId, 'codex', { policy, env: {} }),
      { role: roleId, model: SOL, mode: 'native' },
      `${roleId}: a per-role lead for ANOTHER role must not leak — every unnamed role falls to the default`,
    )
  }
  assert.deepEqual(
    resolveRole('arc-eval-judge', 'codex', { policy, env: {} }),
    { role: 'arc-eval-judge', model: SONNET, mode: 'child-cli' },
    'the pinned role ignores the default like every other override — the eval baseline is not a default (cli/lib/roles.mjs PINNED_ROLES)',
  )
  assert.deepEqual(
    resolveRole('test-engineer', 'codex', { policy: { default: SOL, roles: { 'test-engineer': OPUS } }, env: {} }),
    resolveRole('test-engineer', 'codex', { policy, env: {} }),
    'a policy written in ALIASES and the same policy written in model ids are one input — normalise both lead paths through MODEL_ALIASES (cli/lib/roles.mjs)',
  )
})

test('an explicit policy key layers OVER the preset it names — the preset is expanded first, not last', () => {
  const policy = { preset: 'codex-full', default: 'opus' }
  assert.deepEqual(
    resolveRole('quality-pass', 'codex', { policy, env: {} }),
    { role: 'quality-pass', model: OPUS, mode: 'child-cli' },
    "an explicit `default` must win over the preset's own default — otherwise a repo can name a preset but never adjust it (cli/lib/roles.mjs, precedence: invocation keys > preset > table)",
  )
})

test('the lead precedence is roles[id] > judgeModel (judge seams only) > default — every rung proven', () => {
  const both = { default: 'sol', judgeModel: 'fable' }
  assert.equal(
    resolveRole('code-reviewer', 'codex', { policy: both, env: {} }).model,
    FABLE,
    'a JUDGE seam takes the legacy judgeModel over the default — that key exists to route judges specifically (cli/lib/roles.mjs leadFor)',
  )
  assert.deepEqual(
    resolveRole('quality-pass', 'codex', { policy: both, env: {} }),
    { role: 'quality-pass', model: SOL, mode: 'native' },
    "a BUILDER seam never sees judgeModel (review-phase's HOME rule) — it takes the default",
  )
  assert.equal(
    resolveRole('code-reviewer', 'codex', { policy: { ...both, roles: { 'code-reviewer': 'opus' } }, env: {} }).model,
    OPUS,
    'a per-role lead is the most specific rung and beats judgeModel too — the unit of choice is the ROLE',
  )
})

test('policy.judgeModel and the legacy top-level opts.judgeModel are ONE input, judge seams only', () => {
  for (const id of JUDGE_ROLES) {
    assert.deepEqual(
      resolveRole(id, 'claude', { policy: { judgeModel: 'fable' }, env: {} }),
      resolveRole(id, 'claude', { judgeModel: 'fable', env: {} }),
      `${id}: a consumer that still passes judgeModel at the top level must resolve exactly as one that passes it inside the policy — the legacy spelling keeps working (cli/lib/roles.mjs)`,
    )
  }
  for (const id of BUILDER_ROLES) {
    assert.deepEqual(
      resolveRole(id, 'claude', { policy: { judgeModel: 'fable' }, env: {} }),
      resolveRole(id, 'claude', { env: {} }),
      `${id}: judgeModel inside a policy is still judge-class ONLY — a builder must be untouched by it`,
    )
  }
})

test('the pinned role resolves to its pin under EVERY preset and EVERY default, on both drivers', () => {
  const POLICIES = [
    { preset: 'claude' },
    { preset: 'codex' },
    { preset: 'codex-full' },
    { default: 'sol' },
    { default: 'opus' },
    { default: 'fable' },
    { judgeModel: 'fable' },
    { preset: 'codex-full', default: 'opus' },
  ]
  for (const policy of POLICIES) {
    for (const driverId of Object.keys(DRIVERS)) {
      assert.deepEqual(
        resolveRole('arc-eval-judge', driverId, { policy, env: {} }),
        { role: 'arc-eval-judge', model: SONNET, mode: 'child-cli' },
        `policy ${JSON.stringify(policy)} under '${driverId}': arc-eval-judge is PINNED to ${SONNET} — a preset or default that reaches it rebases the eval trend against a different judge, silently (cli/lib/roles.mjs PINNED_ROLES)`,
      )
    }
  }
  // The pin's exact boundary: every broad policy lead is ignored and an explicit roles entry is REFUSED.
  assert.equal(
    resolveRole('arc-eval-judge', 'claude', { policy: { judgeModel: 'fable' }, env: {} }).model,
    SONNET,
    'the legacy judgeModel cannot move the pinned eval baseline any more than preset/default can',
  )
})

test('naming the pinned role in policy.roles THROWS PinnedRoleError — refused loudly, never quietly ignored', () => {
  for (const asked of ['fable', 'sol', OPUS]) {
    assert.throws(
      () => resolveRole('arc-eval-judge', 'codex', { policy: { roles: { 'arc-eval-judge': asked } }, env: {} }),
      (err) => {
        assert.ok(err instanceof PinnedRoleError, `asked '${asked}': a pinned override must throw PinnedRoleError, got ${err?.name}: ${err?.message}`)
        assert.ok(err.message.includes('arc-eval-judge'), `message must name the pinned role: ${err.message}`)
        assert.ok(err.message.includes(SONNET), `message must name the model the role is pinned to: ${err.message}`)
        return true
      },
      `an explicit roles['arc-eval-judge'] = '${asked}' must be REFUSED, not silently dropped — a consumer who asked and was ignored believes a different judge ran (cli/lib/roles.mjs)`,
    )
  }
  // The refusal is about the ROLE being asked for, not about which role is being resolved:
  // a policy carrying the illegal key must not quietly serve some other role either.
  assert.throws(
    () => resolveRole('quality-pass', 'codex', { policy: { default: 'sol', roles: { 'arc-eval-judge': 'sol' } }, env: {} }),
    PinnedRoleError,
    'a policy that names the pinned role is malformed as a whole — resolving any role under it must refuse, so the bad key cannot ride along unnoticed',
  )
})

test('a policy naming an unknown preset throws, naming the offending name and every legal one', () => {
  for (const bad of ['gpt', 'codex_full', 'constructor', 'toString']) {
    assert.throws(
      () => resolveRole('quality-pass', 'codex', { policy: { preset: bad }, env: {} }),
      (err) => {
        assert.ok(err instanceof Error, `preset '${bad}': threw a non-Error: ${String(err)}`)
        assert.ok(err.message.includes(bad), `message must name the offending preset: ${err.message}`)
        for (const name of Object.keys(MODEL_PRESETS)) {
          assert.ok(err.message.includes(name), `message must name legal preset '${name}': ${err.message}`)
        }
        return true
      },
      `preset '${bad}' is not a preset — refuse it naming the legal set, and guard the lookup with Object.hasOwn so a prototype member is not a preset (cli/lib/roles.mjs)`,
    )
  }
})

test('a policy lead that is UNAVAILABLE falls to the card tier and records substituted.from = the LEAD', () => {
  const res = resolveRole('quality-pass', 'codex', {
    policy: { preset: 'codex' },
    forceUnavailable: [SOL],
    env: {},
  })
  assert.equal(res.model, OPUS, `a downed lead must fall to the role's own card tier at unreduced rigor, got ${res.model}`)
  assert.equal(res.mode, 'child-cli', 'the fallback tier is reached however the registry says — opus is a headless child from codex')
  assert.deepEqual(
    Object.keys(res).sort(),
    ['mode', 'model', 'role', 'substituted'],
    'a non-lead resolution carries exactly role/model/mode/substituted (cli/lib/roles.mjs resolveRole)',
  )
  assert.equal(
    res.substituted.from,
    SOL,
    'from is the head that was ASKED for — with a policy in play that head is the policy lead, not the card tier; recording the card tier would erase the fact that the repo asked for codex and did not get it',
  )
  assert.equal(res.substituted.to, OPUS)
  assert.ok(res.substituted.reason.includes(SOL), `reason must name the skipped lead: ${res.substituted.reason}`)
})

test('a policy lead that EQUALS the card tier records NO substitution — nothing was substituted', () => {
  const res = resolveRole('quality-pass', 'claude', { policy: { default: 'opus' }, env: {} })
  assert.deepEqual(
    res,
    { role: 'quality-pass', model: OPUS, mode: 'child-cli' },
    'leading a chain with the model already at its head must not manufacture a substitution record — the scorecard would read a fallback that never happened',
  )
  assert.equal(Object.hasOwn(res, 'substituted'), false, 'substituted must be ABSENT, not undefined')
})

test('resolveRole mutates neither the policy it is handed nor MODEL_PRESETS', () => {
  const presetsBefore = JSON.stringify(MODEL_PRESETS)
  const policy = Object.freeze({ preset: 'codex', default: 'sol', roles: Object.freeze({ 'test-engineer': 'opus' }) })
  const first = resolveRole('test-engineer', 'codex', { policy, env: {} })
  const second = resolveRole('test-engineer', 'codex', { policy, env: {} })
  assert.deepEqual(first, second, 'two resolutions of the same frozen policy must agree — an in-place expansion of the preset would make the second call read a policy the first one rewrote')
  assert.deepEqual(
    { ...policy },
    { preset: 'codex', default: 'sol', roles: { 'test-engineer': 'opus' } },
    "resolveRole must expand the preset into a COPY — the caller's policy is what gets recorded in the phase record, and it must not change under it",
  )
  assert.equal(
    JSON.stringify(MODEL_PRESETS),
    presetsBefore,
    'preset expansion must never write back into MODEL_PRESETS — a layered explicit key would then leak into every later resolution in the process',
  )
})

// ── 6. REACH — mode is native | child-cli | inline ────────────────────────────────────

test("mode is 'native' ONLY when the resolved model's runner IS the driver and that driver declares subagents: 'native'", () => {
  assert.equal(
    DRIVERS.codex.roleCapabilities.subagents,
    'native',
    'fixture precondition: the codex entry must declare native subagents for this case to exist',
  )
  const res = resolveRole('software-architect', 'codex', { forceUnavailable: [FABLE], env: {} })
  assert.equal(res.model, SOL)
  assert.equal(
    res.mode,
    'native',
    "a codex session filling a role on its OWN pinned model spawns natively — fix the reach derivation in cli/lib/roles.mjs against DRIVERS[driverId].roleCapabilities",
  )
})

test("mode is 'child-cli' when a foreign driver's runner declares a headless child mechanism", () => {
  assert.equal(
    DRIVERS.claude.roleCapabilities.subagents,
    'child-cli',
    'fixture precondition: the claude entry must declare a headless child mechanism',
  )
  assert.equal(
    resolveRole('software-architect', 'codex', { env: {} }).mode,
    'child-cli',
    'a codex session reaches the claude-family architect head through claude -p --agents — this is the whole point of the multi-driver seam',
  )
  assert.equal(
    resolveRole('software-architect', 'claude', { env: {} }).mode,
    'child-cli',
    "the claude driver does not declare subagents: 'native', so even a same-family role is reached as a headless child, never reported as native",
  )
})

/** A prompts-only harness: declares no native subagents and no headless child mechanism. */
const PROMPTS_ONLY = Object.freeze({
  id: 'prompt-harness',
  family: 'synthetic',
  bin: 'prompt-harness',
  model: 'synthetic-1',
  roleCapabilities: Object.freeze({ subagents: 'none' }),
})

test('reachMode: a driver that can reach NO separate model fills the role INLINE, never native', () => {
  assert.equal(
    reachMode('prompt-harness', PROMPTS_ONLY, 'prompt-harness', PROMPTS_ONLY),
    'inline',
    'a harness with no native subagents and no headless child runs the role in its own context — reporting native there would hide that no separate model was reached (MULTI-DRIVER.md §1)',
  )
})

test('reachMode: a tier whose runner this driver cannot reach at all is null — unreachable, not "inline anyway"', () => {
  // BOTH sides decide: the runner being drivable is not enough if the DRIVER cannot spawn at all.
  assert.equal(
    reachMode('prompt-harness', PROMPTS_ONLY, 'claude', DRIVERS.claude),
    null,
    "the claude entry is drivable as a child, but a driver declaring subagents: 'none' can launch nothing — returning child-cli would hand it a model it can never start",
  )
  assert.equal(
    reachMode('codex', DRIVERS.codex, 'claude', DRIVERS.claude),
    'child-cli',
    'a driver that DOES spawn reaches a headless-child runner — this is the cross-family route the arc exists for',
  )
  const unreachable = Object.freeze({ ...PROMPTS_ONLY, id: 'other-harness' })
  assert.equal(
    reachMode('prompt-harness', PROMPTS_ONLY, 'other-harness', unreachable),
    null,
    'a foreign runner with no headless mechanism is UNREACHABLE from here — returning a mode would claim a model answered that was never launched',
  )
})

test('a role that may not grade its own work skips an inline-only tier and reports UNJUDGED, never seats the builder as its own judge', () => {
  assert.equal(
    ROLES['intent-validator'].inlineFallbackLegal,
    false,
    "fixture precondition: intent-validator's card says it never grades work it built",
  )
  const drivers = { 'prompt-harness': PROMPTS_ONLY }
  // intent-validator's head is FABLE — map it here so the refusal under test is the INLINE one,
  // not "nothing runs it"
  const modelDrivers = { [FABLE]: 'prompt-harness', [OPUS]: 'prompt-harness' }
  assert.throws(
    () => resolveRole('intent-validator', 'prompt-harness', { drivers, modelDrivers, env: {} }),
    (err) => {
      assert.ok(err instanceof RoleUnjudgedError, `got ${err?.name}: ${err?.message}`)
      assert.ok(err.message.includes('intent-validator'), `message must name the role: ${err.message}`)
      assert.ok(
        /INLINE/i.test(err.message),
        `message must say the tier was reachable only inline, and why that is refused: ${err.message}`,
      )
      return true
    },
    'an inline-only tier is unavailable to a role forbidden from grading its own work — the walk continues and, exhausted, reports UNJUDGED (cli/lib/roles.mjs)',
  )
  const permissive = resolveRole('phase-executor', 'prompt-harness', { drivers, modelDrivers, env: {} })
  assert.deepEqual(
    permissive,
    { role: 'phase-executor', model: OPUS, mode: 'inline' },
    'a builder-class role MAY be filled inline — and it is RECORDED as inline, first-class, never disguised as a spawn',
  )
})

test('no role/driver pair in the REAL registry resolves inline today — every registered driver is spawnable', () => {
  for (const roleId of Object.keys(ROLES)) {
    for (const driverId of Object.keys(DRIVERS)) {
      assert.notEqual(
        resolveRole(roleId, driverId, { env: {} }).mode,
        'inline',
        `${roleId}/${driverId}: both registry entries declare headlessChild, so an inline result means the reach derivation stopped reading cli/lib/drivers.mjs roleCapabilities`,
      )
    }
  }
})

test('every resolution reports a mode from the closed set — an unknown mode is unrecordable', () => {
  const MODES = new Set(['native', 'child-cli', 'inline'])
  for (const roleId of Object.keys(ROLES)) {
    for (const driverId of Object.keys(DRIVERS)) {
      const { mode } = resolveRole(roleId, driverId, { env: {} })
      assert.ok(
        MODES.has(mode),
        `${roleId}/${driverId}: mode '${mode}' is outside native|child-cli|inline — templates/schema.ts records this value, so an unknown one breaks the scorecard`,
      )
    }
  }
})

// ── 7. REFUSAL — unknown ids name the known set ───────────────────────────────────────

test('an unknown roleId throws naming the offending id AND every known role id', () => {
  const known = Object.keys(ROLES)
  assert.ok(known.length > 0, 'the table must be populated for this assertion to mean anything')
  assert.ok(!known.includes('release-manager'), "'release-manager' is the deliberately absent id — an entry would void this test")
  assert.throws(
    () => resolveRole('release-manager', 'codex', { env: {} }),
    (err) => {
      assert.ok(err instanceof Error, `threw a non-Error: ${String(err)}`)
      assert.ok(err.message.includes('release-manager'), `message must name the offending id: ${err.message}`)
      for (const id of known) {
        assert.ok(err.message.includes(id), `message must name known role ${id}: ${err.message}`)
      }
      return true
    },
  )
})

test('resolveRole refuses an Object.prototype member as a roleId — a prototype key is not a role', () => {
  for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.throws(
      () => resolveRole(id, 'codex', { env: {} }),
      (err) => {
        assert.ok(err instanceof Error, `${id}: threw a non-Error: ${String(err)}`)
        assert.ok(err.message.includes(id), `${id}: message must name the offending id: ${err.message}`)
        return true
      },
      `resolveRole('${id}') must refuse — guard the lookup with Object.hasOwn in cli/lib/roles.mjs`,
    )
  }
})

test("an unknown driverId propagates the registry's OWN throw naming every known driver", () => {
  const knownDrivers = Object.keys(DRIVERS)
  assert.ok(!knownDrivers.includes('grok'), 'grok is the deliberately empty driver slot — an entry would void this test')
  assert.throws(
    () => resolveRole('software-architect', 'grok', { env: {} }),
    (err) => {
      assert.ok(err instanceof Error, `threw a non-Error: ${String(err)}`)
      assert.ok(err.message.includes("unknown driver 'grok'"), `roles.mjs must let resolveDriver's own message through, not re-word it: ${err.message}`)
      for (const id of knownDrivers) {
        assert.ok(err.message.includes(id), `message must name known driver ${id}: ${err.message}`)
      }
      return true
    },
    'an unregistered driver is an EMPTY SLOT — resolveRole must call resolveDriver and let it refuse (cli/lib/drivers.mjs)',
  )
})

// ── 8. NO ROT — the table is evidence, and the chain has exactly one home ─────────────

test('ROLES and its entries are genuinely frozen — write attempts do not take', () => {
  const before = Object.keys(ROLES).sort()
  try {
    ROLES['release-manager'] = { id: 'release-manager' }
    ROLES['software-architect'] = { id: 'impostor' }
  } catch {
    // a strict-mode TypeError is the other legal outcome of the same freeze
  }
  assert.equal(Object.isFrozen(ROLES), true, 'ROLES must be Object.freeze()d in cli/lib/roles.mjs')
  assert.equal(ROLES['release-manager'], undefined)
  assert.equal(ROLES['software-architect'].id, 'software-architect')
  assert.deepEqual(Object.keys(ROLES).sort(), before)

  const entry = ROLES['software-architect']
  try {
    entry.class = 'builder'
    entry.tierChain.push(SONNET)
  } catch {
    // ditto
  }
  assert.equal(Object.isFrozen(entry), true, "each entry must be frozen too — an unfrozen entry lets a caller re-class a judge seam at runtime")
  assert.equal(entry.class, 'judge')
  assert.deepEqual(entry.tierChain, [FABLE, SOL, OPUS], 'the chain array itself must be frozen — a push would rewrite the user ruling in memory')
})

test('every entry carries its own id and an agentCard that EXISTS on disk', () => {
  for (const [id, entry] of Object.entries(ROLES)) {
    assert.equal(entry.id, id, `entry keyed '${id}' must carry the matching id`)
    assert.equal(entry.agentCard, `agents/${id}.md`, `${id}: agentCard must be the plugin-relative path of its own card`)
    assert.ok(
      existsSync(join(PLUGIN_ROOT, entry.agentCard)),
      `${id}: agentCard '${entry.agentCard}' does not exist under ${PLUGIN_ROOT} — the table points at a deleted or renamed card`,
    )
  }
})

test('roles map 1:1 onto agents/*.md — every card has an entry, every entry has a card', () => {
  const cards = readdirSync(join(PLUGIN_ROOT, 'agents'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name.replace(/\.md$/, ''))
    .sort()
  assert.ok(cards.length > 0, `unresolved anchor: scanned 0 cards under ${join(PLUGIN_ROOT, 'agents')}`)
  assert.deepEqual(
    Object.keys(ROLES).sort(),
    cards,
    'ROLES is one entry per agent card — a card without an entry has no model policy, and an entry without a card points at nothing (cli/lib/roles.mjs)',
  )
})

test('every spawnSites path exists AND mentions the role id — the inventory is evidence, not a claim', () => {
  for (const [id, entry] of Object.entries(ROLES)) {
    assert.ok(Array.isArray(entry.spawnSites), `${id}: spawnSites must be an array`)
    assert.ok(
      entry.spawnSites.length > 0,
      `${id}: no spawn site recorded — a role nothing spawns is either dead or the inventory is incomplete (cli/lib/roles.mjs)`,
    )
    for (const site of entry.spawnSites) {
      assert.ok(
        !site.startsWith('/') && !site.includes('..'),
        `${id}: spawn site '${site}' must be plugin-relative — an absolute or escaping path is not portable`,
      )
      const abs = join(PLUGIN_ROOT, site)
      assert.ok(existsSync(abs), `${id}: spawn site '${site}' does not exist — it was moved or deleted; update cli/lib/roles.mjs`)
      assert.ok(
        readFileSync(abs, 'utf8').includes(id),
        `${id}: spawn site '${site}' never mentions '${id}' — the site stopped spawning this role, so the inventory is a claim without evidence`,
      )
    }
  }
})

test('the tier chain has exactly ONE home — neither prose file restates it, and both point at MULTI-DRIVER.md', () => {
  assert.ok(
    existsSync(join(PLUGIN_ROOT, 'MULTI-DRIVER.md')),
    `MULTI-DRIVER.md is missing from ${PLUGIN_ROOT} — the two prose files below point at a document that must exist`,
  )
  const bindings = read('MULTI-DRIVER.md')
  assert.ok(
    bindings.includes('cli/lib/roles.mjs'),
    'MULTI-DRIVER.md must point at cli/lib/roles.mjs as the executable home of the role table — prose that owns the chain is a second source of truth',
  )

  // POSITIVE ratchet: forbidding the literal elsewhere only proves nobody ELSE says it. This
  // proves the one prose home says what the table holds, so the ruling cannot rot in place.
  const rendered = ROLES['software-architect'].tierChain.map((m) => `\`${m}\``).join(' → ')
  assert.ok(
    bindings.includes(rendered),
    `MULTI-DRIVER.md §1 must spell the architect chain exactly as cli/lib/roles.mjs holds it (${rendered}) — it is the ONE prose home, so a drift there is a lie about the user's ruling`,
  )

  for (const rel of ['agents/software-architect.md', 'skills/review-phase/SKILL.md', 'skills/using-zeroh-roadmap/references/codex-tools.md']) {
    assert.ok(existsSync(join(PLUGIN_ROOT, rel)), `unresolved anchor: ${rel} does not exist under ${PLUGIN_ROOT}`)
    const text = read(rel)
    assert.equal(
      text.includes(DRIVERS.codex.model),
      false,
      `${rel} restates a model id from the tier chain — the chain lives ONLY in cli/lib/roles.mjs (MULTI-DRIVER.md §1); replace the prose with a pointer`,
    )
    assert.ok(
      text.includes('MULTI-DRIVER.md'),
      `${rel} must point at MULTI-DRIVER.md for model policy — a card or skill that carries its own policy is the drift the table exists to kill`,
    )
  }
})

// ── 9. PROTOCOL PARITY — the two drivers' protocol sets, MEASURED ─────────────────────

/**
 * POLYSEAT's `no-claude-privilege` criterion forbids benefiting claude by supporting its protocol
 * while omitting a driver that could also be fully harnessed, and its honesty rail says a parity
 * claim ships with the command that would falsify it. Task 4.2 made the codex run lane deliver
 * skills/do-phase/SKILL.md BY PATH instead of paraphrasing it — this block is the instrument that
 * turns "same protocol" from an assertion into a measurement.
 *
 * THE PROTOCOL SET RULE (locked, MULTI-DRIVER.md §1): the PROTOCOL SET of a mission is its
 * `skills/<mission>/SKILL.md` plus every file under that skill's `references/` tree. `agents/*.md`
 * cards (and `agents/references/*`) are HARNESS-DELIVERY CONTEXT, not protocol: they are the
 * vehicle a Claude spawn uses to carry a subagent's own instruction set, and Codex has no
 * equivalent. They are excluded BY THIS NAMED RULE and PRINTED as exclusions, so the exclusion is
 * visible rather than silent. Without the rule the identity assertion is false-red by
 * construction — the claude-side manifest lists two agent cards a codex envelope can never name.
 *
 * The codex side is derived from the PROMPT TEXT that cli/commands/codex.mjs buildPrompt actually
 * generates (an envelope that stops naming its SKILL yields an EMPTY set and reds here); the
 * claude side from the committed cli/measure-manifest.json, flow `do-phase`. Nothing is mocked:
 * a real prompt over a real tmp root, the real manifest, the real files on disk.
 */

/** Manifest entries under here are protocol. */
const PROTOCOL_PREFIX = 'skills/'
/** Manifest entries under here are harness-delivery context — excluded by the rule, and printed. */
const HARNESS_DELIVERY_PREFIX = 'agents/'

/**
 * Envelope overhead ceiling: generated-prompt bytes ÷ delivered-protocol bytes.
 *
 * The envelope exists to DELIVER the protocol, never to BE it. The RED LINE is the pre-delivery
 * envelope — the one that PARAPHRASED do-phase instead of handing over its path, `git show
 * e965f4f~1:cli/commands/codex.mjs` — which measured 3992 / 16693 = 0.2391; a bound above that
 * would certify the very regression this instrument exists to catch. The bound therefore sits
 * just under it, and the lane's own overrides must fit: measured 3744 / 16693 = 0.2243 at the
 * time of writing. A ceiling with only a sentence of slack stops discriminating and starts
 * taxing — a genuine new override would red it, and the cheapest green would be deleting a
 * rule to buy bytes, which is why every lane override carries its own assertion in
 * cli/commands/codex.test.mjs: compacting may remove repetition, never semantics. The
 * measurement normalizes the install root, so absolute checkout-path length cannot decide
 * whether identical prose passes.
 */
const MAX_ENVELOPE_PROTOCOL_RATIO = 0.235

/** The one command a reader runs to re-derive both numbers without trusting this file. */
const REDERIVE_CMD = [
  `cd ${PLUGIN_ROOT} && node --input-type=module -e `,
  `"import{buildPrompt,RUN_SKILL}from'./cli/commands/codex.mjs';`,
  `import{mkdtempSync,mkdirSync,writeFileSync,statSync,readdirSync}from'node:fs';import{join,dirname}from'node:path';`,
  `import{tmpdir}from'node:os';const r=mkdtempSync(join(tmpdir(),'psr-'));mkdirSync(join(r,'roadmap','phases'),{recursive:true});`,
  `writeFileSync(join(r,'roadmap','phases','phase-1.phase.ts'),'');const d=join(dirname(RUN_SKILL),'references');`,
  `const f=[RUN_SKILL,...readdirSync(d,{recursive:true}).map(x=>join(d,x))].filter(x=>statSync(x).isFile());`,
  `const p=f.reduce((s,x)=>s+statSync(x).size,0);const e=Buffer.byteLength(buildPrompt(r,['1']).replaceAll(process.cwd(),'<PLUGIN_ROOT>'),'utf8');`,
  `console.log({envelopeBytes:e,protocolBytes:p,ratio:+(e/p).toFixed(4)})"`,
].join('')

/** Plugin-relative, forward-slashed — the two sides derive paths differently, so they only meet here. */
const pluginRel = (abs) => relative(PLUGIN_ROOT, abs).split(sep).join('/')
const normalizePluginRoot = (prompt, root = PLUGIN_ROOT) => prompt.split(root).join('<PLUGIN_ROOT>')

/** THE RULE, applied: one mission SKILL.md + every file under its references/ tree. */
function protocolSetOf(skillRel) {
  const refDir = join(PLUGIN_ROOT, dirname(skillRel), 'references')
  const refs = existsSync(refDir)
    ? readdirSync(refDir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => pluginRel(join(e.parentPath ?? e.path, e.name)))
    : []
  return [...new Set([skillRel, ...refs])].sort()
}

/**
 * What the run-lane ENVELOPE actually references — read back out of the generated prompt text.
 * Computed on FIRST USE (and memoized), so a throw from cli/commands/codex.mjs reds this block
 * alone instead of failing the whole file at import and taking blocks 1-7 down with it.
 */
let _codexSide
const codexSide = () => (_codexSide ??= (() => {
  const root = mkdtempSync(join(tmpdir(), 'protocol-parity-'))
  try {
    mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
    writeFileSync(join(root, 'roadmap', 'phases', 'phase-1.phase.ts'), '')
    const prompt = buildPrompt(root, ['1'])
    const skills = [...new Set([...prompt.matchAll(/\S*\/SKILL\.md/g)].map((m) => m[0]))]
      .map((p) => (isAbsolute(p) ? pluginRel(p) : p))
      .filter((p) => !p.startsWith('..'))
      .sort()
    return { envelopeBytes: Buffer.byteLength(normalizePluginRoot(prompt), 'utf8'), skills, set: [...new Set(skills.flatMap(protocolSetOf))].sort() }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})())

/** What a claude phase-executor LOADS, per the committed manifest — partitioned by the rule. */
let _claudeSide
const claudeSide = () => (_claudeSide ??= (() => {
  const flow = JSON.parse(read('cli/measure-manifest.json')).flows['do-phase']
  const paths = (flow?.files ?? []).map((f) => f.path)
  const protocolEntries = paths.filter((p) => p.startsWith(PROTOCOL_PREFIX))
  return {
    paths,
    excluded: paths.filter((p) => !p.startsWith(PROTOCOL_PREFIX)).sort(),
    set: [...new Set(protocolEntries.flatMap(protocolSetOf))].sort(),
  }
})())

test('codex and claude are handed the SAME protocol set — the identity is measured, file by file', () => {
  assert.ok(
    claudeSide().paths.length > 0,
    "cli/measure-manifest.json has no flows['do-phase'].files — with no claude-side manifest there is nothing to compare the codex envelope against, so the parity claim is unfalsifiable",
  )
  assert.ok(
    codexSide().set.length > 0,
    'the run-lane prompt names NO SKILL.md, so the codex driver is handed no protocol at all — fix cli/commands/codex.mjs buildPrompt (it must deliver skills/do-phase/SKILL.md by path, not paraphrase it)',
  )
  const onlyCodex = codexSide().set.filter((p) => !claudeSide().set.includes(p))
  const onlyClaude = claudeSide().set.filter((p) => !codexSide().set.includes(p))
  assert.deepEqual(
    codexSide().set,
    claudeSide().set,
    'PROTOCOL PARITY BROKEN — the two drivers do not read the same bytes, so every per-model cell of the eval scorecard is comparing briefings, not models.\n'
      + `  only the CODEX envelope delivers: ${onlyCodex.length ? onlyCodex.join(', ') : '(none)'}\n`
      + `  only the CLAUDE manifest loads:   ${onlyClaude.length ? onlyClaude.join(', ') : '(none)'}\n`
      + '  Fix ONE of three places, whichever is wrong: cli/commands/codex.mjs buildPrompt (the envelope stopped naming a protocol file), '
      + 'cli/measure-manifest.json flow do-phase (a file was added to the claude load without reaching the codex lane), '
      + "or the protocol-set rule itself in this block (a new kind of protocol file that isn't SKILL.md + references/).",
  )
})

test('the harness-delivery exclusions are PRINTED, and every one is an agents/ path — the rule may never quietly drop a skill file', () => {
  console.log(
    '\n[protocol-set rule] agents/*.md cards are HARNESS-DELIVERY CONTEXT, not protocol — excluded from the parity set '
      + `(a Claude spawn's own instruction-set vehicle; Codex has no equivalent). Excluded from cli/measure-manifest.json flow do-phase:\n`
      + claudeSide().excluded.map((p) => `  - ${p}`).join('\n'),
  )
  assert.ok(
    claudeSide().excluded.length > 0,
    'the exclusion list is EMPTY, so this rule is currently deciding nothing and the parity assertion above is unguarded — '
      + 'if the agent cards really left cli/measure-manifest.json flow do-phase, delete the rule instead of leaving a no-op in place',
  )
  for (const p of claudeSide().excluded) {
    assert.ok(
      p.startsWith(HARNESS_DELIVERY_PREFIX),
      `'${p}' is being excluded from the protocol set but is not an ${HARNESS_DELIVERY_PREFIX} path — the rule excludes harness-delivery cards ONLY. `
        + 'If this is a skill file, the parity assertion is silently comparing a shrunken set: fix cli/measure-manifest.json (wrong prefix) or state a NEW named rule here for it.',
    )
  }
})

test('the protocol set is non-trivial — one mission SKILL.md, at least one references/ file, all on disk', () => {
  assert.deepEqual(
    codexSide().skills,
    ['skills/do-phase/SKILL.md'],
    `the run lane delivers exactly ONE mission protocol, do-phase — the prompt names ${codexSide().skills.join(', ') || '(nothing)'}; fix cli/commands/codex.mjs buildPrompt`,
  )
  for (const skill of codexSide().skills) {
    assert.ok(codexSide().set.includes(skill), `${skill} is named by the envelope but missing from its own protocol set — the rule's expansion dropped it`)
  }
  assert.ok(
    codexSide().set.some((p) => p.includes('/references/')),
    `the protocol set carries no references/ file (${codexSide().set.join(', ')}) — parity over a single SKILL.md proves nothing about the tree it sends the driver into; `
      + "if skills/do-phase/references/ really emptied, this block's rule needs re-deciding, not relaxing",
  )
  assert.ok(codexSide().set.length >= 2, `a ${codexSide().set.length}-file protocol set is too thin to certify parity over: ${codexSide().set.join(', ')}`)
  for (const p of codexSide().set) {
    assert.ok(
      existsSync(join(PLUGIN_ROOT, p)),
      `protocol member '${p}' does NOT exist under ${PLUGIN_ROOT} — the codex driver is being sent to a deleted or renamed file; fix cli/commands/codex.mjs buildPrompt (RUN_SKILL) or restore the file`,
    )
  }
})

test('envelope overhead is BOUNDED — the prompt delivers the protocol, it does not restate it', () => {
  const protocolBytes = codexSide().set.reduce((sum, p) => sum + statSync(join(PLUGIN_ROOT, p)).size, 0)
  const { envelopeBytes } = codexSide()
  const ratio = envelopeBytes / protocolBytes
  console.log(
    `\n[envelope overhead] envelopeBytes=${envelopeBytes} protocolBytes=${protocolBytes} ratio=${ratio.toFixed(4)} (bound ${MAX_ENVELOPE_PROTOCOL_RATIO})\n`
      + `  protocol set: ${codexSide().set.join(', ')}\n`
      + `  re-derive it yourself: ${REDERIVE_CMD}`,
  )
  assert.ok(protocolBytes > 0, 'the protocol set measured 0 bytes — nothing is being delivered, so the ratio below would be meaningless')
  assert.ok(
    ratio < MAX_ENVELOPE_PROTOCOL_RATIO,
    `envelope overhead ${ratio.toFixed(4)} (${envelopeBytes}B envelope over ${protocolBytes}B of protocol) breached MAX_ENVELOPE_PROTOCOL_RATIO=${MAX_ENVELOPE_PROTOCOL_RATIO}. `
      + 'A lane that starts RESTATING its protocol grows the envelope — that is the regression this number catches (the pre-4.2 paraphrasing envelope measured 0.239). '
      + 'Fix cli/commands/codex.mjs buildPrompt: move the prose into skills/do-phase/SKILL.md (or its references/) and hand it over by path, keeping only targets + disposition overrides here. '
      + `Re-derive: ${REDERIVE_CMD}`,
  )
})

test('envelope overhead normalization is independent of the plugin install-root length', () => {
  const root = mkdtempSync(join(tmpdir(), 'protocol-root-length-'))
  try {
    mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
    writeFileSync(join(root, 'roadmap', 'phases', 'phase-1.phase.ts'), '')
    const prompt = buildPrompt(root, ['1'])
    const longerRoot = `${PLUGIN_ROOT}-a-deliberately-longer-install-root`
    const relocated = prompt.split(PLUGIN_ROOT).join(longerRoot)
    assert.equal(
      Buffer.byteLength(normalizePluginRoot(prompt), 'utf8'),
      Buffer.byteLength(normalizePluginRoot(relocated, longerRoot), 'utf8'),
      'the same envelope installed at a longer path must consume the same normalized byte budget',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
