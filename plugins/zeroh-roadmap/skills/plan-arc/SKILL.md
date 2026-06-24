---
name: "Plan Arc"
description: "Plan a whole arc (a named, contiguous block of phases shipped as one unit): author the Arc entity, plan every member phase, and review them in parallel — then queue them as one arc tier."
user-invocable: true
metadata:
  keywords: plan arc, create arc, new arc, arc
  aliases: new-arc
---

# Plan Arc — Arc Planning Protocol

`plan-arc` is the front door to an Arc: it writes the `Arc` entity, plans each member phase (looping `plan-phase`), fans out plan-quality review across them safely, and queues the whole set as one arc tier. The arc can then be built with `/do-arc <id>`.

## Trigger

User says: `plan arc`, `/plan-arc`, `create arc`, `new arc`.

## Arguments

- **`<id>`** (optional) — the Arc id to author (`Arc.id`, a number or short string, e.g. `B`). If omitted, propose one and confirm with the user.

## Step 1: Author the Arc entity

Before any phase is planned, write `roadmap/arcs/<id>.arc.ts` using `defineArc` (from phase 855, `templates/schema.ts`). Capture the arc's shape up front so the phases plan against a fixed frame:

```ts
import { defineArc } from '@/lib/roadmap/schema'

export default defineArc({
  id: '<id>',
  name: '<arc name — the why, one line>',
  baseRef: '<git ref the arc branches from / merges into>',
  planes: [
    // ordered waves of phases; each plane is a track, phases within it are sequential
    { name: '<plane name>', phases: [/* filled once numbers are reserved in Step 2a */] },
  ],
  singleSeams: [
    // the "hold these single" invariants the pre-merge arc-sweep judges
    '<seam — a config/factory/shared type that must stay a single implementation across the arc>',
  ],
  honestyRails: [
    '<honesty constraint the whole arc must uphold>',
  ],
})
```

Decide WITH the user: the `planes` (ordered waves), the `singleSeams` (what must not fork across the arc), the `honestyRails`, and `baseRef`. Match the `do-phase` / `plan-phase` skill style. `planes[].phases` is filled in Step 2a once the phase numbers are reserved.

## Step 2a: Reserve a contiguous phase-number block FIRST

`plan-phase` Step 1 computes the "next number" from the filesystem with **no lock** — so recomputing it per iteration can collide under the arc's volatile namespace (each new phase file shifts the max). Reserve the block ONCE, up front:

1. Compute the next phase number once (the current max + 1).
2. Reserve a contiguous block of size = **sum of the phase counts across `arc.planes`**.
3. Write those EXPLICIT numbers back into `arc.planes[].phases` (in plane order) and re-save the `.arc.ts`, so the arc's `planes ↔ phases` cross-validation (855 `crossValidate`) is correct and the "phase range" label is stable.

Pass each explicit number into the planning loop so `plan-phase` never recomputes the next number per iteration.

## Step 2b: Plan each member phase (plan-phase --skip-review)

Loop `plan-phase` over the reserved numbers, in **dependency / plane order**:
- Pass the **explicit phase number** (from Step 2a) so no recompute happens.
- Pass **`--skip-review`** so the per-phase auto-review does NOT run and does NOT queue — reviews are batched in Step 3.
- Set each planned phase's **`arcId`** (855) to the arc id, so the phase ↔ arc back-reference resolves.

Each phase is authored as a normal `.phase.ts` with `status: 'backlog'`; the arc binds them via `arcId` + the arc's `planes`.

## Step 3: Fan out plan-quality review (parallel, read-mostly)

Review all member phases in parallel — one agent per phase running `review-phase` Mode A — each with **`--no-queue`**. This is the same safe fan-out shape `do-arc` uses, and it exists for one reason: `review-phase` Mode A's queue step WRITES the shared `roadmap/backlog.ts`, so N concurrent reviews would race it.

**Edit-confinement invariant (state it explicitly):** `--no-queue` skips ONLY the queue write, not all writes. Each parallel review agent may edit ONLY its own `roadmap/phases/phase-{N}.phase.ts` (to fix its BLOCKER / NEEDS-WORK findings) and **MUST NOT touch `roadmap/backlog.ts`** or any other phase's file. The parallel stage is read-mostly: each agent reads broadly, writes only within its own phase file.

Collect each phase's verdict (READY / NEEDS WORK / BLOCKER). Only READY phases proceed to queueing.

## Step 4: Place the queue entries serially (single writer, one arc tier)

After ALL parallel reviews return, the orchestrator ALONE places the READY phases into `roadmap/backlog.ts` — **serially, in one pass** — as a single arc tier whose label names the arc + its phase range. Respect the dependency floor + priority ordering (same rules as `review-phase` Mode A Step 8). **`roadmap/backlog.ts` has exactly one writer: this serial Step 4.** No parallel agent ever writes it.

A phase that came back NEEDS WORK / BLOCKER is NOT queued — surface its findings; the user fixes and re-reviews before that phase joins the tier.
