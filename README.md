# ZeroH marketplace

Public Claude Code plugins from [Blade Labs](https://bladelabs.io), built on the ZeroH platform.

| Plugin | What it does | Status |
| --- | --- | --- |
| **ZeroH Disclosure** | Keeps API keys, passwords and personal data on your machine. The model works with tokens such as `[API_KEY-7a3f9e]`; commands get the real value back locally, only for the hosts each key may reach. | Coming with 1.0 |

## Install

```bash
claude plugin marketplace add Blade-Labs/zeroh-marketplace
claude plugin install zeroh-disclosure@zeroh
```

## How this repository is updated

Plugins are built and tested in Blade Labs' private monorepo. Each release tag copies the released
plugin here, with its licence, so this repository only ever holds released versions.

## Licence

GNU Affero General Public License v3.0 (AGPL-3.0-only). See [LICENSE](LICENSE). You may use, study,
modify and share the plugins. If you distribute a modified version, or run one for others over a
network, you must publish your changes under the same licence and keep the copyright notices.

Copyright © 2026 Blade Labs Holdings Private Limited.

## Contributing

Issues are welcome. Before a pull request can be merged, contributors sign a short contributor
licence agreement, so Blade Labs can keep offering the plugins under other terms as well
(for example inside its hosted Premium and Enterprise services).
