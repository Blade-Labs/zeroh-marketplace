# ADR 0002: Non-UI design

## Context and options

This product exposes an imported function and a text CLI. The installed design reference provides web/mobile mappings and a Blade handoff; none applies to the explicitly selected non-UI, non-Blade fixture. There is no applicable design-system matrix row to fabricate.

Considered applicability: text CLI contract is required; web component systems, mobile theme mappings, and Blade theme ownership are outside the supplied scope.

## Ruling: 2026-09-05

Select no visual design system. Registry: absent/none, because no UI components are consumed. Brand: non-Blade. Do not invent tokens, fonts, palette, spacing values, or branded assets. The [UX canon](../ux-canon.md) owns the text interaction contract.

## Consequences

Use plain text stdout for success and help, stderr for invalid input, and stable exit codes. No component registry, components.json, token home, or design sibling is required.

## Revisit conditions

Revisit when a rendered UI, branded visual surface, or mobile application is approved. Future visual identity and localization remain unknown.
