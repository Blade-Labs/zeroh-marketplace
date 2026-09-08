---
name: "Full Code Review"
description: "Review the whole requested code scope with risk-based independent coverage."
user-invocable: true
---

# Full Code Review

Use this for an explicitly requested whole-codebase review or when the consumer requires one. Ordinary phase/diff review stays with `review-phase` or `code-reviewer`.

Define the actual review boundary and highest-risk behavior from the code and product. Dispatch independent native reviewers only for separable concerns that justify parallel work; avoid a fixed eight-agent panel. Each reviewer gets concrete paths, requirements and a read-only scope. If native agents are unavailable, report which work is the supervising author's own inspection and which independent review remains pending.

Inspect security boundaries, important data/financial logic where applicable, error paths, public contracts, concurrency, test effectiveness and integration behavior. Consolidate duplicate findings, confirm them against the actual code, and give reproducible evidence and impact. Do not inflate stylistic preferences into defects or assign fabricated confidence percentages.

Return actionable findings and unverified scope. Fix and independently verify substantive repairs within the agreed review budget; do not invent an entire remediation arc automatically. Required release policy still governs readiness; a clean code review alone is not live acceptance.
