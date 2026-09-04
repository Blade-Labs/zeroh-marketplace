---
name: stack-decision
description: Present sourced stack alternatives without defaults and return the selected ADR path and dated ruling.
---

# Stack decision

Load `references/matrices.md`. Determine which matrices apply from the approved
PRD answers, then present every row in each applicable matrix unchanged.

## Selection

Ask exactly one selection question per applicable matrix.
Do not preselect any option before the user answers.
The backend matrix is presented ONLY when the PRD answers name an API.

Accept an explicit named option or a request to revisit requirements. Do not
infer a choice from preferences. When the user chooses, ask for or summarize the
reason and confirm it before producing the ruling.

## Callers and ownership

`greenfield-init` calls this skill for new repositories; phase 33 authors the brownfield-audit side
and calls this same owner rather than copying its matrices or ADR prose.

This skill owns both stack ADR templates. Design implementation and token values
remain with the selected design system or the `zeroh-design` sibling.

## Output

Return a `StackDecisionOutput` for each decision:

```text
adrPath: docs/adr/<decision-file>.md
rulingLine: <YYYY-MM-DD>: <selected option> — <reason>
```

Accumulate every applicable stack decision in the single
`docs/adr/0001-tech-stack.md`: create a labeled Options group for each presented
matrix, preserve all of its sourced rows, and add one dated ruling per group.
Never replace an earlier group's alternatives or ruling when the next matrix is
answered. Populate `docs/adr/0002-design-system.md` separately from only the
design-system options and ruling.

Add the confirmed consequences and measurable revisit conditions for every
group. Do not write either ADR until the calling workflow's approval gate has
passed.
