---
name: bundle-diff
description: Compare code or document changes against the production bundle and identify the exact bundle, shape, or policy deltas required.
argument-hint: "[change summary]"
context: fork
agent: Explore
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash
---
## Current architecture-related diffs
```!
git diff --name-only -- docs data .claude packages apps
```

## Task
Compare the current change set plus this request:

$ARGUMENTS

against the production bundle and answer:
1. which bundle fragments are affected
2. which shape or schema fragments must change
3. whether any plugin manifest or skill/agent file must change
4. what would become inconsistent if we do not update the bundle
