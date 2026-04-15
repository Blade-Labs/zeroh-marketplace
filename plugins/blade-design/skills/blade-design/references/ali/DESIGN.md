# Conversational — Design System

Scholarly, warm, reading-heavy. Every decision prioritises legibility, trust, and considered breathing room.

---

## Typography

Single typeface: **Crimson Pro** (serif). Weight and size alone define hierarchy.

| Role | Size | Weight | Usage |
|---|---|---|---|
| Display | 48px | 700 | Hero headers, page titles |
| Heading 1 | 30px | 600 | Section titles, modal headers |
| Heading 2 | 24px | 600 | Card headers, panel titles |
| Heading 3 | 20px | 600 | Sub-sections, widget titles |
| Body Large | 16px | 400 | Primary readable content |
| Body | 14px | 400 | Secondary content, descriptions |
| Label / UI | 13px | 500 | Navigation, badges, buttons |
| Caption | 12px | 400 | Timestamps, metadata, footnotes |

```tsx
// Font setup in layout.tsx
import { Crimson_Pro } from 'next/font/google'
const crimsonPro = Crimson_Pro({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-crimson',
})
```

---

## Colors

Always use semantic tokens. Never use primitive hex values in components.

| Token | Value | Usage |
|---|---|---|
| `bg-background` | #F7F6F3 | App background |
| `text-foreground` | #221D15 | Primary text, headings |
| `bg-primary` | #1F5B46 | Primary buttons, active states |
| `text-primary-foreground` | #F7F6F3 | Text on primary surfaces |
| `bg-muted` | #EFEDE8 | Chips, hover backgrounds |
| `text-muted-foreground` | #7D7669 | Secondary text, metadata |
| `bg-accent` | #F5EAD0 | Gold wash accent areas |
| `border-border` | #E2DED6 | Card outlines, dividers |
| `ring-ring` | #A1C4B7 | Focus rings |
| `text-destructive` | #DC2626 | Errors, critical states |

### Sidebar tokens
| Token | Usage |
|---|---|
| `bg-sidebar` | Sidebar background |
| `text-sidebar-foreground` | Sidebar text |
| `bg-sidebar-primary` | Active nav item |
| `bg-sidebar-accent` | Hover / selected state |
| `border-sidebar-border` | Sidebar dividers |

### Logo

Ali has two distinct colour systems: **gold for the logo** and **forest green for the app UI**. Never mix them — the logo never appears in green and app UI buttons never use gold.

#### Signature lockup (primary form)

The primary Ali logo is a **composed lockup**: Icon with 3-stop metallic gold gradient + Wordmark in flat solid gold. Use this on any dark or black surface — marketing heroes, splash screens, collateral, loading screens.

| Part | Colour | Token |
|---|---|---|
| Icon (circle + A mark) | 3-stop metallic gradient, **left→right** | `var(--logo-gradient)` |
| Wordmark ("Ask Ali") | Flat solid gold | `var(--logo-solid)` |
| Background | Black or very dark | `#0A0A0A` / `var(--foreground)` |

Logo gradient stops (left → right): `--gold-700` `#70510A` → `--gold-200` `#F0D599` (bright highlight, 50%) → `--gold-500` `#C38D11`

**Critical — gradient must span the whole icon, not each path separately.**
Always use `gradientUnits="userSpaceOnUse"` with coordinates matching the SVG viewBox dimensions (`x1="0" y1="0" x2="36" y2="0"` for the 36×36 icon). The default `objectBoundingBox` maps the gradient to each path's individual bounding box, producing a broken multi-gradient effect. Example:

```svg
<defs>
  <linearGradient id="iconGold" x1="0" y1="0" x2="36" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0%"   stop-color="#70510A"/>
    <stop offset="50%"  stop-color="#F0D599"/>
    <stop offset="100%" stop-color="#C38D11"/>
  </linearGradient>
</defs>
<!-- all paths use fill="url(#iconGold)" — gradient sweeps across the full shape as one -->
```

**When generating standalone HTML or collateral** (no project asset files available), read the SVG files directly from the plugin and embed them inline. The source files are at:

- Icon: `themes/ali/assets/Icon.svg` — use with CSS mask for gradient coloring
- Wordmark: `themes/ali/assets/Logo.svg` — embed inline, set `fill` to `#DCB868`

Read these files at generation time. Do not hardcode paths like `/brand/Icon.svg` — they will not resolve in a fresh project.

#### Signature lockup — implementation

```tsx
// Signature lockup — dark background (React, assets available)
<div style={{ display: 'flex', alignItems: 'center', gap: '20px', background: '#0A0A0A', padding: '32px 40px' }}>
  {/* Icon — 3-stop gold gradient via CSS mask */}
  <div style={{
    background: 'var(--logo-gradient)',
    WebkitMask: "url('/brand/Icon.svg') no-repeat center / contain",
    mask: "url('/brand/Icon.svg') no-repeat center / contain",
    width: '52px', height: '52px', flexShrink: 0,
  }} />
  {/* Wordmark — inline SVG, fill set to --logo-solid */}
  {/* Read themes/ali/assets/Logo.svg and embed here with fill="#DCB868" */}
</div>
```

#### Other variants

| Variant | Context | Implementation |
|---|---|---|
| Signature lockup | Marketing heroes, collateral, splash, loading | Icon: `var(--logo-gradient)` · Wordmark: `var(--logo-solid)` |
| Solid primary | App nav, headers, login (light bg) | `color: var(--primary)` on wrapper |
| White | On gradient or coloured backgrounds | `color: #ffffff` on wrapper |
| Icon only | Collapsed sidebar, mobile nav, ≤ 32px | Same colour rules as lockup |
| Favicon | Browser tab, bookmarks, app icon | Icon on `#1F5B46` background, white paths |

---

### Brand gradient

The gradient is the brand's signature on marketing surfaces. Use it on hero sections, landing page CTAs, and announcement banners. Use the solid primary for all app UI.

| Token | Value |
|---|---|
| `--brand-gradient` | `linear-gradient(to right, #6FA28F, #1F5B46)` |
| `--brand-gradient-start` | `#6FA28F` (sage green) |
| `--brand-gradient-end` | `#1F5B46` (forest green) |

```tsx
// Marketing CTA — use the gradient
<a style={{ background: 'var(--brand-gradient)' }} className="text-white px-6 py-3 rounded-lg">
  Explore Ali →
</a>

// App UI button — use solid primary
<Button>Primary Action</Button>
```

---

## Components

### Buttons
```tsx
// Primary — one per view maximum
<Button>Primary Action</Button>

// Secondary
<Button variant="outline">Secondary</Button>

// Tertiary / icon buttons, nav
<Button variant="ghost">Ghost</Button>

// Destructive only
<Button variant="destructive">Delete</Button>
```
Radius: `10px` · Padding: `8px 18px` · Weight: 600 primary, 500 secondary

### Cards
```tsx
<Card className="rounded-[18px] border border-border shadow-sm p-6 bg-card">
  <h3 className="text-lg font-semibold text-foreground">Title</h3>
  <p className="text-sm text-muted-foreground mt-1">Subtitle</p>
</Card>
```
Default: warm white surface · Tinted: `bg-accent` for active/selected states

### Badges
```tsx
<Badge variant="outline">Approved</Badge>
```
Pill shape · 12px 600 · Semantic background tints at 7–10% opacity

### Inputs
```tsx
<Input placeholder="Search..." className="h-[42px] rounded-[12px]" />
```
Height: `42px` · Radius: `12px` · Focus ring: primary at 8% opacity

### Page layout
```tsx
<div className="container mx-auto px-6 py-8">
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

| Value | Usage |
|---|---|
| 4px | Micro elements |
| 8px | Buttons |
| 10px | Inputs |
| 14px | Cards (small) |
| 18px | Cards (large) |
| Full | Badges, pills |

---

## Don'ts

- Never introduce a second typeface
- Never substitute Crimson Pro for another typeface — not Inter, not a sans-serif, not "something more suited to docs"
- Never use raw hex values in components
- Never use arbitrary Tailwind spacing values
- Never use filled icons
- Never use `ease-in-out` or `linear` transitions
- Never use raw `<button>` or `<input>` elements
- Never use gray-400 for text — fails contrast on parchment background
- Never use the brand gradient on app UI buttons, links, or interactive elements — gradient is for marketing surfaces only
