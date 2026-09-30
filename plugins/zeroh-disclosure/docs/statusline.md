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

`hooks stopped` means your latest prompt or tool result in the transcript is more than 30 seconds
newer than the last time a ZeroH hook ran (the plugin was disabled or its hooks removed
mid-session). The line reads only the end of the transcript, and entries Claude Code writes on its
own while a session is idle (titles, file-history snapshots, summaries) don't count.

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

| Key                    | Default                                                                                                                                 | What it does                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `version`              | `1`                                                                                                                                     | Required. Any other value: the default style.                                                                        |
| `fields`               | `["shield","name","state","fix","masked","sent","notProtected","unmask","receipt"]`                                                     | Which parts show, in this order. Unknown names are ignored.                                                          |
| `separator`            | `" · "`                                                                                                                                 | Between parts; at most 5 characters.                                                                                 |
| `labels`               | `{"name":"ZeroH","shield":"🛡️","masked":"masked","sent":"sent","notProtected":"not protected","unmask":"unmask","receipt":"receipt ↗"}` | Text for each part; at most 24 characters each.                                                                      |
| `emoji`                | `true`                                                                                                                                  | `false` drops the 🛡️ and the 🟢/🟡/🔴 dot; the state word stays.                                                     |
| `wording`              | `"long"`                                                                                                                                | `"compact"` shortens the state words (`proxy next prompt`, `vault closed`).                                          |
| `colour`               | `true`                                                                                                                                  | `false` turns the state colour off (`NO_COLOR` and `TERM=dumb` always do).                                           |
| `onlyWhenNotProtected` | `false`                                                                                                                                 | `true`: print nothing while 🟢, the full state otherwise.                                                            |
| `position`             | `"line"`                                                                                                                                | With your own status line: ZeroH's part on its own line under yours. `"end"`: after your last line, joined with `·`. |

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
on stdin, prints its output unchanged, then ZeroH's part. If your command fails, prints nothing
or takes longer than 2 seconds, only ZeroH's part shows: ZeroH stops your command and everything
it started at that deadline, so a slow or stuck line never hides ZeroH's, and ZeroH's part never
hides yours. Your entry is kept in
`<ZEROH_HOME>/statusline.json` too: `/zeroh-disclosure:settings statusline off` and uninstall put
it back exactly. A status line that already shows ZeroH's part is left as it is.

Only you can do this: when Claude runs it, nothing changes and Claude is told to ask you to type
it.

On Windows, 1.0.1 doesn't add ZeroH's part to your own status line: which shell Claude Code runs
your line with there is not verified yet, and the wrong one would hide your line. Your status line
is left as it is; add ZeroH's part by hand (below). Adding it for you on Windows is planned for
1.1.

### By hand

To compose it yourself, in a script of your own, this command prints only ZeroH's part, without
a line end. Pipe it the JSON your script gets on stdin. Claude can get it read-only (the `about`
skill shows it, or `zeroh-disclosure statusline segment-command`) and write your script; it can't
change `statusLine`.

```bash
input=$(cat)
zeroh=$(printf '%s' "$input" | node -e "…" segment)
echo "$(your-line) · $zeroh"
```

The full command:

```bash
node -e "const f=require('fs'),p=require('path'),e=process.env,h=require('os').homedir();const j=(x)=>{try{return JSON.parse(f.readFileSync(x,'utf8'))}catch{return null}};const c=p.resolve(e.CLAUDE_CONFIG_DIR||p.join(h,'.claude'));const k=p.resolve(e.CLAUDE_CODE_PLUGIN_CACHE_DIR||p.join(c,'plugins','cache'));const z=e.ZEROH_HOME||(process.platform==='win32'?p.join(e.LOCALAPPDATA||p.join(h,'AppData','Local'),'ZeroH'):p.join(h,'.zeroh'));const l=[];for(const[n,v]of Object.entries(j(p.join(c,'plugins','installed_plugins.json'))?.plugins||{}))if(n.startsWith('zeroh-disclosure@'))for(const i of[].concat(v))if(typeof i?.installPath==='string')l.push(p.resolve(i.installPath));const u=(x)=>{const s=p.relative(k,x);return !s.startsWith('..')&&!p.isAbsolute(s)&&s.split(p.sep)[1]==='zeroh-disclosure'};const t=(x)=>typeof x==='string'&&(l.includes(p.resolve(x))||u(p.resolve(x))||e.ZEROH_STATUSLINE_DEV==='1');const d=[j(p.join(z,'plugin-root.json'))?.roots?.[c],...l].find((x)=>t(x)&&f.existsSync(p.join(x,'lib','statusline.js')));const a=process.argv.slice(1);const o=()=>new Promise((r)=>{if(a[0]!=='wrap')return r('');const q=require('child_process'),W=process.platform==='win32';let c,s='',n=0,g,i='';try{i=f.readFileSync(0)}catch{}const x=(v)=>{if(n)return;n=1;clearTimeout(g);try{c.stdout.destroy();c.stdin.destroy();c.unref()}catch{}r(v)};try{c=q.spawn(Buffer.from(a[1]||'','base64url').toString(),{shell:true,detached:!W,stdio:['pipe','pipe','ignore'],windowsHide:true})}catch{return r('')}g=setTimeout(()=>{try{W?q.spawn('taskkill',['/pid',String(c.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}).unref():process.kill(-c.pid,'SIGKILL')}catch{}x('')},2000);c.stdout.setEncoding('utf8');c.stdout.on('data',(d)=>{s+=d});c.stdout.on('error',()=>{});c.stdin.on('error',()=>{});c.on('error',()=>x(''));c.on('close',(z)=>x(z===0?s.trimEnd():''));c.stdin.end(i)});const w=(m)=>o().then((t)=>process.stdout.write(a.includes('segment')?'':(t?t+(j(p.join(z,'statusline-style.json'))?.position==='end'?' \u00b7 ':'\u000a'):'')+'\u{1F6E1}\u{FE0F} ZeroH \u00b7 \u{1F534} '+m));d?import(require('url').pathToFileURL(p.join(d,'lib','statusline.js'))).then((m)=>m.statuslineMain(a)).catch(()=>w('status line failed')):w('not installed \u00b7 remove it with /statusline')" segment
```

The style file applies to the segment too.

## Turn it off and on

`/zeroh-disclosure:settings statusline off`, or deleting it with `/statusline`: ZeroH records that
and never adds it back. `/zeroh-disclosure:settings statusline on` turns it on again. Uninstall
removes it from every settings file ZeroH wrote it to, and puts back each status line of yours it
added its part to.
