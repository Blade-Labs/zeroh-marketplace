---
name: "Plan Phase"
description: "Read the code and plan one executable, independently testable outcome with proportional checks."
user-invocable: true
---

# Plan Phase

Read the actual code, consumer schema, relevant project conventions and parent arc before writing. Reuse its scope and decisions. Reserve an unused phase number with `roadmap claim`; never derive uniqueness from a directory listing.

Write the smallest coherent outcome that can be implemented and meaningfully checked. For each task state the problem, affected paths, concrete changes, dependencies and observable acceptance. Anchor existing work by actual paths/symbols. For a future path, identify the task that creates it and the expected interface; do not require an unimplemented symbol to exist today. Order vertical slices so useful behavior appears early rather than batching every layer across the whole feature.

Check cheap load-bearing assumptions now (available interface, schema, documented command, current state). Use read-only probes before mutation. Do not perform the future implementation to satisfy plan review or rehearse an expensive full suite during planning. An unknown root cause calls for a bounded investigation, not invented certainty.

Choose the consumer's existing test/run commands. A check must distinguish success from the plausible failure it addresses. Use focused tests for behavioral changes, a real boundary check for an integration, and existing validators or visual inspection for declarative/presentation changes. See `../test-strategy/SKILL.md`; do not add mirrored-content tests or compulsory coverage percentages.

Read and satisfy the consumer's actual schema. New native records keep concise check and review results; older vendored schemas may require legacy fields until the owner opts into an upgrade. Do not silently overwrite that schema or falsify legacy evidence. Keep requirements traceable to arc criteria; do not add unrelated product work.

Run `roadmap phase validate <path>` before queueing. Missing tooling is unavailable, not PASS. Have a separate reviewer apply `review-phase` to this plan (or review the small arc window together). Repair actionable gaps, then queue within dependency order. No compulsory separate architect, test engineer or quality pass for every task.
