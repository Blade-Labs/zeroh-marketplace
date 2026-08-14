---
name: "Eval Arc"
description: "Score a landed arc across the seven ratified dimensions — code confidence, verified-vs-intent, standards adherence, doc brevity, composability/testability, speed, plan quality — into a typed, dated ArcEvalReport ratcheted against a rolling baseline. The standalone door onto do-arc's Step 9, for arcs that landed without it."
user-invocable: true
metadata:
  keywords: eval arc, score arc, arc eval, evaluate arc, arc report card
  aliases: score-arc
---

# Eval Arc — the standalone door onto the eval step

An arc that lands through `do-arc` is evaluated automatically by its Step 9. This skill exists
for the arcs that did NOT: everything that landed before the eval loop existed, an arc landed by
hand, or a re-run after a corrected trace. It is a THIN entry point on purpose.

## The ritual lives in ONE place

Run the three moves in **`skills/do-arc/SKILL.md` → "Terminal handoffs (in-session)" item 4,
`eval (Step 9)`** — `roadmap eval <ID>`, spawn `arc-eval-judge`, pipe its verdict to
`roadmap eval merge-judge --arc <ID>`, surface the REGRESSION rows. Do not restate those steps
here and do not improvise a variant: one ritual, one home, so a fix to it reaches both callers.

## What is different when you invoke it standalone

**Preconditions** (do-arc has already satisfied these; you have not):

- Run from the consumer repo root — every path the collector reads is relative to the git
  toplevel, and `roadmap/arc-evals/` is where the report lands.
- The arc must be **landed**. Evaluating an in-flight arc scores a snapshot that will not exist
  tomorrow, and the escape-fix scan reads the history AFTER the land boundary.
- Check what the trace actually has before you judge: `roadmap eval <ID> --collect-only` prints
  whether the sweep report, the verdicts file and the escape scan are present. Absences are
  honest sentinels in the report, not errors, but they tell you in advance which dimensions will
  come back unscored — and a judge pass is wasted effort on a trace with no diff to read.
- A same-day re-run refuses (exit 2) without `--force`; a later day writes a new dated report file.

**The judge's inputs are yours to hand over.** do-arc has them in context; you do not. Give
`arc-eval-judge` the arc id, the collected trace, the skeleton report path
(`roadmap/arc-evals/<ID>-<date>.json`) and the arc's commit range. The judge model is pinned in
the agent's frontmatter, cross-checked against `PINNED_JUDGE_MODEL` (`claude-sonnet-5`) in
`cli/commands/eval.mjs`; never spawn it as another model. A mis-shaped verdict is re-spawned
once; a second failure leaves the dimensions honestly `pending-judge`, never fabricated.

**Historical arcs.** A landed arc whose judge pass will never be run honestly — the diff is gone,
the standards of the day differed, or you are seeding a baseline in bulk — takes the
`unjudged-backfill` sentinel rather than a judge pass. That is the backfill lane (phase 1998),
not this skill: do not hand-write a sentinel into a report to imitate it.

## What this never does

The eval is read-only outside its own homes. It writes `roadmap/arc-evals/` and nothing else —
never a skill, an agent, a config or a `reviewFocus` entry. A regression is a NAMED line for the
user to act on, never an automatic block: the proposer is never the actor.
