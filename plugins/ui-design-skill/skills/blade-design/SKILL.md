---
name: blade-design
description: Blade Labs branded UI and collateral generator. Use when building any frontend UI — pages, components, dashboards, apps, landing pages — or creating marketing collateral such as social cards, announcement banners, or branded assets.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design System Check

Before applying any aesthetic guidance, determine which of three paths applies:

**Path 1 — Project has a design system (repo context)**
If a `CLAUDE.md` exists in the project root, read it. It will reference a `DESIGN.md` and `PRINCIPLES.md`. Defer all typography, color, spacing, and aesthetic decisions to those files. Apply this skill for component structure and patterns only.

**Path 2 — No project files, theme and stack inferred**
If no `CLAUDE.md` exists, infer both the theme and the stack from the request, then surface both as a single confirmation line before generating anything.

**Brand inference:**
- Reading-heavy, AI assistants, document tools, knowledge bases, Shariah → **Ali**
- Health, wellness, consumer products, onboarding → **Zeroh GRC**
- Cloud privacy, document disclosure, compliance workflows, audit trails, access logs, deterministic tools → **Zeroh Disclosure**
- Dashboards, internal tools, data products, admin panels, compliance, GRC → **Blade Labs Corporate**

If no brand signal is present and no `CLAUDE.md` exists, ask the user which brand to use before building.

**Stack inference:**
- Signals for **Next.js + shadcn**: mentions of Next.js, shadcn, App Router, `npx shadcn`, or the project has a `package.json` with these dependencies
- Signals for **React (no shadcn)**: mentions of React, Vite, CRA, `.jsx`/`.tsx` files, but no shadcn dependency or explicit exclusion
- Default to **Next.js + shadcn** when no stack signal exists at all

When both are inferred, announce both together before generating:

> *"Going with **Blade Labs Corporate** + **React (no shadcn)** — data dashboard, no shadcn detected. Good?"*

If only brand is clear but stack is ambiguous, ask once alongside the brand confirmation:

> *"Going with **Ali** for this. Are you using Next.js + shadcn or plain React?"*

Once confirmed (or if the user just continues prompting), load the bundled references for the chosen theme:
- `references/[theme]/DESIGN.md` — full design system
- `references/core/PRINCIPLES.md` — shared rules

Treat these exactly as on-disk files in Path 1. The `references/[theme]/globals.css` is also available if token values are needed.

**Design decisions in DESIGN.md are non-negotiable.** Never substitute, rationalize away, or override any typeface, color, spacing, or token — even if you believe a different choice would be better suited to the use case. If DESIGN.md specifies Crimson Pro, use Crimson Pro. If it specifies a parchment background, use it. Your aesthetic preferences do not apply in Path 1 or Path 2.

If the user corrects the theme or stack, switch immediately and reload before generating.

**Stack adaptation rules (tokens-only):**
When the stack is **React (no shadcn)**, apply all theme tokens, typography, spacing, and color decisions exactly as specified in `DESIGN.md` — but use raw HTML elements with Tailwind utility classes instead of shadcn components. Never import from `@/components/ui`. The design system still applies in full; only the component primitives change.

| shadcn | React (no shadcn) |
|---|---|
| `<Button>` | `<button className="...">` |
| `<Card>` | `<div className="...">` |
| `<Input>` | `<input className="...">` |
| `<Badge>` | `<span className="...">` |
| `<Table>` | `<table className="...">` |
| `<Dialog>` | Custom modal div with backdrop |

All token values (colors, radius, spacing) remain identical — only the element type changes.

**Path 3 — No design system, no theme signal**
Proceed with the full freestyle aesthetic guidance below.

---

## Design Thinking & Aesthetics

**Path 3 only.** Load `references/core/AESTHETICS.md` for creative direction, aesthetic guidelines, and component-specific design principles.

---

## Collateral & Static Branded Assets

When the request is for a **standalone visual** rather than a UI component or app page — social cards, announcement banners, LinkedIn images, event posters, PR assets — output a **single self-contained HTML file** with no external dependencies except Google Fonts.

**Rules for collateral output:**
- Skip the stack confirmation (no Next.js / shadcn question — it's always plain HTML)
- Still confirm the brand: *"Going with **Blade Labs Corporate** for this announcement card. Good?"*
- Inline all CSS as a `<style>` block — no external stylesheets
- Use Google Fonts CDN for the brand typeface
- Inline the `Logo.svg` directly — do not use `<img src>` for the logo
- Apply the brand's exact tokens: primary color, background, typography scale, and `--brand-gradient` for marketing surfaces
- For announcement cards, social banners, and event posters — use `var(--brand-gradient)` as the hero background; use `var(--primary)` for accent text or secondary elements
- Output at the requested dimensions via a fixed-size wrapper (e.g. `width:1200px; height:627px` for LinkedIn)
- The file must open directly in Chrome with no build step

**Common collateral sizes:**
| Format | Dimensions |
|---|---|
| LinkedIn post image | 1200 × 627px |
| Twitter/X card | 1200 × 675px |
| Instagram square | 1080 × 1080px |
| Presentation slide | 1920 × 1080px |
| Email banner | 600 × 200px |

**Figma handoff:** Users with the Figma MCP plugin can push the rendered HTML directly to Figma for final edits and export.

---

## Brand Assets

Every brand ships two SVG files. **Always use these — never create placeholder logos, inline text substitutes, or recreate marks from scratch.**

| Brand | Logo (wordmark) | Icon (mark) |
|---|---|---|
| Ali | `themes/ali/assets/Logo.svg` | `themes/ali/assets/Icon.svg` |
| Zeroh GRC | `themes/zeroh/assets/Logo.svg` | `themes/zeroh/assets/Icon.svg` |
| Zeroh Disclosure | `themes/disclosure/assets/Logo.svg` | `themes/disclosure/assets/Icon.svg` |
| Blade Labs Corporate | `themes/corporate/assets/Logo.svg` | `themes/corporate/assets/Icon.svg` |

### Logo hierarchy

Three variants — use the right one for the context:

| Variant | What it is | When to use |
|---|---|---|
| **Lockup** | Icon + Wordmark composed side-by-side | Nav bars, page headers, login screens, marketing heroes, collateral — the primary form |
| **Icon only** | The mark alone | Sidebar (collapsed state), mobile nav, favicon, avatar slots, any context ≤ 32px wide |
| **Wordmark only** | Text alone | Wide-but-short spaces where the icon cannot fit legibly (rare) |

The lockup is always the first choice when space allows. Only drop to Icon-only when the container genuinely cannot fit the wordmark.

### Color variants

Four variants — choose based on the background surface:

| Variant | When to use | How |
|---|---|---|
| **Brand gradient** | Marketing heroes, landing CTAs, announcement banners, collateral | CSS mask + `var(--brand-gradient)` |
| **Solid primary** | App UI on light backgrounds — nav, header, login, product pages | `color: var(--primary)` on container |
| **White** | On dark surfaces or on gradient backgrounds | `color: #ffffff` on container |
| **Foreground** | Monochrome contexts, print | `color: var(--foreground)` on container |

**On gradient backgrounds, always use the white variant.** Never place the gradient logo on a gradient background.

### Implementation: solid color (`currentColor`)

All SVG paths use `fill="currentColor"`. Color is controlled entirely by the CSS `color` property of the wrapper — no SVG edits needed:

```jsx
// App nav — solid primary
<div style={{ color: 'var(--primary)' }}>
  {/* inline SVG — renders in brand primary */}
</div>

// On dark or gradient surface — white
<div style={{ color: '#ffffff' }}>
  {/* same SVG — renders white */}
</div>

// Tailwind
<div className="text-primary">...</div>
```

### Implementation: gradient (CSS mask)

Use CSS `mask` to apply the brand gradient through the SVG shape. The SVG is referenced as a URL (not inlined), so it must be accessible at a public path. In Next.js projects `setup.sh` copies assets to `public/brand/`.

```jsx
// Gradient lockup — marketing hero
<div
  style={{
    background: 'var(--brand-gradient)',
    WebkitMask: "url('/brand/Logo.svg') no-repeat center / contain",
    mask: "url('/brand/Logo.svg') no-repeat center / contain",
    width: '200px',
    height: '42px',
  }}
/>

// Gradient icon — standalone mark
<div
  style={{
    background: 'var(--brand-gradient)',
    WebkitMask: "url('/brand/Icon.svg') no-repeat center / contain",
    mask: "url('/brand/Icon.svg') no-repeat center / contain",
    width: '40px',
    height: '40px',
  }}
/>
```

### Favicon

Use **Icon.svg** — never Logo.svg (too wide for square format). Always use a **solid background** — never transparent. Browser chrome (tabs, bookmarks, OS dock) has unpredictable backgrounds; a transparent favicon becomes invisible on matching surfaces.

```html
<!-- favicon.svg: Icon on solid brand-primary background -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
  <rect width="36" height="36" rx="8" fill="[brand-primary]"/>
  <!-- paste Icon.svg paths here with fill="white" -->
</svg>

<!-- In <head> -->
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg" />
<link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon.png" />
```

Per-brand favicon colors:

| Brand | Background | Icon color |
|---|---|---|
| Ali | `#1F5B46` (forest green) | `#ffffff` |
| Zeroh GRC | `#009966` (deep green) | `#ffffff` |
| Blade Labs Corporate | `#4f39f6` (indigo) | `#ffffff` |

### Minimum sizes

| Variant | Minimum | Typical |
|---|---|---|
| Lockup (icon + wordmark) | 120px wide | 160–200px |
| Icon | 16px | 24px nav · 32px UI |
| Favicon | 16px | 32px |

### Ali — signature lockup (special case)

Ali has **two separate colour systems**: gold for the logo, forest green for the app UI. They never mix.

The primary Ali logo form is a composed lockup: **Icon with a 3-stop metallic gold gradient** + **Wordmark in flat solid gold**, always on a dark/black background. Use `--logo-gradient` and `--logo-solid` — never `--brand-gradient` (which is sage→forest green and belongs to marketing UI only).

```jsx
// Ali signature lockup — dark background
<div style={{ display: 'flex', alignItems: 'center', gap: '20px', background: '#0A0A0A' }}>
  {/* Icon — 3-stop gold gradient: gold-700 → gold-200 → gold-500 */}
  <div style={{
    background: 'var(--logo-gradient)',
    WebkitMask: "url('/brand/Icon.svg') no-repeat center / contain",
    mask: "url('/brand/Icon.svg') no-repeat center / contain",
    width: '52px', height: '52px',
  }} />
  {/* Wordmark — flat solid gold (gold-300) */}
  <div style={{
    background: 'var(--logo-solid)',
    WebkitMask: "url('/brand/Logo.svg') no-repeat center / contain",
    mask: "url('/brand/Logo.svg') no-repeat center / contain",
    width: '200px', height: '52px',
  }} />
</div>
```

| Token | Value | Role |
|---|---|---|
| `--logo-gradient` | `linear-gradient(to right, #70510A, #F0D599, #C38D11)` | Icon fill — gold-700 → gold-200 → gold-500 |
| `--logo-solid` | `#DCB868` (`--gold-300`) | Wordmark fill — Figma-sourced anchor |

### Don'ts

- Never recreate, redraw, or substitute the logo with inline text
- Never add drop shadows, glows, outlines, or other effects to the SVG
- Never rotate or skew the logo
- Never stretch or distort proportions — always preserve the SVG aspect ratio
- Never place the gradient logo variant on a gradient background — use white on gradients
- Never use a transparent background for favicons
- Never use `Logo.svg` as a favicon — it is a wide wordmark, not a square mark
- Never hardcode a color directly on the SVG element — always control via CSS `color` on the wrapper
- **Ali only**: Never use `var(--brand-gradient)` on the Ali logo — the logo uses `var(--logo-gradient)` gold, not the green UI gradient

---

## Bundled References

Load these when operating in Path 2 (theme specified, no project files present).

| File | When to read |
|---|---|
| `references/core/PRINCIPLES.md` | Always, for any theme — shared technical rules |
| `references/core/AESTHETICS.md` | Path 3 only — creative direction, aesthetics, component patterns |
| `references/ali/DESIGN.md` | Ali design system — typography, color, components |
| `references/ali/globals.css` | Ali token values |
| `references/zeroh/DESIGN.md` | Zeroh GRC design system — typography, color, components |
| `references/zeroh/globals.css` | Zeroh GRC token values |
| `references/disclosure/DESIGN.md` | Zeroh Disclosure design system — IBM Plex Mono headings, navy/teal palette |
| `references/disclosure/globals.css` | Zeroh Disclosure token values |
| `references/corporate/DESIGN.md` | Blade Labs Corporate design system — typography, color, components |
| `references/corporate/globals.css` | Blade Labs Corporate token values |
| `themes/ali/assets/` | Ali brand SVGs (Logo.svg, Icon.svg) |
| `themes/zeroh/assets/` | Zeroh GRC brand SVGs (Logo.svg, Icon.svg) |
| `themes/disclosure/assets/` | Zeroh Disclosure brand SVGs (Logo.svg, Icon.svg) |
| `themes/corporate/assets/` | Blade Labs Corporate brand SVGs (Logo.svg, Icon.svg) |
