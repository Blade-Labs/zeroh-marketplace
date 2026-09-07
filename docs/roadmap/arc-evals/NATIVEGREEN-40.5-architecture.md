# NATIVEGREEN 40.5 architecture — independently joined worktree ownership

**Decision: PROCEED_WITH_FIX.** Extend the existing worktree-slot registry and Codex journal with one shared identity. Ownership exists only when both durable records independently parse and agree with live Git. Legacy and user-provided worktrees remain usable but unowned.

## Identity contract

```js
RoadmapWorktreeIdentity = {
  version: 1,
  ownershipId: '<lowercase UUID>',
  repository: '<realpath of main checkout>',
  gitCommonDir: '<realpath of git common directory>',
  worktree: '<realpath of worktree>',
  gitAdminDir: '<realpath of worktree git admin directory>',
  branch: 'refs/heads/<exact-name>' | null,
  laneOwner: { kind: 'roadmap-codex', id: '<run|plan|review>:<phase ids>' },
}
```

Derive every path and branch from actual Git after `git worktree add`: `mainCheckout`/Git toplevel, `rev-parse --git-common-dir`, `rev-parse --absolute-git-dir`, and `symbolic-ref -q HEAD`. Resolve existing paths canonically and reject symlinks, absent paths, a different common directory, an unregistered worktree, malformed UUID, branch disagreement, or lane-owner disagreement. Run and plan expect their exact full branch ref; review expects detached `null`.

The UUID is minted once for a newly launcher-created allocation and reused on its relaunches. It is unrelated to PID, session ID, branch name, directory prefix, phase number, or journal filename.

## Registry compatibility and APIs

The canonical `.building/worktree-slots.json` becomes:

```json
{"version":2,"slots":[],"identities":[]}
```

The existing tolerant array, `{slots:[...]}`, and slot-keyed-map inputs still parse. They project their existing slot rows and an empty identity collection; they never imply ownership. Every slot or identity mutation runs under the existing registry lock and writes the canonical wrapper while preserving the other collection. `listSlots` remains a slots projection.

Export from `worktree.mjs`:

```js
createWorktreeIdentity(root, worktree, {
  ownershipId = randomUUID(), laneOwner, expectedBranch,
}) // -> validated identity; no write

registerWorktreeIdentity(root, identity)
// -> { status: 'registered' | 'existing', identity }

removeWorktreeIdentity(root, identity)
// -> true only when the exact registered bytes were removed; false when absent

resolveWorktreeOwnership(root, journal)
// -> { state: 'owned', identity }
//  | { state: 'unowned', reason }
```

Registration is idempotent only for the same UUID and identical binding. Duplicate UUIDs, the same worktree under another UUID, or the same Git admin directory under another identity refuse. Removal is an exact compare-and-remove; it never removes a changed row. Resolution strictly parses the journal identity and registry identity separately, then requires byte-equivalent fields plus fresh repository/worktree/common-dir/git-admin/branch probes. Either record alone, copied bytes in another checkout, or any mismatch returns unowned.

## Journal contract

Every newly owned run, plan, or review journal contains:

```js
worktreeIdentity: RoadmapWorktreeIdentity
```

Add it to the strict journal identity/completion binding. The existing `laneOwner` remains and must equal `worktreeIdentity.laneOwner`; do not introduce another owner vocabulary. Journal parsing continues accepting legacy journals without this field for status/restart compatibility, but ownership resolution returns unowned. A journal never upgrades an existing explicit worktree into registry ownership.

Use the atomic journal writer for all three lanes before native execution. Subsequent journal updates must preserve the exact identity; changing or dropping it is a corruption refusal.

## Allocation and launch order

For each run, plan, and review lane:

1. Complete request, governance, base, duplicate-live, and installer-availability preflight.
2. Create the worktree if absent. A worktree that existed before this invocation is user/legacy supplied unless an exact registry identity already exists; never mint or register a new identity for it.
3. For a newly created worktree, mint one UUID, derive the live binding, and register it. For an existing owned worktree, load and freshly validate the exact registered identity and lane owner. Existing unowned worktrees may follow current launch behavior but their journal omits `worktreeIdentity`, so GC can never select them.
4. Perform installer and named carry-in work. These files may make a freshly created worktree nonempty and are preserved on every later failure.
5. Start the existing supervisor as an inert detached process for all lanes, including run. It may hold the process-group identity but may not spawn the native model yet.
6. Atomically write the complete journal with supervisor PID and the identity, then signal the existing ready/IPC barrier.
7. The supervisor re-reads the journal, validates launch ID/PID/request plus `resolveWorktreeOwnership`, and only then spawns the native child. A test-only `beforeNativeLaunch({ journal, identity })` hook may observe this boundary; it cannot override a refusal.

Generalize the current `__supervise` owner rather than creating another process manager. Preserve lane-specific behavior: run may resume a changed working head according to its existing rules; plan/review retain exact requested-head checks; labels remain part of run journal-path resolution; report and completion handling remain lane-specific. The supervisor and native child share the detached process group so existing liveness semantics remain valid.

## Failure and unwind

No native child starts unless journal and registry already match.

If registration succeeds but any later step before a durable journal/ready signal fails, call `removeWorktreeIdentity(root, exactIdentity)`. If exact removal cannot be proved, stop and leave the row plus worktree for inspection; the missing journal means it is unowned. If journal publication fails, perform the same exact identity removal and do not signal the supervisor. If the supervisor cannot start, exits before readiness, rejects the join, or cannot be signalled, do not launch a native child; retain any matching journal/identity as recoverable evidence or remove only records whose exact bytes this invocation can prove it wrote.

Never force-remove the worktree during unwind. Dependency installers, carry-in files, generated files, or concurrent unknown files make directory deletion unsafe. A newly created but unowned orphan is visible to later inventory and remains ineligible for GC until a future explicit owner flow proves it; task 40.5 does not adopt it.

## Tests

Cover all three lanes with a native-spawn counter pinned at zero until both records exist and agree. Exercise UUID, repository, common-dir, worktree, git-admin, branch/detached, and lane-owner mismatches independently; copied identities; registry-only and journal-only evidence; duplicate UUID/worktree/admin rows; legacy registry shapes; identity preservation across slot writes and journal completion updates; run labels; changed-head run resume; exact-head plan/review; registration, install, journal, supervisor-ready, and signal failures; and exact unwind that preserves every installer/carry-in/unknown file. Prove an existing explicit worktree is never automatically registered and resolves unowned.

## Bounded implementation review corrections

The independent architect required the supervisor to refuse an identity-less journal whenever the worktree has any registry identity. Only a genuinely unregistered existing worktree may take the legacy path; the same lookup repeats at the final launch boundary.

The registry lock now uses a kernel-held `flock` on an inherited descriptor, with bounded contention waiting and no age/PID deletion. Missing capability refuses before registry mutation. Registry reads and writes require a canonical directory and a regular non-symlink record. Publication uses a random exclusive no-follow temporary file, file fsync, atomic rename and directory fsync. The lock is never unlinked during release, including after a crash.

The independent architect approved the final omission barrier, kernel mutex, and registry publication corrections. The launcher detaches its supervisor handle after successful journal/IPC handoff so the CLI returns while native work continues.
