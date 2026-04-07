# zeroh-marketplace

Private Claude Code plugin marketplace for Blade Labs.

## Setup (one-time)

```bash
# In Claude Code, run:
/plugin marketplace add Blade-Labs/zeroh-marketplace
```

Or add to your project's `.claude/settings.json` for team-wide access:

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

## Available Plugins

| Plugin | Description | Install |
|--------|-------------|---------|
| **zeroh-sdd** | Shape-Driven Development — 14 skills, 8 enforcement hooks, 19 AP detection patterns | `/plugin install zeroh-sdd@zeroh-marketplace` |
| **ui-design-skill** | Branded UI generation — 3 design themes (Ali, Zeroh GRC, Blade Corporate) | `/plugin install ui-design-skill@zeroh-marketplace` |

## Auto-Updates

Plugins auto-update at session start. For private repos, ensure your git credentials are configured:

```bash
# GitHub CLI (recommended)
gh auth login

# Or set token for background updates
export GITHUB_TOKEN=ghp_xxx
```

## Adding a Plugin

1. Create a repo with `.claude-plugin/plugin.json` + `skills/` directory
2. Add an entry to `.claude-plugin/marketplace.json` in this repo
3. Team members run `/plugin marketplace update zeroh-marketplace`

## Access

Both **Blade Development** and **Blade Business** teams have access to this marketplace and all listed plugins.
