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
  acceptanceCriteria: [
    // the experience-level Definition of Done — the JTBD as observable signals; the
    // validate-arc stage drives the real flow and an independent judge scores each.
    {
      id: '<short-handle>',
      job: '<the job a user came to do, in user terms>',
      surfaces: ['<surface id the job lives on, e.g. console | office-pane | chat>'],
      signal: '<the observable proof the job is fulfilled — what the judge looks for>',
      tier: 'wired', // wired = in-process logic · live-ui = rendered UX (screenshot) · live-host = real model/masking
      bar: '<the UX/quality bar beyond "it works" — what "good" feels like>',
    },
  ],
})
```

Decide WITH the user: the `planes` (ordered waves), the `singleSeams` (what must not fork across the arc), the `honestyRails`, the `acceptanceCriteria`, and `baseRef`. Match the `do-phase` / `plan-phase` skill style. `planes[].phases` is filled in Step 2a once the phase numbers are reserved.

**Authoring `acceptanceCriteria` — elicit, don't invent.** These are the experience-level Definition of Done the terminal `validate-arc` stage checks; author them WITH the user, in user-outcome terms, NOT after the fact (grading against criteria invented at validate time is circular). For each: state the `job` (the JTBD — "draft a reply a rep can send unedited", not "the draft endpoint returns 200"), the `signal` (the observable proof it's fulfilled — what the judge looks for), and the `bar` (what "good" feels like beyond "it works" — finished, no raw error, no placeholder). Assign the `surfaces` it lives on, and pick the **cheapest `tier` that can honestly judge it** (the stub above glosses `wired` / `live-ui` / `live-host`). Prefer **one or two sharp criteria over ten vague ones** — a criterion the judge can't get concrete evidence for is noise. The field is optional (defaults `[]`), but an arc with none makes its validate stage a no-op — say so deliberately rather than leaving it empty by accident.

## Step 1b: Design-first gate (classify → architecture reuse-or-design → confirm)

The Arc entity exists (Step 1) but NO phase is planned yet. Before reserving numbers (Step 2a), run the **design-first gate** — the front-gate mirror of the terminal `validate-arc` stage: validate-arc asks "did it meet the intent?"; this asks "was it DESIGNED right — the best long-term architecture (and UX, where there's a surface) — before a line was written?". The gate is **proportionate**: triggered by what the arc introduces and honestly **skipped (and recorded)** for a mechanical arc — never ceremony by default, never a silent bypass. The classifier criteria + the architect's reuse-or-design contract live in **`references/design-gate.md`**.

**(1) Classify the arc.** Decide (criteria in `references/design-gate.md`):
- **New pattern?** Does the arc introduce a new tool, a new architectural pattern, or a new cross-module seam — vs. mechanically extending one that already exists?
- **UX surface?** Does the arc add or materially change a user-facing surface?

If **NEITHER** holds, record an explicit skip in the arc's reasoning (a comment in the `.arc.ts` or the planning chat) — `design gate: skipped — no new pattern / no surface (mechanical arc)` — and proceed to Step 2a. Don't invent design ceremony for a mechanical change.

**(2) Architecture sub-gate** — when the arc introduces a new pattern / tool / seam. The architecture design **home is the consumer's** canonical architecture doc set; the plugin hardcodes no path — read the binding from the consumer's `CLAUDE.md` "## Design homes" block (the consumer-agnostic seam, the same shape as the `validate-arc` tier bindings). **If the consumer documents no "## Design homes" block, surface that and STOP the gate** — the sub-gate has no doc home to search and MUST NOT guess a path (guessing defeats the consumer-agnostic seam); the consumer documents its design homes first (mirrors validate-arc's missing-binding rule). With the home bound:
1. Spawn the **`software-architect`** agent and task it to **search** that doc set and **recommend** reuse-or-design — returning the recommendation (which pattern fits, or the design for a new one) plus the `ref` + `summary`. Used here as an advisor: the gate, not the architect, makes the file writes (next sub-steps) — so the architect's output stays advisory and the orchestrator owns the record.
2. **Reuse-first:** an existing pattern fits → the architect cites it and the **orchestrator** records a designRef `{ kind: 'architecture', ref: <doc section>, status: 'reused', summary }`. No new pattern is invented when one already exists (the pattern-reuse-first honesty rail).
3. **Design-when-needed:** none fits → the architect designs the long-term-correct pattern; the **orchestrator** then extends the arch doc set through the consumer's own doc governance (e.g. its canon-sync flow) and records `{ …, status: 'designed', summary }` with the justification.
4. **Confirm.** PAUSE for the user's explicit go on the architecture design before continuing — the user is the design gate (mirrors the merge-hold + the validate-arc GAPS pause). Do not plan phases against an unconfirmed design.

The **orchestrator** (not the architect — the architect advises, the orchestrator records) writes the confirmed designRef(s) onto the Arc entity (`roadmap/arcs/<id>.arc.ts` → `designRefs`, the 900 contract) — the design spec that, once their planes wire it, Step 2b plans each member phase against and `arc-sweep` judges the build's conformance to.

> **Seam for Plane B / C:** for a surface arc, the **UX sub-gate** runs here too — after the architecture sub-gate — consulting a senior `ux-designer` and pausing for confirmation (wired in the UX plane). Step 2b plans every member phase AGAINST the confirmed `designRefs` (wired in the plan-against-design plane).

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
- Set each planned phase's **`arcId`** (855) to the arc id — `Phase.arcId` accepts the same `number | string` union as `Arc.id`, so a letter id like `B` is written directly. Set it on every member phase, always.

Each phase is authored as a normal `.phase.ts` with `status: 'backlog'`; the arc binds them via the arc's `planes[].phases` (the forward list) and each phase's `arcId` (the back-reference). `crossValidate` (855) checks they stay consistent: every `arcId` must match a discovered arc, every `planes[].phases` number must match a real phase, no phase may be claimed by two arcs, and a phase's `arcId` must name the arc whose `planes` actually list it.

## Step 3: Fan out plan-quality review (parallel, read-mostly)

Review all member phases in parallel — one agent per phase running `review-phase` Mode A — each with **`--no-queue`**. This is the same safe fan-out shape `do-arc` uses, and it exists for one reason: `review-phase` Mode A's queue step WRITES the shared `roadmap/backlog.ts`, so N concurrent reviews would race it.

**Edit-confinement invariant:** `--no-queue` skips ONLY the queue write, not all writes. Each parallel review agent may edit ONLY its own `roadmap/phases/phase-{N}.phase.ts` (to fix its BLOCKER / NEEDS-WORK findings) and **MUST NOT touch `roadmap/backlog.ts`** or any other phase's file.

Collect each phase's verdict (READY / NEEDS WORK / BLOCKER). Only READY phases proceed to queueing.

## Step 4: Place the queue entries serially (single writer, one arc tier)

After ALL parallel reviews return, the orchestrator ALONE places the READY phases into `roadmap/backlog.ts` — **serially, in one pass** — as a single arc tier whose label names the arc + its phase range. Respect the dependency floor + priority ordering (same rules as `review-phase` Mode A Step 8). **`roadmap/backlog.ts` has exactly one writer: this serial Step 4.** No parallel agent ever writes it.

A phase that came back NEEDS WORK / BLOCKER is NOT queued — surface its findings; the user fixes and re-reviews before that phase joins the tier.
