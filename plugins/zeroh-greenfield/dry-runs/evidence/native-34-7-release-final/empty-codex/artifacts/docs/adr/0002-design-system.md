# ADR 0002: Design system

## Status and date

Accepted after separate greenfield plan approval; 2026-09-05.

## Context and options

The user selected a non-Blade imported API and terminal CLI. The installed design-system reference's web/mobile choices do not apply. The supplied applicable choice is no UI design system, registry absent/none. See [PRD](../PRD.md).

## Ruling

2026-09-05: no UI design system; registry absent/none because there are no graphical components. Do not invent fonts, palette, spacing or tokens. [UX canon](../ux-canon.md) owns terminal behavior. No Blade handoff is needed.

## Consequences

No component framework or design runtime. Plain text, stdout/stderr and exit codes define interaction. Future visual branding remains unknown.

## Revisit when

An approved requirement adds the first graphical surface or Blade branding.
