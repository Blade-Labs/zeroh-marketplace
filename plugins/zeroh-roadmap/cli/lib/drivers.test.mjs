#!/usr/bin/env node
/**
 * Fixtures for cli/lib/drivers.mjs. Pins the codex launch inputs against a LITERAL fixture
 * of the spawn argv (written out in full — never rebuilt from the registry's own data, which
 * would assert nothing), the refusal on an unregistered id, the host-stamped provenance
 * shape, and the ratchet holding every model-specific argv inside the registry.
 * Run: node --test cli/lib/drivers.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRIVERS, resolveDriver, launchArgv } from './drivers.mjs'

// ── criterion 1: the extraction reproduces today's spawn inputs byte-for-byte ─────────
test("launchArgv('codex') plus the entry's bin reproduce today's spawn inputs exactly", () => {
  assert.equal(resolveDriver('codex').bin, 'codex')
  assert.deepEqual(launchArgv('codex', { worktree: '/tmp/wt-42' }), [
    'exec',
    '--dangerously-bypass-approvals-and-sandbox',
    '-C',
    '/tmp/wt-42',
    '-',
  ])
})

test('launchArgv threads the caller\'s worktree into the -C position, never a baked path', () => {
  assert.deepEqual(launchArgv('codex', { worktree: '/srv/checkouts/zeroh-codex-2' }), [
    'exec',
    '--dangerously-bypass-approvals-and-sandbox',
    '-C',
    '/srv/checkouts/zeroh-codex-2',
    '-',
  ])
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

test('no file under cli/ outside the driver registry carries the codex bypass argv literal', () => {
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
  assert.ok(
    registry.text.includes(BYPASS_ARGV),
    `stale needle: ${BYPASS_ARGV} no longer appears in lib/drivers.mjs — retarget this ratchet at the registry's current argv`,
  )

  const offenders = []
  for (const file of files) {
    if (ARGV_HOMES.has(file.rel)) continue
    file.text.split('\n').forEach((line, i) => {
      if (line.includes(BYPASS_ARGV)) offenders.push(`cli/${file.rel}:${i + 1}`)
    })
  }
  assert.deepEqual(
    offenders,
    [],
    `model-specific argv outside the driver registry: ${offenders.join(', ')} — source it from launchArgv('codex', { worktree }) in cli/lib/drivers.mjs, the one home for every launch argv`,
  )
})
