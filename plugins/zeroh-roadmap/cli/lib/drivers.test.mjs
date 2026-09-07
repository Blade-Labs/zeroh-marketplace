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
import { DRIVERS, MODEL_ALIASES, MODEL_DRIVERS, MODEL_IDS, resolveDriver, launchArgv, resumeArgv, driverStamp, intersectAuthority } from './drivers.mjs'

const KNOWN_PARENT = Object.freeze({
  profile: 'workspace-write',
  bounds: Object.freeze({ filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }),
  provenance: Object.freeze({ kind: 'explicit-operator-invocation', source: '--parent-authority workspace-write' }),
})

function requestAuthority(overrides = {}) {
  return {
    profile: 'inherit',
    bounds: { ...KNOWN_PARENT.bounds },
    provenance: null,
    ...overrides,
  }
}

// RED means delegated Codex authority can exceed, invent, or mutate its parent's authority.
test('intersectAuthority: inherit resolves to the parent ceiling and preserves the auditable request', () => {
  const request = requestAuthority()
  const envelope = intersectAuthority(KNOWN_PARENT, request)

  assert.deepEqual(envelope.parent, KNOWN_PARENT)
  assert.deepEqual(envelope.request, request)
  assert.deepEqual(envelope.effective, {
    profile: 'workspace-write',
    bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false },
  })
})

test('intersectAuthority: a request may narrow every bound under a broad, known parent', () => {
  const parent = {
    profile: 'isolated-unsafe',
    bounds: { filesystem: 'unrestricted', network: 'allowed', gitPush: true, externalWrites: true },
    provenance: { kind: 'managed-host-input', source: 'supervisor authority receipt', attestedAt: '2026-09-07T10:00:00.000Z' },
  }
  const request = requestAuthority({
    profile: 'workspace-write',
    bounds: { filesystem: 'read-only', network: 'approval', gitPush: false, externalWrites: false },
  })

  assert.deepEqual(intersectAuthority(parent, request).effective, {
    profile: 'workspace-write',
    bounds: request.bounds,
  })
})

test('intersectAuthority: every single-bound enlargement is rejected', () => {
  const cases = [
    ['filesystem', { filesystem: 'unrestricted', network: 'denied', gitPush: false, externalWrites: false }],
    ['network', { filesystem: 'workspace-write', network: 'approval', gitPush: false, externalWrites: false }],
    ['gitPush', { filesystem: 'workspace-write', network: 'denied', gitPush: true, externalWrites: false }],
    ['externalWrites', { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: true }],
  ]
  for (const [dimension, bounds] of cases) {
    assert.throws(
      () => intersectAuthority(KNOWN_PARENT, requestAuthority({ profile: 'workspace-write', bounds })),
      new RegExp(dimension, 'i'),
      `${dimension}: a child request cannot grant itself authority its parent lacks`,
    )
  }
})

test('intersectAuthority: missing or unrecognized parent authority holds instead of inferring permission', () => {
  assert.throws(() => intersectAuthority(undefined, requestAuthority()), /parent|authority|ceiling/i)
  assert.throws(
    () => intersectAuthority({ ...KNOWN_PARENT, bounds: { ...KNOWN_PARENT.bounds, network: 'unknown' } }, requestAuthority()),
    /parent|network|unknown/i,
  )
  for (const provenance of [
    undefined,
    { kind: 'explicit-operator-invocation', source: '' },
    { kind: 'self-asserted', source: '--parent-authority workspace-write' },
  ]) {
    assert.throws(
      () => intersectAuthority({ ...KNOWN_PARENT, provenance }, requestAuthority()),
      /parent|provenance|source|kind/i,
      `invalid parent provenance must hold: ${JSON.stringify(provenance)}`,
    )
  }
})

test('intersectAuthority: inherit means the exact parent bounds; narrowing requires an explicit profile', () => {
  assert.throws(
    () => intersectAuthority(KNOWN_PARENT, requestAuthority({
      bounds: { filesystem: 'read-only', network: 'denied', gitPush: false, externalWrites: false },
    })),
    /inherit|bounds|profile/i,
    'an altered inherit payload is ambiguous and must not silently become an explicit narrowing',
  )

  const explicit = requestAuthority({
    profile: 'read-only',
    bounds: { filesystem: 'read-only', network: 'denied', gitPush: false, externalWrites: false },
  })
  assert.deepEqual(intersectAuthority(KNOWN_PARENT, explicit).effective, {
    profile: 'read-only',
    bounds: explicit.bounds,
  })
})

test('intersectAuthority: isolated-unsafe requires both a broad known parent and explicit user authorization', () => {
  const broadParent = {
    profile: 'isolated-unsafe',
    bounds: { filesystem: 'unrestricted', network: 'allowed', gitPush: true, externalWrites: true },
    provenance: { kind: 'managed-host-input', source: 'supervisor authority receipt' },
  }
  const unsafe = {
    profile: 'isolated-unsafe',
    bounds: { ...broadParent.bounds },
    provenance: { kind: 'explicit-operator-invocation', source: '--authority isolated-unsafe' },
  }
  assert.throws(
    () => intersectAuthority(broadParent, { profile: 'inherit', bounds: { ...broadParent.bounds }, provenance: null }),
    /explicit|authorization|provenance/i,
    'inherit cannot launder an unsafe parent into an effective unsafe child without acknowledgement',
  )
  assert.throws(() => intersectAuthority(broadParent, unsafe), /explicit|authorization|provenance/i)
  assert.throws(
    () => intersectAuthority(KNOWN_PARENT, { ...unsafe, provenance: { kind: 'explicit-user-authorization', source: 'session approval' } }),
    /parent|ceiling|filesystem|network|gitPush|externalWrites/i,
  )

  const authorized = { ...unsafe, provenance: { kind: 'explicit-user-authorization', source: 'session approval' } }
  const envelope = intersectAuthority(broadParent, authorized)
  assert.deepEqual(envelope.request.provenance, authorized.provenance)
  assert.deepEqual(envelope.effective, { profile: 'isolated-unsafe', bounds: authorized.bounds })
})

test('intersectAuthority: non-null request provenance requires a recognized kind and nonblank source', () => {
  const unsafeParent = {
    profile: 'isolated-unsafe',
    bounds: { filesystem: 'unrestricted', network: 'allowed', gitPush: true, externalWrites: true },
    provenance: { kind: 'managed-host-input', source: 'supervisor authority receipt' },
  }
  const unsafeRequest = {
    profile: 'isolated-unsafe',
    bounds: { ...unsafeParent.bounds },
    provenance: { kind: 'explicit-user-authorization' },
  }
  assert.throws(() => intersectAuthority(unsafeParent, unsafeRequest), /request|provenance|source/i)
  assert.throws(
    () => intersectAuthority(unsafeParent, { ...unsafeRequest, provenance: { ...unsafeRequest.provenance, source: '   ' } }),
    /request|provenance|source/i,
  )
})

test('intersectAuthority does not mutate parent or request evidence', () => {
  const parent = structuredClone(KNOWN_PARENT)
  const request = requestAuthority()
  const before = structuredClone({ parent, request })
  intersectAuthority(parent, request)
  assert.deepEqual({ parent, request }, before)
})

// ── criterion 1: the extraction reproduces today's spawn inputs byte-for-byte ─────────
test("launchArgv('codex') maps a read-only authority envelope to explicit native controls", () => {
  assert.equal(resolveDriver('codex').bin, 'codex')
  const authority = intersectAuthority(KNOWN_PARENT, requestAuthority({
    profile: 'read-only',
    bounds: { filesystem: 'read-only', network: 'denied', gitPush: false, externalWrites: false },
  }))
  assert.deepEqual(launchArgv('codex', { worktree: '/tmp/wt-42', authority }), [
    'exec',
    '--ignore-user-config',
    '--sandbox',
    'read-only',
    '-c',
    'approval_policy="on-request"',
    '-c',
    'approvals_reviewer="auto_review"',
    '-c',
    'sandbox_workspace_write.network_access=false',
    '-c',
    'sandbox_workspace_write.writable_roots=[]',
    '-m',
    'gpt-5.6-sol',
    '-C',
    '/tmp/wt-42',
    '-',
  ])
})

test('launchArgv maps workspace-write without bypass or a root-level approval flag', () => {
  const authority = intersectAuthority(KNOWN_PARENT, requestAuthority())
  const argv = launchArgv('codex', { worktree: '/srv/checkouts/zeroh-codex-2', authority })
  assert.deepEqual(argv, [
    'exec',
    '--ignore-user-config',
    '--sandbox',
    'workspace-write',
    '-c',
    'approval_policy="on-request"',
    '-c',
    'approvals_reviewer="auto_review"',
    '-c',
    'sandbox_workspace_write.network_access=false',
    '-c',
    'sandbox_workspace_write.writable_roots=[]',
    '-m',
    'gpt-5.6-sol',
    '-C',
    '/srv/checkouts/zeroh-codex-2',
    '-',
  ])
  assert.equal(argv.indexOf('exec'), 0)
  assert.equal(argv.slice(0, argv.indexOf('exec')).includes('-a'), false)
  assert.equal(argv.includes('--dangerously-bypass-approvals-and-sandbox'), false)
})

test('launchArgv rejects a forged effective authority instead of inventing a native mapping', () => {
  const authority = intersectAuthority(KNOWN_PARENT, requestAuthority())
  const forged = {
    ...authority,
    effective: {
      ...authority.effective,
      bounds: { ...authority.effective.bounds, network: 'approval' },
    },
  }
  assert.throws(
    () => launchArgv('codex', { worktree: '/tmp/wt-forged-authority', authority: forged }),
    /authority|effective|network|mapping|receipt/i,
  )
})

// ── the launcher PINS the model, so the journal records a command, not an observation ──
test("the codex entry's declared model is the one the argv pins — one home, no second literal", () => {
  const entry = resolveDriver('codex')
  assert.equal(typeof entry.model, 'string')
  assert.ok(entry.model.length > 0, 'a declared model must be a real id')
  const argv = launchArgv('codex', { worktree: '/tmp/wt-1', authority: intersectAuthority(KNOWN_PARENT, requestAuthority()) })
  const at = argv.indexOf('-m')
  assert.ok(at >= 0, `the launch argv must pin the model: ${argv.join(' ')}`)
  assert.equal(
    argv[at + 1],
    entry.model,
    'the pinned argv model and the declared entry model must be one value — a divergence makes the journal lie',
  )
})

test('driverStamp reads { model, lane } off the registry — lane is the DRIVER ID, not the journal lane', () => {
  assert.deepEqual(driverStamp(resolveDriver('codex')), { model: 'gpt-5.6-sol', lane: 'codex' })
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
    'gpt-5.6-sol',
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
const MODEL_LITERAL = "'gpt-5.6-sol'"
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

test('Codex resume argv addresses one exact native session through the registry', () => {
  const authority = intersectAuthority(KNOWN_PARENT, requestAuthority())
  const sessionId = '0199aabb-ccdd-7000-8000-112233445566'
  const argv = resumeArgv('codex', sessionId, { worktree: '/tmp/codex-resume-38', authority })
  assert.equal(resolveDriver('codex').model, MODEL_IDS.SOL)
  assert.equal(argv.filter((value) => value === sessionId).length, 1)
  assert.ok(argv.includes('resume'))
  assert.ok(argv.includes('--json'), 'durable identity/result parsing requires native JSONL')
  assert.ok(argv.includes(MODEL_IDS.SOL), 'resume pins the same registry-owned model as start')
  assert.ok(argv.includes('/tmp/codex-resume-38'))
  assert.equal(argv.includes('--last'), false)
  assert.equal(argv.includes('--latest'), false)
  assert.equal(argv.includes('start'), false)
})

test('Claude stream JSON argv pins restricted sandbox, empty MCP, network deny, and authority-specific tools', () => {
  const workspace = intersectAuthority(KNOWN_PARENT, requestAuthority())
  const readOnly = intersectAuthority(KNOWN_PARENT, requestAuthority({
    profile: 'read-only',
    bounds: { filesystem: 'read-only', network: 'denied', gitPush: false, externalWrites: false },
  }))
  for (const [name, authority, expectedTools] of [
    ['workspace-write', workspace, 'Read,Glob,Grep,Edit,Write,Bash'],
    ['read-only', readOnly, 'Read,Glob,Grep'],
  ]) {
    const argv = launchArgv('claude', { authority, model: MODEL_IDS.SONNET, streamJson: true })
    assert.ok(argv.includes('--restricted'), name)
    assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'auto', name)
    assert.ok(argv.includes('--strict-mcp-config'), name)
    assert.deepEqual(JSON.parse(argv[argv.indexOf('--mcp-config') + 1]), { mcpServers: {} }, name)
    assert.equal(argv[argv.indexOf('--tools') + 1], expectedTools, name)
    assert.ok(argv.includes('--output-format'), name)
    assert.equal(argv[argv.indexOf('--output-format') + 1], 'stream-json', name)
    const settings = JSON.parse(argv[argv.indexOf('--settings') + 1])
    assert.equal(settings.sandbox.enabled, true, name)
    assert.equal(settings.sandbox.failIfUnavailable, true, name)
    assert.equal(settings.sandbox.allowUnsandboxedCommands, false, name)
    assert.deepEqual(settings.sandbox.network, { allowedDomains: [], deniedDomains: ['*'], strictAllowlist: true }, name)
    assert.match(JSON.stringify(settings.permissions), /WebFetch|WebSearch/)
    assert.match(JSON.stringify(settings.permissions), /mcp__|Agent|Task/)
    assert.equal(argv.some((arg) => /^--.*(?:bypass|dangerously|unsandboxed)/i.test(arg)), false, name)
  }
})

test('Claude registry refuses authority it cannot represent', () => {
  const forged = {
    ...intersectAuthority(KNOWN_PARENT, requestAuthority()),
    effective: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'allowed', gitPush: false, externalWrites: false } },
  }
  assert.throws(() => launchArgv('claude', { authority: forged, model: MODEL_IDS.SONNET, streamJson: true }), /authority|network|represent|intersection/i)
})
