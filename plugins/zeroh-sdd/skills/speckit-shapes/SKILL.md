---
name: speckit-shapes
description: Shape-gated development — produce shape briefs (plan) then fill shapes (execute) as machine-executable RED tests before implementation begins.
metadata:
  author: epic-kit
  source: templates/commands/shapes.md
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

**Check for extension hooks (before shapes)**:
- Check if `${CLAUDE_PLUGIN_ROOT}/templates/extensions.yml` (or `.specify/extensions.yml` if present) exists
- If it exists, read it and look for entries under `hooks.before_shapes`
- For each executable hook, handle based on its `optional` flag (see speckit-specify for hook execution pattern)

**Prerequisite files**:
- `plan.md` MUST exist (shapes are derived from the plan)
- `spec.md` SHOULD exist (acceptance criteria come from spec)
- If `data-model.md` exists, read it for entity definitions

## Outline

### Phase 1: Shape Planning (produce shape briefs)

For each entity/boundary identified in plan.md and data-model.md, answer these **Planning Questions**:

**PQ1 — Consumer Intent**: Who consumes this shape? (API route, UI component, test fixture, CLI tool)
**PQ2 — L1 Standard**: What external standard governs this domain? (ISO, NIST, AAOIFI, W3C, none)
**PQ3 — Field Classification**: Which fields come from the standard vs are ZeroH extensions?
**PQ4 — Parse Boundary**: Is this a parse boundary shape? (validates external input → use `.strict()`)
**PQ5 — Activation Path**: How does this shape reach its consumer? (import, API, MCP, emitted artifact)
**PQ6 — Acceptance Criteria**: What must be true for this shape to be "done"?
**PQ7 — Business Invariants**: What relationships must hold BETWEEN fields?
  - Temporal ordering: createdAt < updatedAt? executionDate after approvalDate?
  - Business formulas: totalValue = costPrice + profitMargin?
  - Conditional requirements: if status=executed then executionDate is required?
  - State machine: what are valid status transitions? (use z.discriminatedUnion())
  - Identity safety: should IDs be branded? (ContractId vs CounterpartyId → .brand<T>())

### Phase 2: Write Shape Brief

For each entity, produce a shape brief at `specs/{feature}/shape-briefs/{name}.brief.md`:

```markdown
# Shape Brief: {EntityName}

## Planning Answers
- PQ1 Consumer: {answer}
- PQ2 Standard: {answer}
- PQ3 Fields: {N from standard, M extensions}
- PQ4 Parse boundary: {yes/no — if yes, .strict() required}
- PQ5 Activation: {import/API/MCP/emitted}
- PQ6 Acceptance Criteria:
  - [ ] AC1: {criterion}
  - [ ] AC2: {criterion}
  ...
- PQ7 Business Invariants: {list cross-field rules, or "none"}

## Field Inventory
| Field | Type | Source | Required | Description |
|-------|------|--------|----------|-------------|
```

### Phase 3: Fill Shapes (execute)

For each shape brief, execute the shape fill lifecycle:

1. **Step 0 — Read Brief**: Load the shape brief. Verify all PQs answered.
2. **Step 1 — Source Profiling**: Read the source (SDK type, existing interface, or standard doc)
3. **Step 2 — L1 Standard Location**: Find the authoritative standard (if PQ2 identified one)
4. **Step 3 — Ontology Alignment**: Classify fields as `fields_from_standard` or `zeroh_extensions`
5. **Step 4 — Author Shape**: Write `.shape.ts` file with:
   - `.describe()` on every field
   - `.meta()` with GlobalMeta (id, prefLabel, definition, version)
   - `acceptanceCriteria` in `.meta()` from PQ6
   - `.strict()` if PQ4 = yes (parse boundary)
5b. **Business rules**: For each PQ7 answer, add `.refine()` or `.superRefine()`:
   - Temporal: `.refine(d => new Date(d.updatedAt) >= new Date(d.createdAt), ...)`
   - Formula: `.refine(d => Math.abs(d.total - (d.a + d.b)) < 0.01, ...)`
   - Conditional: `.refine(d => d.status !== 'executed' || d.executionDate !== undefined, ...)`
   - State machine: use `z.discriminatedUnion('status', [...])` instead of `z.object` + enum
   - Identity: use `.brand<'ContractId'>()` for domain-critical IDs
5c. **Place .meta() LAST** — it is lost if placed before .refine() due to schema wrapping
6. **Step 5 — Verify**: Run `pnpm check:syntax` on the shape file
7. **Step 6 — Commit**: Atomic commit per shape

### Phase 4: Activation Check

After all shapes are filled:
- Verify each shape is importable by its consumer (PQ5)
- Verify acceptance criteria are testable (each AC maps to a future test)
- Report: "{N} shapes filled, {M} acceptance criteria defined"

## Post-Execution

**Check for extension hooks (after shapes)**:
- Look for `hooks.after_shapes` in extensions.yml
- Execute hooks (same pattern as pre-execution)

## Key Principle

**Shapes ARE the RED tests.** A Zod shape defines what "correct" means. `safeParse()` IS the test. The shape fails because the code doesn't implement the contract yet. This is the RED phase of CRITERIA-RED-GREEN-RATCHET.

Do NOT proceed to `/speckit-tasks` until all planned shapes have briefs. Shapes gate implementation.
