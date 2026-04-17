---
name: ontology-reuse-plan
description: Decide reuse, re-engineering, or local extension across DPV, OSCAL, LegalRuleML, LKIF, SKOS, SSSOM, PROV-O, SHACL, and related standards.
when_to_use: Use for ontology selection, term fit checks, namespace decisions, or any new conceptual surface.
allowed-tools: Read Grep Glob Bash
paths:
  - "**/*.ttl"
  - "**/*.jsonld"
  - "**/*.rq"
  - "docs/**"
---
Create a standards-first reuse plan.

Output:
- candidate standards and terms
- fit / gap assessment
- reuse vs re-engineer vs extend decision
- local terms only if a real semantic gap remains
- validation consequences
