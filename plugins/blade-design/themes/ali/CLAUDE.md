# Design System

This project uses the **Ali** design system.

## Before any UI work

Read these two files first — they define all design decisions:
- `docs/DESIGN.md` — typography, colors, components, spacing
- `docs/PRINCIPLES.md` — shared rules for all themes

## Non-negotiables

- Typeface: **Crimson Pro** — never substitute for Inter, any sans-serif, or any other font
- Background: `bg-background` (warm parchment #F7F6F3) — never plain white
- Primary: `bg-primary` (forest green #1F5B46)
- Components: shadcn/ui only — never raw HTML elements
- Icons: Lucide React only, `strokeWidth={1.5}`
- Tokens: semantic only — never raw hex values in components

## Stack

Next.js App Router · TypeScript · Tailwind CSS v4 · shadcn/ui · Lucide React
