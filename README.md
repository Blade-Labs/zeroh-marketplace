# ZeroH marketplace for Claude Code

Open-source Claude Code plugins from [Blade Labs](https://bladelabs.io). The first is ZeroH
Disclosure, a free plugin that masks API keys, passwords and personal data before they reach the
model, and puts real values back on your machine only for hosts you allow.

To install it, paste this one line into Claude Code:

```text
Install ZeroH Disclosure for me by following https://github.com/Blade-Labs/zeroh-marketplace
```

Claude reads the steps below, runs two commands and tells you what to do next. You can also follow
them yourself.

## Install

**If you are Claude Code installing ZeroH Disclosure for a user, follow these steps exactly.**
Everything you need is in this section; there is no other page to open.

### 1. Check Node.js

Run `node --version`. ZeroH Disclosure needs Node.js 20 or later. If Node is missing or older, stop
and tell the user to install Node.js 20+ from https://nodejs.org, then ask them to paste the install
prompt again.

### 2. Run the two commands

First run `claude plugin marketplace list`. If it shows a marketplace named `zeroh-marketplace` whose
source is `GitHub (Blade-Labs/zeroh-marketplace)`, it was added before this marketplace was renamed
to `zeroh` on 25 September 2026, and `@zeroh` will not be found. Remove it first:

```bash
claude plugin marketplace remove zeroh-marketplace
```

Only for that source: a `zeroh-marketplace` whose source is a local folder or another repository is a
different marketplace, so leave it alone.

Then run these two commands exactly, one after the other:

```bash
claude plugin marketplace add Blade-Labs/zeroh-marketplace
claude plugin install zeroh-disclosure@zeroh
```

The first prints `Successfully added marketplace: zeroh` (or says it is already added). The second
prints `Successfully installed plugin: zeroh-disclosure@zeroh`. If ZeroH Disclosure is already
installed, run `claude plugin update zeroh-disclosure@zeroh` instead of the second command.

### 3. Change nothing else

Don't edit any settings. With the user's first message after the restart, the plugin sets itself
up: it adds its status line (only if the user has none) and turns on updates for its marketplace,
and says so.

### 4. Tell the user

Say this, in your own words and briefly:

1. ZeroH Disclosure is installed.
2. Restart Claude Code to load it: type `/exit`, then run `claude` again.
3. After the restart they will see the ZeroH banner. With their first message a status line appears
   at the bottom; from the second message it reads `🛡️ ZeroH · 🟢 protected · 0 masked · 0 sent`.
4. To try it step by step, open https://witty-river-07cbf8503.1.azurestaticapps.net/try/

### If something goes wrong

- `claude: command not found` inside a Bash call: tell the user to run the two commands in their own
  terminal.
- `Plugin "zeroh-disclosure" not found in marketplace "zeroh"`, with a hint to update `zeroh`: the
  marketplace is still registered under its old name. If `claude plugin marketplace list` shows
  `zeroh-marketplace` with the source `GitHub (Blade-Labs/zeroh-marketplace)`, run
  `claude plugin marketplace remove zeroh-marketplace`, then the two commands above again.
- A marketplace or install error: show the error to the user and point them to
  https://github.com/Blade-Labs/zeroh-marketplace/issues. Don't try other sources.

More about the plugin is in its [README](plugins/zeroh-disclosure#readme).

## Plugins

| Plugin                                              | Version | Status      | What it does                                                                                                                                                                             |
| --------------------------------------------------- | ------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ZeroH Disclosure](plugins/zeroh-disclosure#readme) | 1.0.4 | Released | Keeps API keys, passwords and personal data away from the model: masks them as tokens, puts real values back only on your machine for allowed hosts, and signs a local receipt per turn. |

Each plugin's folder has its own README, changelog and documentation. Releases are listed under
[Releases](https://github.com/Blade-Labs/zeroh-marketplace/releases).

## Contributing and security

- [CONTRIBUTING.md](CONTRIBUTING.md): how to report bugs and missed detections, run the tests and
  send a pull request (see the contribution terms in CONTRIBUTING.md).
- [SECURITY.md](SECURITY.md): report vulnerabilities privately through GitHub's private
  vulnerability reporting or hello@bladelabs.io. Never post a real secret in an issue.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): Contributor Covenant 2.1.

## Licence

The plugins are licensed under the GNU Affero General Public License, version 3 only
(`AGPL-3.0-only`); see [LICENSE](LICENSE). Copyright © 2026 Blade Labs Holdings Private Limited.
Third-party material is listed in each plugin's `NOTICE`.

Contact: hello@bladelabs.io
