import { isDeepStrictEqual } from 'node:util'

/**
 * drivers — the ONE home for per-driver launch semantics and probed capabilities.
 *
 * Every model-binary argv, prompt channel, sandbox posture and resume mechanism lives in
 * DRIVERS; no launcher may carry its own (the ratchet in drivers.test.mjs holds that line).
 * Adding a driver is an entry here, never a launcher edit.
 *
 * `verifiedAt` carries PASTED probe output stamped with the host it was proven on: it names
 * where the claim held, never that it holds on YOUR host. `roadmap driver verify <id>` re-proves
 * it locally; `roadmap driver register` refuses an id without fresh same-host provenance.
 *
 * `roleCapabilities` carries ONLY what that entry's verifiedAt output evidences. An absent key
 * is unproven, never a claim of absence. Two keys answer different questions: `subagents` is how
 * this driver spawns children, `headlessChild` is whether ANOTHER driver can drive this one as a
 * headless child process (the reach `resolveRole` derives, MULTI-DRIVER.md §1).
 *
 * An unregistered id (grok today) is an EMPTY SLOT, never a guess — resolveDriver throws.
 *
 * `model` is the id the launcher PINS on the argv — a command, not an observation. The probe
 * proves the id is a real, API-supported, listed model on this host; it never proves it is the
 * server-side default, which the pin makes irrelevant. An entry without `model` cannot know
 * what ran, so driverStamp records null there rather than a guess.
 *
 * Entry shape:
 *   { id, family, bin, model?,
 *     launch: { argv: ({ worktree }) => string[], promptChannel, sandboxPosture },
 *     resume, roleCapabilities, verifiedAt: { date, host, command, output } }
 */

/** The one home for the pinned codex model id: the entry field and the argv share this value. */
const CODEX_MODEL = 'gpt-5.6-sol'


const AUTHORITY_PROFILES = Object.freeze({
  'read-only': Object.freeze({ filesystem: 'read-only', network: 'denied', gitPush: false, externalWrites: false }),
  'workspace-write': Object.freeze({ filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }),
  'isolated-unsafe': Object.freeze({ filesystem: 'unrestricted', network: 'allowed', gitPush: true, externalWrites: true }),
})
const FILESYSTEM_RANK = Object.freeze({ 'read-only': 0, 'workspace-write': 1, unrestricted: 2 })
const NETWORK_RANK = Object.freeze({ denied: 0, approval: 1, allowed: 2 })


export function authorityProfileBounds(profile) {
  if (!Object.hasOwn(AUTHORITY_PROFILES, profile)) throw new Error(`authority profile '${profile}' is unknown`)
  return structuredClone(AUTHORITY_PROFILES[profile])
}

function validateAuthorityPart(value, name, { allowInherit = false } = {}) {
  if (!value || typeof value !== 'object') throw new Error(`${name} authority is required`)
  const profiles = allowInherit ? ['inherit', ...Object.keys(AUTHORITY_PROFILES)] : Object.keys(AUTHORITY_PROFILES)
  if (!profiles.includes(value.profile)) throw new Error(`${name} authority profile '${value.profile}' is unknown`)
  const bounds = value.bounds
  if (!bounds || typeof bounds !== 'object') throw new Error(`${name} authority bounds are required`)
  if (!Object.hasOwn(FILESYSTEM_RANK, bounds.filesystem)) throw new Error(`${name} filesystem authority '${bounds.filesystem}' is unknown`)
  if (!Object.hasOwn(NETWORK_RANK, bounds.network)) throw new Error(`${name} network authority '${bounds.network}' is unknown`)
  if (typeof bounds.gitPush !== 'boolean') throw new Error(`${name} gitPush authority must be boolean`)
  if (typeof bounds.externalWrites !== 'boolean') throw new Error(`${name} externalWrites authority must be boolean`)
  const provenance = value.provenance
  if (name === 'parent' || provenance !== null) {
    if (!provenance || !['explicit-operator-invocation', 'managed-host-input', 'explicit-user-authorization'].includes(provenance.kind) || typeof provenance.source !== 'string' || provenance.source.trim().length === 0) {
      throw new Error(`${name} authority provenance requires a recognized kind and nonempty source`)
    }
  }
}

export function intersectAuthority(parent, request) {
  validateAuthorityPart(parent, 'parent')
  validateAuthorityPart(request, 'request', { allowInherit: true })
  if (request.profile === 'inherit' && !isDeepStrictEqual(request.bounds, parent.bounds)) throw new Error('inherit authority must preserve the exact parent bounds')
  for (const [dimension, rank] of [['filesystem', FILESYSTEM_RANK], ['network', NETWORK_RANK]]) {
    if (rank[request.bounds[dimension]] > rank[parent.bounds[dimension]]) throw new Error(`requested ${dimension} authority enlarges the parent ceiling`)
  }
  for (const dimension of ['gitPush', 'externalWrites']) {
    if (request.bounds[dimension] && !parent.bounds[dimension]) throw new Error(`requested ${dimension} authority enlarges the parent ceiling`)
  }
  if ((request.profile === 'isolated-unsafe' || (request.profile === 'inherit' && parent.profile === 'isolated-unsafe')) && request.provenance?.kind !== 'explicit-user-authorization') throw new Error('effective isolated-unsafe authority requires explicit user authorization provenance')
  return { parent: structuredClone(parent), request: structuredClone(request), effective: { profile: request.profile === 'inherit' ? parent.profile : request.profile, bounds: structuredClone(request.bounds) } }
}

function codexLaunchArgv({ worktree, authority, json = false, outputSchemaPath = null }) {
  if (!authority) throw new Error('effective authority envelope is required for Codex launch')
  const derived = intersectAuthority(authority.parent, authority.request)
  if (!isDeepStrictEqual(derived.effective, authority.effective)) throw new Error('effective authority envelope does not match its parent/request intersection')
  const { profile, bounds } = derived.effective
  if (profile === 'isolated-unsafe') {
    if (bounds.filesystem !== 'unrestricted' || bounds.network !== 'allowed' || !bounds.gitPush || !bounds.externalWrites) throw new Error('isolated-unsafe native mapping requires equally broad explicit bounds')
    return ['exec', '--dangerously-bypass-approvals-and-sandbox', ...(json ? ['--json'] : []), ...(outputSchemaPath ? ['--output-schema', outputSchemaPath] : []), '-m', CODEX_MODEL, '-C', worktree, '-']
  }
  if (!['read-only', 'workspace-write'].includes(profile) || bounds.filesystem !== profile || bounds.network !== 'denied' || bounds.gitPush || bounds.externalWrites) throw new Error(`authority profile '${profile}' has bounds the native Codex controls cannot represent`)
  return ['exec', '--ignore-user-config', '--sandbox', bounds.filesystem, ...(json ? ['--json'] : []), ...(outputSchemaPath ? ['--output-schema', outputSchemaPath] : []), '-c', 'approval_policy="on-request"', '-c', 'approvals_reviewer="auto_review"', '-c', 'sandbox_workspace_write.network_access=false', '-c', 'sandbox_workspace_write.writable_roots=[]', '-m', CODEX_MODEL, '-C', worktree, '-']
}

function codexResumeArgv(nativeSessionId, opts) {
  if (typeof nativeSessionId !== 'string' || nativeSessionId.trim().length === 0 || nativeSessionId.startsWith('-')) throw new Error('Codex resume requires an exact native session id')
  const argv = codexLaunchArgv({ ...opts, json: true })
  return [...argv.slice(0, -1), 'resume', nativeSessionId, '-']
}

const CLAUDE_SETTINGS = JSON.stringify({
  permissions: { blockReadsOutsideWorkingDirectories: true, deny: ["WebFetch", "WebSearch", "mcp__*", "Agent", "Task"] },
  sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, network: { allowedDomains: [], deniedDomains: ['*'], strictAllowlist: true } },
})

function claudeLaunchArgv({ authority, model, streamJson = false, schema = null }) {
  if (!authority) throw new Error('effective authority envelope is required for Claude launch')
  const derived = intersectAuthority(authority.parent, authority.request)
  if (!isDeepStrictEqual(derived.effective, authority.effective)) throw new Error('effective authority envelope does not match its parent/request intersection')
  if (MODEL_DRIVERS[model] !== 'claude') throw new Error('requested model is not registered to the Claude driver')
  const { profile, bounds } = derived.effective
  if (!['read-only', 'workspace-write'].includes(profile) || bounds.filesystem !== profile || bounds.network !== 'denied' || bounds.gitPush || bounds.externalWrites) {
    throw new Error('requested authority bounds cannot be represented by native Claude controls')
  }
  const tools = profile === 'read-only' ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Edit,Write,Bash'
  return ['-p', ...(streamJson ? ['--output-format', 'stream-json', '--verbose'] : []), ...(schema ? ['--json-schema', JSON.stringify(schema)] : []), '--model', model,
    '--restricted', '--permission-mode', 'auto', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--tools', tools, '--settings', CLAUDE_SETTINGS]
}

function claudeResumeArgv(nativeSessionId, opts) {
  if (typeof nativeSessionId !== 'string' || nativeSessionId.trim().length === 0 || nativeSessionId.startsWith('-')) throw new Error('Claude resume requires an exact native session id')
  return [...claudeLaunchArgv({ ...opts, streamJson: true }), '--resume', nativeSessionId]
}

function parseClaudeResult(result, { expectedSessionId = null, expectedModel = null } = {}) {
  if (!result || !Number.isInteger(result.exitCode)) throw new Error('Claude transport result is malformed')
  const records = []
  for (const line of String(result.stdout ?? '').split('\n').filter((value) => value.trim())) {
    try { records.push(JSON.parse(line)) } catch { throw new Error('Claude native stream JSON is malformed') }
  }
  const identities = records.filter((record) => record?.type === 'system' && record?.subtype === 'init')
  if (identities.length !== 1) throw new Error('Claude native stream requires exactly one system init identity')
  const identity = identities[0]
  if (typeof identity.session_id !== 'string' || !identity.session_id.trim()) throw new Error('Claude native session identity is missing')
  if (expectedSessionId !== null && identity.session_id !== expectedSessionId) throw new Error('Claude resumed session identity does not match durable identity')
  if (expectedModel !== null && identity.model !== expectedModel) throw new Error('Claude native model identity does not match the requested model')
  const terminals = records.filter((record) => record?.type === 'result')
  if (terminals.length !== 1) throw new Error('Claude native stream requires exactly one terminal result')
  if (terminals[0].session_id !== identity.session_id) throw new Error('Claude terminal session identity does not match init identity')
  return { records, nativeSessionId: identity.session_id, terminal: terminals[0] }
}

function parseCodexResult(result, { expectedSessionId = null } = {}) {
  if (!result || !Number.isInteger(result.exitCode)) throw new Error('Codex transport result is malformed')
  const records = []
  for (const line of String(result.stdout ?? '').split('\n').filter((value) => value.trim())) {
    try { records.push(JSON.parse(line)) } catch { throw new Error('Codex native JSONL is malformed') }
  }
  const identities = records.filter((record) => record?.type === 'thread.started').map((record) => record.thread_id)
  if (identities.length === 0 || identities.some((value) => typeof value !== 'string' || !value.trim())) throw new Error('Codex native thread identity is missing')
  if (new Set(identities).size !== 1) throw new Error('Codex native thread identity changed within one execution')
  if (expectedSessionId !== null && identities[0] !== expectedSessionId) throw new Error('Codex resumed thread identity does not match durable identity')
  const terminal = records.findLast((record) => ['turn.completed', 'turn.failed', 'error'].includes(record?.type))
  if (!terminal) throw new Error('Codex native JSONL has no terminal protocol record')
  return { records, nativeSessionId: identities[0], terminal }
}

export function parseNativeResult(id, result, opts = {}) {
  const parser = resolveDriver(id).protocol?.parseResult
  if (typeof parser !== 'function') throw new Error("driver '" + id + "' has no native result parser")
  return parser(result, opts)
}

function phaseResultCandidate(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return structuredClone(value)
  if (typeof value !== 'string') return null
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null } catch { return null }
}

export function projectNativeFrame(id, frame) {
  if (!frame || typeof frame !== 'object') return null
  if (id === 'codex') {
    if (frame.type === 'thread.started') return { kind: 'identity', nativeSessionId: frame.thread_id }
    if (frame.type === 'item.completed' && frame.item?.type === 'agent_message') return { kind: 'phase-result', phaseResult: phaseResultCandidate(frame.item.text) }
    if (['turn.completed', 'turn.failed', 'error'].includes(frame.type)) return { kind: 'terminal', protocolTerminal: { type: frame.type, ...(frame.subtype === undefined ? {} : { subtype: frame.subtype }), ...(frame.is_error === undefined ? {} : { is_error: frame.is_error }), ...(frame.usage === undefined ? {} : { usage: structuredClone(frame.usage) }) } }
  }
  if (id === 'claude') {
    if (frame.type === 'system' && frame.subtype === 'init') return { kind: 'identity', nativeSessionId: frame.session_id, model: frame.model }
    if (frame.type === 'result') return { kind: 'terminal', nativeSessionId: frame.session_id, protocolTerminal: { type: frame.type, ...(frame.subtype === undefined ? {} : { subtype: frame.subtype }), ...(frame.is_error === undefined ? {} : { is_error: frame.is_error }), ...(frame.usage === undefined ? {} : { usage: structuredClone(frame.usage) }) }, phaseResult: phaseResultCandidate(frame.structured_output ?? frame.result) }
  }
  return null
}

export function validateNativeTerminal(driverId, terminal) {
  const type = typeof terminal === 'string' ? terminal : terminal?.type
  if (driverId === 'codex' && !['turn.completed', 'turn.failed', 'error'].includes(type)) return false
  if (driverId === 'claude' && !(type === 'result' || (typeof type === 'string' && type.startsWith('result.')))) return false
  if (!['codex', 'claude'].includes(driverId)) return false
  if (typeof terminal === 'string') return true
  return Boolean(terminal) && !Array.isArray(terminal)
    && Object.keys(terminal).every((key) => ['type', 'subtype', 'is_error', 'usage'].includes(key))
    && (terminal.subtype === undefined || typeof terminal.subtype === 'string')
    && (terminal.is_error === undefined || typeof terminal.is_error === 'boolean')
    && (terminal.usage === undefined || (terminal.usage !== null && typeof terminal.usage === 'object' && !Array.isArray(terminal.usage)))
}
/** Probe evidence pasted verbatim from the command each entry's verifiedAt names. */
const CODEX_PROBE_OUTPUT = `codex-cli 0.153.4
hooks                                stable             true
multi_agent                          stable             true
plugin_hooks                         removed            false
plugins                              stable             true
"slug":"gpt-5.6-sol"
Usage: codex exec [OPTIONS] [PROMPT]`

const CLAUDE_PROBE_OUTPUT = `2.1.241 (Claude Code)
  --agents <json>                       JSON object defining custom agents (e.g.
  -p, --print                           Print response and exit (useful for`

export const DRIVERS = Object.freeze({
  codex: Object.freeze({
    id: 'codex',
    family: 'openai',
    bin: 'codex',
    model: CODEX_MODEL,
    launch: Object.freeze({
      argv: codexLaunchArgv,
      promptChannel: 'stdin',
      sandboxPosture: 'authority-envelope',
    }),
    resume: 'codex exec resume [SESSION_ID]',
    resumeOperation: Object.freeze({ argv: codexResumeArgv }),
    protocol: Object.freeze({ parseResult: parseCodexResult }),
    roleCapabilities: Object.freeze({ subagents: 'native', headlessChild: true, hooks: true, plugins: true }),
    verifiedAt: Object.freeze({
      date: '2026-09-06',
      host: 'illumination',
      command:
        "codex --version && codex features list | grep -E '^(hooks|multi_agent|plugin_hooks|plugins)\\b'"
        + " && codex debug models | grep -o '\"slug\":\"gpt-5.6-sol\"'"
        + " && codex exec --help | grep -E '^Usage: codex exec'",
      output: CODEX_PROBE_OUTPUT,
    }),
  }),
  claude: Object.freeze({
    id: 'claude',
    family: 'anthropic',
    bin: 'claude',
    launch: Object.freeze({
      argv: claudeLaunchArgv,
      promptChannel: 'stdin',
      sandboxPosture: 'authority-envelope',
    }),
    resume: 'claude --resume [SESSION_ID]',
    resumeOperation: Object.freeze({ argv: claudeResumeArgv }),
    protocol: Object.freeze({ parseResult: parseClaudeResult }),
    roleCapabilities: Object.freeze({ subagents: 'child-cli', headlessChild: true }),
    verifiedAt: Object.freeze({
      date: '2026-08-24',
      host: 'illumination',
      command: "claude --version && claude --help | grep -E '^\\s*(--agents|-p,)'",
      output: CLAUDE_PROBE_OUTPUT,
    }),
  }),
})

/**
 * The model ids this plugin binds by name, so no consumer restates one (the one-home rule
 * `drivers.test.mjs` ratchets). `SOL` IS the codex entry's pinned model — one value, two readers.
 */
export const MODEL_IDS = Object.freeze({
  FABLE: 'claude-fable-5',
  SONNET: 'claude-sonnet-5',
  OPUS: 'claude-opus-5',
  SOL: CODEX_MODEL,
  /** The codex family's higher-judgment model (`codex debug models` slug, illumination 2026-09-06);
   *  bindable by alias for a per-role lead (owner ruling 2026-09-07 20:04 UTC: "astra architect,
   *  sol developer"). The lane's default pin stays CODEX_MODEL; a role lead pins this on its child. */
  ASTRA: 'gpt-6-astra',
})

/**
 * Harness ALIAS → the model id it names. A card's frontmatter and a consumer's
 * `modelPolicy.judgeModel` can only ever carry an alias (neither can hold a full model id), so a
 * reader that needs a MODEL normalises through this map — `resolveRole` before it prepends a
 * judgeModel to a chain. It is not the only alias vocabulary in the CLI: `cli/commands/result.mjs`
 * ALIAS_FAMILY maps the same aliases to family PREFIXES for the attribution reconcile, and carries
 * `haiku`, which no chain names. The two answer different questions; neither derives the other.
 */
export const MODEL_ALIASES = Object.freeze({
  fable: MODEL_IDS.FABLE,
  sonnet: MODEL_IDS.SONNET,
  opus: MODEL_IDS.OPUS,
  sol: MODEL_IDS.SOL,
  astra: MODEL_IDS.ASTRA,
})

/**
 * Which registered driver's binary runs a given model id. ROUTING ONLY: presence here is not a
 * capability claim — `roleCapabilities` + `verifiedAt` carry what was probed, per driver.
 */
export const MODEL_DRIVERS = Object.freeze({
  [MODEL_IDS.FABLE]: 'claude',
  [MODEL_IDS.SONNET]: 'claude',
  [MODEL_IDS.OPUS]: 'claude',
  [MODEL_IDS.SOL]: 'codex',
  [MODEL_IDS.ASTRA]: 'codex',
})

/** The registry entry for `id`, or a throw naming the offending id and every known one. */
export function resolveDriver(id) {
  const entry = Object.hasOwn(DRIVERS, id) ? DRIVERS[id] : undefined
  if (!entry) {
    const known = Object.keys(DRIVERS).join(', ')
    throw new Error(
      `unknown driver '${id}' — known drivers: ${known}. The registry is committed code: land the ${id} entry in cli/lib/drivers.mjs, then \`roadmap driver verify ${id}\` proves it on this host and \`roadmap driver register ${id}\` prints the canonical entry`,
    )
  }
  return entry
}

/** The argv for `id`'s launch, sourced from the registry so no caller carries a literal. */
export function launchArgv(id, opts = {}) {
  return resolveDriver(id).launch.argv(opts)
}

/** Exact-session resume argv, owned by the same registry as fresh launch. */
export function resumeArgv(id, nativeSessionId, opts = {}) {
  const resume = resolveDriver(id).resumeOperation
  if (!resume || typeof resume.argv !== 'function') throw new Error("driver '" + id + "' has no executable resume contract")
  return resume.argv(nativeSessionId, opts)
}

/**
 * The attribution a LAUNCHER stamps for `entry`: { model, lane }, where lane is the registry
 * id (the DriverShape lane vocabulary), not a journal's own run/review lane.
 *
 * An entry that pins no model yields model: null — present and null, so a reader can tell an
 * unpinned lane from a forgotten stamp.
 */
export function driverStamp(entry) {
  return { model: entry.model ?? null, lane: entry.id }
}
