#!/usr/bin/env node
/**
 * Behavioral contract for the cheap cross-host packaging validator.
 *
 * RED means packaging drift, malformed discovery inputs, stale executor references, or an
 * unavailable official host validator can escape the one validation-only entrypoint.
 * External validators are injected fakes; no native host or model process runs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EMITTER = join(HERE, 'emit-manifests.mjs')
const MODULE = join(HERE, 'validate-packaging.mjs')
const tmps = []
process.on('exit', () => tmps.forEach((root) => rmSync(root, { recursive: true, force: true })))

const { validatePackaging, checkRepeatPackaging } = await import(pathToFileURL(MODULE).href)

function write(root, rel, text) {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function validSkill(name) {
  return `---\nname: ${name}\ndescription: A valid fixture skill used by packaging validation.\n---\n\n# ${name}\n`
}

function makeFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zr-validate-packaging-')))
  tmps.push(root)
  write(root, 'package.json', `${JSON.stringify({ name: 'fixture-plugin', version: '7.3.1', description: 'fixture plugin' }, null, 2)}\n`)
  write(root, 'skills/alpha/SKILL.md', validSkill('alpha'))
  write(root, 'skills/beta/SKILL.md', validSkill('beta'))
  write(root, 'agents/phase-executor.md', '---\nname: phase-executor\ndescription: Fixture executor.\n---\nlong-run: `agents/references/executor-reference.md`.\n')
  write(root, 'agents/references/executor-reference.md', '# Executor reference\n')
  write(root, 'tools/validate_plugin.py', '# fake path; injected runner owns execution\n')
  write(root, 'hooks/claude-hooks.json', '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"true"}]}]}}\n')
  write(root, '.claude-plugin/plugin.json', `${JSON.stringify({ name: 'fixture-plugin', version: '0.0.1', description: 'fixture plugin', hooks: './hooks/claude-hooks.json' }, null, 2)}\n`)
  write(root, '.cursor-plugin/plugin.json', `${JSON.stringify({ name: 'fixture-plugin', version: '0.0.2', skills: 'skills/' }, null, 2)}\n`)
  write(root, 'gemini-extension.json', `${JSON.stringify({ name: 'fixture-plugin', version: '0.0.3', skills_dir: 'skills/' }, null, 2)}\n`)
  write(root, '.copilot/plugin.yaml', 'name: fixture-plugin\nversion: 0.0.4\nskills_dir: skills/\n')
  write(root, '.codex/INSTALL.md', '# stale inventory\n')
  const emitted = spawnSync('node', [EMITTER, '--root', root], { encoding: 'utf8' })
  assert.equal(emitted.status, 0, emitted.stderr)
  return root
}

function fakeOfficialRunner(overrides = {}) {
  const calls = []
  return {
    calls,
    run(invocation) {
      calls.push(structuredClone(invocation))
      const host = invocation.args.includes('plugin') ? 'claude' : 'codex'
      return overrides[host] ?? { status: 'PASS', code: 0, stdout: `${host} valid\n`, stderr: '' }
    },
  }
}

function check(result, id) {
  const hit = result.checks.find((entry) => entry.id === id)
  assert.ok(hit, `result must include check '${id}'; got ${JSON.stringify(result.checks)}`)
  return hit
}

function validate(root, runner = fakeOfficialRunner()) {
  const codexValidator = join(root, 'tools', 'validate_plugin.py')
  return {
    runner,
    result: validatePackaging({ root, codexValidator, claudeBin: 'fake-claude', run: runner.run.bind(runner) }),
  }
}

function snapshot(root, rel = '') {
  const out = {}
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) Object.assign(out, snapshot(root, child))
    else if (entry.isFile()) {
      const path = join(root, child)
      out[child] = { text: readFileSync(path, 'utf8'), mtimeMs: statSync(path).mtimeMs }
    }
  }
  return out
}

test('clean validation runs official Codex then Claude checks and returns structured PASS', () => {
  const root = makeFixture()
  const { runner, result } = validate(root)
  assert.equal(result.ok, true)
  assert.equal(result.status, 'PASS')
  assert.deepEqual(result.checks.map((entry) => entry.status), result.checks.map(() => 'PASS'))
  assert.deepEqual(runner.calls.map((call) => call.args.includes('plugin') ? 'claude' : 'codex'), ['codex', 'claude'])
  assert.equal(runner.calls[0].args.at(-1), root, 'Codex official validator receives the fixture plugin root')
  assert.deepEqual(runner.calls[1].args, ['plugin', 'validate', root], 'Claude official validation argv is explicit')
})

test('validation-only reports a mutated generated manifest and writes no byte or mtime', () => {
  const root = makeFixture()
  const manifest = join(root, '.codex-plugin', 'plugin.json')
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('"version": "7.3.1"', '"version": "0.0.0"'))
  const before = snapshot(root)
  const { result } = validate(root)
  assert.equal(result.ok, false)
  assert.equal(result.status, 'FAIL')
  assert.equal(check(result, 'manifest-drift').status, 'FAIL')
  assert.match(check(result, 'manifest-drift').detail, /.codex-plugin\/plugin.json/)
  assert.deepEqual(snapshot(root), before, 'validation-only must not repair or touch the tree it judges')
})

test('malformed skill frontmatter fails and names the skill file', () => {
  const root = makeFixture()
  write(root, 'skills/alpha/SKILL.md', '---\nname: [broken\ndescription: nope\n---\n')
  const { result } = validate(root)
  assert.equal(result.ok, false)
  assert.equal(check(result, 'skill-frontmatter').status, 'FAIL')
  assert.match(check(result, 'skill-frontmatter').detail, /skills\/alpha\/SKILL.md/)
  assert.match(check(result, 'skill-frontmatter').detail, /yaml|parse|flow|line|frontmatter/i)
})

test('YAML-looking body text outside valid frontmatter is a legal decoy', () => {
  const root = makeFixture()
  write(root, 'skills/alpha/SKILL.md', `${validSkill('alpha')}\nExample body: [this is documentation, not frontmatter\n`)
  const { result } = validate(root)
  assert.equal(result.ok, true)
  assert.equal(check(result, 'skill-frontmatter').status, 'PASS')
})

test('a manifest-declared skill path must resolve to a real SKILL.md', () => {
  const root = makeFixture()
  const path = join(root, '.codex-plugin', 'plugin.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  manifest.skills = ['./skills/alpha/SKILL.md', './skills/missing/SKILL.md']
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  const { result } = validate(root)
  assert.equal(result.ok, false)
  assert.equal(check(result, 'declared-skill-exists').status, 'FAIL')
  assert.match(check(result, 'declared-skill-exists').detail, /skills\/missing\/SKILL.md/)
})

test('the phase-executor reference pointer must resolve, and an adjacent valid reference is a decoy', () => {
  const root = makeFixture()
  unlinkSync(join(root, 'agents', 'references', 'executor-reference.md'))
  write(root, 'agents/references/other-reference.md', '# Legal adjacent reference\n')
  const { result } = validate(root)
  assert.equal(result.ok, false)
  assert.equal(check(result, 'executor-reference').status, 'FAIL')
  assert.match(check(result, 'executor-reference').detail, /agents\/references\/executor-reference.md/)
  assert.doesNotMatch(check(result, 'executor-reference').detail, /other-reference.md/)
})

test('renaming the phase-executor owner is loud anchor drift, never a vacuous pass', () => {
  const root = makeFixture()
  renameSync(join(root, 'agents', 'phase-executor.md'), join(root, 'agents', 'renamed-executor.md'))
  const { result } = validate(root)
  assert.equal(result.ok, false)
  assert.equal(check(result, 'executor-reference').status, 'FAIL')
  assert.match(check(result, 'executor-reference').detail, /phase-executor\.md|owner|anchor/i)
})

test('an adjacent legal reference file does not trigger executor-reference validation', () => {
  const root = makeFixture()
  write(root, 'agents/references/other-reference.md', '# Legal adjacent reference\n')
  const { result } = validate(root)
  assert.equal(result.ok, true)
  assert.equal(check(result, 'executor-reference').status, 'PASS')
})

test('host hook isolation rejects the conventional auto-discovery filename', () => {
  const root = makeFixture()
  write(root, 'hooks/hooks.json', '{"hooks":{}}\n')
  const { result } = validate(root)
  assert.equal(result.ok, false)
  assert.equal(check(result, 'hook-isolation').status, 'FAIL')
  assert.match(check(result, 'hook-isolation').detail, /hooks\/hooks.json/)
})

test('the explicit Claude hook pointer must resolve to the isolated hook file', () => {
  const root = makeFixture()
  const path = join(root, '.claude-plugin', 'plugin.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  manifest.hooks = './hooks/missing-hooks.json'
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  const { result } = validate(root)
  assert.equal(result.ok, false)
  assert.equal(check(result, 'hook-isolation').status, 'FAIL')
  assert.match(check(result, 'hook-isolation').detail, /hooks\/missing-hooks.json/)
})

test('missing, refused and timed-out official validators are typed UNAVAILABLE and never pass overall', () => {
  for (const [label, unavailable] of [
    ['missing', { status: 'UNAVAILABLE', code: null, error: 'ENOENT' }],
    ['refused', { status: 'UNAVAILABLE', code: null, error: 'EACCES' }],
    ['timeout', { status: 'UNAVAILABLE', code: null, error: 'ETIMEDOUT' }],
  ]) {
    const root = makeFixture()
    const runner = fakeOfficialRunner({ codex: unavailable })
    const { result } = validate(root, runner)
    assert.equal(result.ok, false, `${label}: unavailable validator cannot produce ok:true`)
    assert.equal(result.status, 'UNAVAILABLE', `${label}: overall result must preserve unavailable state`)
    assert.equal(check(result, 'codex-official').status, 'UNAVAILABLE')
    assert.match(check(result, 'codex-official').detail, new RegExp(unavailable.error))
  }
})

test('CLI validation-only prints typed UNAVAILABLE JSON, exits nonzero, and writes nothing', () => {
  const root = makeFixture()
  const before = snapshot(root)
  const res = spawnSync(
    'node',
    [
      MODULE,
      '--root', root,
      '--validation-only',
      '--codex-validator', join(root, 'missing', 'validate_plugin.py'),
      '--claude-bin', join(root, 'missing', 'claude'),
    ],
    { cwd: tmpdir(), encoding: 'utf8' },
  )
  assert.notEqual(res.status, 0, `unavailable official validators cannot exit success; stderr:\n${res.stderr}`)
  assert.ok(res.stdout.trim().length > 0, `validation-only must print structured JSON; stderr:\n${res.stderr}`)
  const output = JSON.parse(res.stdout)
  assert.equal(output.ok, false)
  assert.equal(output.status, 'UNAVAILABLE')
  assert.ok(output.checks.some((entry) => entry.status === 'UNAVAILABLE'))
  assert.deepEqual(snapshot(root), before, 'validation-only CLI must not mutate the fixture even when tools are unavailable')
})


test('an explicit missing Codex validator is UNAVAILABLE while a valid Claude check still passes', () => {
  const root = makeFixture()
  const runner = fakeOfficialRunner()
  const result = validatePackaging({
    root,
    codexValidator: join(root, 'tools', 'definitely-missing.py'),
    claudeBin: 'fake-claude',
    run: runner.run.bind(runner),
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 'UNAVAILABLE')
  assert.equal(check(result, 'codex-official').status, 'UNAVAILABLE')
  assert.equal(check(result, 'claude-official').status, 'PASS')
})

test('a non-object Codex manifest is a typed declared-skill failure, never a throw', () => {
  const root = makeFixture()
  write(root, '.codex-plugin/plugin.json', 'null\n')
  const { result } = validate(root)
  assert.equal(result.ok, false)
  assert.equal(check(result, 'declared-skill-exists').status, 'FAIL')
  assert.match(check(result, 'declared-skill-exists').detail, /JSON object|skills declaration/i)
})

// ── repeated native discovery: injected process boundary, no live host install ──────────────
const REPEAT_GOVERNANCE = {
  root: '/fixture/plugin', targets: ['skills/alpha/SKILL.md'], instructions: [], taskRunners: {}, hold: null,
}
const REPEAT_AUTHORITY = {
  parent: {
    profile: 'workspace-write',
    bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false },
    provenance: { kind: 'explicit-operator-invocation', source: '--parent-authority workspace-write' },
  },
  request: {
    profile: 'workspace-write',
    bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false },
    provenance: null,
  },
  effective: {
    profile: 'workspace-write',
    bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false },
  },
  native: {
    driver: 'codex', runtime: { version: null, verified: false },
    argv: ['exec', '--sandbox', 'workspace-write', '-'],
    enforcement: { filesystem: 'sandbox', network: 'sandbox-config', gitPush: 'semantic-only', externalWrites: 'semantic-only' },
    limitations: ['native discovery does not attest authority'],
  },
}

function repeatRunner({ mutate } = {}) {
  const calls = []
  const attempt = { codex: 0, claude: 0 }
  return {
    calls,
    run(invocation) {
      calls.push(structuredClone(invocation))
      const host = invocation.host
      if (invocation.step === 'version') {
        return { code: 0, stdout: host === 'codex' ? 'codex-cli 9.1.0\n' : '9.2.0 (Claude Code)\n', stderr: '' }
      }
      if (invocation.step === 'install') {
        attempt[host] += 1
        const configHome = host === 'codex' ? invocation.envOverrides?.CODEX_HOME : invocation.envOverrides?.CLAUDE_CONFIG_DIR
        if (!configHome || !invocation.sourceRoot) return { code: 1, stdout: '', stderr: 'install fixture requires isolated config home and sourceRoot' }
        const installedPath = join(configHome, 'plugins', 'cache', 'fixture-local', 'fixture-plugin', '7.3.1')
        rmSync(installedPath, { recursive: true, force: true })
        mkdirSync(dirname(installedPath), { recursive: true })
        cpSync(invocation.sourceRoot, installedPath, { recursive: true })
        if (mutate?.tamperInstalledBytes === host && attempt[host] === 2) {
          writeFileSync(join(installedPath, 'package.json'), '{"name":"fixture-plugin","version":"tampered"}\n')
        }
        if (host === 'codex') {
          return {
            code: 0,
            stdout: JSON.stringify({
              pluginId: 'fixture-plugin@fixture-local', name: 'fixture-plugin', marketplaceName: 'fixture-local',
              version: '7.3.1', installedPath, authPolicy: 'ON_INSTALL',
            }),
            stderr: '',
          }
        }
        return { code: 0, stdout: 'Installed fixture-plugin\n', stderr: '' }
      }
      if (invocation.step === 'marketplace-add' && host === 'codex') {
        return { code: 0, stdout: JSON.stringify({ marketplaceName: 'fixture-local', installedRoot: dirname(invocation.sourceRoot), alreadyAdded: attempt.codex > 0 }), stderr: '' }
      }
      if (invocation.step === 'marketplace-add' && host === 'claude') {
        return { code: 0, stdout: 'Added marketplace fixture-local\n', stderr: '' }
      }
      if (invocation.step === 'list' && host === 'codex') {
        const count = mutate?.mappingCount?.codex?.[attempt.codex] ?? 1
        return {
          code: 0,
          stdout: JSON.stringify({
            installed: Array.from({ length: count }, (_, i) => ({
              pluginId: `fixture-plugin@fixture-local${i ? `-${i}` : ''}`,
              name: 'fixture-plugin', marketplaceName: 'fixture-local',
              version: mutate?.pluginVersion?.codex?.[attempt.codex] ?? '7.3.1',
              installed: true, enabled: true,
              source: { source: 'local', path: invocation.sourceRoot },
            })),
            available: [],
          }),
          stderr: '',
        }
      }
      if (invocation.step === 'prompt-input' && host === 'codex') {
        const names = mutate?.missingInventoryAlways === 'codex'
          || (mutate?.missingInventory === 'codex' && attempt.codex === 2) ? ['alpha'] : ['alpha', 'beta']
        const labels = { alpha: 'Alpha Skill', beta: 'Beta Capability' }
        const text = [
          '<skills_instructions>',
          '## Skills',
          '### Skill roots',
          `- \`r1\` = \`${join(invocation.envOverrides.CODEX_HOME, 'plugins/cache/fixture-local/fixture-plugin/7.3.1/skills')}\``,
          '### Available skills',
          ...names.map((name) => `- fixture-plugin:${labels[name]}: Fixture ${name}. (file: r1/${name}/SKILL.md)`),
          '</skills_instructions>',
        ].join('\n')
        return { code: 0, stdout: JSON.stringify([{ type: 'message', role: 'developer', content: [{ type: 'input_text', text }] }]), stderr: '' }
      }
      if (invocation.step === 'list' && host === 'claude') {
        const count = mutate?.mappingCount?.claude?.[attempt.claude] ?? 1
        return {
          code: 0,
          stdout: JSON.stringify(Array.from({ length: count }, (_, i) => ({
            id: `fixture-plugin@fixture-local${i ? `-${i}` : ''}`,
            version: '7.3.1', scope: 'user', enabled: true,
            installPath: join(invocation.envOverrides.CLAUDE_CONFIG_DIR, 'plugins/cache/fixture-local/fixture-plugin/7.3.1'),
            installedAt: `2026-09-07T00:00:0${attempt.claude}.000Z`,
            lastUpdated: `2026-09-07T00:00:0${attempt.claude}.000Z`,
          }))),
          stderr: '',
        }
      }
      if (invocation.step === 'details' && host === 'claude') {
        const skills = mutate?.missingInventory === 'claude' && attempt.claude === 2 ? 'alpha' : 'alpha, beta'
        return {
          code: 0,
          stdout: [
            'fixture-plugin 7.3.1',
            '  Source: fixture-plugin@fixture-local',
            '',
            'Component inventory',
            `  Skills (${skills === 'alpha' ? 1 : 2})  ${skills}`,
            '  Agents (1)  phase-executor',
            '  Hooks (1)  SessionStart  (harness-only — no model context cost)',
            '  MCP servers (0)',
            '  LSP servers (0)',
            '',
            'Projected token cost',
            '  Always-on: ~100 tok',
          ].join('\n'),
          stderr: '',
        }
      }
      return { code: 1, stdout: '', stderr: `unexpected step ${invocation.step}` }
    },
  }
}

function repeat(root, runner, overrides = {}) {
  return checkRepeatPackaging({
    root,
    governance: REPEAT_GOVERNANCE,
    authority: REPEAT_AUTHORITY,
    run: runner.run.bind(runner),
    now: (() => {
      let tick = 0
      return () => `2026-09-07T00:00:0${tick++}.000Z`
    })(),
    ...overrides,
  })
}

test('repeat check installs each host twice, one mapping each, with stable host-specific inventory and source digests', () => {
  const root = makeFixture()
  const runner = repeatRunner()
  const receipt = repeat(root, runner)
  assert.equal(receipt.ok, true)
  assert.equal(receipt.status, 'PASS')
  assert.equal(receipt.source.version, '7.3.1')
  assert.deepEqual(receipt.hosts.map((host) => host.host), ['codex', 'claude'], 'hosts execute serially in declared order')
  assert.deepEqual(receipt.hosts[0].inventory, { skills: ['alpha', 'beta'], agents: [], hooks: [] })
  assert.deepEqual(receipt.hosts[1].inventory, {
    skills: ['alpha', 'beta'], agents: ['phase-executor'], hooks: ['SessionStart'],
  })
  for (const host of receipt.hosts) {
    assert.equal(host.status, 'PASS')
    assert.match(host.version, /\d+\.\d+/)
    assert.equal(host.attempts.length, 2)
    assert.deepEqual(host.attempts.map((attempt) => attempt.mappingCount), [1, 1])
    assert.deepEqual(host.attempts[1].inventory, host.attempts[0].inventory)
    const semanticAttempt = ({ observedAt: _time, commandEvidence: _commands, ...semantic }) => semantic
    assert.deepEqual(
      semanticAttempt(host.attempts[1]),
      semanticAttempt(host.attempts[0]),
      `${host.host}: second receipt may differ only in declared timestamp and command evidence`,
    )
    for (const field of ['packageDigest', 'governanceDigest', 'authorityDigest']) {
      assert.match(host.attempts[0][field], /^[a-f0-9]{64}$/)
      assert.equal(host.attempts[1][field], host.attempts[0][field], `${host.host}: ${field} must survive the clean second run`)
      assert.equal(host.attempts[0][field], receipt.source[field], `${host.host}: attempt digest must bind the source receipt`)
    }
  }
  const envs = runner.calls.filter((call) => call.step === 'install').map((call) => call.envOverrides)
  assert.ok(envs.slice(0, 2).every((env) => typeof env.CODEX_HOME === 'string' && !('HOME' in env)))
  assert.ok(envs.slice(2).every((env) => typeof env.CLAUDE_CONFIG_DIR === 'string' && !('HOME' in env)))
})

test('repeat check rejects duplicate mappings, tampered package version, missing inventory, and changed authority input', () => {
  const duplicate = repeat(makeFixture(), repeatRunner({ mutate: { mappingCount: { codex: { 2: 2 } } } }))
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.status, 'UNRESOLVED')
  assert.match(duplicate.hosts[0].detail, /mapping|duplicate|2/i)

  const tampered = repeat(makeFixture(), repeatRunner({ mutate: { pluginVersion: { codex: { 2: '7.3.2-tampered' } } } }))
  assert.equal(tampered.ok, false)
  assert.equal(tampered.status, 'UNRESOLVED')
  assert.match(tampered.hosts[0].detail, /version|package|tamper|7\.3\.2/i)

  const missing = repeat(makeFixture(), repeatRunner({ mutate: { missingInventory: 'claude' } }))
  assert.equal(missing.ok, false)
  assert.equal(missing.status, 'UNRESOLVED')
  assert.match(missing.hosts[1].detail, /inventory|beta|missing|changed/i)

  const consistentlyMissing = repeat(makeFixture(), repeatRunner({ mutate: { missingInventoryAlways: 'codex' } }))
  assert.equal(consistentlyMissing.ok, false)
  assert.equal(consistentlyMissing.status, 'UNRESOLVED')
  assert.match(consistentlyMissing.hosts[0].detail, /inventory|beta|missing|source/i)

  const changedBytes = repeat(makeFixture(), repeatRunner({ mutate: { tamperInstalledBytes: 'codex' } }))
  assert.equal(changedBytes.ok, false)
  assert.equal(changedBytes.status, 'UNRESOLVED')
  assert.match(changedBytes.hosts[0].detail, /package|bytes|digest|changed/i)

  const root = makeFixture()
  const runner = repeatRunner()
  const authority = structuredClone(REPEAT_AUTHORITY)
  const originalRun = runner.run.bind(runner)
  runner.run = (invocation) => {
    const result = originalRun(invocation)
    if (invocation.host === 'codex' && invocation.step === 'prompt-input' && runner.calls.filter((c) => c.host === 'codex' && c.step === 'prompt-input').length === 1) {
      authority.effective.bounds.externalWrites = true
    }
    return result
  }
  const changed = repeat(root, runner, { authority })
  assert.equal(changed.ok, false)
  assert.equal(changed.status, 'UNRESOLVED')
  assert.match(changed.hosts[0].detail, /authority|digest|changed/i)
})

test('missing, refused, timed-out, or unparseable native host evidence is unresolved and non-success', () => {
  for (const failure of [
    { code: null, error: 'ENOENT', stdout: '', stderr: '' },
    { code: null, error: 'EACCES', stdout: '', stderr: '' },
    { code: null, error: 'ETIMEDOUT', stdout: '', stderr: '' },
    { code: 0, stdout: '{not-json', stderr: '' },
  ]) {
    const runner = repeatRunner()
    const normal = runner.run.bind(runner)
    runner.run = (invocation) => invocation.host === 'codex' && invocation.step === 'prompt-input' ? failure : normal(invocation)
    const receipt = repeat(makeFixture(), runner)
    assert.equal(receipt.ok, false)
    assert.equal(receipt.status, 'UNRESOLVED')
    assert.equal(receipt.hosts[0].status, 'UNRESOLVED')
  }
})

test('default native runner passes isolated config homes and cwd to real child processes without replacing HOME', () => {
  const root = makeFixture()
  const boundary = realpathSync(mkdtempSync(join(tmpdir(), 'zr-native-boundary-')))
  tmps.push(boundary)
  const fakeBin = join(boundary, 'native-bin')
  const record = join(boundary, 'native-env.jsonl')
  mkdirSync(fakeBin)
  const executable = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs')",
    "fs.appendFileSync(process.env.ZR_NATIVE_ENV_RECORD, JSON.stringify({",
    "  bin: require('node:path').basename(process.argv[1]),",
    '  cwd: process.cwd(),',
    '  HOME: process.env.HOME,',
    '  CODEX_HOME: process.env.CODEX_HOME,',
    '  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,',
    "}) + '\\n')",
    'process.exit(1)',
    '',
  ].join('\n')
  for (const name of ['codex', 'claude']) {
    writeFileSync(join(fakeBin, name), executable)
    chmodSync(join(fakeBin, name), 0o755)
  }

  const expectedHome = process.env.HOME
  const moduleUrl = pathToFileURL(MODULE).href
  const subprocess = [
    `import { checkRepeatPackaging } from ${JSON.stringify(moduleUrl)}`,
    'const receipt = checkRepeatPackaging({',
    '  root: process.env.ZR_FIXTURE_ROOT,',
    '  governance: JSON.parse(process.env.ZR_FIXTURE_GOVERNANCE),',
    '  authority: JSON.parse(process.env.ZR_FIXTURE_AUTHORITY),',
    '})',
    'process.stdout.write(`${JSON.stringify(receipt)}\\n`)',
    'process.exit(receipt.ok ? 0 : 2)',
  ].join('\n')
  const res = spawnSync(
    'node',
    ['--input-type=module', '-e', subprocess],
    {
      cwd: tmpdir(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        ZR_NATIVE_ENV_RECORD: record,
        ZR_FIXTURE_ROOT: root,
        ZR_FIXTURE_GOVERNANCE: JSON.stringify(REPEAT_GOVERNANCE),
        ZR_FIXTURE_AUTHORITY: JSON.stringify(REPEAT_AUTHORITY),
      },
    },
  )
  assert.notEqual(res.status, 0, 'the intentionally refused fake native command must remain unresolved')
  const receipt = JSON.parse(res.stdout)
  assert.equal(receipt.ok, false)
  assert.equal(receipt.status, 'UNRESOLVED')
  const observations = readFileSync(record, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(observations.length > 0, 'the real default process boundary must invoke at least one fake host binary')
  for (const observation of observations) {
    assert.equal(observation.HOME, expectedHome, `${observation.bin}: HOME must be inherited unchanged`)
    assert.ok(observation.cwd.startsWith(tmpdir()), `${observation.bin}: native cwd must be a temporary workspace`)
    assert.notEqual(observation.cwd, root, `${observation.bin}: native cwd must not inherit project instructions from the source root`)
    assert.notEqual(observation.cwd, expectedHome, `${observation.bin}: native cwd must not be the operator home`)
    const isolated = observation.bin === 'codex' ? observation.CODEX_HOME : observation.CLAUDE_CONFIG_DIR
    assert.equal(typeof isolated, 'string', `${observation.bin}: host-specific config home must be set`)
    assert.ok(isolated.startsWith(tmpdir()), `${observation.bin}: isolated home must live under a temporary root; got ${isolated}`)
    assert.notEqual(isolated, expectedHome)
    assert.notEqual(isolated, root)
  }
})
