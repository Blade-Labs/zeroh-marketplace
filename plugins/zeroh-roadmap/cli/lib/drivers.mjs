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
 * is unproven, never a claim of absence.
 *
 * An unregistered id (grok today) is an EMPTY SLOT, never a guess — resolveDriver throws.
 *
 * Entry shape:
 *   { id, family, bin,
 *     launch: { argv: ({ worktree }) => string[], promptChannel, sandboxPosture },
 *     resume, roleCapabilities, verifiedAt: { date, host, command, output } }
 */

/** Probe evidence pasted verbatim from the command each entry's verifiedAt names. */
const CODEX_PROBE_OUTPUT = `codex-cli 0.144.5
hooks                                stable             true
multi_agent                          stable             true
plugin_hooks                         removed            false
plugins                              stable             true`

const CLAUDE_PROBE_OUTPUT = `2.1.241 (Claude Code)
  --agents <json>                       JSON object defining custom agents (e.g.
  -p, --print                           Print response and exit (useful for`

export const DRIVERS = Object.freeze({
  codex: Object.freeze({
    id: 'codex',
    family: 'openai',
    bin: 'codex',
    launch: Object.freeze({
      argv: ({ worktree }) => ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', worktree, '-'],
      promptChannel: 'stdin',
      // This host's bubblewrap cannot create loopback (bwrap RTM_NEWADDR under
      // apparmor_restrict_unprivileged_userns), so isolation is the worktree, not the sandbox.
      sandboxPosture: 'bypass',
    }),
    resume: 'codex resume [SESSION_ID] [--last]',
    roleCapabilities: Object.freeze({ subagents: 'native', hooks: true, plugins: true }),
    verifiedAt: Object.freeze({
      date: '2026-08-24',
      host: 'illumination',
      command: "codex --version && codex features list | grep -E '^(hooks|multi_agent|plugin_hooks|plugins)\\b'",
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
    roleCapabilities: Object.freeze({ subagents: 'child-cli', headlessPrint: true }),
    verifiedAt: Object.freeze({
      date: '2026-08-24',
      host: 'illumination',
      command: "claude --version && claude --help | grep -E '^\\s*(--agents|-p,)'",
      output: CLAUDE_PROBE_OUTPUT,
    }),
  }),
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
