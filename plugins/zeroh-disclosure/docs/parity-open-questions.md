# Parity: open questions for live runs

The statuses in [features.md](features.md) come from the hosts' documentation and source, and from
the live runs their notes name. The questions below can only be answered by running the host. Each
names the features it affects and the exact check. Collected on 2026-09-28 for Codex CLI 0.158.0,
OpenCode 1.x (`opencode-ai` 1.18.33) and OpenCode 2 (`@opencode/cli` 2.0.18).

**How to run them.** Use a throwaway machine account or temporary folders for every home the host
and ZeroH read: `HOME`, `XDG_*`, `CODEX_HOME`, `ZEROH_HOME` and `ZEROH_CREDENTIAL_HOME`. Use fake
values only (a made-up key in a provider's shape, `ZEROHFAKE…` values), and a local fake
OpenAI-compatible provider on 127.0.0.1 where no real model turn is needed. Never point a check at
real settings, a real proxy or real credentials. When a check answers a question, update the
feature's status and note in `docs/features.json`, run `node scripts/features.mjs --write`, and
remove the question here.

## Codex (CLI 0.158.0)

1. **Does the PostToolUse `continue:false` replacement keep the turn going?** (`mask.tool-output`,
   `mask.file-read`) Install a PostToolUse hook that returns `continue:false` with the masked text
   in `reason`. In `codex exec`, have the model run `printf 'KEY=<fake key>'`. Check that the next
   request body, seen through the proxy or `RUST_LOG` request logging, carries only the masked
   `reason`, and that the turn goes on. The documentation says `continue:false` "stops normal
   processing"; the source shows no stop. Also check what the rollout JSONL stores for
   `ExecCommandEnd`: the raw output or the masked one.
2. **Is the output of a long-running command masked?** (`mask.background-output`) Run a command
   that prints a fake key and then sleeps longer than `yield_time_ms`. Confirm that the first
   `write_stdin` chunk reaches the model unmasked without the proxy, and masked with it.
3. **Does every request go through the proxy with a ChatGPT login?** (`mask.prompt`,
   `mask.context`, `proxy.upstream`) With `openai_base_url` pointing at the proxy, confirm that
   after the refused WebSocket upgrade Codex falls back to HTTP (0.158 prewarms the WebSocket at
   start: #47635, #47745), that zstd bodies decode, and that `/responses/compact`, memory, guardian
   auto-review, title and recap requests all use `openai_base_url`. Find which header
   (`session-id`, `thread-id` or `x-client-request-id`) equals the hooks' `session_id`.
4. **When does an `openai_base_url` written mid-session apply?** (`install.first-run`,
   `proxy.toggle`) Write the key from a UserPromptSubmit hook during a session and send another
   prompt. Expected: the proxy sees nothing until the next session.
5. **Can a dialog be answered without the user?** (`unmask.dialog`, `report-miss`) Call
   `request_unmask` under `approval_policy` `on-request`, `never`, full access, and
   `approvals_reviewer=auto_review`. Confirm that a form with a required enum field is never
   auto-accepted, and never answered by the Guardian reviewer
   (`review_guardian_mcp_elicitation`, core/src/session/mcp.rs:740).
6. **What is the plugin's MCP tool called?** (`unmask.dialog`, `mgmt.user-authority`) Install the
   plugin, list its MCP tools, and record the name Codex gives the server's tools
   (`mcp__zeroh-disclosure__request_unmask` or a namespaced form) and the PreToolUse `tool_name`
   for a call.
7. **Can the model pass as the user through a nested `codex exec`?** (`mgmt.user-authority`,
   `guard.host-cli`) Have the model run `codex exec "zeroh allow FAKE_KEY example.com"` from its
   shell. Check whether the nested UserPromptSubmit hook sees `CODEX_THREAD_ID` (or `CODEX_SANDBOX*`)
   in its environment, and whether the sandbox stops its writes to `ZEROH_HOME`.
8. **Do plugin hooks run on Windows?** (`platform.windows`, `restore.powershell`,
   `shell.powershell`) On Windows, install a hook with `commandWindows`, check that
   `%PLUGIN_ROOT%` expands under cmd, and that a PowerShell command reaches PreToolUse as `Bash`
   with only `{command}`.
9. **Does hook trust survive an update that leaves hooks.json unchanged?** (`install.auto-update`)
   Trust the hooks, publish a plugin update that changes code but not `hooks/hooks.json`, start
   Codex (it upgrades at start) and check that the hooks still run without a new trust prompt.
10. **Does late binding work in the sandbox?** (`restore.bash`) In `workspace-write`, restore a
    token into a command through a values file under `ZEROH_HOME`. Expected: the wrapper can
    `source` the file; its `rm` fails, so PostToolUse must delete it.

## OpenCode 1.x (`opencode-ai` 1.18.33) and OpenCode 2 (`@opencode/cli` 2.0.18)

1. **Does the v1 `config` hook change the running process?** (`install.first-run`,
   `proxy.upstream`) In the `config` hook, set a provider's `options.baseURL`, a `permission` and a
   `command`. Check with the fake provider whether requests go to the new baseURL and whether the
   command and permission apply in the same process, or only to the hook's copy.
2. **Does a v1 share upload raw bash output?** (`mask.tool-output`) With `share: auto`, run a bash
   command that prints a fake key. Check whether the share sync uploads the running-state
   `metadata.output` (stored raw in the `event` table) or only the final, masked parts.
3. **Do raw lines flash in the v1 TUI before the after hook runs?** (`mask.tool-output`) Run a
   long-running command that prints a fake key in the TUI, with `metadata` masked in
   `tool.execute.after`, and watch the live bash view.
4. **Can v1's `context.ask()` stand in for a dialog?** (`unmask.dialog`, `report-miss`) From a
   custom tool, ask with one pattern, pick "always", then ask with a different pattern: is the
   second ask approved without a prompt? Can the prompt show a free-text reason?
5. **Can the model answer v2 forms through `opencode api`?** (`guard.host-cli`,
   `mgmt.user-authority`, `unmask.dialog`) With the v2 background service running, have the model's
   shell use `opencode api` to answer a pending form or permission, or to run a TUI command. Check
   whether the service asks for its own authentication.
6. **Can a published v2 plugin import `@opencode/plugin`?** (`install.plugin`) A local plugin file
   that imports it failed to load (live run L14). Publish a test package to a local registry,
   install it with `opencode plugin add`, and check that it loads.
7. **Does the detection engine run in the plugin runtimes?** (`detect.keys-gitleaks`,
   `detect.pii-33`, `runtime.node`) Load the vendored engine (validator.js, libphonenumber-js) in a
   v1 and a v2 plugin, mask a fixture of fake values, and compare the result with Node. Record the
   package size and cold-start time.
8. **Does v1 pass `shell.env` to PowerShell on Windows?** (`restore.powershell`,
   `platform.windows`) On Windows, with pwsh as the shell, add `ZH_FAKE_KEY` in `shell.env` and run
   a command that uses `$env:ZH_FAKE_KEY`. Check that the value arrives through OpenCode's
   PowerShell wrapper.
9. **Do subagent sessions get every hook?** (all masking and restoring rows) Start a `task`
   subagent in v1 and in v2 and check that `chat.message` / `session.hook("prompt")`, the tool hooks
   and the context hooks fire with the child's sessionID.

## Claude Code

1. **Does the user see the typed-value suggestion?** (`detect.typed-random`) Type a random-looking
   fake value that matches no rule. The hook puts the `/zeroh-disclosure:report-miss` suggestion in
   `additionalContext`, which goes to the model; check whether anything reaches the screen.
