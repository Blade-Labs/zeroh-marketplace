#!/usr/bin/env node
/**
 * Fixtures for cli/lib/drivers.mjs. Pins the codex launch inputs against a LITERAL fixture
 * of the spawn argv (written out in full — never rebuilt from the registry's own data, which
 * would assert nothing), the alias vocabulary a consumer's config spells models with, the
 * refusal on an unregistered id, the host-stamped provenance shape, and the ratchet holding
 * every model-specific argv inside the registry.
 * Run: node --test cli/lib/drivers.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRIVERS, MODEL_ALIASES, MODEL_DRIVERS, MODEL_IDS, resolveDriver, launchArgv, driverStamp } from './drivers.mjs'

// ── criterion 1: the extraction reproduces today's spawn inputs byte-for-byte ─────────
test("launchArgv('codex') plus the entry's bin reproduce today's spawn inputs exactly", () => {
  assert.equal(resolveDriver('codex').bin, 'codex')
  assert.deepEqual(launchArgv('codex', { worktree: '/tmp/wt-42' }), [
    'exec',
    '--dangerously-bypass-approvals-and-sandbox',
    '-m',
    'gpt-6-astra',
    '-C',
    '/tmp/wt-42',
    '-',
  ])
})

test('launchArgv threads the caller\'s worktree into the -C position, never a baked path', () => {
  assert.deepEqual(launchArgv('codex', { worktree: '/srv/checkouts/zeroh-codex-2' }), [
    'exec',
    '--dangerously-bypass-approvals-and-sandbox',
    '-m',
    'gpt-6-astra',
    '-C',
    '/srv/checkouts/zeroh-codex-2',
    '-',
  ])
})

// ── the launcher PINS the model, so the journal records a command, not an observation ──
test("the codex entry's declared model is the one the argv pins — one home, no second literal", () => {
  const entry = resolveDriver('codex')
  assert.equal(typeof entry.model, 'string')
  assert.ok(entry.model.length > 0, 'a declared model must be a real id')
  const argv = launchArgv('codex', { worktree: '/tmp/wt-1' })
  const at = argv.indexOf('-m')
  assert.ok(at >= 0, `the launch argv must pin the model: ${argv.join(' ')}`)
  assert.equal(
    argv[at + 1],
    entry.model,
    'the pinned argv model and the declared entry model must be one value — a divergence makes the journal lie',
  )
})

test('driverStamp reads { model, lane } off the registry — lane is the DRIVER ID, not the journal lane', () => {
  assert.deepEqual(driverStamp(resolveDriver('codex')), { model: 'gpt-6-astra', lane: 'codex' })
})

test('driverStamp on an entry declaring NO model records model: null explicitly, never an absent key', () => {
  assert.equal(resolveDriver('claude').model, undefined, 'fixture precondition: the claude entry pins no model')
  const stamp = driverStamp(resolveDriver('claude'))
  assert.equal(stamp.lane, 'claude')
  assert.equal(stamp.model, null, 'an unpinned model is RECORDED as unrecorded, never guessed')
  assert.ok('model' in stamp, 'present-and-null — an omitted key is indistinguishable from a forgotten stamp')
})

// ── the alias vocabulary: every bindable model is NAMEABLE from a consumer's config ────
test("MODEL_ALIASES.sol names the codex pinned model — the CONFIG spelling of the one id no alias could reach", () => {
  assert.equal(
    MODEL_ALIASES.sol,
    'gpt-6-astra',
    "a consumer's modelPolicy can only ever carry an ALIAS, so an unaliased model is a model no repo can ask for — add sol: MODEL_IDS.SOL to MODEL_ALIASES in cli/lib/drivers.mjs",
  )
  assert.equal(
    MODEL_ALIASES.sol,
    resolveDriver('codex').model,
    'the sol alias and the codex entry\'s pinned model are one value — a divergence lets a policy name a model no launcher will pin',
  )
})

test('every model id the plugin binds carries exactly one alias — an unnameable model is unaskable', () => {
  assert.deepEqual(
    [...new Set(Object.values(MODEL_ALIASES))].sort(),
    Object.values(MODEL_IDS).sort(),
    'MODEL_ALIASES must cover MODEL_IDS one-for-one: a model id with no alias cannot be spelled in roadmap.config.json or --models, and an alias naming an id outside MODEL_IDS names a model this plugin never binds (cli/lib/drivers.mjs)',
  )
  assert.equal(
    Object.keys(MODEL_ALIASES).length,
    Object.keys(MODEL_IDS).length,
    'two aliases for one model id would give the same policy two spellings and the recorded snapshot two readings',
  )
})

test('every alias resolves to a model some registered driver actually runs', () => {
  for (const [alias, model] of Object.entries(MODEL_ALIASES)) {
    assert.ok(
      Object.hasOwn(MODEL_DRIVERS, model),
      `alias '${alias}' names '${model}', which routes to no driver — route it in MODEL_DRIVERS or stop aliasing it (cli/lib/drivers.mjs)`,
    )
    assert.ok(
      Object.hasOwn(DRIVERS, MODEL_DRIVERS[model]),
      `alias '${alias}' routes to driver '${MODEL_DRIVERS[model]}', which is not a registered entry — a policy naming '${alias}' would resolve to an empty slot`,
    )
  }
})

// ── criterion 2: an unregistered id REFUSES, naming the known set ─────────────────────
test("resolveDriver('codex') returns the entry whose id is 'codex'", () => {
  assert.equal(resolveDriver('codex').id, 'codex')
})

test('resolveDriver refuses an Object.prototype member — a prototype key is not a driver', () => {
  for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.throws(
      () => resolveDriver(id),
      (err) => {
        assert.ok(err instanceof Error, `${id}: threw a non-Error: ${String(err)}`)
        assert.ok(err.message.includes(`unknown driver '${id}'`), `${id}: ${err.message}`)
        return true
      },
      `resolveDriver('${id}') must refuse, never return a prototype member`,
    )
  }
})

test("resolveDriver('grok') throws naming the offending id and every known driver id", () => {
  const known = Object.keys(DRIVERS)
  assert.ok(known.length > 0, 'the registry must be populated for this assertion to mean anything')
  assert.ok(!known.includes('grok'), 'grok is the deliberately empty slot — an entry would void this test')
  assert.throws(
    () => resolveDriver('grok'),
    (err) => {
      assert.ok(err instanceof Error, `threw a non-Error: ${String(err)}`)
      assert.match(err.message, /grok/, `message must name the offending id: ${err.message}`)
      for (const id of known) {
        assert.ok(err.message.includes(id), `message must name known driver ${id}: ${err.message}`)
      }
      return true
    },
  )
})

// ── registry integrity ────────────────────────────────────────────────────────────────
test('DRIVERS is genuinely frozen — a write attempt does not mutate it', () => {
  const before = Object.keys(DRIVERS).sort()
  try {
    DRIVERS.grok = { id: 'grok' }
    DRIVERS.codex = { id: 'impostor' }
  } catch {
    // a strict-mode TypeError is the other legal outcome of the same freeze
  }
  assert.equal(Object.isFrozen(DRIVERS), true)
  assert.equal(DRIVERS.grok, undefined)
  assert.equal(DRIVERS.codex.id, 'codex')
  assert.deepEqual(Object.keys(DRIVERS).sort(), before)
})

test('every populated entry carries host-stamped verifiedAt with PASTED probe output', () => {
  const entries = Object.entries(DRIVERS)
  assert.ok(entries.length >= 2, `expected codex + claude entries, got ${entries.map(([k]) => k).join(', ')}`)
  for (const [id, entry] of entries) {
    assert.equal(entry.id, id, `entry keyed ${id} must carry the matching id`)
    assert.equal(typeof entry.bin, 'string')
    assert.ok(entry.bin.length > 0, `${id}: bin must be non-empty`)
    const v = entry.verifiedAt
    assert.ok(v && typeof v === 'object', `${id}: verifiedAt must be an object, never a bare boolean`)
    for (const field of ['date', 'host', 'command', 'output']) {
      assert.equal(typeof v[field], 'string', `${id}: verifiedAt.${field} must be a string`)
      assert.ok(v[field].trim().length > 0, `${id}: verifiedAt.${field} must be non-empty — provenance is evidence`)
    }
  }
})

// ── singleSeam: one driver registry — no model-specific argv lives outside it ─────────
const CLI_ROOT = fileURLToPath(new URL('../', import.meta.url))
// Quote-inclusive: the bare flag name is legal in prose, only a quoted token is launcher argv.
const BYPASS_ARGV = "'--dangerously-bypass-approvals-and-sandbox'"
const MODEL_LITERAL = "'gpt-6-astra'"
const REGISTRY_NEEDLES = [BYPASS_ARGV, MODEL_LITERAL]
const ARGV_HOMES = new Set(['lib/drivers.mjs', 'lib/drivers.test.mjs'])

function readCliTree(dir, prefix = '') {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...readCliTree(join(dir, entry.name), rel))
    else if (entry.isFile()) files.push({ rel, text: readFileSync(join(dir, entry.name), 'utf8') })
  }
  return files
}

test('no file under cli/ outside the driver registry carries a codex launch literal', () => {
  assert.ok(
    existsSync(CLI_ROOT) && statSync(CLI_ROOT).isDirectory(),
    `unresolved anchor: scan root ${CLI_ROOT} is not a directory — this ratchet would scan nothing`,
  )
  const files = readCliTree(CLI_ROOT)
  assert.ok(files.length > 0, `unresolved anchor: scanned 0 files under ${CLI_ROOT}`)
  for (const home of ARGV_HOMES) {
    assert.ok(
      files.some((f) => f.rel === home),
      `unresolved anchor: ${home} was never reached by the scan of ${CLI_ROOT}`,
    )
  }
  const registry = files.find((f) => f.rel === 'lib/drivers.mjs')
  for (const needle of REGISTRY_NEEDLES) {
    assert.ok(
      registry.text.includes(needle),
      `stale needle: ${needle} no longer appears in lib/drivers.mjs — retarget this ratchet at the registry's current launch literals`,
    )
  }

  const offenders = []
  for (const file of files) {
    if (ARGV_HOMES.has(file.rel)) continue
    file.text.split('\n').forEach((line, i) => {
      for (const needle of REGISTRY_NEEDLES) {
        if (line.includes(needle)) offenders.push(`cli/${file.rel}:${i + 1} (${needle})`)
      }
    })
  }
  assert.deepEqual(
    offenders,
    [],
    `model-specific launch literal outside the driver registry: ${offenders.join(', ')} — source it from launchArgv('codex', { worktree }) / driverStamp(resolveDriver('codex')) in cli/lib/drivers.mjs, the one home for every launch argv and every declared model id`,
  )
})
