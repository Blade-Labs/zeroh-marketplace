---
name: stack-decision
description: Handle requests phrased as choose stack, mobile stack, or compare frameworks by presenting sourced alternatives without defaults and returning an ADR ruling.
---

# Stack decision

Load `references/matrices.md`. Determine which matrices apply from the approved
PRD answers, then present every row in each applicable matrix unchanged.
Not this skill: route initial trigger selection through `using-zeroh-greenfield`, leave repository changes to `greenfield-init` or `brownfield-audit`, and return only `StackDecisionOutput` here. Use `roadmap/arc-evals/phase-30.peval.json` as the 2026-09-04 delivery evidence.

## Selection

Reuse an explicit selection and its stated rationale already supplied in the conversation. Ask one selection question only for an unresolved applicable matrix; do not ask the user to repeat a settled choice. Do not infer a selection from preferences.
Present the backend matrix ONLY when the PRD answers name an API.

Accept an explicit named option or a request to revisit requirements. Do not
infer a choice from preferences. Reuse the stated reason; ask only if it is absent or conflicts with the requirements. Summarize the ruling without another confirmation round when the selection and reason are explicit.
If matrix evidence is unavailable, PRD answers conflict, or the reason is missing, STOP with `status: unresolved` and name the missing evidence or conflicting answers. Treat selection and STOP behavior as honor-system.

## Callers and ownership

Accept calls from `greenfield-init` for new repositories and from `brownfield-audit` only when stack evidence is unresolved or conflicting. Keep matrices and ADR decision content in this skill and `references/matrices.md`.

Return both stack ADR decisions without implementing design or token values; delegate those values to the selected design system or `zeroh-design`.

## Output

Return one `StackDecisionOutput` containing one object per applicable matrix:

```json
{"status":"decided|unresolved","decisions":[{"adrPath":"docs/adr/0001-tech-stack.md|docs/adr/0002-design-system.md","matrix":"<matrix-heading>","options":["<exact-presented-row>"],"selected":"<named-option>","reason":"<confirmed-reason>","consequences":["<consequence>"],"revisitConditions":["<measurable-condition>"],"rulingDate":"YYYY-MM-DD"}]}
```

Define `YYYY-MM-DD` as the decision's ISO calendar date, `<matrix-heading>` as the literal heading in `references/matrices.md`, and every other placeholder as non-empty text copied or confirmed during selection. On STOP, return `{"status":"unresolved","decisions":[]}` plus the named conflict in the surrounding response.

Accumulate every applicable stack decision in the single
`docs/adr/0001-tech-stack.md`: create a labeled Options group for each presented
matrix, preserve all of its sourced rows, and add one dated ruling per group.
Never replace an earlier group's alternatives or ruling when the next matrix is
answered. Populate `docs/adr/0002-design-system.md` separately from only the
design-system options and ruling.

Add the confirmed consequences and measurable revisit conditions for every
group. Do not write either ADR until the calling workflow's approval gate has
passed.
Treat preservation of earlier groups as honor-system. Treat the no-write rule as enforced by `plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs` when called inside native initialization; otherwise it is honor-system.
