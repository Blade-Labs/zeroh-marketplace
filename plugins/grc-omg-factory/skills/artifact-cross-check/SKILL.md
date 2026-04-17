---
name: artifact-cross-check
description: Cross-check DMN, BPMN, and CMMN outputs against routing policy, source semantics, and bridge references.
argument-hint: "[artifact family or statement id]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash
---
Cross-check artifacts for:

$ARGUMENTS

Confirm:
- the artifact family is allowed by routing
- bridge references are valid
- no artifact was emitted for a statement that should have no artifact
- source traceability remains intact
