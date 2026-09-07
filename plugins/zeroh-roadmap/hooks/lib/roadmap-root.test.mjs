import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { roadmapRoot, defaultRoadmapRoot, resetRoadmapRootCache } from '../../cli/lib/roadmap-root.mjs'
import { makeFixtureRepo, git } from '../../test/fixture-consumer/harness.mjs'

const shell = new URL('./roadmap-root.sh', import.meta.url)
function fixture(t) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'root-parity-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root }
function mark(root, rel) { mkdirSync(join(root, rel, 'phases'), { recursive: true }); writeFileSync(join(root, rel, 'roadmap.config.json'), '{}\n') }
function shellRoot(dir, override) {
  const script = `. ${JSON.stringify(shell.pathname)}; roadmap_root "$1"`
  const env = { ...process.env }; if (override === undefined) delete env.ROADMAP_ROOT; else env.ROADMAP_ROOT = override
  return spawnSync('bash', ['-c', script, 'roadmap-root-test', dir], { encoding: 'utf8', env })
}
function nodeRoot(dir, override) {
  const previous = process.env.ROADMAP_ROOT
  if (override === undefined) delete process.env.ROADMAP_ROOT; else process.env.ROADMAP_ROOT = override
  resetRoadmapRootCache()
  try { return { status: 0, stdout: roadmapRoot(dir) + '\n', stderr: '' } }
  catch (error) { return { status: 1, stdout: '', stderr: error.message + '\n' } }
  finally { if (previous === undefined) delete process.env.ROADMAP_ROOT; else process.env.ROADMAP_ROOT = previous; resetRoadmapRootCache() }
}

test('shell and Node select the same canonical root for unmarked, docs, override, linked, and ambiguous estates', t => {
  for (const mode of ['unmarked', 'docs', 'override', 'linked', 'ambiguous']) {
    const root = fixture(t); let input = root; let override
    if (mode === 'docs' || mode === 'linked' || mode === 'ambiguous') mark(root, 'docs/roadmap')
    if (mode === 'ambiguous') mark(root, 'roadmap')
    if (mode === 'override') override = 'ops/roadmap'
    if (mode === 'linked') { const parent = fixture(t); const link = join(parent, 'checkout'); symlinkSync(root, link, 'dir'); input = link }
    const node = nodeRoot(input, override); const sh = shellRoot(input, override)
    assert.equal(sh.status, node.status, mode)
    if (node.status === 0) assert.equal(sh.stdout, node.stdout, mode)
    else {
      for (const rel of ['roadmap', 'docs/roadmap']) assert.ok(sh.stderr.includes(join(realpathSync(root), rel)), mode)
      assert.match(sh.stderr, /ROADMAP_ROOT=/)
    }
  }
})


test('nested callers and an actual linked Git checkout agree through their public toplevel boundary', t => {
  const root = makeFixtureRepo({ layout: 'docs' })
  const nested = join(root, 'src', 'spine')
  const nestedTop = git(root, 'rev-parse', '--show-toplevel')
  assert.equal(shellRoot(nestedTop).stdout.trim(), defaultRoadmapRoot(nested))

  const linkedParent = fixture(t)
  const linked = join(linkedParent, 'linked-checkout')
  git(root, 'worktree', 'add', '-q', '-b', 'linked-root-parity', linked)
  t.after(() => { try { git(root, 'worktree', 'remove', '--force', linked) } catch {} })
  const linkedNested = join(linked, 'src', 'spine')
  const linkedTop = git(linked, 'rev-parse', '--show-toplevel')
  assert.equal(shellRoot(linkedTop).stdout.trim(), defaultRoadmapRoot(linkedNested))
})

test('shell and Node normalize relative dot segments and absolute trailing slashes in overrides identically', t => {
  const root = fixture(t)
  for (const override of ['./ops/../active/', join(root, 'active') + '/']) {
    const node = nodeRoot(root, override)
    const sh = shellRoot(root, override)
    assert.equal(sh.status, 0)
    assert.equal(sh.stdout, node.stdout, override)
  }
})
