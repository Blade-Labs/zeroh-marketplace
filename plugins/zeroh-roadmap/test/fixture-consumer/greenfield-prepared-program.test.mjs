import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { prepare, run } from '../../../zeroh-greenfield/scripts/prepared-program.mjs'

const helper = resolve(dirname(fileURLToPath(import.meta.url)), '../../../zeroh-greenfield/scripts/prepared-program.mjs')
function fixture(t, source = "printf 'reviewed' > result.txt\n", kind = 'bash') {
  const root = mkdtempSync(join(tmpdir(), 'greenfield-prepared-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cwd = join(root, 'consumer'), artifacts = join(root, 'artifacts'), script = join(root, 'source')
  mkdirSync(cwd); mkdirSync(artifacts)
  writeFileSync(script, source)
  return { root, cwd, artifacts, script, request: { cwd, script, kind, paths: ['result.txt'] } }
}

for (const [kind, source] of [
  ['bash', "printf 'reviewed' > result.txt\n"],
  ['python', "from pathlib import Path\nPath('result.txt').write_text('reviewed')\n"],
  ['node', "import {writeFileSync} from 'node:fs'; writeFileSync('result.txt', 'reviewed');\n"],
]) {
  test(`prepared ${kind}: executes saved bytes after source changes and creates an absent target`, t => {
    const f = fixture(t, source, kind), artifact = prepare(f.request, f.artifacts)
    assert.deepEqual(readdirSync(f.cwd), [], 'preparation does not mutate the consumer')
    writeFileSync(f.script, 'this is no longer the reviewed program')
    assert.equal(run(artifact, true), 0)
    assert.equal(readFileSync(join(f.cwd, 'result.txt'), 'utf8'), 'reviewed')
  })
}

test('prepared execution without approval refuses before any consumer write', t => {
  const f = fixture(t), artifact = prepare(f.request, f.artifacts)
  assert.throws(() => run(artifact), /prior host\/user approval/)
  assert.deepEqual(readdirSync(f.cwd), [])
})

for (const [kind, source] of [['bash', "printf 'bad' > result.txt\nif then\n"], ['python', "open('result.txt','w').write('bad')\nif :\n"], ['node', "import {writeFileSync} from 'node:fs'; writeFileSync('result.txt','bad'); const = ;\n"]]) {
  test(`prepared ${kind}: syntax failure happens before artifact or consumer writes`, t => {
    const f = fixture(t, source, kind)
    assert.throws(() => prepare(f.request, f.artifacts), /Preflight failed/)
    assert.deepEqual(readdirSync(f.cwd), [])
    assert.deepEqual(readdirSync(f.artifacts), [])
  })
}

for (const [kind, source] of [['bash', 'exit 23\n'], ['python', 'raise SystemExit(23)\n'], ['node', 'process.exit(23)\n']]) {
  test(`prepared ${kind}: CLI preserves the real nonzero process exit`, t => {
    const f = fixture(t, source, kind), artifact = prepare(f.request, f.artifacts)
    const result = spawnSync(process.execPath, [helper, 'run', artifact, '--approved'], { encoding: 'utf8' })
    assert.equal(result.status, 23, result.stderr)
    assert.deepEqual(readdirSync(f.cwd), [])
  })
}

test('prepared execution rejects changed artifact bytes before mutation', t => {
  const f = fixture(t), artifact = prepare(f.request, f.artifacts)
  chmodSync(artifact, 0o600)
  writeFileSync(artifact, readFileSync(artifact, 'utf8') + ' ')
  assert.throws(() => run(artifact, true), /digest mismatch/)
  assert.deepEqual(readdirSync(f.cwd), [])
})

for (const initial of ['original', null]) {
  test(`prepared execution rejects a ${initial === null ? 'missing target created' : 'target changed'} after preparation`, t => {
    const f = fixture(t), target = join(f.cwd, 'result.txt')
    if (initial !== null) writeFileSync(target, initial)
    const artifact = prepare(f.request, f.artifacts)
    writeFileSync(target, 'concurrent edit')
    assert.throws(() => run(artifact, true), /Target changed since preparation/)
    assert.equal(readFileSync(target, 'utf8'), 'concurrent edit')
  })
}

for (const timing of ['before preparation', 'after preparation']) {
  test(`prepared execution rejects a symlink target introduced ${timing}`, t => {
    const f = fixture(t), outside = join(f.root, 'outside.txt')
    writeFileSync(outside, 'preserve outside')
    if (timing === 'before preparation') {
      symlinkSync(outside, join(f.cwd, 'result.txt'))
      assert.throws(() => prepare(f.request, f.artifacts), /Symlink target refused/)
    } else {
      const artifact = prepare(f.request, f.artifacts)
      symlinkSync(outside, join(f.cwd, 'result.txt'))
      assert.throws(() => run(artifact, true), /Symlink target refused/)
    }
    assert.equal(readFileSync(outside, 'utf8'), 'preserve outside')
  })
}

test('prepared program rejects unsupported interpreters without writing an artifact', t => {
  const f = fixture(t, 'anything', 'rust')
  assert.throws(() => prepare(f.request, f.artifacts), /kind must be bash, python or node/)
  assert.deepEqual(readdirSync(f.cwd), [])
  assert.deepEqual(readdirSync(f.artifacts), [])
})

test('prepared bash: a command reading stdin cannot consume later approved program statements', t => {
  const f = fixture(t, "cat > /dev/null\nprintf 'reviewed' > result.txt\n")
  const artifact = prepare(f.request, f.artifacts)
  assert.equal(run(artifact, true), 0)
  assert.equal(readFileSync(join(f.cwd, 'result.txt'), 'utf8'), 'reviewed', 'all approved statements execute even when a child reads stdin')
})
