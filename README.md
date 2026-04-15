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

See any existing plugin under `/plugins` for reference.

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

## Documentation

For plugin structure, hooks, skills, agents, MCP servers, and all other plugin capabilities, see the [official plugin documentation](https://code.claude.com/docs/en/plugins).

For a hands-on reference, install the `plugin-dev` plugin from the official marketplace:

```
/plugin install plugin-dev@claude-plugins-official
```
