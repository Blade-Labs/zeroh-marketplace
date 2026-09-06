import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function fixture(t, body, { helper = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'roadmap-runner-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ['bin', 'cli', 'hooks', 'scripts', 'test', 'tools']) mkdirSync(join(root, dir))
  copyFileSync(new URL('./run-tests.mjs', import.meta.url), join(root, 'scripts/run-tests.mjs'))
  writeFileSync(join(root, 'test/file with spaces.test.mjs'), body)
  writeFileSync(join(root, 'tools/npx'), '#!/bin/sh\nprintf "schema\\n" >> "$TEST_RUNNER_RECORD"\n', { mode: 0o755 })
  if (helper) {
    writeFileSync(join(root, 'tools/capbuild-node-tests'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$TEST_RUNNER_ARGS"\n', { mode: 0o755 })
    writeFileSync(join(root, 'tools/capbuild'), '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o755 })
  }
  const env = { ...process.env }
  // This subprocess is a fresh test invocation, not a child of this file's runner.
  delete env.NODE_TEST_CONTEXT
  const record = join(root, 'record')
  const args = join(root, 'args')
  return { root, record, args, run: (concurrency = '2') => spawnSync(process.execPath, [join(root, 'scripts/run-tests.mjs')], {
    encoding: 'utf8', timeout: 20000,
    env: { ...env, PATH: `${join(root, 'tools')}:/usr/bin:/bin`, TEST_CONCURRENCY: concurrency,
      TEST_RUNNER_RECORD: record, TEST_RUNNER_ARGS: args },
  }) }
}
test('portable runner executes real files and schema exactly once after success', t => {
  const f = fixture(t, 'import {test} from "node:test";test("passes",()=>{})')
  const r = f.run()
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /concurrency=2/)
  assert.equal(readFileSync(f.record, 'utf8'), 'schema\n')
})
test('test failure returns nonzero and never runs schema', t => {
  const f = fixture(t, 'import {test} from "node:test";test("fails",()=>{throw Error("intentional")})')
  assert.notEqual(f.run().status, 0)
  assert.equal(existsSync(f.record), false)
})
test('host helper receives intact file paths and worker bound; schema remains capped', t => {
  const f = fixture(t, '', { helper: true })
  const r = f.run('auto')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(readFileSync(f.args, 'utf8').trim().split('\n'), ['--workers', 'auto', join(f.root, 'test/file with spaces.test.mjs')])
  assert.equal(readFileSync(f.record, 'utf8'), 'schema\n')
})
test('invalid worker count fails before launching tests or schema', t => {
  const f = fixture(t, '')
  assert.equal(f.run('999').status, 2)
  assert.equal(existsSync(f.record), false)
})
