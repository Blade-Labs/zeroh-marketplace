---
name: new-slice
description: Scaffold a new implementation slice that respects repo boundaries, phase order, validation points, and the production spine.
argument-hint: "[slice name or package]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash Write Edit
---
Create a new implementation slice for:

$ARGUMENTS

Requirements:
- map the slice to the correct phase
- identify governing bundle fragments
- keep boundaries clean
- include tests and validation hooks from the start
- do not generate placeholder packages with unclear ownership
