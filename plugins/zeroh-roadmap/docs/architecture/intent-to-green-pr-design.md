# Intent-to-green-PR architecture

Status: ratified for the `NATIVEGREEN` arc on 2026-09-04.

## Semantic core and harness adapters

One harness-neutral reducer owns role requests, authority, run identity, results, lifecycle
transitions, delivery state, and receipts. Claude and Codex adapters translate native launch,
resume, messaging, and hook capabilities without changing semantics or enlarging authority.
Native hooks are defense-in-depth; shared CLI/result boundaries remain sufficient for correctness.

Stable contracts are `ProtocolEnvelope`, `AgentDriver`, `AgentRunHandle`, `ArcDelivery`,
`PullRequestProvider`, `CiProvider`, `FailureScopeClassifier`, `BranchStrategy`, and
`DocProjection`. Request and receipt persist around every external action; resume uses stable IDs.

## Delivery lifecycle

Default: one arc, one branch, one open non-draft PR. Green binds the latest head SHA. Merge is
separate policy: `manual` by default, with explicitly configured and authorized `queue` or
`auto`. Independent arcs branch from the target; dependent arcs stay one PR per arc and stack
explicitly; grouping several arcs into one PR requires a ratified delivery group.

CI classification uses raw evidence: causal, owned-preexisting, unrelated, infrastructure/flaky,
or indeterminate. Causal and owned-preexisting failures use the existing bounded small-correction route, affected
checks, fresh intent validation, push and exact-head checks; larger changes use planned
correction phases, gate and sweep. Scope authority and correction budgets survive resume. Other failures never authorize speculative edits.

## History and worktrees

Before first publication, an unpublished arc branch is normalized losslessly to one outcome commit
per phase by default, with tree equality, rescue refs, receipts, and compare-and-swap. One or two
CI corrections may remain if they turn the PR green. Later compaction happens only with an already
necessary red-CI push; green history is never rewritten for cosmetics.

Roadmap worktree ownership is a durable identity shared by registry, marker, and journal. GC never
infers ownership from prefix or age. It removes only inactive-twice, clean, recoverable
roadmap-owned worktrees through the same safe disposer used by landing.

## Root and documentation projections

The marketplace migration is atomic: `roadmap/*` becomes `docs/roadmap/*`, and
`lib/roadmap/*` becomes `docs/roadmap/lib/*`; no dual-root or symlink interval exists. README
tables, diagrams, support status, and orientation are generated from canonical metadata.

Prior art: `cli/lib/roles.mjs`, `MULTI-DRIVER.md`, `cli/lib/drivers.mjs`,
`workflows/arc-plane.workflow.mjs`, executor-arm/beacon/liveness, worktree/landing, and the
POLYSEAT, MINESWEEP, and GREENFIELD arc records.

The atomic migration includes active assumption/verifier paths, configuration gate
commands, tsconfig includes, and registry/emit entrypoints. Historical evidence is
retained. Pending-phase path checks and real typed imports run against the migrated
fixture; validating filenames alone is insufficient.


## Current-source reuse (2026-09-06)

The ratified design is reused at `036b7c5`; this amendment identifies existing owners,
not a second workflow framework. Native architect re-review did not run; its external
model call was denied by automatic approval review. No fresh architecture verdict is claimed.

- `gate-report.mjs::correctnessDecision` already caps correctness at three rounds and
  closes clean/fixed small findings early. `gate-diagnostics.mjs::retryDecision` already
  stops repeated unchanged failures. Extend these owners.
- `skills/validate-arc/references/corrections.md` owns one bounded correction pass for
  related small owned gaps; larger scope stays planned. Phase42 wires this into delivery.
- `drivers.mjs::launchArgv`, `roles.mjs`, executor arms, workflow and liveness already
  own launch selection and same-executor observation. Phase38 adds only missing portable
  run identity and reconciliation; there is no competing scheduler or retry loop.
- `worktree.mjs::disposeWorktree` and the existing registry/journal own cleanup. Extend
  stable matching identity and final provider/ownership checks in this same seam.
- Existing actual-byte prepared-program execution and shared capbuild admission remain
  unchanged. Conformance computes checksums from bytes; models never predict them or
  retype programs. Native trial records stay outside the normal consumer task flow.
- Documentation uses a bounded capability catalog and generated fragments. Ordinary
  prose is independently reviewed, not converted into a per-sentence proof language.

The original native matrix and density bars remain acceptance obligations. Deterministic
negative tests run first; live scenarios require isolated provider authority and a frozen
operator budget. Exhaustion leaves missing conditions unresolved, not silently omitted.
