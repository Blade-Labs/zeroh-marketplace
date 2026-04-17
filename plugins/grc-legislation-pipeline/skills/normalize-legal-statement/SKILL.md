---
name: normalize-legal-statement
description: Convert one legal provision into a closed-world normalized legal statement candidate with explicit source span, actor, action, condition, jurisdiction, and effective status.
when_to_use: Use when turning Akoma Ntoso provisions into admitted legal statement candidates or reviewing statement field completeness.
allowed-tools: Read Grep Glob Bash
paths:
  - "data/sources/**"
  - "packages/**/legal*"
  - "**/*akn*"
  - "**/*legislation*"
---
Produce or review a `NormalizedLegalStatement` candidate.

Mandatory fields:
- sourceProvision
- sourceExpression or equivalent source identity
- sourceText
- statementClass
- deonticType
- routingClass
- actor
- action
- object (if present)
- conditionText or structured condition
- jurisdiction
- effectiveStatus

Rules:
- do not invent missing facts
- do not treat missing fields as false
- preserve source wording where needed for provenance
- keep routing separate from legal meaning
