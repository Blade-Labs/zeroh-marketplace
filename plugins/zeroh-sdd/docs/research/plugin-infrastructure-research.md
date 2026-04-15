# Plugin Infrastructure Research

**Date:** 2026-04-10
**Source:** Official Anthropic docs, Claude Code repo, zeroh-sdd codebase
**Purpose:** Map full plugin capabilities → identify gaps → plan first infra

---

## 1. Official Plugin Specification (from docs.claude.com)

### Plugin Directory Structure (Complete)

```
plugin-name/
├── .claude-plugin/plugin.json   # Manifest (name required, rest optional)
├── skills/                      # <name>/SKILL.md directories
├── commands/                    # Flat .md skill files (legacy)
├── agents/                      # Subagent .md definitions
├── hooks/hooks.json             # Hook configurations
├── bin/                         # Executables added to Bash PATH
├── output-styles/               # Output formatting
├── settings.json                # Default settings (currently: agent key only)
├── .mcp.json                    # MCP server configurations
├── .lsp.json                    # LSP server configurations
└── CLAUDE.md                    # Plugin instructions (loaded into context)
```

### plugin.json Schema (Complete)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | YES | Unique identifier, kebab-case. Namespaces all skills |
| version | string | no | Semver. Plugin updates keyed on this |
| description | string | no | Shown in plugin manager |
| author | object | no | {name, email, url} |
| homepage | string | no | Documentation URL |
| repository | string | no | Source code URL |
| license | string | no | SPDX identifier |
| keywords | array | no | Discovery tags |
| skills | string/array | no | Custom skill paths (replaces default skills/) |
| commands | string/array | no | Custom command paths (replaces default commands/) |
| agents | string/array | no | Custom agent paths (replaces default agents/) |
| hooks | string/array/object | no | Hook config paths or inline config |
| mcpServers | string/array/object | no | MCP config paths or inline config |
| lspServers | string/array/object | no | LSP config paths or inline config |
| outputStyles | string/array | no | Output style paths |
| userConfig | object | no | User-prompted values (keychain for sensitive) |
| channels | array | no | Message injection channels |

### Hook Events (Complete — 25+ events)

| Event | When | zeroh-sdd Uses? |
|-------|------|-----------------|
| SessionStart | Session begins/resumes | YES |
| SessionEnd | Session terminates | YES |
| PreToolUse | Before tool execution (can block) | YES |
| PostToolUse | After tool succeeds | YES |
| PostToolUseFailure | After tool fails | NO |
| PreCompact | Before context compaction | YES |
| PostCompact | After compaction completes | NO |
| Stop | Claude finishes responding | YES |
| StopFailure | Turn ends due to API error | NO |
| UserPromptSubmit | User submits prompt (before processing) | NO |
| SubagentStart | Subagent spawned | NO |
| SubagentStop | Subagent finishes | NO |
| TaskCreated | Task created via TaskCreate | NO |
| TaskCompleted | Task marked completed | NO |
| TeammateIdle | Agent team member about to idle | NO |
| InstructionsLoaded | CLAUDE.md loaded into context | NO |
| ConfigChange | Config file changes during session | NO |
| CwdChanged | Working directory changes | NO |
| FileChanged | Watched file changes on disk | NO |
| WorktreeCreate | Worktree being created | NO |
| WorktreeRemove | Worktree being removed | NO |
| PermissionRequest | Permission dialog appears | NO |
| PermissionDenied | Tool call denied by classifier | NO |
| Notification | Claude sends notification | NO |
| Elicitation | MCP server requests user input | NO |
| ElicitationResult | User responds to MCP elicitation | NO |

**zeroh-sdd uses 6 of 25+ available events (24% coverage)**

### Hook Types (4 types)

| Type | Description | zeroh-sdd Uses? |
|------|-------------|-----------------|
| command | Execute shell commands | YES (all hooks) |
| prompt | LLM-driven evaluation | NO |
| agent | Agentic verifier with tools | NO |
| http | POST webhook | NO |

**zeroh-sdd uses 1 of 4 hook types (25% coverage)**

### Hook Input/Output Contract

**Stdin (all hooks):**
```json
{
  "session_id": "string",
  "transcript_path": "string",
  "cwd": "string",
  "permission_mode": "ask|allow",
  "hook_event_name": "string",
  "tool_name": "string",           // PreToolUse/PostToolUse only
  "tool_input": "object",          // PreToolUse/PostToolUse only
  "tool_result": "string|object"   // PostToolUse only
}
```

**Stdout (PreToolUse):**
```json
{
  "hookSpecificOutput": {
    "permissionDecision": "allow|deny|ask",
    "updatedInput": { "field": "modified_value" },
    "additionalContext": "string injected into LLM context"
  },
  "systemMessage": "string",
  "continue": true,
  "suppressOutput": false
}
```

**Key capability: `updatedInput`** — PreToolUse hooks can MODIFY tool input
before execution. Not just approve/deny, but transform.

**Stdout (Stop):**
```json
{
  "decision": "approve|block",
  "reason": "string",
  "systemMessage": "string"
}
```

### Environment Variables

| Variable | Available In | Description |
|----------|-------------|-------------|
| `${CLAUDE_PLUGIN_ROOT}` | All hooks, MCP, LSP, skills, agents | Plugin install directory |
| `${CLAUDE_PLUGIN_DATA}` | All hooks, MCP, LSP | Persistent data dir (survives updates) |
| `$CLAUDE_PROJECT_DIR` | Command hooks | Project root |
| `$CLAUDE_ENV_FILE` | SessionStart only | Persist env vars |

### Hook Merge Behavior

- Plugin hooks **merge with** project hooks and **run in parallel**
- Multiple hooks on same event: matcher groups run in parallel
- Within each matcher group: hooks execute sequentially
- Both plugin hooks AND project hooks fire — no override, pure merge

### Plugin Caching

- Marketplace plugins cached to `~/.claude/plugins/cache/`
- Each version = separate directory
- Old versions orphaned + removed after 7 days
- `${CLAUDE_PLUGIN_DATA}` persists at `~/.claude/plugins/data/{id}/`

---

## 2. zeroh-sdd Current Usage vs Available

### What zeroh-sdd Ships Today

| Component | Count | Notes |
|-----------|-------|-------|
| Skills (skills/) | 14 | Full pipeline: specify→implement→analyze |
| Hooks (hooks/hooks.json) | 8 | 6 events, command type only |
| Templates (templates/) | 8 | Spec, plan, tasks, checklist, etc |
| Context fragments (scripts/hooks/context/) | 13 | Checklists, registries, gate configs |
| Scripts (scripts/) | 8 | Hook scripts + utility scripts |
| Multi-platform adapters | 4 | Cursor, Codex, Copilot, Gemini |
| Agents (agents/) | 0 | .gitkeep only |
| Commands (commands/) | 0 | .gitkeep only |
| bin/ | 0 | Not present |
| .mcp.json | 0 | Not present |
| .lsp.json | 0 | Not present |
| settings.json | 0 | Not present |
| output-styles/ | 0 | Not present |
| userConfig | 0 | Not in plugin.json |
| channels | 0 | Not in plugin.json |

### plugin.json Gap Analysis

**Current:**
```json
{
  "name": "zeroh-sdd",
  "version": "0.1.0",
  "description": "Shape-Driven Development — ...",
  "author": { "name": "Blade Labs", "url": "..." },
  "repository": "...",
  "license": "Apache-2.0",
  "keywords": [...]
}
```

**Missing fields:**
- `homepage` — should point to docs/README
- `userConfig` — should prompt for project-specific settings
- `hooks` — currently uses convention (hooks/hooks.json), could also inline

### Hook Events Gap

**High-value unused events for type-steering vision:**

| Event | Value for zeroh-sdd | Priority |
|-------|-------------------|----------|
| PostToolUseFailure | Detect failed tool calls → inject remediation | HIGH |
| UserPromptSubmit | Inject SDD pipeline context before processing | HIGH |
| FileChanged | Watch shape files for changes → re-validate | HIGH |
| PostCompact | Re-inject critical SDD context after compaction | MEDIUM |
| SubagentStop | Validate subagent output against shapes | MEDIUM |
| InstructionsLoaded | Augment CLAUDE.md with shape context | MEDIUM |
| TaskCreated | Validate tasks against SDD criteria | LOW |

### Hook Types Gap

**`prompt` type hooks** (LLM-evaluated):
- Could replace complex bash logic in ap-detector.sh with LLM evaluation
- Shape validation could use prompt hooks for semantic checks
- Decision trees currently in skill prose could be in prompt hooks

**`agent` type hooks** (agentic verifier):
- Could run multi-step verification (read shape → parse file → compare)
- More powerful than bash for complex validation logic
- Has access to tools (Read, Grep, etc.)

---

## 3. Hook Conflict Analysis (Monorepo + Plugin)

### Side-by-Side

| Event | Monorepo Hook | Plugin Hook | Conflict? |
|-------|--------------|-------------|-----------|
| SessionStart | session-start.sh (476 lines, env setup) | session-start.sh (pipeline state) | NO — additive (both run in parallel) |
| PreToolUse (Write/Edit) | zone-warning.sh | phase-context.sh | NO — additive (zone + type context) |
| PreToolUse (Read) | zone-warning.sh | (none) | NO |
| PostToolUse (Write/Edit) | biome-format.sh, commit-hygiene.sh | ap-detector.sh, commit-hygiene.sh | OVERLAP — both have commit-hygiene |
| PostToolUse (Write) | subpath-exporter.sh | (none) | NO |
| PreCompact | pre-compact.sh | pre-compact.sh | OVERLAP — both save snapshots |
| Stop | stop-check.sh | stop-check.sh, stop-quality-gate.sh | OVERLAP — both check uncommitted work |
| SessionEnd | session-end.sh | session-end.sh | OVERLAP — both archive transcripts |

### Conflict Assessment

**commit-hygiene**: Both monorepo and plugin have commit-hygiene hooks. Since hooks
run in parallel, user gets DUPLICATE warnings. Plugin should detect if monorepo
already has commit-hygiene and skip.

**stop-check**: Both check for uncommitted work. Duplicate blocking. Plugin should
detect monorepo's stop-check and defer.

**pre-compact**: Both save snapshots. Different content but similar purpose.
Acceptable — additive context.

**session-end**: Both archive. Different targets. Acceptable.

### Recommended Resolution Pattern

Plugin hooks should check for monorepo hooks before running:
```bash
# In plugin hook scripts:
if [[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/commit-hygiene.sh" ]]; then
  # Monorepo already handles this — skip
  exit 0
fi
```

Or better: use `hook-overrides.json` to let projects disable overlapping hooks.

---

## 4. Key Infrastructure Gaps for Vision

### Gap 1: No Persistent Data Strategy
- `${CLAUDE_PLUGIN_DATA}` not used
- Shape registry, violation tracking, session state all ephemeral
- Need: persistent shape registry, correction loop state

### Gap 2: No Agent Definitions
- `agents/` has only `.gitkeep`
- Plugin can ship specialized agents for: shape validation, AP analysis,
  code review with SDD criteria
- Agent type hooks could use plugin agents for complex verification

### Gap 3: No UserPromptSubmit Hook
- Missing opportunity to inject SDD pipeline state before every prompt
- Could inject: current phase, active shapes, open violations
- **RISK: Known bug (anthropics/claude-code#10225)** — UserPromptSubmit hooks
  from plugins may match but never execute. Must test empirically before
  investing heavily. Fallback: SessionStart hook for pipeline context.

### Gap 4: No FileChanged Hooks
- Can't watch shape files for changes
- Missing opportunity: shape file modified → re-validate all consumers

### Gap 5: No PostCompact Hook
- After compaction, SDD pipeline state is lost
- PreCompact saves snapshot but nothing re-injects after compaction
- PostCompact could re-inject critical SDD context

### Gap 6: No Prompt/Agent Hook Types
- All hooks are bash command type
- Missing LLM-evaluated hooks for semantic validation
- Missing agent-type hooks for multi-step verification

### Gap 7: plugin.json Incomplete
- Missing userConfig for project-specific settings
- Missing homepage
- No bin/ directory for CLI tools

### Gap 8: No Conflict Detection
- Plugin doesn't detect overlapping monorepo hooks
- Leads to duplicate warnings when both are installed

### Gap 9: PreCompact File Write Race (P0)
- Both monorepo and plugin pre-compact.sh write to `.vibe/context-snapshot.md`
- Hooks run in parallel — last writer wins = data loss
- Plugin must write to different file (`.vibe/sdd-snapshot.md`)

### Gap 10: Plugin CLAUDE.md Not Auto-Loaded
- Plugin CLAUDE.md is NOT injected into LLM context (developer docs only)
- Behavioral rules must go through skills or SessionStart hooks
- Bootstrap skill `using-zeroh-sdd` currently serves this role

---

## 5. Known Bugs Affecting Plugin Design

| Issue | Description | Impact on zeroh-sdd |
|-------|-------------|-------------------|
| #10225 | UserPromptSubmit from plugins never execute | S-05 risk — test empirically |
| #22345 | `disable-model-invocation` doesn't work for plugin skills | All 14 skills visible to model |
| #24115 | Plugin hooks fire twice (marketplace + cache) | All hooks must be idempotent |
| #18517 | Plugin hooks retain old path after version update | Hook commands must use ${CLAUDE_PLUGIN_ROOT} |
| #11392 | Settings flag merges instead of overriding hooks | Can't disable specific hooks per-invocation |

---

## 6. Capabilities NOT Used by zeroh-sdd

| Capability | What It Does | Potential for SDD |
|-----------|-------------|-------------------|
| `updatedInput` (PreToolUse) | Modify tool input before execution | Inject shape metadata into file writes |
| `agent` hook type | Multi-step verification with tools | Complex shape validation |
| `prompt` hook type | LLM-evaluated validation | Semantic shape quality checks |
| `bin/` directory | Add executables to PATH | CLI tools (discover-shapes, validate) |
| `${CLAUDE_PLUGIN_DATA}` | Persistent data across updates | Shape registry, violation state |
| `userConfig` | Prompted values on plugin enable | shapes_directory, enforcement_level |
| `settings.json` | Default plugin settings | Set default agent |
| `FileChanged` event | Watch files for changes | Re-validate on shape file changes |
| `PostCompact` event | Inject after compaction | Re-inject SDD pipeline state |
| `channels` | Message injection | Future: Slack/Discord integration |

---

## Sources

- [Claude Code Plugins README](https://github.com/anthropics/claude-code/blob/main/plugins/README.md)
- [Hook Development SKILL.md](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/hook-development/SKILL.md)
- [Create Plugins](https://code.claude.com/docs/en/plugins)
- [Plugins Reference](https://code.claude.com/docs/en/plugins-reference)
- [Claude Code Plugins Blog](https://claude.com/blog/claude-code-plugins)
