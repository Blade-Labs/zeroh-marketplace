# Zeroh Disclosure — Design System

Precise, deterministic, trustworthy. Every decision communicates clarity, structure, and technical authority. Monospace headings reinforce the idea that outputs are rule-based and auditable.

---

## Typography

Two typefaces: **IBM Plex Mono** (headings) + **IBM Plex Sans** (body). The pairing signals both technical precision and readable clarity.

| Role | Size | Weight | Font | Usage |
|---|---|---|---|---|
| Display | 40px | 700 | IBM Plex Mono | Hero headers, page titles |
| Heading 1 | 28px | 600 | IBM Plex Mono | Section titles, modal headers |
| Heading 2 | 22px | 600 | IBM Plex Mono | Card headers, panel titles |
| Heading 3 | 18px | 600 | IBM Plex Mono | Sub-sections, widget titles |
| Body Large | 16px | 400 | IBM Plex Sans | Primary readable content |
| Body | 14px | 400 | IBM Plex Sans | Secondary content, descriptions |
| Label / UI | 13px | 500 | IBM Plex Sans | Navigation, badges, buttons |
| Caption | 12px | 400 | IBM Plex Sans | Timestamps, metadata |
| Code | 13px | 400 | IBM Plex Mono | Inline code, technical values |

```tsx
// Font setup in layout.tsx
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-mono',
})

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans',
})
```

---

## Colors

Always use semantic tokens. Never use raw hex or HSL values in components.

| Token | Usage |
|---|---|
| `bg-background` | App background — off-white #F8F9FB |
| `text-foreground` | Primary text, headings — deep navy #0F1A2E |
| `bg-primary` | Primary buttons, active states — electric teal #00C8AA |
| `text-primary-foreground` | Text on primary surfaces — white |
| `bg-secondary` | Secondary surfaces, chips — soft teal tint |
| `bg-muted` | Hover backgrounds, subtle fills |
| `text-muted-foreground` | Secondary text, metadata |
| `bg-accent` | Accent tint areas |
| `border-border` | Card outlines, dividers — cool blue-grey tint |
| `ring-ring` | Focus rings — teal |
| `text-destructive` | Errors, critical states |

### Logo

| Variant | Context | Implementation |
|---|---|---|
| Lockup gradient | Marketing heroes, collateral, splash screens | Inline SVG with `<linearGradient>` — navy to teal, left→right |
| Lockup solid | App nav, headers, login | `color: var(--primary)` on wrapper |
| Lockup white | On dark or gradient backgrounds | `color: #ffffff` on wrapper |
| Lockup foreground | Monochrome contexts | `color: var(--foreground)` on wrapper |
| Icon only | Collapsed sidebar, mobile nav, ≤ 32px contexts | Same color rules as lockup |
| Favicon | Browser tab, bookmarks, app icon | Icon on `#00C8AA` teal background, white paths |

The navy-to-teal gradient is the signature mark of Zeroh Disclosure — use it on all premium marketing surfaces.

---

### Brand gradient

| Token | Value |
|---|---|
| `--brand-gradient` | `linear-gradient(to right, #0F1A2E, #00C8AA)` |
| `--brand-gradient-start` | `#0F1A2E` (deep navy) |
| `--brand-gradient-end` | `#00C8AA` (electric teal) |

For inline SVG gradients across multi-path marks, use `gradientUnits="userSpaceOnUse"` with coordinates matching the SVG viewBox (e.g. `x1="0" y1="0" x2="36" y2="0"` for a 36×36 icon).

```svg
<linearGradient id="iconGrad" x1="0" y1="0" x2="36" y2="0" gradientUnits="userSpaceOnUse">
  <stop offset="0%" stop-color="#0F1A2E"/>
  <stop offset="100%" stop-color="#00C8AA"/>
</linearGradient>
```

Read `themes/disclosure/assets/Icon.svg` and `themes/disclosure/assets/Logo.svg` from the plugin at generation time. Never reconstruct paths from memory.

```tsx
// Marketing CTA — use the gradient
<a style={{ background: 'var(--brand-gradient)' }} className="text-white px-6 py-3 rounded-md">
  Request Access →
</a>

// App UI button — use solid primary
<Button>Get Started</Button>
```

### Dark mode
This theme supports dark mode via the `.dark` class. Tokens automatically shift to a deep navy background with light text. Apply dark mode using the `.dark` class on the root element — never by duplicating color values.

---

## Components

### Buttons
```tsx
// Primary
<Button>Get Started</Button>

// Secondary
<Button variant="outline">Learn More</Button>

// Ghost — nav, icon actions
<Button variant="ghost">Cancel</Button>

// Destructive
<Button variant="destructive">Remove</Button>
```
Radius: `0.5rem` · Weight: 500 · Precise, controlled proportions — not rounded

### Cards
```tsx
<Card className="rounded-lg border border-border shadow-sm p-6 bg-card">
  <h3 className="text-lg font-semibold text-foreground font-mono">Title</h3>
  <p className="text-sm text-muted-foreground mt-1">Description</p>
</Card>
```
Moderate radius — precision over softness. Headings inside cards use `font-mono`.

### Badges
```tsx
<Badge className="rounded font-medium text-xs font-mono">Active</Badge>
```
Slightly rounded (not pill-shaped). Monospace text reinforces auditability.

### Inputs
```tsx
<Input placeholder="Search..." className="rounded-md h-10 font-mono text-sm" />
```
Height: `40px` · Radius: `rounded-md` · Tight, efficient feel

### Page layout
```tsx
<div className="max-w-5xl mx-auto px-6 py-8">
  {/* content */}
</div>
```

---

## Spacing

| Value | Usage |
|---|---|
| 4px | Icon gap, tight inline |
| 8px | Tag padding, minor gap |
| 12px | Card inner gap, list items |
| 16px | Standard section gap |
| 24px | Card padding |
| 32px | Between components |
| 48px | Section vertical rhythm |

---

## Border Radius

This theme uses tight radius throughout — precision is intentional.

| Value | Usage |
|---|---|
| 4px | Badges, inline elements |
| 6px | Inputs, tight contexts |
| 8px | Buttons (default) |
| 12px | Cards |
| 16px | Cards (large), modals |
| Full | Avatars, status dots only |

---

## Don'ts

- Never introduce a second body typeface
- Never substitute IBM Plex Sans or IBM Plex Mono for another font
- Never use raw hex or HSL values in components
- Never use overly rounded corners — this theme is precise, not soft
- Never use arbitrary Tailwind spacing values
- Never use filled icons
- Never use `ease-in-out` or `linear` transitions
- Never use raw `<button>` or `<input>` elements
- Never use the brand gradient on app UI buttons, links, or interactive elements — gradient is for marketing surfaces only
- Never use a sans-serif font for headings — IBM Plex Mono for all h1–h6
