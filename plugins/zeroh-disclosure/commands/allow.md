---
description: Let a secret reach a host or MCP server (NAME HOST), show where each known value may go (no arguments), or remove a rule (--remove NAME HOST)
argument-hint: '[<NAME|TYPE> <host|mcp:server> | --remove <NAME|TYPE> <host|mcp:server>]'
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" allow), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" allow), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" allow *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" allow *)
disable-model-invocation: true
---

The command output is already loaded below: the rule it added or removed, or the list. Present it verbatim in a fenced text block. Do not use tools or add commentary.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" allow $ARGUMENTS`
