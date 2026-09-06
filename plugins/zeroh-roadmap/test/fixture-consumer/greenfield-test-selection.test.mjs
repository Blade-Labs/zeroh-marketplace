import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELECTOR = resolve(HERE, '../../../zeroh-greenfield/templates/scripts/run-nx-test-tier.mjs')
const roots = []
process.on('exit', () => roots.forEach((root) => rmSync(root, { recursive: true, force: true })))

function fixture(paths) {
  const root = mkdtempSync(join(tmpdir(), 'greenfield-selection-'))
  roots.push(root)
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'bin', 'npm'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$NX_ARGV"\n')
  chmodSync(join(root, 'bin', 'npm'), 0o755)
  for (const path of paths.filter((p) => !p.includes('\n'))) {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '')
  }
  const manifest = join(root, 'scope.json')
  writeFileSync(manifest, JSON.stringify({ protocol: 'scope-manifest-json-v1', paths }))
  const argv = join(root, 'argv.txt')
  const run = spawnSync('node', [SELECTOR, `@${manifest}`], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, NX_ARGV: argv },
  })
  return { root, run, selected: JSON.parse(run.stdout.trim()), argv: readFileSync(argv, 'utf8').trim().split('\n') }
}

test('source paths select Nx affected with safe argv; metacharacters never split or execute', () => {
  const path = 'packages/a/src/dollar$(touch PWNED); quote" space.ts'
  const f = fixture([path])
  assert.equal(f.run.status, 0)
  assert.equal(f.selected.tier, 'affected')
  assert.deepEqual(f.argv, ['exec', '--', 'nx', 'affected', '-t', 'test', `--files=${path}`])
  assert.equal(f.argv.length, 7, 'the filename remains one argv element')
})

test('explicit nonexistent exact test is nonzero even when the fallback runner succeeds', () => {
  const existing = fixture(['packages/a/src/a.test.ts'])
  assert.equal(existing.run.status, 0, existing.run.stderr)
  assert.equal(existing.selected.tier, 'scoped')
  const missing = fixture(['packages/a/src/missing.test.ts'])
  rmSync(join(missing.root, 'packages/a/src/missing.test.ts'))
  // Re-run after removing the target: an exact path may never green vacuously.
  const rerun = spawnSync('node', [SELECTOR, `@${join(missing.root, 'scope.json')}`], {
    cwd: missing.root, encoding: 'utf8', env: { ...process.env, PATH: `${join(missing.root, 'bin')}:${process.env.PATH}`, NX_ARGV: join(missing.root, 'argv2.txt') },
  })
  assert.notEqual(rerun.status, 0, 'an invalid explicit exact target must not become green through a successful fallback')
})

test('mixed explicit scope cannot hide a nonexistent exact test behind a shared lock change', () => {
  const f = fixture(['uv.lock', 'packages/a/src/missing.test.ts'])
  assert.equal(f.run.status, 0, f.run.stderr)
  assert.equal(f.selected.tier, 'full', 'a valid mixed scope can run the full suite')
  rmSync(join(f.root, 'packages/a/src/missing.test.ts'))
  const rerun = spawnSync('node', [SELECTOR, `@${join(f.root, 'scope.json')}`], {
    cwd: f.root, encoding: 'utf8', env: { ...process.env, PATH: `${join(f.root, 'bin')}:${process.env.PATH}`, NX_ARGV: join(f.root, 'mixed-argv.txt') },
  })
  assert.notEqual(rerun.status, 0, 'a shared lock requiring full tests must not authorize a nonexistent explicit test target')
})

test('malformed, empty, unsafe-root and newline scope fail byte-identically to full', () => {
  const expected = ['exec', '--', 'nx', 'run-many', '-t', 'test']
  for (const paths of [[], ['package-lock.json'], ['packages/a/src/x\ny.ts']]) {
    const f = fixture(paths)
    assert.equal(f.selected.tier, 'full')
    assert.deepEqual(f.argv, expected)
  }
})

test('an external manifest whose ancestor merely contains the ownership substring is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'greenfield-selection-root-'))
  const external = mkdtempSync(join(tmpdir(), 'fake-roadmap-scope-owner-'))
  roots.push(root, external)
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'bin', 'npm'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$NX_ARGV"\n')
  chmodSync(join(root, 'bin', 'npm'), 0o755)
  const manifest = join(external, 'not-scope.json')
  writeFileSync(manifest, JSON.stringify({ protocol: 'scope-manifest-json-v1', paths: ['src/a.ts'] }))
  const argv = join(root, 'argv.txt')
  const run = spawnSync('node', [SELECTOR, `@${manifest}`], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, NX_ARGV: argv },
  })
  assert.equal(run.status, 0)
  assert.equal(JSON.parse(run.stdout).reason, 'manifest outside roadmap ownership')
  assert.deepEqual(readFileSync(argv, 'utf8').trim().split('\n'), ['exec', '--', 'nx', 'run-many', '-t', 'test'])
})


// Actual Git history exercises range classification rather than supplying an
// equivalent manifest, so deleted paths and changed shared inputs retain meaning.
function impactedFixture(path, { deleted = false } = {}) {
  const f = fixture([path])
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: f.root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git('init', '--quiet')
  git('add', path)
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'before change')
  const base = git('rev-parse', 'HEAD')
  if (deleted) rmSync(join(f.root, path))
  else writeFileSync(join(f.root, path), 'changed shared input\n')
  git('add', path)
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'after change')
  const head = git('rev-parse', 'HEAD')
  const argv = join(f.root, 'impacted-argv.txt')
  const run = spawnSync('node', [SELECTOR, `${base}..${head}`], {
    cwd: f.root, encoding: 'utf8',
    env: { ...process.env, PATH: `${join(f.root, 'bin')}:${process.env.PATH}`, NX_ARGV: argv },
  })
  assert.equal(run.status, 0, run.stderr)
  return { ...f, run, selected: JSON.parse(run.stdout), argvBytes: readFileSync(argv, 'utf8') }
}

test('shared configuration and runner changes execute byte-identical full argv for manifest and Git range', async (t) => {
  const full = fixture([])
  assert.equal(full.run.status, 0, full.run.stderr)
  const expected = readFileSync(join(full.root, 'argv.txt'), 'utf8')
  assert.deepEqual(full.argv, ['exec', '--', 'nx', 'run-many', '-t', 'test'])
  const sharedInputs = [
    'nx.json', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json',
    'vitest.config.ts', 'jest.config.ts',
    'pyproject.toml', 'uv.lock', 'poetry.lock', 'requirements.txt',
    'scripts/run-nx-test-tier.mjs',
  ]
  for (const path of sharedInputs) for (const mode of ['manifest', 'Git range']) {
    await t.test(`${mode}: ${path}`, () => {
      const f = mode === 'manifest' ? fixture([path]) : impactedFixture(path)
      assert.equal(f.run.status, 0, f.run.stderr)
      const actual = mode === 'manifest' ? readFileSync(join(f.root, 'argv.txt'), 'utf8') : f.argvBytes
      assert.equal(actual, expected, `${path} must execute the full command with exactly the same argv bytes`)
      assert.equal(f.selected.tier, 'full')
    })
  }
})

test('a deleted exact test in a Git range may pass through full fallback', () => {
  const f = impactedFixture('packages/a/src/retired.test.ts', { deleted: true })
  assert.equal(f.selected.tier, 'full')
  assert.equal(f.argvBytes, 'exec\n--\nnx\nrun-many\n-t\ntest\n')
})

test('ordinary source Git range keeps the impacted affected selection', () => {
  const f = impactedFixture('packages/a/src/component.ts')
  assert.equal(f.selected.tier, 'affected')
  assert.equal(f.argvBytes, 'exec\n--\nnx\naffected\n-t\ntest\n--files=packages/a/src/component.ts\n')
})
