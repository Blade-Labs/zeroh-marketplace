# ADR 0002: Design system

## Status

Accepted

## Date

2026-09-05

## Context

greenfield-proof is a library plus a command-line adapter with no user interface: its only surfaces are exported functions and text on stdout and stderr. It is non-Blade, so no sibling design handoff applies, and no brand values exist. Platforms: Node 22+ on Linux; mobile: none.

## Options
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| shadcn/ui | Source-owned accessible components | Consumer maintains copied components | Tailored product UI needs full control | Components and registry items compose locally | https://ui.shadcn.com/docs |
| Radix Themes | Cohesive accessible component theme | Stronger visual conventions | Fast consistent UI matters more than source ownership | Theme primitives compose across screens | @radix-ui/themes |
| MUI | Broad mature component suite | Larger runtime and opinionated styling | Enterprise UI needs extensive ready-made widgets | Shared theme and component packages | @mui/material |

## Ruling

2026-09-05: No design system — the package has no UI surface, so none of the options applies; the selected registry is none, and no tokens, themes, fonts, palette, or spacing values are invented. The UX canon records the CLI text contract instead.

For Blade, store pointers only; tokens are owned by zeroh-design. Not applicable: this repository is non-Blade.

## Consequences

- Positive: no UI dependency, token home, or registry to maintain.
- Negative: if a UI surface is ever added, a design-system decision must be made from these options before any component is written.

## Revisit when

Any web, mobile, or terminal UI component beyond plain text output is proposed, or Blade branding is requested.
