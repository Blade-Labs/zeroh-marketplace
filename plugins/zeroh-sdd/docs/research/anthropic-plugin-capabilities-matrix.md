# Claude Code Plugin Capabilities Matrix

**Date:** 2026-04-10
**Source:** Official Anthropic docs (code.claude.com/docs/en/plugins-reference, /hooks, /skills, /sub-agents)
**Purpose:** Every plugin capability mapped to zeroh-sdd usage

---

## 1. Plugin Components

| Component | Description | zeroh-sdd Uses? | How It Uses It |
|-----------|-------------|-----------------|----------------|
| `.claude-plugin/plugin.json` | Plugin manifest — identity, metadata, component paths | YES | Minimal: name, version, description, author, repo, license, keywords |
| `skills/` | `<name>/SKILL.md` directories — model-invoked expertise | YES (14 skills) | Full SDD pipeline: specify → clarify → checklist → constitution → plan → shapes → tasks → implement → analyze + rescope, criteria-first-tdd, shape-authoring |
| `commands/` | Flat `.md` skill files (legacy format) | NO (`.gitkeep` only) | — |
| `agents/` | Subagent `.md` definitions with custom prompts/tools/models | NO (`.gitkeep` only) | Planned: sdd-shape-validator, sdd-code-reviewer |
| `hooks/hooks.json` | Event handlers — lifecycle automation | YES (8 hooks) | Enforcement gradient: context → warn → block |
| `bin/` | Executables added to Bash tool's PATH | NO | Not present. Could ship: discover-shapes, validate-shape CLI tools |
| `settings.json` | Default settings applied when plugin enabled (currently: `agent` key only) | NO | Not present. Could set default SDD agent |
| `output-styles/` | Output formatting definitions | NO | Not present |
| `.mcp.json` | MCP server configurations | NO | Not present. Could ship: shape registry MCP server |
| `.lsp.json` | LSP server configurations for code intelligence | NO | Not present. Could ship: shape-aware TypeScript LSP |
| `CLAUDE.md` | Plugin instructions — **NOT auto-loaded into LLM context** | YES | Developer docs only. Behavioral rules delivered via bootstrap skill instead |

**Coverage: 3 of 11 components used (27%)**

---

## 2. plugin.json Manifest Fields

| Field | Type | Required | zeroh-sdd Has? | Current Value |
|-------|------|----------|----------------|---------------|
| `name` | string | YES | YES | `"zeroh-sdd"` |
| `version` | string | no | YES | `"0.1.0"` |
| `description` | string | no | YES | `"Shape-Driven Development — shapes as RED tests..."` |
| `author` | object | no | YES | `{ "name": "Blade Labs", "url": "..." }` |
| `homepage` | string | no | NO | Missing — should point to README or docs |
| `repository` | string | no | YES | GitHub URL |
| `license` | string | no | YES | `"Apache-2.0"` |
| `keywords` | array | no | YES | `["sdd", "tdd", "shapes", "zod", "enforcement", "methodology"]` |
| `skills` | string/array | no | NO | Uses default `skills/` convention |
| `commands` | string/array | no | NO | Uses default `commands/` convention |
| `agents` | string/array | no | NO | Uses default `agents/` convention |
| `hooks` | string/array/object | no | NO | Uses default `hooks/hooks.json` convention |
| `mcpServers` | string/array/object | no | NO | — |
| `lspServers` | string/array/object | no | NO | — |
| `outputStyles` | string/array | no | NO | — |
| `userConfig` | object | no | NO | Missing — should prompt for shapes_directory, enforcement_level |
| `channels` | array | no | NO | — |

**Coverage: 7 of 17 fields populated (41%)**

---

## 3. Hook Events

| Event | When It Fires | Matcher | Can Block? | zeroh-sdd Uses? | How It Uses It |
|-------|--------------|---------|------------|-----------------|----------------|
| `SessionStart` | Session begins/resumes | `startup\|resume\|clear\|compact` | No | YES | `session-start.sh` — reports pipeline state, recovers context from `.vibe/context-snapshot.md` |
| `SessionEnd` | Session terminates | `clear\|logout\|other` | No | YES | `session-end.sh` — archives transcript to `.vibe/{slug}/session_{id}.jsonl.gz` |
| `PreToolUse` | Before tool executes | Tool name (`Write\|Edit`) | Yes (deny/ask) | YES | `phase-context.sh` — detects file type (shape/test/route/store/component), injects checklist as `additionalContext` |
| `PostToolUse` | After tool succeeds | Tool name (`Write\|Edit`) | Yes (block) | YES | `ap-detector.sh` — 18 anti-patterns via grep/diff. `commit-hygiene.sh` — uncommitted file reminder |
| `PostToolUseFailure` | After tool fails | Tool name | No | NO | Could inject SDD-specific remediation for shape/type errors |
| `PreCompact` | Before context compaction | `manual\|auto` | No | YES | `pre-compact.sh` — writes `.vibe/context-snapshot.md` with current task, spec path, recent commits |
| `PostCompact` | After compaction completes | `manual\|auto` | No | NO | Could re-inject SDD pipeline state after memory loss |
| `Stop` | Claude finishes responding | None (always fires) | Yes (block) | YES | `stop-check.sh` — blocks if uncommitted files on feature branch. `stop-quality-gate.sh` — blocks if shape/.meta()/test violations |
| `StopFailure` | Turn ends due to API error | Error type | No | NO | — |
| `UserPromptSubmit` | User submits prompt | None (always fires) | Yes (block) | NO | Could inject SDD pipeline state before every prompt. **Risk: known bug #10225** |
| `SubagentStart` | Subagent spawned | Agent type | No | NO | Could inject SDD context into subagents |
| `SubagentStop` | Subagent finishes | Agent type | Yes (block) | NO | Could validate subagent output against shapes |
| `TaskCreated` | Task created via TaskCreate | None (always fires) | Yes (exit 2) | NO | Could validate tasks against SDD criteria |
| `TaskCompleted` | Task marked completed | None (always fires) | Yes (exit 2) | NO | Could verify per-task gate before allowing completion |
| `TeammateIdle` | Agent team member about to idle | None (always fires) | Yes (exit 2) | NO | — |
| `InstructionsLoaded` | CLAUDE.md or rules loaded | `session_start\|nested_traversal\|include\|compact` | No | NO | Could augment CLAUDE.md with shape context on load |
| `ConfigChange` | Config file changes during session | Config source | Yes | NO | — |
| `CwdChanged` | Working directory changes | None (always fires) | No | NO | Could re-discover shapes when changing directories |
| `FileChanged` | Watched file changes on disk | Literal filenames | No | NO | Could watch `*.shape.ts` — re-validate consumers on shape change |
| `WorktreeCreate` | Worktree being created | None (always fires) | Yes | NO | — |
| `WorktreeRemove` | Worktree being removed | None (always fires) | No | NO | — |
| `PermissionRequest` | Permission dialog appears | Tool name | Yes | NO | — |
| `PermissionDenied` | Auto mode denies tool | Tool name | No (retry: true) | NO | — |
| `Notification` | Claude sends notification | `permission_prompt\|idle_prompt\|auth_success` | No | NO | — |
| `Elicitation` | MCP server requests user input | MCP server name | Yes | NO | — |
| `ElicitationResult` | User responds to elicitation | MCP server name | Yes | NO | — |

**Coverage: 6 of 25+ events used (24%)**

---

## 4. Hook Types

| Type | Description | Input | Output | zeroh-sdd Uses? | How It Uses It |
|------|-------------|-------|--------|-----------------|----------------|
| `command` | Execute shell command | JSON via stdin | Exit code + stdout JSON | YES (all 8 hooks) | Bash scripts parse stdin with `node -e`, grep/diff for patterns, emit `hookSpecificOutput` JSON |
| `prompt` | LLM-driven evaluation | JSON via `$ARGUMENTS` | Yes/no decision JSON | NO | Could evaluate semantic shape quality (enum appropriateness, field naming, business rule completeness) |
| `agent` | Agentic verifier with tools | JSON via `$ARGUMENTS` | Agent decision via tools | NO | Could run multi-step verification: read shape → parse file → compare → report violations |
| `http` | POST webhook to URL | JSON as POST body | HTTP response | NO | Could send hook events to external monitoring/observability |

**Coverage: 1 of 4 types used (25%)**

---

## 5. Hook Output Capabilities

### PreToolUse Output

| Field | Type | Description | zeroh-sdd Uses? | How |
|-------|------|-------------|-----------------|-----|
| `permissionDecision` | `allow\|deny\|ask\|defer` | Control tool execution | YES | `phase-context.sh` uses allow/deny/ask based on `hook-overrides.json` mode per file type |
| `permissionDecisionReason` | string | Shown to user on deny/ask | NO | — |
| `updatedInput` | object | Modify tool input before execution | NO | Could inject shape metadata into file content before write |
| `additionalContext` | string | Text injected into LLM context | YES | `phase-context.sh` injects file-type checklists (shape/test/route/store/component) |

### PostToolUse Output

| Field | Type | Description | zeroh-sdd Uses? | How |
|-------|------|-------------|-----------------|-----|
| `additionalContext` | string | Text injected into LLM context | YES | `ap-detector.sh` injects anti-pattern violations. `commit-hygiene.sh` injects commit reminder |
| `decision: "block"` | string | Block and show reason to Claude | NO | Could block on critical shape violations |
| `updatedMCPToolOutput` | string | Replace MCP tool output | NO | — |

### Stop Output

| Field | Type | Description | zeroh-sdd Uses? | How |
|-------|------|-------------|-----------------|-----|
| `decision: "block"` | string | Prevent Claude from stopping | YES | `stop-check.sh` blocks on uncommitted files. `stop-quality-gate.sh` blocks on quality violations |
| `reason` | string | Shown to Claude as feedback | YES | Describes uncommitted files or quality violations |

### Common Output Fields

| Field | Type | Description | zeroh-sdd Uses? | How |
|-------|------|-------------|-----------------|-----|
| `continue` | boolean | If false, halt processing | NO | — |
| `suppressOutput` | boolean | Hide output from transcript | NO | — |
| `systemMessage` | string | Message passed to Claude's context | NO | Uses `additionalContext` in `hookSpecificOutput` instead |
| `stopReason` | string | Reason if `continue: false` | NO | — |

---

## 6. Hook Input Fields

| Field | Available In | Description | zeroh-sdd Reads? | How |
|-------|-------------|-------------|-------------------|-----|
| `session_id` | All events | Unique session identifier | YES | `session-end.sh` uses for archive filename |
| `transcript_path` | All events | Path to session transcript JSONL | YES | `session-end.sh` reads for archival |
| `cwd` | All events | Current working directory | NO | Uses `$CLAUDE_PROJECT_DIR` env var instead |
| `permission_mode` | All events | Current permission mode | NO | — |
| `hook_event_name` | All events | Event that triggered this hook | NO | Hardcoded per script |
| `tool_name` | PreToolUse/PostToolUse | Name of tool being called | YES | `phase-context.sh` and `ap-detector.sh` parse from stdin |
| `tool_input` | PreToolUse/PostToolUse | Tool arguments (file_path, content, etc.) | YES | All PostToolUse hooks extract `tool_input.file_path` |
| `tool_response` | PostToolUse | Tool execution result | NO | — |
| `tool_use_id` | Pre/PostToolUse | Unique tool call identifier | NO | — |
| `error` | PostToolUseFailure | Error message from failed tool | NO | — |
| `source` | SessionStart | `startup\|resume\|clear\|compact` | YES | `session-start.sh` detects resume vs fresh start |
| `prompt` | UserPromptSubmit | User's prompt text | NO | — |
| `reason` | Stop/SessionEnd | Why stopping/ending | YES | `session-end.sh` uses for archive filename |
| `file_path` | FileChanged | Path of changed file | NO | — |
| `change_type` | FileChanged | `created\|modified\|deleted` | NO | — |
| `agent_id` | SubagentStart/Stop | Subagent identifier | NO | — |
| `agent_type` | SubagentStart/Stop | Subagent type name | NO | — |

---

## 7. Environment Variables

| Variable | Available In | Description | zeroh-sdd Uses? | How |
|----------|-------------|-------------|-----------------|-----|
| `$CLAUDE_PROJECT_DIR` | All command hooks | Project root path | YES | Used in conflict detection, file path resolution |
| `${CLAUDE_PLUGIN_ROOT}` | All hooks, MCP, LSP, skills, agents | Plugin installation directory | YES | All hook commands: `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/*.sh` |
| `${CLAUDE_PLUGIN_DATA}` | All hooks, MCP, LSP | Persistent data directory (survives updates) | NO | Should use for shape registry, violation state, session snapshots |
| `$CLAUDE_ENV_FILE` | SessionStart, CwdChanged, FileChanged | Persist env vars for session | NO | Could persist SDD pipeline state as env vars |
| `$CLAUDE_CODE_REMOTE` | All hooks | `"true"` in web, unset in CLI | NO | — |
| `${CLAUDE_SESSION_ID}` | Skills (string substitution) | Current session ID | NO | — |
| `${CLAUDE_SKILL_DIR}` | Skills (string substitution) | Directory containing SKILL.md | NO | — |

---

## 8. Skill Capabilities

### SKILL.md Frontmatter Fields

| Field | Description | zeroh-sdd Uses? | How |
|-------|-------------|-----------------|-----|
| `name` | Display name / slash command | YES (14 skills) | e.g., `speckit-specify`, `criteria-first-tdd` |
| `description` | When to use — model reads for auto-matching | YES | e.g., "SDD bootstrap — pipeline overview, skill inventory" |
| `disable-model-invocation` | Only user can invoke (not model) | YES | Set to `false` on all skills — model can auto-invoke |
| `argument-hint` | Hint shown during autocomplete | NO | — |
| `user-invocable` | Set `false` to hide from `/` menu | NO | All skills are user-invocable |
| `allowed-tools` | Tools allowed without permission prompt | NO | Could pre-approve Read/Grep for analysis skills |
| `model` | Override model for this skill | NO | — |
| `effort` | Override effort level | NO | — |
| `context` | `fork` to run in forked subagent | NO | Could isolate long-running analysis skills |
| `agent` | Which subagent type for `context: fork` | NO | — |
| `hooks` | Hooks scoped to skill lifetime | NO | Could add skill-specific validation hooks |
| `paths` | Glob patterns for auto-activation | NO | Could auto-activate shape-authoring on `*.shape.ts` |
| `shell` | Shell for inline commands (`bash`/`powershell`) | NO | — |

### Skill Content Features

| Feature | Description | zeroh-sdd Uses? | How |
|---------|-------------|-----------------|-----|
| `$ARGUMENTS` | User input after skill name | YES | Skills use `$ARGUMENTS` for feature descriptions, file paths |
| `$ARGUMENTS[N]` / `$N` | Indexed argument access | NO | — |
| `` !`command` `` | Inline shell execution (preprocessing) | NO | Could inject live pipeline state via `!git log --oneline -5` |
| ` ```! ` code blocks | Multi-line shell preprocessing | NO | — |
| Supporting files | Extra files alongside SKILL.md | YES | Templates in `templates/`, context fragments in `scripts/hooks/context/` (referenced by hooks, not skills directly) |
| `${CLAUDE_SKILL_DIR}` | Path to skill's directory | NO | — |

**Skill frontmatter coverage: 3 of 12 fields used (25%)**

---

## 9. Agent Capabilities

### Agent Frontmatter Fields

| Field | Description | Plugin Allowed? | zeroh-sdd Uses? | Planned |
|-------|-------------|----------------|-----------------|---------|
| `name` | Unique identifier | YES | NO | `sdd-shape-validator`, `sdd-code-reviewer` |
| `description` | When to delegate to this agent | YES | NO | Shape validation, SDD code review |
| `tools` | Available tools (inherits all if omitted) | YES | NO | Read-only: Read, Grep, Glob |
| `disallowedTools` | Tools to deny | YES | NO | `Write, Edit` (read-only agents) |
| `model` | Model to use (`sonnet`/`opus`/`haiku`/inherit) | YES | NO | `haiku` for validator, `sonnet` for reviewer |
| `maxTurns` | Max agentic turns | YES | NO | 5 for validator, 10 for reviewer |
| `skills` | Skills preloaded at startup | YES | NO | Could preload `criteria-first-tdd`, `shape-authoring` |
| `memory` | Persistent memory scope | YES | NO | — |
| `background` | Always run as background task | YES | NO | — |
| `effort` | Override effort level | YES | NO | — |
| `isolation` | `worktree` for git worktree isolation | YES | NO | — |
| `color` | Display color in UI | YES | NO | — |
| `initialPrompt` | Auto-submitted first user turn | YES | NO | — |
| `permissionMode` | Permission mode override | **NO (plugin restriction)** | — | — |
| `hooks` | Lifecycle hooks scoped to agent | **NO (plugin restriction)** | — | — |
| `mcpServers` | MCP servers for this agent | **NO (plugin restriction)** | — | — |

**zeroh-sdd ships 0 agents. 14 of 16 fields are available to plugin agents.**

---

## 10. Hook Configuration Features

| Feature | Description | zeroh-sdd Uses? | How |
|---------|-------------|-----------------|-----|
| Matcher patterns | Filter which tools/events trigger hook | YES | `Write\|Edit` on PreToolUse/PostToolUse |
| Regex matchers | JS regex for complex tool matching | NO | Could match `mcp__.*` for MCP tools |
| `if` conditional | Permission rule syntax for conditional execution | NO | Could use `if: "Write(*.shape.ts)"` for shape-only hooks |
| `timeout` | Hook execution timeout (ms) | NO | Should set — hooks have <200ms performance budget |
| `statusMessage` | Custom status message during hook execution | PARTIAL | Only on `phase-context.sh` (`"Checking file type..."`) |
| `once` | Fire only once per session | NO | — |
| `async` | Run in background without blocking | NO | Could make session-end archival async |
| Multiple hooks per matcher | Array of hooks in one matcher group | YES | PostToolUse has `[ap-detector, commit-hygiene]` in one group |
| Multiple matcher groups | Different matchers for same event | NO | Could add separate matchers for shape files vs test files |
| Hook deduplication | Identical handlers auto-deduplicated | Implicit | — |
| `disableAllHooks` | Master switch to disable all hooks | NO | — |

---

## 11. Multi-Platform Adapter Coverage

| Platform | Adapter File | Gets Skills? | Gets Hooks? | Gets Agents? |
|----------|-------------|-------------|-------------|-------------|
| Claude Code | `.claude-plugin/plugin.json` + `hooks/hooks.json` | YES (14) | YES (8) | Planned |
| Cursor | `.cursor-plugin/plugin.json` | YES (14) | NO | NO |
| Copilot | `.copilot/plugin.yaml` | YES (14) | NO | NO |
| Gemini | `gemini-extension.json` + `GEMINI.md` | YES (14) | NO | NO |
| Codex | `.codex/INSTALL.md` | YES (14) | NO | NO |

**Only Claude Code gets the full enforcement gradient.** All other platforms get skills (prose knowledge) only.

---

## 12. Summary Scorecard

| Category | Available | Used | Coverage |
|----------|-----------|------|----------|
| Plugin components | 11 | 3 | **27%** |
| Manifest fields | 17 | 7 | **41%** |
| Hook events | 25+ | 6 | **24%** |
| Hook types | 4 | 1 | **25%** |
| Skill frontmatter fields | 12 | 3 | **25%** |
| Agent frontmatter fields | 16 | 0 | **0%** |
| Environment variables | 7 | 2 | **29%** |
| Hook output capabilities | 10 | 4 | **40%** |

**Overall: zeroh-sdd uses ~25% of the available Claude Code plugin surface area.**

---

## 13. Highest-Value Unused Capabilities

| Rank | Capability | Why It Matters for SDD |
|------|-----------|----------------------|
| 1 | `prompt` hook type | LLM-evaluated semantic validation — catches what grep can't (wrong enum values, missing business rules) |
| 2 | `${CLAUDE_PLUGIN_DATA}` | Persistent shape registry + violation state across sessions/updates |
| 3 | `PostCompact` event | Re-inject SDD pipeline state after context compaction (currently lost) |
| 4 | `agent` hook type | Multi-step verification with tools (read shape → parse file → compare) |
| 5 | `userConfig` manifest | Prompt for project-specific settings on plugin enable (shapes path, enforcement level) |
| 6 | `updatedInput` (PreToolUse) | Modify tool input before execution — inject shape metadata into file writes |
| 7 | `FileChanged` event | Watch `*.shape.ts` files — trigger re-validation of consumers on change |
| 8 | `paths` skill frontmatter | Auto-activate `shape-authoring` skill when editing `*.shape.ts` |
| 9 | `agents/` definitions | Ship specialized read-only agents for shape validation and SDD code review |
| 10 | `bin/` executables | Ship `discover-shapes`, `validate-shape` CLI tools callable from Bash |
