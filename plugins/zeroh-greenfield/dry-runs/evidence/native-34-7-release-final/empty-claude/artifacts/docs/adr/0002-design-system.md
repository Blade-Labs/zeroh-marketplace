# ADR 0002: Design system

## Status

Accepted

## Date

2026-09-05

## Context

Non-Blade fixture with no graphical surface: the only user-facing output is CLI text on stdout and stderr. No brand, platform UI or accessibility needs beyond readable terminal text.

## Options
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| shadcn/ui | Source-owned accessible components | Consumer maintains copied components | Tailored product UI needs full control | Components and registry items compose locally | https://ui.shadcn.com/docs |
| Radix Themes | Cohesive accessible component theme | Stronger visual conventions | Fast consistent UI matters more than source ownership | Theme primitives compose across screens | @radix-ui/themes |
| MUI | Broad mature component suite | Larger runtime and opinionated styling | Enterprise UI needs extensive ready-made widgets | Shared theme and component packages | @mui/material |

## Ruling

2026-09-05: none — no design system is adopted because there is no UI; the CLI text contract is recorded in `docs/ux-canon.md`, and no tokens, fonts, palette or spacing are invented.

For Blade, store pointers only; tokens are owned by zeroh-design.

## Consequences

- Positive: no UI dependency and no token source to keep in sync; `designHomes.ux.bindingDesignSystem` stays absent in `roadmap/roadmap.config.json`.
- Negative: any future graphical surface must reopen this decision before UI code is written.

## Revisit when

A web or mobile surface is planned, or Blade branding is requested (then invoke zeroh-design and store only its pointers).
