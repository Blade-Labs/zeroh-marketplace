#!/usr/bin/env node
/**
 * TEST-FIRST for scripts/emit-manifests.mjs (phase 4 task 4.3) — the script does NOT exist
 * yet, so this suite is RED at the import until it does.
 *
 * The problem it ratchets: five harness manifests were hand-maintained and drifted to four
 * different versions (.claude-plugin 0.32.0 / .cursor-plugin 0.16.1 / .copilot 0.16.1 /
 * gemini-extension 0.18.0 against package.json 0.32.0), and .codex/INSTALL.md advertised the
 * retired `code-review` skill while omitting live ones. Version and skill list lived in six
 * places and rotted independently.
 *
 * Shape: fixture roots in mkdtemp driven through `node scripts/emit-manifests.mjs --root <dir>`
 * (the measure.test.mjs pattern — a tmp fixture root instead of the real tree), so the
 * ratchet's own reds are FALSIFIED here rather than asserted. The last test is the live one:
 * `--check` against the real plugin root.
 *
 * Run: node --test scripts/emit-manifests.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // scripts/
const SCRIPT = join(HERE, 'emit-manifests.mjs')
const PLUGIN_ROOT = join(HERE, '..')

// ── the file map, written out as a LITERAL fixture ────────────────────────────────────
// Never rebuilt from the module's own exports (that would assert nothing). These are the
// six places the version and the skill list used to rot in, now with one source each.
const EXPECTED_VERSION_TARGETS = [
  { path: '.claude-plugin/plugin.json', field: 'version' },
  { path: '.codex-plugin/plugin.json', field: 'version' },
  { path: '.copilot/plugin.yaml', field: 'version' },
  { path: '.cursor-plugin/plugin.json', field: 'version' },
  { path: 'gemini-extension.json', field: 'version' },
]
const EXPECTED_GENERATED_TARGETS = [{ path: '.codex-plugin/plugin.json' }, { path: '.codex/INSTALL.md' }]
const ALL_TARGET_PATHS = [
  ...new Set([...EXPECTED_VERSION_TARGETS, ...EXPECTED_GENERATED_TARGETS].map((t) => t.path)),
].sort()

const FIX = 'node scripts/emit-manifests.mjs'
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

// ── tmp fixture roots: created and removed here, never the real tree ──────────────────
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

/**
 * A fixture plugin root. Deliberately mirrors the real layout while sharing NO literal with
 * it: the package version is 7.3.1 (so a generator that accidentally reads the real
 * package.json reds), and all four hand-maintained manifests start on four DIFFERENT wrong
 * versions — the measured drift, reproduced.
 *
 *   package.json                       { name, version: 7.3.1, description }
 *   skills/alpha-skill/SKILL.md        \
 *   skills/beta-skill/SKILL.md          | the skill list = these two DIRECTORY names
 *   skills/NOT-A-SKILL.md              /  (a stray FILE — must never be listed)
 *   agents/alpha-agent.md              \
 *   agents/zeta-agent.md                | the agent list = these two FILES, sorted
 *   agents/references/should-not-appear.md  (a SUBDIR — files only, no recursion)
 *   .claude-plugin/plugin.json         version 0.0.1, FOUR-space indent + extra keys
 *   .cursor-plugin/plugin.json         version 1.2.3
 *   gemini-extension.json              version 4.5.6
 *   .copilot/plugin.yaml               version 9.9.9  (YAML — the odd one out)
 *   .codex/INSTALL.md                  stale: advertises `retired-skill`
 *   .codex-plugin/plugin.json          ABSENT — generated whole, parent dir and all
 */
function makeFixture({ omitPackageJson = false, omitSkillsDir = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zr-emit-manifests-')))
  tmps.push(root)
  const write = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }

  if (!omitPackageJson) {
    write(
      'package.json',
      `${JSON.stringify({ name: 'zeroh-roadmap', version: '7.3.1', description: 'fixture plugin' }, null, 2)}\n`,
    )
  }
  if (!omitSkillsDir) {
    write('skills/beta-skill/SKILL.md', '# beta\n')
    write('skills/alpha-skill/SKILL.md', '# alpha\n')
    write('skills/NOT-A-SKILL.md', 'a loose file under skills/ is not a skill\n')
  }
  write('agents/zeta-agent.md', '# zeta\n')
  write('agents/alpha-agent.md', '# alpha\n')
  write('agents/references/should-not-appear.md', 'a reference is not an agent card\n')

  // FOUR-space indent, nested object, array, and a deliberate key order. The version patch
  // must survive all of it byte-for-byte — see the non-version-content test.
  write(
    '.claude-plugin/plugin.json',
    `${JSON.stringify(
      {
        name: 'zeroh-roadmap',
        version: '0.0.1',
        description: 'fixture plugin',
        hooks: './hooks/claude-hooks.json',
        author: { name: 'Blade Labs', url: 'https://blade-labs.com' },
        repository: 'https://github.com/Blade-Labs/zeroh-roadmap',
        license: 'SEE LICENSE',
        category: 'development',
        keywords: ['roadmap', 'phases', 'gates'],
      },
      null,
      4,
    )}\n`,
  )
  write(
    '.cursor-plugin/plugin.json',
    `${JSON.stringify({ name: 'zeroh-roadmap', version: '1.2.3', description: 'fixture plugin', skills: 'skills/' }, null, 2)}\n`,
  )
  write(
    'gemini-extension.json',
    `${JSON.stringify(
      { name: 'zeroh-roadmap', version: '4.5.6', description: 'fixture plugin', type: 'skills', entry: 'CLAUDE.md', skills_dir: 'skills/' },
      null,
      2,
    )}\n`,
  )
  write('.copilot/plugin.yaml', 'name: zeroh-roadmap\nversion: 9.9.9\ndescription: fixture plugin\nskills_dir: skills/\n')
  write('.codex/INSTALL.md', '# stale\n\n- retired-skill\n')
  write('hooks/claude-hooks.json', '{"hooks":{}}\n')
  return root
}

/** `node scripts/emit-manifests.mjs [--root <root>] ...args` → { code, stdout, stderr, out }. */
function emit(root, ...args) {
  const argv = root === null ? [SCRIPT, ...args] : [SCRIPT, '--root', root, ...args]
  // cwd is a throwaway dir on purpose: the script's default root must be derived from its own
  // location, never from cwd — a ratchet that only works from one cwd is not a ratchet.
  const res = spawnSync('node', argv, { cwd: tmpdir(), encoding: 'utf8' })
  return {
    code: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    out: `${res.stdout ?? ''}${res.stderr ?? ''}`,
  }
}

/** Read one target's version back through ITS OWN format — JSON.parse, or a YAML key line. */
function readVersion(root, target) {
  const abs = join(root, target.path)
  const text = readFileSync(abs, 'utf8')
  if (target.path.endsWith('.json')) return JSON.parse(text)[target.field]
  const line = text.split('\n').find((l) => l.startsWith(`${target.field}:`))
  assert.ok(line, `${target.path}: no top-level \`${target.field}:\` key — the YAML target was not patched`)
  return line.slice(target.field.length + 1).trim().replace(/^['"]|['"]$/g, '')
}

/** Content + mtime of every target, absent files recorded as absent. */
function snapshot(root) {
  const snap = {}
  for (const rel of ALL_TARGET_PATHS) {
    const abs = join(root, rel)
    snap[rel] = existsSync(abs)
      ? { text: readFileSync(abs, 'utf8'), mtimeMs: statSync(abs).mtimeMs }
      : { absent: true }
  }
  return snap
}

/** Lines of the combined output that name `needle`. */
function linesNaming(out, needle) {
  return out.split('\n').filter((l) => l.includes(needle))
}

// The module must be importable WITHOUT running its main (the exports are a reuse seam).
// Snapshot the real tree around the import so a missing `import.meta.main`-style guard is a
// named failure rather than a silent write into the checkout.
const REAL_BEFORE_IMPORT = snapshot(PLUGIN_ROOT)
const { VERSION_TARGETS, GENERATED_TARGETS } = await import(pathToFileURL(SCRIPT).href)
const REAL_AFTER_IMPORT = snapshot(PLUGIN_ROOT)

test('importing the script runs nothing — the exports are reusable without a side effect', () => {
  assert.deepEqual(
    REAL_AFTER_IMPORT,
    REAL_BEFORE_IMPORT,
    `importing scripts/emit-manifests.mjs wrote into the real plugin tree — guard main behind \`if (process.argv[1] === fileURLToPath(import.meta.url))\` so the file map can be imported by consumers`,
  )
})

test('the exported file map is the whole file map — every rotting home, no extras', () => {
  assert.deepEqual(
    [...VERSION_TARGETS].sort(byPath),
    [...EXPECTED_VERSION_TARGETS].sort(byPath),
    'VERSION_TARGETS must be exactly the { path, field } set above — add or retire a harness manifest HERE and in the script together',
  )
  assert.deepEqual(
    [...GENERATED_TARGETS].sort(byPath),
    [...EXPECTED_GENERATED_TARGETS].sort(byPath),
    'GENERATED_TARGETS must be exactly the { path } set above',
  )
})

// ── 1. the ratchet reds on a drifted VERSION, naming file AND field ───────────────────
test('--check exits 2 on a hand-edited version, naming the file, the field, and the fix', () => {
  const root = makeFixture()
  assert.equal(emit(root).code, 0, 'precondition: the generator must write cleanly first')

  const drifted = '.cursor-plugin/plugin.json'
  const abs = join(root, drifted)
  writeFileSync(abs, readFileSync(abs, 'utf8').replace('"version": "7.3.1"', '"version": "0.16.1"'))
  assert.equal(readVersion(root, { path: drifted, field: 'version' }), '0.16.1', 'precondition: the edit landed')

  const res = emit(root, '--check')
  assert.equal(res.code, 2, `a drifted version must exit 2, got ${res.code}\n${res.out}`)
  const named = linesNaming(res.out, drifted)
  assert.ok(named.length > 0, `--check must NAME the drifted file ${drifted}; got:\n${res.out}`)
  assert.ok(
    named.some((l) => l.includes('version')),
    `--check must name the FIELD on the same line as the file — a ratchet that reds without saying WHAT drifted costs a bisect; got:\n${named.join('\n')}`,
  )
  assert.ok(
    res.out.includes('emit-manifests.mjs'),
    `--check must print the fixing command (\`${FIX}\`); got:\n${res.out}`,
  )

  assert.equal(emit(root).code, 0)
  assert.equal(emit(root, '--check').code, 0, 'and one generator run must clear the red it just named')
})

// ── 2. the ratchet reds on a drifted SKILL LIST, naming the generated file ────────────
test('--check exits 2 when a skill directory appears without a regen, naming .codex/INSTALL.md', () => {
  const root = makeFixture()
  assert.equal(emit(root).code, 0)
  assert.equal(emit(root, '--check').code, 0, 'precondition: clean before the new skill lands')

  mkdirSync(join(root, 'skills', 'gamma-skill'), { recursive: true })
  writeFileSync(join(root, 'skills', 'gamma-skill', 'SKILL.md'), '# gamma\n')

  const res = emit(root, '--check')
  assert.equal(res.code, 2, `a skill added without a regen must exit 2, got ${res.code}\n${res.out}`)
  assert.ok(
    linesNaming(res.out, '.codex/INSTALL.md').length > 0,
    `--check must NAME .codex/INSTALL.md as the stale generated file; got:\n${res.out}`,
  )
  assert.ok(
    res.out.includes('gamma-skill'),
    `--check must say WHAT differs (the missing skill gamma-skill), not merely that a file differs; got:\n${res.out}`,
  )
  assert.ok(res.out.includes('emit-manifests.mjs'), `--check must print the fixing command; got:\n${res.out}`)
})

// ── 3. the decoy: the guard must not cry wolf on the state it just produced ───────────
test('--check exits 0 on the tree the generator just wrote — no false red', () => {
  const root = makeFixture()
  const wrote = emit(root)
  assert.equal(wrote.code, 0, `the generator must exit 0; stderr:\n${wrote.stderr}`)
  const res = emit(root, '--check')
  assert.equal(res.code, 0, `--check immediately after a write must exit 0; got ${res.code}\n${res.out}`)
})

// ── 4. --check is READ-ONLY, even when it reds ────────────────────────────────────────
test('a red --check writes nothing — no byte, no mtime, no newly created generated file', () => {
  const root = makeFixture()
  const before = snapshot(root)
  assert.equal(before['.codex-plugin/plugin.json'].absent, true, 'precondition: the new manifest is absent')

  const res = emit(root, '--check')
  assert.equal(res.code, 2, `the untouched fixture drifts on all four versions, so --check must red: ${res.out}`)

  assert.deepEqual(
    snapshot(root),
    before,
    '--check mutated the tree — it must compare against what a write WOULD produce, never write-then-diff (an identical rewrite still moves mtime, and in CI that is a dirty checkout)',
  )
  assert.equal(
    existsSync(join(root, '.codex-plugin', 'plugin.json')),
    false,
    '--check created the generated manifest it was only asked to check',
  )
})

// ── 5. idempotence ───────────────────────────────────────────────────────────────────
test('two consecutive writes are byte-identical, and the second reports no changed file', () => {
  const root = makeFixture()
  const first = emit(root)
  assert.equal(first.code, 0, first.stderr)
  for (const rel of ALL_TARGET_PATHS) {
    assert.ok(
      first.stdout.includes(rel),
      `run 1 changed every target (four drifted versions + two absent generated files) and must print a line naming ${rel}; got:\n${first.stdout}`,
    )
  }
  const after1 = snapshot(root)

  const second = emit(root)
  assert.equal(second.code, 0, second.stderr)
  const after2 = snapshot(root)
  for (const rel of ALL_TARGET_PATHS) {
    assert.equal(
      after2[rel].text,
      after1[rel].text,
      `${rel} differs between two consecutive writes — the generator is not deterministic (unsorted readdir? a timestamp in the output?)`,
    )
    assert.ok(
      !second.stdout.includes(rel),
      `run 2 changed nothing, so it must NOT print a line for ${rel} — "changed" output is the CI signal; got:\n${second.stdout}`,
    )
  }
  assert.equal(emit(root, '--check').code, 0)
})

// ── 6. one source, every target — including the YAML one ─────────────────────────────
test("package.json's version reaches EVERY version target, read back through its own format", () => {
  const root = makeFixture()
  assert.equal(emit(root).code, 0)
  const expected = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  assert.equal(expected, '7.3.1', 'precondition: the fixture version is the fixture\'s own, not the real tree\'s')

  for (const target of VERSION_TARGETS) {
    assert.ok(existsSync(join(root, target.path)), `${target.path} was declared a version target but never written`)
    assert.equal(
      readVersion(root, target),
      expected,
      `${target.path} carries a stale ${target.field} — one source (package.json) means one value in all ${VERSION_TARGETS.length} targets; run \`${FIX}\``,
    )
  }
  // Named explicitly: the YAML target is the one a JSON-only patcher silently skips.
  assert.equal(readVersion(root, { path: '.copilot/plugin.yaml', field: 'version' }), expected)
})

// ── 7. a version patch is a PATCH — this is what makes it safe in CI ─────────────────
test('patching the version preserves every other byte and the key order', () => {
  const root = makeFixture()
  const rel = '.claude-plugin/plugin.json'
  const abs = join(root, rel)
  const before = readFileSync(abs, 'utf8')
  const keysBefore = Object.keys(JSON.parse(before))

  assert.equal(emit(root).code, 0)
  const after = readFileSync(abs, 'utf8')
  const parsed = JSON.parse(after)

  assert.equal(parsed.version, '7.3.1')
  assert.deepEqual(
    Object.keys(parsed),
    keysBefore,
    'the version patch reordered the manifest keys — patch the field in place; do not reserialize the object',
  )
  assert.deepEqual(parsed.author, { name: 'Blade Labs', url: 'https://blade-labs.com' })
  assert.deepEqual(parsed.keywords, ['roadmap', 'phases', 'gates'])
  assert.equal(
    after.replace('"version": "7.3.1"', '"version": "0.0.1"'),
    before,
    'putting the old version back must reproduce the file BYTE-FOR-BYTE — this fixture is 4-space indented on purpose: a JSON.parse→JSON.stringify(…, 2) round trip reformats the whole manifest and turns every release bump into an unreviewable diff',
  )
})

// ── 8. host manifests keep their discovery surfaces structurally isolated ───────────
test("generated Codex manifest carries supported skills + interface fields and no Claude hooks", () => {
  const root = makeFixture()
  assert.equal(emit(root).code, 0)
  const abs = join(root, '.codex-plugin', 'plugin.json')
  assert.ok(existsSync(abs), '.codex-plugin/plugin.json must be generated whole, parent directory included')
  const manifest = JSON.parse(readFileSync(abs, 'utf8'))

  assert.equal(manifest.skills, './skills/', "codex reads the skills directory off this key — './skills/', leading dot")
  assert.equal('hooks' in manifest, false, 'Codex rejects the Claude-shaped hooks field; its manifest must omit it')
  assert.equal(typeof manifest.interface, 'object')
  assert.notEqual(manifest.interface, null)
  assert.equal(Array.isArray(manifest.interface), false)
  assert.equal(typeof manifest.interface.displayName, 'string')
  assert.ok(manifest.interface.displayName.trim().length > 0)
  assert.equal(typeof manifest.interface.shortDescription, 'string')
  assert.ok(manifest.interface.shortDescription.trim().length > 0)
  assert.equal(manifest.version, '7.3.1')
})

test('Claude manifest explicitly points at the isolated hook file and the conventional hook name stays absent', () => {
  const root = makeFixture()
  assert.equal(emit(root).code, 0)
  const claude = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(claude.hooks, './hooks/claude-hooks.json')
  assert.ok(existsSync(join(root, claude.hooks)), 'the explicit Claude hook target must resolve')
  assert.equal(existsSync(join(root, 'hooks', 'hooks.json')), false, 'the conventional filename would be auto-discovered by the wrong host')
})

// ── the generated INSTALL.md renders the LIVE directories, never a hand-kept list ─────
test('.codex/INSTALL.md lists the live skills and agents — sorted, dirs-vs-files respected, stale entries gone', () => {
  const root = makeFixture()
  assert.equal(emit(root).code, 0)
  const text = readFileSync(join(root, '.codex', 'INSTALL.md'), 'utf8')

  for (const name of ['alpha-skill', 'beta-skill', 'alpha-agent', 'zeta-agent']) {
    assert.ok(text.includes(name), `INSTALL.md omits the live entry ${name}:\n${text}`)
  }
  assert.ok(
    !text.includes('retired-skill'),
    'INSTALL.md still advertises the retired skill from the previous hand-kept copy — the file is GENERATED WHOLE, not appended to',
  )
  assert.ok(
    !text.includes('NOT-A-SKILL'),
    'a loose FILE under skills/ was listed as a skill — the skill list is the DIRECTORY names under skills/',
  )
  assert.ok(
    !text.includes('should-not-appear'),
    'a file under agents/references/ was listed as an agent — the agent list is agents/*.md, files only, no recursion',
  )
  assert.ok(
    text.indexOf('alpha-skill') < text.indexOf('beta-skill'),
    'the skill list must be sorted — readdir order is filesystem-dependent and would make the generator non-idempotent across machines',
  )
  assert.ok(text.indexOf('alpha-agent') < text.indexOf('zeta-agent'), 'the agent list must be sorted')
})

// ── 9. a generator that cannot read its source FAILS, never emits an empty list ──────
test('a missing package.json exits 1 naming it — in BOTH modes, and writes nothing', () => {
  for (const args of [[], ['--check']]) {
    const root = makeFixture({ omitPackageJson: true })
    const before = snapshot(root)
    const res = emit(root, ...args)
    assert.equal(
      res.code,
      1,
      `no package.json must exit 1 (an unreadable SOURCE, not a drift — never 2) for \`${args.join(' ') || '<no flags>'}\`; got ${res.code}\n${res.out}`,
    )
    assert.ok(res.out.includes('package.json'), `the failure must name the missing source; got:\n${res.out}`)
    assert.deepEqual(snapshot(root), before, 'a failed read must leave the tree untouched')
  }
})

test('a missing skills/ directory exits 1 naming it — never an empty skill list on disk', () => {
  const root = makeFixture({ omitSkillsDir: true })
  const before = snapshot(root)
  const res = emit(root)
  assert.equal(res.code, 1, `no skills/ directory must exit 1; got ${res.code}\n${res.out}`)
  assert.ok(res.out.includes('skills'), `the failure must name the missing skills directory; got:\n${res.out}`)
  assert.deepEqual(
    snapshot(root),
    before,
    'the generator emitted with an unreadable skill source — an INSTALL.md advertising ZERO skills is worse than the drift it replaces',
  )
  assert.ok(
    readFileSync(join(root, '.codex', 'INSTALL.md'), 'utf8').includes('retired-skill'),
    'INSTALL.md was regenerated from an unreadable source — a loud failure that leaves the stale file in place beats a quiet one that publishes an empty skill list',
  )
})

test('an unknown flag exits 1 — a usage error is 1, never a silent 0 or a drift 2', () => {
  const root = makeFixture()
  const before = snapshot(root)
  const res = emit(root, '--no-such-flag')
  assert.equal(res.code, 1, `an unknown flag must exit 1; got ${res.code}\n${res.out}`)
  assert.ok(res.out.includes('--no-such-flag'), `the usage error must name the offending flag; got:\n${res.out}`)
  assert.deepEqual(snapshot(root), before, 'a usage error must not write')

  const bare = emit(null, '--root')
  assert.equal(bare.code, 1, `\`--root\` with no value must exit 1; got ${bare.code}\n${bare.out}`)
})

// ── 10. THE LIVE RATCHET: the real plugin tree ───────────────────────────────────────
test('the REAL plugin tree is clean — every manifest already carries what a regen would write', () => {
  const res = emit(null, '--check')
  assert.equal(
    res.code,
    0,
    `harness manifest drift in ${PLUGIN_ROOT} — run \`${FIX}\` from the plugin root and commit the result. The version lives in package.json and the skill list in skills/; every file below is generated FROM them, so fix the source, never the copy.\n${res.out}`,
  )
})
