> Historical investigation record. This describes an earlier implementation, not the current execution contract. See [README.md](README.md) and [MULTI-DRIVER.md](MULTI-DRIVER.md).

# Skill Upgrade Gauntlet — 2026-08-13/14 (shipped as v0.30.0)

All 14 skills went through blind competitive trials: frozen outcome contracts, benchmark
suites with sealed held-out sets, fresh isolated contestants per condition, blind judges
ranking anonymized deliverables. The original run prompt (the method spec, for re-runs) is
vendored verbatim at `GAUNTLET-PROMPT.md`; the enforceable output is
`SKILL-AUTHORING-STANDARD.md` — every new or edited skill must pass it.

Successor campaign: `GAUNTLET-2.0.md` (2026-09, protocol diet with a ruler — per-paragraph trim map,
adherence scorer, two-driver execution trial; shipped as v0.38.0).

## Verdicts

| outcome | skills |
| --- | --- |
| Rewrite installed (won sealed finals) | full-code-review · using-zeroh-roadmap · plan-phase · plan-arc · review-phase |
| Original kept (beat its rewrite) | do-phase · do-arc · arc-sweep · validate-arc · test-strategy · release-sweep |
| Original kept + verified facts ported | audit-roadmap · eval-arc |
| Retired (no measured delta, user-ratified) | code-review — severity rubric + GateFindingShape home moved to `agents/code-reviewer.md` |

Commits: hotfixes `f8dc143` `043aa80` `faba825` `fe08642` · installs `478aa67` · retirement `1518f58`.

## Lessons (what future skill work must assume)

1. **"Looks better" and "is better" diverge.** Every losing rewrite passed the authoring
   standard (A/B lint grades) and read well; ~40% of rewrites were regressions only blind
   trials caught — one cited CLI commands that are runtime stubs, one dominated iteration
   then lost every fresh sealed task (overfit), several lost load-bearing sentences no
   reviewer could identify by inspection. Never install a rewrite on inspection alone.
2. **Hotfix first, rewrite second.** Originals with their factual bugs fixed proved hard to
   beat: six of fourteen kept their slot outright. Objective defects (dead paths, inverted
   posture, wrong counts) are cheap lint findings; fix them in place before judging whether
   a rewrite is warranted.
3. **Value concentrates in judgment-heavy skills.** The bare model won ~0 tasks against the
   workflow cluster (review, validation, planning, execution) but tied the generic-advice
   layer (diff review, test how-to). A skill earns its tokens only where it carries what
   the model cannot know: contracts, decisions, vocabulary, gotchas. Commodity methodology
   is deletion fodder.
4. **The always-loaded budget is the scarce resource.** Descriptions ride every session;
   bodies load per invocation; `references/` load on demand. Move branch detail down the
   ladder — the winning rewrites shrank bodies while growing on-demand references.
5. **Judges must verify, not read.** The decisive verdicts came from judges doing on-disk
   forensics (reflogs, mirror refs, gate records, re-running mutation probes) — they caught
   null contestants, a sandbox collision, and overstated "pushed"/"recorded" claims. A
   judge that only reads prose grades confidence, not truth.
6. **Guard the harness itself.** Failures that produced wrong-looking verdicts: API-outage
   casualties judged as real losses (null-body bug), contestants sharing one sandbox branch,
   a seeded security-weakening scenario the safety classifier repeatedly vetoed. Per-condition
   isolation, non-null checks, and review-framed seeds are now baked into the method.

## Evidence & re-run kit

Frozen contracts, benchmarks, lint records, per-task judge verdicts, and the final
dashboard: archived at `~/skill-gauntlet-archive-2026-08-14.tar.gz` (sealed held-out sets
included — the archive is PRIVATE; never expose sealed tasks to a future skill builder).
Immutable pre-gauntlet originals: `~/skill-gauntlet/originals/`. Evidence branches:
`gauntlet/*` in the consumer repo. To regression-test a future skill edit: take the skill's
frozen contract + sealed set from the archive, run old vs new under a blind judge.
