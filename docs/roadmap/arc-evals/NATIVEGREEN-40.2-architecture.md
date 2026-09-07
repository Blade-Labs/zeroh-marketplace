# NATIVEGREEN 40.2 architecture — recoverable history normalization apply

**Decision: PROCEED_WITH_FIX.** Task 40.2 adds one whole-arc apply function over the task 40.1 plan and extracts the existing curation surgery into a shared primitive. It does not add a journal, lock service, scheduler, or mutable state machine.

## Public API

```js
applyHistoryNormalization(cwd, plan, deps = {})
// -> {
//   status: 'applied' | 'already-applied',
//   planDigest, oldHead, newHead, rescueRef, receiptPath,
//   outcomes: [{ phase, sourceCommit, sourceTree, normalizedCommit }]
// }
```

`deps.inspectDelivery` is the same head-bound capability used by `planHistoryNormalization`. Tests may also inject boundary hooks after rescue creation, chain preparation, CAS, and receipt publication. Hooks expose crash seams only; they do not select outcomes or bypass validation.

The immutable receipt is canonical JSON at `.building/history-normalizations/<planDigest>.receipt.json` in the actual worktree. It contains `version`, `planDigest`, `arcId`, `base`, `oldHead`, `newHead`, `tree`, `rescueRef`, and the ordered phase/source-tree/normalized-commit mapping. Use `publishImmutableFile`; an incumbent is accepted only when its bytes equal the canonical receipt. The plan remains the input record, so no separate intent or prepared-plan file is introduced.

## Shared curation primitive

Refactor `executeCurate` around a lower-level function owned by `curate.mjs`:

```js
prepareCuration(cwd, {
  base,
  expectedHead,
  expectedTree,
  groups,
  rescueRef,
})
// -> { oldHead, newHead, tree, rescueRef, outcomes }

commitPreparedCuration(cwd, prepared)
// expected-old update-ref; returns prepared
```

The caller verifies the applicable exact HEAD prefix and creates or verifies the immutable rescue before `prepareCuration` builds the commit-tree chain. The rescue remains in `refs/curate-rescue/` so the shared rescue-aware history relation continues to cover phase curation, root-migration receipts, and whole-arc normalization. Creation uses an absent-old-value guard; an existing ref is accepted only when it resolves to `expectedHead`. `prepareCuration` itself neither checks current HEAD nor creates or moves refs, which lets post-CAS recovery reconstruct the deterministic result only after proving the original rescue already exists.

For every outcome, take the tree and author identity/date from the group's recorded source boundary. Set both author and committer identity/date explicitly from that source boundary before `commit-tree`. Stable parent, tree, message, and identities make `newHead` deterministic across a crash and retry. Verify every produced commit's parent/tree/message, the number and order of outcome commits, and final `newHead^{tree} === expectedTree` before CAS.

`commitPreparedCuration` performs only `git update-ref HEAD <newHead> <expectedHead>`. A mismatch refuses and retains the rescue. It never resets the index/worktree and never overwrites a concurrent advance.

Keep `executeCurate(cwd, plan, evidence)` source-compatible. It projects its existing plan into `prepareCuration`, preserves its current gate-report evidence ordering/rollback behavior, calls `commitPreparedCuration`, and returns `{ tip: newHead, rescueRef }` as today.

## Apply and recovery order

1. Validate the plan's exact canonical fields and digest. Resolve every referenced original commit and verify the exhaustive ordered non-merge log, recorded tree, subject/kind, group boundary, message, parent symbol, historical reviewed SHA and tree-equivalent curation binding, original tracked record estate/blob provenance, and expected final tree. Reject unknown fields. Completed replay does not depend on mutable ignored gate-report files; their historical binding is already captured by the immutable plan and proven Git objects.
2. If no receipt exists and `HEAD === plan.expectedHead`, rerun the task 40.1 derivation with the same exact `{ arcId, base, head }` and a fresh delivery observation; require byte-identical canonical plan data. This deliberately requires the configured/provider publication refs and their tips to match the plan before any mutation. An unrelated ref advance therefore causes conservative replanning rather than surgery against a changed publication snapshot.
3. Create/verify `refs/curate-rescue/<expectedHead-prefix>`, prepare the deterministic chain, and recheck the live delivery observation immediately before CAS. It must be bound to `expectedHead`, unpublished, PR-absent, and non-green. Recheck configured/provider publication refs as well.
4. CAS `HEAD` from `expectedHead` to deterministic `newHead`.
5. Publish the immutable receipt and return `applied`.

Recovery is inferred from Git plus the receipt:

- Exact receipt bytes present: require its `newHead` to remain rewrite-aware reachable from current `HEAD`, its recorded tree/outcome chain to validate, and the rescue to retain `oldHead`; return `already-applied` without creating commits or moving refs.
- Receipt absent, `HEAD === expectedHead`: repeat preparation deterministically and continue with CAS.
- Receipt absent, `HEAD === deterministic newHead`: this is the crash-after-CAS prefix. Validate the original nonvolatile plan core, complete prepared chain, rescue, final tree, and a fresh delivery observation bound to `newHead`; test the current publication refs for intersection with the original and normalized ranges, then publish the same receipt without another ref update. An unrelated ref-tip advance is allowed here because CAS already occurred and cannot be made safer by withholding its completion receipt.
- Any other HEAD, rescue mismatch, non-deterministic prepared result, changed live gate bytes or typed plan input before CAS, publication, green delivery, or receipt mismatch refuses with the rescue path. It does not roll HEAD back and does not rewrite again.

A receipt-complete replay may occur after later commits, so it uses the existing rescue-aware ancestry relation rather than exact `HEAD === newHead`. An incomplete apply deliberately accepts only the two exact prefixes above; accepting a descendant before the receipt exists would blur a concurrent/user advance into successful recovery.

## Required failure tests

Cover crashes immediately after rescue, after each prepared commit, immediately before CAS, immediately after CAS, and during immutable receipt publication. Each retry must produce the same `newHead` and receipt bytes. Also cover rescue collision, tree/message/parent mismatch, stale plan or gate digest, delivery changing to published/green before CAS, CAS race, concurrent advance after an unreceipted CAS, mismatched incumbent receipt, and a completed replay after later commits. Assert that every refusal retains the rescue and that no path uses reset, force-update, or a second history implementation.

## Clarifications from implementation review

The record binding covers the complete source estate the registry executes: root-local `lib/schema.ts`, `lib/registry.ts`, every sorted direct `phases/*.phase.ts`, and every sorted direct `arcs/*.arc.ts`. All paths must be regular nonsymlink files inside the Git worktree, tracked and free of staged or unstaged changes. The canonical plan records the sorted `{ path, blob }` list. This avoids inventing a record-to-filename mapping that the current registry does not return and prevents external or untracked modules from supplying ownership.

Object construction and recovery use three shared operations rather than a recovery flag on one ambiguous function:

```js
ensureCurationRescue(cwd, rescueRef, expectedHead, { create })
prepareCuration(cwd, spec)
commitPreparedCuration(cwd, prepared)
```

The initial path requires `HEAD === expectedHead`, calls `ensureCurationRescue(..., { create: true })`, then prepares. Post-CAS recovery requires `HEAD === deterministicNewHead` and calls `ensureCurationRescue(..., { create: false })` before reconstructing the deterministic chain. `prepareCuration` does not inspect current HEAD or create/move refs; it reads the still-reachable source commits and creates or reuses deterministic Git objects. Recovery therefore cannot mint a rescue after the old head has ceased to own HEAD.
