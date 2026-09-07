# NATIVEGREEN 40.6 architecture — proof-bearing owned-worktree cleanup

**Decision: PROCEED_WITH_FIX.** Extend the version-2 worktree registry with cleanup metadata keyed by the immutable ownership UUID. Keep `RoadmapWorktreeIdentity` byte-stable. Classification is asynchronous because provider protection can be asynchronous; registry mutations remain short synchronous compare-and-swap sections under the existing kernel lock. `disposeWorktree` remains the sole function that removes a worktree.

## Registry data

The canonical registry adds one optional collection while preserving `slots` and `identities`:

```js
cleanup: {
  [ownershipId]: {
    version: 1,
    identityDigest: 'sha256:...',
    observations: [WorktreeInactivityObservation], // zero through configured inactiveObservations
    receipt: WorktreeCleanupReceipt | null,
  },
}
```

Legacy registries project an empty cleanup map. Identity registration refuses a stale cleanup entry for the same new UUID. Exact identity removal preserves its cleanup entry when its receipt is `removing`, `removed`, or `held`; ordinary pre-journal allocation unwind removes an otherwise empty entry. Cleanup metadata never changes identity bytes and never supplies ownership when either the identity row or matching journal is absent.

An observation is:

```js
{
  version: 1,
  invocationId: '<lowercase UUID>',
  observedAt: '<ISO instant>',
  evidenceDigest: 'sha256:...',
  identityDigest: 'sha256:...',
  journalDigest: 'sha256:...',
  head: '<exact commit>',
}
```

`evidenceDigest` covers the exact identity and journal bindings, HEAD, inactive process-group result, clean status, recoverability result, integration ref and resolved integration tip, branch/detached state, and protection result. An invocation contributes at most one observation for an ownership ID. Evidence change resets the pair to the current observation. Identical evidence before `inactiveIntervalMs` retains the first observation without moving its timestamp. At or after each interval, a distinct invocation appends the next observation until the configured count is met. Callers must require `inactiveObservations >= 2` and a positive interval; task 40.6 implements the two-observation primitive, while task 40.7 supplies configured values.

## Public contracts

```js
probeWorktreeProtection({ repository, identity, journal, head, branch, configuredRefs }, deps)
// -> WorktreeProtectionProbe:
// { state: 'protected'|'unprotected'|'unavailable',
//   evidence: [{ kind: 'configured-ref'|'provider-pr', id, head? }], reason: string|null }

planWorktreeCleanup(root, {
  invocationId,
  observedAt,
  inactiveObservations = 2,
  inactiveIntervalMs,
  integrationRef = 'develop',
  configuredProtectionRefs = [],
}, {
  probeProtection,
  now,
  git,
} = {})
// -> Promise<WorktreeCleanupPlan>

applyWorktreeCleanup(root, plan, {
  probeProtection,
  git,
  beforeBoundary,
  dispose = disposeWorktree,
} = {})
// -> Promise<{ version: 1, planDigest, items: WorktreeCleanupReceipt[] }>
```

Production supplies no hook. `beforeBoundary(frozenItem)` is a test-only observation point before the mandatory fresh boundary probes and cannot override their result. Injected `git`, protection, clock, UUID, or disposer dependencies model results but do not add a second policy owner.

The plan is strict immutable data with sorted items and a code-computed digest. Each item records the exact identity, exact live or closed journal binding, HEAD, branch, integration ref/tip, two qualifying observations, protection result, and one classification. Stable classifications are:

```text
eligible
ownership-uncertain
live
dirty
unique
not-integrated
protected
protection-unavailable
evidence-unavailable
observation-required
observation-interval
```

Only `eligible` enters apply. Prefixes, slots, legacy or single records, copied IDs, malformed/symlink paths, ambiguous journals, unavailable Git answers, and mismatched live Git classify `ownership-uncertain` or `evidence-unavailable`; they are never candidates. Provider failure is `protection-unavailable`, which is protected behavior. Protection considers only explicitly configured refs and the provider callback's exact open-PR answer. Unrelated local or remote branches are not called provider protection; they may still prove commit recoverability.

Recoverability and integration are separate. Recoverability requires Git to prove every commit through lane HEAD is reachable from a surviving ref other than the lane branch, using the existing `disposeWorktree` reachability rule. Integration requires lane HEAD to be an ancestor of the resolved integration tip. A pushed but unmerged lane is recoverable and `not-integrated`; a merged lane with unique work is impossible under valid Git evidence but still fails either unanswered proof.

## Apply and recovery

For each eligible item independently:

1. Under the registry lock, re-read the exact identity and cleanup observations, re-resolve the exact matching live or closed journal, validate the untouched plan digest, and append a `planned` attempt. Any difference appends `held` with `evidence-changed` before effects.
2. Run `beforeBoundary` if injected. Then freshly repeat ownership/journal join, liveness, HEAD/branch, dirt, recoverability, integration ancestry, configured refs, and provider protection. An unavailable or changed answer atomically changes that attempt to `held` with the stable classification reason.
3. Under the lock, compare the same evidence again and change only that exact attempt from `planned` to `removing`. This is the durable destructive authorization.
4. Call `disposeWorktree` with the plan's exact branch, integration ref, journal PGID, and lane artifact policy. Do not duplicate its dirt, liveness, reachability, removal, branch deletion, or prune implementation. A refusal atomically becomes `held`, preserving its existing reason mapping.
5. Atomically remove the exact identity row and mark the attempt `removed`, recording `alreadyDisposed`, `branchDeleted`, detail, and completion time. Keep the terminal cleanup receipt in the existing registry.

`WorktreeCleanupReceipt` has strict keys `{version, planDigest, ownershipId, identityDigest, state, reason, plannedAt, removingAt, completedAt, disposal}`. `state` is `planned | removing | removed | held`; timestamps and disposal are null until their transition. Updates require the exact prior state and plan/identity digests.

A crash before `removing` has no destructive authority and replans from fresh evidence. A crash after `removing` resumes only that exact attempt. If the worktree still exists, all boundary proofs run again before `disposeWorktree`. If it is absent, the exact `removing` record plus retained identity/journal is the only accepted removal prefix: recheck provider protection and integration/branch evidence that remains available, call the existing missing-worktree arm to prune and handle only the recorded branch, then converge to `removed`. An absent tree without that exact prefix is held as `ownership-uncertain`. A crash after disposal but before receipt therefore converges; completed replay returns the existing immutable terminal receipt and performs no second destructive action.

One held item never stops another item. Dry-run planning may persist inactivity observations because persistence is the evidence requirement, but it never writes `planned`/`removing` and never calls the disposer. Task 40.7 may route terminal callers and CLI apply into these APIs; until then existing direct callers of `disposeWorktree` retain their current behavior and signature. GC never calls a legacy disposal path.

## Required tests

Pin distinct invocation IDs, interval boundaries without timestamp sliding, evidence-change reset, and two calls from one invocation. Cover exact live and archived journal joins; every identity field mismatch; live, dirty, unique, pushed-unmerged, integrated, configured-ref protected, provider-PR protected, and unavailable provider results. Race each boundary through the hook, including HEAD, journal, registry, dirt, liveness, integration ref, and protection changes. Crash after observation, `planned`, `removing`, physical removal, identity removal, and terminal receipt; only the exact `removing` prefix may converge a missing tree. Confirm legacy, slot, human, other-tool, symlink, copied, ambiguous, and absent-record trees survive, repeated completed apply is a no-op, and independent eligible items continue after another is held.

## Final boundary refinements

The cleanup root is the explicit launch-owner Git toplevel. Its local registry and the exact live or closed journal must agree on journal `ownerRoot`; the identity independently requires `repository === mainCheckout(root)` and the same Git common directory. Cleanup never substitutes the main checkout's sidecar and never searches or adopts sibling sidecars. Task 40.7 defaults the CLI to its current owner root and terminal callers pass the root that owns their journal.

The observation array holds up to the configured `inactiveObservations` count, for every supported integer at least two. Each qualifying entry needs a distinct invocation ID and the policy interval from its predecessor; one invocation cannot fill multiple positions.

Use one bounded `cleanup[ownershipId].receipt`, not an attempts log. It is absent while only observing. Same-plan replay advances or returns it; another plan cannot replace `planned`, `removing`, or immutable terminal `removed`. A fresh fully proved plan may atomically replace `held`. This retains the current durable recovery/audit evidence without unbounded periodic-GC history.

Strict owned cleanup enters `disposeWorktree` with an exact proof-bearing option containing ownership ID, identity digest, plan digest, and removing-receipt identity. The disposer acquires the registry flock and keeps it across the final exact registry/receipt and local Git rechecks and the destructive Git call. In this mode it never uses the force fallback: a plain removal refusal after the final clean probe is a stable hold. It also skips global `git worktree prune`, because GC of one identity may not mutate stale metadata belonging to unowned worktrees. Existing callers without the proof option retain their current behavior until task 40.7 routes them. Remaining CODEX report, plan, or review artifacts are dirty in strict GC; their existing terminal owners must archive or remove them before cleanup.

The cleanup policy defaults `deleteIntegratedBranches` to false. When true, branch deletion uses `git update-ref -d <exact-ref> <expected-head>` after the ancestry proof; concurrent branch movement refuses by compare-and-swap. Missing-worktree recovery is accepted only from the exact durable `removing` receipt, skips global prune, repeats remaining provider and integration evidence, and may CAS-delete only that recorded branch.

The apply dependency seam exposes test-only frozen hooks `afterPlanned`, `afterRemoving`, `beforeDisposal`, and `afterDisposal`. Each runs after the named durable/effect boundary and cannot waive the next mandatory recheck. These hooks cover every receipt/removal crash prefix without a production journal or process manager.

## Bounded implementation review

The independent architect approved the ownership, observation, boundary lock, no-force removal, missing-tree recovery and branch CAS placement. A changed row that cannot safely receive the initial receipt is returned as `{ownershipId, state: 'refused', reason: 'evidence-changed', receipt: null}`. This transient refusal is explicitly not a persisted receipt; independent items continue. Persisted held receipts remain ordinary receipt results.

## Fresh-process recovery input

A cleanup row also stores one bounded current `operation`, atomically with its `planned` receipt:

```js
operation: null | {
  version: 1,
  operationDigest: 'sha256:...',
  planDigest: 'sha256:...',
  ownerRoot: '<canonical launch-owner root>',
  repository: '<canonical main checkout>',
  policy: WorktreeCleanupPolicy,
  item: WorktreeCleanupPlanItem,
}
```

The operation digest covers every field except itself. The receipt binds both plan and operation digests. This stores the exact per-identity policy, observations, and evidence needed for recovery without copying the global plan into every row. `operation` is null while observing; it and the planned receipt are published together. Planned, removing, and removed retain the exact snapshot. A fresh proved plan may replace operation and receipt only from held; removed remains immutable.

Export `resumeWorktreeCleanup(root, { ownershipIds } = {}, deps)` to enumerate strict stored planned/removing operations and feed each through the same private apply reducer. It needs no caller-held plan. It revalidates owner root, repository, operation digest, identity, journal, and every fresh boundary proof. Planned advances normally; removing alone authorizes missing-tree convergence. Held requires fresh planning rather than automatic retry. A malformed or incomplete operation produces a non-destructive refusal and does not stop independent rows. This is recovery data in the existing registry, not a new journal or workflow engine.

Final bounded re-review approved the stored-operation validation and corrupt-row isolation after sixteen focused behavior checks passed. Configured task gate000013 passed69/69 worktree checks; this is partial task evidence, not phase completion.
