---
name: adr-draft
description: Draft or update an ADR from repository context and current architecture constraints.
argument-hint: "[adr-title or issue]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash Write Edit
---
Draft an ADR for: $ARGUMENTS

Requirements:
- cite the problem precisely
- name the governing ORSD and bundle constraints
- list options briefly
- make one concrete decision
- state implementation consequences and validation impact
- keep it consistent with CWA and the production spine
