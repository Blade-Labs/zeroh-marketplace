---
name: akn-intake
description: Ingest a legal source in a source-preserving way and identify works, expressions, manifestations, provisions, IDs, and spans for downstream normalization.
argument-hint: "[source-file or source-iri]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash Write Edit
---
Ingest this legal source:

$ARGUMENTS

Required behavior:
- preserve source identity and hierarchy
- extract provision candidates without paraphrasing away the source
- record article/clause identifiers, source spans, and text
- do not classify or route yet
- output a deterministic intake plan or patch
