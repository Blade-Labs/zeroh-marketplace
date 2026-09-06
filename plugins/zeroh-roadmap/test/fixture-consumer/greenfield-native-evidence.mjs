import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { validateDeliveryConfig, DELIVERY_SCHEMA_CONTRACT, ADAPTERS as DELIVERY_ADAPTERS } from '../../../zeroh-greenfield/templates/scripts/ci-shard-plan.mjs'
import { execFileSync } from 'node:child_process'
import { SCOPE_MANIFEST_PROTOCOL } from '../../cli/lib/slots.mjs'
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceFiles, canonical, sha256 } from './greenfield-evidence-source.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const deliveryYaml=createRequire(resolve(ROOT,'package.json'))('js-yaml')

function receipt(kind) {
  return JSON.parse(readFileSync(resolve(ROOT, `plugins/zeroh-greenfield/dry-runs/${kind}/receipt.json`), 'utf8'))
}

// Native records and independent observer files are the evidence. Receipt fields
// identify retained files; they cannot replace missing tool or filesystem events.
const APPROVAL = 'APPROVE GREENFIELD PLAN'
const MUTATIONS = 0x2 | 0x4 | 0x8 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800
const STAGE_FILES = ['request.json', 'before.json', 'after.json', 'events.json', 'stdout.jsonl', 'result.json']
const CORE_GATES = ['lint', 'types', 'unit', 'integration', 'build', 'e2e', 'emit']
const REQUIRED_HOMES = ['docs/PRD.md', 'docs/adr/0001-tech-stack.md', 'docs/adr/0002-design-system.md', 'docs/CODE-STYLE.md', 'docs/architecture.md', 'docs/ux-canon.md']
const rows = (raw) => raw.trim() ? raw.trim().split('\n').map((line) => JSON.parse(line)) : []
const treeHash = (tree) => sha256(canonical(tree))

// Enumerate current disk bytes, not git ls-files: dirty and untracked source are
// part of the invocation. Evidence output has only these explicit exclusions.
function validateSourceFiles(receipt, root = ROOT) {
  assert.ok(Array.isArray(receipt.sourceSnapshotFiles) && receipt.sourceSnapshotFiles.length > 0, 'invocation source snapshot files required')
  assert.equal(receipt.sourceSnapshotSha256, sha256(canonical(receipt.sourceSnapshotFiles)), 'invocation source snapshot digest must match its canonical entries')
  assert.deepEqual(receipt.sourceSnapshotFiles, sourceFiles(root), 'invocation source snapshot is stale: changed, added, renamed, deleted or mode-changed source')
}
function validateSourceBinding(receipt) {
  assert.match(receipt.invocationBaseCommit, /^[0-9a-f]{40}$/, 'invocation base must be an exact commit')
  assert.equal(execFileSync('git', ['-C', ROOT, 'rev-parse', `${receipt.invocationBaseCommit}^{commit}`], { encoding: 'utf8' }).trim(), receipt.invocationBaseCommit)
  execFileSync('git', ['-C', ROOT, 'merge-base', '--is-ancestor', receipt.invocationBaseCommit, 'HEAD'], { stdio: 'pipe' })
  validateSourceFiles(receipt)
}

function safeArtifactPath(path, directory = false) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\\x00-\x1f*?\[\]{}]/.test(path)) return false
  const normalized = directory && path.endsWith('/') ? path.slice(0, -1) : path
  return Boolean(normalized) && normalized.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
}
function explicitJsonBlocks(message) {
  const blocks = []
  let fence = null
  for (const line of message.split(/\r?\n/)) {
    if (!fence) {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/)
      if (opening) fence = { marker: opening[1][0], length: opening[1].length, json: opening[2].trim().toLowerCase() === 'json', lines: [] }
    } else {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
        if (fence.json) blocks.push(fence.lines.join('\n'))
        fence = null
      } else fence.lines.push(line)
    }
  }
  return blocks
}

function nativeObjects(host, raw, type) {
  const proposals = []
  for (const row of rows(raw)) {
    const messages = host === 'claude'
      ? (row.type === 'assistant' && Array.isArray(row.message?.content) ? row.message.content.filter((block) => block.type === 'text').map((block) => block.text) : [])
      : (row.type === 'item.completed' && row.item?.type === 'agent_message' ? [row.item.text] : [])
    for (const message of messages) {
      const candidates = [message, ...explicitJsonBlocks(message)]
      for (const candidate of candidates) {
        let parsed
        try { parsed = JSON.parse(candidate) } catch { continue }
        if (parsed?.type === type) proposals.push(parsed)
      }
    }
  }
  return proposals
}
function proposalPaths(host, raw) {
  const proposals = nativeObjects(host, raw, 'proposal')
  assert.equal(proposals.length, 1, 'one complete native proposal JSON required')
  const proposal = proposals[0]
  assert.ok(Array.isArray(proposal.artifacts) && proposal.artifacts.length > 0, 'native proposal artifacts required')
  assert.ok(Array.isArray(proposal.commands) && proposal.commands.length > 0, 'native proposal commands required')
  assert.deepEqual(Object.keys(proposal.gates ?? {}).sort(), [...CORE_GATES].sort(), 'native proposal has all seven gates')
  for (const command of Object.values(proposal.gates)) assert.ok(typeof command === 'string' && command.trim(), 'native proposal gate bindings must be explicit')
  const bindings = validateOptionalGateBindings(proposal)
  const templated = Object.keys(bindings).filter(key => !CORE_GATES.includes(key) && /[{}]/.test(bindings[key])).sort()
  assert.deepEqual(Object.keys(proposal.optionalGateRuns ?? {}).sort(), templated, 'every optional template needs exactly one approved run input')
  for (const slot of templated) optionalGateCommand(proposal, slot, bindings[slot])
  const paths = proposal.artifacts.map((artifact) => {
    assert.ok(safeArtifactPath(artifact.path, true), `unsafe native proposal artifact: ${artifact.path}`)
    assert.ok(typeof artifact.reason === 'string' && artifact.reason.trim(), 'each proposed artifact requires a reason')
    return artifact.path
  }).sort()
  assert.equal(new Set(paths).size, paths.length, 'native proposal paths cannot be duplicated')
  return paths
}
function approvedPath(path, entry, paths) {
  if (!safeArtifactPath(path)) return false
  return paths.some((approved) => {
    if (approved.endsWith('/') && (path.startsWith(approved) || path === approved.slice(0, -1) && entry?.directory === true)) return true
    if (path === approved) return true
    // A named file requires its missing parent directories, not other children
    // and not a symlink in place of its parent.
    return entry?.directory === true && approved.startsWith(`${path}/`)
  })
}

function sessionEvents(host, raw) {
  return rows(raw).flatMap((row) => {
    const events = []
    if (host === 'claude') {
      const content = row.message?.content
      if (row.type === 'user' && !row.isMeta && !row.toolUseResult && !row.tool_use_result && content === APPROVAL) events.push({ type: 'approval' })
      for (const block of Array.isArray(content) ? content : []) {
        if (row.type === 'user' && !row.isMeta && content.length === 1 && block.type === 'text' && block.text === APPROVAL) events.push({ type: 'approval' })
        if (row.type === 'assistant' && block.type === 'tool_use') events.push({ type: 'tool', id: block.id, name: block.name, input: block.input })
      }
    } else if (host === 'codex' && row.type === 'response_item') {
      const item = row.payload
      if (item?.type === 'message' && item.role === 'user' && item.content?.length === 1 && item.content[0].type === 'input_text' && item.content[0].text === APPROVAL) events.push({ type: 'approval' })
      if (['function_call', 'custom_tool_call'].includes(item?.type)) events.push({ type: 'tool', id: item.call_id, name: item.name })
    }
    return events
  })
}

function sessionSuffix(before, after) {
  assert.ok(after.startsWith(before), 'retained native session must preserve the previous capture prefix')
  return after.slice(before.length)
}
function validateApprovalSlice(host, before, after) {
  const events = sessionEvents(host, sessionSuffix(before, after))
  const approval = events.findIndex((event) => event.type === 'approval')
  const firstCall = events.findIndex((event) => event.type === 'tool')
  assert.ok(approval >= 0 && firstCall > approval, 'native user approval must precede execution-stage tool calls')
  assert.equal(events.filter((event) => event.type === 'approval').length, 1, 'execution has one unambiguous approval')
}

function nativeCommands(host, raw) {
  const pending = new Map()
  const completed = []
  for (const row of rows(raw)) {
    if (host === 'codex' && row.item?.type === 'command_execution') {
      const item = row.item
      if (row.type === 'item.started') {
        assert.ok(!pending.has(item.id), 'duplicate native command start')
        pending.set(item.id, { id: item.id, command: item.command })
      } else if (row.type === 'item.completed') {
        const start = pending.get(item.id)
        assert.ok(start, 'native completion requires matching start')
        assert.equal(item.command, start.command, 'native command cannot change at completion')
        assert.ok(Number.isInteger(item.exit_code), 'native command exit must be numeric')
        completed.push({ ...start, exitCode: item.exit_code, output: item.aggregated_output })
        pending.delete(item.id)
      }
    } else if (host === 'claude') {
      for (const block of Array.isArray(row.message?.content) ? row.message.content : []) {
        if (row.type === 'assistant' && block.type === 'tool_use' && block.name === 'Bash') {
          assert.ok(!pending.has(block.id), 'duplicate native command start')
          pending.set(block.id, { id: block.id, command: block.input.command })
        } else if (row.type === 'user' && block.type === 'tool_result' && pending.has(block.tool_use_id)) {
          // Claude Bash reports structured is_error rather than printing exit 0.
          // Preserve nonzero as failure; do not infer success from output prose.
          assert.equal(typeof block.is_error, 'boolean', 'Claude Bash result needs native is_error')
          const result = row.tool_use_result ?? row.toolUseResult
          let exitCode = 0
          if (block.is_error) {
            assert.ok(typeof result === 'string' || result && result.interrupted === false, 'Claude Bash failure needs native completed error evidence')
            const nativeExit = typeof result === 'string' ? result.match(/^Error: Exit code ([1-9]\d*)\b/) : null
            exitCode = nativeExit ? Number(nativeExit[1]) : 1
            assert.ok(Number.isSafeInteger(exitCode), 'Claude native exit code must be finite')
          } else assert.ok(result && typeof result === 'object' && result.interrupted === false, 'Claude Bash must complete without interruption')
          completed.push({ ...pending.get(block.tool_use_id), exitCode, output: block.content })
          pending.delete(block.tool_use_id)
        }
      }
    }
  }
  assert.equal(pending.size, 0, 'native commands must all complete')
  assert.ok(completed.length > 0, 'native executed commands required; narration is not evidence')
  return completed
}

// Decode literal shell words only. This never executes a shell or accepts
// expansion, redirects, substitutions, globs or an extra wrapper argument.
function literalShellWord(text, position = 0) {
  while (/[ \t]/.test(text[position] ?? '') && position < text.length) position++
  const start = position
  let value = ''
  while (position < text.length && !/[ \t]/.test(text[position])) {
    const char = text[position++]
    if (char === "'") {
      const end = text.indexOf("'", position)
      if (end < 0) return null
      value += text.slice(position, end); position = end + 1
    } else if (char === '"') {
      let closed = false
      while (position < text.length) {
        const part = text[position++]
        if (part === '"') { closed = true; break }
        if (part === '$' || part === '`') return null
        if (part === '\\') {
          if (position === text.length) return null
          const next = text[position++]
          if (next === '\n' || next === '\r') return null
          value += /[\\"$`]/.test(next) ? next : '\\' + next
        } else value += part
      }
      if (!closed) return null
    } else if (char === '\\') {
      if (position === text.length || /[\n\r]/.test(text[position])) return null
      value += text[position++]
    } else {
      if (/[;&|<>()[\]{}*?$`#~\n\r]/.test(char)) return null
      value += char
    }
  }
  return position > start ? { value, end: position } : null
}
function commandAtCwd(native, scratch) {
  if (![native, scratch].every((value) => typeof value === 'string' && value.length)) return null
  let inner = native
  const first = literalShellWord(native)
  if (first?.value === '/bin/bash') {
    const flag = literalShellWord(native, first.end)
    const script = flag && literalShellWord(native, flag.end)
    if (flag?.value !== '-lc' || !script || native.slice(script.end).trim() !== '') return null
    inner = script.value
  }
  const cd = literalShellWord(inner)
  if (cd?.value !== 'cd') return null
  let path = literalShellWord(inner, cd.end)
  if (path?.value === '--') path = literalShellWord(inner, path.end)
  if (path?.value !== scratch) return null
  const rest = inner.slice(path.end).replace(/^[ \t]+/, '')
  return rest.startsWith('&&') ? rest.slice(2).replace(/^[ \t]+/, '') : null
}
function matchesGateCommand(native, configured, scratch) {
  return typeof configured === 'string' && configured.length > 0 && commandAtCwd(native, scratch) === configured
}
const CAPBUILD_EXECUTABLE = '/home/patrik/.local/bin/capbuild'
const CAPBUILD_REALPATH = '/home/patrik/illumination_VS_setup/scripts/capbuild'
const CAPBUILD_DEFAULTS = Object.freeze({ memoryMax: '8G', memorySwapMax: '2G', heapMB: 4096, slice: 'dev.slice' })
const CAPBUILD_CLEARED_OVERRIDES = Object.freeze(['CAPBUILD_SLICE', 'CAPBUILD_PASS_ENV', 'NODE_OPTIONS', 'FORCE_BARE', 'ITEST_FILES', 'AUDIT_LEDGER_ENABLED', 'TEST_CONCURRENCY', 'E2E_PROJECT', 'ALLURE'])
const REAL_WRAPPER_HOST = Object.freeze({ realpathSync, lstatSync, readFileSync, getuid: () => process.getuid() })
function validateGateWrapper(binding, host = REAL_WRAPPER_HOST) {
  assert.ok(binding && typeof binding === 'object', 'prebound gate wrapper required')
  assert.deepEqual(Object.keys(binding).sort(), ['kind', 'executable', 'realpath', 'sha256', 'defaults', 'hostMetadataEffects'].sort(), 'wrapper envelope has only approved metadata fields')
  assert.equal(binding.kind, 'capbuild')
  assert.equal(binding.executable, CAPBUILD_EXECUTABLE, 'only the vetted absolute wrapper executable is permitted')
  assert.equal(binding.realpath, CAPBUILD_REALPATH, 'only the vetted wrapper realpath is permitted')
  assert.equal(host.realpathSync(binding.executable), binding.realpath, 'wrapper symlink target changed')
  const stat = host.lstatSync(binding.realpath)
  assert.ok(stat.isFile() && (stat.mode & 0o111), 'bound wrapper must remain an executable regular file')
  assert.equal(sha256(host.readFileSync(binding.realpath)), binding.sha256, 'prebound wrapper binary digest changed')
  assert.deepEqual(binding.defaults, CAPBUILD_DEFAULTS, 'wrapper limits must retain vetted defaults')
  assert.deepEqual(binding.hostMetadataEffects, ['systemd-user-transient-units', `/run/user/${host.getuid()}/capbuild-locks`], 'wrapper host effects cannot expand consumer authority')
  return binding
}
function literalArgv(text) {
  if (typeof text !== 'string') return null
  const argv = []
  let position = 0
  while (position < text.length) {
    if (/^[ \t]*$/.test(text.slice(position))) break
    const token = literalShellWord(text, position)
    if (!token) return null
    argv.push(token.value); position = token.end
  }
  return argv.length ? argv : null
}
function unwrapGateExecution(native, configured, scratch, wrapperBinding, host = REAL_WRAPPER_HOST) {
  // A host wrapper never becomes part of the consumer's portable gate binding.
  if (typeof configured !== 'string' || !configured || /\bcapbuild\b/.test(configured)) return null
  if (wrapperBinding) {
    try { validateGateWrapper(wrapperBinding, host) } catch { return null }
  }
  const executed = commandAtCwd(native, scratch)
  if (executed === null) return null
  if (executed === configured) return { configuredCommand: configured, executedCommand: executed, wrapper: null }
  if (!wrapperBinding) return null
  const argv = literalArgv(executed), expected = literalArgv(configured)
  if (!argv || !expected || ![wrapperBinding.executable, wrapperBinding.realpath].includes(argv[0])) return null
  // Even quoted shell-program arguments cannot smuggle shell operators into a
  // supposedly portable capbuild tail. The accepted fixture tail is literal argv.
  if (/[;&|<>`]/.test(configured)) return null
  const approvedEnv = new Set([`npm_config_cache=${scratch}/.npm-cache`, `npm_config_logs_dir=${scratch}/.npm-logs`])
  const env = []
  let position = 1
  while (argv[position] === '--env') {
    const value = argv[position + 1]
    if (!approvedEnv.has(value) || env.includes(value)) return null
    env.push(value); position += 2
  }
  const tail = argv.slice(position)
  if (tail.length !== expected.length || tail.some((value, index) => value !== expected[index])) return null
  return { configuredCommand: configured, executedCommand: executed, wrapper: { ...wrapperBinding, env } }
}
function validateGateExecutionEvidence(record, native, configured, scratch, wrapperBinding, host = REAL_WRAPPER_HOST) {
  assert.ok(native && typeof native.id === 'string' && native.id, 'native gate call required')
  assert.equal(record.toolCallId, native.id, 'gate result must reference its native call')
  assert.equal(record.nativeCommand, native.command, 'raw native invocation must match')
  assert.ok(Number.isInteger(native.exitCode), 'native numeric gate exit required, not narration')
  assert.equal(native.exitCode, 0, 'wrapped or unwrapped native gate must succeed')
  assert.equal(record.exitCode, native.exitCode, 'gate receipt cannot narrate a failed inner command green')
  const unwrapped = unwrapGateExecution(native.command, configured, scratch, wrapperBinding, host)
  assert.ok(unwrapped, 'gate execution must preserve exact configured command inside the vetted wrapper envelope')
  assert.equal(record.configuredCommand, unwrapped.configuredCommand)
  assert.equal(record.executedCommand, unwrapped.executedCommand)
  assert.deepEqual(record.wrapper, unwrapped.wrapper, 'per-slot wrapper metadata must be derived from actual native invocation')
  return unwrapped
}

function validateStructuralChecks(commands, scratch, catalogCheck = { command: 'node scripts/check-readme-catalog.mjs --project-root .' }) {
  for (const configured of [`node ${ROOT}/plugins/zeroh-roadmap/bin/roadmap.mjs config check`, catalogCheck.command]) {
    assert.ok(commands.some((entry) => entry.exitCode === 0 && matchesGateCommand(entry.command, configured, scratch)), `all-none fixture requires actual native structural check: ${configured}`)
  }
}
function catalogProjects(text, rootExists) {
  const parsed = JSON.parse(text)
  const projects = Array.isArray(parsed) ? parsed : parsed?.projects
  assert.ok(Array.isArray(projects) && projects.length > 0, 'nonempty emitted catalog required')
  const names = new Set()
  for (const project of projects) {
    assert.ok(typeof project.name === 'string' && project.name.trim() && !names.has(project.name), 'catalog project names must be present and unique')
    names.add(project.name)
    assert.ok(safeArtifactPath(project.root) && rootExists(project.root), `catalog project root must exist: ${project.root}`)
  }
  return projects
}
function selectCatalogCheck(scratch, metadata) {
  assert.ok(typeof scratch === 'string' && scratch.startsWith('/'), 'absolute scratch root required')
  if (metadata.kind === 'empty') {
    assert.equal(metadata.archetype, 'library-cli', 'only the approved empty library-cli fixture is supported')
    assert.equal(metadata.projectName, 'greenfield-proof', 'prospective fixture identity must be bound before launch')
    assert.ok(readdirSync(scratch).every((name) => name === '.git'), 'empty fixture must not already contain a project')
    return { mode: 'project-root', source: '.', projectName: metadata.projectName, command: 'node scripts/check-readme-catalog.mjs --project-root .' }
  }
  assert.equal(metadata.kind, 'brownfield', 'only the supplied empty and brownfield fixtures are supported')
  assert.ok(lstatSync(resolve(scratch, 'nx.json')).isFile(), 'brownfield fixture requires its Nx marker')
  const nx = JSON.parse(readFileSync(resolve(scratch, 'nx.json'), 'utf8'))
  assert.ok(nx && typeof nx === 'object' && !Array.isArray(nx), 'valid Nx marker required')
  const source = 'emitted/repo-catalog.json'
  assert.ok(lstatSync(resolve(scratch, source)).isFile(), 'catalog source must be a regular file')
  const bytes = readFileSync(resolve(scratch, source))
  catalogProjects(bytes.toString('utf8'), (root) => {
    try { return lstatSync(resolve(scratch, root)).isDirectory() } catch { return false }
  })
  // An Nx wrapper package names the workspace, not the projects in its catalog.
  return { mode: 'catalog', source, command: 'node scripts/check-readme-catalog.mjs --catalog emitted/repo-catalog.json', sourceSha256: sha256(bytes) }
}
function catalogInvocation(command, scratch, plannedCwd) {
  const scoped = commandAtCwd(command, scratch)
  const text = scoped ?? (plannedCwd === scratch ? command : null)
  if (text === null) return null
  const node = literalShellWord(text), script = node && literalShellWord(text, node.end)
  return node?.value === 'node' && script?.value === 'scripts/check-readme-catalog.mjs' ? text : null
}
function validateCatalogCheck(arm, before, after, proposal, commands) {
  const selected = arm.catalogCheck
  assert.ok(selected, 'prelaunch catalog selection required')
  if (arm.kind === 'empty') {
    assert.deepEqual(selected, { mode: 'project-root', source: '.', projectName: 'greenfield-proof', command: 'node scripts/check-readme-catalog.mjs --project-root .' })
    assert.equal(before['package.json'], undefined, 'prospective empty project cannot reuse an existing package')
    assert.ok(after['package.json']?.sha256, 'generated project package must exist in observed root inventory')
    const text = readBoundFile(arm.artifacts?.['package.json'])
    assert.equal(sha256(text), after['package.json'].sha256, 'generated package bytes must match observed root inventory')
    assert.equal(JSON.parse(text).name, selected.projectName, 'generated root package identity must match prelaunch selection')
  } else {
    assert.equal(arm.kind, 'brownfield')
    assert.deepEqual(selected, { mode: 'catalog', source: 'emitted/repo-catalog.json', command: 'node scripts/check-readme-catalog.mjs --catalog emitted/repo-catalog.json', sourceSha256: selected.sourceSha256 })
    assert.match(selected.sourceSha256, /^[0-9a-f]{64}$/)
    assert.ok(before['nx.json']?.sha256, 'observed brownfield Nx marker required')
    assert.equal(before[selected.source]?.sha256, selected.sourceSha256, 'catalog source must be bound before launch')
    assert.deepEqual(after[selected.source], before[selected.source], 'emitted catalog cannot drift during repair')
    const text = readBoundFile(arm.artifacts?.[selected.source])
    assert.equal(sha256(text), selected.sourceSha256, 'retained catalog source must match prelaunch bytes')
    catalogProjects(text, (root) => before[root]?.directory === true && after[root]?.directory === true)
  }
  assert.ok(Array.isArray(proposal?.commands), 'native proposal commands required')
  const proposed = proposal.commands.filter((entry) => catalogInvocation(entry.command, arm.scratchRoot, entry.cwd) !== null)
  assert.equal(proposed.length, 1, 'propose exactly one selected catalog command, never alternatives or duplicates')
  assert.equal(catalogInvocation(proposed[0].command, arm.scratchRoot, proposed[0].cwd), selected.command, 'native proposal must use the prelaunch selected catalog mode')
  const actual = commands.filter((entry) => catalogInvocation(entry.command, arm.scratchRoot) !== null)
  assert.equal(actual.length, 1, 'execute exactly one selected catalog check, never alternatives or duplicates')
  assert.ok(matchesGateCommand(actual[0].command, selected.command, arm.scratchRoot), 'actual catalog check must use selected mode with native cwd proof')
  assert.equal(actual[0].exitCode, 0, 'selected native catalog check must succeed')
}

function nativeSessionIdentity(host, raw, sessionRaw, scratch) {
  assert.ok(['claude', 'codex'].includes(host), 'known native host required')
  const output = rows(raw), session = rows(sessionRaw)
  const headers = host === 'claude' ? output.filter((row) => row.type === 'system' && row.subtype === 'init') : output.filter((row) => row.type === 'thread.started')
  assert.equal(headers.length, 1, 'exactly one native invocation header required')
  const id = host === 'claude' ? headers[0].session_id : headers[0].thread_id
  assert.ok(typeof id === 'string' && id, 'native host session identity required')
  let version
  if (host === 'claude') {
    assert.equal(headers[0].cwd, scratch)
    for (const row of output.filter((row) => row.session_id)) assert.equal(row.session_id, id, 'stdout cannot mix native sessions')
    const identified = session.filter((row) => row.sessionId)
    assert.ok(identified.length > 0, 'retained Claude session identity required')
    for (const row of identified) assert.equal(row.sessionId, id, 'stdout and retained session identities must agree')
    version = headers[0].claude_code_version
  } else {
    const metadata = session.filter((row) => row.type === 'session_meta')
    assert.equal(metadata.length, 1, 'exactly one retained Codex session metadata record required')
    assert.equal(metadata[0].payload?.id, id, 'stdout and retained session identities must agree')
    assert.equal(metadata[0].payload?.cwd, scratch)
    version = metadata[0].payload?.cli_version
  }
  assert.ok(typeof version === 'string' && version.trim(), 'native host version required')
  return { sessionId: id, version }
}
function validateInvocationMetadata(arm, observation) {
  assert.equal(observation.request.argv[0], arm.executable, 'receipt executable must equal observed launch argv')
  assert.ok(arm.executable === arm.host || arm.executable.endsWith(`/${arm.host}`), 'observed executable must name the native host')
  const labelled = arm.host === 'claude' ? `${observation.version} (Claude Code)` : `codex-cli ${observation.version}`
  assert.ok(arm.version === observation.version || arm.version === labelled, 'receipt version must equal native host version or its known CLI label')
}

function validateObservation(observation, stage, host = REAL_WRAPPER_HOST) {
  const { request, before, after, events, result } = observation
  assert.equal(request.stage, stage)
  assert.ok(typeof request.scratch === 'string' && request.scratch.startsWith('/'), 'absolute scratch root required')
  assert.ok(Array.isArray(request.argv) && request.argv.length > 0, 'observed launch argv required')
  assert.equal(result.exit, 0, 'native process must complete successfully')
  if (request.gateWrapper) {
    validateGateWrapper(request.gateWrapper, host)
    assert.deepEqual(request.clearedHostOverrides, CAPBUILD_CLEARED_OVERRIDES, 'launch must bind clearing the vetted wrapper override variables')
    assert.deepEqual(result.clearedHostOverrides, request.clearedHostOverrides, 'observer must actually clear the prebound wrapper overrides')
  }
  if (request.sourceSnapshotSha256) assert.equal(result.sourceSnapshotSha256, request.sourceSnapshotSha256, 'native source inputs must remain frozen throughout invocation')
  assert.equal(events.overflow, false, 'watcher overflow invalidates evidence')
  assert.equal(result.overflow, false, 'watcher overflow invalidates evidence')
  assert.ok(Array.isArray(events.events), 'observer event list required')
  assert.equal(result.eventCount, events.events.length, 'observer event count must match')
  for (const event of events.events) {
    assert.ok(Number.isInteger(event.mask) && event.mask >= 0, 'numeric event mask required')
    assert.ok(Number.isFinite(event.elapsed) && event.elapsed >= 0, 'event time required')
    assert.ok(typeof event.path === 'string' && !event.path.startsWith('/') && !event.path.split('/').includes('..'), 'observer event path stays in scratch')
    assert.equal(event.mask & 0x4000, 0, 'raw watcher overflow invalidates evidence')
  }
  for (const tree of [before, after]) {
    assert.ok(tree && typeof tree === 'object' && !Array.isArray(tree), 'observed snapshot required')
    for (const [path, entry] of Object.entries(tree)) {
      assert.ok(path && !path.startsWith('/') && !path.split('/').includes('..'), 'snapshot path stays in scratch')
      assert.ok(entry && typeof entry === 'object', 'snapshot entry required')
      assert.equal([typeof entry.sha256 === 'string', entry.directory === true, typeof entry.symlink === 'string'].filter(Boolean).length, 1, 'snapshot entry has one known type')
      if (entry.sha256) assert.match(entry.sha256, /^[a-f0-9]{64}$/)
      if (!Object.hasOwn(entry, 'symlink')) assert.ok(Number.isInteger(entry.mode), 'observed filesystem mode required')
    }
  }
  if (stage !== 'execution') {
    assert.ok(!events.events.some((event) => event.mask & MUTATIONS), `${stage} mutation is forbidden even if reverted`)
    assert.deepEqual(after, before, `${stage} snapshot must remain identical`)
  }
}

function readBoundFile(reference) {
  assert.ok(reference && typeof reference.path === 'string', 'retained evidence file reference required')
  const bytes = readFileSync(resolve(ROOT, reference.path))
  assert.equal(sha256(bytes), reference.sha256, 'retained evidence digest must match actual bytes')
  return bytes.toString('utf8')
}
function validateNativeAuthority(host, raw, sessionRaw, scratch) {
  if (host === 'claude') {
    const init = rows(raw).find((row) => row.type === 'system' && row.subtype === 'init')
    assert.equal(init?.cwd, scratch)
    assert.equal(init?.permissionMode, 'auto', 'Claude must retain inherited automatic approval review')
    return { permissionMode: init.permissionMode }
  }
  const contexts = rows(sessionRaw).filter((row) => row.type === 'turn_context').map((row) => row.payload)
  assert.ok(contexts.length, 'native Codex permission metadata required')
  for (const context of contexts) {
    assert.equal(context.cwd, scratch)
    assert.equal(context.approvals_reviewer, 'auto_review')
    assert.equal(context.approval_policy, 'on-request')
    assert.equal(context.sandbox_policy?.type, 'workspace-write')
    assert.equal(context.sandbox_policy.network_access, false, 'unrestricted sandbox network is not inherited')
    assert.equal(context.permission_profile?.type, 'managed')
    assert.equal(context.permission_profile?.network, 'restricted')
    assert.equal(context.permission_profile?.file_system?.type, 'restricted')
    const entries = context.permission_profile?.file_system?.entries
    assert.ok(Array.isArray(entries), 'native filesystem grants required')
    assert.ok(entries.every((entry) => ['read', 'write'].includes(entry.access)), 'known native filesystem access modes required')
    assert.ok(entries.some((entry) => entry.access === 'write' && entry.path?.type === 'path' && entry.path.path === scratch), 'native scratch write grant required')
    for (const entry of entries.filter((entry) => entry.access === 'write')) {
      const path = entry.path
      assert.ok(path?.type === 'path' && path.path === scratch || path?.type === 'special' && ['slash_tmp', 'tmpdir'].includes(path.value?.kind), 'additional writable source roots expand authority')
    }
  }
  return { sandbox: 'workspace-write', approvalsReviewer: 'auto_review', network: 'restricted' }
}

function readStage(reference, stage, host) {
  assert.ok(reference?.directory, `missing ${stage} observer capture`)
  const retained = Object.fromEntries(STAGE_FILES.map((name) => [name, readBoundFile({ path: resolve(ROOT, reference.directory, name), sha256: reference.sha256?.[name] })]))
  const observation = Object.fromEntries(['request', 'before', 'after', 'events', 'result'].map((name) => [name, JSON.parse(retained[`${name}.json`])]))
  validateObservation(observation, stage)
  assert.equal(sha256(retained['stdout.jsonl']), observation.result.stdoutSha256)
  assert.equal(resolve(observation.request.evidence), resolve(ROOT, reference.directory), 'observer request binds capture directory')
  observation.raw = retained['stdout.jsonl']
  observation.sessionRaw = readBoundFile(reference.session)
  observation.commands = nativeCommands(host, observation.raw)
  Object.assign(observation, nativeSessionIdentity(host, observation.raw, observation.sessionRaw, observation.request.scratch))
  observation.observedAuthority = validateNativeAuthority(host, observation.raw, observation.sessionRaw, observation.request.scratch)
  return observation
}

const NX_OPTIONAL_GATES = ['unit-scoped', 'unit-affected', 'unit-impacted']
const OPTIONAL_GATE_KEYS = Object.keys(JSON.parse(readFileSync(resolve(ROOT, 'plugins/zeroh-roadmap/cli/roadmap.config.schema.json'), 'utf8')).properties.gateCommands.properties).filter(key => !CORE_GATES.includes(key))
function validateOptionalGateBindings(proposal, config) {
  assert.deepEqual(Object.keys(proposal?.gates ?? {}).sort(), [...CORE_GATES].sort(), 'approval must bind every canonical gate')
  const optional = proposal.optionalGates ?? {}
  assert.ok(optional && typeof optional === 'object' && !Array.isArray(optional), 'optional gates must be an object')
  for (const key of Object.keys(optional)) assert.ok(OPTIONAL_GATE_KEYS.includes(key), 'optional gate must belong to the roadmap schema')
  const bindings = {...proposal.gates, ...optional}
  for (const command of Object.values(bindings)) assert.ok(typeof command === 'string' && command.trim(), 'approved gate binding must be explicit')
  if (proposal.delivery?.adapter === 'nx-monorepo') for (const key of NX_OPTIONAL_GATES) assert.ok(optional[key] && optional[key] !== 'none', 'Nx optional selector may not be omitted or declared absent')
  if (config) assert.deepEqual(config.gateCommands, bindings, 'generated gate bindings must equal the approved core and optional union')
  return bindings
}
function optionalGateCommand(proposal, slot, configuredCommand) {
  const run = proposal.optionalGateRuns?.[slot]
  assert.ok(run && typeof run === 'object', 'optional gate needs its own approved input')
  const kind = slot.endsWith('-impacted') ? 'range' : 'manifest'
  assert.deepEqual(Object.keys(run.substitutions ?? {}), [kind], 'exactly one slot-specific substitution required')
  const token = `{${kind}}`, placeholders = configuredCommand.match(/\{[^{}]*\}/g) ?? []
  assert.deepEqual(placeholders, [token], 'one supported literal placeholder required')
  const value = run.substitutions[kind]
  assert.ok(typeof value === 'string' && value, 'literal substitution value required')
  assert.match(value, kind === 'range' ? /^[a-f0-9]{40}\.\.[a-f0-9]{40}$/ : /^@\/[A-Za-z0-9_./-]+$/, 'unsafe or nonliteral optional gate input')
  assert.ok(!value.split('/').some(part => part === '..' || part === '.'), 'optional input traversal rejected')
  assert.match(run.inputSha256 ?? '', /^[a-f0-9]{64}$/, 'optional input digest required')
  const resolvedCommand = configuredCommand.replace(token, value)
  const argv = literalArgv(resolvedCommand), expected = ['node', 'scripts/run-nx-test-tier.mjs', value]
  assert.ok(canonical(argv) === canonical(expected) || canonical(argv) === canonical(['env', 'NX_DAEMON=false', ...expected]), 'optional gate must invoke the actual bound selector, without extra commands')
  return {run, kind, value, resolvedCommand}
}
function validateOptionalGateEvidence({arm, proposal, slot, configuredCommand, after, commands, evidence}, host = REAL_WRAPPER_HOST) {
  assert.ok(NX_OPTIONAL_GATES.includes(slot), 'unsupported native optional selector slot')
  assert.equal(evidence?.slot, slot, 'optional gate evidence belongs to this slot')
  assert.equal(evidence.command, configuredCommand)
  assert.equal(evidence.configuredCommand, configuredCommand)
  assert.equal(evidence.cwd, arm.scratchRoot)
  const {run, kind, value, resolvedCommand} = optionalGateCommand(proposal, slot, configuredCommand)
  assert.deepEqual(evidence.substitutions, run.substitutions, 'receipt substitutions must equal the approved slot input')
  assert.equal(evidence.inputSha256, run.inputSha256)
  assert.equal(after['scripts/run-nx-test-tier.mjs']?.sha256, sha256(readFileSync(resolve(ROOT, 'plugins/zeroh-greenfield/templates/scripts/run-nx-test-tier.mjs'))), 'executed selector must equal the installed source template')
  const pathsValid = paths => {
    assert.ok(Array.isArray(paths) && paths.length > 0, 'nonempty scope paths required')
    assert.deepEqual(paths, [...new Set(paths)].sort(), 'scope paths must be sorted and unique')
    for (const path of paths) {
      assert.ok(typeof path === 'string' && safeArtifactPath(path) && !/[\r\n\0,]/.test(path), 'unsafe scope path')
      assert.ok(after[path]?.sha256 && !after[path].symlink, 'scope target must be an observed regular file')
    }
  }
  let paths
  if (kind === 'manifest') {
    const absolute = value.slice(1)
    assert.ok(absolute.startsWith(arm.scratchRoot + '/'), 'manifest must be inside this scratch root')
    const path = absolute.slice(arm.scratchRoot.length + 1)
    assert.ok(safeArtifactPath(path), 'unsafe relative manifest path')
    assert.ok(after[path]?.sha256 && !after[path].symlink, 'observed regular manifest required')
    const reference = arm.optionalInputs?.[slot]
    assert.ok(reference && lstatSync(resolve(ROOT, reference.path)).isFile(), 'retained manifest must be a regular file')
    let bytes, manifest
    assert.doesNotThrow(() => { bytes = readBoundFile(reference); manifest = JSON.parse(bytes) }, 'malformed or changed retained manifest')
    assert.equal(sha256(bytes), run.inputSha256, 'approved manifest bytes changed')
    assert.equal(after[path].sha256, run.inputSha256, 'retained manifest differs from the observed input')
    assert.deepEqual(Object.keys(manifest).sort(), ['paths', 'protocol'], 'scope manifest schema must match its production owner')
    assert.equal(manifest.protocol, SCOPE_MANIFEST_PROTOCOL)
    paths = manifest.paths; pathsValid(paths)
    const tests = paths.map(path => /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[cm]?[jt]sx?$/.test(path))
    assert.ok(slot.endsWith('-scoped') ? tests.every(Boolean) : tests.some(value => !value), 'manifest must exercise its actual selector tier')
  } else {
    assert.equal(sha256(value), run.inputSha256, 'approved range digest changed')
    const [base, head] = value.split('..'); assert.notEqual(base, head, 'range needs distinct commits')
    const headCalls = commands.filter(entry => matchesGateCommand(entry.command, 'git rev-parse HEAD', arm.scratchRoot))
    assert.equal(headCalls.length, 1, 'one actual HEAD proof required')
    assert.equal(headCalls[0].exitCode, 0); assert.equal(headCalls[0].output.trim(), head, 'range must end at the actual fixture HEAD')
    const ancestryCalls = commands.filter(entry => matchesGateCommand(entry.command, `git merge-base --is-ancestor ${base} ${head}`, arm.scratchRoot))
    assert.equal(ancestryCalls.length, 1, 'one actual exact ancestry proof required')
    assert.equal(ancestryCalls[0].exitCode, 0, 'impacted range base must be an ancestor of its head')
    const diffCalls = commands.filter(entry => matchesGateCommand(entry.command, `git diff --name-only -z ${value}`, arm.scratchRoot))
    assert.equal(diffCalls.length, 1, 'one actual exact-range diff required')
    assert.equal(diffCalls[0].exitCode, 0)
    assert.ok(diffCalls[0].output.endsWith('\0'), 'complete NUL-delimited actual diff required')
    paths = diffCalls[0].output.slice(0, -1).split('\0'); pathsValid(paths)
  }
  const native = commands.find(entry => entry.id === evidence.toolCallId)
  const envelope = validateGateExecutionEvidence({...evidence, configuredCommand: resolvedCommand}, native, resolvedCommand, arm.scratchRoot, arm.gateWrapper, host)
  const selections = native.output.split(/\r?\n/).flatMap(line => { try { const value = JSON.parse(line); return value && Object.hasOwn(value, 'tier') ? [value] : [] } catch { return [] } })
  assert.equal(selections.length, 1, 'actual single selector result required')
  assert.equal(selections[0].tier, slot.endsWith('-scoped') ? 'scoped' : 'affected', 'fallback or wrong selector tier cannot count as scoped execution')
  return {...envelope, configuredCommand, substitutions: run.substitutions, inputSha256: run.inputSha256}
}

// Execution-stage session suffix only: the earlier proposal discovery is not
// constrained to the newly approved operational plan.
function validateApprovedExecution({ proposal, config, commands, host, sessionRaw, raw, scratch }) {
  assert.deepEqual(Object.keys(proposal?.gates ?? {}).sort(), [...CORE_GATES].sort(), 'approval must bind every canonical gate')
  validateOptionalGateBindings(proposal, config)
  for (const command of Object.values(proposal.gates)) assert.ok(typeof command === 'string' && command.trim(), 'approved gate must be explicit')
  assert.ok(Array.isArray(proposal.commands) && proposal.commands.length > 0, 'complete approved command plan required')
  const plan = proposal.commands.map((entry) => {
    assert.equal(entry.cwd, scratch, 'every approved operation must name the scratch cwd')
    assert.ok(typeof entry.command === 'string' && entry.command.trim(), 'complete approved command text required')
    return entry.command
  })
  assert.equal(new Set(plan).size, plan.length, 'approved commands must be unique and execute once')
  assert.equal(commands.length, plan.length, 'no missing or extra native execution commands')
  for (let index = 0; index < plan.length; index++) {
    assert.equal(commandAtCwd(commands[index].command, scratch), plan[index], 'native operational command must exactly match approved text and order')
    assert.equal(commands[index].exitCode, 0, 'every approved operation must complete successfully')
  }
  const calls = []
  const execArguments = (name, args) => {
    assert.ok(args && typeof args === 'object' && !Array.isArray(args), 'native exec arguments must be a JSON object')
    if (name === 'write_stdin') {
      assert.ok(Object.keys(args).every(key => ['session_id', 'chars', 'yield_time_ms', 'max_output_tokens'].includes(key)), 'polling has no hidden options')
      assert.ok(Number.isInteger(args.session_id) && args.session_id > 0, 'polling requires an existing native session id')
      assert.ok(args.chars === undefined || args.chars === '', 'polling cannot inject commands')
      return
    }
    assert.ok(Object.keys(args).every(key => ['cmd', 'workdir', 'sandbox_permissions', 'justification', 'max_output_tokens', 'yield_time_ms', 'shell', 'login', 'tty'].includes(key)), 'exec envelope has only known options')
    assert.equal(args.workdir, scratch, 'native exec workdir must equal approved scratch')
    assert.ok(args.shell === undefined || args.shell === '/bin/bash', 'native shell cannot reinterpret approved command')
    assert.ok(args.tty === undefined || args.tty === false, 'execution uses a noninteractive shell')
    assert.ok(args.sandbox_permissions === undefined || ['use_default', 'require_escalated'].includes(args.sandbox_permissions), 'native approval policy cannot be replaced')
    calls.push({ command: args.cmd })
  }
  for (const row of rows(sessionRaw)) {
    if (host === 'claude' && row.type === 'assistant') {
      for (const block of Array.isArray(row.message?.content) ? row.message.content : []) {
        if (block.type !== 'tool_use') continue
        assert.ok(['Bash', 'Read', 'Glob', 'Grep'].includes(block.name), 'execution cannot bypass approved shell through another native tool')
        if (block.name === 'Bash') calls.push({ id: block.id, command: block.input?.command })
      }
    } else if (host === 'codex' && row.type === 'response_item' && ['custom_tool_call', 'function_call'].includes(row.payload?.type)) {
      const item = row.payload, name = item.name?.replace(/^functions\./, '')
      if (name === 'exec') {
        // Deliberately bounded transparent envelope, not a JavaScript interpreter.
        const match = /^\s*text\s*\(\s*await\s+tools\.(exec_command|write_stdin)\s*\(\s*(\{[\s\S]*\})\s*\)\s*\)\s*;?\s*$/.exec(item.input)
        assert.ok(match, 'custom exec must contain one transparent JSON exec or polling call')
        let args
        try { args = JSON.parse(match[2]) } catch { assert.fail('custom exec arguments must be literal JSON without code') }
        execArguments(match[1], args)
      } else {
        assert.ok(['exec_command', 'write_stdin'].includes(name), 'execution cannot bypass approved commands through other native tools')
        let args
        try { args = JSON.parse(item.arguments) } catch { assert.fail('native function arguments must be literal JSON') }
        execArguments(name, args)
      }
    }
  }
  assert.ok(['claude', 'codex'].includes(host), 'known native host required')
  assert.equal(calls.length, commands.length, 'all native tool commands need observed execution evidence')
  calls.forEach((call, index) => {
    if (host === 'claude') assert.equal(call.id, commands[index].id, 'Claude tool id must match observed completion')
    assert.equal(commandAtCwd(call.command, scratch), plan[index], 'native session command must equal approved operation')
  })
  for (const row of rows(raw)) assert.notEqual(row.item?.type, 'file_change', 'direct native file changes bypass approved shell commands')
}

const DELIVERY_PATHS=['.github/greenfield-delivery.json','.github/workflows/ci.yml','.github/workflows/release.yml','scripts/ci-shard-plan.mjs']
const ACTIONLINT_PROBE="if command -v actionlint >/dev/null 2>&1; then command -v actionlint; actionlint -version; else printf '%s\\n' 'ACTIONLINT_UNAVAILABLE'; fi"
function validateDeliveryEvidence({arm,proposal,before,after,commands}){
 const delivery=proposal?.delivery;assert.ok(delivery,'complete delivery proposal required');assert.deepEqual(arm.delivery,delivery,'receipt delivery must equal actual approved proposal')
 assert.equal(delivery.provider,'github-actions');assert.ok(Object.hasOwn(DELIVERY_ADAPTERS,delivery.adapter));assert.equal(delivery.configPath,DELIVERY_PATHS[0]);assert.deepEqual(delivery.workflowPaths,DELIVERY_PATHS.slice(1,3));assert.equal(delivery.plannerPath,DELIVERY_PATHS[3]);assert.ok(typeof delivery.releaseEnvironment==='string'&&delivery.releaseEnvironment.trim())
 const existing=delivery.workflowPaths.filter(path=>before[path]).sort();assert.deepEqual(delivery.collision?.existingPaths,existing,'every collision requires an exact prior path');assert.equal(delivery.collision.preserveUntilApproval,true);assert.equal(delivery.collision.decision,existing.length?'merge':'create','existing workflows require explicit merge approval')
 assert.deepEqual(Object.keys(delivery.collision.mergeManifests??{}).sort(),existing,'exact workflow merge manifests required')
 const text={};for(const path of DELIVERY_PATHS){
  assert.ok(after[path]?.sha256,`installed delivery artifact missing: ${path}`);text[path]=readBoundFile(arm.artifacts?.[path]);assert.equal(sha256(text[path]),after[path].sha256,'retained delivery bytes differ from observed output')
  assert.ok(proposal.artifacts.some(item=>item.path===path),'delivery file requires explicit approved artifact path')
 }
 assert.equal(text[DELIVERY_PATHS[3]],readFileSync(resolve(ROOT,'plugins/zeroh-greenfield/templates/scripts/ci-shard-plan.mjs'),'utf8'),'installed planner must equal approved template bytes')
 const config=JSON.parse(text[DELIVERY_PATHS[0]]);validateDeliveryConfig(config);assert.equal(config.archetype,delivery.adapter);assert.equal(config.release.environment,delivery.releaseEnvironment)
 const workflows={};for(const name of ['ci','release']){
  const path=`.github/workflows/${name}.yml`,document=deliveryYaml.safeLoad(text[path]),template=deliveryYaml.safeLoad(readFileSync(resolve(ROOT,`plugins/zeroh-greenfield/templates/github/workflows/${name}.yml`),'utf8'))
  if(name==='release')template.jobs.deploy.environment=delivery.releaseEnvironment
  for(const [job,value]of Object.entries(template.jobs))assert.deepEqual(document.jobs?.[job],value,`generated delivery job changed: ${job}`)
  assert.deepEqual(document.permissions,template.permissions);assert.deepEqual(document.concurrency,template.concurrency);assert.deepEqual(document.on,template.on,'delivery lifecycle trigger drift')
  if(before[path]){
   const preserved=readBoundFile(arm.existingWorkflowArtifacts?.[path]);assert.equal(sha256(preserved),before[path].sha256,'existing workflow baseline bytes missing')
   const prior=deliveryYaml.safeLoad(preserved),merge=delivery.collision.mergeManifests[path]
   assert.equal(merge.beforeSha256,sha256(preserved),'merge baseline digest differs from actual prior workflow')
   assert.deepEqual(merge.preservedJobs,[...Object.keys(prior.jobs??{})].sort(),'every prior job must be named for preservation')
   for(const job of merge.preservedJobs)assert.deepEqual(document.jobs[job],prior.jobs[job],`preexisting workflow job overwritten: ${job}`)
   const replacements=merge.replacements??{},keys=Object.keys(prior).filter(key=>key!=='jobs').sort()
   for(const key of Object.keys(replacements))assert.ok(keys.includes(key),'replacement must name an existing top-level field')
   assert.deepEqual(merge.preservedTopLevel,keys.filter(key=>!Object.hasOwn(replacements,key)),'every prior top-level field requires preservation or an explicit replacement')
   for(const key of merge.preservedTopLevel)assert.deepEqual(document[key],prior[key],`undeclared workflow field replacement: ${key}`)
   for(const [key,delta]of Object.entries(replacements)){
    assert.deepEqual(Object.keys(delta).sort(),['after','before'],'replacement requires exact before and after values')
    assert.deepEqual(delta.before,prior[key],`incorrect approved workflow before value: ${key}`)
    assert.deepEqual(delta.after,document[key],`unapproved workflow replacement value: ${key}`)
   }
   const priorComments=preserved.split('\n').filter(line=>/^\s*#/.test(line))
   assert.deepEqual(merge.preservedComments,priorComments,'every prior comment/marker line must be bound byte-exactly')
   const installedLines=text[path].split('\n')
   for(const line of new Set(priorComments))assert.ok(installedLines.filter(value=>value===line).length>=priorComments.filter(value=>value===line).length,'prior workflow comment or marker removed')
  }
  workflows[name]=document
 }
 const expected=`${arm.gateWrapper.executable} --env GREENFIELD_DELIVERY_ROOT=${arm.scratchRoot} node --test ${ROOT}/plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs`
 assert.deepEqual(delivery.validationCommands,[{command:expected,cwd:arm.scratchRoot}],'complete installed-output suite required, without filters')
 assert.equal(arm.deliveryValidation?.commandExits?.length,1)
 const record=arm.deliveryValidation.commandExits[0],native=commands.find(c=>c.id===record.toolCallId)
 assert.ok(native);assert.equal(native.exitCode,0);assert.equal(record.exitCode,0);assert.equal(record.nativeCommand,native.command);assert.ok(matchesGateCommand(native.command,expected,arm.scratchRoot),'actual full installed-output validation command required')
 const total=native.output.match(/^# tests (\d+)\s*$/m),passed=native.output.match(/^# pass (\d+)\s*$/m);assert.ok(total&&Number(total[1])>0,'terminal TAP totals required');assert.ok(passed);assert.equal(passed[1],total[1],'all mandatory tests must complete')
 for(const field of ['fail','cancelled','skipped'])assert.match(native.output,new RegExp(`^# ${field} 0\\s*$`,'m'),'full suite must have zero incomplete/failed tests')
 const probe=arm.deliveryValidation.actionlint,actual=commands.find(c=>c.id===probe?.toolCallId);assert.ok(actual);assert.equal(actual.exitCode,0);assert.equal(probe.exitCode,0);assert.equal(probe.command,actual.command);assert.equal(probe.output,actual.output);assert.ok(matchesGateCommand(actual.command,ACTIONLINT_PROBE,arm.scratchRoot),'actual optional linter availability probe required')
 if(actual.output.trim()!=='ACTIONLINT_UNAVAILABLE'){const lines=actual.output.trim().split(/\r?\n/);assert.ok(lines[0].startsWith('/'),'linter executable path required');assert.ok(lines.slice(1).join('\n').match(/(?:version\s*)?\d+\.\d+/),'linter version required')}
 const schemaDigests={shardManifest:sha256(canonical(DELIVERY_SCHEMA_CONTRACT.shardManifest)),evidence:sha256(canonical(DELIVERY_SCHEMA_CONTRACT.evidence)),planner:sha256(text[DELIVERY_PATHS[3]])}
 if(arm.deliveryValidation.schemaDigests)assert.deepEqual(arm.deliveryValidation.schemaDigests,schemaDigests)
 return {adapter:delivery.adapter,workflowPaths:delivery.workflowPaths,releaseEnvironment:delivery.releaseEnvironment,schemaDigests}
}
export function validateDeliverySelection(input) {
  const { arm, proposal, before, after } = input
  if (Object.hasOwn(proposal, 'delivery') || Object.hasOwn(arm, 'delivery')) {
    return validateDeliveryEvidence(input)
  }
  assert.equal(arm.deliveryValidation, undefined, 'deferred delivery cannot claim validation')
  for (const path of DELIVERY_PATHS) {
    assert.deepEqual(after[path], before[path], `deferred delivery must preserve ${path}`)
  }
  return { deferred: true }
}
function validateObservedArm(arm) {
  validateGateWrapper(arm.gateWrapper)
  const stages = Object.fromEntries(['proposal', 'execution', 'rerun'].map((stage) => [stage, readStage(arm.stages?.[stage], stage, arm.host)]))
  const { proposal, execution, rerun } = stages
  assert.equal(new Set(Object.values(arm.stages).map((stage) => resolve(ROOT, stage.directory))).size, 3, 'stages have independently retained observer captures')
  assert.equal(new Set(Object.values(stages).map((stage) => sha256(stage.raw))).size, 3, 'stage transcripts cannot be copied')
  for (const stage of Object.values(stages)) {
    validateInvocationMetadata(arm, stage)
    assert.deepEqual(stage.request.gateWrapper, arm.gateWrapper, 'every native launch must bind the same wrapper executable, digest and envelope')
    assert.equal(stage.request.scratch, arm.scratchRoot)
    assert.deepEqual(stage.request.catalogCheck, arm.catalogCheck, 'observer launch binds catalog mode and source before execution')
    assert.equal(stage.request.invocationBaseCommit, arm.invocationBaseCommit, 'observer launch binds invocation ancestry')
    assert.equal(stage.request.sourceSnapshotSha256, arm.sourceSnapshotSha256, 'observer launch binds the pre-invocation source snapshot')
    assert.equal(stage.sessionId, proposal.sessionId, 'resume the same native session for ordered evidence')
    assert.doesNotMatch(stage.request.argv.join(' '), /dangerously-(?:skip-permissions|bypass-approvals-and-sandbox)|--sandbox(?:=|\s+)danger-full-access|--yolo/)
  }
  assert.deepEqual(execution.before, proposal.after, 'no unobserved writes between proposal and approval')
  assert.deepEqual(rerun.before, execution.after, 'no unobserved writes between execution and rerun')
  assert.equal(sessionEvents(arm.host, proposal.sessionRaw).filter((event) => event.type === 'approval').length, 0, 'proposal has no advance approval')
  validateApprovalSlice(arm.host, proposal.sessionRaw, execution.sessionRaw)
  sessionSuffix(execution.sessionRaw, rerun.sessionRaw)
  assert.equal(arm.beforeTreeHash, treeHash(proposal.before))
  assert.equal(arm.afterTreeHash, treeHash(execution.after))
  assert.equal(arm.secondRun.treeHash, treeHash(rerun.after))
  const before = proposal.before, after = execution.after
  const diff = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => canonical(before[path]) !== canonical(after[path])).sort()
  assert.ok(diff.length > 0, 'execution must create the promised artifacts')
  assert.deepEqual(arm.diffPaths, diff, 'diff is mechanically derived, including directories and .git')
  const nativeProposal = nativeObjects(arm.host, proposal.raw, 'proposal')
  assert.equal(nativeProposal.length, 1, 'one complete native proposal required')
  validateCatalogCheck(arm, before, after, nativeProposal[0], execution.commands)
  validateDeliverySelection({arm,proposal:nativeProposal[0],before,after,commands:execution.commands})
  const approved = proposalPaths(arm.host, proposal.raw)
  assert.deepEqual(arm.approvedGapAllowlist, approved, 'receipt allowlist is a projection of the native proposal, never a post-hoc diff expansion')
  assert.ok(diff.every((path) => approvedPath(path, after[path] ?? before[path], approved)), 'every changed path must be covered by the native approved proposal')
  for (const path of approved) {
    const target = path.replace(/\/$/, '')
    assert.ok(after[target], `promised artifact missing: ${path}`)
    if (path.endsWith('/')) assert.equal(after[target].directory, true, `promised directory missing: ${path}`)
  }
  assert.ok(execution.events.events.some((event) => event.mask & MUTATIONS), 'changed execution tree needs observer mutation evidence')
  for (const path of REQUIRED_HOMES) {
    assert.ok(after[path]?.sha256, `required independent home missing: ${path}`)
    assert.equal(sha256(readBoundFile(arm.artifacts?.[path])), after[path].sha256, `retained artifact bytes match observer: ${path}`)
  }
  const configs = Object.keys(after).filter((path) => /(^|\/)roadmap.config.json$/.test(path))
  assert.equal(configs.length, 1, 'never initialize a second config')
  const configText = readBoundFile(arm.artifacts?.[configs[0]])
  assert.equal(sha256(configText), after[configs[0]].sha256)
  const config = JSON.parse(configText)
  validateApprovedExecution({ proposal: nativeProposal[0], config, commands: execution.commands, host: arm.host, sessionRaw: sessionSuffix(proposal.sessionRaw, execution.sessionRaw), raw: execution.raw, scratch: arm.scratchRoot })
  for (const slot of CORE_GATES) assert.ok(Object.hasOwn(config.gateCommands ?? {}, slot), `missing canonical gate: ${slot}`)
  assert.ok(Array.isArray(arm.commandExits) && arm.commandExits.length > 0, 'gate exit evidence required')
  for (const [slot, command] of Object.entries(config.gateCommands)) {
    assert.equal(typeof command, 'string', `${slot} must have an explicit binding`)
    assert.doesNotMatch(command, /\bcapbuild\b/, 'consumer gate config cannot contain the host wrapper')
    if (command === 'none') {
      assert.ok(arm.approvedAbsentGates?.includes(slot), `${slot} absence must be approved`)
      continue
    }
    const evidence = arm.commandExits.find((entry) => entry.slot === slot)
    assert.ok(evidence, `missing executed consumer gate: ${slot}`)
    if (!CORE_GATES.includes(slot) && /[{}]/.test(command)) {
      validateOptionalGateEvidence({arm, proposal: nativeProposal[0], slot, configuredCommand: command, after, commands: execution.commands, evidence})
      continue
    }
    assert.equal(evidence.command, command)
    assert.equal(evidence.cwd, arm.scratchRoot)
    const native = execution.commands.find((entry) => entry.id === evidence.toolCallId)
    assert.ok(native, `${slot} needs native command provenance`)
    const executionEvidence = validateGateExecutionEvidence(evidence, native, command, arm.scratchRoot, arm.gateWrapper)
    if (arm.host === 'claude' && arm.kind === 'empty' && ['build', 'types', 'unit'].includes(slot)) assert.ok(executionEvidence.wrapper, `${slot} must satisfy the native Claude capbuild guard`)


  }
  if (CORE_GATES.every((slot) => config.gateCommands[slot] === 'none')) validateStructuralChecks(execution.commands, arm.scratchRoot, arm.catalogCheck)
  if (arm.kind === 'brownfield') {
    assert.ok(arm.existingHomePaths?.length > 0, 'existing homes must be enumerated')
    for (const path of arm.existingHomePaths) {
      assert.ok(before[path], `existing home absent from baseline: ${path}`)
      assert.deepEqual(after[path], before[path], `existing home changed: ${path}`)
    }
  }
  const audits = nativeObjects(arm.host, rerun.raw, 'audit-result')
  assert.equal(audits.length, 1, 'one native second-run audit result required')
  assert.deepEqual(audits[0].proposals, [], 'native second audit must propose nothing')
  assert.deepEqual(audits[0].writes, [])
  assert.deepEqual(audits[0].gaps, [], 'native second audit must report no remaining gaps')
  assert.deepEqual(arm.secondRun.proposals, [])
  assert.deepEqual(arm.secondRun.writes, [])
  assert.equal(arm.transcriptSha256, sha256(execution.raw))
  return stages
}

export { validateOptionalGateBindings, optionalGateCommand, validateOptionalGateEvidence, validateDeliveryEvidence, DELIVERY_PATHS, ACTIONLINT_PROBE, validateApprovedExecution, CAPBUILD_DEFAULTS, CAPBUILD_CLEARED_OVERRIDES, validateGateWrapper, unwrapGateExecution, validateGateExecutionEvidence, selectCatalogCheck, validateCatalogCheck, matchesGateCommand, validateStructuralChecks, nativeSessionIdentity, validateInvocationMetadata, receipt, validateSourceFiles, validateSourceBinding, safeArtifactPath, nativeObjects, proposalPaths, approvedPath, sessionEvents, sessionSuffix, validateApprovalSlice, nativeCommands, validateObservation, readBoundFile, validateNativeAuthority, readStage, validateObservedArm, ROOT, sha256, APPROVAL, MUTATIONS, STAGE_FILES, CORE_GATES, REQUIRED_HOMES, rows, canonical, treeHash }
