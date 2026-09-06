import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'roadmap-scoped-'))
  t.after(() => rmSync(root, {recursive:true,force:true}))
  const plugin = join(root, 'plugins/zeroh-roadmap')
  mkdirSync(join(plugin, 'scripts'), {recursive:true})
  const script = join(plugin, 'scripts/run-scoped-tests.mjs')
  copyFileSync(new URL('./run-scoped-tests.mjs', import.meta.url), script)
  const marker = join(root, 'ran')
  writeFileSync(join(plugin, 'space name.test.mjs'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'yes')`)
  writeFileSync(join(plugin, 'bad.test.mjs'), 'throw Error("intentional failure")')
  writeFileSync(join(root, 'outside.test.mjs'), '')
  symlinkSync(join(root, 'outside.test.mjs'), join(plugin, 'escape.test.mjs'))
  const env = {...process.env};delete env.NODE_TEST_CONTEXT
  return {root, plugin, marker, run: targets => spawnSync(process.execPath, [script, ...targets], {cwd:tmpdir(),env,encoding:'utf8',timeout:15000})}
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
    ['plugins/zeroh-roadmap/space name.test.mjs','missing.test.mjs']]) {
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
