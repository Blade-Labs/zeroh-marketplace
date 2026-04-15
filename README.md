# zeroh-marketplace

Private Claude Code plugin marketplace for Blade Labs.

## Listing a New Plugin

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
