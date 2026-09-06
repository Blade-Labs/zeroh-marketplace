# Phase 34 independent correctness review

Reviewed 29e0ded through HEAD 4f1e85dd85729ab3259585f724aaaca5cf0105f0 plus current dirty source and Roadmap 0.40.0 / Greenfield 1.0.0 release preparation. Applied plugins/zeroh-roadmap/agents/code-reviewer.md. Consumer reviewFocus is absent; used the generic rubric. Read roadmap configuration, phase 34 requirements and .building/HANDOFF.md governance fence.

```json
[
  {
    "file": "plugins/zeroh-greenfield/templates/scripts/ci-shard-plan.mjs",
    "line": 340,
    "severity": "HIGH",
    "confidence": 96,
    "description": "The generated workflow replaces the previous baseline with the proposed current baseline before checking baseline approval. prepare plan writes config.baseline into plan.adapterConfig.baseline, and prepare fanin passes that same config.baseline; baselineCheck then prefers the plan baseline over baselineApproval.previous and skips its approval checks because the values are equal. Thus lowering minTests/minUnits/coverageFloor in the delivery config can attest against the lower floor without the required changed-baseline record, and even a supplied record with invalid digests is ignored on this path. Preserve a separately bound previous baseline and validate its transition during actual prepare/fanin execution; add a regression through the generated workflow preparation path."
  }
]
```

Contract: phase 34.6 workflow step requires inventory/test-count/floors through approved baseline changes. greenfield-init/references/ci-release-strategy.md lines 98–102 requires a changed-baseline record with matching old and proposed digests. This finding concerns that explicit record/binding requirement, not an invented independent human authorization mechanism.

Current-line verification: re-read ci-shard-plan.mjs lines 134–140 and 336–346 immediately before reporting. The existing test at greenfield-ci-release.test.mjs lines 135–150 supplies a previous-baseline plan manually, a state the real prepare plan command overwrites, so it does not cover this integration defect.

Also examined deterministic inventories, raw report parsing/fan-in, release digest and provenance links, workflow privilege separation, source guards, native observer/source binding, optional Nx selector proof, installation/merge protocol, router and brownfield behavior, CLI help dispatch, metrics binding changes, and packaging parity. No additional confident substantive finding. Native receipts were intentionally not revalidated against changed source; phase 34.7 remains done:false (re-read lines 457–460). No paid native runs, source edits, commits or test runs were performed. git diff --check passed. Final four native runs and normal completion gates remain necessary after fixes and source freeze.
