---
name: "Arc Sweep"
description: "Pre-merge sweep for a built arc: dispose every accumulated compromise (reusing release-sweep's debt vocabulary) and run one whole-arc software-architect review against the arc's singleSeams + designRefs, then report merge-readiness."
user-invocable: true
metadata:
  keywords: arc sweep, pre-merge sweep, sweep arc
  aliases: pre-merge-sweep
---

# Arc Sweep — Pre-Merge Debt + Whole-Arc Review

`arc-sweep` is the closing ritual of `do-arc`: after an arc's phases are built but before merge, it (1) disposes every accumulated debt item and (2) runs ONE architect over the whole-arc diff judged as a single system. It then **reports merge-readiness — it never lands the merge itself.** Who decides the landing depends on how the sweep was invoked: **under `do-arc`, the landing decision belongs to do-arc Step 8** (auto-integrate on a clean PASS — sweep-clean is one of its inputs); **standalone** (a user-invoked `/arc-sweep`), hold for the user's explicit go.

**Read `skills/release-sweep/SKILL.md` FIRST.** arc-sweep reuses release-sweep's debt-disposition vocabulary and `debtResolutions[]` persistence verbatim — it does NOT invent a parallel taxonomy.

## When it runs vs release-sweep

arc-sweep runs **pre-merge**, on an unversioned, unarchived arc, aggregating the in-context `PhaseExecutionResult` roll-ups. release-sweep runs **pre-archive**, on versioned phases. Different trigger, **same persistence target** (`debtResolutions[]`). arc-sweep is NOT `full-code-review` (the 8-agent pre-prod audit) — it is a lighter, seam-specific architect pass.

## Step 1: Consolidated debt sweep

### Hand-in contract (the inputs)

`PhaseExecutionResult` (`PhaseExecutionResultShape`, `templates/schema.ts`) is a typed roll-up. arc-sweep gets it two ways, in priority order:
1. **In-context hand-in (the fast path):** `do-arc` (its Step 6) hands in the array it accumulated as the arc ran. Use it when present and complete.
2. **Durable fallback (`discoverResults()`):** each phase-executor persists its roll-up to `phase.executionResult` (do-phase arc-mode Step 5), so `discoverResults()` re-reads them from `roadmap/phases/phase-<n>.phase.ts`. **If the in-context array is missing or short** — a resumed arc, or context that compacted mid-run — reconstruct from `discoverResults()` rather than disposing a truncated set. The in-context array is an optimization; the persisted field is the system of record.

The free-text `compromises` strings are also persisted on the phase files and are **re-read** from there. Aggregate all of it: the structured roll-ups (in-context, or via `discoverResults()`) plus the free-text strings.

### Disposition → persistence: the decision table

Which disposition writes what is mechanical — read the row, don't re-derive it:

| Disposition | Meaning | Writes to `debtResolutions[]` | `status` | `via` |
|---|---|---|---|---|
| RESOLVE-NOW | fixed inline now, re-gated | ONE entry | `'fixed'` | `'<commitSHA>'` |
| PLAN-PHASE | real follow-up, phase authored | ONE entry | `'fixed'` | `'phase-<N>'` |
| ACCEPT (won't fix) | correct boundary, reason ≥20 chars | ONE entry | `"won't_fix"` | the reason |
| ACCEPT (dismiss) | never was debt | ONE entry | `'dismissed'` | the reason |
| OPERATOR-PENDING | deploy/operator action, not code | **NO entry** — recorded in `roadmap/followups/<arcId>.md` + the Step-3 report's deploy-actions section | — | — |

(`limitations` never enter this table — they are release-sweep's, listed not disposed; see below.)

### Dispose each item (release-sweep's vocabulary, NOT a new one)

For each debt item, prompt the user. The three code-disposition outcomes each persist exactly one `debtResolutions[]` entry on the owning phase — the same shape release-sweep writes (`{ ref: '<taskId>.<field>', status, via, date }`). OPERATOR-PENDING is the exception: it writes NO entry (the schema's `status` enum is `'fixed' | "won't_fix" | 'dismissed'` — there is no fourth value).

- **RESOLVE-NOW** == release-sweep **(f) Fix inline** → invoke `zeroh-roadmap:software-architect` for the proper-solution blueprint, apply, re-gate to the phase's `kind`, commit → append `{ ref, status: 'fixed', via: '<commitSHA>', date }`.
- **PLAN-PHASE** == release-sweep **(p) Plan a new phase** → invoke `zeroh-roadmap:plan-phase` by name with the debt text; after the new phase commits, append `{ ref, status: 'fixed', via: 'phase-<N>', date }`. When the follow-up is NOT planned immediately (deferred blueprint), write the full blueprint into **`roadmap/followups/<arcId>.md`** (create it; one numbered item per deferral) — see "Where deferred blueprints live" below.
- **ACCEPT** == release-sweep **(w) Won't fix** (substantive reason ≥20 chars → `status: "won't_fix"`) **or (d) Dismiss** (never-was-debt → `status: 'dismissed'`).
- **OPERATOR-PENDING** — the ONE genuinely new disposition with no release-sweep equivalent: a required **deploy/operator action, not a code change** (a pre-merge arc operates on an unversioned arc, so some items are "do this at deploy" rather than "fix in code"). It has no schema `status` and writes NO `debtResolutions[]` entry — it is recorded in `roadmap/followups/<arcId>.md` (the durable inventory) and echoed in the Step-3 ephemeral report's deploy-actions section for the operator to run at deploy (cf. release-sweep `(k) Keep open` → no append). The item stays an open debt on the phase until a later release-sweep disposes it post-deploy.

`ref`/`status`/`via`/`date` semantics, the ≥20-char `won't_fix` reason, and the dismissed-ratio nudge are all release-sweep's — do not redefine them here.

**`limitations` are out of arc-sweep's scope — by design, not by omission.** The `PhaseExecutionResult` roll-up carries the three arc-debt categories (`compromises`/`skipped`/`hardcoded`) but NOT `limitations` — a limitation is a permanent design constraint, not deferred work, so it is not arc-disposable. It stays an open debt that **release-sweep** disposes pre-archive (release-sweep walks all four transparency-report fields). To avoid a silent coverage hole, arc-sweep still **re-reads each phase's `limitations` and LISTS any present in the Step-3 merge-readiness report** under "deferred to release-sweep" — so "every debt is disposed" is never claimed falsely; the operator sees the limitations exist and that their disposition is release-sweep's, not this sweep's.

**No summary file.** Like release-sweep (its SKILL.md "the phase files ARE the audit trail" rule), arc-sweep NEVER writes a persisted summary/report file. `debtResolutions[]` + the transparency reports it points to are the durable audit trail; the merge-readiness report (Step 3) is an EPHEMERAL chat report only.

**Where deferred blueprints live — `roadmap/followups/<arcId>.md` (not backlog labels).**
PLAN-PHASE items not planned on the spot and OPERATOR-PENDING deploy actions need a durable
home between "disposed" and "planned/run". That home is `roadmap/followups/<arcId>.md`: the
sweep creates it with one numbered item per deferral carrying the FULL blueprint (the fix
design, files, evidence). The backlog tier label then carries ONE line (≤200 chars — the
schema enforces it) pointing at the file: blueprints in backlog labels are what bloated them
into unreadable multi-KB blobs. This is a *work-inventory* file, not a summary/report — the
no-summary-file rule above is about the sweep's ephemeral verdict, which stays chat-only.
`plan-phase` accepts a followups item reference as its source input.

## Step 2: Whole-arc cross-phase review (against singleSeams + designRefs)

A per-phase gate sees only its own diff — it CANNOT catch a seam that one phase quietly forked from another (3 hardcodes that should have been 1 config; a shared type two phases each redefined; a read-back path one consumer re-implemented). **Only a whole-arc view catches a forked seam.** That is this step's whole job.

Run ONE `zeroh-roadmap:software-architect` over **`git diff <arc.baseRef>..HEAD`** (the arc's full diff, `baseRef` from the Arc entity) and judge it as **a single system** against `arc.singleSeams` (the "hold these single" invariants): for each seam, did any consumer fork it, or is it genuinely a single implementation across the whole arc?

**Design-conformance — judge the build against `arc.designRefs` too.** Beyond the seams, read the arc's confirmed `designRefs` (the design spec the design-first gate produced in plan-arc Step 1b) and judge whether the built arc actually implements each: a `reused` architecture pattern is genuinely followed (not quietly re-invented); a `designed` pattern matches what was extended in the arch doc; a `ux` designRef's surface matches the confirmed layout/preview. **The design is the spec** — a build that drifts from a confirmed designRef is a sweep finding, disposed like any other (RESOLVE-NOW if cheap, else a PLAN-PHASE follow-up) and reported alongside the seam verdicts. An arc with no `designRefs` (the design gate was skipped — a mechanical arc) has nothing to conform to: skip this check explicitly, never a silent pass.

- Apply any **RESOLVE-NOW** fixes the architect identifies, and **re-gate each** to its phase's `kind` (a fix is not done until it re-passes the gate).
- Author **PLAN-PHASE** follow-ups (via `zeroh-roadmap:plan-phase`) for real debt that should not block this merge.

## Step 3: Report merge-readiness (ephemeral)

Emit a merge-readiness report **to chat only** (never a file — see the no-summary-file rule above). It aggregates:
- **Per-phase gate status** — every member phase is `done` with a passing gate.
- **Debt dispositions** — the Step-1 roll-up: counts by `RESOLVE-NOW` / `PLAN-PHASE` / `ACCEPT` (won't_fix/dismissed) / `OPERATOR-PENDING`, with the `debtResolutions[]` refs written by the three code dispositions (OPERATOR-PENDING writes none — list its items in the deploy-actions bullet below instead).
- **Whole-arc architect verdict** — the Step-2 seam judgment (single vs forked) AND the design-conformance judgment (build matches `arc.designRefs`, or the drift findings; "no designRefs — design gate skipped" when there are none), plus any RESOLVE-NOW fixes applied + re-gated.
- **Deferred to release-sweep** — any `limitations` entries re-read from the phase files (arc-sweep does not dispose these; they're release-sweep's). List them so the operator knows they exist and remain open.
- **Overall** — full green / blocked, and any OPERATOR-PENDING deploy actions the operator must take.

**arc-sweep never merges on its own — it reports.** Landing authority (restating the header rule so it can't be missed): **under `do-arc`**, hand this report back — do-arc Step 8 owns the landing decision (auto-integrate when validate-arc PASSED + this sweep is clean + the arc-end suite is green + no blocker). **Standalone**, hold for the user's explicit go; until then the arc sits built-and-swept on its branch, and any OPERATOR-PENDING actions are the operator's to run at deploy.
