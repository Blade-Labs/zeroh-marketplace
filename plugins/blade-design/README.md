# ui-design-skill

A Claude skill that gives every interface it builds a consistent, intentional design — so you never have to think about fonts, colors, or layout.

## Who this is for

You build prototypes and apps with Claude Code. You care about how things look but don't want to think about design decisions yourself. This skill handles all of that automatically, every time Claude builds something for you.

## What it does

When active, this skill gives Claude a complete design system to work from. Every component, page, and layout it generates follows consistent rules for typography, color, spacing, and motion. You never see any of that. You just get UI that looks like someone designed it.

- **Three brand design systems** — Ali, Zeroh GRC, and Blade Labs Corporate
- Consistent components and icons across everything it builds
- **PR & marketing collateral** — generate branded social cards, announcement banners, and presentation assets as self-contained HTML, ready to push to Figma

## Design systems

There are three brand design systems. Claude picks the right one based on what you're building — you can always tell it to switch.

### Blade Labs Corporate
> Dashboards, internal tools, compliance, admin panels

Precise and digital. Inter typeface, white background with indigo primary. Brand gradient (slate-violet → deep indigo) for marketing surfaces. Prioritises information density and authority.

### Ali
> AI assistants, document tools, knowledge bases, Shariah advisory

Scholarly and calm. Crimson Pro serif typeface, parchment background with forest green primary. Prioritises legibility and trust.

### Zeroh GRC
> Health, wellness, consumer products, onboarding flows

Organic and friendly. Quicksand typeface, clean white with fresh green accents. Prioritises warmth and approachability.

**How Claude picks:**

| What you're building | Theme |
|---|---|
| Dashboards, data tools, compliance | Blade Labs Corporate |
| AI assistants, docs, knowledge bases | Ali |
| Health, wellness, consumer, onboarding | Zeroh GRC |

Claude will confirm before generating anything:
> *"Going with **Ali** — knowledge base. Good?"*

Just say yes and it builds. If it picked wrong, tell it and it switches.

> **Note:** Claude Code uses the word "theme" for its own dark/light color setting. To avoid confusion, say **"use the Ali design system"** or **"switch to Blade Labs Corporate"** — not "change the theme".

## Getting started

### New project

The cleanest setup. Creates a Next.js project and configures everything automatically — shadcn, the right font, color tokens, and the design files Claude needs.

**1. Create a Next.js project**
```bash
npx create-next-app@latest my-project --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd my-project
```

**2. Run the setup for your chosen theme**

Blade Labs Corporate — dashboards, compliance, admin panels:
```bash
curl -s https://raw.githubusercontent.com/Blade-Labs/ui-design-skill/main/themes/corporate/setup.sh | bash
```

Ali — AI assistants, docs, knowledge bases:
```bash
curl -s https://raw.githubusercontent.com/Blade-Labs/ui-design-skill/main/themes/ali/setup.sh | bash
```

Zeroh GRC — health, wellness, consumer apps:
```bash
curl -s https://raw.githubusercontent.com/Blade-Labs/ui-design-skill/main/themes/zeroh/setup.sh | bash
```

**3. Open Claude Code and start prompting**
```bash
claude
```

Claude reads the design files automatically. Just describe what you want to build.

---

### Existing project

No setup needed. Clone the skill once, then launch Claude Code with it loaded — works in any project, nothing added to your repo.

**1. Clone the skill once**
```bash
git clone https://github.com/Blade-Labs/ui-design-skill.git ~/skills/ui-design-skill
```

**2. Launch Claude Code from your project with the skill loaded**

macOS / Linux:
```bash
cd your-project
claude --plugin-dir ~/skills/ui-design-skill
```

Windows:
```powershell
cd your-project
claude --plugin-dir "C:\Users\YourName\skills\ui-design-skill"
```

**To verify it loaded**, ask Claude at the start of any session:
```
what skills do you have loaded?
```
You should see `ui-design-skill:blade-design` in the list.

**To avoid typing the flag every time**, add this to your shell config (`~/.zshrc` or `~/.bashrc`):
```bash
alias claude='claude --plugin-dir ~/skills/ui-design-skill'
```

Then just type `claude` as normal.

---

## Collateral & PR images

Generate branded social cards, announcement banners, and presentation assets — no design tool needed.

**1. Start a session with the skill loaded** (existing project path or any empty directory)

**2. Prompt Claude:**
```
Generate a self-contained HTML announcement card for a new product launch.
Use the Blade Labs Corporate design system.
The announcement is: "Blade Labs Corporate now supports AI-powered risk scoring."
Format: LinkedIn post image (1200×627px)
```

Claude confirms the brand, then outputs a single `.html` file using your exact tokens — correct logo, fonts, and colors. No build step.

**3. Open in Chrome** — double-click the file to preview it at the correct dimensions.

**4. Push to Figma** *(optional)* — if you have the Figma MCP plugin connected to Claude Code, ask:
```
Push this to Figma
```
The rendered design lands in your Figma file ready to edit and export.

**Supported formats out of the box:**

| Format | Size |
|---|---|
| LinkedIn post | 1200 × 627px |
| Twitter / X card | 1200 × 675px |
| Instagram square | 1080 × 1080px |
| Presentation slide | 1920 × 1080px |
| Email banner | 600 × 200px |
