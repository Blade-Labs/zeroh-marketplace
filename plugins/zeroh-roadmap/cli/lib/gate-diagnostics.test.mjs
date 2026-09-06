import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { diagnoseFailure, gateInputKey, retryDecision } from './gate-diagnostics.mjs'

test('failure hints distinguish known signals and never turn interruption into success', () => {
  for (const [output, category] of [
    ['not ok 1 - preserves original intent', 'product'],
    ['Error: Cannot find module tsx', 'tooling'],
    ['FATAL ERROR: heap out of memory', 'resource'],
    ['HTTP 429: quota exhausted', 'authority-quota'],
    ['', 'unknown'],
  ]) {
    const result = diagnoseFailure({ exitCode: 1, output })
    assert.equal(result.category, category)
    assert.ok(result.nextStep.length > 20)
  }
  assert.equal(diagnoseFailure({ exitCode: 0 }), null)
  assert.equal(diagnoseFailure({ exitCode: 128, signal: 'SIGTERM' }).category, 'unknown')
  assert.notEqual(diagnoseFailure({ exitCode: 0, signal: 'SIGTERM' }), null)
  assert.equal(diagnoseFailure({ exitCode: 1, output: 'Error: ENOENT /tmp/a/source.ts' }).signature,
    diagnoseFailure({ exitCode: 1, output: 'Error: ENOENT /tmp/b/source.ts' }).signature)
})

const failure = diagnoseFailure({ exitCode: 1, output: 'not ok 1 - original intent' })
const row = { slot: 'unit', command: 'run unit', exitCode: 1, failure }
const report = (extra = {}) => ({ attempt: { inputKey: 'source' }, slots: [row], ...extra })
test('two matching failures block a third unchanged attempt, including across unrelated partial checks', () => {
  assert.equal(retryDecision([report()], 'source', [row]).blocked, false)
  assert.equal(retryDecision([report(), report()], 'source', [row]).blocked, true)
  assert.equal(retryDecision([report({ slots: [{ slot: 'types', command: 'types', exitCode: 0 }] }), report(), report()], 'source', [row]).blocked, true)
  assert.equal(retryDecision([report(), report()], null, [row]).blocked, true, 'unknown inputs cannot prove progress')
  assert.equal(retryDecision([report(), report()], 'repaired', [row]).blocked, false)
  assert.equal(retryDecision([report(), report()], 'source', [{ ...row, command: 'repaired command' }]).blocked, false)
  assert.equal(retryDecision([report({ attempt: { inputKey: 'source', retryReason: 'Installed the missing local tool' } }), report()], 'source', [row]).blocked, true, 'a reason authorizes only its own attempt')
  assert.equal(retryDecision([report({ slots: [{ ...row, exitCode: 0, failure: undefined }] }), report()], 'source', [row]).blocked, false)
  assert.equal(retryDecision([report({ slots: [{ ...row, failure: { ...failure, signature: 'different' } }] }), report()], 'source', [row]).blocked, false)
})

test('progress uses actual tracked and untracked bytes, not just filenames; generated evidence can be excluded', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-progress-'))
  try {
    const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { stdio: 'ignore' })
    git('init', '-q'); writeFileSync(join(root, 'app.mjs'), 'original'); git('add', '.'); git('commit', '-qm', 'seed')
    const initial = gateInputKey(root)
    assert.ok(initial)
    git('commit', '--allow-empty', '-qm', 'no source progress')
    assert.equal(gateInputKey(root), initial)
    writeFileSync(join(root, 'app.mjs'), 'repair')
    assert.notEqual(gateInputKey(root), initial)
    writeFileSync(join(root, 'new.mjs'), 'first')
    const untracked = gateInputKey(root)
    writeFileSync(join(root, 'new.mjs'), 'second')
    assert.notEqual(gateInputKey(root), untracked)
    const effective = gateInputKey(root)
    git('add', '.')
    assert.equal(gateInputKey(root), effective, 'staging is not source progress')
    git('commit', '-qm', 'same effective bytes')
    assert.equal(gateInputKey(root), effective, 'committing is not source progress')
    const before = gateInputKey(root, { exclude: ['record.json'] })
    writeFileSync(join(root, 'record.json'), 'derived gate evidence')
    assert.equal(gateInputKey(root, { exclude: ['record.json'] }), before)
    git('add', 'record.json'); git('commit', '-qm', 'evidence only')
    assert.equal(gateInputKey(root, { exclude: ['record.json'] }), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
