#!/usr/bin/env node
/** TEST-FIRST: dry-run-first root migration CLI and interruption replay. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, commitAll, runCli, writePhaseFile } from '../../test/fixture-consumer/harness.mjs'

function fixture() {
  const root = makeFixtureRepo()
  writePhaseFile(root, { phase: 3902, status: 'backlog', arcId: 'MIGRATE', tasks: [{ id: '3902.1', done: false }] })
  writeFileSync(join(root, 'roadmap', 'history.md'), 'preserve me\n')
  commitAll(root, 'seed cli migration')
  return root
}
const json = (run) => { assert.doesNotThrow(() => JSON.parse(run.stdout)); return JSON.parse(run.stdout) }

test('root migrate is dry-run by default and --apply consumes the exact canonical plan digest', () => {
  const root = fixture()
  const dry = runCli(root, ['root', 'migrate', '--to', 'docs/roadmap', '--json'])
  assert.equal(dry.code, 0, dry.stderr)
  const planned = json(dry)
  assert.equal(planned.status, 'planned')
  assert.match(planned.planDigest, /^[a-f0-9]{64}$/)
  assert.ok(existsSync(join(root, 'roadmap', 'roadmap.config.json')))
  assert.equal(existsSync(join(root, 'docs', 'roadmap')), false)
  const appliedRun = runCli(root, ['root', 'migrate', '--to', 'docs/roadmap', '--apply', '--json'])
  assert.equal(appliedRun.code, 0, appliedRun.stderr)
  const applied = json(appliedRun)
  assert.equal(applied.status, 'applied')
  assert.equal(applied.planDigest, planned.planDigest)
  assert.ok(existsSync(applied.receiptPath))
})

test('a process crash after a real rename resumes the bound intent and repeated apply is already-applied with one receipt', () => {
  const root = fixture()
  const modulePath = new URL('../lib/root-migration.mjs', import.meta.url).href
  const script = `import {planRootMigration,applyRootMigration} from ${JSON.stringify(modulePath)}; const cwd=process.argv[1]; const {plan}=planRootMigration(cwd); applyRootMigration(plan,{cwd,afterRename(){process.exit(73)}})`
  const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], { encoding: 'utf8' })
  assert.equal(crashed.status, 73)
  const resumedRun = runCli(root, ['root', 'migrate', '--to', 'docs/roadmap', '--apply', '--json'])
  assert.equal(resumedRun.code, 0, resumedRun.stderr)
  const resumed = json(resumedRun)
  assert.ok(['applied', 'already-applied'].includes(resumed.status))
  const replayRun = runCli(root, ['root', 'migrate', '--to', 'docs/roadmap', '--apply', '--json'])
  assert.equal(replayRun.code, 0, replayRun.stderr)
  const replay = json(replayRun)
  assert.equal(replay.status, 'already-applied')
  assert.equal(replay.planDigest, resumed.planDigest)
  const records = readdirSync(join(root, '.building', 'root-migrations')).filter((name) => name.endsWith('.receipt.json'))
  assert.equal(records.length, 1)
})

test('root migrate rejects unsupported destinations and malformed flag combinations as usage', () => {
  const root = fixture()
  for (const args of [
    ['root', 'migrate', '--to', 'elsewhere', '--json'],
    ['root', 'migrate', '--apply', '--unknown'],
    ['root', 'migrate'],
  ]) {
    const run = runCli(root, args)
    if (args.length === 2) assert.equal(run.code, 0, run.stderr)
    else assert.equal(run.code, 1)
  }
})
