# Changelog

All notable changes to zeroh-sdd will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-04-06

### Added

- 14 skills: 11 speckit pipeline (specify, clarify, checklist, constitution, plan, shapes, tasks, taskstoissues, implement, analyze, rescope) + 2 enforcement (criteria-first-tdd, shape-authoring) + 1 bootstrap (using-zeroh-sdd)
- 6 enforcement hooks: stop-check (blocking), ap-detector (advisory), commit-hygiene (advisory), session-start (lifecycle), pre-compact (lifecycle), session-end (lifecycle)
- 7 context files for editable hook behavior (ap-registry, commit-hygiene, 4 phase guards, scaffold-warning)
- 11 anti-pattern detection patterns (8 Tier 1 grep + 3 Tier 2 diff)
- 7 templates (spec, plan, tasks, checklist, constitution, agent-file, extensions.yml)
- 6 scripts (check-prerequisites, common, create-new-feature, setup-plan, update-agent-context, per-task-gate)
- 7 extension points (pipeline hooks, AP registry, context files, drop-in skills/agents/commands, plugin composition)
- Multi-agent support: Claude Code, Gemini, GitHub Copilot, Cursor, Codex
- Apache-2.0 license

### Removed

- blade-design skill (extracted to [ui-design-skill](https://github.com/Blade-Labs/ui-design-skill))
- 4 brand themes (extracted to ui-design-skill)
