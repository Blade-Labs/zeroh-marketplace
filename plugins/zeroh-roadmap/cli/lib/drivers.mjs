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

/** Probe evidence pasted verbatim from the command each entry's verifiedAt names. */
const CODEX_PROBE_OUTPUT = `codex-cli 0.144.5
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
      argv: ({ worktree }) => ['exec', '--dangerously-bypass-approvals-and-sandbox', '-m', CODEX_MODEL, '-C', worktree, '-'],
      promptChannel: 'stdin',
      // This host's bubblewrap cannot create loopback (bwrap RTM_NEWADDR under
      // apparmor_restrict_unprivileged_userns), so isolation is the worktree, not the sandbox.
      sandboxPosture: 'bypass',
    }),
    resume: 'codex resume [SESSION_ID] [--last]',
    roleCapabilities: Object.freeze({ subagents: 'native', headlessChild: true, hooks: true, plugins: true }),
    verifiedAt: Object.freeze({
      date: '2026-08-24',
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
      argv: ({ agents }) => ['-p', ...(agents ? ['--agents', agents] : [])],
      promptChannel: 'stdin',
      sandboxPosture: 'inherit',
    }),
    resume: 'claude --resume [SESSION_ID] | claude --continue',
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
})

/** The registry id whose binary runs `modelId`, or a throw naming every routable id. */
export function driverForModel(modelId) {
  const id = Object.hasOwn(MODEL_DRIVERS, modelId) ? MODEL_DRIVERS[modelId] : undefined
  if (!id) {
    throw new Error(
      `no registered driver runs model '${modelId}' — routable ids: ${Object.keys(MODEL_DRIVERS).join(', ')}. Add it to MODEL_DRIVERS in cli/lib/drivers.mjs alongside the driver entry that launches it`,
    )
  }
  return id
}

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
