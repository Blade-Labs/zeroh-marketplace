---
name: shacl-sparql-check
description: Author or review SHACL and SPARQL constraints for admission, completeness, promotion, and provenance invariants.
when_to_use: Use when editing shapes, SPARQL constraints, admission policies, mapping completeness checks, or runtime invariants.
allowed-tools: Read Grep Glob Bash
paths:
  - "**/*.ttl"
  - "**/*.rq"
  - "**/*.jsonld"
---
Review or author SHACL/SPARQL with these priorities:

- closed shapes first
- scope completeness explicit
- duplicates rejected
- destructive updates blocked unless explicitly reviewed
- promotion constraints explicit
- provenance and review policy checkable
