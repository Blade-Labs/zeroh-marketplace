# Core Principles

Shared rules that apply to every theme. These never change regardless of which theme you are using.

---

## Component Library

Always use **shadcn/ui** components. Never use raw HTML equivalents.

| Need | Use |
|---|---|
| Button | `<Button>` — never `<button>` |
| Input | `<Input>` — never `<input>` |
| Card | `<Card>` — never `<div className="card">` |
| Dialog | `<Dialog>` — never custom modal |
| Badge | `<Badge>` — never custom pill |
| Table | `<Table>` — never custom table |

If a component is not installed, ask Claude to install it first via `npx shadcn@latest add [component]`.

---

## Icons

- **Lucide React exclusively** — no other icon libraries
- Stroke only — never filled icons
- `strokeWidth={1.5}` on all icons
- `18px` navigation and primary UI
- `16px` inline with text
- `14px` compact or dense contexts
- Always use `currentColor` — never hardcode icon color

```tsx
import { Search, FileText } from "lucide-react"

<Search size={18} strokeWidth={1.5} />
```

---

## Token Architecture

Three layers. Always follow this order — never skip a layer.

```
L1 Primitives   → raw hex values in :root
L2 Semantics    → role-based tokens referencing primitives
L3 Tailwind     → utility classes exposing semantic tokens
```

**Always use semantic tokens in components. Never use primitive values directly.**

```tsx
// ✅ Correct
<div className="bg-primary text-primary-foreground">

// ❌ Wrong
<div className="bg-[#1F5B46] text-[#F7F6F3]">
```

---

## Motion

All themes share the same motion language.

| Property | Value |
|---|---|
| Standard transition | 150ms ease-out |
| Enter (modals, panels) | 200ms ease-out |
| Exit (dismissals) | 120ms ease-out |

- `ease-out` only — never `linear`, never `ease-in-out`
- No bouncing, springing, or wiggling
- No attention-seeking animations
- Loading states use simple opacity pulse only

---

## Spacing

All themes use a **4px base scale**. Stick to these steps only.

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96px`

In Tailwind: `p-1 · p-2 · p-3 · p-4 · p-6 · p-8 · p-12 · p-16 · p-24`

Never use `p-5`, `p-7`, `p-9`, or arbitrary values like `p-[22px]`.

---

## Universal Don'ts

- Never hardcode hex values in components
- Never use arbitrary Tailwind values like `w-[437px]`
- Never mix icon libraries
- Never use raw HTML form elements instead of shadcn
- Never use `ease-in-out` or `linear` transitions
- Never use inline styles
- Never substitute the theme typeface — use exactly what `DESIGN.md` specifies, regardless of use case
