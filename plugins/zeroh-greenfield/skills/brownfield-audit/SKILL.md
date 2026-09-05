---
name: brownfield-audit
description: Handle requests phrased as audit, fill gaps, or reconcile an established repository by proposing only missing, partial, or stale homes before approval.
---

# Brownfield audit

Use this workflow for an established repository. Invoke `zeroh-greenfield:stack-decision` only when stack evidence is unresolved or conflicting, then resolve `skills/greenfield-init/references/standards.md` and `skills/greenfield-init/references/pointers.md` from the installed zeroh-greenfield plugin root as the contract owners. Read `references/marker-table.md`, `references/harness-files.md`, and `references/readme-reconcile.md` when their stages say so.
Not this skill: route initial trigger selection through `using-zeroh-greenfield`, marker-free repositories through `greenfield-init`, and unresolved stack selection through `stack-decision`. Use `roadmap/arc-evals/phase-33.peval.json` as the 2026-09-04 fixture and oracle evidence.

## Detect

Confirm the repository root and inspect every evidence glob in `references/marker-table.md`. A marker is evidence, not a stack decision; absence never proves a stack. Inventory existing canonical homes and sibling-plugin availability. Resolve roadmap roots using the marker-table procedure; require the same read-only capability preflight as greenfield-init before proposing config changes. Do not call stack-decision to replace a proven existing choice.

Apply these failure exits:

- zeroh-roadmap absent: STOP and return `/plugin install zeroh-roadmap@zeroh-marketplace`.
- Only when an approved Blade handoff requires it: zeroh-design absent: STOP and return `/plugin install zeroh-design@zeroh-marketplace`. Continue non-Blade documentation and configuration repairs without this sibling.
- greenfield-init absent: STOP and return `/plugin install zeroh-greenfield@zeroh-marketplace`.
- Repository root unresolved: STOP and name the unresolved path.

## Gap table

Expand detection categories into one row per required artifact (PRD, tech-stack ADR, design-system ADR, CODE-STYLE, architecture index, UX canon, README catalog, each harness file, and roadmap config), plus each independently actionable stale/partial asset. Alternative canonical homes count as present; inspect their contents before classifying. Optional framework or Superpowers absence is not a gap unless selected by the approved project requirements. Emit rows with columns `Artefact | State | Evidence path | Proposed action | Existing home to LINK`. Classify each row `present`, `partial`, `missing`, or `stale`; cite concrete evidence. Consult `references/harness-files.md` for harness rows and `references/readme-reconcile.md` for catalog currency.

## Propose

Emit proposals ONLY for gap-table rows in state `missing`, `partial`, or `stale`.
Emit no proposal for a `present` row.
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

Emit its parser-bound form with concrete values:

```json
{"type":"audit-result","proposals":[{"path":"<repository-relative-path>","reason":"<reason>"}],"writes":["<repository-relative-path>"],"gaps":["<artifact>: <missing|partial|stale>: <evidence-path>"]}
```

On an idempotent rerun emit empty `proposals`, `writes`, and `gaps`. `plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs` enforces native event ordering and observed writes; treat gap-only preservation as honor-system. Treat sibling routing, approval interpretation, and every other unbound STOP/ONLY/never rule as honor-system.
