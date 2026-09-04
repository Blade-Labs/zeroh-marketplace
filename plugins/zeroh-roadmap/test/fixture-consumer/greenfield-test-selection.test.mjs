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

test('exact tests select scoped, while nonexistent exact targets fail toward full', () => {
  const existing = fixture(['packages/a/src/a.test.ts'])
  assert.equal(existing.selected.tier, 'scoped')
  const missing = fixture(['packages/a/src/missing.test.ts'])
  rmSync(join(missing.root, 'packages/a/src/missing.test.ts'))
  // Re-run after removing the target: an exact path may never green vacuously.
  const rerun = spawnSync('node', [SELECTOR, `@${join(missing.root, 'scope.json')}`], {
    cwd: missing.root, encoding: 'utf8', env: { ...process.env, PATH: `${join(missing.root, 'bin')}:${process.env.PATH}`, NX_ARGV: join(missing.root, 'argv2.txt') },
  })
  assert.equal(JSON.parse(rerun.stdout).tier, 'full')
})

test('malformed, empty, unsafe-root and newline scope fail byte-identically to full', () => {
  const expected = ['exec', '--', 'nx', 'run-many', '-t', 'test']
  for (const paths of [[], ['package-lock.json'], ['packages/a/src/x\ny.ts']]) {
    const f = fixture(paths)
    assert.equal(f.selected.tier, 'full')
    assert.deepEqual(f.argv, expected)
  }
})
