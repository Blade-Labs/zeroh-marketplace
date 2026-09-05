---
name: using-zeroh-greenfield
description: Route requests phrased as init, scaffold, brownfield audit, fill gaps, or stack choice to the owning zeroh-greenfield skill.
---

# Using zeroh-greenfield

Inspect the repository before choosing exactly one route; return the dispatch contract below and do not execute the routed workflow.
Not this skill: delegate routed work to `greenfield-init`, `brownfield-audit`, or `stack-decision`; keep only initial trigger routing here. Use `roadmap/arc-evals/phase-29.peval.json` as the 2026-09-04 delivery evidence.

## Dispatch

| Request | Skill |
| --- | --- |
| init / new repo / scaffold | greenfield-init |
| audit / fill gaps / brownfield | brownfield-audit |
| stack choice / mobile stack | stack-decision |

Return exactly one object:

```json
{"route":"greenfield-init|brownfield-audit|stack-decision","evidence":["<repository-relative-path>"]}
```

Define `<repository-relative-path>` as an inspected marker path. If inspection cannot resolve the repository root, STOP with `route: unresolved` and the attempted path; this STOP is honor-system.

## Detection markers

Treat any existing marker as brownfield evidence. When markers disagree, use
`brownfield-audit`; it preserves existing homes and proposes only gaps.
Apply the canonical detection procedure in `../brownfield-audit/references/marker-table.md`; its root resolver refusal enforces ambiguous-root failure, while route selection remains honor-system.

| Marker | Greenfield | Brownfield |
| --- | --- | --- |
| package-manager locks | absent | one or more present |
| framework files | absent | framework config or source present |
| existing docs | absent | product, architecture, UX, or standards docs present |
| harness files | absent | AGENTS.md, CLAUDE.md, or another agent harness present |
| roadmap config | no marked root | canonical resolver finds a marked root or config (see `../brownfield-audit/references/marker-table.md`) |

## Ownership boundaries

- Delegate post-initialization phase planning and execution to `zeroh-roadmap`; prepare only the consumer homes and pointers it needs.
- Delegate Blade tokens, themes, and branded design work to `zeroh-design`; record only its pointers.
- Keep the trigger map in this router. Treat both ownership rules as honor-system; each routed skill names this router as the reverse boundary.
