# The ZeroH status line

One line under Claude Code's prompt that always says whether ZeroH is protecting this session:

```text
🛡️ ZeroH · 🟢 protected · 4 masked · 0 sent · unmask EMAIL 12m · receipt ↗
```

With your first message after the install, ZeroH adds it to your Claude Code user settings,
unless you have a status line of your own. You can change how it looks (ask Claude, or edit a
small file), build your own line from its data, or add ZeroH's part to a line you already have.
What it _says_ stays ZeroH's: no style or script can make it show 🟢 when ZeroH isn't protecting.

- [States](#states)
- [Change how it looks](#change-how-it-looks)
- [Build your own line from its data](#build-your-own-line-from-its-data)
- [Add ZeroH to a status line you already have](#add-zeroh-to-a-status-line-you-already-have)
- [Turn it off and on](#turn-it-off-and-on)

## States

| State                | Reasons shown (long wording)                                                                                                                        | Fix shown                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 🟢 protected         | `protected`                                                                                                                                         | none                                                                                |
| 🟡 protected in part | `files only`, `proxy starts with your first prompt`, `proxy on from your next prompt`, `proxy down`, `starting`, `N not protected this turn`        | `/zeroh-disclosure:doctor`, or `/zeroh-disclosure:proxy on` after `proxy off`       |
| 🔴 not protecting    | `hooks failing`, `hooks stopped`, `hooks never ran`, `vault can't be opened`, `state can't be read`, `plugin disabled`, `uninstalled`, `no session` | `/zeroh-disclosure:doctor`, `enable it in /plugin`, or `remove it with /statusline` |

When the plugin itself is gone (removed without uninstalling), the line says
`🛡️ ZeroH · 🔴 not installed · remove it with /statusline`.

`masked` is the number of values the model saw as tokens this session, `sent` the real values that
reached it anyway (a secret typed while the proxy was off, which you were told about).
`receipt ↗` is a link to the session's receipt (Cmd-click or Ctrl-click; left out in macOS
Terminal).

## Change how it looks

Ask Claude, for example "make ZeroH's status line compact, no emoji" or "only show ZeroH's status
line when something is wrong". Claude edits one file, the only ZeroH file it may change:

```text
~/.zeroh/statusline-style.json        (%LOCALAPPDATA%\ZeroH on Windows; ZEROH_HOME if set)
```

`/zeroh-disclosure:settings statusline style` prints its path and an example. The line picks up a
change within 10 seconds, or with the next answer.

| Key                    | Default                                                                                                                                 | What it does                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `version`              | `1`                                                                                                                                     | Required. Any other value: the default style.                               |
| `fields`               | `["shield","name","state","fix","masked","sent","notProtected","unmask","receipt"]`                                                     | Which parts show, in this order. Unknown names are ignored.                 |
| `separator`            | `" · "`                                                                                                                                 | Between parts; at most 5 characters.                                        |
| `labels`               | `{"name":"ZeroH","shield":"🛡️","masked":"masked","sent":"sent","notProtected":"not protected","unmask":"unmask","receipt":"receipt ↗"}` | Text for each part; at most 24 characters each.                             |
| `emoji`                | `true`                                                                                                                                  | `false` drops the 🛡️ and the 🟢/🟡/🔴 dot; the state word stays.            |
| `wording`              | `"long"`                                                                                                                                | `"compact"` shortens the state words (`proxy next prompt`, `vault closed`). |
| `colour`               | `true`                                                                                                                                  | `false` turns the state colour off (`NO_COLOR` and `TERM=dumb` always do).  |
| `onlyWhenNotProtected` | `false`                                                                                                                                 | `true`: print nothing while 🟢, the full state otherwise.                   |

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

ZeroH never replaces your status line. `/zeroh-disclosure:settings statusline on` shows the exact
command; with `segment` at its end it prints only ZeroH's part, without a line end. Pipe it the
JSON your script gets on stdin:

```bash
input=$(cat)
zeroh=$(printf '%s' "$input" | node -e "…" segment)
echo "$(your-line) · $zeroh"
```

The style file applies to the segment too.

## Turn it off and on

`/zeroh-disclosure:settings statusline off`, or deleting it with `/statusline`: ZeroH records that
and never adds it back. `/zeroh-disclosure:settings statusline on` turns it on again. Uninstall
removes it from every settings file ZeroH wrote it to.
