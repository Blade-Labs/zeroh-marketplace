# LangGraph / DeepAgent SDK vs Claude Code Plugins

**Date:** 2026-04-10
**Source:** Official LangChain docs, DeepAgent SDK docs, LangGraph source
**Purpose:** Can zeroh-sdd's hook/skill/agent system be replicated outside Claude Code?

---

## Executive Summary

**DeepAgent SDK is a reverse-engineered Claude Code.** It provides middleware equivalents for every Claude Code hook event zeroh-sdd uses. Skills use the identical SKILL.md format — zero porting effort. The main loss is the plugin marketplace and declarative JSON hook configuration. The main gain is model-agnosticism and server deployment.

---

## 1. Architecture Comparison

| Dimension | Claude Code Plugins | LangGraph + DeepAgent SDK |
|-----------|-------------------|--------------------------|
| Extension model | Event-driven hooks (named lifecycle events) | Middleware composition (wrap/intercept) |
| Hook granularity | 25+ specific events | 5 middleware hooks (compose for more) |
| Hook types | 4 (command, prompt, agent, http) | Programmatic (Python/JS functions) |
| Context injection | `additionalContext` in hook JSON response | `wrap_model_call` modifies system prompt |
| Tool interception | stdin/stdout JSON contract (bash) | Function call with `ToolCallRequest` (Python/JS) |
| State management | File-based (hooks write to disk) | Checkpointer + Store (database-backed) |
| Model lock-in | Claude only | Any LLM (OpenAI, Anthropic, Google, etc.) |
| Execution env | CLI (local machine) | CLI, server, cloud (LangGraph Platform) |
| Plugin isolation | Process-level (bash subprocesses) | Function-level (Python/JS) |
| Distribution | Plugin marketplace (`claude plugin install`) | Package managers (pip/npm) |

**Fundamental difference:** Claude Code hooks are **declarative JSON → bash**. LangGraph middleware is **imperative Python/JS functions**. Simpler to configure vs more powerful.

---

## 2. Hook Event Mapping

### DeepAgent SDK Middleware Stack

| Middleware | Claude Code Equivalent |
|-----------|----------------------|
| `before_agent` | `SessionStart` hook |
| `after_agent` | `SessionEnd` / `Stop` hook |
| `wrap_tool_call` | `PreToolUse` + `PostToolUse` (wraps the tool execution) |
| `wrap_model_call` | `UserPromptSubmit` + context injection |
| `SummarizationMiddleware` | `PreCompact` / `PostCompact` |
| `SkillsMiddleware` | Skills (`skills/*/SKILL.md`) |
| `SubAgentMiddleware` | Agents (`agents/*.md`) |
| `PatchToolCallsMiddleware` | `updatedInput` in PreToolUse |
| `TodoListMiddleware` | TodoWrite tool |
| `MemoryMiddleware` | Session persistence / `${CLAUDE_PLUGIN_DATA}` |

### Per-Event Feasibility

| Claude Code Event | zeroh-sdd Uses? | LangGraph Equivalent | Feasibility |
|-------------------|-----------------|---------------------|-------------|
| `SessionStart` | YES (session-start.sh) | `before_agent` | **NATIVE** |
| `PreToolUse` | YES (phase-context.sh) | `wrap_tool_call` (before execute) | **NATIVE** |
| `PostToolUse` | YES (ap-detector.sh, commit-hygiene.sh) | `wrap_tool_call` (after execute) | **NATIVE** |
| `PreCompact` | YES (pre-compact.sh) | `SummarizationMiddleware` | **POSSIBLE** — less controllable |
| `Stop` | YES (stop-check.sh, stop-quality-gate.sh) | `after_agent` | **POSSIBLE** — cannot block response |
| `SessionEnd` | YES (session-end.sh) | `after_agent` | **NATIVE** |
| `UserPromptSubmit` | no | `wrap_model_call` | **POSSIBLE** — fires on every LLM call, not just user turns |
| `PostToolUseFailure` | no | `wrap_tool_call` exception handler | **NATIVE** |
| `FileChanged` | no | No equivalent | **HARD** — needs external file watcher |
| `PostCompact` | no | No direct equivalent | **HARD** — custom middleware needed |
| `SubagentStart/Stop` | no | `SubAgentMiddleware` events | **POSSIBLE** |
| `InstructionsLoaded` | no | No equivalent | **HARD** |

---

## 3. Tool Use Interception (PreToolUse / PostToolUse)

### Claude Code

```json
// PreToolUse hook receives via stdin:
{ "tool_name": "Write", "tool_input": { "file_path": "..." } }

// Hook responds with:
{
  "hookSpecificOutput": {
    "permissionDecision": "allow|deny|ask",
    "updatedInput": { "file_path": "modified_path" },
    "additionalContext": "Text injected into LLM context"
  }
}
```

### LangGraph (`wrap_tool_call`)

```python
async def sdd_tool_wrapper(request: ToolCallRequest, execute):
    tool_name = request.tool_call["name"]
    tool_args = request.tool_call["args"]
    
    # DENY — return ToolMessage directly (skip execution)
    if should_deny(tool_name, tool_args):
        return ToolMessage(content="Blocked: reason", tool_call_id=request.id)
    
    # MODIFY — override tool arguments
    if should_modify(tool_name, tool_args):
        modified = {**tool_args, "file_path": sanitize(tool_args["file_path"])}
        request = request.override(tool_call={**request.tool_call, "args": modified})
    
    # EXECUTE — run the tool
    result = await execute(request)
    
    # POST-TOOL — inspect result (equivalent to PostToolUse)
    violations = detect_anti_patterns(tool_args.get("file_path"))
    if violations:
        # Cannot inject additionalContext here — need wrap_model_call
        store_violations_in_state(violations)
    
    return result
```

### Key Gap: `additionalContext` Injection

Claude Code's `additionalContext` injects text directly into the LLM's context window at tool-use time. LangGraph's `wrap_tool_call` can only modify the tool call or its response. To inject context into the LLM:

```python
# Two-middleware coordination pattern:

# Middleware 1: wrap_tool_call sets a flag
async def detect_and_flag(request, execute):
    result = await execute(request)
    violations = detect_anti_patterns(request.tool_call["args"])
    if violations:
        # Store in agent state for the next model call
        state["pending_context"] = format_violations(violations)
    return result

# Middleware 2: wrap_model_call reads the flag
async def inject_context(messages, execute):
    if state.get("pending_context"):
        # Inject as system message before the next LLM call
        messages = [
            *messages,
            SystemMessage(content=state.pop("pending_context"))
        ]
    return await execute(messages)
```

**Verdict:** Tool interception is equivalent. JIT context injection requires two-middleware coordination — **POSSIBLE** but less elegant.

---

## 4. Skills (SKILL.md)

**This is the strongest equivalence point.** The SKILL.md format is a shared open standard ([agentskills.io](https://agentskills.io)).

| Capability | Claude Code | DeepAgent SDK | Rating |
|-----------|-------------|---------------|--------|
| SKILL.md format | Native | Native (same format) | **IDENTICAL** |
| Progressive disclosure | Frontmatter at startup, full on invoke | Frontmatter at startup, full on demand | **IDENTICAL** |
| Skill discovery | `skills/` directory convention | Directory-based via SkillsMiddleware | **IDENTICAL** |
| `$ARGUMENTS` substitution | Native | Native | **IDENTICAL** |
| `${CLAUDE_PLUGIN_ROOT}` | Native env var | Custom env var needed | **POSSIBLE** |
| Model auto-matching | Model reads description, invokes when relevant | Same pattern | **IDENTICAL** |
| `disable-model-invocation` | Frontmatter field | SkillsMiddleware config | **POSSIBLE** |

**zeroh-sdd's 14 skills port with zero file changes.**

The `langchain-ai/langchain-skills` repository distributes skills installable across Claude Code, DeepAgent CLI, Cursor, and Windsurf. Same SKILL.md format.

---

## 5. Agents / Subagents

| Capability | Claude Code | DeepAgent SDK | Rating |
|-----------|-------------|---------------|--------|
| Custom system prompt | `.md` file body | `system_prompt` param | **NATIVE** |
| Tool restrictions | `disallowedTools` frontmatter | `tools` array | **NATIVE** |
| Model selection | `model` frontmatter | `model` param (provider:model format) | **NATIVE** |
| Context isolation | Implicit (separate session) | Explicit (key filtering) | **NATIVE** |
| Max turns | `maxTurns` frontmatter | Turn limit config | **NATIVE** |
| Read-only agents | `disallowedTools: Write, Edit` | Remove tools from list | **NATIVE** |
| Async subagents | Not supported | Yes (remote async execution) | DeepAgent **superior** |
| Plugin agents can't have hooks/mcpServers | Security restriction | No such restriction | DeepAgent more flexible |

**zeroh-sdd's planned agents (sdd-shape-validator, sdd-code-reviewer) port cleanly.**

---

## 6. State Management & Persistence

| Capability | Claude Code | LangGraph | Winner |
|-----------|-------------|-----------|--------|
| Session state | Hook writes to files | Checkpointer (SQLite/Postgres/Redis) | **LangGraph** |
| Resume sessions | SessionStart reads files | Thread ID + checkpointer | **LangGraph** |
| Context compaction | PreCompact/PostCompact hooks | SummarizationMiddleware | Comparable |
| Persistent plugin data | `${CLAUDE_PLUGIN_DATA}/` directory | `Store` with namespaces | **LangGraph** |
| Cross-session memory | Manual file management | Long-term memory Store | **LangGraph** |
| Shape registry | Planned: JSON file in PLUGIN_DATA | Store namespace: `sdd/shape-registry` | **LangGraph** |
| Violation tracking | Planned: temp file per session | Agent state + checkpointer | **LangGraph** |

LangGraph's state management is fundamentally more capable than Claude Code's file-based approach.

---

## 7. Plugin Distribution

| Capability | Claude Code | LangGraph Ecosystem | Gap? |
|-----------|-------------|-------------------|------|
| Plugin marketplace | `claude plugin install` | No equivalent | **GAP** |
| Version management | Auto (7-day orphan cleanup) | Package manager versioning | Different |
| Cross-platform skills | SKILL.md (5 platforms) | SKILL.md (4+ platforms) | None |
| Persistent plugin data | `${CLAUDE_PLUGIN_DATA}` | Store / filesystem | **POSSIBLE** |
| One-command install | `/plugin install zeroh-sdd` | `pip install zeroh-sdd` | Different |
| Multi-platform adapters | 5 files (Cursor, Copilot, etc.) | SKILL.md is cross-platform | None for skills |

**The marketplace is the main loss.** Skills distribute cross-platform. Hooks/middleware require platform-specific packaging.

---

## 8. What You Lose Porting to LangGraph

1. **Plugin marketplace** — no `claude plugin install zeroh-sdd` equivalent
2. **Declarative hook config** — must write Python/JS instead of JSON + bash
3. **`PreCompact`/`PostCompact` exact equivalents** — summarization is less controllable
4. **`Stop` blocking** — cannot prevent agent from responding
5. **`additionalContext` elegance** — requires two-middleware coordination
6. **5-platform distribution** — Cursor/Copilot/Gemini adapters don't apply

## 9. What You Gain Porting to LangGraph

1. **Model-agnostic** — any LLM (OpenAI, Anthropic, Google, local models)
2. **Server deployment** — LangGraph Platform, DeepAgent Deploy
3. **Superior state management** — database-backed checkpointing, time-travel
4. **Async subagents** — remote execution, non-blocking
5. **Programmatic middleware** — more powerful than bash scripts
6. **Long-term memory** — cross-session Store with namespaces

---

## 10. Port Strategy (If We Proceed)

| Phase | What | Effort | Risk |
|-------|------|--------|------|
| 1 | Install 14 skills as-is via SkillsMiddleware | **Zero** — same SKILL.md format | None |
| 2 | Rewrite 8 bash hook scripts as Python middleware | **~2 days** — mechanical translation | Low — logic is simple grep/diff |
| 3 | Implement JIT context injection via wrap_model_call | **~1 day** — two-middleware pattern | Medium — timing coordination |
| 4 | Add checkpointer-based persistence for shape registry | **~1 day** — Store namespace | Low |
| 5 | Package as pip-installable middleware plugin | **~1 day** | Low |

**Total: ~5 days for a functional port. Skills are free. Hooks need rewriting.**

---

## 11. Recommendation

**Don't port. Dual-target.**

zeroh-sdd should remain a Claude Code plugin (its primary distribution channel) AND expose its skills via the shared SKILL.md standard for DeepAgent SDK / LangGraph consumers. The hooks are Claude Code-specific infrastructure that provides the enforcement gradient — this is the plugin's differentiating value. Porting hooks to middleware creates a maintenance burden for marginal reach.

**Strategy:**
- **Skills** (14 files): Cross-platform via SKILL.md standard. Works everywhere.
- **Hooks** (8 scripts): Claude Code-only. This is the enforcement gradient — the unique value proposition.
- **Agents** (planned): Define as `.md` files compatible with both Claude Code and DeepAgent SDK.
- **Future**: If DeepAgent SDK reaches critical mass, write a `zeroh-sdd-middleware` Python package that wraps the hook logic as middleware functions. The skill files are already portable.

---

## Sources

- [LangChain Custom Middleware Docs](https://docs.langchain.com/oss/python/langchain/middleware/custom)
- [Deep Agents SDK Overview](https://docs.langchain.com/oss/python/deepagents/overview)
- [Deep Agents Middleware System](https://deepwiki.com/langchain-ai/deepagents/2.2-middleware-system)
- [Deep Agents Skills System](https://deepwiki.com/langchain-ai/deepagents/2.4-skills-system)
- [DeepAgent SDK SubAgent Workflows](https://deepwiki.com/langchain-ai/deepagents/8.4-sub-agent-workflows)
- [Comparison: DeepAgents vs Claude Agent SDK](https://docs.langchain.com/oss/python/deepagents/comparison)
- [LangGraph Memory Overview](https://docs.langchain.com/oss/python/langgraph/memory)
- [LangChain Skills Repository](https://github.com/langchain-ai/langchain-skills)
- [Using Skills with Deep Agents (Blog)](https://blog.langchain.com/using-skills-with-deep-agents/)
- [Deep Agents: Claude Code Replica (Analysis)](https://medium.com/@richardhightower/deep-agents-langchain-just-open-sourced-a-replica-of-claude-code-69e72ced54b8)
- [LangChain Agent Middleware Blog](https://blog.langchain.com/agent-middleware/)
- [LangGraph + Claude Agent SDK Guide](https://www.mager.co/blog/2026-03-07-langgraph-claude-agent-sdk-ultimate-guide/)
