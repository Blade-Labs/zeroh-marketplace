---
name: routing-bindings
description: Derive routing consequences from normalized legal statements using declared routing policy instead of flattening meaning into taxonomy.
when_to_use: Use when binding normalized legal statements to DMN, BPMN, CMMN, or no artifact under the declared routing policy.
allowed-tools: Read Grep Glob Bash
---
Determine routing from normalized legal statements.

Rules:
- routing is a consequence of classification and policy, not a substitute for classification
- keep statement class, deontic type, and routing class separate
- identify when no artifact should be emitted
- make all assumptions explicit
