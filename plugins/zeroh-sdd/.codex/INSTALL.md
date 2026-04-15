# zeroh-sdd — Installation for Codex

## Quick Install

1. Clone the plugin:
   ```bash
   git clone https://github.com/Blade-Labs/zeroh-sdd.git ~/.agents/plugins/zeroh-sdd
   ```

2. Symlink skills to Codex skill directory:
   ```bash
   ln -s ~/.agents/plugins/zeroh-sdd/skills ~/.agents/skills/zeroh-sdd
   ```

3. Add to your AGENTS.md (or project-level agent config):
   ```markdown
   ## Skills
   Include skills from ~/.agents/skills/zeroh-sdd/*/SKILL.md
   ```

## Verify Installation

After setup, the following skills should be discoverable:
- 11 speckit-* process skills (specify, clarify, plan, shapes, tasks, implement, etc.)
- 2 SDD enforcement skills (criteria-first-tdd, shape-authoring)
- 1 bootstrap skill (using-zeroh-sdd)

## Companion Plugin

For UI design with branded themes, install [ui-design-skill](https://github.com/Blade-Labs/ui-design-skill) separately.

## Update

```bash
cd ~/.agents/plugins/zeroh-sdd && git pull
```
