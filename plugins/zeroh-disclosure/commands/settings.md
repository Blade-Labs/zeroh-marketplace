---
description: Show ZeroH Disclosure settings, or change presentation, retention, protection, status line or vault settings
argument-hint: '[banner <mode> | statusline style [key value] | receipts keep <period> | uncertain <pass|block> | statusline <on|off> | vault status | vault clear --yes]'
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/settings.js"), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/settings.js"), Bash(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/settings.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/settings.js" *)
---

The command output is already loaded below. Present it verbatim in a fenced text block. Do not use tools or add commentary.

!`node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/settings.js" $ARGUMENTS`
