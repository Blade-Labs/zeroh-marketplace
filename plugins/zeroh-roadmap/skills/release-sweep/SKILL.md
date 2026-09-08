---
name: "Release Sweep"
description: "Review unresolved release work and debts under the consumer release policy."
user-invocable: true
---

# Release Sweep

Read the actual release diff, acceptance and outstanding review/debt records. Resolve release-blocking defects within existing authorization and identify any remaining non-blocking follow-up with a real destination. Moving a defect to a backlog cannot satisfy an unmet release requirement.

Use the consumer's release policy and ordinary CI/provider tools. Do not require arc scoring, a new audit ledger, mandatory archival or a whole-codebase panel for every patch. Reuse current relevant evidence; run additional checks only for changed behavior or unresolved risk. State the exact checks and remaining limits.

Publishing, merging and release actions follow the user's existing authorization. Archiving historical roadmap files is optional and separate; preserve readable history and current dependency references.
