# ZeroH Plugin Marketplace

A curated directory of plugins for Claude Code, maintained by Blade Labs.

## Structure

- **`/plugins`** - Plugins developed and maintained by Blade Labs
- **`/external_plugins`** - Third-party plugins from partners and the community

## Installation

Plugins can be installed directly from this marketplace via Claude Code's plugin system.

To install, run `/plugin install {plugin-name}@zeroh-marketplace`

or browse for the plugin in `/plugin > Discover`

## Contributing

### Internal Plugins

Create a PR that adds your plugin directory under `/plugins` and an entry in `.claude-plugin/marketplace.json`. Once merged, the plugin is listed.

See the [Plugin Structure](#plugin-structure) section below and any existing plugin under `/plugins` for reference.

### External Plugins

Third-party plugins can be listed by adding a marketplace.json entry pointing to an external repo:

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

## Plugin Structure

Each plugin follows a standard structure:

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json      # Plugin metadata (required)
├── .mcp.json            # MCP server configuration (optional)
├── commands/            # Slash commands (optional)
├── agents/              # Agent definitions (optional)
├── skills/              # Skill definitions (optional)
└── README.md            # Documentation
```

## Documentation

For more information on developing Claude Code plugins, see the [official documentation](https://code.claude.com/docs/en/plugins).
