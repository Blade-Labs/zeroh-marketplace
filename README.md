# ZeroH Plugin Marketplace

A curated directory of plugins for Claude Code, maintained by Blade Labs.

## Structure

- **`/plugins`** - All plugins live here as directories

## Listed plugins

### General-purpose development

- **`zeroh-sdd`** — Shape-Driven Development runtime for vibecoding (execution-spec control plane, active-stage guardrails, proof receipts, Zod shape gates, scoped hook correction)
- **`zeroh-design`** — Blade Labs branded UI and collateral generator (4 design themes)
- **`zeroh-roadmap`** — Phase-driven development (shape-enforced task schemas, validation gates, review reports)

### GRC agentic-infrastructure suite (new)

Five plugins source-adapted from `Blade-Labs/grc-zod-poc` per the [agentic-infra-refinement plan](https://github.com/Blade-Labs/grc-zod-poc/blob/claude/review-commit-history-x36V2/docs/research/claude-neon-implementation-pack.md). Together: 15 specialist subagents + ~20 authoring skills + 7 JIT-injection hook scripts. For this GRC suite, all hooks are **PostToolUse JIT-injection** (never block) — the original pack's 3 PreToolUse blocker scripts were rewritten per the grc-zod-poc `AGENTS.md §6` teaching-not-blocking invariant.

- **`grc-neon-foundation`** — NeOn methodology + ORSD alignment + bundle governance + CWA guardrails. `neon-methodologist`, `bundle-architect`, `cwa-auditor` + `orsd-review`, `cwa-guardrails`, `adr-draft`, `bundle-diff` skills.
- **`grc-legislation-pipeline`** — Akoma Ntoso ingestion + LegalRuleML first-pass + LKIF Hohfeldian second-pass + routing materialization. `legal-source-engineer`, `deontic-modeler`, `lkif-refiner` + 4 skills.
- **`grc-ontology-workbench`** — Standards-first ontology reuse + three-layer mapping (oscalm:SetMapping → sssom:Mapping → owl:Axiom) + SHACL/SPARQL authoring. `ontology-architect`, `mapping-curator`, `shacl-sparql-engineer` + 4 skills.
- **`grc-omg-factory`** — DMN 1.5 formal / BPMN / CMMN binding + cross-family reference validation. `dmn-architect`, `bpmn-architect`, `cmmn-architect` + 4 skills (no hooks).
- **`grc-platform-runtime`** — Repo scaffolding + Apache Jena Fuseki + TDB2 dev stack + acceptance gates + plugin release. `platform-engineer`, `fuseki-operator`, `ci-guardian` + 4 skills + configurable Fuseki endpoints.

These plugins are also **committed in-repo** in both `Blade-Labs/grc-zod-poc` and `Blade-Labs/GRC-ZOD-Alpha` under `plugins/grc-*/`, auto-enabled via the in-repo marketplace pattern (`extraKnownMarketplaces: {source: directory, path: "."}`) for consumers who work in those repos directly. This marketplace mirror serves external consumers.

## Installation

To install, run `/plugin install {plugin-name}@zeroh-marketplace`

or browse in `/plugin > Discover`

## Listing a New Plugin

> **Official docs:** [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)

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

> **Official docs:** [Plugin structure overview](https://code.claude.com/docs/en/plugins#plugin-structure-overview)

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

> **Official docs:** [Organize complex plugins](https://code.claude.com/docs/en/plugins#organize-complex-plugins) · [Plugin directory structure](https://code.claude.com/docs/en/plugins-reference#plugin-directory-structure)

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

Production SDD runtime for vibecoding — 10 skills, a Node CLI in `bin/`, and Claude hooks that keep execution inside the active proof stage.

```
plugins/zeroh-sdd/
├── .claude-plugin/plugin.json          # Manifest
│
├── bin/
│   └── zeroh-sdd.mjs                    # check/doctor/stage/jit/hook runtime
│
├── skills/                              # SDD runtime workflow
│   ├── specify/SKILL.md
│   ├── clarify/SKILL.md
│   ├── plan/SKILL.md
│   ├── execution-spec/SKILL.md
│   ├── shapes/SKILL.md
│   ├── tasks/SKILL.md
│   ├── implement/SKILL.md
│   ├── analyze/SKILL.md
│   ├── sdd-readiness/SKILL.md
│   └── ap-taxonomy/SKILL.md
│
├── hooks/hooks.json                     # Hook events routed to bin/zeroh-sdd.mjs
├── docs/v1-runtime.md                   # Runtime architecture
├── CLAUDE.md                           # Developer docs (not auto-loaded)
└── README.md
```

**What makes this plugin powerful:**

- **Execution specs are machine-checkable:** every actionable plan carries one fenced `sdd` block
- **Stage state drives enforcement:** `.specify/workflows/active-stage.json` is the source of truth for allowed writes and proof commands
- **Hooks protect boundaries:** writes, commits, task completion, and Stop are blocked only while an active stage remains unfinished
- **AP findings steer, not block:** current-edit warnings emit `additionalContext` plus `_fix.prompt` envelopes; branch-baseline noise is scoped as background context
- **Shapes are proof gates:** Zod shapes and parse boundaries are discovered and enforced when `shape_gate` declares them

## Component Reference

### plugin.json

> **Official docs:** [Plugin manifest schema](https://code.claude.com/docs/en/plugins-reference#plugin-manifest-schema)

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

> **Official docs:** [Skills](https://code.claude.com/docs/en/skills)

Markdown files that teach Claude how to do something. Auto-invoked when the `description` matches user intent.

**Frontmatter fields:** `name`, `description`, `version`, `disable-model-invocation`, `argument-hint`, `user-invocable`, `allowed-tools`, `model` (sonnet/opus/haiku/inherit), `effort`, `context` (fork for subagent isolation), `agent`, `hooks`, `paths`, `shell`

Skills can include `references/`, `examples/`, and `scripts/` subdirectories. Use `$ARGUMENTS` for user input and `` !`command` `` for inline shell execution.

### Agents (`agents/name.md`)

> **Official docs:** [Subagents](https://code.claude.com/docs/en/sub-agents)

Subagent definitions that run as autonomous workers.

**Frontmatter fields:** `name`, `description`, `model`, `color` (blue/cyan/green/yellow/magenta/red), `tools`, `disallowedTools`, `maxTurns`, `skills`, `memory`, `background`, `effort`, `isolation` (worktree), `initialPrompt`

See `plugins/zeroh-roadmap/agents/` for examples — 4 agents (software-architect, software-developer, code-reviewer, test-engineer).

### Hooks (`hooks/hooks.json`)

> **Official docs:** [Hooks reference](https://code.claude.com/docs/en/hooks) · [Hook events](https://code.claude.com/docs/en/plugins-reference#hooks)

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

> **Official docs:** [MCP](https://code.claude.com/docs/en/mcp) · [Plugin MCP servers](https://code.claude.com/docs/en/plugins-reference#mcp-servers)

Connect Claude to external tools and services. Four transports: `stdio`, `sse`, `http`, `ws`.

### LSP Servers (`.lsp.json`)

> **Official docs:** [Plugin LSP servers](https://code.claude.com/docs/en/plugins-reference#lsp-servers)

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

> **Official docs:** [Environment variables](https://code.claude.com/docs/en/plugins-reference#environment-variables)

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
| `plugins/zeroh-roadmap/` | Medium | Multiple skills, 4 agents, templates, scaffold scripts |
| `plugins/zeroh-sdd/` | Complex | SDD runtime, active-stage hooks, proof receipts, AP envelopes, shape gates |

For the official plugin development guide, install the `plugin-dev` plugin:

```
/plugin install plugin-dev@claude-plugins-official
```
