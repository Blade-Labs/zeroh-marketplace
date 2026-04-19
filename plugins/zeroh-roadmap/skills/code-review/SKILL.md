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
- Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO
- Suggested fix (if obvious)

## Severity Rubric

Report **every** finding that meets the >=80% confidence bar — not just the headline-grabbing ones. Minor findings are how regressions and tech debt accumulate.

- **CRITICAL** — security vulnerability, data corruption, financial calc error, runtime crash. Blocks release.
- **HIGH** — wrong business behavior, broken contract, significant perf regression, orphaned business rule.
- **MEDIUM** — incorrect-but-non-blocking behavior, missing error context, brittle pattern, race condition with low blast radius.
- **LOW** — code quality issue with real but minor cost: unclear naming, dead code, weak abstraction, inconsistent pattern.
- **INFO** — observation worth noting but not requiring action: alternative approach, future-considerations, doc gap.

**Do not silently drop a finding because it feels too small.** If you're confident it's wrong, report it at the right severity. The gate decides what to fix.
