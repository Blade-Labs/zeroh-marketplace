# grc-platform-runtime

Repo scaffolding, TypeScript/package boundaries, Apache Jena Fuseki + TDB2 runtime discipline, and CI/release guardrails. Maps to phase α of the rebuild2 design plan (kernel + dev stack) plus cross-cutting CI + release concerns.

## Purpose

Load this plugin for platform / infrastructure / Fuseki / CI work. Three specialist subagents cover repo scaffolding, Fuseki operations, and CI gating; four skills handle new-slice creation, local Fuseki dev stack, test gates, and plugin release checks.

## Included components

| Type | Name | Role |
|---|---|---|
| Subagent | `platform-engineer` | Repo scaffolding, package slicing, TypeScript conventions; new `@grc/*` package creation |
| Subagent | `fuseki-operator` | Local dev Fuseki, TDB2 dataset lifecycle, SPARQL query discipline, performance debugging |
| Subagent | `ci-guardian` | CI gates, test strategy, release-prep + plugin-release checks |
| Skill | `new-slice` | Scaffold a new `@grc/*` package with tsdown + vitest + manifest |
| Skill | `fuseki-bootstrap` | Bring up local Fuseki + TDB2 + Jena SHACL dev stack (docker image pinned) |
| Skill | `test-gates` | Wire the P7/P8/P9 byte-determinism + idempotence + SHACL-gates acceptance tests |
| Skill | `plugin-release` | Package a plugin for marketplace publication (manifest version bump + CHANGELOG + validation) |
| Hook | `fuseki_admin_warner.py` | PostToolUse Bash — JIT-warn on destructive Fuseki / TDB2 / dataset admin commands. Rewritten from pack's `fuseki_guard.py` (PreToolUse blocker). |

## Plugin options (userConfig)

Consumers may set these via `/plugin` UI or in `.claude/settings.json` `pluginSettings`:

| Key | Description | Example |
|---|---|---|
| `fuseki_query_endpoint` | SPARQL query endpoint | `http://localhost:3030/grc/query` |
| `fuseki_update_endpoint` | SPARQL update endpoint | `http://localhost:3030/grc/update` |
| `fuseki_dataset_name` | Fuseki dataset name | `grc` |

## Installation

See repo-level `.claude/settings.json` — auto-enabled in `grc-zod-poc` + `GRC-ZOD-Alpha` via the in-repo marketplace pattern.

## Hook discipline

`fuseki_admin_warner.py` is PostToolUse JIT-injection; never blocks. Matches AGENTS.md §6.

## Cross-reference to repo-scoped skills

- `fuseki-bootstrap` (this plugin, authoring workflow) ↔ `fuseki-jena` (repo-scoped, own-thinking refuser on Oxigraph / in-memory / pyshacl reaching)

## Authoritative references

- `AGENTS.md` §4 P12 (staging-graph admission via @grc/dataset + @grc/validation) + P6 (LLM only through @grc/llm-router)
- `AGENTS.md` §9 delegation map — names the three subagents
- `docs/architecture/rebuild2-design-plan.md` §8 phase α deliverables + §12 ADR-013 (Fuseki + TDB2 + Jena SHACL substrate)
- `docs/architecture/rebuild2-external-review-final.md` §2 (Fuseki day-one decision) + §10 item 5 (OPENROUTER_API_KEY)

## License

Apache-2.0. See LICENSE.
