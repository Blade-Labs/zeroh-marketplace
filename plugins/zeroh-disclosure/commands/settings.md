---
description: Show ZeroH Disclosure settings, or change one - banner <big|compact|mini|off>, receipts keep <forever|1y|90d|30d>, uncertain <pass|block>, statusline <on|off|style>, vault status, vault clear --yes
argument-hint: '[banner <mode> | receipts keep <period> | uncertain <pass|block> | statusline <on|off|style> | vault status | vault clear --yes]'
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/settings.js"), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/settings.js"), Bash(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/settings.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/settings.js" *)
disable-model-invocation: true
---

The command output is already loaded below. Present it verbatim in a fenced text block. Do not use tools or add commentary.

!`node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/settings.js" $ARGUMENTS`
