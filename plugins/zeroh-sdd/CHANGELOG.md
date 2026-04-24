# Changelog

All notable changes to zeroh-sdd will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-04-24

### Added

- 6 new anti-pattern codes absorbed from Blade-Labs/grc-zod-alpha-audit repo-scoped hooks (Phase B of the hook-consolidation sprint):
  - `AP-CWA-01` — `??` with non-boolean operand (nullish-coalescing silent default)
  - `AP-CWA-02` — empty or comment-only catch block (swallowed error)
  - `AP-CWA-03` — fallback model/provider chain in routing config
  - `AP-CWA-04` — wildcard `SELECT ?s ?p ?o` SPARQL read (provenance bypass)
  - `AP-HARD-01` — const block with ≥2 CURIE/URN/IRI values (hardcoded ontology data, awk multi-line)
  - `AP-WIRE-05` — `.parse()` / `safeParse()` / `validatedParse()` called without `*Schema` or `*Shape` imported (inverse of AP-WIRE-01)
- Two new registry tiers: `Tier 1: Closed-World Admission` (AP-CWA-*) and `Tier 1: Hardcoded Ontology Data` (AP-HARD-01).

### Fixed

- `grep -cE <pattern> || echo 0` bug in ap-detector.sh. Pre-existing — `grep -c` emits "0" and exits 1 on no-match, then `|| echo 0` appended a second "0"; `count="0\n0"` broke `(( count > N ))` arithmetic. Replaced with `... || true; count=${count:-0}` pattern at two sites (AP-ANY-01, AP-SHAPE-02).

### Context

Source manifest: `Blade-Labs/grc-zod-alpha-audit/docs/build-log/phase-b-signal-absorption-manifest-2026-04-24.md`. Once this release publishes, the consuming repo deletes its redundant `.claude/hooks/cwa-fallback-detector.sh`, `hardcoded-enum-detector.sh`, and `schema-parse-boundary-detector.sh` in Phase F of its sprint. Registry count: 19 → 25 AP codes.

### Non-breaking

Additive release. No removed or renamed codes. Consumers on v0.1.0 continue working.

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
