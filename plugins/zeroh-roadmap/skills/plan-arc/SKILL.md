---
name: "Plan Arc"
description: "Plan a whole arc (a named, contiguous block of phases shipped as one unit): author the Arc entity, run the design-first gate (reuse-or-design the architecture & UX, confirmed) at its head, plan every member phase against the confirmed design, and review them in parallel — then queue them as one arc tier."
user-invocable: true
metadata:
  keywords: plan arc, create arc, new arc, arc
  aliases: new-arc
---

# Plan Arc — Arc Planning Protocol

`plan-arc` is the front door to an Arc: it writes the `Arc` entity, runs the **design-first gate**
(Step 1b — classify, then reuse-or-design the architecture and, for a surface, the UX, user-confirmed
and recorded as `designRefs`), plans each member phase (looping `plan-phase`) **against that design**,
fans out plan-quality review, and queues the set as one tier. Then build with `/do-arc <id>`.

## Trigger

User says: `plan arc`, `/plan-arc`, `create arc`, `new arc`.

## Arguments

- **`<id>`** (optional) — the Arc id to author (`Arc.id`, a number or short string, e.g. `B`). If omitted, propose one and confirm with the user.

## Step 1: Author the Arc entity

Before any phase is planned, write `roadmap/arcs/<id>.arc.ts` using `defineArc` — capture the arc's
shape up front so phases plan against a fixed frame:

```ts
import { defineArc } from '@/lib/roadmap/schema'

export default defineArc({
  id: '<id>',
  name: '<arc name — the why, one line>',
  baseRef: '<git ref the arc branches from / merges into>',
  planes: [{ name: '<plane name>', phases: [/* filled in Step 2a */] }], // ordered, sequential-within
  singleSeams: ['<a config/factory/shared type that must stay a single impl across the arc>'], // arc-sweep judges these
  honestyRails: ['<honesty constraint the whole arc upholds>'],
  acceptanceCriteria: [
    // experience-level Definition of Done — validate-arc drives the real flow, an independent judge scores each
    {
      id: '<short-handle>',
      job: '<the job a user came to do, in user terms>',
      surfaces: ['<surface id, e.g. console | office-pane | chat>'],
      signal: '<the observable proof the job is fulfilled — what the judge looks for>',
      tier: 'wired', // wired = in-process logic · live-ui = rendered UX (screenshot) · live-host = real model/masking
      bar: '<the quality bar beyond "it works">',
    },
  ],
})
```

Decide WITH the user: `planes`, `singleSeams`, `honestyRails`, `acceptanceCriteria`, `baseRef`.
`planes[].phases` fills in Step 2a once numbers are reserved.

**Size the phase count against the granularity rule** (plan-phase "Phase granularity"): gate +
executor cost is per-phase and v1 arcs run sequentially, so phase count ≈ wall-clock ≈ token cost.
Target 5–8 tasks/phase; a plane of 2–3-task phases → consolidate before reserving numbers.

**The interview (before authoring criteria).** Before writing `acceptanceCriteria` or running the
design gate, INTERVIEW the user — one question at a time, **prioritizing questions whose answers
change architecture or scope**. Record the answers as the arc's **LOCKED DECISIONS** (the
comment-block convention, e.g. `VOICE.arc.ts`) so they bind every downstream phase (Step 2b passes
them to each `plan-phase`). Skippable ONLY by recording `interview: skipped — <why>` (design
pre-ratified, or a mechanical arc). The interview extracts USER INTENT/SCOPE at request time; the
Step-1b architect owns TECHNICAL decisions during planning — two different stops.

**Authoring `acceptanceCriteria` — elicit, don't invent.** The experience-level Definition of Done
`validate-arc` checks; author them WITH the user in user-outcome terms, NOT after the fact (grading
against validate-time-invented criteria is circular). For each: the `job` (the JTBD — "draft a reply
a rep can send unedited", not "the endpoint returns 200"), the `signal` (the observable proof), the
`bar` (what "good" feels like beyond "it works"), the `surfaces`, and the **cheapest `tier` that can
honestly judge it**. Prefer **one or two sharp criteria over ten vague ones**. Optional (defaults
`[]`), but an arc with none makes its validate stage a no-op — say so deliberately.

## Step 1b: Design-first gate (classify → architecture + UX reuse-or-design → confirm)

The Arc entity exists but NO phase is planned yet. Before reserving numbers (Step 2a), run the
**design-first gate** — the front-gate mirror of `validate-arc`: it asks "was it DESIGNED right — the
best long-term architecture (and UX, where there's a surface) — before a line was written?". The gate
is **proportionate**: triggered by what the arc introduces and honestly **skipped (and recorded)** for
a mechanical arc — never ceremony by default, never a silent bypass. The classifier criteria + the
architecture and UX reuse-or-design contracts live in **`references/design-gate.md`**.

**(1) Classify the arc** (criteria in `references/design-gate.md`): **New pattern?** (a new tool /
architectural pattern / cross-module seam vs mechanically extending one) · **UX surface?** (adds or
materially changes a user-facing surface). If **NEITHER**, record an explicit skip in the `.arc.ts`
(`design gate: skipped — no new pattern / no surface`) and proceed to Step 2a — no ceremony for a
mechanical change.

**(2) Architecture sub-gate** — when the arc introduces a new pattern / tool / seam. The architecture
design **home is the consumer's** canonical doc set; read it from the `designHomes` key in the
consumer's `roadmap.config.json` (the consumer-agnostic seam). **If `designHomes` is absent, surface
that and STOP the gate** — no doc home to search, and guessing a path defeats the seam; the consumer
configures its design homes first. With the home bound:
1. Spawn the **`software-architect`** agent to **search** that doc set and **recommend**
   reuse-or-design — returning the recommendation + the `ref` + `summary`. Advisory: the orchestrator,
   not the architect, makes the file writes and owns the record.
2. **Reuse-first:** an existing pattern fits → the orchestrator records `{ kind: 'architecture', ref,
   status: 'reused', summary }`. No new pattern when one exists (the reuse-first honesty rail).
3. **Design-when-needed:** none fits → the architect designs the long-term-correct pattern; the
   orchestrator extends the arch doc set through the consumer's own doc governance and records
   `{ …, status: 'designed', summary }` with the justification.
3b. **Generalize-forward** (every `designed` pattern; contract in `references/design-gate.md` §2):
   "is this a special case of a capability others should have?" **Rule of three: generalize ONLY with
   ≥2 concrete named consumers** (else build the vertical + a named follow-up — never speculative
   abstraction). When earned, design the GENERAL seam; the arc's `singleSeams` widen accordingly.
4. **Confirm.** PAUSE for the user's explicit go — the user is the design gate. Don't plan against an
   unconfirmed design (the generalize-forward verdict is part of this confirm). The orchestrator writes
   the designRef(s) onto the Arc (`designRefs`, `DesignRefShape`) — the spec Step 2b plans against.

**(3) UX sub-gate** — when the classifier found a **surface** (run after the architecture sub-gate).
The UX standards are the consumer's, bound the same way: the `designHomes` config key (an absent key
fails loud — surface + STOP, don't guess — exactly as above). Then:
1. Spawn the **`ux-designer`** agent (an advisor, like the architect). It reads the consumer's UX
   canon, designs the surface's layout within it, and **decides per arc** whether a prose layout note
   or a static HTML preview is warranted (preview for a net-new surface, prose for a tweak), producing
   that artifact + a recommended UX designRef.
2. The **orchestrator** records `{ kind: 'ux', ref, status: 'reused' | 'designed', summary }` onto
   `designRefs` (`reused` = follows a canonical pattern, `designed` = a new layout).
3. **Confirm.** PAUSE for the user's explicit go — the user is the design gate. A no-surface arc skips
   this sub-gate (record the skip; never silent).
4. **Mint the paired design-parity criterion (MANDATORY).** A confirmed `ux` designRef is a CONTRACT:
   the shipped surface must match it 1:1, not "take inspiration from it". For EVERY `kind: 'ux'`
   designRef, the orchestrator adds a matching `acceptanceCriteria` entry:
   ```typescript
   {
     id: 'ux-parity:<short-ref-slug>',
     job: 'The shipped <surface> matches the confirmed design (<ref>) 1:1 — the design the user signed off is what ships.',
     surfaces: [<the surface>],
     signal: 'Side-by-side comparison (shipped surface vs the rendered design artifact — every state the design shows AND every interaction it defines, driven live: hover/focus effects, transitions, animations) judged against references/parity-rubric.md with no material deviation.',
     tier: 'live-ui',
     bar: 'Layout structure, component presence/hierarchy, states, interaction & motion (hover/focus effects, transitions/animations — same or unambiguously better, never flattened or inert), copy, and visual tokens all match; judged-equivalent allowed, missing/moved/renamed/degraded is a deviation. Ratified descopes are the only exemption.',
   }
   ```
   An arc with `ux` designRefs but no `ux-parity:*` criteria is malformed — validate-arc DERIVES the
   criterion anyway (its fail-safe), but minting it here is what lets member phases carry the
   per-phase design-parity gate stage (the thin do-phase gate section) instead of discovering drift
   only at arc end.

The confirmed `designRefs` are the design spec the rest of plan-arc builds on: Step 2b plans each
phase against them (a `ux`-citing phase inherits the design-parity gate stage), `validate-arc` judges
the paired `ux-parity:*` criteria at arc end, `arc-sweep` judges conformance.

## Step 2a: Reserve a contiguous phase-number block FIRST

Recomputing "next number" per iteration collides (each new phase file shifts the max, and across
concurrent sessions). Reserve the block ONCE, up front, via the same atomic claim `plan-phase` uses:

1. `roadmap claim` once per member phase (sum across `arc.planes`). Each call atomically locks a
   number in the shared git-common-dir claims store (creation is the lock), collision-free across
   worktrees; the arc's phases need uniqueness, not contiguity.
2. Write the claimed numbers into `arc.planes[].phases` (plane order) and re-save the `.arc.ts`, so
   `crossValidate` (planes↔phases) is correct and the phase-range label is stable.
3. Each claim frees when its `phase-N.phase.ts` commits.

Pass each explicit number into the loop so `plan-phase` never recomputes it.

## Step 2b: Plan each member phase (plan-phase --skip-review)

Loop `plan-phase` over the reserved numbers, in **dependency / plane order**:
- Pass the **explicit phase number** (Step 2a) so no recompute happens.
- Pass **`--skip-review`** — reviews are batched in Step 3, not per-phase.
- Set each phase's **`arcId`** to the arc id (accepts the same `number | string` union), always, and
  its **`plannedBy: { model: your own model id }`** — the planner is an actor too.
- **Plan AGAINST the confirmed design.** Each phase's tasks cite the architecture pattern / UX spec
  they implement (the `ref` + `summary`) so the implementation traces to the design. A phase that
  would deviate from a confirmed designRef must **re-open the design gate** (Step 1b), never silently
  diverge. A design-gate skip (mechanical arc, no `designRefs`) → this is a no-op.

Each phase is a normal `.phase.ts` (`status: 'backlog'`); the arc binds them via `planes[].phases`
(forward) + each phase's `arcId` (back). `crossValidate` keeps them consistent.

## Step 3: Fan out plan-quality review (parallel, read-mostly)

Review all member phases in parallel — one agent per phase running `review-phase` Mode A, each with
**`--no-queue`** — the same safe fan-out `do-arc` uses. It exists for one reason: Mode A's queue step
WRITES the shared `roadmap/backlog.ts`, so N concurrent reviews would race it. **Pass `model` per the
`modelPolicy.judgeModel` home statement (review-phase SKILL.md)** — these reviewers are judges.

**Edit-confinement invariant:** `--no-queue` skips ONLY the queue write. Each review agent edits ONLY
its own `roadmap/phases/phase-{N}.phase.ts` and **MUST NOT touch `roadmap/backlog.ts`** or another
phase's file. Collect each verdict (READY / NEEDS WORK / BLOCKER); only READY phases queue.

## Step 4: Place the queue entries serially (single writer, one arc tier)

After ALL reviews return, the orchestrator ALONE places the READY phases into `roadmap/backlog.ts`
— **serially, one pass** — as a single arc tier labeled with the arc + its phase range, respecting the
dependency floor + priority (review-phase Mode A Step 8 rules). **`backlog.ts` has exactly one writer:
this serial step.** A NEEDS WORK / BLOCKER phase is NOT queued — surface its findings; the user fixes
and re-reviews before it joins the tier.
