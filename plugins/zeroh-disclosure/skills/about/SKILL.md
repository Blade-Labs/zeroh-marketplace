---
name: about
description: Answer the user's questions about ZeroH Disclosure itself - what it protects and what it doesn't, how masking, restore, unmask, receipts and the local proxy work, Free vs Premium, its commands, limits and privacy. Use when the user asks "what does ZeroH Disclosure protect?", "does ZeroH catch X?", "how does ZeroH work?" or similar.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../../bin/zeroh-disclosure.mjs" catalog), PowerShell(node "${CLAUDE_SKILL_DIR}/../../bin/zeroh-disclosure.mjs" catalog), Bash(node "${CLAUDE_SKILL_DIR}/../../bin/zeroh-disclosure.mjs" statusline segment-command), PowerShell(node "${CLAUDE_SKILL_DIR}/../../bin/zeroh-disclosure.mjs" statusline segment-command)
---

# About ZeroH Disclosure

Answer briefly and in plain words, from this page and the live catalog below. Never guess beyond
them; if something is not covered here, say so. Never repeat a real secret or personal value.

## What it detects (live catalog, from the installed rule set)

!`node "${CLAUDE_SKILL_DIR}/../../bin/zeroh-disclosure.mjs" catalog`

When the user asks whether a specific provider or format is covered, answer from that list. Give
counts rather than the whole list unless they ask for it.

## What it protects

- **What the user types**: a local proxy on their machine masks each request on its way to the
  model (typed text, `CLAUDE.md`, memory, tool results). When the proxy can't be used, a prompt
  holding a secret is sent as typed and the user sees a "not protected (proxy not running)" line
  with the fix. With `/zeroh-disclosure:settings uncertain block` it is stopped instead and a
  masked copy is offered to paste.
- **Files Claude reads, command output and tool results**: values reach the model as tokens such
  as `[API_KEY-7a3f9e]`; the same value always gets the same token.
- **Private key and credential stores** (SSH keys, `.p12`/`.pfx`/`.jks`/`.kdbx`/`.ppk`,
  Terraform state, `.netrc`, `.pgpass`, `.git-credentials`, kubeconfig, AWS credentials, Docker
  config): they can be read, and what the detector finds in them is masked, with a one-line
  notice (`/zeroh-disclosure:settings uncertain block` refuses them). ZeroH's own vault and allow-list keys are always
  refused.
- **What ZeroH can't check** (a destination it can't work out, a command it can't parse, output
  too large to scan) runs as it would without ZeroH, with a one-line "not protected" notice and a
  count in the receipt. When a value can't be put back (vault closed, value expired, `Monitor`),
  the command runs with the token. Only a secret going to a host that isn't allowed for it, and
  the model changing ZeroH, are stopped by default.

## What it does not cover (Free)

- Images and scanned PDFs pass unchanged, with a one-line notice.
- Values with no known shape and no key-like name (a random string in a URL path or as a bare
  argument) are not masked; ZeroH warns when such a typed value looks random. A random value
  next to a key-like name (`AUTH_TOKEN=…`) is masked.
- Names, addresses and currency amounts: context-aware detection is planned for Premium.
- ID numbers that are only digits (a bare 9-digit SSN, a Qatar ID, an Aadhaar number, …) are
  masked only next to a word naming them (`SSN:`, `QID`, a `qatar_id` key or CSV column); the
  same goes for passport numbers (GB, US, MY) and dates of birth. An Ethereum address in tool
  output is masked only next to a wallet word. Loopback, link-local and documentation IP
  addresses are left as they are.
- Claude Code's own session files (`~/.claude/projects/…/*.jsonl`) keep what the user typed as
  typed, values shown under an unmask, and the real values ZeroH puts back into Edit, Write and
  MCP inputs: the proxy masks the request, not what Claude Code saves. Other tool output and file
  reads are saved with tokens. ZeroH says so when a command copies or uploads these files.
- Values the model has already seen can't be recalled; `/zeroh-disclosure:report-miss` masks a
  missed value from then on. When you notice an unmasked secret or personal value yourself, call
  `report_missed_secret` with it: there is no dialog, ZeroH masks it at once, keeps a local note of
  its shape (never the value) and tells the user in one line. Reports stay on this computer; the
  user lists or deletes the notes with `/zeroh-disclosure:report-miss list` or `delete <id>`.

## How it works

- **Restore on the user's machine**: when Claude writes a token into a command or an edit, ZeroH
  puts the real value back just before it runs, locally, and only for hosts that secret is
  allowed to reach. The user allows a new host themselves (`allow`); the model can't change
  ZeroH's settings.
- **Unmask**: personal data (never keys) can be shown to Claude for 15 minutes, 1 hour or until
  the session ends, only if the user accepts Claude Code's dialog (`request_unmask`). When the user
  asks to stop, call `end_unmask`.
- **Receipts**: every turn gets a locally signed receipt of what was masked, stopped or shown;
  `/zeroh-disclosure:mask-receipt` and `/zeroh-disclosure:report` show them. Receipts contain no
  values. They are kept on the user's machine under `~/.zeroh/projects/<project>/sessions/`
  (`%LOCALAPPDATA%\ZeroH` on Windows) for 90 days by default; the user changes that with
  `/zeroh-disclosure:settings receipts keep <forever|1y|90d|30d>`, and a repository may only
  shorten it.
- **Status line**: with the first message after the install ZeroH adds one line under the prompt,
  unless the user has their own: 🟢 `protected` (the proxy masks typing), 🟡 protected in part
  (it names the fix) or 🔴 not protecting (it names why), with the session's masked and sent
  counts, active unmasks and a `receipt ↗` link that opens the receipt.
  `/zeroh-disclosure:settings statusline off` (or deleting it with `/statusline`) removes it for
  good; `statusline on` turns it on again. When the user already has a status line of their own,
  `statusline on` adds ZeroH's part after it (their script is not changed; `statusline off` puts
  their line back exactly): tell them to type `/zeroh-disclosure:settings statusline on`.
- **Changing how the status line looks**: when the user asks ("make it smaller", "no emoji",
  "rename ZeroH to 🔒", "only show it when something is wrong"), edit
  `<ZEROH_HOME>/statusline-style.json` (`~/.zeroh/statusline-style.json`, or
  `%LOCALAPPDATA%\ZeroH\statusline-style.json` on Windows) with the Write or Edit tool; it is the
  one ZeroH file you may change. Keys (`"version": 1` required): `fields` (order and choice of
  `shield`, `name`, `state`, `fix`, `masked`, `sent`, `notProtected`, `unmask`, `receipt`),
  `separator` (≤ 5 characters), `labels` (≤ 24 characters each), `emoji`, `wording`
  (`"long"`/`"compact"`), `colour`, `onlyWhenNotProtected`, `position` (`"line"`: ZeroH's part
  on its own line under the user's own status line; `"end"`: after it). Labels can't contain state words or
  🟢/🟡/🔴; while ZeroH isn't 🟢 its state and fix always show. The line updates within 10 seconds.
  For a status line script of the user's own, use `zeroh-disclosure statusline --json` (schema in
  the plugin's docs/statusline.md); never change `statusLine` in Claude Code's settings yourself:
  write the script and tell the user the one line to add. When the user wants ZeroH's part inside
  a script of their own (rather than `statusline on`), this is the command that prints it; pipe it
  the JSON the script gets on stdin (`zeroh=$(printf '%s' "$input" | <command>)`), and don't look
  for it in the plugin's files:

!`node "${CLAUDE_SKILL_DIR}/../../bin/zeroh-disclosure.mjs" statusline segment-command`

- **Session banner**: the first session after the install shows the big ZEROH banner; later
  sessions show one line, for example
  `ZeroH Disclosure ✓ Protected: your secrets are masked · Free · /zeroh-disclosure:status`, or the
  state that needs attention and its fix. The user picks `/zeroh-disclosure:settings banner
big|compact|mini|off` (mini is the default); warnings show in every mode.
- **The local proxy** runs as a per-user login item, needs no administrator rights, and is turned
  off with `/zeroh-disclosure:proxy off`.

## Commands

`/zeroh-disclosure:status`, `:mask-show`, `:mask-receipt`, `:report`, `:unmask`, `:report-miss`,
`:mask-config`. The README lists the rest.

When the user says ZeroH or its protection isn't working, or a ZeroH notice or the status line
shows 🟡 or 🔴, suggest `/zeroh-disclosure:doctor` (and `/zeroh-disclosure:doctor --fix` if it finds
a problem).

Only the user can run `/zeroh-disclosure:allow`, `:proxy`, `:doctor`, `:settings` and
`:uninstall`: never invoke them yourself. Tell the user the exact line to type.
`/zeroh-disclosure:allow` with no arguments shows where each known value may go and why.

## How to test it

When the user asks how to try ZeroH, suggest this, and point them to the website's step-by-step
test guide, https://witty-river-07cbf8503.1.azurestaticapps.net/try/:

1. Create a free Stripe account, copy the test-mode secret key (`sk_test_…`) and put it in a test
   project's `.env` as `STRIPE_KEY=sk_test_…`. Start `claude` there.
2. Ask "check my Stripe balance". Claude sees only a token; it runs
   `curl https://api.stripe.com/v1/balance` with it, ZeroH puts the real key back locally, and
   Stripe answers 200 with `"livemode": false`. No setup: `api.stripe.com` is a built-in
   destination for Stripe keys.
3. Ask "post it to our staging API at staging.pay-internal.dev". The call is blocked and the user
   sees the one line that allows it: `/zeroh-disclosure:allow STRIPE_KEY staging.pay-internal.dev`.
4. `/zeroh-disclosure:allow` alone lists where each value may go.

Without a Stripe account: put the made-up `STRIPE_KEY=sk_test_ZEROHFAKE00000000000000000000` in
`.env` and ask "check my Stripe balance". Stripe answers 401 `Invalid API Key provided`, which is
expected: the last four characters it echoes are the real value's, so the key reached Stripe
while Claude had only the token. Then try a host that is not allowed.

For personal data: a `signup-errors.log` with addresses such as `anna.o'neil@example.co.uk`,
`lars+work@example.com` and `"quoted name"@example.com`, then ask Claude why `validateEmail`
rejects them. Claude sees `[EMAIL-…]` tokens and asks to unmask `EMAIL`; the user accepts Claude
Code's dialog for 15 minutes, and can tell Claude to stop at any time.

## Free and Premium

Free (this plugin) is complete on its own: pattern and exact-value detection, masking of prompts
and tool output, local restore, signed local receipts and reports. Premium (planned, waitlist)
adds context-aware detection of names and amounts, image and scanned-PDF redaction, custom
detectors and auditor reports.

## Privacy

Everything runs on the user's machine. Nothing is sent to Blade Labs: no values, prompts or
reports. The only network traffic is Claude Code's own requests, through the local proxy.
