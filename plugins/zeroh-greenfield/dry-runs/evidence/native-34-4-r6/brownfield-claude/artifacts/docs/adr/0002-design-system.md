# ADR 0002: Design system

## Status

Accepted

## Date

2026-09-05

## Context

`apps/web/components.json` and `packages/ui/components.json` both declare `{"style":"new-york","tsx":true}` with no registries, base color, CSS variables or icon library. No token home, theme or design documentation exists (`tokens/`, `*theme*`, `docs/**/*design*` are all absent). The repository is non-Blade, so no zeroh-design sibling handoff applies. No brand values are known.

## Options
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| Record the existing shadcn-style `components.json` evidence with registry none | Matches evidenced files; invents nothing | Leaves palette, fonts and registries undecided | Brand and product facts are unknown | Components remain source-owned in `packages/ui` | `apps/web/components.json`, `packages/ui/components.json` |
| Select a registry and token source now | Completes the design system | Requires brand inputs that do not exist | Brand values are supplied | Registry items compose locally | not evidenced |

## Ruling

2026-09-05: Record the existing `components.json` evidence (style `new-york`, `tsx`) as the design-system state; selected registry is none; no tokens or brand values are invented; neither `components.json` is edited.

For Blade, store pointers only; tokens are owned by zeroh-design. Not applicable: this repository is non-Blade.

## Consequences

- Positive: `docs/ux-canon.md` links real evidenced homes.
- Negative: visual language remains undecided until brand inputs are supplied.

## Revisit when

A registry, token source or brand input is approved, or either `components.json` changes.
