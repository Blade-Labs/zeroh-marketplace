# ZeroH Disclosure for Claude Code

ZeroH Disclosure is a Claude Code plugin that keeps your API keys, passwords and personal data
away from the model while Claude keeps working with them. Before anything reaches the model, the
plugin replaces sensitive values with tokens such as `[API_KEY-3f9a1c]`. The real values stay in an
encrypted vault on your machine and are put back only when a command runs locally, and only for
hosts that value is allowed to reach. Your screen still shows the real values in Claude's answers.
Every turn gets a receipt signed on your laptop. The plugin runs
locally on Node.js; the few third-party libraries it uses are vendored in the plugin, so there is
nothing to install. It needs no account and makes no network call to Blade Labs.

- [30-second demo](#30-second-demo)
- [Install](#install)
- [Try it](#try-it)
- [How it works](#how-it-works)
- [What it catches, and what it does not](#what-it-catches-and-what-it-does-not)
- [Privacy: guarantees and limits](#privacy-guarantees-and-limits)
- [The local proxy](#the-local-proxy)
- [Commands](#commands)
- [Settings](#settings)
- [Receipts](#receipts)
- [Platforms](#platforms)
- [Free and Premium](#free-and-premium)
- [Documentation](#documentation)
- [Contributing, security and licence](#contributing-security-and-licence)

## 30-second demo

Token suffixes depend on the value.

```text
$ printf 'STRIPE_KEY=sk_live_ZEROHFAKE_1234567890abcdef\n' > .env
$ claude
> Read .env and check the key against the Stripe API.
```

| Step               | What the model gets                                  | What happens on your machine                                |
| ------------------ | ---------------------------------------------------- | ----------------------------------------------------------- |
| Claude reads .env  | `STRIPE_KEY=[API_KEY-3f9a1c]`                        | The file on disk is unchanged                               |
| Claude runs a call | `curl -u [API_KEY-3f9a1c]: https://api.stripe.com/…` | The command runs with `sk_live_ZEROHFAKE_…` on your machine |
| Output comes back  | Any echo of the key is `[API_KEY-3f9a1c]` again      | Nothing to do                                               |
| Claude answers     | "The key [API_KEY-3f9a1c] is valid."                 | Your screen shows "The key sk_live_ZEROHFAKE_… is valid."   |

If Claude tries to send the key to a host it is not allowed to reach, the call is stopped and you
are shown the one command that allows it.

## Install

**First, Node.js 20 or later on your `PATH`.** ZeroH's hooks and proxy run on Node.js, and Claude
Code's native installer does not bring it. Check with `node --version`; if it is missing or older
than 20, install it:

```bash
brew install node                    # macOS, with Homebrew
winget install OpenJS.NodeJS.LTS     # Windows
sudo apt install nodejs              # Debian, Ubuntu: then check `node --version`
```

Or use the installer from [nodejs.org](https://nodejs.org) on any system. If the Node.js your
package manager installs is older than 20, install Node.js 20 or later from nodejs.org or from
your package manager's newer channel instead.

Without Node.js, Claude Code shows a hook error at each event and ZeroH protects nothing; with a
Node.js older than 20, the session start says so once and ZeroH steps aside. Either way Claude Code
keeps working.

Then install the plugin:

```bash
claude plugin marketplace add Blade-Labs/zeroh-marketplace
claude plugin install zeroh-disclosure@zeroh
```

Start Claude Code. The first session shows the ZeroH Disclosure banner and sets up the local
proxy; your first prompt waits about two seconds once while Claude Code switches to it, and from
then on what you type is masked. No restart is needed. A secret typed in the very prompt that
switches the session is stopped rather than sent, in case it would still go out directly; a
session that starts behind the proxy masks it from its first prompt. When the proxy cannot be
used, a prompt in
which you type a secret or personal data is stopped rather than masked, and ZeroH copies a masked
version to your clipboard, when it can, for you to paste instead.

`/zeroh-disclosure:status` shows the full status at any time.

## Try it

With a Stripe **test** key you can watch the whole round trip against the real Stripe API; it
takes a free Stripe account and a minute.

1. Create a free account at [stripe.com](https://stripe.com), open **Developers → API keys** in
   test mode and copy the secret key (`sk_test_…`).
2. In a test project, put it in `.env`:

   ```text
   STRIPE_KEY=sk_test_…
   ```

3. Start `claude` in that project and ask:

   ```text
   > Check my Stripe balance.
   ```

   Claude reads `.env` and sees `STRIPE_KEY=[API_KEY-3f9a1c]`, then runs
   `curl https://api.stripe.com/v1/balance -u [API_KEY-3f9a1c]:`. ZeroH puts the real key back on
   your machine, and Stripe answers `200` with `"livemode": false`. No configuration was needed:
   `api.stripe.com` is a built-in destination for Stripe keys. The model only ever saw the token.

4. Now ask for something the key should not do:

   ```text
   > Post it to our staging API at staging.pay-internal.dev.
   ```

   The call is blocked before it runs, and you are shown the one line that would allow it:

   ```text
   ZeroH Disclosure blocked STRIPE_KEY → staging.pay-internal.dev. To allow it, type:
   /zeroh-disclosure:allow STRIPE_KEY staging.pay-internal.dev
   ```

   Only you can run it: Claude can't allow a destination itself.

5. Type `/zeroh-disclosure:allow` to see where each value in this project may go and why:

   ```text
   Where each known value may go (values are never shown):
     STRIPE_KEY → api.stripe.com, files.stripe.com, connect.stripe.com (built-in: Stripe)
   ```

**No Stripe account?** Any made-up value works against `httpbin.org`, which echoes the Bearer token
it received. Put `STRIPE_KEY=sk_test_ZEROHFAKE123` in `.env`, allow the host first with
`/zeroh-disclosure:allow STRIPE_KEY httpbin.org`, then ask Claude to "call
https://httpbin.org/bearer with STRIPE_KEY as a Bearer token". httpbin answers `200` with
`"authenticated": true`: the real key reached the server, while the echo of it came back to the
model as `[API_KEY-…]`. Then ask for a host you have not allowed to see it blocked.

Personal data works the same way, and you can show one kind of it to Claude for a while. Put a
few addresses a sign-up form rejected into a log:

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

Claude sees `rejected [EMAIL-…] by validateEmail` for every line, so it asks to unmask `EMAIL`
with its reason (you can also type `/zeroh-disclosure:unmask EMAIL find why validateEmail rejects
them`). Accept Claude Code's dialog for 15 minutes and Claude sees the addresses: an apostrophe, a
`+` tag, non-ASCII letters, a quoted local part and an IP literal, all valid addresses that a
simple pattern rejects. Tell Claude to stop, and email addresses are masked again at once.

## How it works

```mermaid
sequenceDiagram
    actor You
    participant ZeroH as ZeroH (hooks and local proxy)
    participant Model as Claude (model)
    participant Local as Your shell or tool

    You->>ZeroH: Prompt, file or command output with sk_live_ZEROHFAKE…
    ZeroH->>Model: The same text with [API_KEY-3f9a1c]
    Model->>ZeroH: Run curl -u [API_KEY-3f9a1c]: https://api.stripe.com/…
    ZeroH->>ZeroH: Is api.stripe.com allowed for this key?
    ZeroH->>Local: Run it with the real value, bound locally
    Local-->>ZeroH: Output
    ZeroH-->>Model: Output masked again
    Model-->>You: Answer with the token; your screen shows the real value
```

1. **Mask.** The local proxy masks what you type, `CLAUDE.md` and everything else in each request
   to the model. Claude Code hooks mask file reads, command output and MCP results before the model
   reads them.
2. **Restore locally.** When the model uses a token in a command, ZeroH checks every host the
   command names. If the value may go there, the real value is bound into the command through a
   short-lived private file; it is never written into the command text that the model or the
   transcript sees. Otherwise the call is denied.
3. **Show.** Your screen shows real values in Claude's answers. The model and the saved
   conversation keep the tokens.
4. **Receipt.** Every turn gets a signed receipt in ZeroH's own folder, never in your project:
   `~/.zeroh/projects/<project>/sessions/<session-id>/` (`%LOCALAPPDATA%\ZeroH\projects\…` on
   Windows), where `<project>` is the project path spelled the way Claude Code names its
   `~/.claude/projects` folders. ZeroH prints a line only when the turn masked, stopped, blocked or
   revealed something.

Values found in output expire from the vault after seven days without use (see
`ZEROH_VAULT_RETENTION`). Values from `.env` and credential files stay while they are in those
files.

## What it catches, and what it does not

The free plugin detects by pattern and by exact value. It catches:

- **API keys and tokens by provider format**: about 220 provider rules from the
  [gitleaks](https://github.com/gitleaks/gitleaks) rule set, plus built-in rules for Anthropic,
  OpenAI, Stripe, GitHub, AWS, Google, Slack, npm, PyPI, Docker, HashiCorp Vault and others.
- **Secrets by context**: passwords, tokens and secrets next to a key-like name (`password: …`,
  `db_password = …`, `AUTH_TOKEN=<random>`), private keys, `Authorization` headers, credentials in
  URLs and connection strings, signed URLs, OTP seeds and password hashes. A value next to a key-like name counts only
  when it looks like a value: code after the name (`process.env.X`, `API_KEY`, a type, a call, a
  package version, a template placeholder) and plain names made only of letters are left alone.
  These key-name rules mask what the model reads; they do not rewrite what the model writes, which
  can only hold tokens.
- **Your own values**: every value in your project's `.env` and `.env.*` files (not
  `.env.example` and similar), secret-named environment variables, and credentials in AWS, GitHub
  CLI, npm, PyPI, `.netrc`, `.git-credentials` and Docker files. They are matched exactly, also in
  base64, URL-safe base64, hexadecimal and URL-encoded form. Once a value is masked, it stays
  masked wherever it shows up again.
- **Personal data**, each value checked by a vendored library or a published rule before it is
  masked (see [What is detected, and by what](#what-is-detected-and-by-what)): email addresses,
  card numbers, IBANs, phone numbers, IP addresses, national ID and tax numbers from 21
  countries (among them US SSNs, UK National Insurance numbers, Qatar IDs and Saudi iqamas),
  passport numbers and dates of birth next to a word naming them, and Bitcoin and Ethereum
  addresses. SSH logins
  such as `git@github.com:org/repo` and no-reply addresses are not treated as email addresses, and
  sizes, resolutions, grouped numbers, dates and diff lines are not treated as phone numbers.
- **Text PDFs and notebooks**: a PDF with a text layer reaches the model as masked text, and
  notebook cells and text outputs are masked.

It does **not** catch:

- **Names and currency amounts.** They need context-aware detection, which is planned for Premium.
- **Passports of other countries and company numbers.** Only GB, US and Malaysian passports are
  caught, next to the word "passport". See below.
- **Images and scanned PDFs.** They pass to the model unchanged, with a notice such as
  `ZeroH Disclosure: screenshot.png was sent unmasked. Images aren't masked in the free plugin.`
- **Values with no known shape and no name.** A random-looking value next to a key-like name
  (`AUTH_TOKEN=…`, `secret: …`) is masked. One with no key-like name, such as a URL path segment
  or a bare command argument, matches no rule and is sent as is. When you type one, ZeroH adds a
  warning; in files and command output there is no warning. Put such a value in `.env` or a
  credential file, or report it with `/zeroh-disclosure:report-miss`, and it is masked by exact
  match from then on.
- **Destinations built at run time.** The destination check covers every host named in the
  command. It cannot see a host that a script computes or reads while it runs.
- **Transformed values.** A restored value that a command prints reversed, spaced out, as a hex
  dump or as base64 of a shifted string is not recognised when it comes back.

### What is detected, and by what

ZeroH's own code only proposes candidates (the characters around an `@`, the printed layouts of
cards and IBANs, the shape of each ID) and, for numbers that are nothing but digits, looks for a
word naming them. A published rule or a vendored library decides; a candidate it rejects stays
text. `zeroh-disclosure catalog` lists the same 33 kinds.

| Kind                                | Token                       | Decided by                                                                                                          | Needs a context word                       |
| ----------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Email addresses                     | `EMAIL`                     | validator.js `isEmail` (UTF-8 and quoted local parts, IP literals), and a top-level domain in IANA's root zone list | no                                         |
| Card numbers                        | `CARD_NUMBER`               | validator.js `isCreditCard`: an issuer's number range and the Luhn check                                            | no                                         |
| IBANs, compact or in groups of four | `IBAN`                      | validator.js `isIBAN`: the country's format and the mod-97 checksum                                                 | no                                         |
| Phone numbers                       | `PHONE_NUMBER`              | libphonenumber-js with Google's libphonenumber metadata: only numbers valid for their region                        | no (see below)                             |
| IP addresses, v4 and v6             | `IP_ADDRESS`                | validator.js `isIP`, without the special-purpose ranges below                                                       | no                                         |
| US Social Security numbers          | `US_SSN`                    | SSA assignment rules; the published sample numbers (Presidio `UsSsnRecognizer`)                                     | only as 9 bare digits                      |
| US ITINs                            | `US_ITIN`                   | IRS Publication 4757: `9XX` and the group ranges                                                                    | only as 9 bare digits                      |
| UK National Insurance numbers       | `UK_NINO`                   | HMRC manual NIM39110: the prefix letters, six digits, suffix A–D                                                    | no                                         |
| Qatar ID numbers                    | `QATAR_ID`                  | century, birth year and an ISO 3166-1 nationality code (i18n-iso-countries)                                         | yes: QID, Qatar ID, national ID, ID number |
| Spanish DNI and NIE                 | `ES_NIF`, `ES_NIE`          | validator.js `isIdentityCard('ES')`: the control letter                                                             | no                                         |
| Italian codice fiscale              | `IT_FISCAL_CODE`            | validator.js `isTaxID('it-IT')`: the control character                                                              | no                                         |
| Finnish henkilötunnus               | `FI_PERSONAL_IDENTITY_CODE` | validator.js `isIdentityCard('FI')`: the control character                                                          | no                                         |
| Aadhaar                             | `IN_AADHAAR`                | validator.js `isIdentityCard('IN')`: the Verhoeff check digit                                                       | yes: Aadhaar, UIDAI                        |
| Indian PAN                          | `IN_PAN`                    | the PAN format (holder-type letter), as Presidio's `InPanRecognizer`                                                | yes: PAN                                   |
| Pakistani CNIC                      | `PK_CNIC`                   | validator.js `isIdentityCard('PK')`                                                                                 | only without dashes                        |
| Emirates ID                         | `EMIRATES_ID`               | the `784-YYYY-NNNNNNN-N` format (no check digit is published)                                                       | only without dashes                        |
| Saudi national ID                   | `SAUDI_NID`                 | Saudi-ID-Validator `validateSAID`: starts with 1, the check digit                                                   | yes: NID, national ID, citizen             |
| Saudi iqama (residents)             | `IQAMA`                     | Saudi-ID-Validator `validateSAID`: starts with 2, the check digit                                                   | yes: iqama, residency, resident ID         |
| Brazilian CPF                       | `BR_CPF`                    | validator.js `isTaxID('pt-BR')`: both check digits                                                                  | only without dots and dash                 |
| Polish PESEL                        | `PL_PESEL`                  | validator.js `isIdentityCard('PL')`                                                                                 | yes: PESEL                                 |
| Swedish personnummer                | `SE_PERSONNUMMER`           | validator.js `isTaxID('sv-SE')`: the date and the Luhn check                                                        | yes: personnummer                          |
| Dutch BSN                           | `NL_BSN`                    | validator.js `isTaxID('nl-NL')`: the 11-proof                                                                       | yes: BSN                                   |
| Norwegian fødselsnummer             | `NO_FODSELSNUMMER`          | validator.js `isIdentityCard('NO')`: both check digits                                                              | yes: fødselsnummer                         |
| Thai national ID                    | `TH_TNIN`                   | validator.js `isIdentityCard('TH')`                                                                                 | yes: Thai ID, national ID                  |
| Israeli ID                          | `IL_ID`                     | validator.js `isIdentityCard('he-IL')`                                                                              | yes: teudat zehut, Israeli ID              |
| Chinese resident ID                 | `CN_RESIDENT_ID`            | validator.js `isIdentityCard('zh-CN')`: region, date and check character                                            | yes: 身份证, resident ID                   |
| Taiwanese national ID               | `TW_NATIONAL_ID`            | validator.js `isIdentityCard('zh-TW')`                                                                              | yes: 身分證, Taiwan ID                     |
| Hong Kong identity card             | `HK_IDENTITY_CARD`          | validator.js `isIdentityCard('zh-HK')`                                                                              | only without the bracketed check digit     |
| Malaysian NRIC (MyKad)              | `MALAYSIA_NRIC`             | a real date and a JPN place-of-birth code (`YYMMDD-PB-###G`)                                                        | only without dashes                        |
| Passport numbers (GB, US, MY)       | `PASSPORT`                  | validator.js `isPassportNumber`                                                                                     | yes: passport                              |
| Dates of birth                      | `DOB`                       | a real calendar date from 1900 to five years ago                                                                    | yes: DOB, born, date of birth, birthday    |
| Bitcoin and Ethereum addresses      | `CRYPTO`                    | validator.js `isBtcAddress`, `isEthereumAddress`                                                                    | Ethereum in tool output only: wallet, …    |

- **A context word** must be within 40 characters before the number or 20 after it on the same
  line (a label, or a key such as `"ssn":` or `QATAR_ID=`), or, in a CSV or TSV table, in the
  header of the number's column. A 9- to 13-digit number on its own is more often an order number,
  a timestamp or a constant.
- **Phone numbers** with a country code (`+974 5512 3456`) are found everywhere. A number without
  one (`020 7946 0958`) is found only in what you type, only when written with spaces, hyphens or
  parentheses, and only with a region: `ZEROH_PHONE_REGION` (for example `GB`, or `none`), else the
  territory of your locale (`LC_ALL`, `LC_TELEPHONE` or `LANG`, such as `en_GB.UTF-8`). In code and
  command output, digit groups are more often ids, hashes and constants.
- **IP addresses** that never identify a person or a network are left out (IANA's special-purpose
  ranges, RFC 6890): loopback (`127.0.0.0/8`, `::1`), unspecified (`0.0.0.0/8`, `::`), broadcast
  and netmasks, link-local (`169.254.0.0/16`, the cloud metadata address; `fe80::/10`), multicast
  and reserved (`224.0.0.0/3`, `ff00::/8`) and the documentation ranges (`192.0.2.0/24`,
  `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`). So are versions and section numbers
  (`v1.2.3.4`, `pkg@1.2.3.4`, `version 1.2.3.4`, `section 13.2.5.8`, `1.2.3.4.5`) and array slices
  such as `a[1::2]`. Private addresses (`10.0.0.0/8`, `192.168.0.0/16`, …) are masked.
- **Saudi, Qatar and other Gulf IDs** may be written in Arabic-Indic digits (`١٠٠٠٠٠٠٠٠٨`); they
  are normalised before the check, and the Arabic context words (هوية، الهوية، إقامة) count.
- **Ethereum addresses** are `0x` and 40 hex digits, the same shape as contract addresses and
  hashes in code: in what you type they are always masked, in tool output only next to a word such
  as wallet, send to, recipient or ETH address. A Bitcoin candidate must mix letters and digits
  and not be plain hex.
- **Not detected:** passport numbers of other countries (no check digit, and the formats overlap
  with ordinary codes), company numbers such as the Brazilian CNPJ or the US EIN (not personal
  data), and ID formats with no published check digit or context word to rely on.
- The Gulf IDs, Malaysian NRIC, passport, date-of-birth and crypto rules, and the Arabic-Indic
  digits, are shared with Blade Labs' chat product (ai-ui-chat); ZeroH keeps its stricter SSN,
  NINO and Qatar ID checks.
- The ID kinds use the same names as ZeroH Enterprise's recognizers (`QATAR_ID`, `SAUDI_NID`,
  `IQAMA`, `EMIRATES_ID`, `US_SSN`, `US_ITIN`, `IP_ADDRESS`), and otherwise the entity names of
  Microsoft Presidio's recognizers.

Measured on 6,000 open-source files (installed npm packages and the Python standard library), tool
output: email addresses in author and contact lines (154 in 109 files) and IP addresses (58 in 7
files, 47 of them in Python's own `ipaddress` module documentation); no card, IBAN, ID or phone
number. The ID rules find nothing there; without their context words, the bare-digit shapes would
match 32 times in 6 files for US SSNs, 4 times in 2 files for Israeli IDs, 2 for ITINs and 1 for
Dutch BSNs (hash constants such as `139408157`), which is why they need one. The same holds for
the newer kinds: NRIC, passport, date of birth, Saudi and Qatar IDs and crypto addresses find
nothing in tool output, typed prompts or the normal-work sample, while without their context
word dates of birth would match 149 times (numeric forms in 28 files, month names in 23: versions
such as `4.1.10`, release dates)
and passports 47 times in 15 files.

## Privacy: guarantees and limits

What ZeroH guarantees:

- The model receives tokens instead of the values ZeroH recognises. This covers what you type
  (through the proxy), `CLAUDE.md` and memory, file reads, command output and MCP results.
- A real value is put back only on your machine and only into a tool call, and a secret only for
  hosts allowed for it. Only you can allow a new host, from your own terminal. The model is blocked
  from changing ZeroH's files directly: the vault and its keys, the allow list, unmask caps and
  grants, a project's `.zeroh.env`, and the Claude Code settings that route
  through the proxy or turn the plugin off (see the limits below).
- Real values are never put into a subagent prompt or the `prompt` of WebFetch, since those go to
  a model.
- An MCP tool gets a real value only when you allowed that MCP server for it, for example
  `/zeroh-disclosure:allow STRIPE_KEY mcp:stripe`. A host or a `localhost` URL that the tool input
  mentions never counts, because an MCP server can send its input anywhere. Without the rule the
  token passes through unchanged and the model is told the value stays masked for that tool.
- Keys are never unmasked. Personal data can be unmasked for 15 minutes, 1 hour or until the
  session ends, only when you accept Claude Code's own dialog; tell Claude to stop showing real
  values and it ends the unmask at once.
- When ZeroH cannot open its vault, or a hook fails while it loads or runs, the output is
  withheld, the tool call is denied or the prompt is stopped, rather than raw content passing
  through. One case is outside that: a command that times out, is interrupted or replaces the
  shell with `exec` has its output reported through Claude Code's failure path, which hooks
  cannot mask. With the proxy on, the proxy still masks it before it reaches the model.
- Nothing is sent to Blade Labs: there is no account, no telemetry and no upload path.

The limits, stated plainly:

- **Your machine holds real values**: your files, the encrypted vault and the commands that run.
  The vault key sits beside the vault in your home directory, so it protects against accidental
  commits and casual reads, not against other programs running as you.
- **Claude Code's local transcripts hold real values too.** They record tool output before ZeroH
  masks it, and the input of Edit, Write, MultiEdit, NotebookEdit and MCP calls, which need the real
  value to work. That data stays on your machine.
- **A command can still send a value somewhere unexpected** if a script computes the destination
  while it runs. The settings guard blocks direct attempts to change ZeroH; it is not a sandbox.
- **Without the proxy** (`ZEROH_PROXY=off`, a shell that sets `ANTHROPIC_BASE_URL`, or Bedrock,
  Vertex and Foundry, whose traffic does not pass through it), a prompt in which you type a secret or personal data is
  stopped instead of masked, and background commands and the `Monitor` tool are denied because their output would
  reach the model unmasked.
- **Failing tools without the proxy.** Claude Code passes the output of a failed tool call to the
  model through a path hooks cannot rewrite. ZeroH makes foreground Bash and PowerShell commands
  finish with status 0 so their output is masked, but a command that uses `exec`, a shell that is
  killed, and errors from MCP tools and WebFetch can still reach the model unmasked when the proxy
  is off.
- **Machines that refuse login items** (a managed Mac, background items switched off, a
  locked-down Windows, and Linux without a systemd user session or a desktop, such as SSH, WSL or
  a container): the proxy is not set up, because nothing would keep it running after a
  reboot, so typed secrets are stopped rather than masked, and ZeroH says so once. Files and
  command output are still masked.
- **The prompt that puts a session behind the proxy.** In the first session after an install (or
  a reset) the first prompt switches the session to the proxy; a secret in that prompt is stopped
  rather than sent. A session that starts behind the proxy (its environment already names this
  install's proxy) is masked from its first prompt, `claude -p` included.
- **Shared multi-user machines.** The proxy listens on a `127.0.0.1` port. If another local user
  takes that port while the ZeroH proxy is down, that program could receive your requests,
  including credentials and prompts, until the next Claude Code session start detects it and
  moves the proxy to another port. Use ZeroH on a single-user machine, or turn the proxy off
  (`/zeroh-disclosure:proxy off`) on a shared one.
- **Output over 1 MB and prompts over 256 KB** are withheld or stopped rather than scanned.
- Values the model has already seen cannot be recalled. If you find a value that was not masked,
  report it with `/zeroh-disclosure:report-miss` and rotate it.

## The local proxy

Hooks can mask tool output but cannot rewrite what you type, so ZeroH runs a small local proxy that
masks every request on its way to the model. It is on by default, runs as you (no administrator
rights, nothing system-wide) and writes only under ZeroH's folder (`~/.zeroh` on macOS and Linux,
`%LOCALAPPDATA%\ZeroH` on Windows) and your Claude Code settings.

In the first session, ZeroH:

- copies the proxy into ZeroH's folder (`bin/zeroh-disclosure-proxy`) and starts it on
  `127.0.0.1` when the session starts;
- registers a per-user login item named `zeroh-disclosure-proxy` (a user systemd unit on Linux, or
  an XDG autostart entry in a desktop session; a LaunchAgent on macOS; a per-user scheduled task on
  Windows) so it is running after a reboot. It starts the `node` on your `PATH` (for example
  `/opt/homebrew/bin/node`), so a Node.js upgrade does not break it. Each session start checks that
  the login item is still loaded and its Node.js still exists, and registers it again if not. If your machine does not allow login items (a managed Mac, background
  items switched off, a locked-down Windows), ZeroH says so and leaves your Claude Code settings
  alone: nothing would keep the proxy running after a reboot, and every Claude Code session would
  then meet a dead port. What you type is then stopped when it holds a secret, not masked;
- on your first prompt, sets one Claude Code setting, `env.ANTHROPIC_BASE_URL`, in
  `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) to
  `http://127.0.0.1:<port>/z/<key>`, and keeps a small restore record next to that file with your
  previous `ANTHROPIC_BASE_URL`. It never keeps a copy of the settings file or its other values.
  Claude Code applies a changed settings file to the running session, so that prompt waits about
  two seconds once and then goes through the proxy: no restart is needed. ZeroH treats typed text
  as masked when the session's own environment names this install's proxy and the proxy answers,
  or once the proxy has seen a request of the session; a secret in the prompt that switches the
  session is stopped. The few requests Claude
  Code sends while it starts, before your first prompt, carry no prompt text and go directly.

If your shell (or a settings file that takes precedence, such as a project's
`.claude/settings.json`) sets `ANTHROPIC_BASE_URL`, Claude Code ignores ZeroH's entry, so what you
type cannot be masked in that setup: the session start says so, and a prompt with a secret is
stopped instead. Files and command output are still masked.

The proxy forwards to the `ANTHROPIC_BASE_URL` you had before, or to `api.anthropic.com`, and to no
other host. Each settings file gets its own access key in that URL; a request with a key the
proxy does not know (an entry left by a deleted ZeroH folder or an earlier build) is not refused
but forwarded to the one upstream all your settings files agree on (else to `api.anthropic.com`),
noted in a local report, and the next session start repairs the entry. The proxy never stores
request or response bodies and leaves responses unchanged.

**Corporate networks.** When your environment sets `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`,
`NODE_EXTRA_CA_CERTS` or `SSL_CERT_FILE`, the session start records them in ZeroH's private
`proxy/proxy.json` (readable only by you), and the proxy uses them for its own connection, also
after a reboot when the login item starts it without your shell's variables. A session with
different values restarts the proxy with them; a session with none (an app started from the Dock)
keeps the recorded ones. When the recorded network proxy cannot be reached (you left the office
or the VPN), the proxy drops it and connects directly, so Claude Code's retry goes through; the
next session that names a network proxy records it again. `doctor --fix` forgets them.

It masks the sessions ZeroH Disclosure runs in. The settings entry applies to every Claude Code
session. While a ZeroH Disclosure session is running, any request the proxy cannot tie to a
session of its own is masked too, never sent as it is. When no ZeroH Disclosure session is
running, a session where the plugin is not running passes through unmasked, as if the proxy were
not there, and is never refused: a project where you disabled ZeroH Disclosure, Claude Code
started without the plugin, or a plugin you removed without turning the proxy off. After the
plugin has been gone for 24 hours the proxy restores your setting and removes itself.
`ZEROH_PROXY=off` skips it for one session. (Claude Code 2.1.283 sends the session id with every
request that carries conversation text, including subagents, `--resume`, `--continue` and
`--fork-session`.)

The proxy never leaves a dead address behind for a new session: when it stops for a shutdown or
logout, or because ZeroH's folder was deleted, it first takes its entry out of your Claude Code
settings (your own setting goes back); the next session or prompt with ZeroH Disclosure puts it
back at the same address. The one exception is a settings file a running ZeroH Disclosure session
is using: its entry stays, because taking it out would send the rest of that session's turn, with
its whole history, straight to the model API. That session's next prompt starts the proxy again. A
plugin update restarts the proxy with the new code at the next session start; answers in progress
finish first.

To turn it off and restore your settings:

```text
/zeroh-disclosure:proxy off    # restores your settings and stops the proxy
/zeroh-disclosure:proxy on     # turn it back on
```

`ZEROH_PROXY=off claude` skips it for one session without changing settings.

`proxy off` stays off, also in new sessions, until `proxy on` or `doctor --fix`.

### If ZeroH's proxy stops working

ZeroH never blocks Claude Code and never sends what you type unmasked:

- When the network fails on the way to the model API (Wi-Fi or VPN changes, DNS), the proxy
  answers 502 at once and Claude Code retries a few times, as it would without ZeroH. Anything
  retrying cannot fix (an untrusted certificate, a network proxy that refuses, an upstream that
  points back at the proxy, a vault that cannot be opened) gets a plain message naming the fix
  and a status Claude Code does not retry.
- When the proxy is not running, the next prompt tries to restart it for at most three seconds.
  If this session still cannot reach it, ZeroH stops the prompt and tells you once: restart
  Claude Code. The next session reaches the proxy again, on a new port if another program took
  the old one, or connects directly when the proxy cannot run at all. Until you restart, typed
  secrets are stopped, not sent; files and command output are still masked by the hooks.
- Every fallback writes a local diagnostic report to `reports/proxy-<time>.json` in ZeroH's folder
  (mode 0600). It holds no values, keys, prompts, file contents, project paths or user names, and
  nothing is sent anywhere. Sending it with one click is planned for 1.1, together with sending
  report-a-miss reports.

The one recovery for anything else is a reset:

```text
/zeroh-disclosure:doctor           # what the proxy's state is and what looks wrong
/zeroh-disclosure:doctor --fix     # reset: takes ZeroH's entry out of your Claude Code settings,
                                   # stops every ZeroH proxy it finds; the next session sets it up.
                                   # A vault that cannot be read is reset and a new one starts.
/zeroh-disclosure:doctor --report  # a paste-safe summary for a GitHub issue or hello@bladelabs.io
```

`doctor` works from any folder: it checks the vault key and every project's vault, names each
project, and says exactly what it changed. A vault it resets still decrypts with the old key, so
its old file is deleted; `doctor --fix --keep-backups` keeps a copy readable only by you instead.
A vault that could not be read at all (a permission, another program holding it) or that a newer
ZeroH Disclosure wrote is left alone.

If Claude Code can't start, run the same from a terminal; every message that points to a fix also
prints this exact command with the path filled in (see [Terminal fallback](#terminal-fallback)):
`node "<plugin>/bin/zeroh-disclosure.mjs" doctor --fix`. This is also the upgrade path from a build
before 1.0: those builds wrote
`http://127.0.0.1:<port>` (without `/z/<key>`) into your settings, and `doctor --fix` removes it.
If no command is available, delete the `"ANTHROPIC_BASE_URL": "http://127.0.0.1:…"` line under
`env` in `~/.claude/settings.json`, delete `~/.claude/.settings.json.zeroh-restore.json` and
the `proxy` folder in ZeroH's folder (`~/.zeroh/proxy`, or `%LOCALAPPDATA%\ZeroH\proxy` on
Windows), and start Claude Code again.

## Commands

Everything is a slash command inside Claude Code:

| Command                                                     | What it does                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/zeroh-disclosure:status`                                  | What is protected now, the proxy, unmask grants, receipts and warnings        |
| `/zeroh-disclosure:mask-show`                               | What the model saw this session: tokens, types, sources and counts, no values |
| `/zeroh-disclosure:mask-receipt`                            | This session's receipt slip and the path to `receipt.html`                    |
| `/zeroh-disclosure:report [7d\|30d\|90d\|all]`              | The receipt slip for a period                                                 |
| `/zeroh-disclosure:unmask [KIND <why>\|revoke [id\|all]]`   | Ask to unmask one kind of personal data, or list and end grants               |
| `/zeroh-disclosure:report-miss`                             | Report a value ZeroH did not mask, in a private dialog rather than in chat    |
| `/zeroh-disclosure:allow [NAME HOST]` (`--remove`)          | Let a secret reach a host or MCP server; alone, show where each value may go  |
| `/zeroh-disclosure:proxy [off\|on]`                         | Proxy status, or turn the proxy off or back on                                |
| `/zeroh-disclosure:doctor [--fix\|--report]`                | Check and repair the proxy, its settings entry and the vaults                 |
| `/zeroh-disclosure:settings [banner\|receipts keep\|vault]` | Banner mode, how long receipts are kept, vault status or `vault clear --yes`  |
| `/zeroh-disclosure:mask-config`                             | Configuration, policy and protection engine                                   |
| `/zeroh-disclosure:uninstall [--yes]`                       | What uninstall removes; with `--yes`, remove ZeroH and the plugin completely  |

Ask Claude anything about ZeroH ("what does ZeroH Disclosure protect?"): the plugin's `about`
skill answers from the installed rule set.

Commands act on the project Claude Code opened. When a destination is blocked, the message gives
you the exact `/zeroh-disclosure:allow NAME HOST` line to run.

`allow`, `proxy`, `doctor`, `settings` and `uninstall` change what ZeroH protects, so only you can
run them: Claude can't invoke them itself (they are marked `disable-model-invocation`, and ZeroH
denies any attempt through Claude's Skill tool). The read-only commands, `unmask` (but not
`unmask caps`) and `report-miss` stay available to Claude; `unmask` and `report-miss` still need your answer in a
dialog.

### Terminal fallback

The same actions exist as a command-line tool inside the plugin, for when Claude Code can't start
or for scripts. It is not put on your `PATH`: run it with Node.js and the plugin's path, which
every message that points to a fix prints in full (the plugin lives under
`~/.claude/plugins/cache/zeroh/zeroh-disclosure/<version>/`):

```bash
node "<plugin>/bin/zeroh-disclosure.mjs" doctor --fix
node "<plugin>/bin/zeroh-disclosure.mjs" allow STRIPE_KEY payments.example.com
node "<plugin>/bin/zeroh-disclosure.mjs" unmask caps EMAIL 15m   # cap how long a kind may be unmasked
node "<plugin>/bin/zeroh-disclosure.mjs" report --since 30d --html report.html
node "<plugin>/bin/zeroh-disclosure.mjs" verify --receipt ~/.zeroh/projects/<project>/sessions/<session>/turn-1.json
node "<plugin>/bin/zeroh-disclosure.mjs" tokens                  # what the model saw, with value previews
node "<plugin>/bin/zeroh-disclosure.mjs" catalog                 # every format ZeroH detects
node "<plugin>/bin/zeroh-disclosure.mjs" uninstall               # remove everything ZeroH keeps (asks first)
```

`node "<plugin>/bin/zeroh-disclosure.mjs"` without arguments lists every command. They act on the
project Claude Code opened (`CLAUDE_PROJECT_DIR`), else the project the current directory belongs
to; `--cwd <project>` chooses it explicitly. The proxy keeps its own copy at
`~/.zeroh/bin/zeroh-disclosure-proxy/bin/zeroh-disclosure.mjs`, which works even after the plugin
is removed.

## Settings

Set these as environment variables before starting Claude Code, or in `~/.zeroh/config.env`
(`KEY=value` lines). Real environment variables win.

| Variable                    | Default     | What it does                                                                                   |
| --------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `ZEROH_PROXY`               | on          | `off` skips the local proxy for that session; typed secrets are then stopped                   |
| `ZEROH_MASK_PII`            | `on`        | `off` masks only secrets, not personal data, in tool output                                    |
| `ZEROH_PHONE_REGION`        | your locale | Region for phone numbers typed without a country code (`GB`, `QA`, …); `none` turns them off   |
| `ZEROH_DISPLAY_REAL_VALUES` | `1`         | `0` keeps tokens on your screen too                                                            |
| `ZEROH_VAULT_RETENTION`     | `7d`        | `session`, `7d` or `30d`: how long unused detected values stay in the vault                    |
| `ZEROH_RECEIPT_RETENTION`   | `90d`       | `forever`, `1y`, `90d` or `30d`: how long receipts are kept (a repository may only shorten it) |
| `ZEROH_BANNER`              | saved mode  | `full`, `compact` or `off`; overrides `/zeroh-disclosure:settings banner`                      |
| `ZEROH_HOME`                | see note    | Where the vault, keys, grants and proxy live (environment only)                                |
| `ZEROH_PROXY_PORT`          | a free port | Port for the local proxy                                                                       |
| `ZEROH_CLAUDE_SETTINGS`     | see above   | The Claude Code settings file that the proxy setting is written to                             |

`ZEROH_HOME` defaults to `~/.zeroh` on macOS and Linux and to `%LOCALAPPDATA%\ZeroH` on Windows,
which is not copied with a roaming profile; ZeroH limits that folder to your account and
SYSTEM. Nothing is written into your projects: receipts live under
`ZEROH_HOME/projects/<project>/sessions/`, and the keys behind their value commitments in a
separate folder, so receipts alone do not reveal short values such as phone numbers.

Receipts are kept for 90 days by default (`ZEROH_RECEIPT_RETENTION=forever|1y|90d|30d`, or
`/zeroh-disclosure:settings receipts keep <period>`); they contain no values. Older sessions are removed at
the next Claude Code start, at most once a day; the current session and the vault are never
touched. Premium keeps them in Blade Labs' tamper-evident store (immudb) across your devices.

Test-only: `ZEROH_CREDENTIAL_HOME` and `ZEROH_SERVICE_MANAGER_DIR` redirect credential discovery
and login items for tests.

The protections themselves are fixed, so no setting can weaken them:

- A raw secret the model writes into a Bash, PowerShell or Monitor command or an MCP call is
  denied; in a Write, an Edit, a WebFetch or a subagent prompt it is replaced by a token.
- Private keys, keystores and credential stores are never read into the conversation.

**A repository cannot weaken ZeroH.** A cloned project's `.zeroh.env` may set only
`ZEROH_BANNER`, `ZEROH_DISPLAY_REAL_VALUES` and `ZEROH_VAULT_RETENTION`, or `ZEROH_MASK_PII=on`.
Anything else in it, such as `ZEROH_HOME` or `ZEROH_PROXY`, is ignored, and the session start shows
a warning naming the keys. The model cannot write `.zeroh.env`.

## Receipts

A receipt is a till slip for what the model never saw:

```text
RECEIPT · SEP 18–25
ZeroH Disclosure · Receipt
Sep 18–25 · 5 sessions · 23 turns
- - - - - - - - - - - - - - - - - - - - - -
API_KEY                                   ×7
PRIVATE_KEY                               ×2
EMAIL                                   ×414
PHONE_NUMBER                            ×414
IBAN                                     ×10
────────────────────────────────────────────
withheld                                 847
values sent to Claude                      0
- - - - - - - - - - - - - - - - - - - - - -
receipt zrh_mfqq0z_5Kd2
signed on this laptop · ECDSA P-256
✓ verified 23 of 23
/zeroh-disclosure:mask-show
```

- `withheld` counts every value replaced by a token before it reached the model.
- `values sent to Claude` counts only values you revealed under an unmask grant you approved.
- Images and scanned PDFs are listed as `passed unchecked`, never counted as withheld.

Each turn's receipt is signed with a local ECDSA P-256 key kept in the session folder, chained to
the previous one, and checked by the terminal command `verify` (see [Terminal fallback](#terminal-fallback)). The session's `receipt.html` shows the
same slip, a map of what the model saw and each turn in detail, with safe previews rather than
values. Receipts stay on your machine; [Receipt format](docs/receipt-format.md) describes them.

## Platforms

| Platform | Notes                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Node.js 20 or later. Bash by default; Claude Code's PowerShell tool needs PowerShell 7 (`pwsh`). `pbcopy` enables the clipboard copy.          |
| Linux    | Node.js 20 or later. Bash by default; the PowerShell tool needs `pwsh`. `xclip`, `xsel` or `wl-copy` enables the clipboard copy.               |
| Windows  | Node.js 20 or later. Commands run through Git Bash or Claude Code's PowerShell tool; the slash commands need one of them as the default shell. |

Set `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` to use Claude Code's PowerShell tool. On Windows the proxy's
login task starts it through `conhost.exe --headless`, so no console window opens at logon
(Windows 10 version 1809 or later). `pdftotext` on your
`PATH` improves PDF text extraction but is optional; there is a built-in extractor.

## Free and Premium

This plugin is the free tier and is complete on its own. Premium is not available yet; there is a
waitlist.

| Free (this plugin)                                                                                                                                              | Premium (planned)                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Pattern and exact-value detection, masking of prompts and tool output, local restore, signed local receipts and reports, notices when a format passes unmasked. | Context-aware detection of names and amounts, image and scanned-PDF redaction, custom detectors, and ProofPack reports for auditors. |

## Uninstall

One command inside Claude Code:

```text
/zeroh-disclosure:uninstall          # shows what it removes; nothing is removed yet
/zeroh-disclosure:uninstall --yes    # removes it
```

It removes, in this order: the plugin from Claude Code (through `claude plugin uninstall`, so no
new session sets ZeroH up again), ZeroH's entry in every Claude Code settings file it wrote to
(your own setting goes back), the proxy and its login item, ZeroH's own folder with the vault,
keys and receipts, and a `<project>/.zeroh` folder an earlier test build left in a project ZeroH
knows about. It then says what it removed. The session you ran it in keeps running until you exit
it; ZeroH no longer acts in it and sets nothing up again, but nothing protects it any more, so exit
it. New sessions start without ZeroH. If the `claude` command isn't available, it prints the exact
`claude plugin uninstall` command to run.

If Claude Code can't start, run the same from a terminal (it asks first):
`node "<plugin>/bin/zeroh-disclosure.mjs" uninstall`. It never deletes a `ZEROH_HOME` that is your
home, a system folder or holds none of ZeroH's files.

## Documentation

- [How to use ZeroH Disclosure](docs/how-to.md): destinations, unmask, reporting a miss, receipts,
  vault retention, PowerShell and uninstalling.
- [Troubleshooting](docs/troubleshooting.md): symptoms, causes and fixes.
- [Architecture](docs/architecture.md): hooks, the proxy, late binding and the settings guard.
- [Receipt format](docs/receipt-format.md): what a receipt claims and how it is verified.
- [Development](docs/development.md): running the tests and updating the provider rules.
- [Changelog](CHANGELOG.md)

## Contributing, security and licence

Contributions are welcome; see `CONTRIBUTING.md` at the root of the
[repository](https://github.com/Blade-Labs/zeroh-marketplace). Use fake values only (`ZEROHFAKE`
in the value, `example.com` hosts) in issues, tests and pull requests. The unit tests run with
`npm test` in this folder and need nothing beyond Node.js.

To report a vulnerability, use GitHub's private vulnerability reporting on the repository
(**Security → Report a vulnerability**), or email hello@bladelabs.io. Please do not open a public
issue, and never include a real secret.

ZeroH Disclosure is licensed under the GNU Affero General Public License, version 3 only
(`AGPL-3.0-only`); see [LICENSE](LICENSE). Copyright © 2026 Blade Labs Holdings Private Limited.
There is no agreement to sign: by opening a pull request you accept the contribution terms in
CONTRIBUTING.md, which let Blade Labs also offer the code under other terms.

Provider rules are generated from [gitleaks](https://github.com/gitleaks/gitleaks) v8.30.1 (MIT)
and the top-level domain list from IANA; see [NOTICE](NOTICE).
