# Baseline repair — bounded independent correctness re-review

```json
[]
```

The prior HIGH finding is resolved for the generated CI workflow. Reviewed current ci-shard-plan.mjs baselineCheck (134–158), previousBaseline/preparedBaseline and prepare (353–400), ci.yml plan checkout/event base binding, and ci-release-strategy.md baseline transition contract (98–114). Preparation now derives the previous value from the tracked config at a validated preceding ancestor, binds it separately into the plan, checks the old/new/base/owner/reason approval before inventory execution, and retains that reference through run, fan-in, attestation and release verification. Bootstrap is explicit and cannot substitute for an existing prior baseline. This addresses the original same-value comparison defect without weakening the low-level reviewed-baseline API.

Read the real Git prepare/run/fanin integration tests (greenfield-ci-release.test.mjs 230–315), including all three floor transitions, missing and malformed approval fields, caller-invented prior values, unavailable history, first-parent fallback, and bootstrap. These now execute the preparation path missed by the previous unit fixture; restoring the earlier overwrite would allow the missing-approval regression cases to reach green.

Inspected /tmp/greenfield-baseline-green.log: terminal 60 tests, 60 pass, zero failure/cancelled/skipped. Did not independently rerun tests or launch native runs. git diff --check passed. No source changes, commits or unrelated full re-review. This report closes the baseline finding only; final source freeze and native proof remain the parent task's completion gates.
