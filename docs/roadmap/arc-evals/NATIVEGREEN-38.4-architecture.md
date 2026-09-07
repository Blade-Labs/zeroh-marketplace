# NATIVEGREEN 38.4 authority decision

Date: 2026-09-07
Verdict: `PROCEED_WITH_FIX`
Role execution: authorized native Sol fallback; exact runtime unverified. No Fable consultation is claimed.

## Decision

The Claude adapter uses a registry-owned restricted tool profile. Workspace-write exposes
`Read,Glob,Grep,Edit,Write,Bash` so the phase executor can run tests and make local commits; read-only
exposes `Read,Glob,Grep`. WebFetch, browser/computer tools, arbitrary MCP tools, and subagents remain unavailable.

Registry launch and resume argv therefore share these authority-derived arguments:

```text
--restricted
--permission-mode auto
--strict-mcp-config
--mcp-config {"mcpServers":{}}
--tools Read,Glob,Grep[,Edit,Write,Bash]
--settings <canonical inline JSON>
```

The read-only profile exposes `Read,Glob,Grep`. The workspace-write profile adds `Edit,Write,Bash`.
`--restricted` confines file tools to the working directories and ignores user, project, and local
settings; `--strict-mcp-config` plus the empty explicit MCP config and tool allowlist prevents an
ambient MCP from becoming an external-write channel. `auto` provides the owner's requested automatic
review for routine work. Neither profile uses a permission bypass. The adapter starts in the exact
request worktree and does not add directories.

The inline settings object is defense in depth and stable registry data:

```json
{
  "permissions": {
    "blockReadsOutsideWorkingDirectories": true,
    "deny": ["WebFetch", "WebSearch", "mcp__*", "Agent", "Task"]
  },
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false,
    "network": {
      "allowedDomains": [],
      "deniedDomains": ["*"],
      "strictAllowlist": true
    }
  }
}
```

No `allowWrite`, `allowRead`, Unix-socket, excluded-command, Apple Events, weaker-isolation, or
unsandboxed exception is added. Network uses an empty allowlist, a wildcard deny, and strict allowlist;
deny takes precedence over an allowed wildcard. The restricted tool allowlist is load-bearing for
non-Bash surfaces, while `failIfUnavailable` and `allowUnsandboxedCommands: false` prevent Bash from
silently escaping the sandbox.

This mapping supports normal read, edit, test, and local-Git work. `gitPush: false` and
`externalWrites: false` remain the existing recorded semantic controls, matching the authority schema;
network isolation also prevents a normal push from reaching a remote. A task requiring network access,
an external write, arbitrary MCP, or a path outside the worktree receives a typed capability
hold/refusal before request persistence or launch. A later explicit unsafe
authority may define a separate registry profile; this task does not infer one and never emits
`--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or
`bypassPermissions`.

## Provenance and identity

Task 38.4 records registry capability and installed-help evidence. Installed `2.1.257` help proves
parser availability, not model execution or sandbox effectiveness. Task 38.5 owns the shared fresh
current-host provenance gate before selecting either native adapter; 38.4 does not add a second reader
or receipt. Direct injected tests make no live-host claim.

The requested model must resolve through the existing registry to the Claude driver. Parse exactly one
stream-JSON `system/init` identity and require nonblank `session_id` plus reported `model` exactly equal
to the canonical requested model. Require exactly one terminal `result` for the same session. A missing,
duplicate, changing, or mismatched session/model/result refuses before durable binding or terminal
result persistence. Native model, agent type, or role-like output never replaces semantic `roleId`.
Transport completion maps to the existing reducer-owned `exited` event and the atomic terminal
observation/result receipt established by task 38.3; it never means phase intent succeeded.

Fresh start, resume, ownership, pending-action persistence, and unknown-outcome handling reuse the
Codex algorithm and the existing `AgentDriver`, `RunReceipt`, and executor arm. Keep a thin Claude
adapter with shared small pure helpers only where byte-identical parsing-neutral orchestration already
exists; do not introduce a second driver state machine or a speculative adapter framework.

## Sources and scope

- Installed evidence: `.building/nativegreen-installed-claude-help.txt` (`--restricted`, `--tools`,
  `--permission-mode`, `--settings`, `--strict-mcp-config`).
- Official settings reference: <https://code.claude.com/docs/en/settings-reference>.
- Official sandbox guide: <https://code.claude.com/docs/en/sandboxing>.

Implementation includes one narrow shared durable-orchestration helper consumed immediately by the
Codex and Claude thin wrappers; driver id, registry argv, native parsing, and model/session checks stay
driver-specific. This consolidates the already-fixed persistence, arm, resume, buffering, reducer, and
terminal-receipt algorithm without creating a new state owner. The existing authority schema already
represents Claude with sandbox filesystem, sandbox-config network, and semantic-only Git/external
controls; no schema widening is needed. No global settings mutation, second provenance reader,
recovery framework, or live model call is part of 38.4.
