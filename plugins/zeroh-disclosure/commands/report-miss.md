---
description: Privately report a value that ZeroH did not mask, or list and delete the local notes of reported values (list | delete <id>)
argument-hint: '[list | delete <id>]'
allowed-tools: mcp__zeroh-disclosure__report_missed_secret, mcp__plugin_zeroh-disclosure_zeroh-disclosure__report_missed_secret, Bash(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/report-miss.js"), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/report-miss.js"), Bash(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/report-miss.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/report-miss.js" *)
disable-model-invocation: true
---

The command output is already loaded below.

- If it starts with `Report a value:`, call the ZeroH `report_missed_secret` MCP tool with no arguments. The user types the value into ZeroH's private form; do not ask them to put the value in chat. When the tool returns, repeat its result exactly.
- Otherwise it is the list of local notes or the result of a delete: present it verbatim in a fenced text block. Do not use tools or add commentary.

!`node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/report-miss.js" $ARGUMENTS`
