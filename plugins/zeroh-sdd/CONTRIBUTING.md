# Contributing to zeroh-sdd

zeroh-sdd is a thin core with 7 extension points. Most contributions are additive — drop a file, add a table row, or copy a template. No build step, no dependencies.

## Extension Points

### 1. Adding a skill

Create `skills/<name>/SKILL.md`. Claude auto-discovers all `skills/*/SKILL.md` files in the plugin root.

Required frontmatter:

```yaml
---
name: my-skill
description: One sentence — what the skill does and when to invoke it.
disable-model-invocation: false
---
```

The `name` field becomes the command handle (e.g., `my-skill`). The `description` is shown in the skill picker and used by the model to route intent.

Conventions:
- Use `speckit-<phase>` prefix for pipeline phase skills to keep them grouped.
- Reference plugin content via `${CLAUDE_PLUGIN_ROOT}/templates/` and `${CLAUDE_PLUGIN_ROOT}/scripts/`.
- Write artifacts to the user's repo under `specs/{feature-slug}/`, never into the plugin directory.
- Skills are pure Markdown — no code, no build step, no runtime dependencies.

### 2. Adding an AP detection pattern

Edit `scripts/hooks/context/ap-registry.md`. The `ap-detector.sh` hook reads this table at runtime — no code change required.

Add a row to the appropriate tier table:

**Tier 1** — grep-catchable patterns (any file, target <100ms):

```markdown
| AP-XXX-01 | `your regex here` | *.ts,*.tsx | Short message — what went wrong | Remediation — what to do instead. |
```

**Tier 2** — diff-catchable patterns (test files only, target <200ms):

```markdown
| AP-XXX-01 | Diff shows `+pattern` or `-pattern` | *.test.*,*.spec.* | Short message | Remediation. |
```

Column reference:
- `id` — unique across the registry, format `AP-<CATEGORY>-<NN>`
- `pattern` — regex or diff heuristic
- `file_filter` — comma-separated glob patterns
- `message` — shown to the model when the pattern fires
- `remediation` — actionable fix instruction

### 3. Adding a pipeline phase hook

Copy `templates/extensions.yml` to `.specify/extensions.yml` in your project (the project-local file takes precedence). Add entries under the relevant key:

```yaml
hooks:
  after_plan:
    - extension: my-check
      command: my-skill
      description: "What this hook does"
      optional: true   # true = prompts user; false = executes automatically
      prompt: "Instruction passed to the skill when it runs."
```

Available keys: `before_specify`, `after_specify`, `before_plan`, `after_plan`, `before_implement`, `after_implement`, and equivalents for every other pipeline phase.

To add a hook that applies to all projects, edit `templates/extensions.yml` in the plugin itself. Project-local `.specify/extensions.yml` always wins on conflict.

### 4. Tuning hook behavior

Each hook reads one or more context files from `scripts/hooks/context/`. Edit these files to change thresholds, messages, and rules without touching bash:

| File | Controls |
|------|----------|
| `ap-registry.md` | AP detection patterns (see section 2) |
| `commit-hygiene.md` | Uncommitted file threshold, commit reminder message |
| `phase-specify.md` | Guard rules for the specify phase |
| `phase-plan.md` | Guard rules for the plan phase |
| `phase-red.md` | Guard rules enforced before implementation begins |
| `phase-green.md` | Guard rules enforced after implementation |
| `scaffold-warning.md` | Warning shown when a scaffold conflict is detected |

Context files use `{{variableName}}` placeholders that hooks interpolate at runtime.

### 5. Adding an agent

Create `agents/<name>.md`. Required frontmatter:

```yaml
---
name: My Agent
description: What this agent does and when to use it.
model: claude-opus-4-5
color: purple
---
```

The agent body is the system prompt. Keep it focused — one job per agent. Agents appear in the agent picker alongside skills.

### 6. Adding a command

Create `commands/<name>.md`. Required frontmatter:

```yaml
---
name: my-command
description: One sentence — what the command does.
---
```

The file name becomes the slash command (e.g., `/my-command`). Commands are thin — they delegate to skills or run a single focused task. If your command needs more than 50 lines of instruction, split it into a skill.

### 7. Testing locally

Point Claude Code at your local plugin directory:

```bash
claude --plugin-dir /path/to/zeroh-sdd
```

Verify:
- Skills appear in the skill picker (`using-zeroh-sdd` should be visible)
- Enforcement hooks fire on `Write`/`Edit` events (`ap-detector`, `commit-hygiene`)
- `stop-check` fires on `Stop` events with uncommitted files present

For AP pattern changes, trigger the pattern in a test file and confirm the hook surfaces the correct `id` and `remediation` message.

For extensions.yml changes, run a pipeline phase and confirm the hook entry appears as optional (prompt shown) or mandatory (auto-executes).

### 8. Multi-agent compatibility

`SKILL.md` files work across 30+ agents. Every skill must be tested on Claude Code plus at least one of: Gemini, GitHub Copilot, Cursor, or Codex.

Adapter files that require updates when adding skills or bumping the version:

| File | Agent |
|------|-------|
| `GEMINI.md` | Gemini |
| `.codex/INSTALL.md` | Codex |
| `gemini-extension.json` | Gemini extension registry |

Frontmatter fields (`name`, `description`, `disable-model-invocation`) are the portable contract. Don't rely on agent-specific features inside `SKILL.md` bodies.

## PR Requirements

Before opening a pull request:

- [ ] Frontmatter is valid YAML with `name` and `description` fields present
- [ ] New hooks are tested locally (fire condition triggered, message verified)
- [ ] New AP patterns include both `message` and `remediation` columns (no blanks)
- [ ] Extensions.yml changes are tested with `optional: true` and `optional: false` variants
- [ ] README and `CLAUDE.md` skill/hook tables are updated if counts changed
- [ ] `package.json`, `gemini-extension.json`, and any adapter manifests reflect the new version if bumping

If you extracted a capability into a separate plugin (as was done with `ui-design-skill`), add it to the "Companion Plugins" section of `CLAUDE.md` and `skills/using-zeroh-sdd/SKILL.md`.
