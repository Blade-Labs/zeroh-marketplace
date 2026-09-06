#!/usr/bin/env node
/**
 * TEST-FIRST for the repository-governance resolver used before a mutating child launch.
 * Real tmp git repositories exercise path and symlink behavior; no instruction is executed.
 * Run: capbuild node --test cli/lib/governance.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const { resolveGovernance } = await import(join(HERE, 'governance.mjs'))
const cleanups = []
process.on('exit', () => cleanups.forEach((fn) => fn()))

const GATES = {
  lint: 'none', types: 'none', unit: 'capbuild node --test', integration: 'none',
  build: 'none', e2e: 'none', emit: 'none',
}

function repo({ config = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'governance-')))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q'], { cwd: root })
  if (config) {
    mkdirSync(join(root, 'roadmap'), { recursive: true })
    writeFileSync(join(root, 'roadmap', 'roadmap.config.json'), JSON.stringify({ configVersion: 1, gateCommands: GATES }) + '\n')
  }
  return root
}

function put(root, rel, body = '') {
  const abs = join(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
  return abs
}

function assertHold(receipt, kind) {
  assert.equal(receipt.hold?.kind, kind, `expected ${kind}, got ${JSON.stringify(receipt.hold)}`)
  assert.equal(typeof receipt.hold.target, 'string')
  assert.ok(receipt.hold.reason.length > 0)
}

test('nested targets retain raw instruction text in deterministic broad-to-near order', () => {
  const root = repo()
  const rawRootAgents = 'ROOT AGENTS\nDo not interpret `touch SHOULD_NOT_EXIST`.\n'
  put(root, 'AGENTS.md', rawRootAgents)
  put(root, 'CLAUDE.md', 'ROOT CLAUDE\n')
  put(root, 'packages/CLAUDE.md', 'PACKAGES CLAUDE\n')
  put(root, 'packages/a/AGENTS.md', 'A AGENTS\n')
  put(root, 'packages/b/AGENTS.md', 'B AGENTS\n')
  put(root, 'packages/a/src/existing.mjs', '')
  put(root, 'packages/b/src/existing.mjs', '')

  const receipt = resolveGovernance(root, ['packages/b/src/existing.mjs', 'packages/a/src/existing.mjs'])

  assert.equal(receipt.root, root)
  assert.deepEqual(receipt.targets, ['packages/a/src/existing.mjs', 'packages/b/src/existing.mjs'])
  assert.deepEqual(receipt.instructions.map(({ path, kind }) => ({ path, kind })), [
    { path: 'AGENTS.md', kind: 'agents' },
    { path: 'CLAUDE.md', kind: 'claude' },
    { path: 'packages/CLAUDE.md', kind: 'claude' },
    { path: 'packages/a/AGENTS.md', kind: 'agents' },
    { path: 'packages/b/AGENTS.md', kind: 'agents' },
  ])
  assert.equal(receipt.instructions[0].text, rawRootAgents, 'raw instruction bytes survive resolution verbatim')
  assert.equal(receipt.hold, null)
  assert.deepEqual(receipt.taskRunners, GATES, 'roadmap config gateCommands are the task-runner SSOT')
  assert.equal(existsSync(join(root, 'SHOULD_NOT_EXIST')), false, 'instruction prose is data and was never executed')
})

test('the instruction union is deduplicated and independent of target input order', () => {
  const root = repo()
  put(root, 'AGENTS.md', 'root\n')
  put(root, 'x/CLAUDE.md', 'x\n')
  put(root, 'x/a.txt', '')
  put(root, 'x/b.txt', '')
  const forward = resolveGovernance(root, ['x/a.txt', 'x/b.txt'])
  const reverse = resolveGovernance(root, ['x/b.txt', 'x/a.txt'])
  assert.deepEqual(reverse, forward)
  assert.deepEqual(forward.instructions.map((x) => x.path), ['AGENTS.md', 'x/CLAUDE.md'])
})

test('an existing directory includes its own rules; a contained future file walks existing ancestors', () => {
  const root = repo()
  put(root, 'AGENTS.md', 'root\n')
  put(root, 'nested/AGENTS.md', 'nested\n')
  mkdirSync(join(root, 'nested', 'new'), { recursive: true })
  const directory = resolveGovernance(root, ['nested'])
  const future = resolveGovernance(root, ['nested/new/future.mjs'])
  assert.deepEqual(directory.instructions.map((x) => x.path), ['AGENTS.md', 'nested/AGENTS.md'])
  assert.deepEqual(future.instructions.map((x) => x.path), ['AGENTS.md', 'nested/AGENTS.md'])
  assert.equal(future.hold, null, 'a future file may be created when its existing ancestors remain contained')
})

test('contained directory aliases canonicalize existing and future targets without losing nearby rules', () => {
  const root = repo()
  put(root, 'real/AGENTS.md', 'real rules\n')
  mkdirSync(join(root, 'real/src'), { recursive: true })
  symlinkSync(join(root, 'real'), join(root, 'alias'))
  const receipt = resolveGovernance(root, ['real/src', 'alias/src', 'alias/src/future.mjs'])
  assert.deepEqual(receipt.targets, ['real/src', 'real/src/future.mjs'])
  assert.deepEqual(receipt.instructions.map((x) => x.path), ['real/AGENTS.md'])
  assert.equal(receipt.hold, null)
})

test('outside and symlink-escaped targets return typed holds', () => {
  const root = repo()
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'governance-outside-')))
  cleanups.push(() => rmSync(outside, { recursive: true, force: true }))
  put(outside, 'secret.txt', 'secret\n')
  symlinkSync(outside, join(root, 'escape'))

  assertHold(resolveGovernance(root, ['../outside.txt']), 'target-outside-repository')
  assertHold(resolveGovernance(root, ['escape/secret.txt']), 'symlink-escape')
})

test('a symlinked instruction file escaping the repository refuses governance', () => {
  const root = repo()
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'governance-rules-')))
  cleanups.push(() => rmSync(outside, { recursive: true, force: true }))
  put(outside, 'rules.md', 'outside rules\n')
  symlinkSync(join(outside, 'rules.md'), join(root, 'AGENTS.md'))
  put(root, 'src/a.mjs', '')
  assertHold(resolveGovernance(root, ['src/a.mjs']), 'symlink-escape')
})

test('a dangling instruction symlink is an access refusal, never an absent rule', () => {
  const root = repo()
  symlinkSync(join(root, 'missing-rules.md'), join(root, 'AGENTS.md'))
  put(root, 'src/a.mjs', '')
  assertHold(resolveGovernance(root, ['src/a.mjs']), 'access-refused')
})

test('missing, invalid, or incomplete runner config returns task-runners-unavailable', () => {
  const absent = repo({ config: false })
  put(absent, 'src/a.mjs', '')
  assertHold(resolveGovernance(absent, ['src/a.mjs']), 'task-runners-unavailable')

  const invalid = repo({ config: false })
  put(invalid, 'src/a.mjs', '')
  put(invalid, 'roadmap/roadmap.config.json', '{broken')
  assertHold(resolveGovernance(invalid, ['src/a.mjs']), 'task-runners-unavailable')

  const incomplete = repo({ config: false })
  put(incomplete, 'src/a.mjs', '')
  put(incomplete, 'roadmap/roadmap.config.json', JSON.stringify({ configVersion: 1, gateCommands: { unit: 'npm test' } }))
  assertHold(resolveGovernance(incomplete, ['src/a.mjs']), 'task-runners-unavailable')
})

test('runner strings are returned exactly and never spawned by resolution', () => {
  const root = repo({ config: false })
  const marker = join(root, 'RUNNER_WAS_EXECUTED')
  const runners = { ...GATES, unit: `touch ${marker}` }
  put(root, 'roadmap/roadmap.config.json', JSON.stringify({ configVersion: 1, gateCommands: runners }))
  put(root, 'src/a.mjs', '')
  const receipt = resolveGovernance(root, ['src/a.mjs'])
  assert.deepEqual(receipt.taskRunners, runners)
  assert.equal(receipt.hold, null)
  assert.equal(existsSync(marker), false, 'the resolver returns native runner bindings as data; it executes none')
})
