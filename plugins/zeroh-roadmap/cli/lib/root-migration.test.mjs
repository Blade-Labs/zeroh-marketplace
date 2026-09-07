#!/usr/bin/env node
/** TEST-FIRST: atomic migration of the discovered legacy roadmap root and schema owner. */
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { makeFixtureRepo, commitAll, git, runCli, writeArcFile, writePhaseFile } from '../../test/fixture-consumer/harness.mjs'
import { planRootMigration, applyRootMigration, RootMigrationError } from './root-migration.mjs'

const bytes = (path) => readFileSync(path)
function walk(root, dir = root, out = new Map()) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.building') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(root, path, out)
    else if (entry.isFile()) out.set(relative(root, path), bytes(path).toString('base64'))
  }
  return out
}
function fixture() {
  const root = makeFixtureRepo()
  writeArcFile(root, { id: 'MIGRATE', baseRef: 'develop', planes: [{ name: 'P', phases: [3901] }] })
  writePhaseFile(root, {
    phase: 3901, status: 'backlog', name: 'Migration fixture', category: 'test', kind: 'logic', source: 'fixture-consumer', priority: 'LOW',
    dependsOn: [], conflictsWith: [], keyFiles: [], stakeholderDemo: 'the root migration preserves a valid typed phase',
    tasks: [{ minimal: true, id: '3901.1', title: 'migrate fixture', done: false }],
  }, { kind: 'define' })
  writeFileSync(join(root, 'roadmap', 'historical-notes.md'), 'historical prose stays byte-identical\n')
  writeFileSync(join(root, 'roadmap', 'historical-artifact.bin'), Buffer.from([0, 255, 128, 13, 10, 65]))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'scripts/nativegreen-review-regressions.test.mjs'), "const mutation = text.replaceAll('docs/roadmap/', 'roadmap/')\n")
  writeFileSync(join(root, 'scripts/check-roadmap-imports.mjs'), "const legacy = 'lib/roadmap/schema'\n")
  commitAll(root, 'seed migration source')
  const validation = runCli(root, ['phase', 'validate', '3901', '--json'])
  assert.equal(validation.code, 0, 'fixture phase must parse before migration: ' + validation.stderr)
  assert.equal(validation.json?.kind, 'ok')
  writeFileSync(join(root, 'roadmap', '.arc-mode'), 'NATIVEGREEN\n')
  mkdirSync(join(root, 'roadmap', '.gate', '39'), { recursive: true })
  writeFileSync(join(root, 'roadmap', '.gate', '39', 'run.json'), '{\"status\":\"green\"}\n')
  writeFileSync(join(root, 'unrelated-untracked.txt'), 'outside dirt\n')
  writeFileSync(join(root, 'src', 'plain.ts'), 'export const unrelatedDirty = true\n')
  return root
}
const expectRootError = (fn) => assert.throws(fn, (error) => error instanceof RootMigrationError && typeof error.kind === 'string')

test('plan is canonical and mutation-free; apply moves one complete root and schema, writes a receipt, and preserves unrelated dirt', () => {
  const root = fixture()
  const before = walk(root)
  const planned = planRootMigration(root)
  assert.equal(planned.status, 'planned')
  assert.deepEqual(walk(root), before)
  assert.equal(planned.plan.sourceRoot, 'roadmap')
  assert.equal(planned.plan.destinationRoot, 'docs/roadmap')
  assert.equal(planned.plan.sourceSchemaDir, 'lib/roadmap')
  assert.equal(planned.plan.destinationSchemaDir, 'docs/roadmap/lib')
  assert.equal(planned.plan.renames.length, 2)
  assert.match(planned.plan.planDigest, /^[a-f0-9]{64}$/)
  const applied = applyRootMigration(planned.plan, { cwd: root })
  assert.equal(applied.status, 'applied')
  assert.ok(existsSync(applied.receiptPath))
  assert.ok(existsSync(join(root, 'docs', 'roadmap', 'roadmap.config.json')))
  assert.ok(existsSync(join(root, 'docs', 'roadmap', 'lib', 'schema.ts')))
  assert.equal(existsSync(join(root, 'roadmap')), false)
  assert.equal(existsSync(join(root, 'lib', 'roadmap')), false)
  for (const path of ['scripts/nativegreen-review-regressions.test.mjs', 'scripts/check-roadmap-imports.mjs']) {
    assert.equal(bytes(join(root, path)).toString('base64'), before.get(path), 'migration must preserve negative test oracles: ' + path)
  }
  assert.deepEqual(bytes(join(root, 'docs', 'roadmap', 'historical-notes.md')), Buffer.from('historical prose stays byte-identical\n'))
  assert.deepEqual(bytes(join(root, 'docs', 'roadmap', 'historical-artifact.bin')), Buffer.from([0, 255, 128, 13, 10, 65]))
  assert.deepEqual(bytes(join(root, 'docs', 'roadmap', '.arc-mode')), Buffer.from('NATIVEGREEN\n'))
  assert.deepEqual(bytes(join(root, 'docs', 'roadmap', '.gate', '39', 'run.json')), Buffer.from('{\"status\":\"green\"}\n'))
  assert.deepEqual(bytes(join(root, 'unrelated-untracked.txt')), Buffer.from('outside dirt\n'))
})

test('a failure after every directory rename restores the byte-identical source and leaves no destination', () => {
  const probeRoot = fixture()
  const count = planRootMigration(probeRoot).plan.renames.length
  for (let boundary = 0; boundary < count; boundary++) {
    const root = fixture()
    const before = walk(root)
    const plan = planRootMigration(root).plan
    assert.throws(() => applyRootMigration(plan, { cwd: root, afterRename({ index }) { if (index === boundary) throw new Error('fault-' + boundary) } }), /fault-|apply/i)
    assert.deepEqual(walk(root), before, 'rename boundary ' + boundary)
    assert.equal(existsSync(join(root, 'docs', 'roadmap')), false)
  }
})

test('failures after every rewrite and after post-validation restore the byte-identical source', () => {
  const probeRoot = fixture()
  const rewriteCount = planRootMigration(probeRoot).plan.rewrites.length
  assert.ok(rewriteCount > 0)
  for (let boundary = 0; boundary < rewriteCount; boundary++) {
    const root = fixture(); const before = walk(root); const plan = planRootMigration(root).plan
    assert.throws(() => applyRootMigration(plan, { cwd: root, afterRewrite({ index }) { if (index === boundary) throw new Error('rewrite-fault-' + boundary) } }), /rewrite-fault-|apply/i)
    assert.deepEqual(walk(root), before, 'rewrite boundary ' + boundary)
  }
  const root = fixture(); const before = walk(root); const plan = planRootMigration(root).plan
  assert.throws(() => applyRootMigration(plan, { cwd: root, validate() { throw new Error('post-validation-fault') } }), /post-validation-fault|apply/i)
  assert.deepEqual(walk(root), before)
})

test('dirt inside migration paths and incomplete or unsafe layouts refuse before the first rename', () => {
  const cases = [
    ['tracked dirt', (root) => writeFileSync(join(root, 'roadmap', 'historical-notes.md'), 'dirty\n')],
    ['untracked dirt', (root) => writeFileSync(join(root, 'roadmap', 'untracked.txt'), 'dirty\n')],
    ['partial destination', (root) => { mkdirSync(join(root, 'docs', 'roadmap'), { recursive: true }); writeFileSync(join(root, 'docs', 'roadmap', 'partial'), 'x') }],
    ['destination present', (root) => { mkdirSync(join(root, 'docs', 'roadmap'), { recursive: true }); writeFileSync(join(root, 'docs', 'roadmap', 'roadmap.config.json'), '{}\n') }],
    ['missing schema', (root) => git(root, 'rm', '-q', '-r', 'lib/roadmap')],
    ['dual roots', (root) => { mkdirSync(join(root, 'docs', 'roadmap', 'phases'), { recursive: true }); writeFileSync(join(root, 'docs', 'roadmap', 'roadmap.config.json'), '{}\n') }],
    ['symlink escape', (root) => { mkdirSync(join(root, 'docs'), { recursive: true }); symlinkSync('/tmp', join(root, 'docs', 'roadmap')) }],
  ]
  for (const [name, arrange] of cases) {
    const root = fixture(); arrange(root)
    const before = walk(root); let renames = 0
    expectRootError(() => { const result = planRootMigration(root, {}, { afterRename() { renames++ } }); if (result?.plan) applyRootMigration(result.plan, { cwd: root, afterRename() { renames++ } }) })
    assert.equal(renames, 0, name)
    assert.deepEqual(walk(root), before, name)
  }
})

test('a legacy unbound incomplete intent refuses before mutation instead of being adopted', () => {
  const root = fixture()
  const plan = planRootMigration(root).plan
  const dir = join(root, '.building', 'root-migrations')
  mkdirSync(dir, { recursive: true })
  const intent = join(dir, plan.planDigest + '.intent.json')
  writeFileSync(intent, JSON.stringify({ version: 1, plan }, null, 2) + '\n')
  const before = walk(root)
  expectRootError(() => planRootMigration(root))
  assert.deepEqual(walk(root), before)
  assert.ok(lstatSync(intent).isFile())
})


const waitForLine = (stream) => new Promise((resolve, reject) => {
  let text = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => { text += chunk; if (text.includes('\n')) resolve(text) })
  stream.on('error', reject)
})
const waitForExit = (child) => new Promise((resolve) => child.once('exit', resolve))

test('the kernel migration lock refuses a concurrent apply before intent or manifest mutation, then succeeds after owner release', async (t) => {
  const root = fixture()
  const plan = planRootMigration(root).plan
  const records = join(root, '.building', 'root-migrations')
  mkdirSync(records, { recursive: true })
  const lock = join(records, 'apply.lock')
  const holder = spawn('flock', ['--exclusive', lock, 'sh', '-c', 'echo READY; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => { if (!holder.killed) holder.kill() })
  assert.match(await waitForLine(holder.stdout), /READY/)
  const before = walk(root)
  assert.throws(() => applyRootMigration(plan, { cwd: root }), (error) => error instanceof RootMigrationError && error.kind === 'migration-busy')
  assert.deepEqual(walk(root), before)
  assert.deepEqual(readdirSync(records).sort(), ['apply.lock'])
  holder.stdin.end()
  assert.equal(await waitForExit(holder), 0)
  assert.equal(applyRootMigration(plan, { cwd: root }).status, 'applied')
})

test('an unavailable flock binary is a typed pre-intent refusal while real Git remains available', () => {
  const root = fixture()
  const plan = planRootMigration(root).plan
  const fakeBin = join(root, 'git-only-bin')
  mkdirSync(fakeBin)
  const gitBin = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
  symlinkSync(gitBin, join(fakeBin, 'git'))
  const previous = process.env.PATH
  process.env.PATH = fakeBin
  try {
    assert.throws(() => applyRootMigration(plan, { cwd: root }), (error) => error instanceof RootMigrationError && error.kind === 'lock-unavailable')
  } finally {
    process.env.PATH = previous
  }
  const records = join(root, '.building', 'root-migrations')
  assert.ok(!existsSync(records) || readdirSync(records).every((name) => name === 'apply.lock'))
  assert.ok(existsSync(join(root, 'roadmap', 'roadmap.config.json')))
  assert.equal(existsSync(join(root, 'docs', 'roadmap')), false)
})

test('a completed layout remains already-applied after legitimate post-migration commits', () => {
  const root = fixture()
  const original = planRootMigration(root).plan
  assert.equal(applyRootMigration(original, { cwd: root }).status, 'applied')
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'refactor(roadmap): phase 39 — migrate root')
  writeFileSync(join(root, 'docs', 'roadmap', 'historical-notes.md'), 'legitimate post-migration edit\n')
  git(root, 'add', 'docs/roadmap/historical-notes.md'); git(root, 'commit', '-q', '-m', 'docs: update migrated roadmap prose')
  const recognized = planRootMigration(root)
  assert.equal(recognized.status, 'already-applied')
  assert.equal(recognized.plan.planDigest, original.planDigest)
  assert.ok(existsSync(recognized.receiptPath))
  assert.deepEqual(bytes(join(root, 'docs', 'roadmap', 'historical-notes.md')), Buffer.from('legitimate post-migration edit\n'))
})

test('one-commit Git revert with untracked runtime leftovers reapplies to the exact migrated tracked tree', () => {
  const root = fixture()
  const original = planRootMigration(root).plan
  assert.equal(applyRootMigration(original, { cwd: root }).status, 'applied')
  git(root, 'add', '-A', '--', 'roadmap', 'lib', 'docs', 'scripts')
  git(root, 'reset', '-q', '--', 'docs/roadmap/.arc-mode', 'docs/roadmap/.gate')
  git(root, 'commit', '-q', '-m', 'refactor(roadmap): phase 39 — migrate root')
  const migrationCommit = git(root, 'rev-parse', 'HEAD')
  const migratedTree = git(root, 'rev-parse', migrationCommit + '^{tree}')
  const arcMode = bytes(join(root, 'docs', 'roadmap', '.arc-mode'))
  const gate = bytes(join(root, 'docs', 'roadmap', '.gate', '39', 'run.json'))

  git(root, 'revert', '--no-edit', migrationCommit)
  assert.ok(existsSync(join(root, 'roadmap', 'roadmap.config.json')))
  assert.ok(existsSync(join(root, 'docs', 'roadmap', '.arc-mode')), 'runtime state remains after tracked revert')
  const replanned = planRootMigration(root)
  assert.equal(replanned.status, 'planned')
  assert.equal(applyRootMigration(replanned.plan, { cwd: root }).status, 'applied')
  assert.deepEqual(bytes(join(root, 'docs', 'roadmap', '.arc-mode')), arcMode)
  assert.deepEqual(bytes(join(root, 'docs', 'roadmap', '.gate', '39', 'run.json')), gate)
  git(root, 'add', '-A', '--', 'roadmap', 'lib', 'docs', 'scripts')
  git(root, 'reset', '-q', '--', 'docs/roadmap/.arc-mode', 'docs/roadmap/.gate')
  assert.equal(git(root, 'write-tree'), migratedTree)
  assert.deepEqual(bytes(join(root, 'unrelated-untracked.txt')), Buffer.from('outside dirt\n'))
})

test('a copied legacy consumer schema beside the completed root is refused as a duplicate owner', () => {
  const root = fixture(); const plan = planRootMigration(root).plan
  assert.equal(applyRootMigration(plan, { cwd: root }).status, 'applied')
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  writeFileSync(join(root, 'lib', 'roadmap', 'schema.ts'), bytes(join(root, 'docs', 'roadmap', 'lib', 'schema.ts')))
  const before = walk(root)
  expectRootError(() => planRootMigration(root))
  assert.deepEqual(walk(root), before)
})

test('malformed and foreign bound incomplete intents remain typed refusals and byte-intact', () => {
  for (const mode of ['malformed', 'foreign']) {
    const root = fixture(); const plan = planRootMigration(root).plan
    assert.throws(() => applyRootMigration(plan, { cwd: root, afterRename() { throw new Error('seed interrupted intent') } }))
    const intent = join(root, '.building', 'root-migrations', plan.planDigest + '.intent.json')
    const stored = JSON.parse(bytes(intent).toString('utf8'))
    const hostile = mode === 'malformed' ? Buffer.from('{bad json\n') : Buffer.from(JSON.stringify({ ...stored, worktree: root + '-foreign' }, null, 2) + '\n')
    writeFileSync(intent, hostile)
    expectRootError(() => planRootMigration(root))
    assert.deepEqual(bytes(intent), hostile, mode)
    assert.ok(existsSync(join(root, 'roadmap', 'roadmap.config.json')), mode)
  }
})

function revertedRuntimeFixture() {
  const root = fixture()
  const initial = planRootMigration(root).plan
  assert.equal(applyRootMigration(initial, { cwd: root }).status, 'applied')
  git(root, 'add', '-A', '--', 'roadmap', 'lib', 'docs', 'scripts')
  git(root, 'reset', '-q', '--', 'docs/roadmap/.arc-mode', 'docs/roadmap/.gate')
  git(root, 'commit', '-q', '-m', 'refactor(roadmap): phase 39 — migrate root')
  const migrationCommit = git(root, 'rev-parse', 'HEAD')
  git(root, 'revert', '--no-edit', migrationCommit)
  assert.ok(existsSync(join(root, 'roadmap', 'roadmap.config.json')))
  assert.ok(existsSync(join(root, 'docs', 'roadmap', '.arc-mode')))
  assert.deepEqual(readdirSync(join(root, 'docs', 'roadmap')).sort(), ['.arc-mode', '.gate'])
  return { root, plan: planRootMigration(root).plan }
}

test('runtime parking, first restore, and cleanup callback failures restore the preapply source and runtime bytes', () => {
  for (const [name, dependency] of [
    ['rename-0', { afterRename({ index }) { if (index === 0) throw new Error('rename-0-fault') } }],
    ['rename-1', { afterRename({ index }) { if (index === 1) throw new Error('rename-1-fault') } }],
    ['rewrite-0', { afterRewrite({ index }) { if (index === 0) throw new Error('rewrite-0-fault') } }],
    ['park', { afterRuntimePark() { throw new Error('runtime-park-fault') } }],
    ['restore', { afterRuntimeRestore({ index }) { if (index === 0) throw new Error('runtime-restore-fault') } }],
    ['cleanup', { afterRuntimeCleanup() { throw new Error('runtime-cleanup-fault') } }],
  ]) {
    const { root, plan } = revertedRuntimeFixture(); const before = walk(root)
    assert.throws(() => applyRootMigration(plan, { cwd: root, ...dependency }), /fault|apply/i, name)
    assert.deepEqual(walk(root), before, name)
  }
})

test('process exit after runtime park or partial restore resumes once with one completion receipt', () => {
  for (const callback of ['park', 'restore']) {
    const { root, plan } = revertedRuntimeFixture()
    const modulePath = new URL('./root-migration.mjs', import.meta.url).href
    const hook = callback === 'park' ? 'afterRuntimePark(){process.exit(73)}' : 'afterRuntimeRestore({index}){if(index===0)process.exit(73)}'
    const script = `import {applyRootMigration} from ${JSON.stringify(modulePath)}; applyRootMigration(JSON.parse(process.argv[1]),{cwd:process.argv[2],${hook}})`
    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(plan), root], { encoding: 'utf8' })
    assert.equal(crashed.status, 73, callback)
    const interrupted = planRootMigration(root)
    assert.equal(interrupted.status, 'interrupted', callback)
    assert.equal(applyRootMigration(interrupted.plan, { cwd: root }).status, 'applied', callback)
    const records = readdirSync(join(root, '.building', 'root-migrations')).filter((name) => name === interrupted.plan.planDigest + '.receipt.json')
    assert.equal(records.length, 1, callback)
  }
})

test('foreign destination files and conflicting source runtime refuse without changing either tree', () => {
  for (const mode of ['foreign-destination', 'runtime-collision']) {
    const { root } = revertedRuntimeFixture()
    if (mode === 'foreign-destination') writeFileSync(join(root, 'docs', 'roadmap', 'foreign.txt'), 'foreign\n')
    else writeFileSync(join(root, 'roadmap', '.arc-mode'), 'conflicting source runtime\n')
    const before = walk(root)
    expectRootError(() => planRootMigration(root))
    assert.deepEqual(walk(root), before, mode)
  }
})

const planHash = (plan) => {
  const { planDigest: _discard, ...body } = plan
  return createHash('sha256').update(JSON.stringify(body) + '\n').digest('hex')
}
function corruptCompletedPlan(mutator, { recompute = true } = {}) {
  const root = fixture(); const plan = planRootMigration(root).plan
  assert.equal(applyRootMigration(plan, { cwd: root }).status, 'applied')
  const dir = join(root, '.building', 'root-migrations')
  const oldIntent = join(dir, plan.planDigest + '.intent.json'); const oldReceipt = join(dir, plan.planDigest + '.receipt.json')
  const intent = JSON.parse(bytes(oldIntent).toString('utf8')); const receipt = JSON.parse(bytes(oldReceipt).toString('utf8'))
  mutator(intent.plan)
  if (recompute) intent.plan.planDigest = planHash(intent.plan)
  const digest = intent.plan.planDigest
  receipt.planDigest = digest
  const nextIntent = join(dir, digest + '.intent.json'); const nextReceipt = join(dir, digest + '.receipt.json')
  rmSync(oldIntent); rmSync(oldReceipt)
  writeFileSync(nextIntent, JSON.stringify(intent) + '\n'); writeFileSync(nextReceipt, JSON.stringify(receipt) + '\n')
  return { root, intent: nextIntent, receipt: nextReceipt }
}

test('stored completed plans refuse hash, Git manifest, rewrite-byte, and unsafe mapping corruption without changing current files', () => {
  const cases = [
    ['hash', (plan) => { plan.head = 'f'.repeat(40) }, { recompute: false }],
    ['manifest-blob', (plan) => { plan.trackedManifest[0].blob = '0'.repeat(40) }],
    ['manifest-mode', (plan) => { plan.trackedManifest[0].mode = '100755' }],
    ['rewrite-before', (plan) => { const bytes = Buffer.from('not the Git blob'); plan.rewrites[0].beforeBytes = bytes.toString('base64'); plan.rewrites[0].beforeDigest = createHash('sha256').update(bytes).digest('hex') }],
    ['unsafe-rename', (plan) => { plan.renames[0].to = '../escape' }],
  ]
  for (const [name, mutate, options] of cases) {
    const { root, intent, receipt } = corruptCompletedPlan(mutate, options)
    const before = walk(root); const intentBytes = bytes(intent); const receiptBytes = bytes(receipt)
    expectRootError(() => planRootMigration(root))
    assert.deepEqual(walk(root), before, name)
    assert.deepEqual(bytes(intent), intentBytes, name + ' intent')
    assert.deepEqual(bytes(receipt), receiptBytes, name + ' receipt')
  }
})

function completedMigrationWithNormalizedHistory({ rescue = 'matching' } = {}) {
  const root = fixture(); const plan = planRootMigration(root).plan; const applied = applyRootMigration(plan, { cwd: root })
  git(root, 'add', '-A', '--', 'roadmap', 'lib', 'docs', 'scripts')
  git(root, 'reset', '-q', '--', 'docs/roadmap/.arc-mode', 'docs/roadmap/.gate')
  git(root, 'commit', '-q', '-m', 'refactor(roadmap): phase 39 — migrate root')
  const oldTip = git(root, 'rev-parse', 'HEAD'); const currentTree = git(root, 'rev-parse', 'HEAD^{tree}')
  if (rescue === 'matching') git(root, 'update-ref', `refs/curate-rescue/${oldTip.slice(0, 12)}`, oldTip)
  if (rescue === 'unrelated') {
    writeFileSync(join(root, 'unrelated-rescue.txt'), 'different tree\n'); git(root, 'add', 'unrelated-rescue.txt')
    const unrelated = git(root, 'commit-tree', git(root, 'write-tree'), '-p', oldTip, '-m', 'unrelated rescue')
    assert.equal(spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', plan.head, unrelated]).status, 0)
    assert.notEqual(git(root, 'rev-parse', unrelated + '^{tree}'), currentTree)
    git(root, 'reset', '-q', 'unrelated-rescue.txt'); rmSync(join(root, 'unrelated-rescue.txt'))
    git(root, 'update-ref', `refs/curate-rescue/${unrelated.slice(0, 12)}`, unrelated)
  }
  const normalized = git(root, 'commit-tree', currentTree, '-m', 'normalized curated history')
  git(root, 'update-ref', 'refs/heads/develop', normalized, oldTip)
  assert.equal(spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', plan.head, normalized]).status, 1)
  return { root, plan, applied }
}

test('tree-identical curated history recognizes the original completed migration through its rescue ref', () => {
  const { root, plan, applied } = completedMigrationWithNormalizedHistory({ rescue: 'matching' })
  writeFileSync(join(root, 'later.txt'), 'later commit\n'); git(root, 'add', 'later.txt'); git(root, 'commit', '-q', '-m', 'chore: later commit')
  const before = walk(root); const recognized = planRootMigration(root)
  assert.equal(recognized.status, 'already-applied')
  assert.equal(recognized.plan.planDigest, plan.planDigest)
  assert.equal(recognized.receiptPath, applied.receiptPath)
  assert.equal(applyRootMigration(recognized.plan, { cwd: root }).status, 'already-applied')
  assert.deepEqual(walk(root), before)
  assert.equal(readdirSync(join(root, '.building', 'root-migrations')).filter((name) => name.endsWith('.receipt.json')).length, 1)
})

test('completed migration history without a matching curate rescue bridge remains a typed refusal', () => {
  for (const rescue of ['missing', 'unrelated']) {
    const { root } = completedMigrationWithNormalizedHistory({ rescue }); const before = walk(root)
    expectRootError(() => planRootMigration(root)); assert.deepEqual(walk(root), before, rescue)
  }
})

test('two successive curated histories resolve completed migration ownership through the finite rescue closure', () => {
  for (const keepIntermediate of [true, false]) {
    const { root, plan } = completedMigrationWithNormalizedHistory({ rescue: 'matching' })
    const firstRescue = git(root, 'for-each-ref', '--format=%(refname)', 'refs/curate-rescue')
    writeFileSync(join(root, 'curation-metadata.txt'), 'second curation metadata\n')
    git(root, 'add', 'curation-metadata.txt'); git(root, 'commit', '-q', '-m', 'docs: curation metadata')
    const secondOldTip = git(root, 'rev-parse', 'HEAD'); const secondTree = git(root, 'rev-parse', 'HEAD^{tree}')
    git(root, 'update-ref', `refs/curate-rescue/${secondOldTip.slice(0, 12)}`, secondOldTip)
    const secondNormalized = git(root, 'commit-tree', secondTree, '-m', 'second normalized curated history')
    git(root, 'update-ref', 'refs/heads/develop', secondNormalized, secondOldTip)
    if (!keepIntermediate) git(root, 'update-ref', '-d', firstRescue)
    assert.equal(spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', plan.head, secondNormalized]).status, 1)
    if (keepIntermediate) {
      const recognized = planRootMigration(root)
      assert.equal(recognized.status, 'already-applied')
      assert.equal(recognized.plan.planDigest, plan.planDigest)
    } else {
      expectRootError(() => planRootMigration(root))
    }
  }
})
