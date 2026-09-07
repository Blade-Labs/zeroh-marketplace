# NATIVEGREEN 40.3 architecture — normalization at the publication boundary

**Decision: PROCEED_WITH_FIX.** Expose one provider-neutral command/callable boundary now. Phase 41 supplies the live delivery and exact-lease push adapters; task 40.3 neither shells to `gh` nor invents another provider client.

## Callable and CLI

```js
normalizeArc(cwd, arcId, { apply = false } = {}, deps = {})
// deps.inspectDelivery({ root, arcId, base, head })
// deps.replacePublishedHead?.({ ref, expectedOld, newHead, arcId, planDigest })
```

`roadmap arc normalize <arcId> [--apply] [--json]` is the only CLI grammar. Dry-run is the default. Export the callable command handler with dependency injection for tests and the later delivery owner. The ordinary dispatcher supplies no claims; until phase 41 wires a real observer, an unavailable delivery capability produces `delivery-unproven` before a plan file, rescue, Git object, ref, or receipt is written. There are no CLI flags for base, publication, CI color, push necessity, or ownership.

Stable JSON projects one of:

- `planned`: first-publication plan, no mutation.
- `applied` / `already-applied`: normalization receipt and normalized head.
- `retained-corrections`: a published branch has one or two proved useful corrections; no rewrite.
- `published-rewrite-planned`: at least the third proved correction is at an exact red-CI head that already requires a push.
- `published-rewrite-applied`: local CAS plus exact force-with-lease replacement both succeeded.
- `refused`: typed reason, exit 2. Green, indeterminate CI, absent capability, changed lease, foreign history, and ambiguous recovery are refusals rather than cosmetic no-ops.

## Base and head ownership

The caller supplies only `arcId`. Load the actual typed arc through the existing registry/root bridge and derive the normalization base with `derivePhaseStartSha(root, firstOrderedArcPhase)`. Resolve that result and `HEAD` to exact object IDs before invoking `planHistoryNormalization`. Require the arc's configured `baseRef` to resolve and be an ancestor of the derived base; `baseRef` is the integration target, not automatically the rewrite boundary. This preserves the NATIVEGREEN planning prefix through `444112a` while normalizing execution history after it. Reject an empty/duplicate arc phase order or an incomparable base; do not guess from commit counts or accept a CLI base override.

## Durable plan replay

A receipt alone cannot reconstruct the original task 40.1 plan after its source history has been replaced, and a crash may occur after CAS but before the completion receipt. On `--apply`, publish the exact canonical plan bytes first at:

```text
.building/history-normalizations/<planDigest>.plan.json
```

Use `publishImmutableFile`. This is one immutable operation input beside the already-required receipt, not a journal: it has no mutable status, timestamps, leases, or transitions. An incumbent is accepted only byte-for-byte. Dry-run does not persist it.

On every invocation, scan only this directory. Parse strictly before selecting. For the requested arc:

1. completed plan+receipt pairs whose normalized head is rescue-aware reachable from current HEAD are exact replay candidates;
2. an incomplete plan is eligible only when current HEAD equals its `expectedHead` or its deterministically prepared `newHead` and its immutable rescue matches;
3. require one unique eligible maximal candidate; malformed, orphaned, or multiple incomparable candidates refuse.

Pass the recovered original plan to `applyHistoryNormalization`; never regenerate messages from today's typed records for completed replay. A completed exact replay returns the existing receipt without rewriting. An unpublished descendant that differs from the receipt's normalized head must obtain a fresh normalization plan; it cannot reuse the older receipt as a prepublication token.

## First publication

A fresh head-bound observation must establish unpublished, PR-absent, and non-green state. Plan through `planHistoryNormalization`; `--apply` persists the immutable plan and calls `applyHistoryNormalization`. The returned receipt is the callable pre-publish token phase 41 consumes. Publication must use its exact `newHead`; any intervening head change requires a fresh observation and plan.

## Published correction policy

Use a separate `PublishedCorrectionPlan`; do not feed published state through the unpublished planner and do not reinterpret the original whole-arc outcomes. The plan compacts only the correction tail into one commit, leaving the original one-per-phase chain byte-for-byte and parent-for-parent intact.

```js
planPublishedCorrections(cwd, {
  arcId,
  priorReceipt,
  head,
}, deps)
// -> {
//   version: 1, kind: 'published-corrections', arcId,
//   priorReceiptDigest, base, expectedHead, expectedTree,
//   corrections: [{ sha, tree, subject, phase, kind }],
//   phaseGates: [{ phase, reviewedHead, digest }],
//   group: { sourceBoundary, message },
//   delivery: { localHead, ref, publishedHead, checksHead, classification },
//   planDigest
// }
```

`priorReceipt` is the latest uniquely reachable completed first-publication or correction receipt. Its `newHead` is `base`; correction counting covers exactly `base..expectedHead`. Require a linear range and at least three tree-changing substantive correction commits. Every row must map uniquely to an actual typed arc phase through the shared classifier. For each affected phase, the latest substantive correction must have the same exact reviewed/gate binding used by task 40.1; state/scratch rows may accompany the range but do not count toward the threshold. Foreign, merge, ambiguous, bookkeeping-only, or unreviewed rows refuse.

The single group uses the last correction commit's tree, which must equal `expectedTree`, and a deterministic correction message derived from the ordered correction rows and their typed phase/task reports. The message lists every source SHA and phase attribution; the normalized outcome is a correction-tail outcome, not another phase outcome. Do not label the collapsed commit as belonging only to the last affected phase. Extend the shared preparation projection with a neutral outcome id/kind if needed while preserving the existing phase-plan API.

Published delivery has two distinct heads:

- `localHead === expectedHead`: the reviewed local correction tip to normalize and push;
- `publishedHead === pullRequest.head === checks.head === expectedOld`: the provider PR/ref tip whose red checks make another push necessary.

The provider observation must establish an existing PR/ref, red required checks at `publishedHead`, a causal or owned-preexisting correction classification, and `pushRequired: true` with `expectedHead` descending from `publishedHead`. Green, pending, unknown, flaky, unrelated, auth, quota, timeout, equal local/published heads without a pending repair, or an incomparable repair head refuses. There is no caller boolean or CLI flag that grants this mode.

One or two proved correction commits return `retained-corrections`; the ordinary delivery owner may push them without rewriting. At the third proved local correction, dry-run returns `published-rewrite-planned` with `{ ref, expectedOld: publishedHead, oldHead: localHead, newHead, correctionCount }`.

On apply, publish the immutable correction plan, create a fresh rescue for `localHead`, prepare one deterministic correction outcome, prove final-tree equality, and CAS local HEAD from `localHead` to `newHead`. After CAS and receipt publication, always obtain a fresh provider observation bound to the actual normalized `newHead`. If the provider ref still equals `publishedHead`, revalidate red checks, causal/owned classification, and push necessity before calling:

```js
replacePublishedHead({ ref, expectedOld: publishedHead, newHead, arcId, planDigest })
// -> { ref, head: newHead }
```

The phase-40 seam is capability-only and has no native `gh` implementation; phase 41 supplies authorized external action. The adapter must implement force-with-lease semantics and attest the resulting exact ref head. If the fresh observation already reports the ref at `newHead`, return exact replay without another replacement call. A still-old lease with newly green or otherwise changed authority refuses even though the ref itself has not moved. Recovery needs no push journal: the immutable correction plan/receipt plus actual provider ref distinguish `publishedHead` (push pending), `newHead` (already replaced), and any other head (lease conflict/refusal). A failed push leaves the local normalized head, fresh rescue, plan, and receipt recoverable and never rolls history back.

## Tests

Inject `inspectDelivery` and `replacePublishedHead`; do not mock or invoke `gh`. Pin default dry-run/no writes, exact base derivation, immutable plan publication only on apply, crash-after-CAS replay from the plan file, completed receipt replay, malformed/orphaned/ambiguous plan refusal, and unavailable provider refusal. For published history, cover one/two retained corrections, third red owned correction dry-run, exact lease replacement, already-replaced retry, lease race, push failure recovery, foreign/merge/unreviewed correction, unrelated or indeterminate red, and green refusal with zero calls to the replacement seam.
