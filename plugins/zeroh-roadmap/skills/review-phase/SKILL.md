---
name: "Review Phase"
description: "Independently review a planned or implemented phase against actual code and original requirements."
user-invocable: true
---

# Review Phase

Run as a reviewer separate from the implementation author. Read the supplied phase/arc and original intent, then inspect the actual checkout and diff. Model selection follows the current host configuration and explicit owner ruling, not a plugin resolver. If no independent reviewer is available, report review pending.

For a **plan**, check that the next window is executable: acceptance describes useful behavior, dependencies exist or name their creating task, assumptions have cheap evidence, proposed checks catch plausible failures, and changes stay in scope. Deferred later outcomes do not need invented task detail. Run `roadmap phase validate <path>` on each reviewed phase and arc; review the real consumer schema, not only the plugin template.

For **implemented work**, inspect the changed behavior and important callers, evaluate tests against plausible regressions, and compare every claimed outcome with original acceptance. Read actual command results or execute targeted missing checks. Distinguish missing, partial, contradictory and unrequested work. Do not accept narrowed criteria, weakened tests or a mutable completion flag as evidence of success.

Return actionable findings with path, observed problem, impact and a concrete correction/check, or a clean verdict. State unverified areas. The supervisor owns edits and queue/completion state; reviewers do not overwrite sibling work or silently rewrite acceptance.

One independent review is the normal starting point. Stop on a clean result. Follow-ups verify repairs and affected behavior instead of restarting the whole review; substantial correctness repairs require independent confirmation. **Three review rounds maximum by default**, not three mandatory passes. If unresolved, report the actual blocker and bounded next action. No automatic escalation into more reviewers, mandatory quality pass or numeric proof score.
