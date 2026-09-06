#!/usr/bin/env node
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { authorityProfileBounds, intersectAuthority } from '../cli/lib/drivers.mjs'
import { resolveGovernance } from '../cli/lib/governance.mjs'
import { gitToplevel } from '../cli/lib/gitroot.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..')
const PASS = (id, detail, host) => ({ id, ...(host ? { host } : {}), status: 'PASS', detail })
const FAIL = (id, detail, host) => ({ id, ...(host ? { host } : {}), status: 'FAIL', detail })

function defaultRun({ bin, args, cwd, envOverrides, timeoutMs = 30_000 }) {
  const out = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, ...envOverrides } })
  if (out.error) return { status: 'UNAVAILABLE', code: null, error: out.error.code ?? out.error.message, stdout: out.stdout ?? '', stderr: out.stderr ?? '' }
  return { status: out.status === 0 ? 'PASS' : 'FAIL', code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' }
}

function codexValidatorPath(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null
  const base = process.env.CODEX_HOME || join(homedir(), '.codex')
  const path = join(base, 'skills', '.system', 'plugin-creator', 'scripts', 'validate_plugin.py')
  return existsSync(path) ? path : null
}

function officialCheck(id, host, invocation, run) {
  if (!invocation.bin) return { id, host, status: 'UNAVAILABLE', detail: `${id} validator unavailable: no executable path discovered` }
  const result = run(invocation)
  if (result.status === 'UNAVAILABLE') return { id, host, status: 'UNAVAILABLE', detail: `${result.error ?? 'validator unavailable'}` }
  const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim() || `exit ${result.code}`
  return result.code === 0 && result.status === 'PASS' ? PASS(id, detail, host) : FAIL(id, detail, host)
}

function parseJson(path) {
  try { return { value: JSON.parse(readFileSync(path, 'utf8')) } }
  catch (error) { return { error: `${path}: ${error.message}` } }
}

function skillFiles(root) {
  const dir = join(root, 'skills')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(dir, e.name, 'SKILL.md')).sort()
}

function frontmatterCheck(root) {
  const files = skillFiles(root)
  for (const path of files) {
    if (!existsSync(path)) return FAIL('skill-frontmatter', `${path}: SKILL.md missing`)
    const text = readFileSync(path, 'utf8')
    const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
    if (!match) return FAIL('skill-frontmatter', `${path}: malformed YAML frontmatter delimiters`)
    const parsed = spawnSync('python3', ['-c', 'import sys,yaml; value=yaml.safe_load(sys.stdin.read()); assert isinstance(value,dict) and isinstance(value.get("name"),str) and value["name"].strip() and isinstance(value.get("description"),str) and value["description"].strip()',], { input: match[1], encoding: 'utf8', timeout: 5_000 })
    if (parsed.error) return { id: 'skill-frontmatter', status: 'UNAVAILABLE', detail: `${path}: PyYAML parser unavailable: ${parsed.error.code ?? parsed.error.message}` }
    if (parsed.status !== 0) {
      const detail = (parsed.stderr || `exit ${parsed.status}`).trim()
      if (/ModuleNotFoundError|No module named ['"]yaml/.test(detail)) return { id: 'skill-frontmatter', status: 'UNAVAILABLE', detail: `${path}: PyYAML parser unavailable: ${detail}` }
      return FAIL('skill-frontmatter', `${path}: malformed YAML frontmatter: ${detail}`)
    }
  }
  return PASS('skill-frontmatter', `${files.length} skill frontmatters parsed as YAML`)
}

function containedRealpath(root, candidate) {
  try {
    const realRoot = realpathSync(root)
    const realCandidate = realpathSync(candidate)
    return realCandidate === realRoot || realCandidate.startsWith(`${realRoot}/`)
  } catch {
    return false
  }
}

function declaredSkillsCheck(root, codex) {
  if (!codex || typeof codex !== 'object' || Array.isArray(codex)) return FAIL('declared-skill-exists', 'Codex manifest must be a JSON object with a skills declaration')
  const declaration = codex.skills
  if (typeof declaration === 'string') {
    if (declaration !== './skills/') return FAIL('declared-skill-exists', `Codex skills directory must use the official './skills/' contract, got ${declaration}`)
    const target = resolve(root, declaration)
    if (!containedRealpath(root, target)) return FAIL('declared-skill-exists', `declared skills path escapes or does not resolve inside plugin: ${declaration}`)
    const files = readdirSync(target, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(target, entry.name, 'SKILL.md'))
    const missing = files.filter((file) => !containedRealpath(root, file))
    if (missing.length > 0) return FAIL('declared-skill-exists', `missing or escaping declared skill: ${missing.join(', ')}`)
    return files.length > 0 ? PASS('declared-skill-exists', `${files.length} skills resolve through ${declaration}`) : FAIL('declared-skill-exists', `${declaration} declares an empty skill inventory`)
  }
  if (!Array.isArray(declaration) || declaration.length === 0) return FAIL('declared-skill-exists', 'Codex manifest must declare a nonempty skills path or list')
  const invalid = declaration.filter((rel) => typeof rel !== 'string' || !rel.endsWith('/SKILL.md') || !containedRealpath(root, resolve(root, rel)))
  return invalid.length ? FAIL('declared-skill-exists', `invalid, missing or escaping declared skill: ${invalid.map(String).join(', ')}`) : PASS('declared-skill-exists', `${declaration.length} declared skills resolve`)
}

export function validatePackaging({ root = PLUGIN_ROOT, codexValidator, claudeBin = 'claude', run = defaultRun } = {}) {
  root = resolve(root)
  const checks = []
  const validator = codexValidatorPath(codexValidator)
  checks.push(officialCheck('codex-official', 'codex', { bin: validator ? 'python3' : null, args: validator ? [validator, root] : [], cwd: root }, run))
  checks.push(officialCheck('claude-official', 'claude', { bin: claudeBin, args: ['plugin', 'validate', root], cwd: root }, run))

  const emitted = spawnSync(process.execPath, [join(HERE, 'emit-manifests.mjs'), '--check', '--root', root], { encoding: 'utf8', timeout: 30_000 })
  checks.push(emitted.status === 0 ? PASS('manifest-drift', 'generated manifests match sources') : FAIL('manifest-drift', (emitted.stderr || emitted.stdout || `exit ${emitted.status}`).trim()))

  const codexPath = join(root, '.codex-plugin', 'plugin.json')
  const claudePath = join(root, '.claude-plugin', 'plugin.json')
  const codexParsed = parseJson(codexPath)
  const claudeParsed = parseJson(claudePath)
  checks.push(frontmatterCheck(root))
  checks.push(codexParsed.error ? FAIL('declared-skill-exists', codexParsed.error) : declaredSkillsCheck(root, codexParsed.value))

  const pointer = 'agents/references/executor-reference.md'
  const cardPath = join(root, 'agents', 'phase-executor.md')
  const pointerOk = existsSync(cardPath) && readFileSync(cardPath, 'utf8').includes(pointer) && existsSync(join(root, pointer))
  checks.push(pointerOk ? PASS('executor-reference', `${pointer} resolves from agents/phase-executor.md`) : FAIL('executor-reference', `${pointer} must be named by agents/phase-executor.md and resolve`))

  const conventional = join(root, 'hooks', 'hooks.json')
  const hookRel = claudeParsed.value?.hooks
  const hookOk = !existsSync(conventional) && hookRel === './hooks/claude-hooks.json' && existsSync(resolve(root, hookRel))
  checks.push(hookOk ? PASS('hook-isolation', 'Claude hooks are explicit and conventional cross-host hooks.json is absent') : FAIL('hook-isolation', existsSync(conventional) ? 'hooks/hooks.json must be absent' : `${hookRel ?? '(missing Claude hooks pointer)'} must equal and resolve ./hooks/claude-hooks.json`))

  const status = checks.some((c) => c.status === 'UNAVAILABLE') ? 'UNAVAILABLE' : checks.some((c) => c.status === 'FAIL') ? 'FAIL' : 'PASS'
  return { ok: status === 'PASS', status, checks }
}


function stableDigest(value) {
  const normalize = (input) => Array.isArray(input) ? input.map(normalize) : input && typeof input === 'object' ? Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])])) : input
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
}

function packageSnapshot(root) {
  const base = realpathSync(root)
  const files = {}
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`package snapshot refuses symlink ${relative(base, path)}`)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) files[relative(base, path)] = createHash('sha256').update(readFileSync(path)).digest('hex')
    }
  }
  walk(base)
  return files
}

function invoke(run, invocation) {
  const result = run({ ...invocation, timeoutMs: 30_000 })
  if (result?.error || result?.code !== 0) throw new Error(`${invocation.host} ${invocation.step} unavailable: ${result?.error ?? result?.stderr ?? `exit ${result?.code}`}`)
  return { invocation, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function parseJsonEvidence(evidence) {
  try { return JSON.parse(evidence.stdout) } catch { throw new Error(`${evidence.invocation.host} ${evidence.invocation.step} returned unparseable evidence`) }
}

function codexInventory(evidence, pluginName, installedPath) {
  const value = parseJsonEvidence(evidence)
  const text = Array.isArray(value) ? value.flatMap((item) => item?.content ?? []).map((item) => item?.text ?? '').join('\n') : ''
  const aliasRoots = new Map([...text.matchAll(/^- `(r\d+)` = `([^`]+)`/gm)].map((match) => [match[1], match[2]]))
  const escaped = pluginName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const entries = [...text.matchAll(new RegExp(`^- ${escaped}:[^:]+:.*\\(file: (r\\d+)/([^/]+)/SKILL\\.md\\)$`, 'gm'))]
  if (entries.length === 0) throw new Error('Codex prompt-input inventory missing declared skills')
  for (const entry of entries) if (aliasRoots.get(entry[1]) !== join(installedPath, 'skills')) throw new Error(`Codex skill ${entry[2]} alias does not bind the installed package cache`)
  return { skills: entries.map((entry) => entry[2]).sort(), agents: [], hooks: [] }
}

function claudeInventory(evidence) {
  const text = evidence.stdout
  const list = (label) => text.match(new RegExp(`${label} \\(\\d+\\)\\s+([^\\n]+)`))?.[1].split(',').map((v) => v.trim()).filter(Boolean) ?? []
  const inventory = { skills: list('Skills').sort(), agents: list('Agents').sort(), hooks: list('Hooks').map((v) => v.split(/\s{2,}|\s+\(/)[0].trim()).sort() }
  if (inventory.skills.length === 0) throw new Error('Claude details inventory missing declared skills')
  return inventory
}

function mappingEvidence(host, evidence, pluginName, marketplaceName) {
  const value = parseJsonEvidence(evidence)
  const rows = host === 'codex' ? value.installed : value
  if (!Array.isArray(rows)) throw new Error(`${host} list evidence has no installed mapping array`)
  const selector = `${pluginName}@${marketplaceName}`
  const matches = rows.filter((row) => host === 'codex'
    ? row.name === pluginName && row.marketplaceName === marketplaceName
    : String(row.id) === selector || String(row.id).startsWith(`${selector}-`))
  return { count: matches.length, row: matches[0] }
}

export function checkRepeatPackaging({ root = PLUGIN_ROOT, governance, authority, run = defaultRun, now = () => new Date().toISOString() } = {}) {
  root = realpathSync(root)
  if (!governance || governance.hold) return { ok: false, status: 'UNRESOLVED', source: {}, hosts: [], detail: 'governance receipt missing or held' }
  if (!authority) return { ok: false, status: 'UNRESOLVED', source: {}, hosts: [], detail: 'explicit authority receipt required' }
  try {
    const derived = intersectAuthority(authority.parent, authority.request)
    if (!isDeepStrictEqual(derived.effective, authority.effective) || derived.effective.bounds.filesystem !== 'workspace-write') throw new Error('repeat installation requires a valid explicit workspace-write authority receipt')
  } catch (error) { return { ok: false, status: 'UNRESOLVED', source: {}, hosts: [], detail: `authority invalid: ${error.message}` } }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const expectedSkills = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  const expectedAgents = readdirSync(join(root, 'agents'), { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => entry.name.replace(/\.md$/, '')).sort()
  const hookManifest = JSON.parse(readFileSync(join(root, 'hooks', 'claude-hooks.json'), 'utf8'))
  const expected = { codex: { skills: expectedSkills, agents: [], hooks: [] }, claude: { skills: expectedSkills, agents: expectedAgents, hooks: Object.keys(hookManifest.hooks ?? {}).sort() } }
  const sourceSnapshot = packageSnapshot(root)
  const source = { version: pkg.version, packageDigest: stableDigest(sourceSnapshot), governanceDigest: stableDigest(governance), authorityDigest: stableDigest(authority), governance: structuredClone(governance), authority: structuredClone(authority), nativePolicy: { verified: false, limitations: ['plugin-management commands inherit supervisor policy', 'isolated host config directories do not attest OS authority'] } }
  const workspace = mkdtempSync(join(tmpdir(), 'zeroh-roadmap-repeat-'))
  const marketplaceName = pkg.name.replace(/-plugin$/, '') + '-local'
  const selector = `${pkg.name}@${marketplaceName}`
  const hosts = []
  let activeHost = 'codex'
  let activeCommands = []
  try {
    const marketplace = join(workspace, 'marketplace')
    mkdirSync(join(marketplace, 'plugins'), { recursive: true })
    cpSync(root, join(marketplace, 'plugins', pkg.name), { recursive: true, filter: (src) => !['.git', 'node_modules'].includes(src.split('/').at(-1)) })
    const pluginEntry = { name: pkg.name, description: pkg.description ?? pkg.name, source: `./plugins/${pkg.name}`, category: 'development' }
    mkdirSync(join(marketplace, '.agents', 'plugins'), { recursive: true })
    mkdirSync(join(marketplace, '.claude-plugin'), { recursive: true })
    writeFileSync(join(marketplace, '.agents', 'plugins', 'marketplace.json'), `${JSON.stringify({ name: marketplaceName, plugins: [{ ...pluginEntry, source: { source: 'local', path: pluginEntry.source }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } }] }, null, 2)}\n`)
    writeFileSync(join(marketplace, '.claude-plugin', 'marketplace.json'), `${JSON.stringify({ name: marketplaceName, owner: { name: pkg.author?.name ?? pkg.author ?? pkg.name }, plugins: [pluginEntry] }, null, 2)}\n`)
    for (const host of ['codex', 'claude']) {
      activeHost = host
      activeCommands = []
      const envOverrides = host === 'codex' ? { CODEX_HOME: join(workspace, 'codex-home') } : { CLAUDE_CONFIG_DIR: join(workspace, 'claude-config') }
      const bin = host
      mkdirSync(Object.values(envOverrides)[0], { recursive: true })
      const commandEvidence = activeCommands
      const versionEvidence = invoke(run, { host, step: 'version', bin, args: ['--version'], envOverrides, sourceRoot: root, cwd: workspace }); commandEvidence.push(versionEvidence)
      const version = versionEvidence.stdout.trim()
      const addArgs = host === 'codex' ? ['plugin', 'marketplace', 'add', marketplace, '--json'] : ['plugin', 'marketplace', 'add', marketplace, '--scope', 'user']
      commandEvidence.push(invoke(run, { host, step: 'marketplace-add', bin, args: addArgs, envOverrides, sourceRoot: root, cwd: workspace }))
      const attempts = []
      let hostInventory
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const installArgs = host === 'codex' ? ['plugin', 'add', selector, '--json'] : ['plugin', 'install', selector, '-s', 'user', '-y']
        const installed = invoke(run, { host, step: 'install', bin, args: installArgs, envOverrides, sourceRoot: root, cwd: workspace }); commandEvidence.push(installed)
        const listArgs = host === 'codex' ? ['plugin', 'list', '--marketplace', marketplaceName, '--json'] : ['plugin', 'list', '--json']
        const listed = invoke(run, { host, step: 'list', bin, args: listArgs, envOverrides, sourceRoot: root, cwd: workspace }); commandEvidence.push(listed)
        const mapping = mappingEvidence(host, listed, pkg.name, marketplaceName)
        if (mapping.count !== 1) throw new Error(`${host} mapping count is ${mapping.count}; expected exactly one`)
        const inventoryEvidence = host === 'codex'
          ? invoke(run, { host, step: 'prompt-input', bin, args: ['debug', 'prompt-input'], envOverrides, sourceRoot: root, cwd: workspace })
          : invoke(run, { host, step: 'details', bin, args: ['plugin', 'details', selector], envOverrides, sourceRoot: root, cwd: workspace })
        commandEvidence.push(inventoryEvidence)
        const installJson = host === 'codex' ? parseJsonEvidence(installed) : null
        const installedPath = host === 'codex' ? installJson.installedPath : mapping.row?.installPath
        const inventory = host === 'codex' ? codexInventory(inventoryEvidence, pkg.name, installedPath) : claudeInventory(inventoryEvidence)
        if (!installedPath || !containedRealpath(workspace, installedPath)) throw new Error(`${host} installed package path is missing or escapes isolated workspace`)
        const installedSnapshot = packageSnapshot(installedPath)
        const currentPackageDigest = stableDigest(packageSnapshot(root))
        const currentAuthorityDigest = stableDigest(authority)
        if (currentPackageDigest !== source.packageDigest) throw new Error('source package digest changed during repeated validation')
        if (currentAuthorityDigest !== source.authorityDigest) throw new Error('authority digest changed during repeated validation')
        if (stableDigest(installedSnapshot) !== source.packageDigest) throw new Error(`${host} installed package bytes differ from source package digest`)
        if (!isDeepStrictEqual(inventory, expected[host])) throw new Error(`${host} inventory is missing or changed: expected ${JSON.stringify(expected[host])}, got ${JSON.stringify(inventory)}`)
        const installedVersion = host === 'codex' ? installJson.version : mapping.row?.version
        if (installedVersion !== pkg.version || mapping.row?.version !== pkg.version) throw new Error(`${host} installed/listed package version ${installedVersion}/${mapping.row?.version} differs from source ${pkg.version}`)
        if (stableDigest(governance) !== source.governanceDigest) throw new Error('governance digest changed during repeated validation')
        const receipt = { observedAt: now(), mappingCount: mapping.count, inventory, version: installedVersion, packageDigest: source.packageDigest, governanceDigest: source.governanceDigest, authorityDigest: source.authorityDigest, commandEvidence: commandEvidence.splice(0).map(({ invocation, stdout, stderr }) => ({ step: invocation.step, args: invocation.args, stdout, stderr })) }
        if (attempts[0]) {
          const semantic = ({ observedAt, commandEvidence, ...rest }) => rest
          if (stableDigest(semantic(receipt)) !== stableDigest(semantic(attempts[0]))) throw new Error(`${host} second receipt changed mapping, inventory, version, package, governance or authority evidence`)
        }
        attempts.push(receipt); hostInventory = inventory
      }
      hosts.push({ host, status: 'PASS', version, inventory: hostInventory, attempts })
    }
  } catch (error) {
    const failedHost = activeHost
    if (!hosts.some((entry) => entry.host === failedHost)) hosts.push({ host: failedHost, status: 'UNRESOLVED', detail: error.message, attempts: [], commandEvidence: activeCommands.map(({ invocation, stdout, stderr }) => ({ step: invocation.step, args: invocation.args, stdout, stderr })) })
    return { ok: false, status: 'UNRESOLVED', source, hosts }
  } finally { rmSync(workspace, { recursive: true, force: true }) }
  return { ok: true, status: 'PASS', source, hosts }
}

function main(argv) {
  const valueFlags = new Set(['--root', '--codex-validator', '--claude-bin', '--parent-authority'])
  const known = new Set(['--validation-only', '--check-repeat', ...valueFlags])
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!known.has(arg)) { process.stderr.write(`validate-packaging: unknown argument '${arg}'\n`); return 1 }
    if (valueFlags.has(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) { process.stderr.write(`validate-packaging: ${arg} needs a value\n`); return 1 }
      i += 1
    }
  }
  const modes = ['--validation-only', '--check-repeat'].filter((flag) => argv.includes(flag))
  if (modes.length !== 1) { process.stderr.write('usage: validate-packaging.mjs (--validation-only | --check-repeat --parent-authority workspace-write) [--root <dir>]\n'); return 1 }
  const value = (flag) => { const i=argv.indexOf(flag); return i < 0 ? undefined : argv[i+1] }
  const root = resolve(value('--root') ?? PLUGIN_ROOT)
  let result
  if (modes[0] === '--validation-only') {
    result = validatePackaging({ root, codexValidator: value('--codex-validator'), claudeBin: value('--claude-bin') ?? 'claude' })
  } else {
    const parentProfile = value('--parent-authority')
    if (parentProfile !== 'workspace-write') { process.stderr.write('validate-packaging: --check-repeat requires explicit --parent-authority workspace-write\n'); return 1 }
    const bounds = authorityProfileBounds(parentProfile)
    const authority = intersectAuthority(
      { profile: parentProfile, bounds, provenance: { kind: 'explicit-operator-invocation', source: '--parent-authority workspace-write' } },
      { profile: 'inherit', bounds: structuredClone(bounds), provenance: null },
    )
    const repoRoot = gitToplevel(root)
    const governance = resolveGovernance(repoRoot, [relative(repoRoot, root)])
    result = checkRepeatPackaging({ root, governance, authority })
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return result.ok ? 0 : 2
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)))
