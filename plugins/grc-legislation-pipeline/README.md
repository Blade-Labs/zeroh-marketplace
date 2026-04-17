# grc-legislation-pipeline

Akoma Ntoso ingestion, LegalRuleML first-pass + LKIF Hohfeldian second-pass normalization, routing preparation. Maps to phase β of the rebuild2 design plan (β1 source structure / β2 LRML normalization / β3 LKIF refinement + routing).

## Purpose

Load this plugin for legislation-admission work. It ships the three specialist subagents + four authoring skills needed to take a raw legal source from AKN parse → provision-segmented candidate unit → LRML-classified normalized statement → LKIF-refined Hohfeldian legal position.

## Included components

| Type | Name | Role |
|---|---|---|
| Subagent | `legal-source-engineer` | AKN/ELI source identity, AKN parse, source QC, provision segmentation (β1) |
| Subagent | `deontic-modeler` | LegalRuleML first-pass normalization — statement class + deontic operator (β2) |
| Subagent | `lkif-refiner` | LKIF Hohfeldian second-pass refinement — right/duty/power/liability/immunity (β3) |
| Skill | `akn-intake` | Source-preserving AKN ingestion; preserves Work/Expression/Manifestation/Provision identity |
| Skill | `normalize-legal-statement` | Author a `legproc:NormalizedLegalStatement` with full AKN/ELI source identity |
| Skill | `lrml-lkif-pass` | Execute the two-pass legal normalization (LRML mandatory first; LKIF mandatory second) |
| Skill | `routing-bindings` | Materialize `legproc:routeToArtifactType` edges via SPARQL over routing-class scheme |
| Hook | `legal_integrity_hint.py` | PostToolUse Edit/Write — JIT-warn if NormalizedLegalStatement edits omit sourceProvision / sourceText / jurisdiction or reintroduce a flattened `normType` taxonomy |

## Installation

See repo-level `.claude/settings.json` — this plugin is auto-enabled via the in-repo marketplace pattern when you trust the `grc-zod-poc` (or alpha) folder. External consumers install via `/plugin install grc-legislation-pipeline@zeroh-marketplace`.

## Hook discipline

The `legal_integrity_hint.py` hook is PostToolUse JIT-injection; it never blocks. Matches AGENTS.md §6 + `.claude/README.md`.

## Cross-reference to repo-scoped skills

- `normalize-legal-statement` (this plugin, authoring workflow) ↔ `provenance-completeness-auditor` (repo-scoped `.claude/skills/`, own-thinking refuser on AKN/ELI field omission)

Both compose: `deontic-modeler` + `normalize-legal-statement` drafts the admitted statement; `provenance-completeness-auditor` fires in the same turn if the draft skips `sourceTextHash` / `parserVersion` / etc.

## Authoritative references

- `AGENTS.md` §4 P4 (AKN/ELI source identity) + P11 (full 10-field identity contract)
- `AGENTS.md` §9 delegation map — names the three subagents for legislation-pipeline work
- `docs/architecture/rebuild2-design-plan.md` §8 phase β (β1 / β2 / β3 sub-phases)
- `docs/architecture/rebuild2-external-review-final.md` §5.3 sibling profiles + §5.4 AKN/ELI identity + §5.5 segment-provisions + §5.6 LRML/LKIF role split

## License

Apache-2.0. See LICENSE.
