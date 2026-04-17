---
name: plugin-release
description: Validate and prepare the Claude Code plugin suite for use in the repo or via a marketplace.
argument-hint: "[plugin name or all]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash
---
Prepare the specified plugin(s) for release.

Check:
- plugin.json validity
- frontmatter validity
- script executability
- hook paths
- version bump
- install and validate commands
