# Selector regression — test-engineer RED

Source worktree: `/home/patrik/zeroh-marketplace-codex-29-30-31-32-33-34`.
Only changed `plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs`; no production, acceptance docs, native evidence, commits or paid runs.

Test-engineer card read earlier this session. Consumer roadmap config has no testConventions; retained existing node:test, strict assertions, temporary fixture and spawnSync conventions. Before implementation, RED means either an explicit nonexistent exact target incorrectly exits zero, or shared workspace/runner changes incorrectly narrow the test command rather than selecting exactly the full invocation.

Exact command:

```sh
capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs > /home/patrik/zeroh-marketplace/.building/phase-34-resume/selector-regression-red.tap 2>&1
```

Exit 1. Complete TAP is saved beside this report. Exact final summary:

```text
# tests 37
# suites 0
# pass 15
# fail 22
# cancelled 0
# skipped 0
# todo 0
# duration_ms 4483.167141
capbuild: command exited non-zero (code 1) — treat as a failure, do not proceed as if it passed.
```

At test line45, nonexistent exact path returns actual status0, failing `an invalid explicit exact target must not become green through a successful fallback`. The npm fixture exits0. The assertion requires nonzero and does not require executing the runner or writing an argv artifact for invalid input. Existing valid exact target has scoped tier and status0.

At test line115, 20 subcases fail byte-for-byte argv comparisons: manifest and actual two-commit Git ranges for each of pnpm-lock.yaml, yarn.lock, pnpm-workspace.yaml, tsconfig.json, tsconfig.base.json, pyproject.toml, uv.lock, poetry.lock, requirements.txt, scripts/run-nx-test-tier.mjs. Actual invocations use `nx affected -t test --files=...`; expected bytes come from the actual full invocation, independently checked as `exec\n--\nnx\nrun-many\n-t\ntest\n`. Both modes pass for nx.json, package.json, package-lock.json, vitest.config.ts and jest.config.ts.

Legitimate deleted exact test in real Git range passes full fallback (line138). Ordinary source Git range preserves affected-files argv (line144). Existing metacharacter-safe source path test continues passing. Initial development run had an incorrect control assumption that Git source range labels itself impacted and passes base/head flags; corrected the control to preserve observed existing affected-files behavior as requested. The recorded final RED has only the intended missing-exact and shared-input failures (plus shared-input parent failure).

Fixtures use actual production selector execution and actual Git diffs, with only npm substituted at the external runner seam. File classification assertions are behavioral argv outcomes, not production regex copies. Root owns implementation and final GREEN validation.

## Mixed-scope follow-up RED

After root reported the original selector suite 37/37 GREEN, added a regression mixing `uv.lock` and an explicit exact test. The positive control with both files present passes full selection; removing only the test makes the explicit request invalid even though the lock still requires a full suite. No runner-execution requirement is imposed on the invalid request.

```sh
capbuild node --test --test-name-pattern='mixed explicit scope' plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs > /home/patrik/zeroh-marketplace/.building/phase-34-resume/selector-mixed-regression-red.tap 2>&1
```

Exit 1; 1 test, 0 pass, 1 fail. Failure: `a shared lock requiring full tests must not authorize a nonexistent explicit test target` (actual exit status0). Full TAP saved in `selector-mixed-regression-red.tap`. Root owns validation-order correction and GREEN rerun.
