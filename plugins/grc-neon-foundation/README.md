# grc-neon-foundation

NeOn methodology, ORSD alignment, bundle governance, and closed-world guardrails for the GRC system.

## Purpose

Foundational plugin for architecture-heavy sessions. Load this first when working on requirements, bundle edits, plugin boundaries, or anti-drift review.

## Included components

| Type | Name | Role |
|---|---|---|
| Subagent | `neon-methodologist` | Owns NeOn methodology + ORSD traceability + modular boundaries + reuse-vs-extension decisions + change scoping |
| Subagent | `bundle-architect` | Owns the profile/bundle/policy layer; keeps plugin manifests, shapes, and docs in sync with the bundle |
| Subagent | `cwa-auditor` | Read-only specialist for closed-world invariants; review / audit / pre-merge gate |
| Skill | `orsd-review` | Review a proposal against the NeOn ORSD, production spine, accepted ADRs, and rebuild phases |
| Skill | `cwa-guardrails` | Background closed-world guardrails for schema, JSON-LD, SHACL, mapping, and runtime code |
| Skill | `adr-draft` | Draft or update an ADR from repo context + current architecture constraints |
| Skill | `bundle-diff` | Compare code/doc changes against the production bundle and identify required bundle/shape/policy deltas |
| Hook | `session_context.py` | SessionStart — injects repository-posture reminder as additionalContext |
| Hook | `warn_destructive_bash.py` | PostToolUse Bash — emits JIT warning on destructive commands (never blocks) |
| Hook | `scan_forbidden_patterns.py` | PostToolUse Edit/Write — emits JIT warning on CWA-violating patterns in edited files |

## Installation

This plugin is dual-resident. **In the `grc-zod-poc` and `GRC-ZOD-Alpha` repos it is auto-enabled** via the in-repo marketplace pattern:

```json
{
  "extraKnownMarketplaces": {
    "grc-zod-poc-local": {
      "source": { "source": "directory", "path": "." }
    }
  },
  "enabledPlugins": {
    "grc-neon-foundation@grc-zod-poc-local": true
  }
}
```

For external consumers via the Blade Labs plugin marketplace:

```
/plugin install grc-neon-foundation@zeroh-marketplace
```

## Hook discipline

Per AGENTS.md §6 + `.claude/README.md` conventions, all hooks in this plugin are **JIT-injection, not blocking**. `warn_destructive_bash.py` replaces the original `block_destructive_bash.py` from the implementation pack — the action executes, then a PostToolUse hook emits a next-turn system reminder. Teaching-not-blocking.

## Cross-references to repo-scoped skills

Plugin-scoped skills here compose with grc-zod-poc's repo-scoped `.claude/skills/`:

- `cwa-guardrails` (this plugin, authoring workflow) ↔ `cwa-fallback-detector` (repo-scoped, own-thinking refuser)
- `bundle-diff` (this plugin, authoring workflow) ↔ `bundle-iri-source-of-truth` (repo-scoped, own-thinking refuser)
- `adr-draft` (this plugin, authoring workflow) ↔ `adr-status-checker` (repo-scoped, phase-merge blocker) + `staged-doc-drafting` (repo-scoped, methodology)

Both layers fire in the same turn; both help.

## Authoritative references

- `AGENTS.md` §9 delegation map — names the three subagents as first-line delegation targets
- `AGENTS.md` §3 CWA cascade + §4 P1-P12 — the invariants this plugin enforces
- `docs/architecture/rebuild2-design-plan.md` §12 ADRs — the decisions this plugin protects
- `docs/architecture/qcb-neon-orsd.md` NFRs + CQs — the requirements contract

## License

Apache-2.0. See LICENSE.
