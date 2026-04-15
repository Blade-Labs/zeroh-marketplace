# ZeroH Plugin Marketplace

A curated directory of plugins for Claude Code, maintained by Blade Labs.

## Structure

- **`/plugins`** - All plugins live here as directories

## Installation

To install, run `/plugin install {plugin-name}@zeroh-marketplace`

or browse in `/plugin > Discover`

## Listing a New Plugin

Create a PR that adds your plugin directory under `/plugins` and one entry in `.claude-plugin/marketplace.json`. Once merged, the plugin is listed.

**marketplace.json entry:**

```json
{
  "name": "my-plugin",
  "description": "What it does",
  "source": "./plugins/my-plugin",
  "category": "development",
  "tags": ["relevant", "tags"]
}
```

## How to Structure a Plugin

### Basic plugin (skill only)

A plugin that teaches Claude one thing. No hooks, no agents, just a skill.

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json           # { "name": "my-plugin", "description": "..." }
└── skills/
    └── my-skill/
        └── SKILL.md           # Instructions for Claude
```

This is all you need to get started. See `plugins/zeroh-design/` for a real example — one skill with reference materials.

### Enterprise plugin (full capabilities)

A plugin that enforces workflows, runs background checks, provides agents, and integrates external tools.

```
enterprise-plugin/
├── .claude-plugin/
│   └── plugin.json             # Plugin manifest
├── skills/                     # Skills (subdirectories with SKILL.md)
│   ├── code-reviewer/
│   │   └── SKILL.md
│   └── pdf-processor/
│       ├── SKILL.md
│       └── scripts/
├── commands/                   # Skills as flat .md files
│   ├── status.md
│   └── logs.md
├── agents/                     # Subagent definitions
│   ├── security-reviewer.md
│   ├── performance-tester.md
│   └── compliance-checker.md
├── output-styles/              # Output style definitions
│   └── terse.md
├── monitors/                   # Background monitor configurations
│   └── monitors.json
├── hooks/                      # Hook configurations
│   ├── hooks.json              # Main hook config
│   └── security-hooks.json     # Additional hooks
├── bin/                        # Plugin executables added to PATH
│   └── my-tool
├── settings.json               # Default settings for the plugin
├── .mcp.json                   # MCP server definitions
├── .lsp.json                   # LSP server configurations
├── scripts/                    # Hook and utility scripts
│   ├── security-scan.sh
│   ├── format-code.py
│   └── deploy.js
├── LICENSE
└── CHANGELOG.md
```

### Real example: zeroh-sdd

Our most complex plugin — 14 skills, 8 hooks across 6 lifecycle events, templates, multi-IDE support, and hook overrides.

```
plugins/zeroh-sdd/
├── .claude-plugin/plugin.json          # Manifest
├── .cursor-plugin/plugin.json          # Cursor IDE support
├── .copilot/plugin.yaml                # GitHub Copilot support
│
├── skills/                             # 14 skills — the SDD pipeline
│   ├── using-zeroh-sdd/SKILL.md        # Bootstrap skill (loaded at SessionStart)
│   ├── speckit-specify/SKILL.md         # Create feature spec
│   ├── speckit-clarify/SKILL.md         # Ask clarification questions
│   ├── speckit-plan/SKILL.md            # Generate implementation plan
│   ├── speckit-shapes/SKILL.md          # Shape-gated development
│   ├── speckit-tasks/SKILL.md           # Generate task list
│   ├── speckit-implement/SKILL.md       # Execute tasks
│   ├── speckit-analyze/SKILL.md         # Cross-artifact analysis
│   ├── speckit-rescope/SKILL.md         # Rescope after changes
│   ├── speckit-checklist/SKILL.md       # Custom checklists
│   ├── speckit-constitution/SKILL.md    # Project constitution
│   ├── speckit-taskstoissues/SKILL.md   # Tasks → GitHub issues
│   ├── shape-authoring/SKILL.md         # Zod shape authoring
│   └── criteria-first-tdd/SKILL.md      # Gate-driven development
│
├── hooks/hooks.json                    # 8 hooks across 6 events
├── scripts/hooks/                      # Hook implementations
│   ├── session-start.sh                 # SessionStart — bootstrap
│   ├── phase-context.sh                 # PreToolUse (Write|Edit) — file type checking
│   ├── ap-detector.sh                   # PostToolUse (Write|Edit) — anti-pattern detection
│   ├── commit-hygiene.sh                # PostToolUse (Write|Edit) — commit message quality
│   ├── pre-compact.sh                   # PreCompact — save state before compaction
│   ├── stop-check.sh                    # Stop — verify completion
│   ├── stop-quality-gate.sh             # Stop — quality gate
│   └── session-end.sh                   # SessionEnd — cleanup
├── scripts/hooks/context/              # Context files injected by hooks
│   ├── ap-registry.md                   # 19 anti-patterns to detect
│   ├── phase-specify.md                 # Context for specify phase
│   ├── phase-plan.md                    # Context for plan phase
│   ├── phase-red.md                     # Context for red phase
│   ├── phase-green.md                   # Context for green phase
│   ├── checklist-component.md           # Component checklist
│   ├── checklist-route.md               # Route checklist
│   ├── checklist-shape.md               # Shape checklist
│   ├── checklist-store.md               # Store checklist
│   ├── checklist-test.md                # Test checklist
│   ├── commit-hygiene.md                # Commit conventions
│   └── stop-gate-config.md              # Quality gate config
│
├── templates/                          # File templates for scaffolding
│   ├── spec-template.md
│   ├── plan-template.md
│   ├── tasks-template.md
│   ├── checklist-template.md
│   ├── constitution-template.md
│   └── agent-file-template.md
│
├── hook-overrides.json                 # Users can customize hook behavior
├── CLAUDE.md                           # Developer docs (not auto-loaded)
└── README.md
```

**What makes this plugin powerful:**

- **Skills form a pipeline:** specify → clarify → plan → shapes → tasks → implement → analyze
- **Hooks enforce the pipeline:** can't write code without checking file type, can't stop without quality gate
- **Context injection:** hooks load phase-specific context into Claude's working memory
- **Hook overrides:** projects can customize enforcement without forking the plugin
- **Multi-IDE:** same plugin works in Claude Code, Cursor, and GitHub Copilot

## Component Reference

### plugin.json

Only `name` is required:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What it does",
  "author": { "name": "Name" },
  "keywords": ["tag1", "tag2"]
}
```

### Skills (`skills/name/SKILL.md`)

Markdown files that teach Claude how to do something. Auto-invoked when the `description` matches user intent.

**Frontmatter fields:** `name`, `description`, `version`, `disable-model-invocation`, `argument-hint`, `user-invocable`, `allowed-tools`, `model` (sonnet/opus/haiku/inherit), `effort`, `context` (fork for subagent isolation), `agent`, `hooks`, `paths`, `shell`

Skills can include `references/`, `examples/`, and `scripts/` subdirectories. Use `$ARGUMENTS` for user input and `` !`command` `` for inline shell execution.

### Agents (`agents/name.md`)

Subagent definitions that run as autonomous workers.

**Frontmatter fields:** `name`, `description`, `model`, `color` (blue/cyan/green/yellow/magenta/red), `tools`, `disallowedTools`, `maxTurns`, `skills`, `memory`, `background`, `effort`, `isolation` (worktree), `initialPrompt`

See `plugins/roadmap-plugin/agents/` for examples — 4 agents (software-architect, software-developer, code-reviewer, test-engineer).

### Hooks (`hooks/hooks.json`)

Event handlers that run bash scripts, LLM prompts, agents, or HTTP webhooks.

**25+ events across 7 categories:**

| Category | Events |
|----------|--------|
| Lifecycle | `SessionStart`, `SessionEnd`, `PreCompact`, `PostCompact` |
| Tool | `PreToolUse`, `PostToolUse`, `PostToolUseFailure` |
| Decision | `Stop`, `UserPromptSubmit`, `PermissionRequest`, `PermissionDenied` |
| Agent | `SubagentStart`, `SubagentStop`, `TeammateIdle` |
| Task | `TaskCreated`, `TaskCompleted` |
| State | `CwdChanged`, `FileChanged`, `ConfigChange`, `InstructionsLoaded` |
| Other | `WorktreeCreate`, `WorktreeRemove`, `Notification`, `StopFailure`, `Elicitation`, `ElicitationResult` |

**Hook types:** `command` (bash, exit 0=success, 2=block), `prompt` (LLM evaluation), `agent` (multi-step verification), `http` (POST webhook)

**Matchers:** `"Write|Edit"` (specific tools), `"*"` (all), `"mcp__.*"` (regex)

### MCP Servers (`.mcp.json`)

Connect Claude to external tools and services. Four transports: `stdio`, `sse`, `http`, `ws`.

### LSP Servers (`.lsp.json`)

Give Claude real-time code intelligence — diagnostics, go-to-definition, hover info.

### Other Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `bin/` | Plugin root | Executables added to Bash PATH |
| `output-styles/` | Plugin root | Output formatting definitions |
| `monitors/` | Plugin root | Background monitor configurations |
| `settings.json` | Plugin root | Default settings (currently `agent` and `subagentStatusLine` keys) |
| `commands/` | Plugin root | Skills as flat .md files (use `skills/` for new plugins) |

### Environment Variables

Available in all plugin components:

| Variable | Purpose |
|----------|---------|
| `${CLAUDE_PLUGIN_ROOT}` | Plugin installation directory (always use this for paths) |
| `${CLAUDE_PLUGIN_DATA}` | Persistent data directory (survives updates) |
| `$CLAUDE_PROJECT_DIR` | Project root (hooks only) |
| `${CLAUDE_SESSION_ID}` | Current session ID (skills only) |
| `${CLAUDE_SKILL_DIR}` | SKILL.md directory (skills only) |

## Learn from Existing Plugins

The best way to learn is to read existing plugins in this marketplace:

| Plugin | Complexity | Learn about |
|--------|-----------|-------------|
| `plugins/zeroh-design/` | Simple | Single skill with reference materials and theme assets |
| `plugins/roadmap-plugin/` | Medium | Multiple skills, 4 agents, templates, scaffold scripts |
| `plugins/zeroh-sdd/` | Complex | 14 skills, 8 hooks, context injection, hook overrides, multi-IDE |

For the official plugin development guide, install the `plugin-dev` plugin:

```
/plugin install plugin-dev@claude-plugins-official
```
