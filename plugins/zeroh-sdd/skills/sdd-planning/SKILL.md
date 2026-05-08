---
name: sdd-planning
description: Primary planning front door for zeroh-sdd. Use for non-trivial vibecoding work, upgrade planning, feature planning, remediation planning, or any request where the LLM agent must decide whether to draft a long-form plan, build an epic tracker, or go straight to execution-spec.
---

# sdd-planning

This is the canonical user-facing planning skill. The user should not have to choose between `staged-doc-drafting`, `epic-planning`, and `execution-spec`. Use this skill to classify the request, select the smallest useful planning path, and converge actionable work into one enforceable `execution-spec`.

## Core Rule

One planning process, one runtime contract.

Every path must end in exactly one of these outcomes:

- a current `execution-spec` with exactly one fenced `sdd` block and one `stage_gate`
- a non-execution artifact explicitly marked as not ready for implementation, with the next evidence needed

Do not leave a long-form plan, epic tracker, or todo list as the final execution authority. Runtime authority begins only when `execution-spec` writes the `sdd` contract and `zeroh-sdd stage set` writes `.specify/workflows/active-stage.json`.

## Scope Classifier

Classify before drafting:

| Request shape | Path |
| --- | --- |
| Next proof gate is obvious | Go straight to `execution-spec` |
| Long document or many cross-section decisions | Use `staged-doc-drafting` through Stage 4, then continue here |
| Work spans multiple MCs, phases, stories, or proof packs | Use `epic-planning`, then select one story for `execution-spec` |
| Research, ADR, or strategy only | Produce the artifact and mark it not ready for implementation unless a current proof gate is selected |

If more than one row applies, compose them in order:

```text
staged-doc-drafting -> epic-planning -> one selected story -> execution-spec
```

Skip any layer that does not buy clarity. A tiny change should not receive an epic. A multi-week refactor should not jump straight into file edits without a durable tracker.

## Planning Flow

1. Capture intent, owner, evidence, non-goals, and acceptance signal.
2. Use live session tracking as the mirror of the current planning pass: Claude native todos when available, Codex task/progress tracking when available, or a compact in-message checklist otherwise.
3. If the plan is long-form, invoke `staged-doc-drafting` for Stage 0-4 only.
4. If the work spans multiple MCs, invoke `epic-planning` to create or update the macro tracker.
5. Select exactly one current MC or proof slice.
6. Hand that slice to `execution-spec`.
7. Ensure multi-MC handoff includes tracker metadata:

```yaml
tracker:
  kind: epic
  path: docs/epics/EPIC-example.md
  phase_id: P1
  item_id: S1
  todo_policy: mirror-current-slice
```

8. Run `zeroh-sdd check --plan <plan.md>` and `zeroh-sdd doctor --plan <plan.md>`.
9. Set the active stage before implementation.
10. After proof, finish with a receipt and update any epic tracker row explicitly.

Live session tracking is session UX only. Durable truth lives in the synthesized doc, epic tracker, execution spec, receipt, and `.specify/workflows/active-stage.json`.

## Tool Availability First

Before selecting `pnpm`, `npm`, `npx`, `biome`, `vitest`, `tsc`, promptfoo, or another repo tool as the proof command, verify that the command is runnable in the same shell the active agent will use for hooks and Bash. If the tool is missing or unrunnable, make the current MC "install/configure the proof toolchain" instead of writing implementation code against a proof command that cannot execute.

The runtime may report `TOOL_MISSING` or `TOOL_UNRUNNABLE` as `proof-command / replan` context. Treat that as infrastructure feedback, not blame on the edited file.

## Receipt Forms

If the proof passed:

```bash
zeroh-sdd stage finish --status passed \
  --proof-result "<command => pass>" \
  --changed "<path>" \
  --closed "<finding-id>" \
  --next-adjustment "Proceed to the next executable proof gate."
```

If the proof failed or the proof toolchain was unavailable:

```bash
zeroh-sdd stage finish --status failed \
  --proof-result "<command => fail: <reason>>" \
  --changed "<path>" \
  --opened "TOOL_MISSING" \
  --next-adjustment "Replan: make the proof command runnable before editing further."
```

A failed receipt closes the current gate only because it includes the replan handoff. Do not keep editing from the failed gate; start a new `execution-spec`.

## Supporting Skills

- `staged-doc-drafting` is a supporting method for long-form coherence. It owns Stage 0-4 and stops before SDD block authoring.
- `epic-planning` is a supporting method for macro phases, stories, proof packs, and durable progress state. It is not runtime authority.
- `execution-spec` is the compiler from planning into the enforceable runtime contract. It is the only skill that authors the fenced `sdd` block.

## Anti-Examples

- Asking the user to choose between staged drafting and epic planning when scope classification can decide.
- Producing a polished epic tracker with no selected next MC.
- Treating live todos/tasks as the tracker.
- Writing implementation files from a long-form plan before `execution-spec` sets the active stage.
- Creating an epic for a single obvious proof gate.
- Marking work done from a quiet hook run instead of a proof receipt.
