---
description: Ask to unmask a personal-data kind, or show and revoke unmask grants
argument-hint: '[KIND <why> | revoke [id|all]]'
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" unmask), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" unmask), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" unmask *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" unmask *), mcp__zeroh-disclosure__request_unmask, mcp__plugin_zeroh-disclosure_zeroh-disclosure__request_unmask
---

The local unmask command printed:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" unmask $ARGUMENTS`

If that output starts with `Unmask request:`, call the `request_unmask` tool now with exactly that
kind and reason; the user decides in Claude Code's dialog. Then repeat the tool result exactly.

Otherwise report the output exactly and call no tool. Do not edit ZeroH files.
