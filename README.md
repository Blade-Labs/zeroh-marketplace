# zeroh-marketplace

Private Claude Code plugin marketplace for Blade Labs.

## For Team Members (Getting Started)

If you're working on a repo that has `extraKnownMarketplaces` in `.claude/settings.json` (e.g., ZeroH-GRC-Platform), plugins are automatic:

1. Open Claude Code in the project
2. Claude prompts: "This project wants to add the zeroh-marketplace. Trust?"
3. Accept → plugins appear in `/plugins` → Install what you need

**That's it.** No tokens, no manual setup. Your GitHub org membership provides access.

If you need to add the marketplace manually (e.g., for a personal project):

```bash
/plugin marketplace add Blade-Labs/zeroh-marketplace
```

## Available Plugins

| Plugin | Description | Install |
|--------|-------------|---------|
| **zeroh-sdd** | Shape-Driven Development — 14 skills, 8 enforcement hooks, 19 AP detection patterns | `/plugin install zeroh-sdd@zeroh-marketplace` |
| **ui-design-skill** | Branded UI generation — 4 design themes (Ali, Zeroh GRC, Blade Corporate, Disclosure) | `/plugin install ui-design-skill@zeroh-marketplace` |
| **roadmap-plugin** | Phase-driven development — validation gates, sequential execution, review reports | `/plugin install roadmap-plugin@zeroh-marketplace` |

## Auto-Updates

Plugins auto-update at session start when your git credentials are configured:

```bash
# GitHub CLI (recommended)
gh auth login
```

For background auto-updates (non-interactive), set a token in your shell config:

```bash
# Add to ~/.bashrc or ~/.zshrc
export GITHUB_TOKEN=ghp_xxx  # needs 'repo' scope for private repos
```

## Adding a New Plugin

All plugins live in this repo under `plugins/`. No separate repo needed.

### Step 1: Create the plugin directory

```
plugins/my-plugin/
├── .claude-plugin/
│   └── plugin.json          # { "name": "my-plugin", "description": "...", "author": { "name": "..." } }
├── skills/
│   └── my-skill/
│       └── SKILL.md
├── hooks/                   # optional
│   └── hooks.json
└── README.md
```

### Step 2: Add to marketplace.json

Edit `.claude-plugin/marketplace.json` and add an entry:

```json
{
  "name": "my-plugin",
  "description": "What it does",
  "source": "./plugins/my-plugin",
  "category": "development",
  "tags": ["relevant", "tags"]
}
```

### Step 3: Push

Push to this repo. Team members pick up the new plugin on their next session via:

```bash
/plugin marketplace update zeroh-marketplace
```

Or it auto-updates at session start.

## Adding an External Plugin

For plugins maintained outside this repo (third-party integrations, MCP servers):

### Option A: Minimal wrapper (like official marketplace)

```
external_plugins/some-tool/
├── .claude-plugin/
│   └── plugin.json
└── .mcp.json               # MCP server configuration
```

Add to marketplace.json with: `"source": "./external_plugins/some-tool"`

### Option B: URL reference (no local files)

Add to marketplace.json with:

```json
{
  "name": "some-tool",
  "description": "...",
  "source": {
    "source": "url",
    "url": "https://github.com/org/some-tool-plugin.git"
  }
}
```

## Adding the Marketplace to a New Project

Add to the project's `.claude/settings.json` (committed to git):

```json
{
  "extraKnownMarketplaces": {
    "zeroh-marketplace": {
      "source": {
        "source": "github",
        "repo": "Blade-Labs/zeroh-marketplace"
      }
    }
  }
}
```

Everyone who clones and trusts the project folder gets prompted to install the marketplace.

## Architecture

```
zeroh-marketplace/
├── .claude-plugin/marketplace.json    ← registry (sources point to ./plugins/ or URLs)
├── plugins/                           ← Blade Labs plugins (internal)
│   ├── zeroh-sdd/                     ← 14 skills, 8 hooks, templates
│   ├── ui-design-skill/               ← 1 skill, 4 themes
│   └── roadmap-plugin/               ← 7 skills, 4 agents, templates
├── external_plugins/                  ← Third-party plugins (MCP wrappers, etc.)
└── README.md
```

This matches the structure of `anthropics/claude-plugins-official`:
- `plugins/` = Anthropic-maintained plugins (33)
- `external_plugins/` = Third-party MCP wrappers (16)
- URL sources in marketplace.json = Community plugins (90+)

## Access Control

| Team | Permission |
|------|-----------|
| **Blade Development** | push (write) |
| **Blade Business** | pull (read) |

Access is controlled by GitHub org team membership. No separate auth system needed.
