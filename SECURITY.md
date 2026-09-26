# Security policy

ZeroH Disclosure is a security tool, so we treat any way it lets a real value reach the model, or
lets a value go somewhere it should not, as a vulnerability.

## Report a vulnerability privately

- **Preferred:** GitHub private vulnerability reporting. On this repository, open **Security →
  Report a vulnerability**. Only the maintainers see the report.
- **Or email** hello@bladelabs.io with "Security" in the subject.

Please do not open a public issue, pull request or discussion for a vulnerability.

## What to include

- The plugin version (`/zeroh-disclosure:status` shows it), the Claude Code version
  (`claude --version`) and your operating system and shell.
- The smallest steps that reproduce it, and what reached the model or the network that should not
  have.
- **Fake values only.** Never send a real key, password or personal data, not even a revoked one.
  Use values with `ZEROHFAKE` in them (for example `sk_live_ZEROHFAKE_1234567890abcdef`),
  `example.com` hosts and addresses such as `alice@example.com`. If a real value was exposed, rotate
  it first; we do not need it to investigate.

## Scope

In scope:

- a recognised value reaching the model unmasked through the hooks or the local proxy;
- a real value restored into a tool call for a host it is not allowed to reach;
- the model changing ZeroH's settings, allow list, unmask grants or plugin files, or answering a
  dialog that only the user should answer;
- the local proxy forwarding to a host other than the configured upstream, or being usable by
  another local user;
- receipts that verify although they were altered, or that contain real values;
- anything that makes ZeroH pass content through when it should fail closed.

Out of scope, because the documentation states them as limits: images and scanned PDFs, names and
currency amounts, values with no known shape, destinations a script computes at run time, values a
command transforms before printing, and real values in Claude Code's own local transcripts. A new
way around one of these limits is still welcome as a report.

## What happens next

We aim to acknowledge a report within three working days and to agree a fix and disclosure date
with you. We credit reporters in the release notes unless you prefer not to be named.

## Supported versions

Security fixes go into the latest release only, so keep the plugin up to date.
