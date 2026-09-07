# NATIVEGREEN39 root migration

Architecture verdict: PROCEED_WITH_FIX. Requested native Sol fallback; exact runtime
unverified. The existing phase36 fallback authorization applies; no Fable call is claimed.

The owner requires the marketplace root and schema in one task39.3 commit. The
plan's batchMode flag does not override that atomic commit requirement.

`planRootMigration(cwd, {to}, deps)` returns a mutation-free canonical plan;
`applyRootMigration(plan, {cwd, ...deps})` consumes that same Git-derived plan.
The plan contains two whole-directory renames, tracked Git modes/blob identities,
and explicit before/after bytes only for active code/config rewrites. All digests
come from actual bytes. Root discovery and schema selection reuse roadmap-root;
post-move imports reuse bridgeImportMany without its cache. Historical documents,
binary artifacts, and schema bytes remain unchanged.

Preflight rejects staged/unstaged changes within the mutation manifest, foreign
untracked or ignored files inside either source, symlinks/special files, changed
HEAD, missing schema, dual roots, and any existing destination. Exactly the local
.arc-mode and .gate runtime paths may accompany the root rename. Unrelated tracked
and untracked dirt remains intact. Before the first rename, publishImmutableFile
claims a worktree-local .building/root-migrations intent, outside the moved roots.
It does not use buildingDir, which names the main checkout's live arc sidecars.

The final receipt is published only after directory moves, exact rewrites, source
manifest checks, fresh discovery, JSON config parsing, and typed record parsing.
Caught failures reverse completed rewrites and renames, verify original bytes,
and remove only newly created empty parents. An uncertain receipt publication or
failed rollback returns recovery-required with retained evidence. An existing
incomplete intent currently refuses mutation; task39.2 owns the supported CLI and
safe interruption reconciliation. A valid completed plan is idempotent.

Independent TDD first failed on the absent module. The first implementation then
exposed an invalid definePhase fixture; the test now verifies its original source
through the actual validator. A binary fixture caught indiscriminate UTF-8 decoding,
which was corrected by restricting rewrite locations. Final configured task gate
000003 passed4/4 tests in34.975 seconds: successful migration, every rename failure,
every rewrite/validation failure, and the preflight refusal matrix. Each fixture
also carries unrelated tracked/untracked dirt, runtime bytes, and historical data.
Raw evidence: .building/nativegreen-39-1-final-task-gate.log; capbuild shard summary
/tmp/capbuild-tests-9pq0sddn/summary.json. No marketplace migration has run yet.

## Task39.2 CLI and interruption recovery

The supported CLI defaults to dry-run and projects paths/outcomes without printing
stored before/after payloads. Apply consumes the same canonical plan and returns
stable JSON/refusal codes. Version2 intents and receipts bind the actual worktree
and Git common directory outside the portable plan digest. An unfinished bound
intent supplies the original plan before fresh root discovery can misread a
partially moved tree. Legacy/unbound, conflicting, or non-prefix state refuses.

One persistent apply.lock is protected by an OS flock held on the parent Node
file descriptor. A short flock helper acquires descriptor3 inherited from that
same open-file description. The descriptor remains open throughout the synchronous
reducer and closes in finally; process death releases the kernel lock. No PID,
age, lease, stale-file deletion, or ownership-reclamation mechanism is used.
Missing flock or unsafe lock capability holds before intent/manifest writes.
The host experiment observed acquisition0, concurrent contention1, and reacquisition0
after closing the parent descriptor; other platforms are not claimed verified.

Under that lock, recovery accepts only an exact prefix of the two directory moves
and ordered before/after rewrites. It skips already completed operations, validates
the destination, and publishes the sole receipt. Existing valid completion returns
already-applied without replay. The independent real-child crash after rename,
CLI resume/replay, live contention, unavailable flock, unbound-intent refusal,
original rollback matrices, and dry-run tests passed10/10 in configured task gate
000005 (43.657 seconds). Raw: .building/nativegreen-39-2-task-gate.log. More complete
interruption/revert ratchets remain task39.5; the marketplace itself has not moved.

## Task 39.3 gate integration

PROCEED_WITH_FIX: the existing scoped runner must admit direct canonical consumer scripts/*.test.mjs as well as plugin tests. All target paths are preflighted before execution; absolute paths, traversal, nested consumer test directories, and symlink escapes stay refused. Keep plugin tests at plugin cwd and consumer tests at repository cwd, preserving the shared capbuild execution policy. Schema runs only after both Node groups pass. No wrapper, second acceptance filter, or config exception. Independent test engineer reproduced the rejected valid consumer test before implementation.

## Task39.4 historical recovery

PROCEED_WITH_FIX: live workflow metadata, phase execution, backlog mutation and migration audit use the existing root/schema resolvers. Historical native recovery resolves exactly one marked root and its root-first schema in the original Git tree, rejects nonregular source entries, and materializes unchanged phase/arc/schema/config bytes at their original relative locations in one exclusive ephemeral local .building directory. Batch import uses the existing typed bridge without cache; finally removes the exact temporary tree. No current schema substitution, source rewriting, persistent snapshot store or extra worktree. A missing dependency or invalid original source remains a named originalSource hold, never empty criteria. Independent tests first reproduced attempted historical import under the retired root and the audit's false NO SCHEMA diagnosis.

## Task39.5 stored history and runtime reapply

PROCEED_WITH_FIX: validate stored plans against their versioned shape, fixed mappings, codecomputed digest/byte integrity and original Git manifest, never today's rewrite algorithm. Completed bound intent/receipt pairs are immutable historical evidence; current layout checks establish one selected root and one active schema owner without claiming unchanged historical bytes. Only one incomplete intent may resume an exact recorded prefix. Completed history does not block a new migration after Git revert.

For runtime-only revert leftovers, version2 adds runtimeParking.entries with only .arc-mode/.gate tree identities. The existing lock and intent own an atomic whole-directory park at the plan-specific runtime path, the existing two root/schema renames and rewrites, then an exact per-entry restore prefix and empty-directory cleanup. Resume verifies unique owners and recorded identities; rollback reverses restored runtime, migration operations and parking. No new journal/store or filesystem exchange is introduced. Any foreign destination entry or source runtime collision refuses without overwrite. Version1 historical plans remain valid.

## Curation compatibility at phase closure

PROCEED_WITH_FIX: completed migration ancestry follows the finite existing curate-rescue histories. Each rescue tip bridges into a reachable history only through an equal full-tree boundary; memoized traversal reaches a fixed point. The same relation selects one maximal completed migration. Missing links, malformed refs and incomparable owners refuse; no new history store or receipt rewrite. This preserves completion through phase-local and later whole-arc normalization. Curation omits model attribution when neither execution nor review records name a model. Focused migration/curation checks and a fresh independent review cover this bounded post-full-gate repair.
