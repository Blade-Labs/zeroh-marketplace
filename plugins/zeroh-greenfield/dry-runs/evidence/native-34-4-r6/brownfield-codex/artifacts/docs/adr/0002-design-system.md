# ADR 0002: Design system

## Status

Existing evidence recorded; no new design system selected.

## Date

2026-09-05

## Context

[Web component metadata](../../apps/web/components.json) and [UI component metadata](../../packages/ui/components.json) both declare style new-york and tsx true. These metadata files do not prove installed components, a runtime framework, or a token implementation.

## Ruling

Preserve both files byte-identically. This private, unlicensed fixture is non-Blade, has no mobile scope, and has no selected registry. No registry, external asset, font, token set, or component installation is approved by this repair.

## Consequences

Fonts, palette, spacing, interaction rules, accessibility requirements, component provenance, and a binding token home remain unknown or absent. The [UX canon](../ux-canon.md) records these gaps without inventing values.

## Revisit when

Approved product and design requirements identify an actual component implementation and canonical token owner.
