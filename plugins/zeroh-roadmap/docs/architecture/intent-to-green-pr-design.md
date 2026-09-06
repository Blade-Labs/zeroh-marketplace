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
or indeterminate. Causal and owned-preexisting failures re-enter normal correction-phase, gate,
sweep, validation, push, and exact-head checks. Other failures never authorize speculative edits.

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
