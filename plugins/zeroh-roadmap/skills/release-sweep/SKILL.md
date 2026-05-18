---
name: "Release Sweep"
description: "Review and resolve outstanding debts for a release version, then optionally archive the version's done phases. Run before every minor/major; optional before patches. Patch releases are never blocked on debts; archive is."
user-invocable: true
metadata:
  keywords: release, sweep, archive, debt, version, cleanup, ship
  aliases: archive-version, debt-sweep
---

# Release Sweep — Resolve Debts and Archive a Version

## Trigger

User says: `release-sweep`, `release-sweep v0.7.0`, `release-sweep v0.7.0 --archive`, `archive v0.7.0`, `sweep debts`.

## Arguments

```
release-sweep [<version>] [--archive]
```

- `<version>` — `v0.7.0`-style tag. If omitted, prompt the user (do NOT guess from `package.json` — the version you're sweeping may not be the current one).
- `--archive` — after resolution, move all done phases with `version: <version>` into `roadmap/archive/<version>/`. Refuses if any open debt remains. Without this flag, the skill is review-only.

## PRIME RULE: ARCHIVE GATES ON CLEAN DEBTS

**Release does NOT gate on debts.** A phase can ship with open debts on a patch, a minor, or even a major if the operator explicitly chooses — release-sweep does not block any release.

**Archive DOES gate on debts.** Once a phase is in `roadmap/archive/<version>/`, the operator commits to never revisiting its open debts. So archive requires every `debts[i].status === 'open'` to be resolved (`resolved` or `accepted`) first.

**Recommended timing** (operator choice — none of these are enforced):
- **Patch release** (0.7.0 → 0.7.1) — sweep is *optional*. Patches commonly close debts from prior releases; a quick sweep against the prior minor is the natural moment. Never required.
- **Minor release** (0.7.0 → 0.8.0) — sweep is *recommended*. Debts accumulated over the minor's lifetime are still in operator memory.
- **Major release** (0.7.0 → 1.0.0) — sweep is **strongly recommended before archive**. Shipping a major commits to a public-API surface; archive is the discipline that prevents shipping rot with it.

## Protocol

### Step 1: Locate done phases for the version

```bash
# Lists phase numbers + their debts count
grep -lE "version: ['\"]<version>['\"]" roadmap/phases/*.phase.ts \
  | xargs -I{} sh -c 'echo "{}:"; grep -E "status:|debts:" "{}" | head -3'
```

If zero phases match, surface and stop: "No done phases tagged `version: <version>`. Nothing to sweep."

### Step 2: Aggregate open debts

For each matched phase file, read `debts: [...]` and collect every entry with `status: 'open'`. Output a single grouped list, ordered by phase number:

```
Open debts for <version> (M phases, N open debts):

Phase 467 — Currency mode picker
  [467.d1] HARDCODED 1000ms poll interval in lib/services/sync.ts:42 —
           needs config registry. (added by task 467.5)

Phase 472 — Notification ratchet
  [472.d1] LIMITATION: NOT-ON-CALL bypass not implemented for SSB role;
           policy says role is "best-effort" only. (added by task 472.3)
```

`[<phase>.dK]` is a synthetic ID: `K` is the 1-based index into `debts[]`. Use it to refer to a specific debt in subsequent prompts.

### Step 3: Resolve each open debt (interactive)

**Do NOT auto-resolve.** Every debt needs an operator decision. For each item, ask:

> **`[467.d1]` HARDCODED 1000ms poll interval ...** — how do you want to close it?
> - **(f)** Fix inline now (I'll patch and you commit; debt closed `resolved` via that commit SHA)
> - **(p)** Plan a new phase to fix it properly (invokes `/plan-phase`; debt closed `resolved` via the new phase ref)
> - **(a)** Accept (provide a written reason, ≥20 chars; debt closed `accepted`)
> - **(k)** Keep open (do nothing; debt stays — blocks archive for this version)
> - **(s)** Skip to next debt (decide later)

**Implementation notes for each choice:**

- **(f) Fix inline.** Invoke `/zeroh-roadmap:software-architect` first with the debt note + relevant files to get the proper-solution blueprint. Apply the fix, run the validation gate appropriate to the phase's `kind`, commit, then update `phase.debts[K]` to `{ status: 'resolved', via: '<commitSHA>', resolvedDate: 'YYYY-MM-DD' }`. Commit the schema update separately: `docs(roadmap): phase N — close debt dK (resolved by <SHA>)`.
- **(p) Plan a new phase.** Invoke `/zeroh-roadmap:plan-phase <debt note>` so the new phase carries the same `version` tag as the debt (or the *next* version if the user prefers — confirm). After the new phase commits, update `phase.debts[K]` to `{ status: 'resolved', via: 'phase-<N>', resolvedDate: 'YYYY-MM-DD' }`.
- **(a) Accept.** Capture a substantive reason (≥20 chars; the schema refinement rejects shorter values). Update `phase.debts[K]` to `{ status: 'accepted', via: '<reason>', resolvedDate: 'YYYY-MM-DD' }`. Commit: `docs(roadmap): phase N — accept debt dK (<short reason summary>)`.
- **(k) Keep open.** Note in the sweep summary that this debt remains open. If `--archive` was requested, archive will fail until this debt is resolved.
- **(s) Skip.** Move to next.

### Step 4: Summary

After processing all debts, output:

```
Sweep complete for <version>:
  Resolved (inline fix):   X
  Resolved (new phase):    Y
  Accepted:                Z
  Still open:              W

[If W > 0 and --archive was requested:]
  Archive refused — W debt(s) still open. Re-run release-sweep <version> --archive
  after resolving the remaining items.

[If W == 0 and --archive was requested:]
  All debts clean. Proceeding to archive.
```

### Step 5: Archive (only if `--archive` and W == 0)

```bash
mkdir -p roadmap/archive/<version>
git mv roadmap/phases/phase-{N}.phase.ts roadmap/archive/<version>/phase-{N}.phase.ts
# repeat for each done phase with version: <version>
```

Commit: `chore(roadmap): archive <version> — N phases moved to roadmap/archive/<version>/`.

After the move:
- `audit-roadmap` must read both `roadmap/phases/` and `roadmap/archive/**/` (open work in mind: update audit-roadmap separately when this skill first lands).
- `reviews/changelog.json` remains the canonical queryable index — archived phases stay in changelog with their `archivePath` recorded.
- Debt fields are preserved on the archived files; `accepted` items remain visible for future auditors.

## Edge Cases

- **Phase has `debts: []` or no `debts` field.** No open debts — nothing to resolve. Eligible for archive immediately when `--archive` is passed.
- **Phase has `version: undefined`.** Skipped (the version field is the partition key). Output a warning: "Phase N has no version — assign before sweeping."
- **Debt resolution introduces new debts.** Possible if the inline fix surfaces an architectural issue. The new debt is appended to the *same* phase's `debts[]` with `status: 'open'`. Sweep continues; the new debt joins the next pass.
- **User aborts mid-sweep.** Any debts already updated stay updated (committed individually). Re-running the skill resumes from the remaining `open` items.

## What this skill does NOT do

- It does NOT modify the version of any phase. Versioning is set during plan-phase / review-phase, not here.
- It does NOT run validation gates on archived phases. Gates already ran when the phase was done; archive is a move, not a re-validation.
- It does NOT enforce any release timing. The operator decides when to sweep and when to archive — this skill only enforces the *archive is gated on clean debts* invariant.
- It does NOT cancel or remove phases — only `cancelled` status does that, and that's not a debt resolution.

## Boilerplate compromise

If you're tempted to write a "summary" or "report" file (`reviews/v{X}-debt-sweep.md`) as part of this skill — don't. The phase files ARE the audit trail; `debts[]` with `status` + `via` + `resolvedDate` carries everything an auditor needs. A separate markdown file drifts.
