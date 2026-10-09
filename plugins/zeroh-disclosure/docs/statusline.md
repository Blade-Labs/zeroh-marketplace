# The ZeroH status line

One line under Claude Code's prompt that always says whether ZeroH is protecting this session:

```text
🛡️ ZeroH · 🟢 protected · 4 masked · 0 sent · unmask EMAIL 12m · receipt ↗
```

With your first message after the install, ZeroH adds it to your Claude Code user settings. If
you already have a status line, your output stays first and ZeroH appears on its own line below.
You can change how it looks (ask Claude, or edit a small file), build your own line from its data,
or add ZeroH's part to a line you already have.
What it _says_ stays ZeroH's: no style or script can make it show 🟢 when ZeroH isn't protecting.

- [States](#states)
- [Change how it looks](#change-how-it-looks)
- [Build your own line from its data](#build-your-own-line-from-its-data)
- [Add ZeroH to a status line you already have](#add-zeroh-to-a-status-line-you-already-have)
- [Turn it off and on](#turn-it-off-and-on)

## States

| State                 | Reasons shown (long wording)                                                                                                                                                                                                                                                  | Fix shown                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 🟢 protected          | `protected`                                                                                                                                                                                                                                                                   | none                                                                                               |
| 🟡 protected in part  | `files only`, `proxy starts with your first prompt`, `proxy on from your next prompt`, `proxy down`, `starting`, `compacting`, `started before ZeroH`, `N not protected this turn`, `upstream mismatch`, `ANTHROPIC_BASE_URL overridden`, `credentials in ANTHROPIC_BASE_URL` | `/zeroh-disclosure:doctor`, `/zeroh-disclosure:proxy on` after `proxy off`, or restart Claude Code |
| 🔴 removal incomplete | `removal incomplete`                                                                                                                                                                                                                                                          | `/zeroh-disclosure:uninstall`                                                                      |
| 🔴 not protecting     | `hooks failing`, `hooks stopped`, `hooks never ran`, `vault can't be opened`, `state can't be read`, `plugin disabled`, `uninstalled`, `no session`                                                                                                                           | `/zeroh-disclosure:doctor`, `enable it in /plugin`, or `remove it with /statusline`                |

`ANTHROPIC_BASE_URL overridden` (`upstream overridden` in compact mode) includes shell or
Windows-environment gateways. Only an environment URL that normalises to
`https://api.anthropic.com`, with or without a trailing slash, is routed. For an override, typed
prompts are not masked in this session; files and command output still are. Put the gateway in
Claude Code's `settings.json` `env`; ZeroH records it as the original upstream and routes through
it. The install upstream comes only from that settings original or the default Anthropic upstream,
never from the environment. Project, local and managed settings and provider-managed hosts stay
overridden. `upstream mismatch` remains for an otherwise routable URL that differs from the install
upstream; `credentials in ANTHROPIC_BASE_URL` (`URL credentials` in compact mode) is a separate
state. Banner, status line, `/status`, doctor, prompt notices and Stop use the same protection-state
wording. Doctor shows the sources without printing URLs or credentials.

`hooks stopped` means your latest prompt or tool result in the transcript is more than 30 seconds
newer than the last time a ZeroH hook ran (the plugin was disabled or its hooks removed
mid-session). The line reads only the end of the transcript, and entries Claude Code writes on its
own while a session is idle (titles, file-history snapshots, summaries) don't count.
During `/compact`, the line says `compacting`; entries Claude Code writes for compaction do not
produce a false `hooks stopped`. A real missed hook still turns red at the next prompt or tool.

`started before ZeroH` means this Claude Code session began before the enabled ZeroH copy was
installed or updated. Restart Claude Code to protect it. `hooks never ran` means the session began
after that install and ZeroH's hooks still did not run; use `/zeroh-disclosure:doctor`.

When the plugin itself is gone (removed without uninstalling), the line says
`🛡️ ZeroH · 🔴 not installed · remove it with /statusline`. If you pasted the segment launcher into your own script, it instead says `remove ZeroH from your status line script`.

`masked` is the number of values the model saw as tokens this session, `sent` the real values that
reached it anyway (a secret typed while the proxy was off, which you were told about).
`receipt ↗` is a link to the session's receipt (Cmd-click or Ctrl-click; left out in macOS
Terminal).

## Change how it looks

Ask Claude, for example "make ZeroH's status line compact, no emoji" or "only show ZeroH's status
line when something is wrong". Claude uses the validated command:

```bash
zeroh-disclosure style wording compact
zeroh-disclosure style emoji false
zeroh-disclosure style only-when-not-protected true
```

`zeroh-disclosure style show` prints the active style and banner mode. Direct editing remains a
compatible fallback for the one ZeroH file the model may change:

```text
~/.zeroh/presentation.json        (%LOCALAPPDATA%\ZeroH on Windows; ZEROH_HOME if set)
```

`/zeroh-disclosure:settings statusline style` prints its path and values; adding `<key> <value>`
changes them through the same validator. The line picks up a
change within 10 seconds, or with the next answer.

| Key                    | Default                                                                                                                                 | What it does                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `version`              | `1`                                                                                                                                     | Required. Any other value: the default style.                                                                                        |
| `fields`               | `["shield","name","state","fix","masked","sent","notProtected","unmask","receipt"]`                                                     | Which parts show, in this order. Unknown names are ignored.                                                                          |
| `separator`            | `" · "`                                                                                                                                 | Between parts; at most 5 characters.                                                                                                 |
| `labels`               | `{"name":"ZeroH","shield":"🛡️","masked":"masked","sent":"sent","notProtected":"not protected","unmask":"unmask","receipt":"receipt ↗"}` | Text for each part; at most 24 characters each.                                                                                      |
| `emoji`                | `true`                                                                                                                                  | `false` drops the 🛡️ and the 🟢/🟡/🔴 dot; the state word stays.                                                                     |
| `wording`              | `"long"`                                                                                                                                | `"compact"` shortens the state words (`proxy next prompt`, `vault closed`).                                                          |
| `colour`               | `true`                                                                                                                                  | `false` turns the state colour off (`NO_COLOR` and `TERM=dumb` always do).                                                           |
| `onlyWhenNotProtected` | `false`                                                                                                                                 | `true`: print nothing while 🟢, the full state otherwise.                                                                            |
| `position`             | `"line"`                                                                                                                                | With your own status line: ZeroH's part on its own line under yours. `"end"`: after your last line, joined with `·`.                 |
| `receiptFormat`        | `"text"`                                                                                                                                | Default `receipt` stdout: terminal text, structured `"json"`, or self-contained `"html"`. `--format` overrides it.                   |
| `reportFormat`         | `"text"`                                                                                                                                | Default `report` stdout: terminal text, structured `"json"`, or self-contained `"html"`. `--format` overrides it.                    |
| `verbosity`            | `"normal"`                                                                                                                              | Text detail: `"concise"` keeps safety gaps but trims guidance/paths; `"normal"` keeps standard guidance; `"detailed"` adds metadata. |

The rules that keep it honest, checked every time the line is drawn:

- While ZeroH is 🟡 or 🔴, the state and its fix always show, even when `fields` leaves them out
  or `onlyWhenNotProtected` is set.
- A label or separator can't contain a state word (`protected`, `ok`, `safe`, `proxy`, `hooks`, …)
  or a state mark (🟢, 🟡, 🔴, ✅, ⚠, …), or any control character. Such a value is replaced by
  the default.
- A missing, unreadable or invalid file, or any value of the wrong kind, falls back to the
  default. The line never fails because of the style.
- The style can't change how the state is worked out; only ZeroH's hooks decide that.

### Examples

Minimal:

```json
{ "version": 1, "fields": ["shield", "state"] }
```

```text
🛡️ · 🟢 protected
```

Compact, no emoji:

```json
{
  "version": 1,
  "fields": ["name", "state", "fix", "masked", "receipt"],
  "separator": " | ",
  "emoji": false,
  "wording": "compact",
  "labels": { "masked": "m", "receipt": "↗" }
}
```

```text
ZeroH | protected | 4 m | ↗
ZeroH | files only | /zeroh-disclosure:doctor | 4 m | ↗
```

Only when something is wrong:

```json
{ "version": 1, "onlyWhenNotProtected": true }
```

```text
(nothing while 🟢)
🛡️ ZeroH · 🔴 hooks failing · /zeroh-disclosure:doctor
```

A shorter name:

```json
{
  "version": 1,
  "fields": ["name", "state", "masked"],
  "labels": { "name": "🔒" }
}
```

```text
🔒 · 🟢 protected · 4 masked
```

## Build your own line from its data

`zeroh-disclosure statusline --json` prints the state as data, for a status line script of your
own (for example ZeroH next to your git branch and the model name). It reads the same JSON
Claude Code gives your script on stdin. Schema `zeroh-statusline/1`; it only grows: new keys may
be added, none is renamed, removed or given a new meaning while `schema` stays the same.

```json
{
  "schema": "zeroh-statusline/1",
  "plugin_version": "1.0.0-rc.2",
  "state": "protected",
  "reason": "protected",
  "fix": null,
  "counts": { "masked": 4, "sent": 0, "not_protected_this_turn": 0 },
  "unmask": [{ "kind": "EMAIL", "expires_at": "2026-09-27T12:12:00.000Z" }],
  "receipt": {
    "url": "file:///home/you/.zeroh/projects/…/receipt.html",
    "path": "/home/you/.zeroh/projects/…/receipt.html"
  }
}
```

| Key              | Values                                                                    |
| ---------------- | ------------------------------------------------------------------------- |
| `state`          | `protected` (🟢), `partial` (🟡) or `off` (🔴)                            |
| `reason`         | The state words from [States](#states)                                    |
| `fix`            | The command or action to show, or `null`                                  |
| `counts`         | `null` while there is nothing to count (starting, 🔴)                     |
| `unmask`         | Active unmask grants; `expires_at` is `null` for "until the session ends" |
| `receipt`        | This session's receipt, or `null` before the first turn ends              |
| `plugin_version` | The ZeroH Disclosure version that answered                                |

The CLI is not on your `PATH`: the statusLine command in your settings (see the
[README](../README.md#status-line)) finds the installed plugin itself; `segment` at its end prints
ZeroH's part. A script that shows ZeroH's state should show `reason` and `fix` whenever `state`
isn't `protected`.

To use your own script, point `statusLine` in your Claude Code settings at it. That is your change
to make: Claude can write the script, but can't change `statusLine` itself (ZeroH's settings guard
stops it); it tells you the one line to add. ZeroH notices once that its own line isn't shown and
never puts it back.

## Add ZeroH to a status line you already have

Type `/zeroh-disclosure:settings statusline on`. ZeroH adds its part on its own line under yours,
in one step:

```text
~/src/app main · opus · ctx 41% · $0.82 · 12m · feature/long-branch-name…
🛡️ ZeroH · 🟢 protected · 4 masked · receipt ↗
```

Claude Code shows each printed line as its own row and cuts a long row short with `…`, so a part
added at the end of a long line would not be seen. When your command prints several lines, ZeroH's
part comes after the last. To keep it on the same line instead, set `"position": "end"` in the
style file:

```text
~/src/app main · 🛡️ ZeroH · 🟢 protected · 4 masked · receipt ↗
```

With `"onlyWhenNotProtected": true`, only your line shows while ZeroH is 🟢.

Your script is not changed. ZeroH sets `statusLine.command` to its own resolver in `wrap` mode,
with your command after it as one base64url word (no quoting survives Bash, zsh, PowerShell and
cmd alike; base64url has no character any of them reads). It runs your command with the same JSON
on stdin, prints its output unchanged, then ZeroH's part. It prints current output even when the
command exits non-zero. If a run is slow, fails without output, or prints nothing, ZeroH keeps the
last good output in `ZEROH_HOME/statusline-cache/<hash>.json`, a private per-session cache of your own status-line text. SessionEnd removes that session's file; SessionStart prunes files older than seven days. A cached line older than a few refreshes is marked
`[cached]`. The four-second deadline stops the process tree on every OS, so a stuck command cannot
hold back the line. Your entry is kept in
`<ZEROH_HOME>/statusline.json` too: `/zeroh-disclosure:settings statusline off` and uninstall put
it back exactly. A status line that already shows ZeroH's part is left as it is.

Only you can do this: when Claude runs it, nothing changes and Claude is told to ask you to type
it.

This works on macOS, Linux and Windows. Claude Code 2.1.284 was observed using `/bin/sh` on macOS
and Linux; on Windows it uses Git Bash when configured and PowerShell otherwise. ZeroH selects the
same shell and stops the whole child process tree at the deadline.

### By hand

To compose it yourself, in a script of your own, this command prints only ZeroH's part, without
a line end. Pipe it the JSON your script gets on stdin. Claude can get it read-only (the `about`
skill shows it, or `zeroh-disclosure statusline segment-command`) and write your script; it can't
change `statusLine`.

```bash
input=$(cat)
zeroh=$(printf '%s' "$input" | ~/.zeroh/bin/zeroh-statusline)
echo "$(your-line) · $zeroh"
```

The pasted POSIX line is under 80 characters:

```bash
~/.zeroh/bin/zeroh-statusline
```

PowerShell and cmd use the Node launcher under `%LOCALAPPDATA%\ZeroH\bin`:

```powershell
node "$env:LOCALAPPDATA/ZeroH/bin/zeroh-statusline.mjs"
```

```batch
node "%LOCALAPPDATA%/ZeroH/bin/zeroh-statusline.mjs"
```

For Claude Code's Windows `statusLine.command`, use the absolute Node command printed by
`zeroh-disclosure statusline segment-command`, for example:

```text
node "C:/Users/you/AppData/Local/ZeroH/bin/zeroh-statusline.mjs"
```

[Claude Code runs it through Git Bash when installed, otherwise PowerShell](https://code.claude.com/docs/en/statusline#windows-configuration).
The quoted path with forward slashes works in both, including paths with spaces. The environment
variable examples above are for scripts run in their named shell.

`ZEROH_HOME` replaces those default folders when set. The launcher verifies the recorded plugin
root against Claude Code's installed-plugin list or cache. If no trusted copy exists, it prints
`🛡️ ZeroH · 🔴 not installed · remove ZeroH from your status line script`. It also accepts `--json`.

The style file applies to the segment too.

## Turn it off and on

`/zeroh-disclosure:settings statusline off`, or deleting it with `/statusline`: ZeroH records that
and never adds it back. `/zeroh-disclosure:settings statusline on` turns it on again. Uninstall
removes it from every settings file ZeroH wrote it to, and puts back each status line of yours it
added its part to.

The legacy `statusline-style.json` is read only when `presentation.json` is absent. Its values migrate to the new file, and the old file is removed after a successful write. Both names keep the same plain-file guard during migration.
