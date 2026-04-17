---
name: sssom-pairwise
description: Expand approved canonical mappings into explicit closed-world pairwise operational mappings using sssom:Mapping and explicit negatives.
argument-hint: "[mapping scope]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash Write Edit
---
Expand canonical mappings into pairwise operational mappings.

Mandatory rules:
- operational layer uses sssom:Mapping
- every in-scope source×target pair is explicit
- explicit negatives use oscalm:noRelationship
- preserve derivation link back to exactly one canonical mapping
- do not promote here
