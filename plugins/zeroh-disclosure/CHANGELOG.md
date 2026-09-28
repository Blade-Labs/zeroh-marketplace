# Changelog

## 1.0.0-rc.2

Features: +statusline, +statusline.custom, +settings.uncertain-block, ~install.plugin, ~mask.tool-output,
~pass.uncertain-notice, ~mgmt.user-authority,
~stop.disallowed-host, ~guard.settings, ~mask.file-read, ~detect.keys-gitleaks (see
[docs/features.md](docs/features.md))

### Pass by default: ZeroH never takes away what Claude Code can do

New [product principles](docs/product-principles.md): mask what we can, pass what we can't, and
say so. By default only two things are stopped: a secret heading to a host that isn't allowed for
it, and the model changing ZeroH's own protection. Everything ZeroH can't check runs as it would
without ZeroH, with one plain line such as
`ZeroH Disclosure: this command was not protected (dynamic destination).`, shown once per reason
per turn; the first one in a session adds how to block these instead. The Stop line counts them
("N operations not protected"), and the receipt and `/zeroh-disclosure:report` list them by reason.
`/zeroh-disclosure:settings uncertain block` restores the stops. What changed by default:

- A prompt with a secret typed while the local proxy isn't running is sent, with a
  "not protected (proxy not running)" line and how to fix it (it was stopped).
- Background commands and `Monitor` without the proxy run with the same line (they were denied).
- SSH keys, kubeconfig, AWS credentials, `.netrc` and other credential files can be read; what the
  detector finds in them is masked (they were refused). ZeroH's own keys stay refused.
- A known secret the model writes into a command gets the same destination rules as a restored
  one: an allowed host runs, a host that isn't allowed is stopped with the allow command, and an
  uncertain destination runs with a line suggesting `/zeroh-disclosure:report-miss` and rotating
  the key (it was denied).
- A secret sent to a destination ZeroH can't work out (a `$HOST` variable, a script, an unknown
  launcher, a command it can't parse) is restored as before, with a line.
- A prompt over 256 KB is sent unscanned, and a prompt ZeroH can't mask because it can't open its
  vault is sent through the proxy, each with a line (both were stopped).
- A hook that runs out of time passes the content through with a "timed out" line; the watchdog
  answers two seconds before Claude Code's own timeout.
- The last eight default stops pass too, each with its line, recorded on the turn:
  - a project `.zeroh.env` that can't be read: the defaults and your own settings apply
    ("not protected (couldn't read .zeroh.env; using defaults)"), and the session start says so;
  - tool output over 1 MB goes to Claude unscanned ("not protected (too large to scan)"), and
    output whose check fails goes as it is ("not protected (check failed)"); both were withheld;
  - when ZeroH can't open its vault, tool output, file reads and prompts through the proxy go as
    they are, with "not protected (ZeroH couldn't open its vault) · /zeroh-disclosure:doctor"
    (the proxy used to refuse the request). A new product principle: never mask what we can't
    restore, because a dead token would break your commands, edits and screen;
  - a raw secret in a WebFetch URL gets the destination rules, like one in a command: an allowed
    host runs, a host that isn't allowed is stopped with the allow command (it was denied);
  - when ZeroH can't put a value back, the call runs with the token and says so ("ran with the
    token, not your key: …"): the vault can't be opened (`/zeroh-disclosure:doctor`), the value
    expired (read the file again), a `Monitor` command (it can't receive restored values), or a
    command ZeroH couldn't prepare the value for. Claude is told too, so it can fix the call. These
    were denied. The Stop line counts them apart ("N operations ran with the token, not your
    key"), and they don't count as "not protected" on the status line.

  No stop is left open for an owner decision; the deny-inventory test now checks that.

### Status line: always see whether you're protected

With your first message after the install, ZeroH adds one line under Claude Code's prompt, unless
you have a status line of your own, and says so:
`🛡️ ZeroH · 🟢 protected · 4 masked · 0 sent · unmask EMAIL 12m · receipt ↗`. 🟢 means the hooks
work and the proxy masks what you type; 🟡 names what is only partly protected and the fix
(`files only`, `proxy starts with your first prompt`, `proxy down`, `starting`,
`N not protected this turn`); 🔴 names why nothing is protected (`hooks failing`, `hooks stopped`,
`hooks never ran`, `vault can't be opened`, `plugin disabled`, `not installed`). `receipt ↗` is a
terminal link to the session's receipt. It reads a small `status.json` and heartbeat the hooks
keep per session, with no network call, and never shows a value.

- The entry (in the README) is one `node -e` command that finds the installed plugin itself,
  survives plugin updates, runs in Bash, Git Bash and both PowerShells, and runs only a plugin copy
  Claude Code lists as installed or keeps in its cache.
- ZeroH records your choice per settings file: `/zeroh-disclosure:settings statusline off` or
  deleting it with `/statusline` is never undone; your own status line is never replaced (the
  `segment` command adds ZeroH's part to it). Uninstall removes the entry from every file it was
  written to.
- Make it yours: Claude can change how it looks when you ask (fields, order, separator, labels,
  emoji, compact wording, colour, "only when something is wrong") through
  `statusline-style.json`, the one ZeroH file it may edit. The state and its fix always show while
  ZeroH isn't 🟢, and labels can't fake a state. `zeroh-disclosure statusline --json` gives the
  state as versioned data (`zeroh-statusline/1`) for a status line of your own, and
  `/zeroh-disclosure:settings statusline style` shows where the style lives. See
  [docs/statusline.md](docs/statusline.md).
- The first message also turns on auto-update for the zeroh marketplace, unless you set it either
  way, once.
- The install prompt is one line: `Install ZeroH Disclosure for me by following
https://github.com/Blade-Labs/zeroh-marketplace`. The marketplace's README carries every step
  Claude needs (Node.js check, the two commands, what to tell the user), so it reads one page.
- The settings guard stops the model adding, changing or removing any `statusLine`, and changing
  the `env` keys hooks run under (`PATH`, `NODE_OPTIONS`, `HOME`, `CLAUDE_CONFIG_DIR`, …).
- The uninstall tombstone moved from the shared temporary folder into ZeroH's own folder, where
  no other local user can plant it.
- Only a status line command ZeroH wrote, complete, counts as ZeroH's: a status line of your own
  that runs ZeroH's segment (`zeroh=$(… segment); printf …`) is never replaced or removed. The
  first-message setup is recorded only once the settings file is written, so a write that fails is
  tried again at the next prompt. `statusline-style.json` stays editable only as a plain file: a
  link in its place, even a broken one, is protected like the rest of ZeroH's folder.
- The Stop line, the status line, the receipt and `/zeroh-disclosure:report` no longer count a
  prompt that was sent unmasked (no proxy) or stopped as masked, or say Claude saw its token; they
  read what happened from the signed receipt, so a finalised turn is counted the same way. The
  report's "prompts stopped" now counts finalised turns too.

### Commands ZeroH reads more precisely

- One shell tokenizer, checked against real bash, reads quoting, escapes, `$'…'`, heredocs and
  launchers (`env`, `timeout`, `sudo`, `nohup`, `xargs`, absolute paths) before any check, for both
  the settings guard and the destination check. `rg --pre` against ZeroH's or Claude's files is
  refused in every spelling; reading those files with any command is fine.
- Destinations are read across the whole command, with no length limit; a network command's
  operand is a host whatever it looks like, and a dotted word counts as a file only if it exists.
- Options are read once, as the program reads them, for both checks: clustered and attached short
  options, `--option=value`, GNU long-option abbreviations and each program's own optional values
  mean the same as the spelled-out form (`curl -sKconfig.txt` is `curl -K config.txt`,
  `python3 -c'…'` is `python3 -c '…'`, `perl -le'…'` is `perl -l -e '…'`, `sed --expr=…` is
  `sed --expression=…`).
- Writing, deleting or running Claude Code's settings or ZeroH's hooks is stopped when ZeroH reads
  it in the command: inline Python, Node, Perl, Ruby, PHP or Lua code whose write, delete or
  command call names one of those files (each language's calls are read, strings and comments
  aside), sed (`w`, `W`, `s///w`, `e`) and awk (output redirection, pipes, `system()`, with its
  continuations, regex literals and variables read). Reading them this way runs as before. A
  program that names one of those files but whose effect ZeroH can't read (a `$SCRIPT`, `-f
file`, code that picks the file or the call at run time) runs with a "not protected" line, and
  is denied with `uncertain block`.
- A restored value given to a sourced script (`source`, `.`), to a Git command that talks to a
  remote (`push`, `fetch`, `pull`, `clone`, `ls-remote`, …, whose destination comes from the
  repository's configuration), to a Git alias, or to sed's `e` command runs with a "not protected"
  line, and is stopped in `uncertain block` mode before it is restored. A Git URL on the line is
  checked like any other host; local Git commands stay local.
- `gh` goes to the GitHub host named on the line (`--hostname`, a URL, `-R host/owner/repo`,
  `GH_HOST=`; `github.com` also means `api.github.com`), checked like any host; without one the
  host comes from gh's configuration and the command runs with a "not protected" line. `openssl
s_client`, `s_time`, `ocsp` and `cmp` are checked against the host they connect to, and an openssl
  subcommand ZeroH doesn't know is not taken as local. A Git `-c` that names a program
  (`core.sshCommand`) is a script whatever the remote, `git remote add -f` fetches, and
  `gh extension exec` runs a local program. Local uses
  (`gh --version`, `gh config`, `openssl rand`, `openssl x509`) stay local. Options of local
  programs that reach another machine or run a program (a `host:path` tar archive, `tar -I`,
  `rg --pre`, `sort --compress-program`, `zip -TT`, `less +!…`, a UNC path) are treated the same
  way; in PowerShell a UNC path's host is the destination.

### Changes to ZeroH's own protection

- **Management commands are applied on your own typed prompt.** `/zeroh-disclosure:proxy off|on`,
  `:allow` (and `--remove`), `:doctor --fix`, `:uninstall --yes`, `:unmask caps` and the
  `:settings` changes now finish on the same turn: the command's `!` block only records the
  request, and ZeroH applies it when it checks the prompt you typed. The result appears at once,
  starting with `✓ Done by ZeroH Disclosure (your command ran here and was not sent to Claude):`,
  under Claude Code's "operation blocked by hook" label; nothing is sent to the model.
- **The command-line tool refuses these changes for anyone but you.** Run by Claude through Bash,
  PowerShell or Monitor, under any name, launcher or quoting, it changes nothing and answers
  `Nothing changed: <action> changes what ZeroH Disclosure protects, so only you can do it.` with
  the slash command and terminal command to use. In a terminal outside Claude Code it shows the
  exact action and asks you to type a one-time four-character code; the recovery commands
  (`doctor --fix`, `proxy off`, `uninstall --yes`) keep working there.
- `vault clear` now always needs `--yes`, and `uninstall` without `--yes` only shows what it would
  remove, in a terminal too; the typed "yes" prompts are replaced by the code.
- **New setting `ZEROH_UNCERTAIN`** (`/zeroh-disclosure:settings uncertain pass|block`): `pass`, the
  default, never stops ordinary work and restores as before when a destination can't be proven;
  `block` denies such uncertain cases. A repository's `.zeroh.env` may only set it to `block`.

## 1.0.0-rc.1

The first public release: the free tier of ZeroH Disclosure, working in Claude Code on macOS,
Linux and Windows.

### Masking and restore

- **What you type is masked, not just blocked.** A local proxy, on by default, masks every request
  on its way to the model: typed text, `CLAUDE.md`, memory and tool results. It needs no
  administrator rights and survives a reboot through a per-user login item. It protects the first
  session from its first prompt, with no restart; a secret in the prompt that switches the session
  to the proxy is stopped. Without the proxy, a prompt with a secret is stopped, says why in three
  plain lines, and a masked copy goes to your clipboard; the prompt is never repeated.
- **File contents and command output reach the model as tokens** (`[TYPE-xxxxxx]`). Real values go
  back only into commands on your machine, through a short-lived private file, and never into the
  command text that the model or the transcript sees. A command that can't be rewritten safely is
  denied.
- **Keys reach only their allowed hosts**, including hosts written without `https://` and IP
  addresses. Only you can allow a new host (`/zeroh-disclosure:allow`), and the model can't change
  ZeroH's settings, its allow list or its own plugin files, or run the commands that change them.
  `/zeroh-disclosure:allow` alone shows where each known value may go and why. An MCP server gets
  a real value only when you allow it (`mcp:<server>`).
- **Real values on your screen.** Claude's answers show the real values; the model and the saved
  conversation keep tokens. When Claude names a token itself it writes `⟦TYPE-xxxxxx⟧`, which is
  never replaced.
- **Timed unmask of personal data.** Claude can ask to see one kind of personal data (for example
  `EMAIL`) for 15 minutes, an hour or the session; you decide in Claude Code's own dialog, within
  caps you set. Tell Claude to stop and it ends the unmask at once. Keys are never unmasked.

### Detection

- **Detection by pattern and exact value:** about 220 provider key formats from the gitleaks rule
  set, secrets next to key-like names, values from your `.env` and credential files (also when
  encoded), and 33 kinds of personal data. A random-looking value next to a key-like name
  (`AUTH_TOKEN=…`) is masked; a random value with no name, in what you type, gets a warning. A
  quoted value next to such a name is masked whole unless all of it is a reference, a complete CSS
  value or a label (`"Enter your password"`): a password with a CSS call or a template in it, or a
  passphrase that includes the word "secret", is masked.
- **Personal data is decided by maintained libraries, vendored in the plugin** (no install, no
  runtime dependency): validator.js 13.15.35 for email addresses (with IANA's top-level domains),
  card numbers, IBANs, IP addresses, passports, crypto addresses and several national IDs, and
  libphonenumber-js 1.13.14 (Google's metadata) for phone numbers. Whole addresses are masked,
  including apostrophes, `+` tags, non-ASCII letters, quoted local parts and IP literals.
- **National IDs and tax numbers from 21 countries**, each decided by a vendored validator or a
  published rule: US SSNs and ITINs, UK National Insurance numbers, Qatar IDs, Spanish, Italian
  and Finnish IDs, Aadhaar, PAN, CNIC, Emirates ID, Saudi national ID and iqama, CPF, PESEL,
  personnummer, BSN, fødselsnummer, Thai, Israeli, Chinese, Taiwanese and Hong Kong IDs, and
  Malaysian NRIC, plus dates of birth. A number that is only digits counts next to a word naming
  it, a key such as `"ssn":`, or its CSV column header
  ([What ZeroH Disclosure detects](docs/detection.md)).
- **Formats:** text PDFs and notebooks are masked. Images and scanned PDFs pass with a one-line
  notice. Names and currency amounts are left to context-aware detection, planned for Premium.
- **One detection engine for Blade Labs.** The detection rules and their vendored libraries are
  now the MIT-licensed `@bladelabs/sensitive-data-detectors` package from the Blade Labs monorepo,
  shipped as a synced copy in `vendor/sensitive-data-detectors` (still nothing to install). What
  is detected is unchanged.
- **Report a miss.** `/zeroh-disclosure:report-miss` takes a value ZeroH did not mask through a
  private dialog, masks it from then on and keeps a shape-only report on your machine. Sending
  reports to Blade Labs comes in 1.1.

### Receipts

- **Receipts as a till slip.** Every turn gets a receipt signed on your laptop (ECDSA P-256),
  recording what the hooks did. `/zeroh-disclosure:mask-receipt`, `/zeroh-disclosure:report` and
  `receipt.html` show what was withheld, what was sent, and whether every receipt verified;
  `/zeroh-disclosure:mask-show` shows which tokens the model saw.
- **Nothing in your projects.** Receipts, turn records and allow rules live in ZeroH's own folder,
  `~/.zeroh/projects/<project>/` (`%LOCALAPPDATA%\ZeroH` on Windows). Receipts are kept for 90
  days by default (`/zeroh-disclosure:settings receipts keep`, `ZEROH_RECEIPT_RETENTION`; a
  repository may only shorten it) and contain no values.
- **A vault you can inspect:** detected values expire after 7 days without use (or per session,
  or after 30 days). `/zeroh-disclosure:settings vault status` shows counts and ages, never
  values, and `vault clear --yes` empties it.

### Everyday use

- **Everything from inside Claude Code.** Every action is a slash command: `:status`, `:allow`,
  `:unmask`, `:report`, `:proxy`, `:doctor`, `:settings` and `:uninstall`. Messages that point to
  a fix name the slash command first and, for when Claude Code can't start, the exact terminal
  command with the plugin's path filled in.
- **Ask Claude about ZeroH.** The `about` skill answers what ZeroH protects and doesn't, how it
  works and what Free and Premium include, from the live rule set.
- **A banner at session start** with the protection status; `/zeroh-disclosure:status` shows it in
  full, and `/zeroh-disclosure:settings banner full|compact|off` sets how much you see.
- **Uninstall is one command and complete.** `/zeroh-disclosure:uninstall --yes` removes the
  plugin from Claude Code first (`claude plugin uninstall`), then the proxy, its settings entry
  and login item, and ZeroH's folder. It never deletes a folder that isn't ZeroH's. Sessions still
  open do nothing more until you exit them.

### Reliability and safety

- **Never blocks Claude Code.** An error the local proxy produces is a plain, non-retryable
  message; network failures are retried by Claude Code as without ZeroH; a proxy that stopped is
  restarted within three seconds, or you get one clear "restart Claude Code" notice, and typed
  secrets are stopped rather than sent. `/zeroh-disclosure:doctor --fix` is the one recovery,
  including for a build before 1.0, and `doctor --report` prints a paste-safe summary of the local
  diagnostic reports, which never leave your machine.
- **Fails closed on errors it can see:** if ZeroH can't open its vault or a hook fails while it
  loads or runs, output is withheld, the call is denied or the prompt is stopped, rather than raw
  content passing through. Commands that time out or are interrupted are the exception
  (README, "Guarantees and limits").
- **A repository can't weaken ZeroH:** a project's `.zeroh.env` may only change display settings
  and retention, or tighten a protection.
- **Proxy lifecycle.** The proxy uses your corporate `HTTPS_PROXY`, `NO_PROXY` and
  `NODE_EXTRA_CA_CERTS`, also after a reboot, and drops a recorded network proxy it can't reach.
  It restarts itself with new code after a plugin update, and takes its settings entry with it
  when it stops, except where a running session uses it. `proxy off` stays off until `proxy on`.
  On a machine that refuses login items it is not used, so no session meets a dead port. Sessions
  in a project where the plugin is disabled pass through unmasked while no ZeroH session runs, and
  are masked while one does.
- **Vault safety.** The vault key is created atomically; `doctor --fix`, from any folder, resets
  every vault that can't be read and says which project, deleting the old files unless
  `--keep-backups`; a vault that can't be read for a permission or a lock is left alone, and a
  newer vault format is never overwritten.
- **Windows:** commands run through Git Bash or Claude Code's PowerShell tool; the slash commands
  need one of them as the default shell. ZeroH's folder is `%LOCALAPPDATA%\ZeroH`, limited to your
  account, and the proxy starts at logon without a console window.
- Hooks on a Node.js older than 20 say so once and step aside.
- The unit tests run with `npm test` and need only Node.js.

## 0.2.0

- Tool output masked before the model reads it.
- Real values restored on your machine for allowed hosts.
- Real values shown on your screen while the transcript keeps tokens.
- An opt-in local masking proxy.
- Hooks rebuilt on Node.js built-ins.

## 0.1.1

- Prompts that contain a secret are stopped before they are sent, and a masked copy is offered.
- Signed local receipts.
