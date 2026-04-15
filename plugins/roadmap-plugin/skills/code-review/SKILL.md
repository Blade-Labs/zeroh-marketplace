---
name: "Code Review"
description: "Review code for bugs, logic errors, pattern adherence, and compliance with project conventions. Use when reviewing PRs, validating phase work, or auditing test effectiveness."
user-invocable: true
metadata:
  keywords: review, bugs, logic, patterns, blast-radius, regression
---

# Code Review Protocol

## Focus Areas (Priority Order)

1. **Logic errors** — undefined references, stale closures, race conditions, incorrect mock setups
2. **Business rule correctness** — do gates enforce the right contract clauses? Are financial calculations correct?
3. **Test effectiveness** — do tests catch real bugs or just test mock shapes?
4. **Error handling** — does every catch block surface the actual error with remediation?
5. **Disclosure integrity** — do field-visibility entries match catalog field names exactly?
6. **Platform standards** — no test capitulation, no error hiding, no fallbacks

## Confidence Filter

Report ONLY findings with >=80% confidence. Low-confidence hunches waste the user's time.

## Output Format

For each finding:
- File path and line number
- Issue description (1-2 sentences)
- Severity: CRITICAL / HIGH / MEDIUM
- Suggested fix (if obvious)
