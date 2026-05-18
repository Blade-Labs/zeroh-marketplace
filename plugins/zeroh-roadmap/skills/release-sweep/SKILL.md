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
# Lists matching phase files
grep -lE "version: ['\"]<version>['\"]" roadmap/phases/*.phase.ts
```

If zero phases match, surface and stop: "No done phases tagged `version: <version>`. Nothing to sweep."

### Step 2: Aggregate open debts (join transparency reports × debtResolutions)

For each matched phase file, read `tasks[].transparencyReport` for every task. An entry is a **candidate debt** if:
- `transparencyReport.compromises !== "None"`, OR
- `transparencyReport.hardcoded !== "None"`, OR
- `transparencyReport.skipped !== "None"`, OR
- `transparencyReport.limitations !== "None"`

For each candidate, compose `ref = "<task.id>.<field>"` (e.g. `"467.5.hardcoded"`). The debt is **open** if no entry in `phase.debtResolutions` has a matching `ref`.

Output the open set grouped by phase, ordered by phase number:

```
Open debts for <version> (M phases, N open debts):

Phase 467 — Currency mode picker
  [467.5.hardcoded]    1000ms poll interval in lib/services/sync.ts:42 —
                       needs config registry.
  [467.3.compromises]  Switched to USD-only — exchange rate API blocked.

Phase 472 — Notification ratchet
  [472.3.limitations]  NOT-ON-CALL bypass not implemented for SSB role;
                       policy says role is "best-effort" only.
                       ⚠ Field discipline check: contains "deferred" /
                         "until X ships" / "pre-pilot acceptable"? If yes,
                         the planner used the wrong field — this is
                         compromise disguised as limitation. Consider
                         re-classifying the resolution accordingly.
```

The `ref` (`<taskId>.<field>`) IS the synthetic ID — use it verbatim in subsequent prompts. No separate `dK` indexing.

**Sanity check before prompting:** if a `phase.debtResolutions[i].ref` points to a transparency-report entry that is `"None"` (or doesn't exist), surface as a schema-drift warning. The release-sweep does not auto-repair drift — flag and continue.

### Step 3: Resolve each open debt (interactive)

**Do NOT auto-resolve.** Every debt needs an operator decision. For each item:

> **`[467.5.hardcoded]` 1000ms poll interval in lib/services/sync.ts:42 — needs config registry.**
>
> How do you want to close it?
> - **(f)** Fix inline now (I'll patch and you commit; closed `resolved` via that commit SHA)
> - **(p)** Plan a new phase to fix it properly (invokes `/plan-phase`; closed `resolved` via new phase ref)
> - **(a)** Accept (provide a written reason ≥20 chars; closed `accepted`)
> - **(i)** Informational (this was never debt — permanent design constraint or a note logged in the wrong field; closed `informational`, optional one-line `via` note)
> - **(k)** Keep open (do nothing; blocks archive for this version)
> - **(s)** Skip to next (decide later)

**Implementation per choice (each appends ONE entry to `phase.debtResolutions[]`):**

- **(f) Fix inline.** Invoke `zeroh-roadmap:software-architect` (foreground, synchronous) with the debt text + relevant files to get the proper-solution blueprint. Apply the fix, run the validation gate appropriate to the phase's `kind`, commit. Then append `{ ref: '<ref>', status: 'resolved', via: '<commitSHA>', date: 'YYYY-MM-DD' }` to `phase.debtResolutions`. Commit the schema update separately: `docs(roadmap): phase N — close debt <ref> (resolved by <SHA>)`.
- **(p) Plan a new phase.** Invoke `/zeroh-roadmap:plan-phase <debt text>` — new phase carries the same `version` (or the *next* version if the user prefers; confirm). After the new phase commits, append `{ ref, status: 'resolved', via: 'phase-<N>', date }`. Commit: `docs(roadmap): phase N — close debt <ref> (resolved by phase-<N>)`.
- **(a) Accept.** Capture a substantive reason (≥20 chars; schema rejects shorter). Append `{ ref, status: 'accepted', via: '<reason>', date }`. Commit: `docs(roadmap): phase N — accept debt <ref> (<short summary>)`.
- **(i) Informational.** Append `{ ref, status: 'informational', via: '<optional one-liner>' (omit if obvious), date }`. Commit: `docs(roadmap): phase N — close debt <ref> (informational)`. **Operator-facing nudge:** if more than half of a phase's resolutions are `informational`, suggest revising the planner's transparency-report field-meaning discipline — most debts should be `resolved` or `accepted`, not waved through.
- **(k) Keep open.** No append. Note in summary. Blocks archive.
- **(s) Skip.** Move on.

### Step 4: Summary

After processing all debts, output:

```
Sweep complete for <version>:
  Resolved (inline fix):       X
  Resolved (new phase):        Y
  Accepted:                    Z
  Informational:               I
  Still open:                  W

[If I/(X+Y+Z+I) > 0.5, surface:]
  ⚠ Informational ratio is {I}/{total} ({pct}%). Likely planner field-meaning
    drift (deferred work logged in `limitations` instead of `compromises` /
    `skipped`). Consider tightening discipline before the next minor.

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
- `audit-roadmap` reads both `roadmap/phases/` and `roadmap/archive/**/` (see audit-roadmap SKILL.md — covers archive integrity as its own check).
- `reviews/changelog.json` remains the canonical queryable index — archived phases stay in changelog with their `archivePath` recorded.
- Transparency reports and `debtResolutions` are preserved on the archived files; `accepted` and `informational` items remain visible for future auditors.

## Edge Cases

- **Phase has no non-`"None"` transparency entries.** Zero candidate debts — nothing to resolve. Eligible for archive immediately when `--archive` is passed.
- **Phase has `version: undefined`.** Skipped (version is the partition key). Output a warning: "Phase N has no version — assign before sweeping."
- **`debtResolutions` ref doesn't match any transparency entry.** Surfaced as schema-drift warning; sweep does not auto-repair. Likely cause: a transparency report was edited post-hoc; the ref no longer resolves. Operator should fix manually.
- **Resolution introduces new compromises.** Possible if an inline fix forces its own trade-off. The new compromise goes into the *fix commit's* transparency report (which lives on the FIX'S phase, possibly a new one). It does NOT retroactively reopen this phase's debt — that debt is closed by `via: <commitSHA>`, and the new compromise is tracked on its own phase.
- **User aborts mid-sweep.** Per-resolution commits land independently. Re-running the skill resumes from the remaining open debts.

## What this skill does NOT do

- It does NOT modify the version of any phase. Versioning is set during plan-phase / review-phase, not here.
- It does NOT run validation gates on archived phases. Gates already ran when the phase was done; archive is a move, not a re-validation.
- It does NOT enforce any release timing. The operator decides when to sweep and when to archive — this skill only enforces the *archive is gated on clean debts* invariant.
- It does NOT cancel or remove phases — only `cancelled` status does that, and that's not a debt resolution.

## Boilerplate compromise

If you're tempted to write a "summary" or "report" file (`reviews/v{X}-debt-sweep.md`) as part of this skill — don't. The phase files ARE the audit trail; `debts[]` with `status` + `via` + `resolvedDate` carries everything an auditor needs. A separate markdown file drifts.
