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
| **zeroh-sdd** | Shape-Driven Development — 14 skills, 8 enforcement hooks, 19 AP detection patterns, 7 extension points | `/plugin install zeroh-sdd@zeroh-marketplace` |
| **ui-design-skill** | Branded UI generation — 3 design themes (Ali, Zeroh GRC, Blade Corporate) | `/plugin install ui-design-skill@zeroh-marketplace` |

### zeroh-sdd

Teaches AI agents Shape-Driven Development — Zod schemas define contracts BEFORE implementation, hooks enforce them mechanically.

- **14 skills**: specify → clarify → plan → shapes → tasks → implement → analyze (full SDD pipeline)
- **8 enforcement hooks**: AP detection (19 patterns), commit hygiene, stop-check, JIT context injection, quality gate
- **5-layer enforcement gradient**: prose → JIT context → detect → remind → block
- **7 extension points**: pipeline hooks, AP registry, context files, drop-in skills/agents/commands, plugin composition

### ui-design-skill

Branded UI and collateral generator with 3 design themes. Composes with zeroh-sdd — use both together for full-stack Shape-Driven Development with brand-consistent UI.

## Auto-Updates

Plugins auto-update at session start when your git credentials are configured:

```bash
# GitHub CLI (recommended — handles auth for all git operations)
gh auth login
```

For background auto-updates (non-interactive), set a token in your shell config:

```bash
# Add to ~/.bashrc or ~/.zshrc
export GITHUB_TOKEN=ghp_xxx  # needs 'repo' scope for private repos
```

## Adding a New Plugin to the Marketplace

### Step 1: Create the plugin repo

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # { "name": "my-plugin", "version": "1.0.0", ... }
├── skills/
│   └── my-skill/
│       └── SKILL.md          # Skill definition
├── hooks/
│   └── hooks.json            # Hook definitions (optional)
├── README.md
└── LICENSE
```

Validate before publishing:
```bash
claude plugin validate .claude-plugin/plugin.json
```

### Step 2: Set up access

```bash
# Add both teams to the plugin repo
gh api /orgs/Blade-Labs/teams/blade-development/repos/Blade-Labs/my-plugin -X PUT -f permission="push"
gh api /orgs/Blade-Labs/teams/blade-business/repos/Blade-Labs/my-plugin -X PUT -f permission="pull"
```

### Step 3: Add to this marketplace

Edit `.claude-plugin/marketplace.json` and add an entry:

```json
{
  "name": "my-plugin",
  "description": "What it does",
  "source": {
    "source": "github",
    "repo": "Blade-Labs/my-plugin"
  },
  "category": "development",
  "tags": ["relevant", "tags"]
}
```

### Step 4: Notify team

Push to this repo. Team members pick up the new plugin on their next session via:
```bash
/plugin marketplace update zeroh-marketplace
```

Or it auto-updates at session start.

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
Blade-Labs/zeroh-marketplace (this repo)
├── .claude-plugin/marketplace.json     ← lists plugins by GitHub source
│
├── Blade-Labs/zeroh-sdd               ← separate repo (private)
│   ├── skills/ (14)
│   ├── hooks/ (8)
│   └── .claude-plugin/plugin.json
│
└── Blade-Labs/ui-design-skill          ← separate repo (public)
    ├── skills/ (1)
    └── .claude-plugin/plugin.json
```

Each plugin is its own repo — independently versioned, independently installable. The marketplace is a catalog that points to them. Adding a plugin = adding one JSON entry + giving team access.

## Access Control

| Team | Marketplace | Plugins | Permission |
|------|-------------|---------|-----------|
| **Blade Development** | ✓ | All | push (write) |
| **Blade Business** | ✓ | All | pull (read) |

Access is controlled by GitHub org team membership. No separate auth system needed.
