# NATIVEGREEN 40.7 architecture — uniform terminal owned-worktree cleanup

**Decision: PROCEED_WITH_FIX.** Route every terminal cleanup request through the 40.6 proof-bearing APIs. Make landing and status call chains asynchronous where cleanup is asynchronous. Do not block promises synchronously, add a cleanup daemon, or query a provider through a new adapter before phase 41.

## One orchestration seam

Add in `worktree.mjs`:

```js
runWorktreeCleanup(root, {
  apply = false,
  ownershipIds,              // exact UUID allow-list; omitted means all registered identities
  invocationId = randomUUID(),
  observedAt,
  policy,
}, deps = {})
// -> Promise<{
//   version: 1,
//   invocationId,
//   resumed: WorktreeCleanupResult,
//   plan: WorktreeCleanupPlan,
//   applied: WorktreeCleanupResult | null,
// }>
```

`planWorktreeCleanup` gains the same optional exact `ownershipIds` selector so a terminal event observes only the lane it owns. Unknown, duplicated, or nonregistered IDs refuse; an empty selection is explicit and performs no writes. One helper invocation mints one invocation ID, shared by every selected item. It never loops to manufacture the configured observation count.

When `apply` is true, first call `resumeWorktreeCleanup` for the selected IDs, then plan once, then apply that exact in-memory plan. Already planned/removing/removed identities replay through their stored operation; planning must not overwrite them. When false, planning may atomically persist inactivity observations but cannot create an operation or receipt. Items are independent throughout.

`worktreeGc.enabled` gates automatic terminal apply and operator `--apply`. Disabled calls may dry-run/observe but perform no destructive transition. This helper is the only orchestration added; the 40.6 planner, recovery reducer, and `disposeWorktree` remain the policy and destructive owners.

## Configuration and CLI

Add a strict config object:

```json
{
  "worktreeGc": {
    "enabled": false,
    "inactiveObservations": 2,
    "inactiveIntervalMs": 60000,
    "deleteIntegratedBranches": false
  }
}
```

The whole object is optional and use sites apply these defaults. If present it is strict: reject unknown keys, nonbooleans, `inactiveObservations < 2`, and nonpositive/noninteger interval. Project the same optional shape into the generated JSON schema and scaffold these values with `enabled:false`; configuration never makes a command destructive without `--apply` or an explicit terminal apply call.

CLI grammar is:

```text
roadmap worktree gc [--apply] [--inactive-observations <N>] [--inactive-interval-ms <MS>] [--json]
```

Unknown/duplicate flags, values below bounds, and positional residue are usage errors before observation writes. CLI overrides narrow the config policy for this invocation; they do not rewrite config. Default is dry-run. `--apply` refuses before mutation when `worktreeGc.enabled` is false. JSON writes one stable object to stdout; human mode prints every classification/receipt/hold. Diagnostics go to stderr. Exit 0 means the requested scan completed even with per-item holds, 1 is usage/config, and 2 is unavailable/corrupt global state that prevented a trustworthy scan. A refused item does not make the global scan unavailable.

Production passes no provider callback in phase 40.7. The 40.6 default therefore returns `protection-unavailable`, which is protected behavior. Tests inject the callback. Phase 41 may supply the real provider adapter; task 40.7 must not add a GH subprocess, publication query, credentials, or a second protection vocabulary. Explicit configured protection refs remain active but cannot turn an unavailable provider into unprotected.

## Terminal routing

All terminal callers invoke `runWorktreeCleanup` with the exact journal identity UUID and the launch-owner root. Convert `landArc`, its command callers, phase `runLand`/`runLandCli`, and status completion paths to async/await. The command DAG already accepts async handlers; update direct tests rather than hiding promises behind a synchronous shim.

Before cleanup, the terminal owner may copy/archive and then unlink only its exact known output when all of these agree: canonical path beneath that owned worktree, expected report name, completed journal, and actual bytes matching the journal `reportDigest`. Run, plan, and review each retain their existing destination/archive semantics. A missing file is idempotent. A digest mismatch, carry-in, dependency, unknown file, or any other artifact stays in place and cleanup reports `dirty`. GC itself never deletes artifacts or admits named-report exceptions.

Archive/stamp the terminal journal before cleanup. Landing closes it only after exact output consumption succeeds; an archive hold keeps the live journal discoverable so another landing can retry. Closure publishes an immutable, fsynced closed twin before unlinking the exact live bytes; identical replay and a crash leaving both copies resume without rewriting evidence, while conflicts preserve both files. The closed journal remains the independent ownership record if deletion is delayed. Failed launch and cancellation first atomically record their terminal state; they retain any uncertain lane and surface its result. Status-driven reads call recovery first, then contribute at most one new observation. Repeated status/apply is therefore the supported recovery path. Completion, failure, cancellation, and landing do not bypass the configured interval.

Replace every direct terminal call to legacy `disposeWorktree`, every raw `git worktree remove --force`, and the slot-global prune path in `commands/phase.mjs`. Add `commands/phase.mjs`, `commands/phase.test.mjs`, and `lib/landing-mechanics.test.mjs` to the task scope because they contain the real phase-land and arc-land mutations. No fallback removal runs after a hold or error.

For an owned lane, remove sidecar/claim/resume metadata only after the cleanup receipt proves the worktree removed, or when that metadata has a separate existing completed lifecycle rule that does not erase cleanup evidence. Surface all held/refused details in the existing landing record and status stderr/stdout contract as appropriate.

## Arc sidecars and legacy lanes

Current arc sidecar worktrees were not allocated with the 40.5 journal/registry identity. Landing may not infer ownership from the sidecar, branch, path prefix, PID, or integrated state, and may not mint an identity retroactively. Replace `git.worktreeRemove(... --force)` with a stable `ownership-uncertain` hold and retain the sidecar, claims, and resume evidence needed for recovery. Direct integration in the primary checkout has no sidecar worktree to remove.

This is intentionally safe for the existing estate: legacy, human, slot, and arc-sidecar worktrees survive. A future allocator change may create independently joined ownership at creation time, but it requires its own accepted scope and cannot be smuggled into cleanup. Codex run/plan/review worktrees created after 40.5 already carry the required identity and use the full flow. Plan lanes whose cherry-picked content is not Git-ancestor integrated remain `unique` or `not-integrated`; 40.7 does not weaken 40.6 with content-equivalence disposal.

## Tests

Pin config and generated-schema parity, strict unknown-key rejection, defaults, disabled apply, every CLI flag/error/exit shape, one invocation ID across multiple items, dry-run observation-only behavior, resume-before-plan apply, exact selector scoping, JSON stability, and independent holds. For phase/arc land and run/plan/review completion, failure, cancellation, and status resume, assert async propagation, archive-before-observe, exact digest-bound output removal, no force/prune/legacy disposal, receipt surfacing, and repeated recovery. Assert unowned sidecars and their recovery metadata remain, and no terminal path adopts them.

Plan/review consumption retains the stamped live journal: exact archived-result reuse and restart intentionally resolve it through `findJournal`. Closing it would lose that reuse and trigger unnecessary native work. For repeated run generations, a different valid launch ID in the closed twin is preserved using the existing `.prior.<launchId>.json` convention before publishing the new closed twin; same-generation conflicts still refuse.

Final bounded independent review: approved after checking retry-preserving live journals, exact closed publication and prior-generation rotation, compatibility with archived review reuse, and inactive failed/dead status cleanup. This review is task evidence; it does not replace the phase gate or arc acceptance.

Gate repair ruling: validated historical plan consumption is independent of worktree disposal. A successful archived harvest reports `historical-plan-consumed`, `freshForRequestedHead:false`, the original/current heads, cleanup result and explicit worktree retention. Dirty/invalid/unharvested/archive-held candidates still refuse. Sixteen focused consumption/refusal/status checks passed after the repair.
