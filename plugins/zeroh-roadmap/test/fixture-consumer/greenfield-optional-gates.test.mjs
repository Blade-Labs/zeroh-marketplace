import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import {
  CORE_GATES,
  ROOT,
  sha256,
  validateOptionalGateBindings,
  validateOptionalGateEvidence,
} from './greenfield-native-evidence.mjs'

// Synthetic protocol fixtures only. These records are never native-run claims.
const OPTIONAL = ['unit-scoped', 'unit-affected', 'unit-impacted']
const TEMPLATES = {
  'unit-scoped': "node scripts/run-nx-test-tier.mjs '{manifest}'",
  'unit-affected': "node scripts/run-nx-test-tier.mjs '{manifest}'",
  'unit-impacted': "node scripts/run-nx-test-tier.mjs '{range}'",
}
const roots = []
process.on('exit', () => roots.forEach((root) => rmSync(root, { recursive: true, force: true })))

function bindingFixture() {
  const gates = Object.fromEntries(CORE_GATES.map((slot) => [slot, slot === 'unit' ? 'npm test' : 'none']))
  const proposal = {
    gates,
    optionalGates: { ...TEMPLATES },
    optionalGateRuns: {},
    delivery: { adapter: 'nx-monorepo' },
  }
  return { proposal, config: { gateCommands: { ...gates, ...TEMPLATES } } }
}

test('Nx proposal and config bind the required seven gates plus all three optional unit selectors', () => {
  const { proposal, config } = bindingFixture()
  assert.deepEqual(validateOptionalGateBindings(proposal, config), { ...proposal.gates, ...proposal.optionalGates })
})

test('optional binding rejects omissions, unknown keys, config drift, and incomplete Nx selector coverage', () => {
  const mutations = [
    ({ proposal }) => { delete proposal.gates.unit },
    ({ proposal }) => { proposal.gates.unknown = 'npm run unknown' },
    ({ proposal }) => { delete proposal.optionalGates['unit-scoped'] },
    ({ proposal }) => { proposal.optionalGates.unknown = 'npm run unknown' },
    ({ proposal }) => { proposal.optionalGates['unit-affected'] = 'none' },
    ({ config }) => { delete config.gateCommands['unit-impacted'] },
    ({ config }) => { config.gateCommands['unit-scoped'] = 'npm test' },
    ({ config }) => { config.gateCommands.unknown = 'npm run unknown' },
  ]
  for (const mutate of mutations) {
    const fixture = bindingFixture()
    mutate(fixture)
    assert.throws(() => validateOptionalGateBindings(fixture.proposal, fixture.config), { name: 'AssertionError' })
  }
})

function evidenceFixture(t, slot) {
  const scratch = mkdtempSync(join(tmpdir(), 'greenfield-optional-gate-'))
  roots.push(scratch)
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const isRange = slot === 'unit-impacted'
  const relativeManifest = '.zeroh/evidence/scope.json'
  const manifest = join(scratch, relativeManifest)
  const manifestBytes = JSON.stringify({ protocol: 'scope-manifest-json-v1', paths: slot === 'unit-scoped' ? ['packages/a/src/a.test.ts', 'packages/b/src/b.spec.ts'] : ['packages/a/src/a.ts', 'packages/b/src/b.test.ts'] })
  mkdirSync(dirname(manifest), { recursive: true })
  writeFileSync(manifest, manifestBytes)
  const range = `${'1'.repeat(40)}..${'2'.repeat(40)}`
  const substitutions = isRange ? { range } : { manifest: `@${manifest}` }
  const replacement = isRange ? range : substitutions.manifest
  const configuredCommand = TEMPLATES[slot]
  const actual = configuredCommand.replace(isRange ? '{range}' : '{manifest}', replacement)
  const selector = { tier: slot === 'unit-scoped' ? 'scoped' : 'affected' }
  const selectorCall = { id: `call-${slot}`, command: `cd '${scratch}' && ${actual}`, exitCode: 0, output: `${JSON.stringify(selector)}\n` }
  const commands = isRange ? [
    { id: 'call-head', command: `cd '${scratch}' && git rev-parse HEAD`, exitCode: 0, output: `${'2'.repeat(40)}\n` },
    { id: 'call-ancestor', command: `cd "${scratch}" && git merge-base --is-ancestor ${'1'.repeat(40)} ${'2'.repeat(40)}`, exitCode: 0, output: '' },
    { id: 'call-diff', command: `cd '${scratch}' && git diff --name-only -z ${range}`, exitCode: 0, output: 'packages/a/src/a.ts\0packages/b/src/b.test.ts\0' },
    selectorCall,
  ] : [selectorCall]
  const selectorSha256 = sha256(readFileSync(join(ROOT, 'plugins/zeroh-greenfield/templates/scripts/run-nx-test-tier.mjs')))
  const after = isRange ? {
    'packages/a/src/a.ts': { sha256: sha256('source'), mode: 33188 },
    'packages/b/src/b.test.ts': { sha256: sha256('test'), mode: 33188 },
  } : {
    [relativeManifest]: { sha256: sha256(manifestBytes), mode: 33188 },
    ...Object.fromEntries(JSON.parse(manifestBytes).paths.map((path) => [path, { sha256: sha256(path), mode: 33188 }])),
  }
  after['scripts/run-nx-test-tier.mjs'] = { sha256: selectorSha256, mode: 33188 }
  const arm = { scratchRoot: scratch, optionalInputs: {} }
  if (!isRange) arm.optionalInputs[slot] = { path: manifest, sha256: sha256(manifestBytes) }
  const proposal = { optionalGates: { [slot]: configuredCommand }, optionalGateRuns: { [slot]: { substitutions, inputSha256: sha256(isRange ? range : manifestBytes) } } }
  const evidence = { slot, command: configuredCommand, configuredCommand, executedCommand: actual, substitutions, inputSha256: proposal.optionalGateRuns[slot].inputSha256, cwd: scratch, toolCallId: selectorCall.id, nativeCommand: selectorCall.command, exitCode: 0, wrapper: null }
  return { arm, proposal, slot, configuredCommand, after, commands, evidence, manifest, manifestBytes, range, relativeManifest }
}

for (const slot of OPTIONAL) test(`${slot} evidence binds its exact input, native command, and selector tier`, (t) => {
  const fixture = evidenceFixture(t, slot)
  assert.doesNotThrow(() => validateOptionalGateEvidence(fixture))
})
test('optional selector evidence preserves its portable template through a synthetic capbuild wrapper', (t) => {
  const fixture = evidenceFixture(t, 'unit-scoped')
  const bytes = Buffer.from('synthetic optional selector wrapper')
  const wrapper = { kind: 'capbuild', executable: '/home/patrik/.local/bin/capbuild', realpath: '/home/patrik/illumination_VS_setup/scripts/capbuild', sha256: sha256(bytes), defaults: { memoryMax: '8G', memorySwapMax: '2G', heapMB: 4096, slice: 'dev.slice' }, hostMetadataEffects: ['systemd-user-transient-units', '/run/user/12345/capbuild-locks'] }
  const host = {
    realpathSync(path) { assert.equal(path, wrapper.executable); return wrapper.realpath },
    lstatSync(path) { assert.equal(path, wrapper.realpath); return { isFile: () => true, mode: 0o100755 } },
    readFileSync(path) { assert.equal(path, wrapper.realpath); return bytes },
    getuid: () => 12345,
  }
  fixture.arm.gateWrapper = wrapper
  const executed = `${wrapper.executable} ${fixture.evidence.executedCommand}`
  replaceTemplate(fixture, fixture.configuredCommand, executed)
  fixture.evidence.wrapper = { ...wrapper, env: [] }
  assert.doesNotThrow(() => validateOptionalGateEvidence(fixture, host))
})

function replaceTemplate(fixture, template, executed) {
  fixture.configuredCommand = template
  fixture.evidence.command = template
  fixture.evidence.configuredCommand = template
  fixture.evidence.executedCommand = executed
  const native = fixture.commands.find((entry) => entry.id === fixture.evidence.toolCallId)
  native.command = `cd '${fixture.arm.scratchRoot}' && ${executed}`
  fixture.evidence.nativeCommand = native.command
}


test('manifest evidence rejects traversal, multiple substitutions, malformed bytes, swapped evidence, and receipt drift', (t) => {
  const mutations = [
    (f) => { f.proposal.optionalGateRuns[f.slot].substitutions.manifest = '@../scope.json'; f.evidence.substitutions = f.proposal.optionalGateRuns[f.slot].substitutions },
    (f) => { f.proposal.optionalGateRuns[f.slot].substitutions.range = `${'1'.repeat(40)}..${'2'.repeat(40)}`; f.evidence.substitutions = f.proposal.optionalGateRuns[f.slot].substitutions },
    (f) => { replaceTemplate(f, "node scripts/run-nx-test-tier.mjs '{files}'", `node scripts/run-nx-test-tier.mjs ${f.evidence.substitutions.manifest}`) },
    (f) => { replaceTemplate(f, "node scripts/run-nx-test-tier.mjs '{manifest}' '{manifest}'", `node scripts/run-nx-test-tier.mjs ${f.evidence.substitutions.manifest} ${f.evidence.substitutions.manifest}`) },
    (f) => {
      const bytes = '{"protocol":"scope-manifest-json-v1","paths":['
      writeFileSync(f.manifest, bytes)
      f.arm.optionalInputs[f.slot].sha256 = sha256(bytes)
      f.proposal.optionalGateRuns[f.slot].inputSha256 = sha256(bytes)
      f.evidence.inputSha256 = sha256(bytes)
      f.after[f.relativeManifest].sha256 = sha256(bytes)
    },
    (f) => { f.after['scripts/run-nx-test-tier.mjs'].sha256 = '0'.repeat(64) },
    (f) => { const template = "echo '{manifest}'"; f.proposal.optionalGates[f.slot] = template; replaceTemplate(f, template, `echo '${f.evidence.substitutions.manifest}'`) },
    (f) => { writeFileSync(f.manifest, '{"protocol":"scope-manifest-json-v1","paths":[]}'); f.arm.optionalInputs[f.slot].sha256 = sha256('{"protocol":"scope-manifest-json-v1","paths":[]}') },
    (f) => { writeFileSync(f.manifest, JSON.stringify({ protocol: 'scope-manifest-json-v1', paths: ['packages/a/src/a.test.ts', '../escape.test.ts'] })); f.arm.optionalInputs[f.slot].sha256 = sha256(requireBytes(f.manifest)) },
    (f) => { f.evidence.slot = 'unit-affected' },
    (f) => { f.evidence.inputSha256 = '0'.repeat(64) },
    (f) => { f.evidence.executedCommand += ' --extra' },
    (f) => { f.commands[0].exitCode = 1; f.commands[0].output = 'passed according to narration' },
  ]
  for (const mutate of mutations) {
    const fixture = evidenceFixture(t, 'unit-scoped')
    mutate(fixture)
    assert.throws(() => validateOptionalGateEvidence(fixture), { name: 'AssertionError' })
  }
})

function requireBytes(path) {
  return readFileSync(path)
}

test('affected manifest requires a non-test path and cannot masquerade as scoped or full fallback', (t) => {
  for (const mutate of [
    (f) => { const bytes = JSON.stringify({ protocol: 'scope-manifest-json-v1', paths: ['packages/a/src/a.test.ts'] }); writeFileSync(f.manifest, bytes); f.arm.optionalInputs[f.slot].sha256 = sha256(bytes); f.proposal.optionalGateRuns[f.slot].inputSha256 = sha256(bytes); f.evidence.inputSha256 = sha256(bytes) },
    (f) => { f.commands[0].output = '{"tier":"scoped"}\n' },
    (f) => { f.commands[0].output = '{"tier":"full"}\n' },
  ]) {
    const fixture = evidenceFixture(t, 'unit-affected')
    mutate(fixture)
    assert.throws(() => validateOptionalGateEvidence(fixture), { name: 'AssertionError' })
  }
})

test('impacted evidence requires an exact commit range, current HEAD, changed paths, and affected selector', (t) => {
  const mutations = [
    (f) => { f.proposal.optionalGateRuns[f.slot].substitutions.range = 'HEAD~1..HEAD'; f.evidence.substitutions = f.proposal.optionalGateRuns[f.slot].substitutions },
    (f) => { f.commands[0].output = `${'3'.repeat(40)}\n` },
    (f) => { f.commands.splice(1, 1) },
    (f) => { f.commands.splice(2, 0, { ...f.commands[1], id: 'duplicate-ancestor' }) },
    (f) => { f.commands[1].exitCode = 1 },
    (f) => { f.commands[2].output = '' },
    (f) => { f.commands[2].output = '../escape.ts\0' },
    (f) => { f.commands[2].exitCode = 1 },
    (f) => { f.commands[3].output = '{"tier":"full"}\n' },
    (f) => { f.commands[3].output = 'selector passed' },
  ]
  for (const mutate of mutations) {
    const fixture = evidenceFixture(t, 'unit-impacted')
    mutate(fixture)
    assert.throws(() => validateOptionalGateEvidence(fixture), { name: 'AssertionError' })
  }
})

test('impacted evidence rejects a successful diff between two unrelated real commits', (t) => {
  const fixture = evidenceFixture(t, 'unit-impacted')
  const scratch = fixture.arm.scratchRoot
  const git = (args, options = {}) => spawnSync('git', args, { cwd: scratch, encoding: 'utf8', ...options })
  assert.equal(git(['init', '-q']).status, 0)
  writeFileSync(join(scratch, 'base.ts'), 'base\n')
  assert.equal(git(['add', 'base.ts']).status, 0)
  assert.equal(git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base']).status, 0)
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: scratch, encoding: 'utf8' }).trim()
  assert.equal(git(['checkout', '--orphan', 'other']).status, 0)
  rmSync(join(scratch, 'base.ts'))
  writeFileSync(join(scratch, 'head.ts'), 'head\n')
  assert.equal(git(['add', 'head.ts']).status, 0)
  assert.equal(git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'head']).status, 0)
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: scratch, encoding: 'utf8' }).trim()
  const range = `${base}..${head}`
  const ancestry = git(['merge-base', '--is-ancestor', base, head])
  const diff = git(['diff', '--name-only', '-z', range])
  assert.equal(ancestry.status, 1, 'fixture commits must be unrelated')
  assert.equal(diff.status, 0, 'git diff succeeds even without ancestry')
  assert.ok(diff.stdout.length > 0, 'unrelated fixture diff must be nonempty')
  fixture.proposal.optionalGateRuns[fixture.slot] = { substitutions: { range }, inputSha256: sha256(range) }
  fixture.evidence.substitutions = { range }
  fixture.evidence.inputSha256 = sha256(range)
  replaceTemplate(fixture, fixture.configuredCommand, fixture.configuredCommand.replace('{range}', range))
  fixture.after['base.ts'] = { sha256: sha256('base\n'), mode: 33188 }
  fixture.after['head.ts'] = { sha256: sha256('head\n'), mode: 33188 }
  const selector = fixture.commands.find((entry) => entry.id === fixture.evidence.toolCallId)
  fixture.commands = [
    { id: 'real-head', command: `cd '${scratch}' && git rev-parse HEAD`, exitCode: 0, output: `${head}\n` },
    { id: 'real-ancestor', command: `cd '${scratch}' && git merge-base --is-ancestor ${base} ${head}`, exitCode: ancestry.status, output: ancestry.stdout },
    { id: 'real-diff', command: `cd '${scratch}' && git diff --name-only -z ${range}`, exitCode: diff.status, output: diff.stdout },
    selector,
  ]
  assert.throws(() => validateOptionalGateEvidence(fixture), { name: 'AssertionError' })
})
