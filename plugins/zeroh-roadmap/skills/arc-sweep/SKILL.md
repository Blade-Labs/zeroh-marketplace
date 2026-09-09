---
name: "Arc Sweep"
description: "Inspect a built arc for unresolved compromises and integration gaps before final intent acceptance."
user-invocable: true
---

# Arc Sweep

Read the approved arc, member phase progress and whole diff. Confirm every member phase is built and no acceptance criteria remain deferred before treating the arc as ready for final acceptance. Run `roadmap phase validate <arc-path>`; failure or unavailable tooling blocks readiness.

Inspect cross-phase integration, changed public contracts, architecture/design references, unresolved review findings and recorded compromises. Use the same independent reviewer as the final acceptance when that keeps the review coherent; add an architect only for an actual unresolved architectural question. Do not require a panel or a fresh full-codebase review by default.

Fix in-scope defects under existing authorization. A genuine follow-up needs a concrete owner, consequence and destination; creating a backlog item does not make an unmet original criterion acceptable. Only an explicit owner ratification can change the promise. Preserve relevant historical debt records without requiring a new curation or scoring mechanism.

Report ready for `validate-arc`, or the specific unresolved gaps. A sweep does not itself prove the product works and does not authorize a merge or release.
