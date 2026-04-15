# Blade Labs Corporate — Design System

Digital-first, precise, indigo-primary. Every decision prioritises information density, clarity, and confident authority. Clean and modern — never cold.

Source of truth: bladelabs.io

---

## Typography

Single typeface: **Inter** (neutral geometric sans). The standard for data-dense product UI — highly legible at small sizes, authoritative at display scale.

| Role        | Size  | Weight | Usage                              |
|-------------|-------|--------|------------------------------------|
| Display     | 32px  | 700    | Page titles, hero metrics          |
| Heading 1   | 24px  | 600    | Section titles, panel headers      |
| Heading 2   | 18px  | 600    | Card headers, widget titles        |
| Heading 3   | 15px  | 600    | Sub-sections, table headers        |
| Body        | 14px  | 400    | Primary content, descriptions      |
| Body Small  | 13px  | 400    | Secondary content, metadata        |
| Label / UI  | 12px  | 500    | Navigation, badges, axis labels    |
| Caption     | 11px  | 400    | Timestamps, footnotes              |

Sizes are intentionally compact — density is a feature, not a compromise.

```tsx
// Font setup in layout.tsx
import { Inter } from 'next/font/google'
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
})
```

---

## Colors

White background with indigo primary and slate neutrals. Digital and authoritative — clean without feeling sterile.

Always use semantic tokens. Never use raw hex values in components.

| Token                        | Value     | Usage                                |
|------------------------------|-----------|--------------------------------------|
| `bg-background`              | #ffffff   | App background — white               |
| `text-foreground`            | #020817   | Primary text — near-black            |
| `bg-primary`                 | #4f39f6   | Primary actions — indigo             |
| `text-primary-foreground`    | #ffffff   | Text on primary surfaces             |
| `bg-secondary`               | #f1f5f9   | Secondary surfaces — slate-100       |
| `bg-muted`                   | #f1f5f9   | Muted backgrounds, row stripes       |
| `text-muted-foreground`      | #62748e   | Secondary text, metadata             |
| `bg-accent`                  | #e0e7ff   | Indigo wash, highlights              |
| `accent-foreground`          | #020817   | Text on accent surfaces              |
| `border-border`              | #e2e8f0   | Dividers, card outlines              |
| `ring-ring`                  | #4f39f6   | Focus rings — indigo                 |
| `text-destructive`           | #e7000b   | Errors, critical states              |

### Logo

| Variant | Context | Implementation |
|---|---|---|
| Lockup gradient | Marketing heroes, collateral, splash screens | CSS mask + `var(--brand-gradient)` |
| Lockup solid | App nav, headers, login | `color: var(--primary)` on wrapper |
| Lockup white | On dark or gradient backgrounds | `color: #ffffff` on wrapper |
| Icon only | Collapsed sidebar, mobile nav, ≤ 32px contexts | Same color rules as lockup |
| Favicon | Browser tab, bookmarks, app icon | Icon on `#4f39f6` solid background, white paths |

The slate-violet to deep-indigo gradient on the mark is the signature of Blade Labs Corporate — use it on all marketing surfaces.

---

### Brand gradient

The gradient is the brand's signature mark. Use it on marketing surfaces only — hero sections, landing page CTAs, announcement banners, section backgrounds. Never on app UI buttons or interactive elements within dashboards.

| Token                    | Value                                        |
|--------------------------|----------------------------------------------|
| `--brand-gradient`       | `linear-gradient(to right, #6e70a1, #2622b2)` |
| `--brand-gradient-start` | `#6e70a1` (slate-violet)                     |
| `--brand-gradient-end`   | `#2622b2` (deep indigo)                      |

```tsx
// Marketing CTA — use the gradient
<a style={{ background: 'var(--brand-gradient)' }} className="text-white px-6 py-3 rounded-lg">
  Schedule a Demo
</a>

// App UI button — use solid primary
<Button className="bg-primary text-primary-foreground">
  Run Report
</Button>
```

### Data visualisation
| Token       | Value     | Usage                    |
|-------------|-----------|--------------------------|
| `--chart-1` | #4f39f6   | Indigo — primary series  |
| `--chart-2` | #009966   | Teal — secondary series  |
| `--chart-3` | #9810fa   | Violet — tertiary series |
| `--chart-4` | #e7000b   | Red — alert series       |
| `--chart-5` | #62748e   | Slate — neutral series   |

---

## Components

### Buttons
```tsx
// Primary — app UI (solid)
<Button className="h-8 text-xs px-3">Run Report</Button>

// Marketing CTA (gradient — landing pages only)
<a style={{ background: 'var(--brand-gradient)' }}
   className="inline-flex items-center px-6 py-3 rounded-lg text-white text-sm font-medium">
  Schedule a Demo →
</a>

// Secondary
<Button variant="outline" className="h-8 text-xs px-3">Export</Button>

// Ghost — table actions, inline controls
<Button variant="ghost" className="h-7 text-xs px-2">Edit</Button>
```
Smaller than default — `h-8` standard, `h-7` compact. Radius: `6px`. Weight: 500.

### Cards
```tsx
<Card className="rounded-lg border border-border shadow-none p-4 bg-card">
  <h3 className="text-sm font-semibold text-foreground">Metric Title</h3>
  <p className="text-xs text-muted-foreground mt-0.5">Subtitle</p>
</Card>
```
No shadow — borders define surfaces. Tighter padding than other themes.

### Badges
```tsx
<Badge variant="outline" className="text-[11px] font-medium rounded-md px-1.5">
  Active
</Badge>
```
Slightly squared — `rounded-md` not pill. Compact and informational.

### Inputs
```tsx
<Input placeholder="Filter..." className="h-8 rounded-md text-sm" />
```
Height: `32px` · Radius: `rounded-md` · Compact, efficient

### Tables
Tables are first-class citizens in this theme.
```tsx
<Table>
  <TableHeader>
    <TableRow className="bg-muted">
      <TableHead className="text-xs font-medium text-muted-foreground h-8">Column</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow className="hover:bg-muted/50 border-b border-border">
      <TableCell className="text-sm py-2">Value</TableCell>
    </TableRow>
  </TableBody>
</Table>
```
Row height: `40px` default, `32px` compact. Subtle stripe with `bg-muted` on header.

### Page layout
```tsx
<div className="max-w-7xl mx-auto px-4 py-6">
  {/* wider max-width, tighter padding than other themes */}
</div>
```

---

## Spacing

Tighter than Ali and Zeroh GRC — density is intentional.

| Value | Usage                                          |
|-------|------------------------------------------------|
| 4px   | Icon gap, tight inline, table cell padding     |
| 8px   | Tag padding, compact card gap                  |
| 12px  | Card padding (compact), list items             |
| 16px  | Card padding (default), section gap            |
| 24px  | Between components                             |
| 32px  | Section vertical rhythm                        |
| 48px  | Major page sections                            |

---

## Border Radius

More restrained than other themes — precision over softness.

| Value | Usage                              |
|-------|------------------------------------|
| 4px   | Badges, tight elements             |
| 6px   | Buttons                            |
| 8px   | Inputs, cards (compact)            |
| 12px  | Cards (default), modals            |
| Full  | Only for avatars, status dots      |

---

## Data visualisation rules

- Minimal grid lines — use `stroke-dasharray` subtle dashes only
- Precise axis labels at `11px` caption size
- Use `--chart-*` tokens only — never custom colors per chart
- No decorative chart elements — no gradients, no shadows on bars
- Always include a legend when more than one series

---

## Don'ts

- Never introduce a second typeface
- Never substitute Inter for another typeface
- Never use raw hex values in components
- Never use pill-shaped badges — this theme is precise not playful
- Never use large padding or generous whitespace where compact works
- Never use arbitrary Tailwind spacing values
- Never use filled icons
- Never add decorative elements to charts
- Never use `ease-in-out` or `linear` transitions
- Never use raw `<button>` or `<input>` elements
- Never use the brand gradient on app UI buttons or interactive elements
