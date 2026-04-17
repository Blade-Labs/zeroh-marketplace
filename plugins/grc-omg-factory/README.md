# grc-omg-factory

DMN (1.5 formal, pinned per external-review §10 item 11), BPMN, CMMN artifact binding and cross-checking. Maps to phase δ of the rebuild2 design plan (δ1 DMN → δ2 BPMN → δ3 CMMN sub-phases).

## Purpose

Load this plugin for OMG-artifact binding work. Three specialist subagents (one per artifact family) + four authoring skills cover target-element population + cross-family bridge-reference validation.

## Included components

| Type | Name | Role |
|---|---|---|
| Subagent | `dmn-architect` | DMN 1.5 decision-table design + FEEL expression validation (phase δ1) |
| Subagent | `bpmn-architect` | BPMN process design + DMN bridges via `bpmn:BusinessRuleTask → dmn:DecisionTable` (phase δ2) |
| Subagent | `cmmn-architect` | CMMN case design + bridges to DMN (via `cmmn:DecisionTask`) + BPMN (via `cmmn:ProcessTask`) (phase δ3) |
| Skill | `dmn-bindings` | Populate `dmn:DecisionTable` + `dmn:InputClause` + `dmn:OutputClause` + `dmn:DecisionRule` per ADR-010 defaults |
| Skill | `bpmn-bindings` | Populate `bpmn:Process` + `bpmn:ServiceTask` + `bpmn:UserTask` + `bpmn:BusinessRuleTask` per ADR-010 defaults |
| Skill | `cmmn-bindings` | Populate `cmmn:Case` + `cmmn:HumanTask` + `cmmn:Milestone` + `cmmn:Sentry` + `cmmn:DecisionTask` + `cmmn:ProcessTask` per ADR-010 defaults |
| Skill | `artifact-cross-check` | Validate bridge-reference consistency across DMN/BPMN/CMMN emissions |

**No hooks** — OMG binding work is text authoring against an explicit target list; nothing destructive to warn about. All CWA concerns fall under the repo-scoped hooks + the three other plugins' hooks.

## Installation

See repo-level `.claude/settings.json` — auto-enabled in `grc-zod-poc` + `GRC-ZOD-Alpha` via the in-repo marketplace pattern.

## Cross-references to repo-scoped skills

No topical overlap with our 8 CWA-cascade skills — the four OMG skills here are purely authoring workflows at the OMG boundary.

## Authoritative references

- `AGENTS.md` §9 delegation map — names the three subagents for phase-δ work
- `docs/architecture/rebuild2-design-plan.md` §8 phase δ (δ1/δ2/δ3 sub-phases) + §12 ADR-010 (operational target granularity defaults)
- `docs/architecture/rebuild2-external-review-final.md` §7 (triple crown mandatory + binding defaults) + §10 item 11 (DMN 1.5 formal pin)

## License

Apache-2.0. See LICENSE.
