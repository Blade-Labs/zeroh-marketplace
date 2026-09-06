---
name: "Validate Arc"
description: "Drive a built arc's real shipped flow and judge it against its acceptance criteria with an independent judge panel, reporting PASS/GAPS. The terminal intent gate do-arc runs after arc-sweep, before merge."
user-invocable: true
metadata:
  keywords: validate arc, intent validation, check the arc met its intent, validate intent
  aliases: intent-validate
---

# Validate Arc — Intent Validation Protocol

Drive the shipped product against its original acceptance criteria with a fresh independent
`intent-validator`. Report PASS only when all criteria are met; otherwise GAPS with evidence.
Never merge. Authorized repairs use the gated `plan-phase` + `do-phase` loop in Step 5.

**Trigger:** `validate arc <id>`, `/validate-arc <id>`; also `do-arc`'s terminal Step 7 (after `arc-sweep`,
before the merge-hold). `<id>` matches `Arc.id`.

## Step 0: Resolve the arc + its criteria

1. Resolve `<id>` through `discoverArcs()`; absent → STOP and name it.
2. Read `arc.acceptanceCriteria`, immutable post-planning via `criteriaRatifications`.
3. **UX parity fail-safe:** for each `kind: 'ux'` designRef without a matching `ux-parity:*`
   criterion, derive the plan-arc Step 1b(4) criterion: tier `live-ui`, side-by-side evidence
   across every defined state and interaction (hover, focus, transitions, animations), using
   `references/parity-rubric.md`. Add it only to this panel with `derived: true`, never edit the
   arc. The user-confirmed design supplies the intent. A missing/moved artifact is a GAP.
4. No authored or derived criteria → STOP with an honest no-op; never invent criteria.

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

Spawn a fresh `intent-validator` per criterion, concurrently, with `model` from the
`modelPolicy.judgeModel` home in review-phase SKILL.md. Pass only the criterion, tier bindings,
and running surface; never builder reasoning, diffs, or commit history. Judges drive and observe
read-only: tests/builds are allowed, source/roadmap edits are not.

For subjective bars (such as rendered UX), use two judges: both MET → MET; otherwise GAP
carrying both verdicts. A split is marked `split — user arbitrates`, never majority-voted away.
Deterministic `wired`/`live-host` criteria use one judge.

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

Apply this authority order before corrective writes:

- An explicit owner stop/hold wins. Otherwise applicable session authorization permits its
  scoped, budgeted corrections even with configured `hold`; do not request it again.
- Without a session ruling, discovered consumer `mergePolicy.gapsCorrection: autonomous`
  permits correction. `hold` or absent mode requires concrete proposed fixes and owner approval.
- Scope expansion, descope, budget extension, or an unapproved service boundary requires the
  specific missing ruling. Never change config to manufacture authority; correction grants no
  merge/release authority.

Keep the two-round and budget bounds. Fresh independent judgment must verify each repair;
unavailable judgment remains UNJUDGED/GAPS. Each authorized round:

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
