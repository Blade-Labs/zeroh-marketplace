---
name: "Eval Arc"
description: "Score a landed arc across the seven ratified dimensions — code confidence, verified-vs-intent, standards adherence, doc brevity, composability/testability, speed, plan quality — into a typed, dated ArcEvalReport ratcheted against a rolling baseline. Owns do-arc's evaluation handoff and standalone evaluation."
user-invocable: true
metadata:
  keywords: eval arc, score arc, arc eval, evaluate arc, arc report card
  aliases: score-arc
---

# Eval Arc

Run from the consumer repository after landing is proven. If landing is uncertain, reconcile
through do-arc first. Evaluation failure resumes evaluation; it never calls land again.

1. Run `roadmap eval <ID> --collect-only`. Inspect the collected trace and missing sources.
   Missing evidence stays an honest sentinel; never invent a score or a source.
2. Run `roadmap eval <ID>` to create the dated report in the discovered roadmap root's
   `arc-evals/` home. Reuse an existing pending report on resume. A deliberate same-day
   replacement requires `--force`; preserve existing judgment unless it is superseded.
3. Resolve `arc-eval-judge` through the current role policy. Pass the arc ID, collected trace,
   report path, and actual commit range. Pipe its typed verdict to
   `roadmap eval merge-judge --arc <ID> --report <path>`. Record the actual model honestly;
   the CLI identifies an off-pin model as a baseline reset, not a reason to mislabel it.
   Retry a malformed verdict once; a second failure leaves `pending-judge` and evaluation
   unfinished. Do not use the historical backfill lane to complete a current arc.
4. Surface regression rows and evidence gaps, then re-derive with `roadmap arc next <ID>`.
   A regression is a finding, not an automatic merge block. An unfinished judge remains
   unfinished even when deterministic dimensions have scores.

Evaluation writes only its existing `arc-evals/` homes. It grants no authority to change
skills, config, criteria, application code, or release state. Historical baseline seeding uses
the explicit backfill lane and its `unjudged-backfill` sentinel.
