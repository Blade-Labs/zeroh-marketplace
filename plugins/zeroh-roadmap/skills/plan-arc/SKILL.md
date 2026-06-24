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
