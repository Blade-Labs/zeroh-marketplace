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
| **zeroh-design** | Branded UI generation — 4 design themes (Ali, Zeroh GRC, Blade Corporate, Disclosure) | `/plugin install zeroh-design@zeroh-marketplace` |
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

## Listing a New Plugin

All plugins live in this repo. To list a new plugin:

1. **Create a PR** that adds your plugin directory and a marketplace entry
2. **Get it merged**
3. **Done** — team members see it on next `/plugin marketplace update zeroh-marketplace`

### Your PR should contain:

**A. Your plugin directory** under `plugins/`:

```
plugins/my-plugin/
├── .claude-plugin/
│   └── plugin.json     ← minimum: { "name": "my-plugin", "description": "..." }
├── skills/
│   └── my-skill/
│       └── SKILL.md    ← your skill content
└── README.md           ← optional
```

**B. One entry** added to `.claude-plugin/marketplace.json`:

```json
{
  "name": "my-plugin",
  "description": "What it does",
  "source": "./plugins/my-plugin",
  "category": "development",
  "tags": ["relevant", "tags"]
}
```

That's it. No separate repo, no tokens, no CI config. Merge the PR and it's listed.

### Listing an external plugin (not in this repo)

Add just a marketplace.json entry pointing to the external repo:

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
│   ├── zeroh-design/                  ← 1 skill, 4 themes
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
