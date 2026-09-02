#!/usr/bin/env node
/**
 * TEST-FIRST, WIRED for `roadmap init [--config] [--scaffold]` (bin/roadmap.mjs
 * and cli/commands/init.mjs do NOT exist yet — RED until implemented).
 *
 * WIRED: SPAWN `node <plugin>/bin/roadmap.mjs …` as a real subprocess and assert
 * the exit-code contract (0 ok / 1 usage-config), the no-clobber refusal, and the
 * scaffold-through-CLI contract (init --scaffold execs scripts/scaffold-roadmap.sh).
 * Hermetic-tmp-git-repo pattern from cli/lib/config.test.mjs.
 *
 * Run: node --test cli/commands/init.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  rmSync,
  realpathSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { provisionTsx, installConsumerSchema } from '../../test/fixture-consumer/harness.mjs'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

delete process.env.ROADMAP_CONFIG
// A ROADMAP_ROOT leaking in from the ambient env would silently redirect every scaffold and
// every resolution below — the --root contract must be proven WITHOUT an override in force.
delete process.env.ROADMAP_ROOT

const tmps = []
function newTmp(prefix = 'zr-cli-init-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  return realpathSync(d)
}
process.on('exit', () => {
  for (const d of tmps) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
})

function git(dir, ...args) {
  return execFileSync(
    'git',
    ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim()
}

/** A tmp git repo with one seed commit; returns its realpath'd root. */
function newRepo() {
  const d = newTmp()
  git(d, 'init', '-q')
  writeFileSync(join(d, 'seed.txt'), 'seed\n')
  git(d, 'add', 'seed.txt')
  git(d, 'commit', '-qm', 'seed')
  return d
}

/** Spawn `node <BIN> ...args` inside `repo`; returns { status, stdout, stderr }. */
function roadmap(repo, ...args) {
  return spawnSync('node', [BIN, ...args], { cwd: repo, encoding: 'utf8' })
}

const CONFIG_REL = join('roadmap', 'roadmap.config.json')

test('1) `init --config` writes a self-consistent config that `config check` then accepts', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'init', '--config')
  assert.equal(res.status, 0, `init --config must exit 0; stderr:\n${res.stderr}`)

  const cfgPath = join(repo, CONFIG_REL)
  assert.ok(existsSync(cfgPath), 'roadmap/roadmap.config.json now exists')

  // Self-consistency: the scaffolded config must parse through the loader the
  // check command drives — a placeholder that fails its own validator is a bug.
  const check = roadmap(repo, 'config', 'check')
  assert.equal(check.status, 0, `the scaffolded config must pass config check; stderr:\n${check.stderr}`)
})

test('2) `init --config` is no-clobber: a SECOND run exits 1 and leaves the file byte-identical', () => {
  const repo = newRepo()
  const first = roadmap(repo, 'init', '--config')
  assert.equal(first.status, 0, `first init --config must succeed; stderr:\n${first.stderr}`)

  const cfgPath = join(repo, CONFIG_REL)
  const before = readFileSync(cfgPath, 'utf8')

  const second = roadmap(repo, 'init', '--config')
  assert.equal(second.status, 1, `re-running over an existing config must REFUSE → exit 1; stderr:\n${second.stderr}`)
  assert.match(
    second.stderr,
    /exists|refus/i,
    `stderr must explain the no-clobber refusal; got:\n${second.stderr}`,
  )

  const after = readFileSync(cfgPath, 'utf8')
  assert.equal(after, before, 'the refused second run must NOT rewrite the existing config')
})

test('3) `init --scaffold` execs scaffold-roadmap.sh — schema.ts + roadmap/phases/ appear', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'init', '--scaffold')
  assert.equal(res.status, 0, `init --scaffold must exit 0; stderr:\n${res.stderr}`)

  // The scaffolded seam sits at <root>/lib/ — the location consumerSchemaPath() resolves
  // FIRST, and the only one reachable by a relative import with no tsconfig alias.
  const schemaTs = join(repo, 'roadmap', 'lib', 'schema.ts')
  assert.ok(existsSync(schemaTs), 'scaffold created roadmap/lib/schema.ts')

  const phasesDir = join(repo, 'roadmap', 'phases')
  assert.ok(existsSync(phasesDir) && statSync(phasesDir).isDirectory(), 'scaffold created the roadmap/phases/ directory')
})

const PLUGIN_ROOT = join(HERE, '..', '..')

/** stdout + stderr of a run, as one string — the copier's chatter arrives on stdout via stdio:'inherit'. */
function output(res) {
  return `${res.stdout}${res.stderr}`
}

test('4) init --scaffold leaves roadmap/arcs opt-in and empty — the template stays plugin-side reference material', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'init', '--scaffold')
  assert.equal(res.status, 0, `init --scaffold must exit 0; stderr:\n${res.stderr}`)

  // The directory IS still scaffolded: arcs are opt-in, and `roadmap/arcs/` is the
  // place an authored arc lands. Removing the copy step must not remove the mkdir.
  const arcsDir = join(repo, 'roadmap', 'arcs')
  assert.ok(
    existsSync(arcsDir) && statSync(arcsDir).isDirectory(),
    'scaffold still creates the roadmap/arcs/ directory (arcs are opt-in, not absent)',
  )

  // The whole listing, not just example.arc.ts — a differently-named seeded arc is
  // the same defect (a LIVE arc in a repo where no arc has been authored).
  const listing = readdirSync(arcsDir)
  assert.deepEqual(
    listing,
    [],
    `a fresh scaffold must leave roadmap/arcs/ EMPTY — no arc is live until one is authored; found: ${JSON.stringify(listing)}`,
  )
  assert.equal(
    existsSync(join(arcsDir, 'example.arc.ts')),
    false,
    'roadmap/arcs/example.arc.ts must NOT be created — a copied example is a live arc (id A, phases [1])',
  )

  // …and the copier must not narrate a file it no longer writes. One substring covers
  // both the "Created …" and the "Skipped … (already exists)" wordings.
  assert.equal(
    output(res).includes('example.arc.ts'),
    false,
    `scaffold output must never mention example.arc.ts; got:\n${output(res)}`,
  )

  // The fix is REMOVE-THE-COPY, not remove-the-template: the template stays installed
  // with the plugin as opt-in reference material for /plan-arc.
  assert.ok(
    existsSync(join(PLUGIN_ROOT, 'templates', 'example.arc.ts')),
    'plugins/zeroh-roadmap/templates/example.arc.ts must SURVIVE as plugin reference material',
  )

  // Positive control — the fix cannot be "scaffold nothing".
  assert.ok(existsSync(join(repo, 'roadmap', 'lib', 'schema.ts')), 'scaffold still created roadmap/lib/schema.ts')
  const phasesDir = join(repo, 'roadmap', 'phases')
  assert.ok(existsSync(phasesDir) && statSync(phasesDir).isDirectory(), 'scaffold still created roadmap/phases/')
  assert.ok(existsSync(join(repo, 'roadmap', 'backlog.ts')), 'scaffold still created roadmap/backlog.ts')
})

test('5) a SECOND init --scaffold is idempotent and never claims the example arc was created', () => {
  const repo = newRepo()
  const first = roadmap(repo, 'init', '--scaffold')
  assert.equal(first.status, 0, `first init --scaffold must exit 0; stderr:\n${first.stderr}`)

  const second = roadmap(repo, 'init', '--scaffold')
  assert.equal(second.status, 0, `a re-run of init --scaffold must exit 0; stderr:\n${second.stderr}`)

  const arcsDir = join(repo, 'roadmap', 'arcs')
  const listing = readdirSync(arcsDir)
  assert.deepEqual(
    listing,
    [],
    `the second scaffold must still leave roadmap/arcs/ EMPTY; found: ${JSON.stringify(listing)}`,
  )

  // The removed branch is the if/else that printed "Skipped … (already exists)" on
  // re-run — neither arm of it may survive.
  assert.equal(
    output(second).includes('example.arc.ts'),
    false,
    `the re-run must not mention example.arc.ts (created OR skipped); got:\n${output(second)}`,
  )

  assert.ok(
    existsSync(join(PLUGIN_ROOT, 'templates', 'example.arc.ts')),
    'the plugin template is still installed after two scaffolds',
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────
// A consumer can be scaffolded ANYWHERE (--root) and into a repo with NO `@/` tsconfig
// alias. cli/lib/roadmap-root.mjs already answers "where is the roadmap?" and "where is
// the schema?"; these tests pin the SCAFFOLD and `init` to the same two answers, and pin
// the templates to relative imports.
//
// Everything below drives the REAL bin/roadmap.mjs and the REAL scripts/scaffold-roadmap.sh
// over real git fixtures. provisionTsx/installConsumerSchema are reused from the
// fixture-consumer harness so the tsx+zod seam is provisioned EXACTLY as the wired tier
// provisions it (a hand-rolled second recipe here would be a second source of truth).
// ─────────────────────────────────────────────────────────────────────────────────────

const SCAFFOLD_SH = join(PLUGIN_ROOT, 'scripts', 'scaffold-roadmap.sh')

/** Run the REAL scaffold script directly: `bash scaffold-roadmap.sh <projectDir> [...args]`. */
function scaffold(projectDir, ...args) {
  return spawnSync('bash', [SCAFFOLD_SH, projectDir, ...args], { cwd: projectDir, encoding: 'utf8' })
}

/** Every path under `root`, relative + POSIX, directories suffixed '/'. .git and
 *  node_modules are excluded (git's own churn and provisioned symlinks are not the tree
 *  under test). Sorted, so two listings compare as sets of paths. */
function listTree(root, rel = '', out = []) {
  const entries = readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    const p = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      out.push(p + '/')
      listTree(root, p, out)
    } else {
      out.push(p)
    }
  }
  return out
}

/** A `definePhase(...)` source importing the consumer schema by the GIVEN specifier —
 *  the whole point of these tests is WHICH specifier resolves. */
function definePhaseSrc(schemaSpecifier, obj) {
  const body = JSON.stringify(obj, null, 2)
    .replace(/"([\w$]+)":/g, '$1:')
    .replace(/"/g, "'")
  return `import { definePhase } from '${schemaSpecifier}'\nexport default definePhase(${body})\n`
}

/** The minimal phase record that passes the consumer schema + every structural check
 *  (same shape the fixture-consumer lifecycle suite validates green). */
function wellFormedPhase(n) {
  return {
    phase: n,
    status: 'backlog',
    name: 'Root-relative schema import fixture',
    category: 'test',
    source: 'init.test.mjs',
    priority: 'LOW',
    dependsOn: [],
    conflictsWith: [],
    keyFiles: [],
    stakeholderDemo: 'a fixture phase used to prove the schema import resolves',
    tasks: [{ minimal: true, id: `${n}.1`, title: 'do the thing', done: false }],
  }
}

/** `roadmap init --root <rootRel>` on a bare repo, then tsx+zod provisioned. */
function scaffoldedConsumer(rootRel) {
  const repo = newRepo()
  const res = roadmap(repo, 'init', '--root', rootRel)
  assert.equal(res.status, 0, `init --root ${rootRel} must exit 0; stderr:\n${res.stderr}`)
  provisionTsx(repo)
  return repo
}

test('6) default `init` scaffolds the schema at roadmap/lib/schema.ts — the root-relative seam, not a toplevel lib/', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'init')
  assert.equal(res.status, 0, `bare init must exit 0; stderr:\n${res.stderr}`)

  for (const rel of ['ROADMAP.md', 'backlog.ts', 'roadmap.config.json']) {
    assert.ok(existsSync(join(repo, 'roadmap', rel)), `default init created roadmap/${rel}`)
  }
  for (const rel of ['phases', 'arcs']) {
    const d = join(repo, 'roadmap', rel)
    assert.ok(existsSync(d) && statSync(d).isDirectory(), `default init created the roadmap/${rel}/ directory`)
  }
  for (const rel of ['schema.ts', 'registry.ts', 'emit.ts']) {
    assert.ok(existsSync(join(repo, 'roadmap', 'lib', rel)), `default init created roadmap/lib/${rel}`)
  }

  // The toplevel lib/roadmap/ seam stays RECOGNIZED by the resolver for existing consumers
  // (test 10), but it is no longer WRITTEN: scaffolding a stray toplevel lib/ into a
  // monorepo package is the defect this phase removes, and two seams means two schemas.
  assert.equal(
    existsSync(join(repo, 'lib')),
    false,
    'default init must NOT create a toplevel lib/ any more — lib/ moved under roadmap/lib/',
  )

  // The config that landed must still parse through the loader `config check` drives.
  const check = roadmap(repo, 'config', 'check')
  assert.equal(check.status, 0, `the scaffolded config must pass config check; stderr:\n${check.stderr}`)
})

test('7) `init --root docs/roadmap` lands the WHOLE consumer under docs/roadmap and nothing at roadmap/ or lib/', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'init', '--root', 'docs/roadmap')
  assert.equal(res.status, 0, `init --root docs/roadmap must exit 0; stderr:\n${res.stderr}`)

  const root = join(repo, 'docs', 'roadmap')
  for (const rel of ['ROADMAP.md', 'backlog.ts', 'roadmap.config.json']) {
    assert.ok(existsSync(join(root, rel)), `--root docs/roadmap created docs/roadmap/${rel}`)
  }
  for (const rel of ['phases', 'arcs']) {
    const d = join(root, rel)
    assert.ok(
      existsSync(d) && statSync(d).isDirectory(),
      `--root docs/roadmap created the docs/roadmap/${rel}/ directory`,
    )
  }
  assert.ok(existsSync(join(root, 'lib', 'schema.ts')), '--root docs/roadmap created docs/roadmap/lib/schema.ts')

  // The whole point of --root: the DEFAULT locations must stay untouched. A scaffold that
  // honors --root for some files and hardcodes the rest leaves a half-consumer at roadmap/
  // that the resolver would then call ambiguous.
  assert.equal(existsSync(join(repo, 'roadmap')), false, '--root docs/roadmap must create NOTHING at <toplevel>/roadmap/')
  assert.equal(existsSync(join(repo, 'lib')), false, '--root docs/roadmap must create NOTHING at <toplevel>/lib/')

  // …and the config is written INSIDE the chosen root, which is the only place the
  // resolver will ever look for it.
  const check = roadmap(repo, 'config', 'check')
  assert.equal(
    check.status,
    0,
    `the config under docs/roadmap must be the one config check finds; stderr:\n${check.stderr}`,
  )
})

test('7b) `init --config --root` writes directly into the selected root before it is discoverable', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'init', '--config', '--root', 'ops/roadmap')
  assert.equal(res.status, 0, `config-only init must exit 0; stderr:\n${res.stderr}`)
  assert.ok(existsSync(join(repo, 'ops', 'roadmap', 'roadmap.config.json')))
  assert.equal(existsSync(join(repo, 'roadmap')), false, 'config-only --root must not create the default root')
})

test('8) a phase file under `--root docs/roadmap` validates through the tsx bridge with NO tsconfig alias', () => {
  const repo = scaffoldedConsumer('docs/roadmap')
  const n = 9241
  writeFileSync(
    join(repo, 'docs', 'roadmap', 'phases', `phase-${n}.phase.ts`),
    // <root>/phases/phase-N.phase.ts → <root>/lib/schema.ts is exactly '../lib/schema'.
    definePhaseSrc('../lib/schema', wellFormedPhase(n)),
  )

  // No tsconfig.json at all in this repo — the ONLY reason this can resolve is that the
  // import is relative and the schema really sits at <root>/lib/schema.ts.
  assert.equal(existsSync(join(repo, 'tsconfig.json')), false, 'the fixture repo deliberately has NO tsconfig')

  const v = roadmap(repo, 'phase', 'validate', String(n))
  assert.equal(v.status, 0, `a docs/roadmap phase must validate with no alias; stderr:\n${v.stderr}`)

  // The scaffolded backlog rides the same seam from one directory higher ('./lib/schema'),
  // and the same engine validates it — so this leg fails if only the phase path was fixed.
  const b = roadmap(repo, 'phase', 'validate', join(repo, 'docs', 'roadmap', 'backlog.ts'))
  assert.equal(b.status, 0, `the scaffolded backlog.ts must validate with no alias; stderr:\n${b.stderr}`)
})

test('9) …and in that SAME repo a phase importing `@/lib/roadmap/schema` does NOT validate — the alias is what we removed the dependency on', () => {
  const repo = scaffoldedConsumer('docs/roadmap')
  const n = 9242
  writeFileSync(
    join(repo, 'docs', 'roadmap', 'phases', `phase-${n}.phase.ts`),
    definePhaseSrc('@/lib/roadmap/schema', wellFormedPhase(n)),
  )

  const v = roadmap(repo, 'phase', 'validate', String(n))
  assert.equal(
    v.status,
    2,
    `an @/-alias import must FAIL to load in a repo with no alias (exit 2) — if this passes, the ` +
      `positive test above proves nothing about aliases; stderr:\n${v.stderr}`,
  )
  assert.match(
    v.stderr,
    /@\/lib\/roadmap\/schema/,
    `the load error must name the unresolvable alias specifier; got:\n${v.stderr}`,
  )
})

test('10) the LEGACY lib/roadmap/schema.ts seam still validates a phase file — every existing consumer is that repo', () => {
  const repo = newRepo()
  mkdirSync(join(repo, 'roadmap', 'phases'), { recursive: true })
  installConsumerSchema(repo) // <repo>/lib/roadmap/schema.ts — the LEGACY layout, verbatim
  provisionTsx(repo)
  assert.equal(
    existsSync(join(repo, 'roadmap', 'lib')),
    false,
    'the legacy fixture carries ONLY the toplevel seam — no <root>/lib/ to fall back on',
  )

  const n = 9243
  writeFileSync(
    join(repo, 'roadmap', 'phases', `phase-${n}.phase.ts`),
    definePhaseSrc('../../lib/roadmap/schema', wellFormedPhase(n)),
  )

  const v = roadmap(repo, 'phase', 'validate', String(n))
  assert.equal(
    v.status,
    0,
    `the legacy seam must keep validating — breaking it breaks every consumer scaffolded ` +
      `before the seam moved under the root; stderr:\n${v.stderr}`,
  )
})

test('11) scaffolding `--root docs/roadmap` into a repo that ALREADY carries a marked roadmap/ exits 1, names both, and creates nothing', () => {
  const repo = newRepo()
  const init = roadmap(repo, 'init')
  assert.equal(init.status, 0, `the seeding default init must exit 0; stderr:\n${init.stderr}`)
  const before = listTree(repo)

  const res = scaffold(repo, '--root', 'docs/roadmap')
  assert.equal(
    res.status,
    1,
    `a second root under a DIFFERENT candidate must REFUSE (exit 1) — two roots means two ` +
      `backlogs and two claim registries; output:\n${output(res)}`,
  )

  const msg = output(res)
  assert.ok(
    msg.includes('docs/roadmap'),
    `the refusal must name the REQUESTED root; got:\n${msg}`,
  )
  // …and the EXISTING one, separately. Mask the requested spelling first so `docs/roadmap`
  // cannot satisfy this leg, then require a standalone `roadmap` token — the hyphenated
  // `zeroh-roadmap` / `scaffold-roadmap.sh` chatter is excluded by the preceding-char class.
  const masked = msg.split('docs/roadmap').join('<<requested>>')
  assert.match(
    masked,
    /(?:^|[\s'"`(:/])roadmap\b/m,
    `the refusal must ALSO name the existing root, so the operator knows which two collide; got:\n${msg}`,
  )

  assert.equal(existsSync(join(repo, 'docs')), false, 'a refused scaffold must not create the requested root')
  assert.deepEqual(
    listTree(repo),
    before,
    'a refused scaffold must leave the tree byte-for-byte unchanged — no half-written second root',
  )
})

test('12) no template imports the `@/lib/roadmap/schema` alias — that string is what breaks a repo without one', () => {
  const dir = join(PLUGIN_ROOT, 'templates')
  const offenders = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => readFileSync(join(dir, f), 'utf8').includes('@/lib/roadmap/schema'))
  assert.deepEqual(
    offenders,
    [],
    `every template must import the schema RELATIVE to where it is scaffolded; these still ` +
      `require a tsconfig '@/' alias the target repo may not define: ${JSON.stringify(offenders)}`,
  )
})

test('13) the scaffolded registry discovers phases under the DISCOVERED root with no argument and no env', () => {
  const repo = scaffoldedConsumer('docs/roadmap')
  const n = 9244
  writeFileSync(
    join(repo, 'docs', 'roadmap', 'phases', `phase-${n}.phase.ts`),
    definePhaseSrc('../lib/schema', wellFormedPhase(n)),
  )

  // registry.ts is the one file that cannot import the resolver (it is consumer-side), so its
  // OWN default must find docs/roadmap/phases. Driven through the consumer's tsx exactly as
  // `emit:phases` drives it — a source-text assertion would not prove the default resolves.
  const script = `
import('file://' + process.argv[1])
  .then(async (m) => {
    const r = await m.discoverPhases()
    process.stdout.write('RESULT:' + JSON.stringify({ phases: r.phases.map((p) => p.phase), errors: r.errors.map((e) => e.error) }))
  })
  .catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(4) })
`
  const registry = join(repo, 'docs', 'roadmap', 'lib', 'registry.ts')
  assert.ok(existsSync(registry), 'the scaffold put registry.ts beside schema.ts under <root>/lib/')

  const childEnv = { ...process.env }
  delete childEnv.ROADMAP_ROOT // no override in force: the DEFAULT must find the root itself
  const r = spawnSync(join(repo, 'node_modules', '.bin', 'tsx'), ['-e', script, registry], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 120_000,
    env: childEnv,
  })
  assert.equal(r.status, 0, `discoverPhases() must run clean; stderr:\n${r.stderr}`)
  const payload = JSON.parse(r.stdout.slice(r.stdout.indexOf('RESULT:') + 'RESULT:'.length))
  assert.deepEqual(payload.errors, [], `discovery reported errors: ${JSON.stringify(payload.errors)}`)
  assert.deepEqual(
    payload.phases,
    [n],
    `the registry default root must resolve to docs/roadmap/phases (the first candidate that ` +
      `carries phases/), not the hardcoded roadmap/phases; got: ${JSON.stringify(payload.phases)}`,
  )
})
