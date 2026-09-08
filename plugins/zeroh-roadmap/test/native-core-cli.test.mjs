import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../bin/roadmap.mjs', import.meta.url))
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
delete env.ROADMAP_ROOT
function command(cwd, program, args) {
  const result = spawnSync(program, args, { cwd, env, encoding: 'utf8', timeout: 15000 })
  assert.ifError(result.error)
  return result
}
function git(cwd, ...args) {
  const result = command(cwd, 'git', args)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function run(cwd, ...args) { return command(cwd, process.execPath, [cli, ...args]) }
function good(result) { assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'roadmap-native-cli-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.name', 'Fixture')
  git(repo, 'config', 'user.email', 'fixture@example.invalid')
  git(repo, 'commit', '--allow-empty', '-qm', 'fixture')
  return { root, repo }
}
function snapshot(dir) {
  const files = {}
  function walk(at, prefix = '') {
    for (const item of readdirSync(at, { withFileTypes: true })) {
      if (item.name === '.git') continue
      const name = prefix + item.name
      if (item.isDirectory()) walk(join(at, item.name), name + '/')
      else files[name] = readFileSync(join(at, item.name), 'base64')
    }
  }
  walk(dir)
  return files
}
function concurrent(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timeout = setTimeout(() => { child.kill('SIGKILL') }, 15000)
    child.on('error', reject)
    child.on('close', status => { clearTimeout(timeout); resolve({ status, stdout, stderr }) })
  })
}

test('init copies only five typed files, preserves package policy, and is repeatable', t => {
  const { repo } = fixture(t)
  const packageSource = '{"name":"consumer","scripts":{"test":"existing test"}}\n'
  writeFileSync(join(repo, 'package.json'), packageSource)
  writeFileSync(join(repo, 'AGENTS.md'), 'Existing instructions\n')
  good(run(repo, 'init'))
  assert.deepEqual(Object.keys(snapshot(join(repo, 'roadmap'))).sort(), [
    'backlog.ts', 'examples/example.arc.ts', 'lib/emit.ts', 'lib/registry.ts', 'lib/schema.ts',
  ])
  writeFileSync(join(repo, 'roadmap', 'backlog.ts'), '// consumer customization\n')
  const before = snapshot(repo)
  good(run(repo, 'init'))
  assert.deepEqual(snapshot(repo), before)
  assert.equal(readFileSync(join(repo, 'package.json'), 'utf8'), packageSource)
  assert.equal(existsSync(join(repo, 'roadmap', 'roadmap.config.json')), false)
  assert.equal(existsSync(join(repo, 'scripts')), false)
})

test('nested invocation discovers docs/roadmap and does not create another root', t => {
  const { repo } = fixture(t)
  good(run(repo, 'init', '--root', 'docs/roadmap'))
  const nested = join(repo, 'src', 'nested')
  mkdirSync(nested, { recursive: true })
  good(run(nested, 'init'))
  assert.equal(existsSync(join(repo, 'roadmap')), false)
  assert.equal(existsSync(join(nested, 'roadmap')), false)
  const number = Number(good(run(nested, 'claim')).trim())
  assert.equal(number, 1)
})

test('init refuses external roots and removed config option without touching consumer files', t => {
  const { repo, root } = fixture(t)
  const before = snapshot(repo)
  assert.notEqual(run(repo, 'init', '--root', '../outside').status, 0)
  assert.notEqual(run(repo, 'init', '--config', 'anything.json').status, 0)
  assert.deepEqual(snapshot(repo), before)
  assert.equal(existsSync(join(root, 'outside')), false)
})

test('init refuses symlinked destination components before writing any templates', t => {
  const { repo, root } = fixture(t)
  const outside = join(root, 'outside')
  mkdirSync(outside)
  mkdirSync(join(repo, 'roadmap'))
  symlinkSync(outside, join(repo, 'roadmap', 'lib'), 'dir')
  assert.notEqual(run(repo, 'init').status, 0)
  assert.deepEqual(readdirSync(outside), [])
  assert.deepEqual(readdirSync(join(repo, 'roadmap')), ['lib'])
})

function sibling(repo, root) {
  const path = join(root, 'sibling')
  git(repo, 'worktree', 'add', '-qb', 'sibling', path)
  mkdirSync(join(path, 'roadmap', 'phases'), { recursive: true })
  return path
}

test('parallel number reservations are unique across Git worktrees and stay permanent', async t => {
  const { repo, root } = fixture(t)
  mkdirSync(join(repo, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(repo, 'roadmap', 'phases', 'existing.phase.ts'), 'export const phase = { phase: 40 }\n')
  const other = sibling(repo, root)
  // Reserve above declared phase before the sibling starts; no remote/network access.
  const first = Number(good(run(repo, 'claim')).trim())
  assert.equal(first, 41)
  const configured = Number(process.env.TEST_CONCURRENCY || 4)
  const jobs = Number.isInteger(configured) && configured > 0 ? Math.min(4, configured) : 1
  const results = await Promise.all(Array.from({ length: jobs }, (_, i) => concurrent(i % 2 ? other : repo, ['claim', '--count', '2'])))
  const numbers = results.flatMap(result => good(result).trim().split('\n').map(Number))
  assert.equal(new Set(numbers).size, jobs * 2)
  assert.ok(numbers.every(number => number > first))
  assert.equal(Number(good(run(other, 'claim')).trim()), Math.max(...numbers) + 1)
})

test('work ownership resumes for its owner and refuses foreign acquire/release across worktrees', t => {
  const { repo, root } = fixture(t)
  mkdirSync(join(repo, 'roadmap', 'phases'), { recursive: true })
  const other = sibling(repo, root)
  const initial = JSON.parse(good(run(repo, 'claim', '--work', 'ARC', '--owner', 'session-a')))
  const resumed = JSON.parse(good(run(other, 'claim', '--work', 'ARC', '--owner', 'session-a')))
  assert.deepEqual(resumed, initial)
  assert.notEqual(run(other, 'claim', '--work', 'ARC', '--owner', 'session-b').status, 0)
  assert.notEqual(run(other, 'claim', '--work', 'ARC', '--owner', 'session-b', '--release').status, 0)
  good(run(repo, 'claim', '--work', 'ARC', '--owner', 'session-a', '--release'))
  const next = JSON.parse(good(run(other, 'claim', '--work', 'ARC', '--owner', 'session-b')))
  assert.equal(next.owner, 'session-b')
  // A delayed old owner must not delete the new claim.
  assert.notEqual(run(repo, 'claim', '--work', 'ARC', '--owner', 'session-a', '--release').status, 0)
  assert.deepEqual(JSON.parse(good(run(other, 'claim', '--work', 'ARC', '--owner', 'session-b'))), next)
})

test('held ownership mutation lock blocks acquire and release without automatic reclaim', t => {
  const { repo, root } = fixture(t)
  mkdirSync(join(repo, 'roadmap', 'phases'), { recursive: true })
  const other = sibling(repo, root)
  good(run(repo, 'claim', '--work', 'ARC', '--owner', 'session-a'))
  const dir = join(repo, '.git', 'zeroh-roadmap-work-claims')
  const path = join(dir, 'ARC.json')
  const bytes = readFileSync(path, 'utf8')
  const lock = join(dir, 'ARC.lock')
  mkdirSync(lock)
  assert.notEqual(run(other, 'claim', '--work', 'ARC', '--owner', 'session-a', '--release').status, 0)
  assert.notEqual(run(other, 'claim', '--work', 'ARC', '--owner', 'session-b').status, 0)
  assert.equal(readFileSync(path, 'utf8'), bytes)
  assert.equal(existsSync(lock), true)
  rmSync(lock, { recursive: true }) // explicit fixture operator repair
  good(run(other, 'claim', '--work', 'ARC', '--owner', 'session-a', '--release'))
  assert.equal(existsSync(path), false)
})
