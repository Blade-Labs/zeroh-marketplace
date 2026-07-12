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
| PLAN-PHASE / **IN-ARC** (default) | authored + executed in-arc (do-arc loops back) | ONE entry | `'planned'` → `'fixed'` AFTER execution | `'phase-<N>'` |
| PLAN-PHASE / **DESCOPE** | dropped, user-ratified (even autonomous) | ONE entry + a typed `Arc.descopes[]` item | `"won't_fix"` | `'descope — ratified by … (≥20 chars)'` |
| ACCEPT (won't fix) | correct boundary, reason ≥20 chars | ONE entry | `"won't_fix"` | the reason |
| ACCEPT (dismiss) | never was debt | ONE entry | `'dismissed'` | the reason |
| OPERATOR-PENDING | deploy/operator action, not code | ONE entry (+ detail in `roadmap/followups/<arcId>.md`) | `'operator-pending'` | runbook / DEPLOY.md anchor |

(`limitations` never enter this table — they are release-sweep's, listed not disposed; see below.)

### Dispose each item (release-sweep's vocabulary, NOT a new one)

**Disposition mode — read the consumer's `## Merge policy` first.** When arc-sweep runs UNDER do-arc AND `arc-integration: autonomous`, dispose each item YOURSELF by the decision table below — no per-item user prompt on the clean path. When the block is absent / `arc-integration: hold`, or arc-sweep was invoked **standalone** by the user, prompt the user per item as before — **standalone arc-sweep behavior is unchanged (always interactive).**

**Autonomous mode STILL stops for a human on exactly four classes** (the decision table disposes everything else): a `[PRODUCT]` hard-stop; a `[MULTI-REPO]` hard-stop; a `software-architect` **ESCALATE** verdict on a tiebreak; and any **DESCOPE** — a disposition that would narrow what the arc promised ALWAYS needs user ratification (recorded typed on `Arc.descopes` per the table below). On a genuinely ambiguous item, spawn `software-architect` as a tiebreak advisor (the Prime-Rule-1 pattern) BEFORE disposing.

The three code-disposition outcomes each persist exactly one `debtResolutions[]` entry on the owning phase — the same shape release-sweep writes (`{ ref: '<taskId>.<field>', status, via, date }`). An autonomous disposition writes the **SAME** entry, distinguished only by marking `via` with `autonomous-sweep` (e.g. `via: '<commitSHA> autonomous-sweep'` for RESOLVE-NOW, `via: 'autonomous-sweep'` for a dismissed item) — so an autonomous and an interactive disposition are typed identically and the record stays honest about which ran. (Every disposition below writes a `debtResolutions[]` entry, including OPERATOR-PENDING via the widened `operator-pending` status — see its row.)

- **RESOLVE-NOW** == release-sweep **(f) Fix inline** → invoke `zeroh-roadmap:software-architect` for the proper-solution blueprint, apply, re-gate to the phase's `kind`, commit → append `{ ref, status: 'fixed', via: '<commitSHA>', date }`. **`'fixed'` is reserved for work EXECUTED in this sweep** (a commit that exists) — never for a follow-up that was merely authored.
- **PLAN-PHASE** — a real follow-up. Two dispositions, and **IN-ARC is the DEFAULT**:
  - **IN-ARC (default)** — author the phase NOW (`zeroh-roadmap:plan-phase`, stamp `arcId`, claim a number, append it to the arc's `planes`) and append `{ ref, status: 'planned', via: 'phase-<N>', date }`. **do-arc then loops back to Step 4 and EXECUTES the phase before Step 7/8** (the mechanics validate-arc's corrective loop documents — validate-arc SKILL.md). When it completes, the entry flips `'planned'` → `'fixed'` via `'phase-<N>'` (now truthful — the work exists). Authoring alone is NOT resolution.
  - **DESCOPE** — drop the follow-up. Requires **explicit user ratification EVEN in autonomous mode** (the 1370 stop-class). Record it BOTH as `{ ref, status: "won't_fix", via: 'descope — ratified by <who> <when> (see Arc.descopes)', date }` (the `won't_fix` `via` is release-sweep's substantive ≥20-char reason — here the descope ratification) AND a typed `Arc.descopes[]` item `{ item, ratifiedBy, ratifiedAt }` (the 1367 shape) — the ratification stays durable and typed, never buried in prose.
- **ACCEPT** == release-sweep **(w) Won't fix** (substantive reason ≥20 chars → `status: "won't_fix"`) **or (d) Dismiss** (never-was-debt → `status: 'dismissed'`).
- **OPERATOR-PENDING** — a required **deploy/operator action, not a code change** (a pre-merge arc is unversioned, so some items are "do this at deploy"). It now WRITES an entry `{ ref, status: 'operator-pending', via: '<runbook / DEPLOY.md anchor>', date }` (the 1367 enum widening) so deploy debt is schema-visible to audit-roadmap + release-sweep, with the detail in `roadmap/followups/<arcId>.md`. **Exempt from the openFollowups budget** but counted separately and listed in the RunnerSummary notes. It stays OPEN until a later release-sweep disposes it post-deploy.

`ref`/`status`/`via`/`date` semantics, the ≥20-char `won't_fix` reason, and the dismissed-ratio nudge are all release-sweep's — do not redefine them here.

**`limitations` are out of arc-sweep's scope — by design, not by omission.** The `PhaseExecutionResult` roll-up carries the three arc-debt categories (`compromises`/`skipped`/`hardcoded`) but NOT `limitations` — a limitation is a permanent design constraint, not deferred work, so it is not arc-disposable. It stays an open debt that **release-sweep** disposes pre-archive (release-sweep walks all four transparency-report fields). To avoid a silent coverage hole, arc-sweep still **re-reads each phase's `limitations` and LISTS any present in the Step-3 merge-readiness report** under "deferred to release-sweep" — so "every debt is disposed" is never claimed falsely; the operator sees the limitations exist and that their disposition is release-sweep's, not this sweep's.

**No summary file.** Like release-sweep (its SKILL.md "the phase files ARE the audit trail" rule), arc-sweep NEVER writes a persisted summary/report file. `debtResolutions[]` + the transparency reports it points to are the durable audit trail; the merge-readiness report (Step 3) is an EPHEMERAL chat report only.

**`roadmap/followups/<arcId>.md` — OPERATOR-PENDING detail + ratified-descope rationale only.**
Code debt no longer has a prose-blueprint-only deferral path: a PLAN-PHASE follow-up is either
authored-AND-executed **IN-ARC** (the default — no prose stand-in for real work) or a
user-ratified **DESCOPE** (typed on `Arc.descopes`). What remains for this file is the durable
detail of the two dispositions that are NOT code fixes disposed in the sweep: OPERATOR-PENDING
deploy actions (the runbook step) and the rationale behind a ratified descope. The backlog tier
label carries ONE line (≤200 chars — the schema enforces it) pointing at the file. This is a
*work-inventory* file, not a summary/report — the no-summary-file rule above is about the
sweep's ephemeral verdict, which stays chat-only.

## Step 2: Whole-arc cross-phase review (against singleSeams + designRefs)

A per-phase gate sees only its own diff — it CANNOT catch a seam that one phase quietly forked from another (3 hardcodes that should have been 1 config; a shared type two phases each redefined; a read-back path one consumer re-implemented). **Only a whole-arc view catches a forked seam.** That is this step's whole job.

Run ONE `zeroh-roadmap:software-architect` over **`git diff <arc.baseRef>..HEAD`** (the arc's full diff, `baseRef` from the Arc entity) and judge it as **a single system** against `arc.singleSeams` (the "hold these single" invariants): for each seam, did any consumer fork it, or is it genuinely a single implementation across the whole arc? **Spawn it with `model` per the `## Model policy` home statement (review-phase SKILL.md)** — this whole-arc architect is a JUDGE. (The RESOLVE-NOW architect invocation elsewhere is a FIXER, not a judge — deliberately not covered.)

**Design-conformance — judge the build against `arc.designRefs` too.** Beyond the seams, read the arc's confirmed `designRefs` (the design spec the design-first gate produced in plan-arc Step 1b) and judge whether the built arc actually implements each: a `reused` architecture pattern is genuinely followed (not quietly re-invented); a `designed` pattern matches what was extended in the arch doc; a `ux` designRef's surface matches the confirmed preview — layout AND the interactions/motion it defines (hover/focus effects, transitions, animations: same or unambiguously better, never flattened — the parity rubric's Interaction & motion axis). **The design is the spec** — a build that drifts from a confirmed designRef is a sweep finding, disposed like any other (RESOLVE-NOW if cheap, else a PLAN-PHASE follow-up) and reported alongside the seam verdicts. An arc with no `designRefs` (the design gate was skipped — a mechanical arc) has nothing to conform to: skip this check explicitly, never a silent pass.

- Apply any **RESOLVE-NOW** fixes the architect identifies, and **re-gate each** to its phase's `kind` (a fix is not done until it re-passes the gate).
- Author **PLAN-PHASE** follow-ups (via `zeroh-roadmap:plan-phase`) for real debt that should not block this merge.

## Step 3: Report merge-readiness (ephemeral)

Emit a merge-readiness report **to chat only** (never a file — see the no-summary-file rule above). It aggregates:
- **Per-phase gate status** — every member phase is `done` with a passing gate.
- **Debt dispositions** — the Step-1 roll-up: counts by `RESOLVE-NOW` / `PLAN-PHASE` (IN-ARC vs DESCOPE) / `ACCEPT` (won't_fix/dismissed) / `OPERATOR-PENDING`, with the `debtResolutions[]` refs each writes (IN-ARC = `'planned'`→`'fixed'`; OPERATOR-PENDING = `'operator-pending'`, also listed in the deploy-actions bullet below).
- **Whole-arc architect verdict** — the Step-2 seam judgment (single vs forked) AND the design-conformance judgment (build matches `arc.designRefs`, or the drift findings; "no designRefs — design gate skipped" when there are none), plus any RESOLVE-NOW fixes applied + re-gated.
- **Deferred to release-sweep** — any `limitations` entries re-read from the phase files (arc-sweep does not dispose these; they're release-sweep's). List them so the operator knows they exist and remain open.
- **Overall** — full green / blocked, and any OPERATOR-PENDING deploy actions the operator must take.

**arc-sweep never merges on its own — it reports.** Landing authority (restating the header rule so it can't be missed): **under `do-arc`**, hand this report back — do-arc Step 8 owns the landing decision (auto-integrate when validate-arc PASSED + this sweep is clean + the arc-end suite is green + no blocker). **Standalone**, hold for the user's explicit go; until then the arc sits built-and-swept on its branch, and any OPERATOR-PENDING actions are the operator's to run at deploy.
