---
name: "Validate Arc"
description: "Drive a built arc's real shipped flow and judge it against its acceptance criteria with an independent judge panel, reporting PASS/GAPS. The terminal intent gate do-arc runs after arc-sweep, before merge."
user-invocable: true
metadata:
  keywords: validate arc, intent validation, check the arc met its intent, validate intent
  aliases: intent-validate
---

# Validate Arc — Intent Validation Protocol

`validate-arc` closes the arc loop. The per-phase gate proves the code correct; `arc-sweep` proves the
arc coheres. Neither drives the **shipped product** as a user and asks *did this do the job, at the bar
set?* That is this skill: resolve `acceptanceCriteria`, drive the real flow at each criterion's tier with
a **fresh independent judge** (`intent-validator` — never the agent that built it), and report **PASS**
(all met) or **GAPS** (≥1 unmet) with concrete evidence. It **never merges** (do-arc's call); on GAPS its
bounded corrective loop (Step 5) turns gaps into fixes via the normal gated `plan-phase` + `do-phase`
pipeline (never a parallel executor).

**Trigger:** `validate arc <id>`, `/validate-arc <id>`; also `do-arc`'s terminal Step 7 (after `arc-sweep`,
before the merge-hold). `<id>` matches `Arc.id`.

## Step 0: Resolve the arc + its criteria

1. `discoverArcs()` → the arc whose `id` equals `<id>`. None → STOP: `No arc with id <id>.`
2. Read `arc.acceptanceCriteria`. **Empty AND step 3 derives nothing → STOP with an HONEST no-op:**
   `Arc <id> declares no acceptance criteria — a no-op.` Never invent criteria (circular).
   (Run step 3 FIRST — zero authored criteria + confirmed `ux` designRefs is exactly the drifted-arc the
   parity fail-safe exists for.) Criteria are **immutable post-planning** (the validator enforces it via
   `criteriaRatifications`), so the intent judged is always the ORIGINAL, never one quietly narrowed.
3. **UX design-parity fail-safe (the one sanctioned derivation — NOT criteria invention).** Read
   `arc.designRefs`. For every `kind: 'ux'` designRef with NO matching `ux-parity:*` criterion, DERIVE the
   standard parity criterion (plan-arc Step 1b(4) template: tier `live-ui`, signal = side-by-side of the
   shipped surface vs the rendered artifact across every state AND every interaction it defines — hover/
   focus, transitions, animations, driven live — judged by references/parity-rubric.md) and ADD it to THIS run's
   panel (don't edit the arc file — record `derived: true`). Not circular: the artifact was USER-CONFIRMED
   at the design gate, so the intent is ratified — only the check was missing. A `ux` designRef pointing at
   a missing/moved artifact → a GAP naming the broken ref.

## Step 1: Confirm the arc is built and runnable
1. Every member phase across `arc.planes[].phases` is `done` (validating an unbuilt arc is meaningless);
   if any isn't, STOP and name it.
2. The consumer's `roadmap.config.json` sets `validationTiers`, binding each tier (`wired`/`live-ui`/
   `live-host`) to a command (`intent-validator` reads it). Absent → surface it; the live-ui/live-host
   criteria come back as gaps naming the missing binding.

## Step 2: Tier-pick — honour each criterion's tier, with a tier-honesty down-check

The tier vocabulary — what each can/can't honestly judge, its evidence, the consumer binding — is in
**`references/driving-tiers.md`** (read once; the down-check and Step-3 judge both rely on it).

Each criterion carries its `tier` (the cheapest that can honestly judge it). Honour it, but apply a
**tier-honesty down-check:** if a criterion's `bar` is about the *rendered experience* yet its `tier` is
`wired` (in-process logic, blind to a screen), **flag it** and run the judge at that tier anyway (it will
return a gap naming the mismatch). Never silently upgrade the tier — the mismatch is a planning signal.

## Step 3: Fan out the judge — one `intent-validator` per criterion, in parallel

Spawn `intent-validator` **once per criterion, concurrently** (the safe read-mostly fan-out `plan-arc`
Step 3 uses). **Spawn each with `model` per the `modelPolicy.judgeModel` home statement (review-phase
SKILL.md)** — EVERY judge in a panel. Two invariants:

- **Edit-confinement:** judges are READ-ONLY — they drive and observe, writing NOTHING in the consumer tree
  or roadmap (driving may run the consumer's tests/build; no judge edits source, backlog, or a phase file).
- **Independence:** each judge is spawned FRESH with only (the criterion + the tier bindings + the running
  surface). Never pass it the building agents' reasoning, the diffs, or the commit log — that is
  self-grading. This is the independent-judge singleSeam.

For a **subjective** `bar` (rendered-UX / "feels finished", typically `live-ui`), spawn **2 judges and
require AGREEMENT** (one can't rubber-stamp a screenshot; a tie-breaker buys less than surfacing the
disagreement): both MET → MET; both unmet → GAP; a **split verdict is a GAP carrying BOTH verdicts**
(fail-visible — the user arbitrates, cheaper and more honest than majority-voting the doubt away). A
deterministic `wired`/`live-host` criterion runs a **single judge**.

## Step 4: Collect, aggregate, report

1. `.parse()` each `IntentVerdict` (typed shape — reject free prose; a mis-shaped judge is re-run once,
   then recorded as an inconclusive gap).
2. Per criterion: **MET** (single judge, or both panel judges) or **GAP** (carrying `whatsMissing` +
   `suggestedFix` + evidence; a split panel's GAP carries both verdicts, marked `split — user arbitrates`).
3. Arc-level: **PASS** iff every criterion MET; else **GAPS** + the unmet list + evidence + fix.

Report per-criterion verdict + evidence + the tier judged at (+ any tier-honesty flag), a **Ratified
descopes** section (read `Arc.descopes`; list each `{ item, ratifiedBy, ratifiedAt }`, or `none` — NEVER
omitted), and PASS/GAPS. **Stop on PASS** (merge-readiness is do-arc's call). On GAPS, Step 5 takes over.

## Step 5: Corrective loop (on GAPS) — bounded

A GAPS result feeds a fix-and-re-check loop that **reuses `plan-phase` + `do-phase`** — a gap becomes a
normal gated corrective phase. NO parallel executor, NO forked pipeline (the singleSeam). **From `do-arc`
(Step 7), the consumer's `mergePolicy.gapsCorrection` decides:** `autonomous` → run this loop UNATTENDED
(surface the gaps to chat as you go, but do not wait) until PASS or the bound trips — the judge's PASS is
the approval (user ruling 2026-07-18); `hold` or absent → surface the GAPS + proposed corrective phase(s)
and **PAUSE for the user's go** (the fail-safe default). Under EITHER mode, three stops survive: bound
exhaustion, any descope-shaped disposition (autonomy never shrinks the arc's promise), and a SPLIT
panel verdict (marked "user arbitrates" — a gap the judges dispute is not autonomy's to fix). Each round:

1. **Author a corrective phase per gap via `plan-phase`** — `problem` = `whatsMissing`, tasks seeded by
   `suggestedFix`. `plan-phase` does NOT stamp `arcId`, so DO what `plan-arc` Step 2b does: set the phase's
   `arcId` AND append its number to `planes[].phases` (else `crossValidate` rejects).
2. **Execute each via `do-phase`** (full gate — corrective work is gated code).
3. **Re-validate the affected criteria** (re-run Steps 2–4 for the criteria whose phase landed, not the
   whole arc). A bound, not a guarantee: a corrective phase could regress a MET criterion — the backstop is
   two-layered (each phase's `do-phase` gate + do-arc's terminal full-arc re-validate). Widen if a phase's
   blast radius plausibly reaches other criteria.

Loop until PASS or the **bound** trips: `maxRounds` default **2** + a budget cap.
**Exhaustion exit (never spin/silently-pass):** when the bound trips with criteria unmet,
**DISPOSITION each residual gap through the arc-sweep disposition table** (IN-ARC author-and-execute, or a
user-ratified DESCOPE typed on `Arc.descopes`) — NOT prose into the backlog. Report `GAPS: N residual —
dispositioned <in-arc | descope>`. Never report PASS with a criterion unmet.
