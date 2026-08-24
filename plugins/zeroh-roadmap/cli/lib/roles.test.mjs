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
 *  5. REACH — `mode` is native | child-cli | inline, derived from the driver registry; inline
 *     is first-class and RECORDED, never indistinguishable from native.
 *  6. REFUSAL — unknown role / unknown driver throw naming the offending id and the known set.
 *  7. NO ROT — every agentCard and every spawnSite path exists on disk, spawnSites MENTION the
 *     role (inventory as evidence), roles map 1:1 onto agents/*.md, and the chain has exactly
 *     one home (the two prose files may not restate it).
 *  8. PROTOCOL PARITY — the codex envelope and the claude manifest deliver the SAME protocol set
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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrompt } from '../commands/codex.mjs'
import { DRIVERS, MODEL_DRIVERS, MODEL_IDS } from './drivers.mjs'
import { ROLES, RoleUnjudgedError, reachMode, resolveRole } from './roles.mjs'

const PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (rel) => readFileSync(join(PLUGIN_ROOT, rel), 'utf8')

const FABLE = MODEL_IDS.FABLE
const OPUS = MODEL_IDS.OPUS
const SONNET = MODEL_IDS.SONNET
const SOL = MODEL_IDS.SOL

/** The harness alias vocabulary a card may carry -> the registry model id it means. */
const ALIAS_TO_MODEL = { fable: FABLE, opus: OPUS, sonnet: SONNET }

/** Written out in full — the expectation must not be rebuilt from the table under test. */
const EXPECTED_CHAINS = {
  'arc-eval-judge': [SONNET],
  'code-reviewer': [OPUS],
  'intent-validator': [OPUS],
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
    ['intent-validator', 'codex', OPUS, 'child-cli'],
    ['intent-validator', 'claude', OPUS, 'child-cli'],
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

test('judgeModel prepends to the chain for EVERY judge-class role', () => {
  assert.ok(JUDGE_ROLES.length >= 4, `fixture precondition: expected the judge seams, got ${JUDGE_ROLES.join(', ')}`)
  for (const id of JUDGE_ROLES) {
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

// ── 5. REACH — mode is native | child-cli | inline ────────────────────────────────────

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
  assert.equal(
    reachMode('prompt-harness', PROMPTS_ONLY, 'claude', DRIVERS.claude),
    'child-cli',
    'the claude entry declares a headless child mechanism, so even a prompts-only driver can shell to it',
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
  const modelDrivers = { [OPUS]: 'prompt-harness' }
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

// ── 6. REFUSAL — unknown ids name the known set ───────────────────────────────────────

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

// ── 7. NO ROT — the table is evidence, and the chain has exactly one home ─────────────

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

  for (const rel of ['agents/software-architect.md', 'skills/review-phase/SKILL.md']) {
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

// ── 8. PROTOCOL PARITY — the two drivers' protocol sets, MEASURED ─────────────────────

/**
 * POLYSEAT's `no-claude-privilege` criterion forbids benefiting claude by supporting its protocol
 * while omitting a driver that could also be fully harnessed, and its honesty rail says a parity
 * claim ships with the command that would falsify it. Task 4.2 made the codex run lane deliver
 * skills/do-phase/SKILL.md BY PATH instead of paraphrasing it — this block is the instrument that
 * turns "same protocol" from an assertion into a measurement.
 *
 * THE PROTOCOL SET RULE (locked 2026-08-23): the PROTOCOL SET of a mission is its
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
 * The envelope exists to DELIVER the protocol, never to BE it. Measured 2026-08-23: 3070 / 16693
 * = 0.184. The pre-task-4.2 envelope — the one that PARAPHRASED do-phase instead of handing over
 * its path (cli/commands/codex.mjs at e965f4f~1) — measured 3992 / 16693 = 0.239. This bound sits
 * between the two on purpose: ~600 bytes of headroom for genuine new lane overrides, and a red the
 * moment the lane starts restating protocol it is supposed to deliver by path, which is exactly
 * how the scorecard's per-model cells silently become a comparison of briefings.
 */
const MAX_ENVELOPE_PROTOCOL_RATIO = 0.22

/** The one command a reader runs to re-derive both numbers without trusting this file. */
const REDERIVE_CMD = [
  `cd ${PLUGIN_ROOT} && node --input-type=module -e`,
  `"import{buildPrompt,RUN_SKILL}from'./cli/commands/codex.mjs';`,
  `import{mkdtempSync,mkdirSync,writeFileSync,statSync,readdirSync}from'node:fs';import{join,dirname}from'node:path';`,
  `import{tmpdir}from'node:os';const r=mkdtempSync(join(tmpdir(),'psr-'));mkdirSync(join(r,'roadmap','phases'),{recursive:true});`,
  `writeFileSync(join(r,'roadmap','phases','phase-1.phase.ts'),'');const d=join(dirname(RUN_SKILL),'references');`,
  `const f=[RUN_SKILL,...readdirSync(d,{recursive:true}).map(x=>join(d,x))].filter(x=>statSync(x).isFile());`,
  `const p=f.reduce((s,x)=>s+statSync(x).size,0);const e=Buffer.byteLength(buildPrompt(r,['1']),'utf8');`,
  `console.log({envelopeBytes:e,protocolBytes:p,ratio:+(e/p).toFixed(4)})"`,
].join('')

/** Plugin-relative, forward-slashed — the two sides derive paths differently, so they only meet here. */
const pluginRel = (abs) => relative(PLUGIN_ROOT, abs).split(sep).join('/')

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

/** What the run-lane ENVELOPE actually references — read back out of the generated prompt text. */
const codexSide = (() => {
  const root = mkdtempSync(join(tmpdir(), 'protocol-parity-'))
  try {
    mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
    writeFileSync(join(root, 'roadmap', 'phases', 'phase-1.phase.ts'), '')
    const prompt = buildPrompt(root, ['1'])
    const skills = [...new Set([...prompt.matchAll(/\S*\/SKILL\.md/g)].map((m) => m[0]))]
      .map((p) => (isAbsolute(p) ? pluginRel(p) : p))
      .filter((p) => !p.startsWith('..'))
      .sort()
    return { envelopeBytes: Buffer.byteLength(prompt, 'utf8'), skills, set: [...new Set(skills.flatMap(protocolSetOf))].sort() }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})()

/** What a claude phase-executor LOADS, per the committed manifest — partitioned by the rule. */
const claudeSide = (() => {
  const flow = JSON.parse(read('cli/measure-manifest.json')).flows['do-phase']
  const paths = (flow?.files ?? []).map((f) => f.path)
  const protocolEntries = paths.filter((p) => p.startsWith(PROTOCOL_PREFIX))
  return {
    paths,
    excluded: paths.filter((p) => !p.startsWith(PROTOCOL_PREFIX)).sort(),
    set: [...new Set(protocolEntries.flatMap(protocolSetOf))].sort(),
  }
})()

test('codex and claude are handed the SAME protocol set — the identity is measured, file by file', () => {
  assert.ok(
    claudeSide.paths.length > 0,
    "cli/measure-manifest.json has no flows['do-phase'].files — with no claude-side manifest there is nothing to compare the codex envelope against, so the parity claim is unfalsifiable",
  )
  assert.ok(
    codexSide.set.length > 0,
    'the run-lane prompt names NO SKILL.md, so the codex driver is handed no protocol at all — fix cli/commands/codex.mjs buildPrompt (it must deliver skills/do-phase/SKILL.md by path, not paraphrase it)',
  )
  const onlyCodex = codexSide.set.filter((p) => !claudeSide.set.includes(p))
  const onlyClaude = claudeSide.set.filter((p) => !codexSide.set.includes(p))
  assert.deepEqual(
    codexSide.set,
    claudeSide.set,
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
      + claudeSide.excluded.map((p) => `  - ${p}`).join('\n'),
  )
  assert.ok(
    claudeSide.excluded.length > 0,
    'the exclusion list is EMPTY, so this rule is currently deciding nothing and the parity assertion above is unguarded — '
      + 'if the agent cards really left cli/measure-manifest.json flow do-phase, delete the rule instead of leaving a no-op in place',
  )
  for (const p of claudeSide.excluded) {
    assert.ok(
      p.startsWith(HARNESS_DELIVERY_PREFIX),
      `'${p}' is being excluded from the protocol set but is not an ${HARNESS_DELIVERY_PREFIX} path — the rule excludes harness-delivery cards ONLY. `
        + 'If this is a skill file, the parity assertion is silently comparing a shrunken set: fix cli/measure-manifest.json (wrong prefix) or state a NEW named rule here for it.',
    )
  }
})

test('the protocol set is non-trivial — one mission SKILL.md, at least one references/ file, all on disk', () => {
  assert.deepEqual(
    codexSide.skills,
    ['skills/do-phase/SKILL.md'],
    `the run lane delivers exactly ONE mission protocol, do-phase — the prompt names ${codexSide.skills.join(', ') || '(nothing)'}; fix cli/commands/codex.mjs buildPrompt`,
  )
  for (const skill of codexSide.skills) {
    assert.ok(codexSide.set.includes(skill), `${skill} is named by the envelope but missing from its own protocol set — the rule's expansion dropped it`)
  }
  assert.ok(
    codexSide.set.some((p) => p.includes('/references/')),
    `the protocol set carries no references/ file (${codexSide.set.join(', ')}) — parity over a single SKILL.md proves nothing about the tree it sends the driver into; `
      + "if skills/do-phase/references/ really emptied, this block's rule needs re-deciding, not relaxing",
  )
  assert.ok(codexSide.set.length >= 2, `a ${codexSide.set.length}-file protocol set is too thin to certify parity over: ${codexSide.set.join(', ')}`)
  for (const p of codexSide.set) {
    assert.ok(
      existsSync(join(PLUGIN_ROOT, p)),
      `protocol member '${p}' does NOT exist under ${PLUGIN_ROOT} — the codex driver is being sent to a deleted or renamed file; fix cli/commands/codex.mjs buildPrompt (RUN_SKILL) or restore the file`,
    )
  }
})

test('envelope overhead is BOUNDED — the prompt delivers the protocol, it does not restate it', () => {
  const protocolBytes = codexSide.set.reduce((sum, p) => sum + statSync(join(PLUGIN_ROOT, p)).size, 0)
  const { envelopeBytes } = codexSide
  const ratio = envelopeBytes / protocolBytes
  console.log(
    `\n[envelope overhead] envelopeBytes=${envelopeBytes} protocolBytes=${protocolBytes} ratio=${ratio.toFixed(4)} (bound ${MAX_ENVELOPE_PROTOCOL_RATIO})\n`
      + `  protocol set: ${codexSide.set.join(', ')}\n`
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
