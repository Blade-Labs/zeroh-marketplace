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

A plugin can use any combination of these 11 components:

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json      # Plugin manifest (required)
├── skills/              # Skill definitions (subdirectories with SKILL.md)
├── agents/              # Subagent definitions (.md files)
├── commands/            # Slash commands (.md files)
├── hooks/
│   ├── hooks.json       # Hook event configuration
│   └── scripts/         # Hook implementation scripts
├── .mcp.json            # MCP server definitions (stdio, sse, http, ws)
├── .lsp.json            # LSP server definitions
├── bin/                 # Executables added to Bash PATH
├── output-styles/       # Output formatting definitions
├── settings.json        # Default plugin settings
├── CLAUDE.md            # Plugin instructions (developer docs, not auto-loaded)
└── README.md
```

### plugin.json (manifest)

Only `name` is required. All other fields are optional:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What it does",
  "author": { "name": "Name", "email": "email" },
  "homepage": "https://...",
  "repository": "https://github.com/...",
  "license": "Apache-2.0",
  "keywords": ["tag1", "tag2"],
  "commands": "./commands",
  "agents": "./agents",
  "skills": "./skills",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json",
  "lspServers": "./.lsp.json",
  "outputStyles": "./output-styles",
  "userConfig": {},
  "channels": []
}
```

### Skills

Skills are markdown files that teach Claude how to do something. Auto-invoked when the `description` matches user intent.

```
skills/my-skill/
├── SKILL.md          # Frontmatter + instructions
├── references/       # Supporting docs
├── examples/         # Example inputs/outputs
└── scripts/          # Helper scripts
```

**SKILL.md frontmatter fields:** `name`, `description`, `version`, `disable-model-invocation`, `argument-hint`, `user-invocable`, `allowed-tools`, `model` (sonnet/opus/haiku/inherit), `effort`, `context` (fork), `agent`, `hooks`, `paths`, `shell`

**Inline execution:** `` !`command` `` for preprocessing, `$ARGUMENTS` for user input.

### Agents

Subagent definitions that run as autonomous workers with restricted tool access.

**Frontmatter fields:** `name`, `description` (with `<example>` tags), `model` (inherit/sonnet/opus/haiku), `color` (blue/cyan/green/yellow/magenta/red), `tools`, `disallowedTools`, `maxTurns`, `skills`, `memory`, `background`, `effort`, `isolation` (worktree), `initialPrompt`

### Hooks (25+ events)

Hooks run bash scripts, LLM prompts, agents, or HTTP webhooks in response to events.

**Lifecycle:** `SessionStart`, `SessionEnd`, `PreCompact`, `PostCompact`

**Tool events:** `PreToolUse`, `PostToolUse`, `PostToolUseFailure` — matchers: `"Write|Edit"`, `"*"`, `"mcp__.*"`

**Decision events (can block):** `Stop`, `UserPromptSubmit`, `PermissionRequest`, `PermissionDenied`

**Agent events:** `SubagentStart`, `SubagentStop`, `TeammateIdle`

**Task events (can block):** `TaskCreated`, `TaskCompleted`

**State events:** `CwdChanged`, `FileChanged`, `ConfigChange`, `InstructionsLoaded`

**Worktree events (can block):** `WorktreeCreate`, `WorktreeRemove`

**Notification events:** `Notification`, `StopFailure`, `Elicitation`, `ElicitationResult`

**Hook types:** `command` (bash, exit 0=success, 2=block), `prompt` (LLM evaluation), `agent` (multi-step verification), `http` (POST webhook)

**hooks.json format:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/my-check.sh"
          }
        ]
      }
    ]
  }
}
```

### MCP Servers (.mcp.json)

Four transport types: `stdio`, `sse`, `http`, `ws`

```json
{
  "my-server": {
    "command": "${CLAUDE_PLUGIN_ROOT}/servers/server",
    "args": ["--arg", "value"],
    "env": { "KEY": "${ENV_VAR}" }
  }
}
```

Tools named as: `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`

### Environment Variables

Available in all plugin components:

- `${CLAUDE_PLUGIN_ROOT}` - Plugin installation directory (always use this for paths)
- `${CLAUDE_PLUGIN_DATA}` - Persistent data directory (survives updates)
- `$CLAUDE_PROJECT_DIR` - Project root (hooks only)
- `${CLAUDE_SESSION_ID}` - Current session ID (skills only)
- `${CLAUDE_SKILL_DIR}` - SKILL.md directory (skills only)

## Documentation

For more information on developing Claude Code plugins, see the [official documentation](https://code.claude.com/docs/en/plugins).
