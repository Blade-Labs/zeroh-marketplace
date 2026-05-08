---
name: ap-taxonomy
description: Reference taxonomy for SDD anti-pattern findings and hook envelope payloads.
---

# ap-taxonomy

Use these AP classes consistently across execution specs, hooks, reviews, receipts, tests, and canaries. This skill is reference material; plan authoring belongs to `execution-spec`.

| Class | Meaning | Best closure loop |
| --- | --- | --- |
| `AP_PARSE_BOUNDARY` | Shape/schema imported or claimed without runtime parse | Shape gate, hook, test |
| `AP_SILENT_FAIL` | Error or missing value becomes fallback behavior | Hook, CWA decision, test |
| `AP_TEST_CAPITULATION` | Test weakened/skipped/deleted to get green | Hook, review, receipt |
| `AP_CONTRACT_DRIFT` | Plan/type/config/prose disagrees with repo truth | `sdd doctor` |
| `AP_HARDCODED_DATA` | Domain data duplicated into code | Hook, source authority |
| `AP_CEREMONY` | Work has no consumer or deletion/subsumption story | `execution-spec` |
| `AP_SHORTCUT` | Symptom fix or deferral phrased as completion | Receipt/replan |
| `AP_DUMB_REQUIREMENT` | Requirement lacks owner, value, source, size, or proof | `sdd check` |

## Close-The-Loop Rule

When the same AP recurs, close it in the smallest useful loop:

1. `execution-spec` if the issue is missing owner, proof, surface, stop rule, or deletion/subsumption.
2. `sdd check` or `sdd doctor` if the issue can be found from the plan and repo truth.
3. A cheap hook if the signal is local, syntactic, and useful as just-in-time context.
4. A test, canary, or review if the issue needs runtime behavior or semantic judgment.
5. Deletion if the row, hook, or checklist has no named consumer.

Do not add another prose checklist when a checker, hook, receipt rule, or test can replace the reminder. Delete or subsume older ceremony when adding a new loop.

## Hook Envelope Contract

Advisory hooks emit prose first, then an HTML-commented JSON envelope. The envelope uses RFC-style problem fields plus SDD/GRC extensions and must include `_fix.prompt` as the canonical repair payload.

Hard gates are reserved for active-stage integrity and declared proof gates. AP findings steer Claude unless the current execution spec says the AP is part of the proof.
