---
description: Show the local masking proxy status, turn it off with `off`, or back on with `on`
argument-hint: '[off|on]'
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/proxy-status.js"), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/proxy-status.js"), Bash(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/proxy-status.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/proxy-status.js" *)
disable-model-invocation: true
---

The command output is already loaded below: the status, or what `off` or `on` did. Present it verbatim in a fenced text block. Do not use tools or add commentary.

!`node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/proxy-status.js" $ARGUMENTS`
