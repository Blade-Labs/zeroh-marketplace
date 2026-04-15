# Design System

This project uses the **Blade Labs Corporate** design system.

## Before any UI work

Read these two files first — they define all design decisions:
- `docs/DESIGN.md` — typography, colors, components, spacing
- `docs/PRINCIPLES.md` — shared rules for all themes

## Non-negotiables

- Typeface: **Inter** — never substitute for another font
- Background: `bg-background` (white #ffffff)
- Primary: `bg-primary` (indigo #4f39f6)
- Brand gradient: `var(--brand-gradient)` — marketing surfaces only (hero, landing CTA, banners)
- Components: shadcn/ui only — never raw HTML elements
- Icons: Lucide React only, `strokeWidth={1.5}`
- Tokens: semantic only — never raw hex values in components

## Stack

Next.js App Router · TypeScript · Tailwind CSS v4 · shadcn/ui · Lucide React
