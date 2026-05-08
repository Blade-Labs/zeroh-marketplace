# zeroh-sdd Dogfood Uplift

Status: executing
Date: 2026-05-08

## Stage 0 Deltas

| Prior claim | Observed repo state | Resolution |
|---|---|---|
| Beta has the canonical execution-spec skill | Remote GRC-Zod-Beta `origin/develop` contains `.claude/skills/execution-spec/SKILL.md` | Use it as workflow authority |
| zeroh-sdd needs a new runtime shell | The plugin already has `bin/`, hooks, skills, state files, and self-tests | Refine in place |
| Shape discipline is already fully represented | Current `shapes` skill is much thinner than Platform `shape-author` and `shape-fill` | Upgrade the skill contract first |
| Admin merge is optional | User requires marketplace update for Claude environment testing | Keep merge and consumption proof as later gate |

## Current Gate

Gate 1 canonicalizes the skill contract before adding more runtime or adapters. It updates the execution, shape, implementation, and AP guidance, then proves those concepts with a runtime self-test.

## Later Gates

Later gates may deepen shape doctor checks, AP-WIRE/Fix with Claude detectors, LSP/MCP/agent adapters, a full temp-project dry run, and the marketplace admin merge.

```sdd
sdd:
  version: 1
  id: zeroh-sdd-dogfood-gate-1
  status: executing
  requirement:
    owner: "Blade Labs zeroh-sdd maintainers"
    evidence:
      - "User requested zeroh-sdd dogfood uplift with admin merge"
      - "Remote GRC-Zod-Beta execution-spec skill"
      - "Platform shape-author, shape-fill, and zeroh-fix skills"
      - "Current zeroh-sdd plugin runtime"
    why_now: "The plugin runtime exists, but the skill contract needs to organize the stronger source patterns."
  change:
    intent: "Canonicalize the plugin skill contract before expanding runtime or adapters."
    adds:
      - "skill-content self-test suite"
      - "Beta-grade execution-spec workflow in the plugin execution-spec skill"
      - "Platform-grade shape discipline in the plugin shapes skill"
    deletes_or_subsumes:
      - "thin shape checklist language"
      - "execution guidance that omits Stage 0, receipt, or replan discipline"
  source_authority:
    official_sources:
      - "Claude Code plugin and hook model already reflected in current plugin runtime"
    local_extensions:
      - "GRC-Zod-Beta execution-spec"
      - "ZeroH Platform shape-author and shape-fill"
      - "ZeroH Platform zeroh-fix"
    prohibited_shortcuts:
      - "Do not add broad new blocking behavior in Gate 1"
      - "Do not add LSP/MCP/agents before skill contract proof"
      - "Do not call the work done until marketplace merge and consumption proof are complete"
  simplification_proof:
    preserves:
      - "silent when green"
      - "advisory when locally suspicious"
      - "blocking only for active-stage integrity or declared proof gates"
    rejected_simpler_options:
      - option: "Only copy Beta execution-spec"
        reason: "Would miss Platform shape discipline"
      - option: "Only add more hooks"
        reason: "Would deepen runtime before skill source authority is crisp"
  validation:
    commands:
      - "node bin/zeroh-sdd.mjs self-test skill-content && npm test"
    proof_tiers:
      - "runtime self-test"
      - "skill contract regression test"
  stage_gate:
    next_gate: "Gate 1 execution receipt"
    first_executable_slice: "Update the four skill surfaces and add the skill-content self-test."
    proof_command: "node bin/zeroh-sdd.mjs self-test skill-content && npm test"
    stop_rule: "Stop on failed self-test, source-authority conflict, or edit outside declared surfaces."
    replan_trigger: "If proof requires broad runtime schema changes, split the gate."
    surfaces:
      existing:
        - "skills/execution-spec/SKILL.md"
        - "skills/shapes/SKILL.md"
        - "skills/implement/SKILL.md"
        - "skills/ap-taxonomy/SKILL.md"
        - "bin/zeroh-sdd.mjs"
        - "docs/build-log/zeroh-sdd-dogfood-uplift.md"
      creates: []
      future: []
  shape_gate:
    required_shapes: []
    parse_boundaries: []
    status: "not-started"
```

## Execution Receipts

| Step | Status | Changed files | Proof result | Opened findings | Closed findings | Next adjustment |
|---|---|---|---|---|---|---|
| Gate 1 | passed | skills/execution-spec/SKILL.md, skills/shapes/SKILL.md, skills/implement/SKILL.md, skills/ap-taxonomy/SKILL.md, bin/zeroh-sdd.mjs, docs/build-log/zeroh-sdd-dogfood-uplift.md | node bin/zeroh-sdd.mjs self-test skill-content && npm test => pass | (none) | canonical-skill-contract | Proceed to Gate 2 Step 0: shape doctor and AP-WIRE runtime triangulation. |
