---
name: execution-spec
description: Create or revise a repo-grounded execution spec from user intent, Plan Mode output, review findings, or code state. Use before implementation needs commits, gates, active-stage write guards, proof commands, receipts, or handoff to another agent.
---

# execution-spec

This is the primary workflow for turning intent into executable work. It owns the bridge from planning to implementation. `sdd-readiness` is a handoff check; `ap-taxonomy` is reference material.

The job is not to draft documents. The job is to turn user intent, rough plans, specs, review findings, or code failures into a small execution spec, then keep prose, code, hooks, gates, receipts, and evidence in one feedback loop.

## Core Rule

Plan only to the next executable proof gate.

A roadmap may name later gates, dependencies, and abandon checkpoints, but only the next gate gets code rows, file surfaces, validation commands, implementation detail, and handoff criteria. After that gate executes, write the receipt and re-run Step N.0 before expanding the next slice.

## Tight Loop

```text
frame -> current slice -> execute -> receipt -> replan
```

1. Big-picture frame: name intent, dependencies, and abandon checkpoints.
2. Current slice: define one behavioral claim, one tightly coupled edit set, and one proof command.
3. Execute: code and test first; docs only when docs are the edited surface.
4. Receipt: after proof, write at most 20 lines with changed files, proof result, gaps, and next-step adjustment.
5. Replan: revise the next slice from the receipt before doing more work.

## AP Filter

Before adding any row, checklist, gate, hook, or requirement, answer:

1. Named consumer: who reads this and what decision do they make?
2. Executable proof: what command, fixture, canary, or inspection proves it?
3. Deletion/subsumption: what old requirement, surface, ambiguity, or checklist does it remove?
4. Failure trigger: what result makes us stop, revise, or delete it?

If any answer is missing, delete the row, mark it exploratory, or shrink it into a smaller executable slice.

## Stage 0 - Repo Triangulation

Before scaffolding the execution spec, rebase the intended work onto observed repo state:

- check branch and remote freshness when the repo has a remote
- list the packages, modules, skills, hooks, scripts, or docs the gate touches
- read authoritative prior docs or user findings the plan cites
- grep the actual files, symbols, shapes, commands, and configs the plan depends on
- produce a short deltas table: prior claim, observed repo state, resolution

No deltas means no scaffold. If the deltas artifact grows beyond about five rows, make the current gate a research or cleanup gate instead of writing a monolith.

## Stage 0.5 - Executability Classification

Classify every planned edit surface:

- `existing`: exists now and can be edited in this gate
- `creates`: does not exist yet and this gate creates it
- `future`: useful later, but not code-bearing in this gate
- `unknown`: research or drop before implementation

Code rows target only `existing` or the explicit scaffold row for `creates`. `future` and `unknown` never appear in code-bearing rows.

## Stage 0.6 - Open-Finding Closure Map

Carry prior audits, hook findings, and user findings forward:

| Finding | AP class | Closure mode | Edited surface | Proof |
| --- | --- | --- | --- | --- |
| `<finding>` | `AP-*` | `fix / defer-with-stop-rule / out-of-scope` | `<path>` | `<command>` |

P1 semantic findings do not disappear because `sdd check` passes. "Fix later" is not a closure mode; name the future gate and stop rule.

## Executable Handoff

Every actionable plan carries exactly one fenced `sdd` YAML block. Then run:

```bash
zeroh-sdd check --plan <plan.md>
zeroh-sdd doctor --plan <plan.md>
```

`check` proves the machine-readable contract parses. `doctor` adds repo-truth checks, executable surfaces, validation command sanity, shape gate checks, and receipt discipline. Passing them does not prove the architecture is good; it proves the handoff is executable enough for review, tests, and canaries to matter.

Set the active stage before editing:

```bash
zeroh-sdd stage set \
  --stage "<Step N name>" \
  --step-id "Step N" \
  --plan "docs/build-log/<plan>.md" \
  --allow exact:<path> \
  --proof-command "<command>" \
  --stop-rule "<rule>"
```

Hooks then make the plan alive: writes outside `allowedPaths` are blocked, stage advance is blocked until receipt, proof completion reminds receipt discipline, and stop/task completion is blocked while the stage is open.

Minimum `sdd` block:

```sdd
sdd:
  version: 1
  id: example-step-1
  status: ready
  requirement:
    owner: "named person/team"
    evidence:
      - "source file, issue, review finding, or user request"
    why_now: "why this slice is next"
  change:
    intent: "what changes"
    adds: []
    deletes_or_subsumes: []
  source_authority:
    official_sources: []
    local_extensions: []
    prohibited_shortcuts: []
  simplification_proof:
    preserves:
      - "validation"
    rejected_simpler_options: []
  validation:
    commands:
      - "runnable proof command"
    proof_tiers:
      - "unit"
  stage_gate:
    next_gate: "receipt for this step"
    first_executable_slice: "smallest proof-producing edit"
    proof_command: "runnable proof command"
    stop_rule: "when to stop"
    replan_trigger: "when to stop and replan"
    surfaces:
      existing: []
      creates: []
      future: []
  shape_gate:
    required_shapes: []
    parse_boundaries: []
    status: red
```

After proof, finish the stage with a receipt:

```bash
zeroh-sdd stage finish --status passed \
  --proof-result "<command => pass>" \
  --changed "<path>" \
  --closed "<finding-id>" \
  --next-adjustment "Proceed to the next executable proof gate."
```

Use `--status failed` or `--status blocked` when proof fails or the slice cannot proceed. Non-passed status or opened findings require a concrete next adjustment. Do not clear an active stage as a substitute for a receipt unless the gate is explicitly abandoned or replanned.
