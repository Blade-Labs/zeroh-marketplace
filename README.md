# ZeroH marketplace for Claude Code

Open-source Claude Code plugins from [Blade Labs](https://bladelabs.io). Add the marketplace once,
then install the plugins you want:

```bash
claude plugin marketplace add Blade-Labs/zeroh-marketplace
claude plugin install zeroh-disclosure@zeroh
```

Restart Claude Code after installing so the plugin's hooks load. To try ZeroH Disclosure, follow
the [step-by-step test guide](https://witty-river-07cbf8503.1.azurestaticapps.net/try/) on the
website, or start with the plugin's [README](plugins/zeroh-disclosure#readme).

## Plugins

| Plugin                                              | Version | Status      | What it does                                                                                                                                                                             |
| --------------------------------------------------- | ------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ZeroH Disclosure](plugins/zeroh-disclosure#readme) | 1.0.0-rc.1 | Release candidate | Keeps API keys, passwords and personal data away from the model: masks them as tokens, puts real values back only on your machine for allowed hosts, and signs a local receipt per turn. |

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
