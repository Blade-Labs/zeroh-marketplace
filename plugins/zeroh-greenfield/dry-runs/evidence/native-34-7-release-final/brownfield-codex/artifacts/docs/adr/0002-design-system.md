# ADR 0002: Preserve existing design evidence

## Status

Accepted for preservation; a new design system is not selected.

## Context

[Web component configuration](../../apps/web/components.json) and [UI component configuration](../../packages/ui/components.json) declare `new-york` style and TSX. These are configuration evidence, not proof of installed components or a token system.

## Ruling

Preserve both files. Introduce no Blade assets, registry, theme or invented tokens. Product accessibility requirements and interaction rules remain unspecified.

## Consequences and revisit condition

The [UX canon](../ux-canon.md) links this evidence. Revisit when concrete visual, accessibility or interaction requirements are supplied.
