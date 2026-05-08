---
name: shapes
description: Author or revise Zod shapes as executable acceptance criteria for the current SDD stage.
---

# shapes

Shapes are executable acceptance criteria. A shape is not green because it exists; it is green only when it is parsed at the boundary named in the active execution spec.

Use this skill when `shape_gate.required_shapes` or `shape_gate.parse_boundaries` is present, or when a stage creates, edits, or wires a Zod shape.

## Shape Contract

For every authored or revised shape:

- name the boundary it governs and the consumer that will call it
- describe meaningful fields with `.describe()` so future hooks and agents can recover intent
- add runtime refinements for business/domain invariants that TypeScript cannot prove
- add `.meta()` when provenance, acceptance criteria, cascade discovery, or governance context matters
- keep metadata JSON-serializable and stable enough for registry/cache use
- keep runtime imports value-level only where parsing actually happens
- wire at least one `parse`, `safeParse`, or `validatedParse` boundary before claiming green

## Platform-Grade Shape Metadata

When the repo has a GlobalMeta or standards-provenance convention, follow it. A production shape should carry the strongest local metadata the project can support:

- identity: shape name, purpose/definition, category, version
- provenance: source authority, standards provenance, source URI, derivation notes
- acceptance criteria: at least one must-priority criterion when a shape brief or execution spec declares shape proof
- discovery hints: distinctive keywords, related shapes, cascade group where nested helpers must be found together
- conformance: fields from standard vs local extensions when the repo tracks that distinction

Do not invent fake provenance. If source authority is missing, keep the shape RED and record the gap in the execution receipt or `shape_gate.status`.

## RED / Green Discipline

Treat the shape as RED evidence until both are true:

1. the shape expresses the runtime invariant, including refinements for domain rules; and
2. the declared boundary parses untrusted input with that shape.

Common false greens:

- exporting a shape but using `response.json() as T`
- importing a shape only for inferred types
- validating a fixture but not the real API/CLI/file boundary
- adding `.meta()` without `acceptanceCriteria` when acceptance was the point of the shape gate
- weakening tests or refinements to make the parser pass

Update `shape_gate.required_shapes`, `shape_gate.parse_boundaries`, and `shape_gate.status` whenever shape proof is part of the stage.
