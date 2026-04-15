# zeroh-roadmap — Installation for Codex

## Quick Install

1. Clone the plugin:
   ```bash
   git clone https://github.com/Blade-Labs/zeroh-roadmap.git ~/.agents/plugins/zeroh-roadmap
   ```

2. Symlink skills to Codex skill directory:
   ```bash
   ln -s ~/.agents/plugins/zeroh-roadmap/skills ~/.agents/skills/zeroh-roadmap
   ```

3. Add to your AGENTS.md (or project-level agent config):
   ```markdown
   ## Skills
   Include skills from ~/.agents/skills/zeroh-roadmap/*/SKILL.md
   ```

## Verify Installation

After setup, the following skills should be discoverable:
- 6 roadmap skills (do-phase, plan-phase, review-phase, code-review, full-code-review, test-strategy)
- 4 specialist agents (code-reviewer, software-architect, software-developer, test-engineer)
- 1 bootstrap skill (using-zeroh-roadmap)

## Update

```bash
cd ~/.agents/plugins/zeroh-roadmap && git pull
```
