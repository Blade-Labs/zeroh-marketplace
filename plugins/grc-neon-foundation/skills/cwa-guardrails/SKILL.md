---
name: cwa-guardrails
description: Background closed-world guardrails for schema, JSON-LD, SHACL, mapping, and runtime code.
when_to_use: Use proactively when editing schemas, shapes, mappings, routing policy, SPARQL, bundle files, or runtime admission logic.
user-invocable: false
allowed-tools: Read Grep Glob Bash
paths:
  - "**/*.json"
  - "**/*.jsonld"
  - "**/*.ttl"
  - "**/*.rq"
  - "packages/**"
---
Apply these rules whenever relevant:

- reject fallbacks, catchalls, permissive schemas, and silent inference from absence
- keep canonical set mappings distinct from pairwise mappings and promoted axioms
- do not invent a new local namespace when a standard term already fits
- do not embed policy in code if the rule should live in the bundle/profile layer
- do not attach confidence to source law
- if a change weakens closure, stop and surface the violation clearly

Prefer small, explicit, validated structures.
