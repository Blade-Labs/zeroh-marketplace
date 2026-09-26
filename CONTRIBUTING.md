# Contributing

Thank you for helping. Bug reports, missed detections, documentation fixes and pull requests are all
welcome.

## Before you start

- **Fake values only.** Never put a real key, password or personal data in an issue, test, fixture,
  screenshot or pull request, not even a revoked one. Use values with `ZEROHFAKE` in them (for
  example `sk_live_ZEROHFAKE_1234567890abcdef`), `example.com` or `.invalid` hosts, and addresses
  such as `alice@example.com`.
- **Security problems go through private reporting**, not issues; see [SECURITY.md](SECURITY.md).
- **A value ZeroH did not mask?** Run `/zeroh-disclosure:report-miss` in Claude Code first: it masks
  the value from then on and saves a shape-only report (type, prefix, length, character classes)
  that you can paste into a missed-detection issue. Never paste the value itself.
- For a larger change, open an issue first so we can agree on the approach.

## Contribution terms

ZeroH Disclosure is licensed under `AGPL-3.0-only`, © Blade Labs Holdings Private Limited. There is
no separate agreement to sign. By opening a pull request you agree that your contribution is your
own work, that it is published under `AGPL-3.0-only`, and that you grant Blade Labs Holdings Private
Limited a perpetual, worldwide, irrevocable, royalty-free licence to use, modify and relicense it,
including under other terms. The pull request template asks you to confirm this.

## Develop and test

Each plugin lives in `plugins/<name>`. For ZeroH Disclosure you need Node.js 20 or later and nothing
else:

```bash
cd plugins/zeroh-disclosure
npm test
```

The tests use only Node.js built-ins, need no network access and no Claude login, and put every
home and settings path in a temporary directory. They refuse to run against your real home
directory. [docs/development.md](plugins/zeroh-disclosure/docs/development.md) covers the test
setup, regenerating the provider rules and a map of the source.

To try a change in Claude Code, load the plugin from a folder:

```bash
claude --plugin-dir /path/to/zeroh-disclosure
```

The plugin protects its own files: while it is loaded, the model cannot edit the directory it runs
from. So do not ask Claude to change the plugin in the folder that `--plugin-dir` loads. Load a
copy in a separate test project instead (`cp -R plugins/zeroh-disclosure /tmp/zeroh-try`), or work
on the source without the plugin loaded and rely on `npm test`. The first session installs the
local proxy, so when you are done run `/zeroh-disclosure:proxy off` in that session, or
`node /tmp/zeroh-try/bin/zeroh-disclosure.mjs proxy off` from a terminal.

## Pull requests

- Keep a pull request to one change, with tests for new behaviour.
- The hooks, the proxy and the CLI use Node.js built-ins only; do not add runtime dependencies.
- Update the plugin's `README.md` or `docs/` when you change what users see, and add a line to
  `CHANGELOG.md`.
- Use British spelling in user-facing text.

This repository is where releases are published. Accepted pull requests are applied to the source
the releases are built from and appear here in the next release, with your authorship kept in the
commit.

## Code of conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
