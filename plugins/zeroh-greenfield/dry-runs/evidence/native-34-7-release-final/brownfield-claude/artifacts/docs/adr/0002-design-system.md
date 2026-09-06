# ADR 0002: Design system

## Status

Accepted

## Date

2026-09-05

## Context

Two configuration files exist: `apps/web/components.json` and `packages/ui/components.json`, each containing only `style: new-york` and `tsx: true`. That shape matches a shadcn/ui `components.json`, but it is the only evidence. No shadcn/ui, Radix or Tailwind dependency appears in `package-lock.json`, no component sources, registry configuration, token home, theme files or Blade brand pointers exist, and nothing proves that `apps/web` consumes `packages/ui` or that either project shares a registry. This record preserves the observed configuration as evidence; it does not invent tokens, values, installed components or ownership.

## Options
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| shadcn/ui (matches the observed components.json shape) | Source-owned accessible components; the observed style new-york / tsx configuration fits it | Installation, registry and consumer relationships are not proven in this repository | Tailored product UI needs full control | Components would compose locally once actually installed | https://ui.shadcn.com/docs |
| Radix Themes | Cohesive accessible component theme | Stronger visual conventions; not present | Fast consistent UI matters more than source ownership | Theme primitives compose across screens | @radix-ui/themes |
| MUI | Broad mature component suite | Larger runtime and opinionated styling; not present | Enterprise UI needs extensive ready-made widgets | Shared theme and component packages | @mui/material |

## Ruling

2026-09-05: no new design system is selected. The observed `components.json` configuration (style new-york, tsx true) in `apps/web` and `packages/ui` is recorded as evidence consistent with shadcn/ui; actual installed components, registry ownership and the `apps/web` to `packages/ui` relationship remain unknown until proven by dependencies or sources. Reason: a brownfield audit records repository facts and never infers a runtime.

For Blade, store pointers only; tokens are owned by zeroh-design. This workspace is non-Blade, so no zeroh-design pointer applies.

## Consequences

- Positive: `docs/ux-canon.md` can point at the observed configuration homes without asserting more than the repository shows.
- Negative: visual tokens, themes, copy rules, installed component sets and registry ownership stay unknown until an owner records or installs them.

## Revisit when

A UI dependency is locked, component sources or a registry configuration are added, a token or theme home appears, a Blade brand handoff is approved, or the `components.json` files change or disappear.
