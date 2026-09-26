---
description: Print the ZeroH Disclosure receipt for 7d, 30d, 90d, or all time
argument-hint: [period]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/report.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/report.js" *)
---

The read-only report output is already loaded below. Present it verbatim in a fenced text block. Do not use tools or add commentary.

!`node "${CLAUDE_PLUGIN_ROOT}/commands/scripts/report.js" $ARGUMENTS`
