# Changelog

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
  (`AUTH_TOKEN=…`) is masked; a random value with no name, in what you type, gets a warning.
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
