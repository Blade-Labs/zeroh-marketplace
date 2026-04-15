# Design System

This project uses the **Zeroh Disclosure** design system.

## Before any UI work

Read these two files first — they define all design decisions:
- `docs/DESIGN.md` — typography, colors, components, spacing
- `docs/PRINCIPLES.md` — shared rules for all themes

## Non-negotiables

- Heading typeface: **IBM Plex Mono** — all headings use monospace; never substitute
- Body typeface: **IBM Plex Sans** — never substitute for another font
- Background: `bg-background` (off-white #F8F9FB)
- Primary: `bg-primary` (electric teal #00C8AA)
- Components: shadcn/ui only — never raw HTML elements
- Icons: Lucide React only, `strokeWidth={1.5}`
- Tokens: semantic only — never raw hex or HSL values in components

## Stack

Next.js App Router · TypeScript · Tailwind CSS v4 · shadcn/ui · Lucide React
