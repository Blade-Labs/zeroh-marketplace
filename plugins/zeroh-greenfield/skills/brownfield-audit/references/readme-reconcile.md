# README catalog reconciliation

`templates/scripts/check-readme-catalog.mjs` is the only comparator. Do not implement a second catalog algorithm in brownfield-audit.

1. Copy or resolve `templates/scripts/check-readme-catalog.mjs` exactly as greenfield-init specifies.
2. Run `templates/scripts/check-readme-catalog.mjs` for the initial red and retain its reported missing and orphan rows as evidence.
3. Propose additions only when the emitted record satisfies `catalog-entry-plus-existing-root`.
4. Treat a README row without a corresponding emitted record and existing root as an orphan. Removal is an `approval-gated orphan removal`; never remove it from detector output alone.
5. After approval, apply only the accepted row additions or removals.
6. Run `templates/scripts/check-readme-catalog.mjs` for the final green and attach its exit code to the gap-table artifact.

If the initial run is green, classify README currency `present` and emit no proposal. If the emitted catalog or repository root cannot be resolved, STOP and report the missing source rather than inventing a project.
