# ADR 0002: Design system

## Status

Accepted

## Date

<YYYY-MM-DD>

## Context

<brand-platform-and-accessibility-needs>

## Options
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| shadcn/ui | Source-owned accessible components | Consumer maintains copied components | Tailored product UI needs full control | Components and registry items compose locally | https://ui.shadcn.com/docs |
| Radix Themes | Cohesive accessible component theme | Stronger visual conventions | Fast consistent UI matters more than source ownership | Theme primitives compose across screens | @radix-ui/themes |
| MUI | Broad mature component suite | Larger runtime and opinionated styling | Enterprise UI needs extensive ready-made widgets | Shared theme and component packages | @mui/material |

## Ruling

<YYYY-MM-DD>: <selected-option> — <reason>

For Blade, store pointers only; tokens are owned by zeroh-design.

## Consequences

<positive-and-negative-consequences>

## Revisit when

<measurable-revisit-condition>
