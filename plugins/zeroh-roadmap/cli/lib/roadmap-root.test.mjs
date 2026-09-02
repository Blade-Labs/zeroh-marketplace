#!/usr/bin/env node
/**
 * TEST-FIRST for cli/lib/roadmap-root.mjs (module does NOT exist yet — RED on import
 * until implemented). This is the ONE answer to "where is this consumer's roadmap?":
 * today config.mjs hardcodes <toplevel>/roadmap and tsx-bridge.mjs hardcodes
 * <root>/lib/roadmap/schema.ts, so a consumer that keeps its roadmap under docs/roadmap/
 * (beside an unrelated docs/superpowers/) is unreachable.
 *
 * Hermetic-tmp-estate pattern from config.test.mjs / tsx-bridge.test.mjs: mkdtempSync +
 * process.on('exit') cleanup, REAL directory trees, no fs mocking. BridgeError is imported
 * from ./tsx-bridge.mjs on purpose — it is moving to ./bridge-error.mjs and being
 * re-exported, and this file must be indifferent to that move.
 * Run: node --test cli/lib/roadmap-root.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import {
  ROOT_CANDIDATES,
  RoadmapRootError,
  roadmapRoot,
  consumerSchemaPath,
  resetRoadmapRootCache,
} from './roadmap-root.mjs'
import { BridgeError } from './tsx-bridge.mjs'

// A stray inherited override would silently decide every probing test below.
delete process.env.ROADMAP_ROOT

const tmps = []
process.on('exit', () => {
  for (const d of tmps) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
})

/** A fresh empty consumer tree; realpath'd so expectations match on symlinked /tmp. */
function newTree(prefix = 'zr-root-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  return realpathSync(d)
}

const mkdirp = (...seg) => mkdirSync(join(...seg), { recursive: true })

/** Write `body` at join(...seg), creating parents. */
function writeAt(seg, body = '{}\n') {
  const p = join(...seg)
  mkdirp(...seg.slice(0, -1))
  writeFileSync(p, body)
  return p
}

/**
 * Run `fn` with ROADMAP_ROOT set to `value` (undefined = unset). The memo is cleared on
 * both sides and the caller's environment is restored exactly as found, so no test can
 * leak an override into its neighbours.
 */
function withRoadmapRootEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'ROADMAP_ROOT')
  const prev = process.env.ROADMAP_ROOT
  resetRoadmapRootCache()
  if (value === undefined) delete process.env.ROADMAP_ROOT
  else process.env.ROADMAP_ROOT = value
  try {
    return fn()
  } finally {
    if (had) process.env.ROADMAP_ROOT = prev
    else delete process.env.ROADMAP_ROOT
    resetRoadmapRootCache()
  }
}

/** Call roadmapRoot expecting a throw; return the caught error. */
function rootErr(dir) {
  try {
    roadmapRoot(dir)
  } catch (e) {
    return e
  }
  return assert.fail('expected roadmapRoot to throw, it returned')
}

/** Call consumerSchemaPath expecting a throw; return the caught error. */
function schemaErr(dir) {
  try {
    consumerSchemaPath(dir)
  } catch (e) {
    return e
  }
  return assert.fail('expected consumerSchemaPath to throw, it returned')
}

// ── roadmapRoot: probing ───────────────────────────────────────────────────────────────

test('roadmapRoot — only roadmap/ carries a marker → <dir>/roadmap (today’s answer, unchanged)', () => {
  const dir = newTree()
  writeAt([dir, 'roadmap', 'roadmap.config.json'])
  const root = roadmapRoot(dir)
  assert.equal(root, join(dir, 'roadmap'))
  assert.ok(isAbsolute(root), 'the resolved root is an ABSOLUTE path')
})

test('roadmapRoot — only docs/roadmap/ carries a marker → <dir>/docs/roadmap', () => {
  const dir = newTree()
  mkdirp(dir, 'docs', 'superpowers') // an unrelated docs sibling must not confuse the probe
  writeAt([dir, 'docs', 'roadmap', 'roadmap.config.json'])
  const root = roadmapRoot(dir)
  assert.equal(root, join(dir, 'docs', 'roadmap'))
  assert.ok(isAbsolute(root))
})

test('roadmapRoot — NO marker anywhere → the default <dir>/roadmap, no throw', () => {
  // A bare tree, and a tree where BOTH candidate directories exist but are empty: an
  // existing directory is not a marker, or every repo with a docs/roadmap/ prose folder
  // would be re-pointed at it.
  const bare = newTree()
  assert.equal(roadmapRoot(bare), join(bare, 'roadmap'))
  assert.equal(roadmapRoot(bare), join(bare, ROOT_CANDIDATES[0]), 'the default is the FIRST candidate')

  const empty = newTree()
  mkdirp(empty, 'roadmap')
  mkdirp(empty, 'docs', 'roadmap')
  mkdirp(empty, 'docs', 'superpowers')
  assert.equal(roadmapRoot(empty), join(empty, 'roadmap'))
})

test('roadmapRoot — BOTH markers are honoured independently: config-only and phases-only each resolve', () => {
  // The two markers are alternatives, not a conjunction. A consumer mid-scaffold has
  // phases/ before a config; a config-first consumer has no phases/ yet.
  const configOnly = newTree()
  writeAt([configOnly, 'docs', 'roadmap', 'roadmap.config.json'])
  assert.equal(
    roadmapRoot(configOnly),
    join(configOnly, 'docs', 'roadmap'),
    'roadmap.config.json alone (no phases/) is a marker',
  )

  const phasesOnly = newTree()
  mkdirp(phasesOnly, 'docs', 'roadmap', 'phases')
  assert.equal(
    roadmapRoot(phasesOnly),
    join(phasesOnly, 'docs', 'roadmap'),
    'a phases/ directory alone (no config) is a marker',
  )
})

test('roadmapRoot — EVERY ROOT_CANDIDATES entry resolves when it alone carries a marker', () => {
  // Exhaustive over the declared union: a candidate added to the list but never probed
  // would be dead precedence, and this fails the day that happens.
  assert.ok(ROOT_CANDIDATES.length >= 2, 'the candidate set must offer a real choice')
  for (const candidate of ROOT_CANDIDATES) {
    const dir = newTree()
    writeAt([dir, ...candidate.split('/'), 'roadmap.config.json'])
    assert.equal(roadmapRoot(dir), join(dir, ...candidate.split('/')), `candidate ${candidate} must resolve`)
  }
})

test('roadmapRoot — BOTH candidates marked → RoadmapRootError kind ambiguous naming both paths + the remedy', () => {
  const dir = newTree()
  writeAt([dir, 'roadmap', 'roadmap.config.json'])
  mkdirp(dir, 'docs', 'roadmap', 'phases')

  const err = rootErr(dir)
  assert.ok(err instanceof RoadmapRootError, `expected RoadmapRootError; got ${err && err.name}`)
  assert.equal(err.kind, 'ambiguous')
  assert.ok(Array.isArray(err.messageLines) && err.messageLines.length > 0)
  assert.equal(err.message, err.messageLines.join('\n'), 'message is the joined lines (ConfigError shape)')

  const text = err.messageLines.join('\n')
  assert.ok(text.includes(join(dir, 'roadmap')), `the refusal must name the roadmap/ candidate; got:\n${text}`)
  assert.ok(
    text.includes(join(dir, 'docs', 'roadmap')),
    `the refusal must name the docs/roadmap candidate too — a human cannot delete the wrong ` +
      `one from a message that names only the winner; got:\n${text}`,
  )
  assert.ok(text.includes('ROADMAP_ROOT'), `the refusal must point at the ROADMAP_ROOT remedy; got:\n${text}`)
})

// ── roadmapRoot: the ROADMAP_ROOT override ─────────────────────────────────────────────

test('roadmapRoot — an ABSOLUTE ROADMAP_ROOT wins over a present marker and is NOT probed for existence', () => {
  const dir = newTree()
  writeAt([dir, 'roadmap', 'roadmap.config.json']) // a real, marked candidate to beat
  const elsewhere = join(newTree(), 'not', 'created', 'yet')
  withRoadmapRootEnv(elsewhere, () => {
    assert.equal(
      roadmapRoot(dir),
      elsewhere,
      'the override names where the root WILL be — probing it would break `roadmap init` on a fresh layout',
    )
  })
})

test('roadmapRoot — a RELATIVE ROADMAP_ROOT resolves against dir, absolute', () => {
  const dir = newTree()
  writeAt([dir, 'roadmap', 'roadmap.config.json'])
  withRoadmapRootEnv(join('docs', 'plan', 'roadmap'), () => {
    const root = roadmapRoot(dir)
    assert.equal(root, join(dir, 'docs', 'plan', 'roadmap'))
    assert.ok(isAbsolute(root), 'a relative override still yields an ABSOLUTE path to callers')
  })
})

test('roadmapRoot — ROADMAP_ROOT overrides even the AMBIGUOUS case (the named remedy actually works)', () => {
  const dir = newTree()
  writeAt([dir, 'roadmap', 'roadmap.config.json'])
  writeAt([dir, 'docs', 'roadmap', 'roadmap.config.json'])
  assert.equal(rootErr(dir).kind, 'ambiguous', 'without the override this tree refuses')

  withRoadmapRootEnv(join(dir, 'docs', 'roadmap'), () => {
    assert.equal(
      roadmapRoot(dir),
      join(dir, 'docs', 'roadmap'),
      'the remedy the refusal advertises must resolve the refusal — an override checked AFTER ' +
        'the ambiguity throw would leave the consumer permanently stuck',
    )
  })
})

test('roadmapRoot — an EMPTY ROADMAP_ROOT is treated as unset (probing still decides)', () => {
  const dir = newTree()
  writeAt([dir, 'docs', 'roadmap', 'roadmap.config.json'])
  withRoadmapRootEnv('', () => {
    assert.equal(roadmapRoot(dir), join(dir, 'docs', 'roadmap'), 'an empty override resolves to <dir> itself if honoured')
  })
})

test('roadmapRoot — the result is memoized per dir; resetRoadmapRootCache makes a mutated tree visible', () => {
  const dir = newTree()
  assert.equal(roadmapRoot(dir), join(dir, 'roadmap'), 'unmarked ⇒ the default')

  writeAt([dir, 'docs', 'roadmap', 'roadmap.config.json'])
  assert.equal(
    roadmapRoot(dir),
    join(dir, 'roadmap'),
    'the memo holds — a stat-per-call resolver on every CLI command is the cost this cache exists to avoid',
  )

  resetRoadmapRootCache()
  assert.equal(roadmapRoot(dir), join(dir, 'docs', 'roadmap'), 'after the reset the new marker decides')
  resetRoadmapRootCache()
})

// ── consumerSchemaPath: the vendored schema seam ───────────────────────────────────────

test('consumerSchemaPath — <root>/lib/schema.ts wins, including over an existing legacy seam', () => {
  const dir = newTree()
  writeAt([dir, 'roadmap', 'roadmap.config.json'])
  const rootSeam = writeAt([dir, 'roadmap', 'lib', 'schema.ts'], 'export {}\n')
  writeAt([dir, 'lib', 'roadmap', 'schema.ts'], 'export {}\n') // legacy also present
  assert.equal(
    consumerSchemaPath(dir),
    rootSeam,
    'root-first: a consumer that has vendored the new seam must not be silently read from the legacy one',
  )
})

test('consumerSchemaPath — falls back to the LEGACY <dir>/lib/roadmap/schema.ts (every existing consumer)', () => {
  const dir = newTree()
  writeAt([dir, 'roadmap', 'roadmap.config.json'])
  const legacy = writeAt([dir, 'lib', 'roadmap', 'schema.ts'], 'export {}\n')
  assert.equal(consumerSchemaPath(dir), legacy)
})

test('consumerSchemaPath — a docs/roadmap consumer is read from <dir>/docs/roadmap/lib/schema.ts', () => {
  const dir = newTree()
  writeAt([dir, 'docs', 'roadmap', 'roadmap.config.json'])
  mkdirp(dir, 'docs', 'superpowers')
  const seam = writeAt([dir, 'docs', 'roadmap', 'lib', 'schema.ts'], 'export {}\n')
  assert.equal(consumerSchemaPath(dir), seam, 'the seam follows the resolved root, not the git toplevel')
})

test('consumerSchemaPath — neither seam → BridgeError kind schema-missing naming BOTH candidate paths', () => {
  const dir = newTree()
  writeAt([dir, 'roadmap', 'roadmap.config.json']) // a roadmap root, but no schema vendored

  const err = schemaErr(dir)
  assert.ok(err instanceof BridgeError, `expected BridgeError; got ${err && err.name}`)
  assert.equal(err.kind, 'schema-missing')
  assert.ok(Array.isArray(err.messageLines) && err.messageLines.length > 0)

  const text = err.messageLines.join('\n')
  assert.ok(
    text.includes(join(dir, 'roadmap', 'lib', 'schema.ts')),
    `the refusal must name the root-first seam; got:\n${text}`,
  )
  assert.ok(
    text.includes(join(dir, 'lib', 'roadmap', 'schema.ts')),
    `the refusal must name the LEGACY seam too — naming only one leaves the reader vendoring ` +
      `into a path the resolver may not even consult; got:\n${text}`,
  )
})
