# Zeroh GRC — Design System

Organic, friendly, approachable. Every decision prioritises warmth, accessibility, and a sense of ease.

---

## Typography

Single typeface: **Quicksand** (soft geometric sans). Rounded terminals make it feel friendly at every size.

| Role | Size | Weight | Usage |
|---|---|---|---|
| Display | 40px | 700 | Hero headers, page titles |
| Heading 1 | 28px | 600 | Section titles, modal headers |
| Heading 2 | 22px | 600 | Card headers, panel titles |
| Heading 3 | 18px | 600 | Sub-sections, widget titles |
| Body Large | 16px | 500 | Primary readable content |
| Body | 14px | 400 | Secondary content, descriptions |
| Label / UI | 13px | 600 | Navigation, badges, buttons |
| Caption | 12px | 400 | Timestamps, metadata |

```tsx
// Font setup in layout.tsx
import { Quicksand } from 'next/font/google'
const quicksand = Quicksand({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-quicksand',
})
```

---

## Colors

Always use semantic tokens. Never use raw hex or HSL values in components.

| Token | Usage |
|---|---|
| `bg-background` | App background — clean white |
| `text-foreground` | Primary text, headings — near-black |
| `bg-primary` | Primary buttons, active states — fresh green |
| `text-primary-foreground` | Text on primary surfaces |
| `bg-secondary` | Secondary surfaces, chips |
| `bg-muted` | Hover backgrounds, subtle fills |
| `text-muted-foreground` | Secondary text, metadata |
| `bg-accent` | Accent tint areas |
| `border-border` | Card outlines, dividers — soft green tint |
| `ring-ring` | Focus rings — primary green |
| `text-destructive` | Errors, critical states |

### Logo

| Variant | Context | Implementation |
|---|---|---|
| Lockup gradient | Marketing heroes, collateral, splash screens | CSS mask + `var(--brand-gradient)` |
| Lockup solid | App nav, headers, login | `color: var(--primary)` on wrapper |
| Lockup white | On dark or gradient backgrounds | `color: #ffffff` on wrapper |
| Icon only | Collapsed sidebar, mobile nav, ≤ 32px contexts | Same color rules as lockup |
| Favicon | Browser tab, bookmarks, app icon | Icon on `#009966` solid background, white paths |

The teal-to-green gradient on the icon is the signature mark of Zeroh GRC — use it on all premium marketing surfaces.

---

### Brand gradient

The gradient is the brand's signature on marketing surfaces. Use it on hero sections, landing page CTAs, and announcement banners. Use the solid primary for all app UI.

| Token | Value |
|---|---|
| `--brand-gradient` | `linear-gradient(to right, #00bc7d, #009966)` |
| `--brand-gradient-start` | `#00bc7d` (bright teal) |
| `--brand-gradient-end` | `#009966` (deep green) |

```tsx
// Marketing CTA — use the gradient
<a style={{ background: 'var(--brand-gradient)' }} className="text-white px-6 py-3 rounded-xl">
  Start Your Journey →
</a>

// App UI button — use solid primary
<Button>Get Started</Button>
```

### Dark mode
This theme supports dark mode via the `.dark` class. Tokens automatically shift to a deep forest background with light text. Claude should apply dark mode using the `.dark` class on the root element — never by duplicating color values.

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
Radius: `0.85rem` · Weight: 600 · Slightly larger padding than default for friendliness

### Cards
```tsx
<Card className="rounded-2xl border border-border shadow-sm p-6 bg-card">
  <h3 className="text-lg font-semibold text-foreground">Title</h3>
  <p className="text-sm text-muted-foreground mt-1">Description</p>
</Card>
```
Generous radius — this theme is soft, not sharp.

### Badges
```tsx
<Badge className="rounded-full font-semibold text-xs">Active</Badge>
```
Always pill-shaped. Use semantic background tints.

### Inputs
```tsx
<Input placeholder="Search..." className="rounded-xl h-11" />
```
Height: `44px` · Radius: `rounded-xl` · Friendly, open feel

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

This theme uses generous radius throughout — softness is intentional.

| Value | Usage |
|---|---|
| 8px | Small elements, tight contexts |
| 12px | Buttons, inputs |
| 16px | Cards (default) |
| 24px | Cards (large), modals |
| Full | Badges, pills, avatars |

---

## Don'ts

- Never introduce a second typeface
- Never substitute Quicksand for another typeface
- Never use raw hex or HSL values in components
- Never use sharp corners — this theme is soft
- Never use arbitrary Tailwind spacing values
- Never use filled icons
- Never use `ease-in-out` or `linear` transitions
- Never use raw `<button>` or `<input>` elements
- Never use the brand gradient on app UI buttons, links, or interactive elements — gradient is for marketing surfaces only
