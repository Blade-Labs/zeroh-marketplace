---
name: "Validate Arc"
description: "Drive a built arc's real shipped flow and judge it against its acceptance criteria with an independent judge panel, reporting PASS/GAPS. The terminal intent gate do-arc runs after arc-sweep, before merge."
user-invocable: true
metadata:
  keywords: validate arc, intent validation, check the arc met its intent, validate intent
  aliases: intent-validate
---

# Validate Arc — Intent Validation Protocol

`validate-arc` closes the arc loop. The per-phase gate proves the code is correct; `arc-sweep` proves the arc coheres. Neither drives the **shipped product** as a user and asks *did this do the job, at the bar that was set?* That is this skill: resolve the arc's `acceptanceCriteria`, drive the real flow at each criterion's tier with a **fresh independent judge** (`intent-validator` — never the agent that built it), and report **PASS** (all met) or **GAPS** (≥1 unmet) with concrete evidence.

This skill **REPORTS ONLY** — it never merges and never fixes. (The corrective loop that turns a GAPS into fixes lives in Step 5, added by the corrective-loop phase; merge stays do-arc's call.)

## Trigger

User says: `validate arc <id>`, `/validate-arc <id>`, `check arc <id> met its intent`. Also invoked by `do-arc` as its terminal Step 7 (after `arc-sweep`, before the merge-hold).

## Arguments

- **`<id>`** (required) — the Arc id, matching `Arc.id` in `roadmap/arcs/<id>.arc.ts`.

## Step 0: Resolve the arc and its criteria

1. Call `discoverArcs()` and select the arc whose `id` equals `<id>`. If none matches, STOP: `No arc with id <id>. Run /plan-arc first, or check the id.`
2. Read `arc.acceptanceCriteria`. **If it is empty, STOP with an HONEST no-op:** report `Arc <id> declares no acceptance criteria — validate-arc is a no-op. (Author criteria in plan-arc Step 1 to make this gate real.)` Do NOT invent criteria to judge against — that is circular.

## Step 1: Confirm the arc is built and the surface is runnable

1. Confirm every member phase across `arc.planes[].phases` is `done` (validating an unbuilt arc is meaningless). If any is not, STOP and name it.
2. Confirm the consumer can be driven: it must document a **`## Validation tiers`** block in its `CLAUDE.md` binding each tier (`wired` / `live-ui` / `live-host`) to a command (the binding `intent-validator` reads). If the block is absent, surface that — the live-ui/live-host criteria cannot be driven and will come back as gaps naming the missing binding.

## Step 2: Tier-pick — honour each criterion's tier, with a tier-honesty down-check

Each criterion carries its `tier` (set at plan time — the cheapest tier that can honestly judge it). Honour it, but apply a **tier-honesty down-check**: if a criterion's `bar` is about the *rendered experience* (how it looks/feels) yet its `tier` is `wired` (in-process logic, which cannot see a screen), **flag it** — logic alone can't judge rendered UX. Surface the mismatch in the report and run the judge at the flagged tier anyway (the judge will itself return a gap naming the mismatch). Do not silently upgrade the tier; the mismatch is a planning signal worth seeing.

## Step 3: Fan out the judge — one `intent-validator` per criterion, in parallel

Spawn the `intent-validator` agent **once per criterion, concurrently** — the same safe read-mostly fan-out shape `plan-arc` Step 3 uses. Two invariants:

- **Edit-confinement:** the judges are READ-ONLY. They drive the flow and observe; they write NOTHING in the consumer tree or the roadmap. (Driving may run the consumer's own tests/build, which is fine — but no judge edits source, backlog, or a phase file.)
- **Independence:** each judge is spawned FRESH with only (the criterion + the consumer's tier bindings + the running surface). Never pass it the building agents' reasoning, the phase diffs, or the commit log — that is self-grading. This is the independent-judge singleSeam.

For a criterion whose `bar` is **subjective** (a rendered-UX / "feels finished" judgment, typically `live-ui`), spawn **N judges (default 3)** and take the **MAJORITY** verdict — one judge cannot rubber-stamp a screenshot. A deterministic `wired` criterion can run a single judge.

## Step 4: Collect, aggregate, report

1. `.parse()` each returned `IntentVerdict` (the typed shape — reject free prose; a judge that didn't return the shape is re-run once, then recorded as an inconclusive gap).
2. Per criterion: **MET** (single judge met, or majority met) or **GAP** (carrying the judge's `whatsMissing` + `suggestedFix` + the evidence).
3. Arc-level: **PASS** iff every criterion is MET; otherwise **GAPS** with the list of unmet criteria, each with its evidence and suggested fix.

Report the result — per-criterion verdict, the evidence, the tier each was judged at (and any tier-honesty flag from Step 2), and the arc-level PASS/GAPS. **Stop here on PASS** (the arc met its intent — merge-readiness is do-arc's call). On GAPS, the corrective loop (Step 5) takes over.
