---
name: test-gates
description: Add or review unit, contract, SHACL, SPARQL, and end-to-end gates for a slice.
argument-hint: "[package or feature]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash Write Edit
---
Add test and validation gates for:

$ARGUMENTS

Required mindset:
- validation first, convenience second
- deterministic fixtures where possible
- no merge without enforceable invariants
