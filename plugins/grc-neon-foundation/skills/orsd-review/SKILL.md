---
name: orsd-review
description: Review a proposal or change against the NeOn ORSD, production spine, accepted ADRs, and rebuild phases.
when_to_use: Use for architecture notes, bundle edits, plugin boundaries, acceptance criteria, reuse-versus-extension decisions, and any change that could create drift.
allowed-tools: Read Grep Glob Bash
paths:
  - "docs/**"
  - "data/**"
  - "**/*.jsonld"
  - "**/*.ttl"
  - "**/*.md"
---
Your job is to review the target change against the governing architecture.

Always do these steps:

1. Identify the governing artifacts:
   - ORSD
   - production spine / bundle
   - accepted ADRs
   - relevant SHACL / schema files
2. State which NeOn scenario(s) the change belongs to.
3. Decide whether the change belongs in:
   - profile / bundle / policy
   - shape / schema
   - ontology mapping
   - implementation code
4. List any drift risks.
5. Recommend the smallest coherent slice that preserves the architecture.

Output format:
- governing artifacts
- NeOn scenario(s)
- correct layer
- risks
- recommended change set
- validation steps
