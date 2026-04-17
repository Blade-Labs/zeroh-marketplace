---
name: oscal-set-mapping
description: Author or review canonical OSCAL-style set mappings with source-set, target-set, relationship, rationale, coverage, qualifiers, confidence, and provenance.
argument-hint: "[mapping scope or source statement]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash Write Edit
---
Author or review canonical set mappings for:

$ARGUMENTS

Rules:
- preserve set-level semantics
- make relationship and matching rationale explicit
- attach confidence, coverage, and qualifiers here
- do not flatten to pairwise operational mappings in this step
- explain any semantic gap
