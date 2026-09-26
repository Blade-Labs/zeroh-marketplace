# How to use ZeroH Disclosure

Use these recipes to try the plugin, manage destinations, inspect local evidence, respond to
notices, work with the local proxy, run PowerShell, and remove the plugin.

## Contents

- [Try it without a Stripe account](#try-it-without-a-stripe-account)
- [Run the CLI](#run-the-cli)
- [Control the session banner](#control-the-session-banner)
- [Manage vault retention](#manage-vault-retention)
- [Keep receipts for longer or shorter](#keep-receipts-for-longer-or-shorter)
- [Allow a destination host](#allow-a-destination-host)
- [Allow a value into an MCP tool](#allow-a-value-into-an-mcp-tool)
- [Manage unmask caps, grants, and the optional status line](#manage-unmask-caps-grants-and-the-optional-status-line)
- [Report a value that was not masked](#report-a-value-that-was-not-masked)
- [Read and verify a receipt](#read-and-verify-a-receipt)
- [Run a local report](#run-a-local-report)
- [Verify the session receipt bundle](#verify-the-session-receipt-bundle)
- [Respond to notices](#respond-to-notices)
- [Find settings, keys, and session data](#find-settings-keys-and-session-data)
- [Understand the settings guard](#understand-the-settings-guard)
- [Work with the local proxy](#work-with-the-local-proxy)
- [Run with PowerShell](#run-with-powershell)
- [Uninstall and clean up](#uninstall-and-clean-up)

## Try it without a Stripe account

The [README](../README.md#try-it) walks through a Stripe test key against the real Stripe API.
Without a Stripe account, any made-up value works against `httpbin.org`, which echoes the Bearer
token it received:

1. Put `STRIPE_KEY=sk_test_ZEROHFAKE123` in a test project's `.env` and start `claude` there.
2. Allow the host first: `/zeroh-disclosure:allow STRIPE_KEY httpbin.org`.
3. Ask Claude to "call https://httpbin.org/bearer with STRIPE_KEY as a Bearer token". httpbin
   answers `200` with `"authenticated": true`: the real value reached the server, while its echo
   came back to the model as `[API_KEY-…]`.
4. Ask for a host you have not allowed, and see it blocked.

Personal data works the same way, and you can show one kind of it to Claude for a while. Put a few
addresses a sign-up form rejected into a log:

```text
$ cat > signup-errors.log <<'EOF'
rejected anna.o'neil@example.co.uk by validateEmail
rejected lars+work@example.com by validateEmail
rejected jürgen@müller.example by validateEmail
rejected "quoted name"@example.com by validateEmail
rejected user@[192.0.2.1] by validateEmail
EOF
$ claude
> Read signup-errors.log and find out why validateEmail rejects these addresses.
```

Claude sees `rejected [EMAIL-…] by validateEmail` on every line, so it asks to unmask `EMAIL` with
its reason (you can also type `/zeroh-disclosure:unmask EMAIL find why validateEmail rejects
them`). Accept Claude Code's dialog for 15 minutes and Claude sees the addresses: an apostrophe, a
`+` tag, non-ASCII letters, a quoted local part and an IP literal, all valid addresses that a
simple pattern rejects. Tell Claude to stop, and email addresses are masked again at once.

The website's [step-by-step test guide](https://witty-river-07cbf8503.1.azurestaticapps.net/try/)
goes further: naming tokens, a value ZeroH misses, and receipts.

## Run the CLI

Every user action is a slash command inside Claude Code (`/zeroh-disclosure:doctor`,
`:allow`, `:proxy`, `:settings`, `:unmask`, `:report`, `:uninstall`, …); run them there first.
The recipes below show the terminal form for when Claude Code can't start or for scripts. A
marketplace install does not put a `zeroh-disclosure` command on your `PATH`: run the plugin's
own script with Node.js. Every message that points to a fix prints this command with the path
filled in:

```bash
node "<plugin-root>/bin/zeroh-disclosure.mjs" doctor
```

Where this guide writes `zeroh-disclosure <command>`, run
`node "<plugin-root>/bin/zeroh-disclosure.mjs" <command>`. The proxy keeps its own copy at
`<ZEROH_HOME>/bin/zeroh-disclosure-proxy/bin/zeroh-disclosure.mjs`, which works after the plugin is
removed.

Project commands (`allow`, `vault`, `receipt`, `tokens`, `report` and others) act on the same
project root the hooks use: `CLAUDE_PROJECT_DIR` when Claude Code sets it, else the current
directory. Pass `--cwd <project>` to choose it explicitly, for example when your terminal is in a
subdirectory.

## Control the session banner

The first session for a `ZEROH_HOME` shows the full view: the five-line banner plus Free-plan
coverage, current limitations, receipt location, and these controls. ZeroH creates
`<ZEROH_HOME>/banner-shown` after that view, then uses the five-line banner on later sessions.

Choose a persistent mode with `/zeroh-disclosure:settings banner full|compact|off`, or from your
terminal:

```bash
zeroh-disclosure banner full
zeroh-disclosure banner compact
zeroh-disclosure banner off
```

This writes `<ZEROH_HOME>/banner.json`. Set `ZEROH_BANNER=full|compact|off` before starting Claude
Code for an environment override. `full` always includes the coverage details, `compact` is one
line, and `off` hides the normal banner. Warnings about secrets in `CLAUDE.md`, an active unmask
grant, or the proxy being off appear in every mode, including `off`.

Run `/zeroh-disclosure:status` inside Claude Code to show the full view at any time. The command
uses command-expansion preprocessing to collect read-only status before its prompt reaches the
model, so the model does not make a tool call. The banner is plain text: Claude Code shows it as
it is, so it carries no colour codes.

## Manage vault retention

Detected values expire seven days after their last mask, restore, or on-screen display (the
last-use time is recorded at most once an hour). Choose a different window in the environment or
in `<project>/.zeroh.env`:

```bash
ZEROH_VAULT_RETENTION=30d claude
ZEROH_VAULT_RETENTION=session claude
echo 'ZEROH_VAULT_RETENTION=30d' >> .zeroh.env
```

The accepted values are `session`, `7d`, and `30d`. Retention is applied only at lifecycle points:
`SessionStart`, `SessionEnd`, and `zeroh-disclosure vault clear`. Masking, restoring, the display
hook and the local proxy never remove a mapping. `SessionStart` reads your setting (environment
first, then `.zeroh.env`) and stores it in the project vault; `SessionEnd` and `vault status` use
that stored policy, so a proxy or terminal started with a different environment cannot shorten it.
A new setting takes effect at the next session start.

`session` removes the detected mappings a session used when that session ends. Values the proxy
masked but no hook ever used, and leftovers from a session that crashed, are removed by the next
fresh start (`claude` or `/clear`) once they have not been used for 24 hours; a fresh start never
removes values another live session used recently. Two sessions in the same project each keep their
own values until they end. After a session ends, `claude --resume` cannot restore its values: the
resumed transcript keeps the tokens, and ZeroH denies a tool call that uses one (see
[An expired token is denied](troubleshooting.md#an-expired-token-is-denied)). Use `7d` or `30d` if
you resume sessions and need their values.

Values found in `.env` and supported credential files are re-read at `SessionStart` and do not age
out while they remain present. If a known value disappears from its source, its existing mapping
becomes detected and starts following the configured window. Values you reported with
`/zeroh-disclosure:report-miss` do not age out either, in any mode, so they stay masked until
`zeroh-disclosure vault clear` removes them. Existing vault entries without
last-use metadata, or with a last-use time in the future after a clock change, are treated as used
now.

Inspect aggregate state without revealing a stored value, with
`/zeroh-disclosure:settings vault status` or:

```bash
zeroh-disclosure vault status
```

The result contains the retention mode and where it came from, total count, counts by type, oldest
last-use age, and the number of expired tokens remembered. `vault status` never changes the vault.
To remove every mapping for the current project immediately:

```bash
zeroh-disclosure vault clear
zeroh-disclosure vault clear --yes
```

The first form asks for confirmation; `--yes` is intended for deliberate automation.
`/zeroh-disclosure:settings vault clear --yes` does the same inside Claude Code. From a
subdirectory it clears the project the directory belongs to, and it says how many values it
removed (or that the project had no vault). It also removes pending restore files under
`<ZEROH_HOME>/run` and the keys behind this project's receipt commitments, so nothing you asked
to remove stays readable. A hook or proxy that was already running cannot bring cleared values
back; it can only add values it detects afresh.

Clearing or expiry does not rewrite transcripts. ZeroH keeps a value-free record of each expired
token (its type and expiry time, never the value or a hash of it) for 90 days. An expired token is
never reassigned to a different value, and a tool call that uses one is denied with a message
asking the model to have you share the value again. Re-encountering the same value gives it a new
token. A value that is still retained keeps its existing stable token.

## Keep receipts for longer or shorter

Receipts are kept for 90 days by default. Change it with
`/zeroh-disclosure:settings receipts keep <forever|1y|90d|30d>`, with
`zeroh-disclosure receipts keep <period>`, or with `ZEROH_RECEIPT_RETENTION` in the environment or
`<ZEROH_HOME>/config.env`. A project's `.zeroh.env` may only shorten it. Older sessions are removed
at the next Claude Code start, at most once a day; the current session and the vault are never
touched. `/zeroh-disclosure:status` shows the policy in force. Receipts contain no values.

## Allow a destination host

Only you can allow a host: type `/zeroh-disclosure:allow NAME HOST` in Claude Code, or run the
terminal form below. Rules apply to the current project (or the one given with `--cwd`). When a
destination is blocked, the denial shows the exact slash command, and the terminal form with
`--cwd` filled in.

Allow one known variable name:

```bash
zeroh-disclosure allow STRIPE_KEY payments-gateway.example.com
```

Expected output:

```text
allowed: STRIPE_KEY → payments-gateway.example.com
```

You can key a rule by variable name, a token such as `[API_KEY-3f9a1c]`, a type such as
`API_KEY`, or `*`:

```bash
zeroh-disclosure allow API_KEY api.example.com
zeroh-disclosure allow '*' staging.example.com
zeroh-disclosure allow --list
```

`allow --list` (or `/zeroh-disclosure:allow` with no arguments) prints, for each value this project
knows by name, where it may go and why, without the value:

```text
Where each known value may go (values are never shown):
  GITHUB_TOKEN → api.github.com, github.com, uploads.github.com, *.githubusercontent.com (built-in: GitHub) + staging.example.dev (your rule)
  INTERNAL_API_TOKEN → nowhere yet · allow with /zeroh-disclosure:allow INTERNAL_API_TOKEN <host>
  STRIPE_KEY → api.stripe.com, files.stripe.com, connect.stripe.com (built-in: Stripe)
```

`--json` adds the signed rules as they are stored. Remove a rule with:

```bash
zeroh-disclosure allow --remove STRIPE_KEY payments-gateway.example.com
```

Expected output:

```text
removed: STRIPE_KEY → payments-gateway.example.com
```

The CLI normalises the host, writes `<ZEROH_HOME>/projects/<project>/allow.json`, and signs the canonical `rules`
object with HMAC-SHA256. The 32-byte key is stored at `<ZEROH_HOME>/allow.key`. Both files are
requested with mode `0600` on Unix-like systems.

The model cannot grant itself a destination. `PreToolUse` denies direct reads or edits of the
allow file, shell commands that refer to ZeroH settings or invoke `zeroh-disclosure allow`, and
equivalent MCP input. If `allow.json` is changed without the key, the signature check fails and
the plugin ignores all rules in that file.

Built-in provider destinations and the signed project rules are additive. `localhost`,
`127.0.0.1`, and `::1` are always allowed. A command with no host has no destination to check.

## Allow a value into an MCP tool

An MCP server can send its input anywhere, so ZeroH does not judge an MCP call by the hosts its
input mentions, and a `localhost` URL in the input never counts. A value is restored into an MCP
tool only when you allow that server for it with `mcp:<server>`, where `<server>` is the part
between `mcp__` and the next `__` in the tool name (`mcp__stripe__create_refund` is `stripe`;
`mcp__claude_ai_Google_Drive__create_file` is `claude_ai_Google_Drive`):

```bash
zeroh-disclosure allow STRIPE_KEY mcp:stripe
```

Expected output:

```text
allowed: STRIPE_KEY → mcp:stripe
```

The rule is keyed like a host rule (variable name, token, type or `*`), stored in the same signed
`allow.json`, and protected from the model the same way. Remove it with
`zeroh-disclosure allow --remove STRIPE_KEY mcp:stripe`. Without a rule the token reaches the tool
unchanged, and the model is told that the value stays masked for that tool and which command you
can run to allow it. Hosts named in an allowed call must still be allowed for the value. ZeroH's
own MCP tools (`request_unmask`, `report_missed_secret`) always receive tokens.

## Manage unmask caps, grants, and the optional status line

By default every personal-data kind may be unmasked for 15 minutes, 1 hour or until the session
ends. Set a smaller cap yourself from a terminal; `0` disables unmasking for that kind:

```bash
zeroh-disclosure unmask caps EMAIL 15m
zeroh-disclosure unmask caps PHONE_NUMBER session
zeroh-disclosure unmask caps IBAN 0
zeroh-disclosure unmask caps --list
```

Secret and credential kinds are always `0 (fixed)` and cannot be configured. Caps are stored in
the HMAC-signed `<ZEROH_HOME>/unmask.json`; a hand edit is ignored.

When Claude calls `request_unmask`, the interactive Claude Code dialog offers "15 minutes"
(preselected, so Enter accepts it), "1 hour" and "Until the session ends"; → shows the others. A
cap that removes some says so in the dialog ("limited by your cap for EMAIL").
Accepting creates a signed per-project grant under
`<ZEROH_HOME>/grants/<project-hash>.json`. Decline and cancel create nothing. List or revoke active
grants with:

```bash
zeroh-disclosure unmask
zeroh-disclosure unmask revoke <grant-id>
zeroh-disclosure unmask revoke all
```

The same list and revoke actions are available as `/zeroh-disclosure:unmask` and
`/zeroh-disclosure:unmask revoke [id|all]`. `/zeroh-disclosure:unmask EMAIL <why>` has Claude
call `request_unmask` for that kind; the grant is made only if you accept the dialog. Grant and revoke actions are retained as signed local
receipt entries. Time grants expire on every hook check; session grants match only the Claude
session that accepted them.

To end an unmask early, tell Claude ("stop showing real email addresses"): it calls the
`end_unmask` tool, which ends the grants for that kind (or all) at once, without a dialog. The tool
can only end grants, never create or extend one.

`UserPromptSubmit` shows a one-line countdown while a grant is active. To put the same text in your
own Claude Code status line, make the CLI available on `PATH` and add this one line to your own
settings file:

```json
{
  "statusLine": { "type": "command", "command": "zeroh-disclosure statusline" }
}
```

The plugin never writes Claude Code settings for this feature. Run `zeroh-disclosure statusline`
first to verify the command in the same environment that starts Claude Code.

## Report a value that was not masked

Run `/zeroh-disclosure:report-miss` and enter the exact value, where it appeared, and why it looks
sensitive in the private ZeroH dialog. Do not put the value in chat. Claude may also call
`report_missed_secret {value, type_guess, where, why}` immediately after noticing an unmasked
value.

ZeroH adds the exact value to the encrypted project vault before asking what to do with the
shape-only report. The dialog says in one line what that report holds (type, length, provider
prefix if any, where it was found; never the value; `zeroh-disclosure reports show <id>` prints
the rest). Later tool output and proxy-inspected request text use the returned token. Content
already sent to the model cannot be recalled; rotate reported credentials promptly. The dialog asks
"What should ZeroH do with this report?":

- `Keep it on this computer` (preselected, so Enter keeps it): retain
  `<ZEROH_HOME>/reports/<id>.json`.
- `Delete it`: delete the shape report; the vault mapping remains active.

The dialog also says that sending reports to Blade Labs comes in 1.1. In 1.0 there is no upload
path at all.

Review or remove local reports from your own terminal. These commands display only report shape
and context, never vault values:

```bash
zeroh-disclosure reports list
zeroh-disclosure reports show <id>
zeroh-disclosure reports delete <id>
```

If no elicitation capability is available, a direct MCP report is saved locally and returns a
note without waiting. An empty slash-command request is refused because there is no private input
form. The limit is 20 reports per MCP session. Values shorter than 8 characters, all whitespace,
longer than 4096 characters or already containing a ZeroH token are refused.

## Read and verify a receipt

End a turn first. The `Stop` hook finalizes the receipt, writes
`~/.zeroh/projects/<project>/sessions/<session-id>/receipt.html`, and, on a turn where something was masked, stopped or
blocked, prints one line with its absolute path. When values were masked, a second line says what
Claude saw instead, with where each came from and never a value, for example `Claude saw
⟦API_KEY-10a254⟧ for STRIPE_KEY · ⟦EMAIL-3c1f02⟧ for typed` (at most three, then how many more;
`/zeroh-disclosure:mask-show` lists them all). A quiet turn prints nothing. Open the file locally.
The page opens with the receipt slip: values withheld per type, the `withheld` total, `values sent
to Claude`, the latest receipt id, the local signing key (`signed on this laptop · ECDSA P-256`),
and how many receipts verified. Below it are the session token map, anything that passed
unchecked, and one expandable section per turn with channels, destinations, policy, engine, and
signature status. It never renders a full masked value.

The slip counts only what ZeroH knows:

| Line                              | Meaning                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `withheld`                        | Every occurrence of a detected value replaced by a token before it reached the model, summed over the types listed. |
| `values sent to Claude`           | Detected values that reached the model in plain text: values you revealed under an unmask grant you approved.       |
| `shown under grants you approved` | Shown only when `values sent to Claude` is not 0.                                                                   |
| `passed unchecked: N files`       | Images and scanned PDFs that were not scanned. They are not counted as withheld or sent.                            |
| `no sensitive values`             | Nothing was detected in the session or period; `withheld` is 0.                                                     |

Read the token map at the top as “what the model saw this session.” `The model saw` is the stable
token, `From` names the channel and source (for example `.env · line 1 · STRIPE_KEY`), `First seen`
is the first turn that exposed the token to the model, and `Count` is how often it was exposed.
Each turn has the same map scoped to that turn. `Your value` is only a preview: secrets of 20
characters or more show the first seven and last four characters, shorter secrets show only the
first four, emails show the first letter and domain, other personal data shows its type and last
two characters, and values of eight characters or fewer show `•••`.

To read the same session map without opening HTML:

```text
/zeroh-disclosure:mask-show
```

Or from your own terminal:

```bash
zeroh-disclosure tokens
zeroh-disclosure tokens --session <session-id>
```

`/zeroh-disclosure:mask-show` output is loaded into the model's context, so it lists the token,
type, source and count without the `Your value` column. The previews are only in
`zeroh-disclosure tokens` in your terminal and in `receipt.html`.

Inside Claude Code:

```text
/zeroh-disclosure:mask-receipt
```

The command prints the session slip as plain text (44 columns) and then the `receipt.html` path.
From your own terminal, select a session or a single turn explicitly:

```bash
zeroh-disclosure receipt
zeroh-disclosure receipt --session <session-id> --turn 2
```

The turn ledger is under:

```text
<ZEROH_HOME>/projects/<project>/sessions/<session-id>/turn-<n>.json
```

`<project>` is the project path with every character other than letters and digits replaced by
`-`, as Claude Code names its `~/.claude/projects` folders (`/Users/ana/shop` becomes
`-Users-ana-shop`), so the two line up. Nothing is written into the project folder.

Verify it from a terminal:

```bash
zeroh-disclosure verify --receipt ~/.zeroh/projects/<project>/sessions/<session-id>/turn-1.json
```

Successful output begins with `ok: true` and lists checks for the signature, schema, receipt hash,
policy hash, engine hash, sanitised content, and local chain links. Verification is local and makes
no network call. [Receipt format](receipt-format.md) lists every claim.

## Run a local report

Summarize the current project for a supported period:

```bash
zeroh-disclosure report --since 7d
zeroh-disclosure report --since 30d --html disclosure-report.html --json disclosure-report.json
zeroh-disclosure report --since all --all-projects
```

Inside Claude Code, use `/zeroh-disclosure:report 7d`. Read-only slash commands preload their
output before the model sees the command, so they work in auto permission mode without asking the
model to read ZeroH's folder through Bash.

The terminal prints the same slip for the period: for `7d` the dates it covers, such as
`RECEIPT · SEP 18–25` (or `LAST 7 DAYS` when the dates are unknown), then `LAST 30 DAYS`,
`LAST 90 DAYS`, or `ALL TIME`, with the number of sessions and turns. The
HTML form opens with the slip and adds withheld values by channel, activity per day, top file
paths, blocked destination hosts, formats passed unchecked, stopped prompts, and receipts found
versus verified. The JSON form holds the same totals. `--all-projects` reads roots recorded at SessionStart
in `<ZEROH_HOME>/projects.json`; it does not index file contents.

To create a PDF, write the HTML form, open it in a browser, and choose **Print → Save as PDF**. The
report includes print CSS that keeps the slip as it looks on screen and an inline per-day SVG
chart, with no external requests. It is a local summary.

ProofPack reports for auditors are planned for Premium (waitlist).

## Verify the session receipt bundle

`Stop` also rewrites `session.bundle.json` for the session: the signed turn receipts, summary
counts, and chain evidence in one file. Verify it from a terminal:

```bash
zeroh-disclosure verify --bundle ~/.zeroh/projects/<project>/sessions/<session-id>/session.bundle.json
```

The verifier checks the bundle hash, every included receipt, and the receipt and token chain
between records. When a check fails, the first line after `ok: false` names every failed check,
and `zeroh-disclosure verify --receipt <turn-json>` does the same for one receipt.

## Respond to notices

| Notice                                                                                                          | What happened                                                                                                              | What to do                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ZeroH Disclosure: invoice.pdf was sent as masked text; its layout and images were left out.`                   | A useful text layer was extracted and masked. Claude received text, not the original PDF layout.                           | Continue for text work. Open the PDF locally when layout or figures matter.                                                           |
| `ZeroH Disclosure: scan.pdf was sent unmasked. Scanned PDFs aren't masked in the free plugin.`                  | No useful text layer was found. The original PDF passed to Claude.                                                         | Stop if the scan may contain sensitive data. Use a locally redacted copy.                                                             |
| `ZeroH Disclosure: screenshot.png was sent unmasked. Images aren't masked in the free plugin.`                  | The original image passed to Claude.                                                                                       | Stop if the image may contain sensitive data. Crop or redact it locally.                                                              |
| `ZeroH Disclosure: analysis.ipynb image output was sent unmasked. Images aren't masked in the free plugin.`     | Notebook text fields were masked, but image output passed unchanged.                                                       | Remove or locally redact sensitive plots before another read.                                                                         |
| ``ZeroH Disclosure: this project's allow list was changed outside `zeroh-disclosure allow`, so it is ignored.`` | The allow-list HMAC is missing or invalid.                                                                                 | Recreate the rules from your terminal with `zeroh-disclosure allow`. Do not repair the JSON by hand.                                  |
| `ZeroH Disclosure: a random-looking value (N characters) matches no rule; it was sent as is. …`                 | A value you typed looked random and had no key-like name; it was not masked. Files and command output get no such warning. | Put the value in `.env`, a supported credential file, or a secret-named environment variable, or run `/zeroh-disclosure:report-miss`. |
| `CLAUDE.md contains ... secret(s)`                                                                              | Claude Code loaded a context or memory file as system text.                                                                | The default local proxy masks the text before transmission once it runs for the session (normally from the first prompt on).          |

Format notices are shown once per kind per session. The receipt still records every format
outcome.

## Find settings, keys, and session data

`ZEROH_HOME` defaults to `~/.zeroh` on macOS and Linux and to `%LOCALAPPDATA%\ZeroH` on Windows
(for example `C:\Users\you\AppData\Local\ZeroH`; local, not copied with a roaming profile). Set
`ZEROH_HOME` before starting Claude Code to move user-level ZeroH data. Every file ZeroH writes
there is mode 0600 in 0700 folders; on Windows the folder is limited to your account and SYSTEM.

| Path                                                        | Contents                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<ZEROH_HOME>/vault.key`                                    | 32-byte AES key for the local vault.                                                                                                                                                                                                                                                                                          |
| `<ZEROH_HOME>/vault/<project-hash>.json`                    | AES-256-GCM encrypted token-to-value entries for one project.                                                                                                                                                                                                                                                                 |
| `<ZEROH_HOME>/vault/<project-hash>.json.unreadable-<time>`  | Only after `doctor --fix --keep-backups`: the old copy of a vault it reset. It still holds values (mode 0600); `vault clear` removes it.                                                                                                                                                                                      |
| `<ZEROH_HOME>/allow.key`                                    | 32-byte HMAC key for destination rules.                                                                                                                                                                                                                                                                                       |
| `<ZEROH_HOME>/unmask.json`                                  | HMAC-signed per-kind personal-data caps.                                                                                                                                                                                                                                                                                      |
| `<ZEROH_HOME>/grants/<project-hash>.json`                   | HMAC-signed active grants and grant/revoke receipt entries.                                                                                                                                                                                                                                                                   |
| `<ZEROH_HOME>/run/<session-id>/<tool-use-id>.sh`            | Short-lived Bash late-binding values (real values, removed after the command).                                                                                                                                                                                                                                                |
| `<ZEROH_HOME>/run/<session-id>/<tool-use-id>.b64`           | Short-lived PowerShell late-binding values (base64 lines).                                                                                                                                                                                                                                                                    |
| `<ZEROH_HOME>/run/unmask-mcp/`                              | Short-lived claims that pair an unmask request with its session.                                                                                                                                                                                                                                                              |
| `<ZEROH_HOME>/session-keys/<project-hash>/<session-id>.key` | The keys behind the receipts' value commitments; `vault clear` and retention remove them.                                                                                                                                                                                                                                     |
| `<ZEROH_HOME>/projects/<project>/sessions/<session-id>/`    | State, local signing keys, turn ledgers, `receipt.html`, evidence and receipt bundles; kept for `ZEROH_RECEIPT_RETENTION` (90 days by default).                                                                                                                                                                               |
| `<ZEROH_HOME>/projects.json`                                | Seen project roots and last-seen times; no file contents.                                                                                                                                                                                                                                                                     |
| `<ZEROH_HOME>/reports/<id>.json`                            | Shape-only missed-value report or value-free proxy diagnostic report.                                                                                                                                                                                                                                                         |
| `<ZEROH_HOME>/config.env`                                   | Your own settings (any ZeroH setting), if you create it.                                                                                                                                                                                                                                                                      |
| `<ZEROH_HOME>/banner.json`, `banner-shown`                  | The banner mode and whether the full banner was shown once.                                                                                                                                                                                                                                                                   |
| `<ZEROH_HOME>/logs/proxy.log`                               | The proxy's own notices (start, stop, pass-through), capped at 256 KB; no request content.                                                                                                                                                                                                                                    |
| `<ZEROH_HOME>/bin/zeroh-disclosure-proxy/`                  | Copied proxy runtime that survives plugin removal.                                                                                                                                                                                                                                                                            |
| `<ZEROH_HOME>/proxy/proxy.json`                             | The proxy's port and control token, per Claude settings file its access key and previous `ANTHROPIC_BASE_URL`, and the network variables it uses (`HTTPS_PROXY` and the like). **It can hold credentials**: a network proxy URL with a user name and password, and the access keys. Mode 0600 (on Windows, the folder's ACL). |
| `<ZEROH_HOME>/proxy/routes/`                                | One file per Claude session: its project root, settings file, whether it opted out, whether the proxy has seen it and whether it ended.                                                                                                                                                                                       |
| `<ZEROH_HOME>/proxy/manager.lock`                           | Held while the proxy is set up or changed.                                                                                                                                                                                                                                                                                    |
| `<ZEROH_HOME>/proxy/zeroh-disclosure-proxy.xml`             | Windows only: the scheduled task's definition.                                                                                                                                                                                                                                                                                |
| `<ZEROH_HOME>/.acl-protected`                               | Windows only: marks that the folder's ACL (you and SYSTEM) was applied.                                                                                                                                                                                                                                                       |
| `<project>/.zeroh.env`                                      | Per-project display settings only (`ZEROH_BANNER`, `ZEROH_DISPLAY_REAL_VALUES`, `ZEROH_VAULT_RETENTION`), a shorter `ZEROH_RECEIPT_RETENTION`, or tightening values; other keys are ignored with a warning.                                                                                                                   |
| `<ZEROH_HOME>/projects/<project>/allow.json`                | HMAC-signed destination rules.                                                                                                                                                                                                                                                                                                |
| `<ZEROH_HOME>/receipts-pruned.json`                         | When receipts were last pruned, and how many sessions went.                                                                                                                                                                                                                                                                   |

The vault key lives beside the encrypted data. This prevents accidental commits and casual reads;
it is not protection from another process running as your user.

## Understand the settings guard

The guard denies model-initiated access to the user `ZEROH_HOME` (and a `.zeroh` folder an
earlier build left in a project). Read and Grep access to the project's receipts,
`<ZEROH_HOME>/projects/<project>/sessions/`, is the exception, so receipt commands can report
local evidence.

It covers file tools, Bash, PowerShell, and string fields in `mcp__*` tools. It also blocks direct
references to `ZEROH_HOME`, `allow.json`, `unmask.json`, `grants`, `vault.key`, `allow.key`, and
direct `zeroh-disclosure allow`, `unmask`, or `statusline` calls, and writes to `.zeroh.env` (and
`.zeroh.policy`, which earlier builds read). It also denies model changes to Claude settings files that disable hooks, disable
or remove the plugin, set `ZEROH_*` or `ANTHROPIC_BASE_URL`, or add an `Elicitation` hook (checked
on the parsed JSON, so escapes do not help); edits to the plugin's own files; and `claude plugin
disable|uninstall|remove` or `claude config` changes.
Path comparisons are case-insensitive on macOS and Windows and case-sensitive on Linux.
Edit, Write, Bash, and PowerShell also cannot change `env.ANTHROPIC_BASE_URL` in the resolved Claude
settings file or a project `.claude/settings*.json` file.

This is a static path and command-string guard. A determined shell can construct a protected path
at run time. Treat it as a direct-access control and audit signal, not an operating-system sandbox.

## Work with the local proxy

The proxy masks every request on its way to the model, including what you type. It runs as you
(no administrator rights, nothing system-wide) and writes only under `ZEROH_HOME` and your Claude
Code settings.

### What the first session sets up

- It copies the proxy into `<ZEROH_HOME>/bin/zeroh-disclosure-proxy` and starts it on
  `127.0.0.1`.
- It registers a per-user login item named `zeroh-disclosure-proxy` so the proxy runs after a
  reboot: a user systemd unit on Linux (or an XDG autostart entry in a desktop session), a
  LaunchAgent on macOS, a per-user scheduled task on Windows, started through
  `conhost.exe --headless` so no console window opens (Windows 10 version 1809 or later). It starts
  the `node` on your `PATH` (for example `/opt/homebrew/bin/node`), so a Node.js upgrade does not
  break it. Each session start checks that the login item is still loaded and its Node.js still
  exists, and registers it again if not.
- If your machine does not allow login items (a managed Mac, background items switched off, a
  locked-down Windows, Linux without a systemd user session or a desktop, such as SSH, WSL or a
  container), ZeroH says so and leaves your Claude Code settings alone: nothing would keep the
  proxy running after a reboot, and every session would then meet a dead port. Typed secrets are
  then stopped, not masked.
- On your first prompt it sets `env.ANTHROPIC_BASE_URL` in `~/.claude/settings.json` (or
  `$CLAUDE_CONFIG_DIR/settings.json`, or `ZEROH_CLAUDE_SETTINGS`) to
  `http://127.0.0.1:<port>/z/<key>`, and keeps a small restore record next to that file with your
  previous `ANTHROPIC_BASE_URL`. It never keeps a copy of the settings file or its other values.
  Claude Code applies a changed settings file to the running session, so that prompt waits about
  two seconds once and then goes through the proxy. A secret in that prompt is stopped, in case it
  would still go out directly. The few requests Claude Code sends while it starts, before your
  first prompt, carry no prompt text and go directly.

ZeroH treats typed text as masked when the session's own environment names this install's proxy
and the proxy answers, or once the proxy has seen a request of the session.

If your shell (or a settings file that takes precedence, such as a project's
`.claude/settings.json`) sets `ANTHROPIC_BASE_URL`, Claude Code ignores ZeroH's entry, so what you
type cannot be masked in that setup: the session start says so, and a prompt with a secret is
stopped instead. Files and command output are still masked.

### Where it forwards

The proxy forwards to the `ANTHROPIC_BASE_URL` you had before, or to `api.anthropic.com`, and to
no other host. Each settings file gets its own access key in that URL. A request with a key the
proxy does not know (an entry left by a deleted ZeroH folder or an earlier build) is not refused
but forwarded to the one upstream all your settings files agree on (else to `api.anthropic.com`),
noted in a local report, and the next session start repairs the entry. The proxy never stores
request or response bodies and leaves responses unchanged.

### Corporate networks

When your environment sets `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS` or
`SSL_CERT_FILE`, the session start records them in ZeroH's private `proxy/proxy.json` (readable
only by you), and the proxy uses them for its own connection, also after a reboot when the login
item starts it without your shell's variables. A session with different values restarts the proxy
with them; a session with none (an app started from the Dock) keeps the recorded ones. When the
recorded network proxy cannot be reached (you left the office or the VPN), the proxy drops it and
connects directly, so Claude Code's retry goes through; the next session that names a network
proxy records it again. `doctor --fix` forgets them.

### Sessions without the plugin

The settings entry applies to every Claude Code session, also in a project where you disabled
ZeroH Disclosure. While a ZeroH Disclosure session is running, any request the proxy cannot tie
to a session of its own is masked too, never sent as it is. When no ZeroH Disclosure session is
running, a session without the plugin passes through unmasked, as if the proxy were not there,
and is never refused. After the plugin has been gone for 24 hours, the proxy restores your
setting and removes itself. (Claude Code 2.1.283 sends the session id with every request that
carries conversation text, including subagents, `--resume`, `--continue` and `--fork-session`.)

### When the proxy stops

The proxy never leaves a dead address behind for a new session: when it stops for a shutdown or
logout, or because ZeroH's folder was deleted, it first takes its entry out of your Claude Code
settings (your own setting goes back); the next session or prompt with ZeroH Disclosure puts it
back at the same address. The one exception is a settings file a running ZeroH Disclosure session
is using: its entry stays, because taking it out would send the rest of that session's turn, with
its whole history, straight to the model API. That session's next prompt starts the proxy again.
A plugin update restarts the proxy with the new code at the next session start; answers in
progress finish first.

### Turn it off

```text
/zeroh-disclosure:proxy off    # restores your settings and stops the proxy
/zeroh-disclosure:proxy on     # turn it back on
```

`proxy off` stays off, also in new sessions, until `proxy on` or `doctor --fix`.
`ZEROH_PROXY=off claude` skips the proxy for one session without changing settings. When it does
not work as expected, see
[The local proxy is unavailable](troubleshooting.md#the-local-proxy-is-unavailable).

## Run with PowerShell

PowerShell support uses Claude Code's opt-in `PowerShell` tool and ZeroH's PowerShell late binder.
Install PowerShell 7 or later as `pwsh` on macOS or Linux.

From Bash, Git Bash, or another POSIX shell:

```bash
CLAUDE_CODE_USE_POWERSHELL_TOOL=1 claude
```

From PowerShell:

```powershell
$env:CLAUDE_CODE_USE_POWERSHELL_TOOL = '1'
claude
```

The hook masks PowerShell output and restores known tokens through a short-lived `.b64` values
file, read through .NET rather than dot-sourced, so no execution policy applies. Values files are requested as `0600`, removed by the command after import, removed again by
`PostToolUse`, and pruned after ten minutes if left stale.

## Uninstall and clean up

One command removes everything, in this order:

```text
/zeroh-disclosure:uninstall          # shows what it removes; nothing is removed yet
/zeroh-disclosure:uninstall --yes    # removes it
```

In a terminal: `node "<plugin>/bin/zeroh-disclosure.mjs" uninstall` (it asks first; `--yes` skips
the question). It never deletes a `ZEROH_HOME` that is your home, a system folder or holds none of
ZeroH's files. It removes:

- the plugin from Claude Code, through Claude Code's own `claude plugin list --json` and
  `claude plugin uninstall <id> --scope <scope>` (never by editing Claude Code's files), first, so
  no new session sets ZeroH up again; when the `claude` command isn't available it prints the
  exact command to run;
- ZeroH's entry in every Claude Code settings file it wrote to (your own `ANTHROPIC_BASE_URL`
  goes back) and the restore records next to them;
- the proxy and its per-user `zeroh-disclosure-proxy` login item (a user systemd unit or XDG
  autostart entry on Linux, `~/Library/LaunchAgents` on macOS, the per-user Task Scheduler
  library on Windows; it never needs administrator rights);
- a `<project>/.zeroh/` folder an earlier test build left in a project listed in
  `<ZEROH_HOME>/projects.json`, only when it holds nothing but ZeroH's files (`doctor --fix`
  removes these too);
- `<ZEROH_HOME>/` itself: the vault and its key, allow rules, receipts, unmask grants, receipt
  commitment keys and reports.

Sessions that are still open keep running until you exit them. A short-lived marker in the
system's temporary folder (named for your `ZEROH_HOME`, so it survives that folder's removal)
makes their hooks do nothing, so nothing is set up again; nothing protects those sessions any
more, so exit them. A new session starts without ZeroH; if you install the plugin again, its first
session removes the marker and ZeroH works as before. Back up receipts you need first: cleanup is
irreversible. Also remove files you created only for the plugin, such as `.zeroh.env`.

If the plugin was removed another way, the proxy keeps passing requests through unmasked so
Claude Code is not stranded, then restores the prior setting, unregisters itself and exits after
24 hours. See [Troubleshooting](troubleshooting.md#remove-the-login-item-by-hand) for manual
removal.

To turn the proxy off without uninstalling, run `/zeroh-disclosure:proxy off`; it stays off until
`/zeroh-disclosure:proxy on`.
