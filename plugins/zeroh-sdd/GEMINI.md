# zeroh-sdd: Shape-Driven Development

This extension provides 14 development skills and 6 enforcement hooks for the SDD pipeline.

## Available Skills

Load skills from the `skills/` directory. Each `SKILL.md` contains decision logic for one phase:

- `skills/using-zeroh-sdd/SKILL.md` — Bootstrap (read first)
- `skills/speckit-specify/SKILL.md` — Create feature spec
- `skills/speckit-plan/SKILL.md` — Implementation planning
- `skills/speckit-shapes/SKILL.md` — Shape briefs as RED tests
- `skills/speckit-tasks/SKILL.md` — Task generation
- `skills/speckit-implement/SKILL.md` — Task execution with per-task gates
- `skills/criteria-first-tdd/SKILL.md` — CRITERIA-RED-GREEN-RATCHET enforcement
- `skills/shape-authoring/SKILL.md` — Golden Zod shape template
- See `skills/` for all 14 skills

## Pipeline

specify → clarify → plan → shapes → tasks → implement → analyze

## Companion Plugin

For UI design with branded themes, install [ui-design-skill](https://github.com/Blade-Labs/ui-design-skill) separately.
