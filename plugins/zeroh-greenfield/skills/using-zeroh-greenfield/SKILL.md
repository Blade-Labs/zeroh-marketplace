---
name: using-zeroh-greenfield
description: Route requests phrased as init, scaffold, brownfield audit, fill gaps, or stack choice to the owning zeroh-greenfield skill.
---

# Using zeroh-greenfield

Inspect the repository before choosing exactly one route.
Not this skill: `greenfield-init`, `brownfield-audit`, and `stack-decision` own the routed workflow; this skill only dispatches. Provenance: `roadmap/arc-evals/phase-29.peval.json` records the 2026-09-04 router delivery.

## Dispatch

| Request | Skill |
| --- | --- |
| init / new repo / scaffold | greenfield-init |
| audit / fill gaps / brownfield | brownfield-audit |
| stack choice / mobile stack | stack-decision |

## Detection markers

Treat any existing marker as brownfield evidence. When markers disagree, use
`brownfield-audit`; it preserves existing homes and proposes only gaps.

| Marker | Greenfield | Brownfield |
| --- | --- | --- |
| package-manager locks | absent | one or more present |
| framework files | absent | framework config or source present |
| existing docs | absent | product, architecture, UX, or standards docs present |
| harness files | absent | AGENTS.md, CLAUDE.md, or another agent harness present |
| roadmap config | absent | roadmap.config.json present |

## Ownership boundaries

- zeroh-roadmap plans and runs phases after initialization; this plugin only
  prepares the consumer homes and pointers it needs.
- zeroh-design owns Blade tokens and themes; this plugin records pointers and
  delegates branded design work to it.
- This router alone maps triggers to zeroh-greenfield skills. Routed skills do
  not duplicate this dispatch table.
