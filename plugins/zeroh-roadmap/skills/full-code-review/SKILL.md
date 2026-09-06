---
name: full-code-review
description: >-
  Whole-codebase pre-release audit. Parallel agents cover security, dead code, duplication, performance, architecture, edge cases, data flow, and domain-critical calculations; findings become a release verdict (any critical blocks), a remediation phase, and a review-record round. Use for "full code review", "pre-release audit", a pre-prod checkup on worry areas, or before merge-to-main/prod deploy. Not this skill: diff/phase review (code-review); a consumer's own release-review supersedes this.
argument-hint: "[path or scope] [focus notes]"
---

# Full Code Review (Pre-Release Gate)

Audit the codebase, end in an explicit release verdict, a committed remediation
phase, and a merged round in the release's review record. Nothing found is ever
silently dropped.

**Not this skill:** diff-scoped or per-phase review is the sibling
`code-review` (`../code-review/SKILL.md`); debt disposition at a release is
`release-sweep`; whole-arc seam review is `arc-sweep`; roadmap structure audit
is `audit-roadmap`.

**Consumer override — check FIRST:** if the consumer repo ships its own
tailored release-review skill (`ls .claude/skills/`), that skill supersedes
this one (honor-system — no hook blocks it). Open your response with a
**Skill routing note** that: (a) names this consumer-override rule, (b) names
the tailored skill's path, (c) contrasts its tailored missions with this
skill's generic dimensions, and (d) states plainly the generic audit is NOT
running. Then execute the tailored skill at FULL depth — its regression check
above all: verify each prior finding by re-reading the current source at the
cited site; a remediation record or `resolution` field marked "fixed" is a
claim to verify, never evidence. Breadth of re-check is where new findings
surface — recheck the whole prior list when feasible, never a token sample,
and report coverage as X/Y.

Evidence of use: `reviews/2026-06-30-FULL-CODE-REVIEW.md` in the primary
consumer (azure_private_agent) is a produced artifact of this workflow;
`reviews/releases/v0.49.0-review.json` there shows the record shape rounds
merge into.

## Arguments

User instructions: $ARGUMENTS

- A path narrows scope to it plus its direct importers; omitted = whole project.
- Focus notes narrow the dimension set; otherwise cover all eight dimensions in
  `references/audit-dimensions.md`.

**Deadline mode.** When the user names worry areas AND an imminent release
("prod tomorrow", a cut date), add two steps before dispatch:
1. Diff-prove stability of each worry area: find the ref the last clean review
   examined (its report header or the round entry in
   `reviews/releases/v*-review.json`) and run
   `git diff <thatRef>..HEAD -- <worry paths>`. Byte-unchanged since a review
   that cleared it is the strongest stability evidence — state it, then still
   re-read the core (the diff proves the code did not move, not that the prior
   review was right).
2. Rank the hunt by consequence at the deploy moment, not in the abstract:
   stricter validation loading state persisted by older code, boot-time
   fail-loud paths against live data, config/flag defaults differing from the
   running fleet. Pair the top risk with a concrete pre-deploy operator action
   (a specific command against the live state), not only a code fix.

## Phase 1 — Discovery

1. Run the consumer-override check above. Then confirm roadmap infrastructure:
   `roadmap status` and `<root>/roadmap.config.json`. If there is no discovered
   root (`roadmap status` fails), still audit and report, but skip Phase 5 and name that gap to the
   user — never invent a phase number (honor-system).
2. Read the consumer's CLAUDE.md conventions and the `reviewFocus` classes in
   `<root>/roadmap.config.json`. Those repo-specific finding classes PREPEND
   every agent mission and outrank generic checks (rule owned by
   `../code-review/SKILL.md`).
3. Read prior records: `reviews/*.md` reports and `reviews/releases/v*-review.json`.
   When any exist, the regression check is MANDATORY (honor-system): build a
   recheck list of previously fixed findings — every critical and high, every
   item touching a user-named focus area, plus a broad sample of the rest.
   Verification = re-reading the cited source at current HEAD; a `resolution`
   field is a claim, not evidence. Report coverage as X/Y rechecked. No prior
   records: state that in the report; never skip the check silently.
4. Write a codebase summary (stack, entry points, key modules) under 20 lines
   for the agent prompts.

## Phase 2 — Dispatch parallel audit agents

Launch one agent per dimension in `references/audit-dimensions.md` — all in a
SINGLE message, subagent type `code-reviewer` (`../../agents/code-reviewer.md`).
Pass each: the codebase summary, the scope, its mission, the `reviewFocus`
classes, and the regression recheck list.

Every agent must read actual source and trace code paths — findings based on
file listings or names alone are void (contract rule, honor-system) — and
return `[severity: critical|high|medium|low] file:line — description` plus the
offending snippet. Report only findings at or above the 80% confidence bar
(single home: `../code-review/SKILL.md`; raised from 70% in consumer use to cut
noise). Thoroughness outranks speed.

## Phase 3 — Consolidate and triage

1. Deduplicate by merging overlapping findings WITHOUT dropping substance; a
   finding that disappears between agent output and report is a failure
   (honor-system).
2. Cross-drop: a bug located in code independently flagged dead is not a live
   defect — keep the dead-code finding, drop the bug.
3. Label every recheck-list item that reappeared `Regression: yes`; count the
   verified-still-fixed items for the report.
4. Grade severity with the rubric in `../code-review/SKILL.md` (the plugin's
   single severity home). Release rule owned here: any critical finding
   (security vulnerability, domain-calculation error, data corruption, runtime
   crash) → verdict BLOCKED; zero criticals → CLEAR. Never declare CLEAR while
   an unresolved critical exists (honor-system; the verdict field is the record).
5. A finding missing its file:line anchor or snippet: verify it yourself by
   reading the file; if you cannot evidence it, it is below the bar — drop it.

## Phase 4 — Report

Assign stable ids `FCR-1..n`; they carry unchanged into the phase file and the
review record. Render the master list grouped by severity using the template in
`references/report-and-record.md`, ending with `Release decision: BLOCKED|CLEAR`,
the regression counts, top-3 attention areas, and a code-health assessment.

Include the template's `Chased and cleared` section: every suspicion you traced
to a negative, with the evidence that closed it — traced negatives are audit
substance; methodology caveats are not, so cap them at one short block. The
verdict reasons ONLY from evidence this run produced: never lean it on gates
you did not run — record those as `not-run`, name the pipeline that owns them
(e.g. the release PR's CI), and keep them out of the verdict's rationale
(honor-system).

## Phase 5 — Remediation phase (automatic — do not ask)

Creating the phase is mandatory and needs no permission (honor-system). Skip
only when Phase 1 found no discovered root, and say so.

1. `roadmap claim` reserves the phase number — CLI-enforced atomic monotonic
   reservation. Never reuse a historical number and never compute max+1 by hand.
2. Write `<root>/phases/phase-<N>.phase.ts` per
   `references/remediation-phase.md`. `definePhase` `.parse()`s at import, so a
   malformed task fails loudly; check with `roadmap phase validate <N>`.
3. Commit (explicit paths only — shared trees):
   `git add <root>/phases/phase-<N>.phase.ts && git commit -m "docs(roadmap): phase <N> — code review remediation from <date> audit"`

## Phase 6 — Persist the run

1. Save the report as `reviews/<YYYY-MM-DD>-FULL-CODE-REVIEW.md`.
2. Merge the findings into `reviews/releases/v<version>-review.json` as an
   ADDITIONAL round per `references/report-and-record.md`. Prior rounds are
   never overwritten (honor-system; derived views render every round).
3. Record gate counts by actually running the consumer's `gateCommands` slots
   from `<root>/roadmap.config.json` (`unit` and `integration` at minimum) and
   taking counts from the runner's own output artifacts. A slot that is absent
   or will not run is a named gap in the record (`"status": "not-run"` + note),
   never an invented number (honor-system).
4. Rebuild derived views in the same operation: run the `gateCommands.emit`
   slot (regenerates `reviews/changelog.json`, so the new phase appears) and
   any dashboard builder over `reviews/releases/` — check `scripts/` and
   `reviews/` for one, e.g. `scripts/build-dashboard.sh`. If emit aborts on
   pre-existing broken phase files that are not yours, validate only your file
   (`roadmap phase validate <N>`) and name the skipped regen in the report.
5. Commit report + JSON + regenerated views together:
   `git commit -m "docs(reviews): v<version> — full code review round <R>, <X> findings"`.
   If `git add` reports a review path ignored, stage it with `git add -f`.

## Phase 7 — Post-remediation update

After the remediation phase lands with its gate passed, update the same review
JSON:

1. Every finding gets a `resolution`: `"Fixed in phase <N>.<X> — <how>"` or
   `"Deferred to phase <M> — <reason>"`. An unexplained blank is a failure
   (honor-system).
2. Verdict: all critical and high findings resolved → `RELEASED`; any critical
   unresolved stays `BLOCKED`. Never flip early.
3. Move deferred items into the `deferredToBacklog` array. A finding deferred
   in more than one round is itself a finding: flag it against the consumer's
   own deferral discipline (backlog/hold rules), never silently re-defer.
   Re-run the gate slots for fresh counts; rebuild the same derived views as
   Phase 6 step 4; commit
   `docs(reviews): v<version> — remediation complete, verdict updated`.

## Done — tell the user

Report: the phase file path, number, and task count; the verdict (BLOCKED if
any critical); the report and review-JSON paths; and that `do phase <N>` starts
remediation. Remediation is complete only when the consumer's gate passes AND a
re-run of this review reports zero critical or high findings.
