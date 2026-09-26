# Changelog

## 1.0.0-rc.1

The first public release: the free tier of ZeroH Disclosure, working in Claude Code on macOS,
Linux and Windows.

- **What you type is masked, not just blocked.** A local proxy, on by default, masks every request
  on its way to the model: typed text, `CLAUDE.md`, memory and tool results. It needs no
  administrator rights, survives a reboot through a per-user login item (on a machine that
  refuses login items it is not used, so no session ever meets a dead port), restarts itself with
  new code after a plugin update, and
  `zeroh-disclosure proxy off` restores your Claude Code settings. Without it, a prompt with a
  secret is stopped and a masked copy goes to your clipboard. It protects the first session from
  its first prompt, with no restart (a secret in the prompt that switches it to the proxy is
  stopped; a session that starts behind the proxy masks it). A stopped prompt says why in three
  plain lines, with the masked copy, and never repeats the prompt. Sessions in a project where the plugin is disabled pass
  through it unmasked while no ZeroH session runs, and are masked while one does.
- **File contents and command output reach the model as tokens.** Real values go back only into
  commands on your machine, through a short-lived private file, and never into the command text
  that the model or the transcript sees. A command that can't be rewritten safely is denied.
- **Keys reach only their allowed hosts**, including hosts written without `https://` and IP
  addresses. Only you can allow a new host (`/zeroh-disclosure:allow`), and the model can't change
  ZeroH's settings, its allow list or its own plugin files, or run the commands that change them.
  `/zeroh-disclosure:allow` alone shows where each known value may go and why.
- **Detection by pattern and exact value:** about 220 provider key formats from the gitleaks rule
  set, secrets next to key-like names, values from your `.env` and credential files (also when
  encoded), and personal data. Names and currency amounts are left to context-aware detection,
  planned for Premium.
- **Personal data is decided by maintained libraries, vendored in the plugin** (no install, no
  runtime dependency): validator.js 13.15.35 for email addresses (with IANA's top-level domains),
  card numbers, IBANs and Spanish, Italian and Finnish national IDs, and libphonenumber-js 1.13.14
  (Google's metadata) for phone numbers. Whole addresses are masked, including apostrophes, `+`
  tags, non-ASCII letters, quoted local parts and IP literals. Phone numbers without a country code
  are found only in what you type, with `ZEROH_PHONE_REGION` or your locale's region.
- **IP addresses and national IDs from 20 countries**, each decided by a vendored validator or a
  published rule: IP addresses (validator.js `isIP`; loopback, link-local, documentation and other
  special-purpose ranges, versions and section numbers left out), US SSNs (SSA rules) and ITINs
  (IRS), UK National Insurance numbers (HMRC NIM39110), Qatar IDs (birth century, year and an ISO
  3166 nationality code), Aadhaar, PAN, CNIC, Emirates ID, Saudi national ID and iqama
  (Saudi-ID-Validator), CPF, PESEL, personnummer, BSN, fødselsnummer, Thai, Israeli, Chinese,
  Taiwanese and Hong Kong IDs. The Gulf and US kinds use ZeroH Enterprise's names (`QATAR_ID`,
  `SAUDI_NID`, `IQAMA`, `EMIRATES_ID`, `US_SSN`, `US_ITIN`). A number that is only digits counts
  next to a word naming it, a key such as `"ssn":`, or its CSV column header (README, "What is
  detected, and by what").
- **A random-looking value next to a key-like name is masked** (`AUTH_TOKEN=…`, `token: …`), not
  only warned about; the warning is left for random values with no key-like name, such as a URL
  path segment or a bare argument, in what you type.
- **Rules shared with Blade Labs' chat product** (ai-ui-chat `src/services/pii-detector.ts`):
  Arabic-Indic digits and Arabic context words for Gulf IDs, Malaysian NRIC (a real date and a
  place-of-birth code), passport numbers for GB, US and MY (validator.js `isPassportNumber`, next
  to "passport"), dates of birth (a real date from 1900 to five years ago, next to "DOB", "born"
  or "birthday") and Bitcoin and Ethereum addresses (validator.js `isBtcAddress`,
  `isEthereumAddress`; Ethereum in tool output only next to a wallet word). 33 kinds in all.
- **Formats:** text PDFs and notebooks are masked. Images and scanned PDFs pass with a one-line
  notice.
- **Timed unmask of personal data.** Claude can ask to see one kind of personal data (for example
  `EMAIL`) for 15 minutes, an hour or the session; you decide in Claude Code's own dialog, within
  caps you set (the dialog says when a cap limits it). Tell Claude to stop and it ends the unmask
  at once (`end_unmask`, which can never create or extend one). Keys are never unmasked.
- **Everything from inside Claude Code.** Every action is a slash command: `:doctor`, `:allow`,
  `:proxy`, `:settings` (banner, receipt retention, vault), `:unmask`, `:report`, `:uninstall`
  (the steps). Messages that point to a fix name the slash command first and, for when Claude Code
  can't start, the exact terminal command with the plugin's path filled in; nothing asks you to
  run a `zeroh-disclosure` command that is not on your `PATH`.
- **Uninstall is one command and complete.** `/zeroh-disclosure:uninstall --yes` removes the
  plugin from Claude Code first (`claude plugin uninstall`), then the proxy, its settings entry and
  login item, and ZeroH's folder. Sessions still open do nothing more until you exit them, so
  nothing is set up again.
- **Ask Claude about ZeroH.** The `about` skill answers what ZeroH protects and doesn't, how it
  works and what Free and Premium include, from the live rule set (`zeroh-disclosure catalog`).
- **Nothing in your projects.** Receipts, turn records and allow rules live in ZeroH's own folder,
  `~/.zeroh/projects/<project>/` (`%LOCALAPPDATA%\ZeroH` on Windows), with `<project>` spelled as
  Claude Code names its `~/.claude/projects` folders. Receipts are kept for 90 days by default
  (`ZEROH_RECEIPT_RETENTION=forever|1y|90d|30d`, `zeroh-disclosure receipts keep`; a repository
  may only shorten it) and contain no values; `/zeroh-disclosure:status` shows the policy.
- **Report a miss.** `/zeroh-disclosure:report-miss` takes a value ZeroH did not mask through a
  private dialog, masks it from then on and keeps a shape-only report on your machine. Sending
  reports to Blade Labs comes in 1.1.
- **Never blocks Claude Code.** An error the local proxy produces is a plain, non-retryable
  message; a proxy that stopped is restarted within three seconds or taken out of your settings
  with one clear "restart Claude Code" notice, and typed secrets are stopped rather than sent.
  `zeroh-disclosure doctor --fix` is the one recovery: it resets the proxy (your settings entry
  and every ZeroH proxy it finds, including one from a build before 1.0), and `doctor --report`
  prints a paste-safe summary of the local diagnostic reports, which never leave your machine.
- **Receipts as a till slip.** Every turn gets a receipt signed on your laptop (ECDSA P-256),
  recording what the hooks did: a stopped prompt is signed as blocked, a prompt the proxy masked as
  masked. `/zeroh-disclosure:mask-receipt`, `/zeroh-disclosure:report` and
  `receipt.html` show what was withheld, what was sent, and whether every receipt verified.
  `/zeroh-disclosure:mask-show` shows which tokens the model saw.
- **A vault you can inspect:** detected values expire after 7 days without use (or per session, or
  after 30 days). `zeroh-disclosure vault status` shows counts and ages, never values, and
  `zeroh-disclosure vault clear` empties it.
- **A banner at session start** with the protection status. `/zeroh-disclosure:status` shows it in
  full, and `zeroh-disclosure banner full|compact|off` sets how much you see.
- **Fails closed on errors it can see:** if ZeroH can't open its vault or a hook fails while it
  loads or runs, output is withheld, the call is denied or the prompt is stopped, rather than raw
  content passing through. Commands that time out or are interrupted are the exception; the README
  lists it.
- **A repository can't weaken ZeroH:** a project's `.zeroh.env` may only change display settings
  and retention, or tighten a protection.
- **Windows:** commands run through Git Bash or Claude Code's PowerShell tool; the slash commands
  need one of them as the default shell. The proxy starts at logon without a console window.
- **Lifecycle (D-13).** The proxy uses your corporate `HTTPS_PROXY`, `NO_PROXY` and
  `NODE_EXTRA_CA_CERTS` also after a reboot; network failures are retried by Claude Code as without
  ZeroH, and a recorded network proxy that can't be reached (another network) is dropped;
  `proxy off` stays off until `proxy on`, also from `/zeroh-disclosure:proxy off|on`; the proxy
  takes its settings entry with it when it stops for a shutdown or because `~/.zeroh` was deleted,
  except where a running session uses it (that session's next prompt restarts it); login items name a stable Node.js and
  are only counted where something starts them (not over SSH, in WSL or containers). A session's
  typed secrets count as masked once its environment names this install's proxy or the proxy has
  seen its traffic, and while a ZeroH
  session runs the proxy masks every request it cannot tie to a session. The vault key is created
  atomically; an unreadable vault is told plainly and `doctor --fix`, from any folder, resets
  every vault that can't be read (a key problem affects them all) and says which project; the old
  files are deleted unless `--keep-backups`; a vault that can't be read for a permission or a lock
  is left alone; a newer vault format is never overwritten; a read-only project keeps its receipts under
  `ZEROH_HOME`; receipt commitment keys stay under `ZEROH_HOME` and go with `vault clear`; on
  Windows ZeroH's folder is `%LOCALAPPDATA%\ZeroH`, limited to your account from the first write
  and guarded like `~/.zeroh`. `zeroh-disclosure uninstall` removes everything ZeroH keeps; it
  refuses while a session with the plugin runs and never deletes a folder that isn't ZeroH's. Hooks on a Node.js older than 20 say so once and step aside.
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
