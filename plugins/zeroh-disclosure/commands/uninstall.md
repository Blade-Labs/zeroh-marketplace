---
description: Remove ZeroH Disclosure completely - the plugin, the proxy and its settings entry, the login item, the vault, keys and settings - keeping your signed receipts in their own folder; --dry-run only shows what it would do, --delete-receipts removes the receipts too
argument-hint: '[--dry-run] [--delete-receipts]'
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" uninstall), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" uninstall), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" uninstall *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" uninstall *)
disable-model-invocation: true
---

The command output is already loaded below: what uninstall removed and where it kept the receipts, or with --dry-run what it would do. Present it verbatim in a fenced text block. Do not use tools or add commentary.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" uninstall --yes $ARGUMENTS`
