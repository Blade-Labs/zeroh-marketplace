# Design System

This project uses the **Zeroh GRC** design system.

## Before any UI work

Read these two files first — they define all design decisions:
- `docs/DESIGN.md` — typography, colors, components, spacing
- `docs/PRINCIPLES.md` — shared rules for all themes

## Non-negotiables

- Typeface: **Quicksand** — never substitute for another font
- Background: `bg-background` (clean white)
- Primary: `bg-primary` (fresh green)
- Components: shadcn/ui only — never raw HTML elements
- Icons: Lucide React only, `strokeWidth={1.5}`
- Tokens: semantic only — never raw hex or HSL values in components

## Stack

Next.js App Router · TypeScript · Tailwind CSS v4 · shadcn/ui · Lucide React
