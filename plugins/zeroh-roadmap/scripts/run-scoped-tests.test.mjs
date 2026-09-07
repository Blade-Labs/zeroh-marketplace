import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, symlinkSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function fixture(t, { helper = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'roadmap-scoped-'))
  t.after(() => rmSync(root, {recursive:true,force:true}))
  const plugin = join(root, 'plugins/zeroh-roadmap')
  mkdirSync(join(plugin, 'scripts'), {recursive:true})
  mkdirSync(join(root, 'tools'), { recursive: true })
  mkdirSync(join(root, 'scripts'), { recursive: true })
  const script = join(plugin, 'scripts/run-scoped-tests.mjs')
  copyFileSync(new URL('./run-scoped-tests.mjs', import.meta.url), script)
  copyFileSync(new URL('./test-execution.mjs', import.meta.url), join(plugin, 'scripts/test-execution.mjs'))
  const marker = join(root, 'ran')
  writeFileSync(join(plugin, 'space name.test.mjs'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'yes')`)
  writeFileSync(join(plugin, 'bad.test.mjs'), 'throw Error("intentional failure")')
  writeFileSync(join(root, 'outside.test.mjs'), '')
  mkdirSync(join(root, 'scripts', 'nested'))
  writeFileSync(join(root, 'scripts', 'nested', 'not-admitted.test.mjs'), '')
  writeFileSync(join(root, 'scripts/nativegreen-review-regressions.test.mjs'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'repo-script:' + process.cwd())`)
  writeFileSync(join(plugin, 'scripts/schema.test.ts'), '')
  symlinkSync(join(root, 'outside.test.mjs'), join(plugin, 'escape.test.mjs'))
  symlinkSync(join(root, 'outside.test.mjs'), join(root, 'scripts', 'escape.test.mjs'))
  const env = {...process.env};delete env.NODE_TEST_CONTEXT
  const args = join(root, 'helper-args')
  const record = join(root, 'record')
  const cwds = join(root, 'helper-cwds')
  if (helper) {
    writeFileSync(join(root, 'tools/capbuild-node-tests'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$TEST_RUNNER_ARGS"\nprintf "%s\\n" "$PWD" >> "$TEST_RUNNER_CWDS"\nif [ "$HELPER_FAIL" = 1 ]; then exit 7; fi\n', { mode: 0o755 })
    writeFileSync(join(root, 'tools/capbuild'), '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o755 })
    writeFileSync(join(root, 'tools/npx'), '#!/bin/sh\nprintf "schema\\n" >> "$TEST_RUNNER_RECORD"\n', { mode: 0o755 })
  }
  return {root, plugin, marker, args, cwds, record, recordStringify: record, run: (targets, options = {}) => spawnSync(process.execPath, [script, ...targets], {
    cwd:tmpdir(), encoding:'utf8',timeout:15000,
    env: { ...env, PATH: helper ? `${join(root, 'tools')}:/usr/bin:/bin` : '/usr/bin:/bin', TEST_CONCURRENCY: options.concurrency ?? 'auto', TEST_RUNNER_ARGS: args, TEST_RUNNER_CWDS: cwds, TEST_RUNNER_RECORD: record, HELPER_FAIL: options.fail ? '1' : '0' },
  })}
}
test('scoped runner executes the exact space-containing target and preserves failure', t => {
  const f=fixture(t)
  assert.equal(f.run(['plugins/zeroh-roadmap/space name.test.mjs']).status,0)
  assert.equal(existsSync(f.marker),true)
  assert.notEqual(f.run(['plugins/zeroh-roadmap/bad.test.mjs']).status,0)
})
test('scoped runner preflights every target before starting any tests', t => {
  const f=fixture(t)
  for (const targets of [[], ['missing.test.mjs'], ['outside.test.mjs'], [join(f.plugin,'space name.test.mjs')],
    ['plugins/zeroh-roadmap/escape.test.mjs'], ['plugins/zeroh-roadmap/../outside.test.mjs'], ['README.md'],
    ['plugins/zeroh-roadmap/space name.test.mjs','missing.test.mjs'], ['scripts'], ['scripts/escape.test.mjs'], ['scripts/nested/not-admitted.test.mjs'],
    ['scripts/nativegreen-review-regressions.test.mjs', 'outside.test.mjs']]) {
    assert.equal(f.run(targets).status,2,JSON.stringify(targets))
    assert.equal(existsSync(f.marker),false,'invalid later target must prevent earlier test execution')
  }
})
test('scoped runner propagates child signal instead of returning success', t => {
  const f=fixture(t)
  writeFileSync(join(f.plugin,'signal.test.mjs'), 'process.kill(process.ppid,"SIGKILL")')
  const result=f.run(['plugins/zeroh-roadmap/signal.test.mjs'])
  assert.equal(result.signal,'SIGKILL',result.stderr)
})

test('scoped runner shares helper worker policy and sends deduped absolute realpaths', t => {
  const f = fixture(t, { helper: true })
  const target = 'plugins/zeroh-roadmap/space name.test.mjs'
  const result = f.run([target, target], { concurrency: 'auto' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readFileSync(f.args, 'utf8').trim().split('\n'), ['--workers', 'auto', join(f.plugin, 'space name.test.mjs')])
})

test('scoped runner validates concurrency before spawn and runs requested schema only after node success', t => {
  const f = fixture(t, { helper: true })
  const nodeTarget = 'plugins/zeroh-roadmap/space name.test.mjs'
  const schemaTarget = 'plugins/zeroh-roadmap/scripts/schema.test.ts'
  assert.equal(f.run([nodeTarget], { concurrency: '999' }).status, 2)
  assert.equal(existsSync(f.args), false)
  assert.equal(existsSync(f.record), false)

  const failed = f.run([nodeTarget, schemaTarget], { concurrency: '3', fail: true })
  assert.equal(failed.status, 7)
  assert.equal(existsSync(f.record), false, 'schema waits for green node tests')
  rmSync(f.args, { force: true })
  rmSync(f.cwds, { force: true })

  const green = f.run([nodeTarget, schemaTarget], { concurrency: '3' })
  assert.equal(green.status, 0, green.stderr)
  assert.deepEqual(readFileSync(f.args, 'utf8').trim().split('\n'), ['--workers', '3', join(f.plugin, 'space name.test.mjs')])
  assert.equal(readFileSync(f.record, 'utf8'), 'schema\n')
})


test('scoped runner admits canonical repository scripts tests alongside plugin tests and keeps realpath deduplication', t => {
  const f = fixture(t, { helper: true })
  const pluginTarget = 'plugins/zeroh-roadmap/space name.test.mjs'
  const repoTarget = 'scripts/nativegreen-review-regressions.test.mjs'
  const result = f.run([repoTarget, pluginTarget, repoTarget])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readFileSync(f.args, 'utf8').trim().split('\n'), [
    '--workers', 'auto', join(f.root, pluginTarget),
    '--workers', 'auto', join(f.root, repoTarget),
  ])
  assert.deepEqual(readFileSync(f.cwds, 'utf8').trim().split('\n'), [f.plugin, f.root])
})


test('scoped runner executes a canonical repository script with repository cwd', t => {
  const f = fixture(t)
  const result = f.run(['scripts/nativegreen-review-regressions.test.mjs'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(f.marker, 'utf8'), 'repo-script:' + f.root)
})
