---
name: "Release Sweep"
description: "Review and resolve outstanding debts for a release version, then optionally archive the version's done phases. Run before every minor/major; optional before patches. Patch releases are never blocked on debts; archive is."
user-invocable: true
metadata:
  keywords: release, sweep, archive, debt, version, cleanup, ship
  aliases: archive-version, debt-sweep
---

# Release Sweep — Resolve Debts and Archive a Version

**Trigger:** `release-sweep`, `release-sweep 0.7.0 [--archive]`, `archive 0.7.0`, `sweep debts`.

```
release-sweep [<version> | --arc <id> | --all-done] [--archive]
```

- `<version>` — bare semver `^\d+\.\d+\.\d+$` (no `v` prefix; the archive dir mirrors it:
  `roadmap/archive/0.7.0/`). Omitted with no other selector → prompt (never guess from `package.json`).
- `--arc <id>` — ALTERNATIVE SELECTOR: sweep done phases whose `arcId` matches, regardless of version.
  Exists because most consumers don't version-stamp phases (one estate: 23 tagged of 1,445); the arc is
  their natural debt unit. Archive → `roadmap/archive/arc-<id>/`.
- `--all-done` — ALTERNATIVE SELECTOR: sweep EVERY done/historical phase (the estate sweep). Pair with
  the CLI: **`roadmap debt census`** derives the joined open-debt ledger first, **`roadmap debt dispose`**
  lands decided resolutions in bulk — so the per-phase protocol below is reserved for entries a human
  actually reasons about. Archive groups by version when tagged, else `roadmap/archive/untagged/`.
- `--archive` — after resolution, `git mv` the selected `done` phases into their archive dir. Refuses if
  any open debt remains. Without it, review-only.

> **Estate scale:** run `roadmap debt census` first and work from its ledger; **`roadmap debt check`** is
> a CI ratchet against a committed ceiling. See the `roadmap debt` help for contracts.

## PRIME RULE: ARCHIVE GATES ON CLEAN DEBTS

**Release does NOT gate on debts** — a phase can ship with open debts on any release if the operator
chooses; release-sweep blocks no release. **Archive DOES gate.** Once a phase is in
`roadmap/archive/<version>/` the operator commits to never revisiting its open debts, so archive requires
every candidate debt (a non-`"None"` transparency-report entry) to have a matching `debtResolutions[].ref`
with a CLOSING status. "Open" = no matching ref, **OR** a matching entry still open (the 1371 contract):
`'planned'` is open until its `via: 'phase-<N>'` phase is `done`; `'operator-pending'` is open until this
sweep disposes it post-deploy (that disposition REPLACES the entry — one ref, latest wins). Archive stays
blocked on both. Timing is operator choice (none enforced): patch = optional, minor = recommended, major =
strongly recommended before archive.

## Protocol

### Step 1 — Locate done phases
Find the version's phase files (`roadmap debt census` slices this, or `grep -lE "version:
['\"]<version>['\"]" roadmap/phases/*.phase.ts`) and **filter to `status: 'done'` only**. Surface a
non-done match as a warning and EXCLUDE it (prevents `--archive` from `git mv`-ing in-progress/backlog
phases out of the active queue). Zero done matches → surface and stop.

### Step 2 — Aggregate open debts (join transparency reports × debtResolutions)
This join IS `roadmap debt census` (reuse it, don't re-derive). A **candidate debt** is any task whose
`transparencyReport.{compromises,hardcoded,skipped,limitations} !== "None"`; its `ref = "<task.id>.<field>"`.
Open per the PRIME RULE (no closing ref, or a still-open `planned`/`operator-pending`). Output grouped by
phase, ordered by number; the `ref` IS the synthetic id, used verbatim in prompts. **Field discipline:** a
debt on `limitations` matching a deferred-work pattern (per `schema.ts` `TransparencyReportShape` doc) gets
a "compromise-disguised-as-limitation — consider re-classifying" note. A `debtResolutions` ref pointing at a
`"None"`/absent entry is a schema-drift warning (flag, never auto-repair).

### Step 3 — Resolve each open debt (interactive; do NOT auto-resolve)
Each item gets an operator decision; each choice appends ONE `debtResolutions[]` entry
(`{ ref, status, via, date }`) + its own commit:
- **(f) Fix inline** — invoke `zeroh-roadmap:software-architect` for the proper-solution blueprint, apply,
  run the phase-`kind` gate, commit → `status: 'fixed', via: '<commitSHA>'`.
- **(p) Plan a new phase** — `/plan-phase <debt>` (same version, or the next if the user prefers); after it
  commits → `status: 'planned', via: 'phase-<N>'` (open until that phase is `done` — schema.ts's
  planned-is-open rule; `'fixed'` only when the work exists).
- **(w) Won't fix** — substantive reason ≥20 chars (schema rejects shorter) → `status: "won't_fix", via: '<reason>'`.
- **(d) Dismiss** — never-was-debt → `status: 'dismissed', via: '<optional one-liner>'`. **Nudge:** if
  >half a phase's resolutions are `dismissed`, suggest tightening transparency-report field discipline.
- **(k) Keep open** — no append; blocks archive. **(s) Skip** — decide later.

### Step 4 — Summary
Report counts (fixed inline / fixed new-phase / won't_fix / dismissed / still-open). If the dismissed ratio
> 0.5, surface the field-meaning-drift warning. If open debts remain and `--archive` was requested, refuse
archive naming the count; if clean, proceed.

### Step 5 — Archive (only if `--archive` and zero open) — the git-mv mechanics (PROSE-carried; NOT in `roadmap debt`)
```bash
mkdir -p roadmap/archive/<version>
for N in <phase-numbers>; do
  src="roadmap/phases/phase-${N}.phase.ts"; dst="roadmap/archive/<version>/phase-${N}.phase.ts"
  if [ ! -f "$src" ] && [ -f "$dst" ]; then echo "Already archived: phase-${N}"; continue; fi   # re-runnable skip guard
  if [ -f "$src" ] && [ -f "$dst" ]; then echo "CONFLICT: both exist — investigate"; exit 1; fi  # conflict is FATAL, never overwrite
  git mv "$src" "$dst"
done
```
The skip-if-already-archived guard makes `--archive` **re-runnable** (a Ctrl-C'd partial archive resumes on
re-invoke); a both-paths-exist conflict is **fatal** and demands manual investigation. Commit:
`chore(roadmap): archive <version> — N phases moved`. After the move: `roadmap audit` covers archive
integrity (checks 12.3/12.4 join the archive census); transparency reports +
`debtResolutions` are preserved on the archived files (`won't_fix`/`dismissed` stay visible to auditors).

## Edge cases + scope
- No non-`"None"` entries → zero debts, archive-eligible immediately. `version: undefined` → skipped
  (version is the partition key); warn. A version match that isn't `done` → excluded (Step 1). A
  `debtResolutions` ref matching no entry → schema-drift warning (no auto-repair). An inline fix that forces
  its own trade-off → the new compromise lands on the FIX's phase, never reopening this closed debt. User
  aborts → per-resolution commits are independent; re-run resumes; `--archive` is idempotent (Step 5 guards).
- **Does NOT:** change a phase's version (that's plan/review-phase); run gates on archived phases (archive is
  a move, not re-validation); enforce release timing; cancel/remove phases.

**No summary file.** The phase files ARE the audit trail — `debtResolutions[]` + the transparency reports it
points to carry everything an auditor needs; a separate `reviews/<version>-debt-sweep.md` drifts. Don't write one.
</content>
