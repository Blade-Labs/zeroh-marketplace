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

// ── the scan tripwire + roadmapRootRel ─────────────────────────────────────────────────
// Added below the file's original 15 tests (untouched). The extra fs/path names live in
// their own import so the block above stays exactly as it was written.
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// A NAMESPACE import on purpose: roadmapRootRel does not exist yet, and a static NAMED
// import of a missing export is a link error that would take all 15 green tests above
// down with it. The RED must be "this one export is missing", not "the module is gone".
import * as roadmapRootModule from './roadmap-root.mjs'

/** The root members a `roadmap/<member>` string can name. Deliberately CLOSED: broadening it
 *  to "any roadmap/…" would drag codex.mjs's prose `--doc roadmap/<name>.md` usage line in. */
const ROOT_MEMBERS = ['backlog\\.ts', 'phases', 'arc-evals', 'arcs', 'archive', '\\.gate', 'roadmap\\.config\\.json']

/** The argv form: a QUOTED root segment handed to join/resolve — `join(x, 'roadmap', …)`,
 *  `resolve(argv[0] ?? 'roadmap')`. Fresh regex per call: /g carries lastIndex. */
const argvForm = () => /(['"`])(?:docs\/)?roadmap\1\s*[,)]/g

/** The path form: one QUOTED string that STARTS at the root and names a known member —
 *  'roadmap/backlog.ts', `roadmap/arc-evals/lessons.jsonl`, 'roadmap/.gate/'. */
const pathForm = () => new RegExp(`(['"\`])(?:docs/)?roadmap/(?:${ROOT_MEMBERS.join('|')})`, 'g')

/**
 * Every non-test .mjs/.mts under cli/ (recursively: lib/, commands/, testdata/, testdata/eval-arc/,
 * and cli/*.mts) and under hooks/, as { rel, src }. scripts/ is OUT of scope by plan ruling —
 * migration and estate tooling there keeps its literals.
 */
function rootLiteralSources() {
  const pluginRoot = new URL('../../', import.meta.url)
  const out = []
  const walk = (rel) => {
    for (const e of readdirSync(new URL(rel, pluginRoot), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(`${rel}${e.name}/`)
      else if (/\.m[jt]s$/.test(e.name) && !/\.test\.m[jt]s$/.test(e.name)) {
        out.push({ rel: `${rel}${e.name}`, src: readFileSync(new URL(`${rel}${e.name}`, pluginRoot), 'utf8') })
      }
    }
  }
  walk('cli/')
  walk('hooks/')
  return out
}

test('roadmap-root.mjs: it is the ONLY home of the root literals left in non-test cli/ and hooks/ code', () => {
  // The acceptance criterion as a grep the conversion cannot half-do. A consumer laid out under
  // docs/roadmap/ reads as "no roadmap" at every site that spells the root itself, so the count
  // of such sites has to be checkable — and stay at one — rather than surveyed by hand once.
  const sources = rootLiteralSources()
  const names = new Set(sources.map((s) => s.rel))
  const known = ['cli/lib/derive.mjs', 'cli/commands/status.mjs', 'hooks/session-lane-check.mjs', 'cli/audit-checks.mts']
  const missing = known.filter((k) => !names.has(k))
  assert.ok(
    sources.length >= 30 && missing.length === 0,
    `scan guard: the sweep must actually reach the plugin's sources — it enumerated ${sources.length} ` +
      `non-test files and did not see ${missing.join(', ') || '(nothing)'}. A readdir that walked the wrong ` +
      `directory, or one that found nothing, would make the assertion below vacuously green: an empty ` +
      `flagged set deepEquals nothing and every literal in the tree would ship unnoticed`,
  )

  const found = []
  for (const { rel, src } of sources) {
    const shapes = [...src.matchAll(argvForm()), ...src.matchAll(pathForm())].map((m) => m[0])
    if (shapes.length > 0) found.push({ rel, shapes: [...new Set(shapes)] })
  }
  const hits = found.map((f) => f.rel)
  const detail = found.map((f) => `  ${f.rel} — ${f.shapes.join(' ')}`).join('\n')
  assert.deepEqual(
    hits,
    ['cli/lib/roadmap-root.mjs'],
    `cli/lib/roadmap-root.mjs is the ONLY home the roadmap data root may be spelled as a literal in; ` +
      `${hits.length} file(s) under cli/ or hooks/ still spell it themselves:\n${detail}\n` +
      `Each one reads a docs/roadmap consumer as "no roadmap" — join onto roadmapRoot(dir) / ` +
      `roadmapRootRel(dir) instead. (Only QUOTED occurrences are flagged: the docs/roadmap prose in ` +
      `gate.mjs and slots.mjs is not a literal and is not the target.)`,
  )

  // The exemption is only sound while the exempt file is a REAL home. An entry pointing at a
  // module that no longer carries the literals is a stale allow-list, not a passing invariant.
  const home = readFileSync(new URL('./roadmap-root.mjs', import.meta.url), 'utf8')
  assert.match(
    home,
    /export const ROOT_CANDIDATES/,
    'anchor NOT FOUND: cli/lib/roadmap-root.mjs must declare `export const ROOT_CANDIDATES` — the allow-listed ' +
      'home has to be the module that actually owns the candidate list, or the exemption above exempts nothing',
  )
  for (const candidate of ROOT_CANDIDATES) {
    assert.ok(
      home.includes(`'${candidate}'`) || home.includes(`"${candidate}"`) || home.includes(`\`${candidate}\``),
      `the home must spell every ROOT_CANDIDATES entry as a literal; '${candidate}' is not written in ` +
        `roadmap-root.mjs — a candidate assembled elsewhere is a second home the scan above cannot see`,
    )
  }
  assert.match(
    home,
    new RegExp(argvForm().source),
    'the home carries the ARGV form (the quoted root segment) — an exempt file with none of the literals it ' +
      'is exempt for is an empty exemption',
  )
  assert.match(
    home,
    new RegExp(pathForm().source),
    'the home carries the PATH form too (a quoted `roadmap/<member>` naming one of ' +
      `${ROOT_MEMBERS.length} known members) — both shapes are what the scan flags everywhere else, so both ` +
      'must live here; a home that owns only half of them leaves the other half homeless',
  )
})

// ── roadmapRootRel: the repo-relative spelling (git pathspecs, diff prefixes, provenance) ──

/**
 * roadmapRootRel, or a NAMED failure. Git pathspecs (`git log -- roadmap/backlog.ts`),
 * diff-prefix tests (`file.startsWith('roadmap/')`) and provenance strings cited in eval
 * reports all need the root RELATIVE to the repo, not the absolute path roadmapRoot returns.
 */
function roadmapRootRel(dir) {
  assert.equal(
    typeof roadmapRootModule.roadmapRootRel,
    'function',
    'cli/lib/roadmap-root.mjs must export roadmapRootRel(dir): the resolved root as a repo-relative POSIX ' +
      'path. Without it every pathspec site keeps its own literal and the scan tripwire above can never go green',
  )
  return roadmapRootModule.roadmapRootRel(dir)
}

/** Call roadmapRootRel expecting a throw; return the caught error. */
function relErr(dir) {
  try {
    roadmapRootRel(dir)
  } catch (e) {
    return e
  }
  return assert.fail('expected roadmapRootRel to throw, it returned')
}

test('roadmapRootRel — the marked root, repo-relative and POSIX: "roadmap" / "docs/roadmap", no ./ and no trailing slash', () => {
  const plain = newTree()
  writeAt([plain, 'roadmap', 'roadmap.config.json'])
  assert.equal(roadmapRootRel(plain), 'roadmap')

  const docs = newTree()
  mkdirp(docs, 'docs', 'superpowers')
  writeAt([docs, 'docs', 'roadmap', 'roadmap.config.json'])
  const rel = roadmapRootRel(docs)
  assert.equal(rel, 'docs/roadmap')
  assert.equal(`${rel}/backlog.ts`, 'docs/roadmap/backlog.ts', 'a pathspec is built by concatenation — `git log -- <rel>/backlog.ts`')
  assert.ok(!rel.endsWith('/'), `no trailing slash: "docs/roadmap/" + "/backlog.ts" is a pathspec git matches nothing against; got ${JSON.stringify(rel)}`)
  assert.ok(!rel.startsWith('./'), `no "./" prefix: git ls-tree and startsWith() diff tests both compare against bare repo paths; got ${JSON.stringify(rel)}`)
  assert.ok(!rel.startsWith('/'), `relative, not absolute — that is what roadmapRoot is for; got ${JSON.stringify(rel)}`)
  assert.ok(!rel.includes('\\'), `POSIX separators only: git speaks "/" in pathspecs on every platform; got ${JSON.stringify(rel)}`)
})

test('roadmapRootRel — EVERY ROOT_CANDIDATES entry: the rel is exactly the root roadmapRoot resolved, spelled from dir', () => {
  // The two functions must never disagree: a caller that stats roadmapRoot() and pathspecs
  // roadmapRootRel() would otherwise read one root and write about another.
  for (const candidate of ROOT_CANDIDATES) {
    const dir = newTree()
    writeAt([dir, ...candidate.split('/'), 'roadmap.config.json'])
    const rel = roadmapRootRel(dir)
    assert.equal(rel, candidate, `candidate ${candidate} must come back as its own repo-relative spelling`)
    assert.equal(resolve(dir, rel), roadmapRoot(dir), `resolve(dir, rel) must land on exactly what roadmapRoot(dir) returns for ${candidate}`)
  }
})

test('roadmapRootRel — NO marker → "roadmap": the pathspec every consumer has today, unchanged', () => {
  const bare = newTree()
  assert.equal(roadmapRootRel(bare), ROOT_CANDIDATES[0])
  assert.equal(roadmapRootRel(bare), 'roadmap')

  const empty = newTree()
  mkdirp(empty, 'roadmap')
  mkdirp(empty, 'docs', 'roadmap') // an unmarked prose folder is not a marker here either
  assert.equal(roadmapRootRel(empty), 'roadmap')
})

test('roadmapRootRel — ROADMAP_ROOT wins here too, relative or absolute, and is NOT probed', () => {
  const dir = newTree()
  writeAt([dir, 'roadmap', 'roadmap.config.json']) // a real marked candidate to beat

  withRoadmapRootEnv(join('docs', 'plan', 'roadmap'), () => {
    assert.equal(roadmapRootRel(dir), 'docs/plan/roadmap', 'a relative override comes back as itself, still relative')
  })
  withRoadmapRootEnv(join(dir, 'docs', 'roadmap'), () => {
    assert.equal(roadmapRootRel(dir), 'docs/roadmap', 'an absolute override INSIDE dir is spelled back relative to dir')
  })
  withRoadmapRootEnv(join(dir, 'not', 'created', 'yet'), () => {
    assert.equal(
      roadmapRootRel(dir),
      'not/created/yet',
      'and the override is not probed for existence — `roadmap init` scaffolds into a root that does not exist yet',
    )
  })
})

test('roadmapRootRel — an ABSOLUTE ROADMAP_ROOT OUTSIDE dir yields an honest ../ path, not a pretend-inside one', () => {
  // Silently returning the basename ("external-roadmap") would make `git log -- external-roadmap`
  // match nothing in this repo and report the file as untouched — a clean answer about a root
  // that was never read.
  const parent = newTree()
  const dir = join(parent, 'repo')
  mkdirp(dir)
  const outside = join(parent, 'external-roadmap')
  writeAt([outside, 'roadmap.config.json'])

  withRoadmapRootEnv(outside, () => {
    const rel = roadmapRootRel(dir)
    assert.equal(rel, '../external-roadmap')
    assert.ok(rel.startsWith('../'), `an out-of-tree root must SAY it is out of tree; got ${JSON.stringify(rel)}`)
    assert.equal(resolve(dir, rel), outside, 'and it still resolves back to the root roadmapRoot returns')
    assert.equal(resolve(dir, rel), roadmapRoot(dir))
  })
})

test('roadmapRootRel — an AMBIGUOUS tree THROWS RoadmapRootError, it never guesses a pathspec', () => {
  const dir = newTree()
  writeAt([dir, 'roadmap', 'roadmap.config.json'])
  mkdirp(dir, 'docs', 'roadmap', 'phases')

  const err = relErr(dir)
  assert.ok(err instanceof RoadmapRootError, `expected RoadmapRootError; got ${err && err.name}: ${err && err.message}`)
  assert.equal(err.kind, 'ambiguous', 'the relative spelling refuses on exactly the same terms as the absolute one — a pathspec is where a silent guess does its damage quietly')
  const text = err.messageLines.join('\n')
  assert.ok(text.includes(join(dir, 'roadmap')) && text.includes(join(dir, 'docs', 'roadmap')), `the refusal must name both candidates; got:\n${text}`)
  assert.ok(text.includes('ROADMAP_ROOT'), `and the remedy; got:\n${text}`)

  withRoadmapRootEnv(join(dir, 'docs', 'roadmap'), () => {
    assert.equal(roadmapRootRel(dir), 'docs/roadmap', 'and the advertised remedy resolves it here too')
  })
})
