---
name: epic-planning
description: Supporting macro-tracker method inside zeroh-sdd. Use when `sdd-planning` has classified the work as spanning multiple MCs, phases, stories, proof packs, or durable progress rows. Do not use as the general planning front door; it prepares one candidate story for `execution-spec`.
---

# epic-planning

This supporting skill turns a synthesized long-form plan or scoped upgrade intent into a lean macro planning tracker. The normal user-facing front door is `sdd-planning`. This skill is not the runtime control plane; runtime authority remains `.specify/workflows/active-stage.json`. This document owns durable planning status only.

Use this skill when the work is larger than one execution spec and needs phases, stories, proof packs, status, or cross-story dependencies. Do not use it for a single current proof gate; that belongs to `execution-spec`.

## Core Rule

Produce the smallest epic tracker that lets Claude and the human choose the next executable MC without inventing custom runtime machinery.

The tracker is macro planning. The current MC is compiled by `execution-spec`. Claude native todos are only the live session mirror while Claude works; receipts and tracker rows are durable evidence.

## Required Shape

An epic tracker should use the Platform golden template practices:

- `epic`: id, name, status, date, branch
- `progress_summary`: story, phase, ADR, and deliverable counts
- `problem`: statement, anti-statement, biggest threat
- `decisions`: locked ADRs and pending questions
- `zone_assignments`: source-to-target ownership map
- `blocking_gate`: rule, check command, CLEAR/BLOCKED status
- `phases`: phase ids, story ids, gate, verify command, status
- `stories`: id, status, deps, deliverable, ADR links, proof
- `proof`: `verify_cmd`, expected, actual, passed, remediation
- `change_log`: decisions, discoveries, gates, retros

Keep markdown after the machine section short: human context, diagrams, and source links only. The tracker is not a long essay.

## Todo And Tracker Discipline

Use Claude native todos to mirror only the live work:

1. create todos for the current planning pass or current MC,
2. mark exactly one todo in progress,
3. complete a todo only after the associated proof or tracker edit is done.

Do not treat todos as durable project state. If the session is resumed elsewhere, the epic tracker, execution receipt, and active stage must be sufficient to recover.

## Handoff To execution-spec

After the epic tracker is coherent, choose one next candidate story or MC:

```yaml
tracker:
  kind: epic
  path: docs/epics/EPIC-example.md
  phase_id: P1
  item_id: S1
  todo_policy: mirror-current-slice
```

Pass that tracker row to `execution-spec`. `execution-spec` owns:

- repo triangulation for the current MC,
- the exactly-one fenced `sdd` block,
- `stage_gate` surfaces,
- proof command,
- stop/replan rule,
- `zeroh-sdd check --plan <plan.md>`,
- `zeroh-sdd doctor --plan <plan.md>`,
- `zeroh-sdd stage set`.

## Status Rules

- `NOT_STARTED`: no implementation has begun.
- `IN_PROGRESS`: current MC is active or about to become active.
- `PARTIAL`: work happened, but proof failed; include remediation.
- `COMPLETE`: proof passed and receipt/tracker row are updated.
- `BLOCKED`: cannot proceed; record the discovery and next decision needed.

Do not mark a story `COMPLETE` from memory. Completion requires a proof result and an execution receipt.

## Anti-Examples

- Duplicating runtime truth from `active-stage.json` into the epic.
- Detailing every future code edit before the current MC has proof.
- Using Claude todos as the only progress record.
- Marking a story complete because hooks were quiet.
- Running implementation before `blocking_gate.status` is CLEAR and pending decisions are empty.
