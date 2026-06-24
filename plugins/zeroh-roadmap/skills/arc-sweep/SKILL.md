---
name: "Arc Sweep"
description: "Pre-merge sweep for a built arc: dispose every accumulated compromise (reusing release-sweep's debt vocabulary) and run one whole-arc software-architect review against the arc's singleSeams, then report merge-readiness."
user-invocable: true
metadata:
  keywords: arc sweep, pre-merge sweep, sweep arc
  aliases: pre-merge-sweep
---

# Arc Sweep — Pre-Merge Debt + Whole-Arc Review

`arc-sweep` is the closing ritual of `do-arc` (phase 858): after an arc's phases are built but before merge, it (1) disposes every accumulated debt item and (2) runs ONE architect over the whole-arc diff judged as a single system. It then reports merge-readiness and holds the merge for the user's go.

**Read `skills/release-sweep/SKILL.md` FIRST.** arc-sweep reuses release-sweep's debt-disposition vocabulary and `debtResolutions[]` persistence verbatim — it does NOT invent a parallel taxonomy.

## When it runs vs release-sweep

arc-sweep runs **pre-merge**, on an unversioned, unarchived arc, aggregating the in-context `PhaseExecutionResult` roll-ups. release-sweep runs **pre-archive**, on versioned phases. Different trigger, **same persistence target** (`debtResolutions[]`). arc-sweep is NOT `full-code-review` (the 8-agent pre-prod audit) — it is a lighter, seam-specific architect pass.

## Step 1: Consolidated debt sweep

### Hand-in contract (the inputs)

`PhaseExecutionResult` (phase 855) is a typed roll-up. arc-sweep gets it two ways, in priority order:
1. **In-context hand-in (the fast path):** `do-arc` (858 Step 6) hands in the array it accumulated as the arc ran. Use it when present and complete.
2. **Durable fallback (`discoverResults()`):** each phase-executor persists its roll-up to `phase.executionResult` (do-phase arc-mode Step 5), so `discoverResults()` re-reads them from `roadmap/phases/phase-<n>.phase.ts`. **If the in-context array is missing or short** — a resumed arc, or context that compacted mid-run — reconstruct from `discoverResults()` rather than disposing a truncated set. The in-context array is an optimization; the persisted field is the system of record.

The free-text `compromises` strings are also persisted on the phase files and are **re-read** from there. Aggregate all of it: the structured roll-ups (in-context, or via `discoverResults()`) plus the free-text strings.

### Dispose each item (release-sweep's vocabulary, NOT a new one)

For each debt item, prompt the user. The three code-disposition outcomes each persist exactly one `debtResolutions[]` entry on the owning phase — the same shape release-sweep writes (`{ ref: '<taskId>.<field>', status, via, date }`). OPERATOR-PENDING is the exception: it writes NO entry (the schema's `status` enum is `'fixed' | "won't_fix" | 'dismissed'` — there is no fourth value).

- **RESOLVE-NOW** == release-sweep **(f) Fix inline** → invoke `zeroh-roadmap:software-architect` for the proper-solution blueprint, apply, re-gate to the phase's `kind`, commit → append `{ ref, status: 'fixed', via: '<commitSHA>', date }`.
- **PLAN-PHASE** == release-sweep **(p) Plan a new phase** → invoke `zeroh-roadmap:plan-phase` by name with the debt text; after the new phase commits, append `{ ref, status: 'fixed', via: 'phase-<N>', date }`.
- **ACCEPT** == release-sweep **(w) Won't fix** (substantive reason ≥20 chars → `status: "won't_fix"`) **or (d) Dismiss** (never-was-debt → `status: 'dismissed'`).
- **OPERATOR-PENDING** — the ONE genuinely new disposition with no release-sweep equivalent: a required **deploy/operator action, not a code change** (a pre-merge arc operates on an unversioned arc, so some items are "do this at deploy" rather than "fix in code"). It has no schema `status` and writes NO `debtResolutions[]` entry — it is carried only in the Step-3 ephemeral report's deploy-actions section for the operator to run at deploy (cf. release-sweep `(k) Keep open` → no append). The item stays an open debt on the phase until a later release-sweep disposes it post-deploy.

`ref`/`status`/`via`/`date` semantics, the ≥20-char `won't_fix` reason, and the dismissed-ratio nudge are all release-sweep's — do not redefine them here.

**No summary file.** Like release-sweep (its SKILL.md "the phase files ARE the audit trail" rule), arc-sweep NEVER writes a persisted summary/report file. `debtResolutions[]` + the transparency reports it points to are the durable audit trail; the merge-readiness report (Step 3) is an EPHEMERAL chat report only.

## Step 2: Whole-arc cross-phase review (against singleSeams)

A per-phase gate sees only its own diff — it CANNOT catch a seam that one phase quietly forked from another (3 hardcodes that should have been 1 config; a shared type two phases each redefined; a read-back path one consumer re-implemented). **Only a whole-arc view catches a forked seam.** That is this step's whole job.

Run ONE `zeroh-roadmap:software-architect` over **`git diff <arc.baseRef>..HEAD`** (the arc's full diff, `baseRef` from the Arc entity, 855) and judge it as **a single system** against `arc.singleSeams` (the "hold these single" invariants): for each seam, did any consumer fork it, or is it genuinely a single implementation across the whole arc?

- Apply any **RESOLVE-NOW** fixes the architect identifies, and **re-gate each** to its phase's `kind` (a fix is not done until it re-passes the gate).
- Author **PLAN-PHASE** follow-ups (via `zeroh-roadmap:plan-phase`) for real debt that should not block this merge.

## Step 3: Report merge-readiness (ephemeral) and hold the merge

Emit a merge-readiness report **to chat only** (never a file — see the no-summary-file rule above). It aggregates:
- **Per-phase gate status** — every member phase is `done` with a passing gate.
- **Debt dispositions** — the Step-1 roll-up: counts by `RESOLVE-NOW` / `PLAN-PHASE` / `ACCEPT` (won't_fix/dismissed) / `OPERATOR-PENDING`, with the `debtResolutions[]` refs written by the three code dispositions (OPERATOR-PENDING writes none — list its items in the deploy-actions bullet below instead).
- **Whole-arc architect verdict** — the Step-2 seam judgment (single vs forked) and any RESOLVE-NOW fixes applied + re-gated.
- **Overall** — full green / blocked, and any OPERATOR-PENDING deploy actions the operator must take.

**Hold the merge for an explicit user go** — arc-sweep never merges on its own. On the user's go, the merge proceeds per the report (and any OPERATOR-PENDING actions are the operator's to run at deploy); until then the arc sits built-and-swept on its branch.
