---
name: brownfield-audit
description: Handle requests phrased as audit, fill gaps, or reconcile an established repository by proposing only missing, partial, or stale homes before approval.
---

# Brownfield audit

Use this workflow for an established repository. Consume `zeroh-greenfield:stack-decision`, then use `skills/greenfield-init/references/standards.md` and `skills/greenfield-init/references/pointers.md` as the contract owners. Read `references/marker-table.md`, `references/harness-files.md`, and `references/readme-reconcile.md` when their stages say so.
Not this skill: `greenfield-init` owns marker-free repositories, and `stack-decision` owns stack selection. Provenance: `roadmap/arc-evals/phase-33.peval.json` records the 2026-09-04 brownfield fixture and oracle.

## Detect

Confirm the repository root and inspect every evidence glob in `references/marker-table.md`. A marker is evidence, not a stack decision; absence never proves a stack. Inventory existing canonical homes and sibling-plugin availability.

Failure exits:

- zeroh-roadmap absent: STOP and offer /plugin install zeroh-roadmap@zeroh-marketplace
- zeroh-design absent: STOP and offer /plugin install zeroh-design@zeroh-marketplace
- greenfield-init absent: STOP and offer /plugin install zeroh-greenfield@zeroh-marketplace
- Repository root unresolved: STOP and name the unresolved path.

## Gap table

Emit exactly one row per marker-table artefact with columns `Artefact | State | Evidence path | Proposed action | Existing home to LINK`. Classify each row `present`, `partial`, `missing`, or `stale`; cite concrete evidence. Consult `references/harness-files.md` for harness rows and `references/readme-reconcile.md` for catalog currency.

## Propose

Proposals are emitted ONLY for gap-table rows in state missing / partial / stale.
A `present` row yields NO proposal.
Record approval before any write.

For each eligible row, show the target, source facts, minimal delta, preservation guard, and verification. Do not select a new stack or duplicate an owner contract.

## Approval

Wait for explicit approval of the complete proposal. If approval changes scope, regenerate the gap table and proposal. If approval is absent or ambiguous, STOP with the proposal unchanged.

## Act

Apply only approved gap rows. An existing home is LINKED from the index/canon, never replaced. Follow `skills/greenfield-init/references/standards.md` for conventions and generated blocks, and `skills/greenfield-init/references/pointers.md` for roadmap configuration. Call `zeroh-greenfield:stack-decision` if stack evidence conflicts; never infer a replacement stack.

For harness reconciliation, execute the approved pointer diffs in `references/harness-files.md`. For README reconciliation, use only the checker named in `references/readme-reconcile.md`.

## Verify

Run every approved row's falsifiable check. Re-run the README checker when applicable, byte-compare generated harness marker blocks, and confirm present rows remain unchanged. On any red result, STOP and report the row, command, and evidence without marking it complete.

## Done

Return the final five-column gap table, approval record, changed paths, verification commands and exit codes, linked canonical homes, and any stopped rows. Done exists only when this artifact is complete and every acted row is green.
