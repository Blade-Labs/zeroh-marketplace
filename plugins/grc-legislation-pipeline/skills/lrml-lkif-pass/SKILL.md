---
name: lrml-lkif-pass
description: "Perform the two-pass legal semantics workflow: LegalRuleML first-pass classification, then LKIF refinement where rights, powers, liabilities, or immunities matter."
argument-hint: "[provision-id or file]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash
---
Perform the two-pass legal semantics workflow for:

$ARGUMENTS

Pass 1 — LegalRuleML:
- classify statement class
- classify deontic type
- identify actors, action, conditions, and scope

Pass 2 — LKIF:
- only refine when Hohfeldian distinctions materially matter
- capture powers, rights, liabilities, immunities, or disabilities explicitly
- explain why LKIF was needed

Output:
- first-pass result
- second-pass refinement (or explicit "not needed")
- evidence from source text
