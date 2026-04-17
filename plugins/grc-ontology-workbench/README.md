# grc-ontology-workbench

Standards-first ontology reuse, canonical + operational + promoted mapping authoring, SHACL/SPARQL discipline. Maps to phase γ of the rebuild2 design plan (three-layer mapping: `oscalm:SetMapping` → `sssom:Mapping` → `owl:Axiom`).

## Purpose

Load this plugin for any ontology / mapping / shape / query work. Ships the three specialist subagents + four authoring skills that cover standards selection, three-layer mapping curation, and SHACL/SPARQL authoring.

## Included components

| Type | Name | Role |
|---|---|---|
| Subagent | `ontology-architect` | Standards-first reuse + mixing policy decisions; proposed-new-namespace gate |
| Subagent | `mapping-curator` | Authoring `oscalm:SetMapping` / `sssom:Mapping` / `owl:Axiom` chains; missing-pair vs `oscalm:noRelationship` curation |
| Subagent | `shacl-sparql-engineer` | SHACL shape + SPARQL constraint authoring + debugging |
| Skill | `ontology-reuse-plan` | Decide reuse-vs-extension for a proposed concept; cite standards first |
| Skill | `oscal-set-mapping` | Author a canonical `oscalm:SetMapping` with oscalUuid preservation |
| Skill | `sssom-pairwise` | Author an operational `sssom:Mapping` (NOT a custom `oscalm:PairwiseMapping`) |
| Skill | `shacl-sparql-check` | Author/validate a SHACL shape or SPARQL constraint against the spine bundle |
| Hook | `ontology_hint.py` | PostToolUse Edit/Write — JIT-warn on `mix:` namespace references, `oscalm:PairwiseMapping` (superseded), or casual `skos:exactMatch` use |
| Hook | `warn_destructive_sparql.py` | PostToolUse Bash — JIT-warn on `CLEAR/DROP` SPARQL, wildcard `DELETE WHERE`, or direct `INSERT DATA` to admitted graphs (bypasses staging-graph admission). Rewritten from pack's `block_dangerous_sparql.py` (PreToolUse blocker). |

## Installation

See repo-level `.claude/settings.json` — auto-enabled in `grc-zod-poc` + `GRC-ZOD-Alpha` via the in-repo marketplace pattern.

## Hook discipline

All hooks PostToolUse JIT-injection; never block. Matches AGENTS.md §6.

## Cross-references to repo-scoped skills

- `sssom-pairwise` (this plugin, authoring workflow) ↔ `sssom-mapping-shape` (repo-scoped, own-thinking refuser on custom pairwise class)
- `oscal-set-mapping` (this plugin, authoring workflow) ↔ `sssom-mapping-shape` (also cross-referenced — our refuser covers both layer decisions)
- `shacl-sparql-check` (this plugin, authoring workflow) ↔ `shacl-gate-enforcer` (repo-scoped, refuser on graph mutations bypassing @grc/validation)

## Authoritative references

- `AGENTS.md` §4 P5 (three-layer mapping with `sssom:Mapping` operational layer) + P11 (confidence on mappings) + P12 (staging-graph admission)
- `AGENTS.md` §9 delegation map — names the three subagents
- `docs/architecture/rebuild2-design-plan.md` §8 phase γ + §12 ADR-009 (promotion thresholds)
- `docs/architecture/rebuild2-external-review-final.md` §6 (three-layer mapping + sssom:Mapping decision)

## License

Apache-2.0. See LICENSE.
