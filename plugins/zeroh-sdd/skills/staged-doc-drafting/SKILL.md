---
name: staged-doc-drafting
description: Supporting method for long-form document coherence inside zeroh-sdd. Use when `sdd-planning` has classified the work as needing Stage 0-4 drafting, or when the user explicitly asks for an ADR, design doc, RFC, migration guide, or structured markdown >~300 lines. **Stops at Stage 4.** Do not use as the general planning front door; casual "plan this upgrade" prompts should start with `sdd-planning`, and executable contract authoring belongs to `execution-spec`.
---

# Staged Document Drafting — Triangulate → Scaffold → Fill → Critique → Synthesize → SDD

**AP class:** none (methodology skill, not a refuser) — see `.claude/skills/ap-taxonomy/SKILL.md`. This skill teaches a drafting method (scaffold → fill → synthesize); it does not refuse a specific antipattern. Its Stage 0 rebase does however prevent `AP-CONTRACT-DRIFT` at doc-authoring time — aligned with but orthogonal to the AP taxonomy.

## When to invoke (own-thinking detector)

This is a **supporting methodology skill**. The normal front door is `sdd-planning`; run this skill when `sdd-planning` classifies the request as long-form, or when the user explicitly asks for a long document. Run this skill if you notice yourself about to:

1. Produce >~300 lines of structured markdown in a single pass (ADR, design doc, spec, plan file, RFC, runbook, long-form docs, migration guide).
2. Reason using phrases like "let me draft the whole thing now", "I'll write the full ADR", "here's the complete spec", "I'll compose the design doc end-to-end".
3. Respond to user prompts like: "draft an ADR for X", "write the design doc for Y", "compose a long plan", "author a full spec", "put together a long write-up on Z".
4. Draft against assumptions from a prior plan, ADR, or build-log entry — those docs may have drifted from the code since they were written. Stage 0 (prose-vs-code rebase) is mandatory whenever the new doc cites prior doc state as given.

Do not use this skill as the answer to a broad "plan this upgrade" or "turn this into MCs" request. Use `sdd-planning` to classify scope, then come here only if the classification says long-form synthesis is needed.

The user's request is legitimate — they want the long document. Two antipatterns to defeat: the **monolithic one-shot** authoring mode (produces silent cross-section drift within the doc), and the **no-triangulation** drafting mode (produces silent prose-vs-code drift between the doc and the observed reality). Use this skill to reach the same endpoint via a staged process that defeats both.

## Core principle — the method is self-similar

**Any artefact produced by any stage invokes Stages 1-4 against itself when it crosses the long-form threshold.** Triangulation is not exempt. Synthesis is not exempt. A deltas artifact, a commit-sequence appendix, a per-stage test plan — each is a potential long-form doc in its own right, and each is eligible for the same scaffold → fill → synthesize discipline if it grows.

**Thresholds that trigger recursion:**

- > ~300 lines of structured markdown in the output, OR
- > ~30 discrete items (deltas, resolutions, decisions, commit rows), OR
- > ~5 open architecture questions the artefact needs to resolve, OR
- Cross-section consistency burden the author cannot hold in one pass (numbers, enum values, commit SHAs that appear in multiple sections).

**If any threshold is crossed**, the artefact is itself a long-form doc. Recurse: scaffold it with stub sections → fill each section via its own targeted Edit → run a synthesis pass → commit the scaffold + each section-fill + the synthesis pass as separate microcommits. This applies recursively to any depth; the base case is §Recursion base case below.

**If none are crossed**, render inline: a `TodoWrite` block, one paragraph, or a single `Edit`. Recursion has a cost (extra commits, extra todos); below the threshold the cost exceeds the benefit.

The skill defeats within-doc drift AND prose-vs-code drift. Both failure modes apply to any long-form artefact — including those produced mid-skill. A monolithic 600-line deltas artifact reproduces the within-doc failure mode the skill was designed to prevent, at the Stage-0 level. A monolithic synthesis commit that rewrites §§1-6 reproduces it at the Stage-4 level.

## What to do — the staged flow

### Stage 0 — Triangulate (rebase prose onto observed code state)

Before any scaffold, verify what the code IS — not what prior docs say it should be. The metaphor is **prose-vs-code rebasing**: replay the doc-to-be-drafted onto current reality and resolve every conflict before touching the scaffold. A plan drafted against stale state imports the drift into new prose and silently blesses it.

**Minimum triangulation checklist** (adapt per doc type — do every applicable bullet, not a subset):

1. **Enumerate packages / modules the doc will touch.** `ls packages/` + `find . -name package.json` + for each package: source LOC count, test-file count, existence of a README, any obvious "status" markers. If a package the doc proposes already exists, the doc is about *extending* or *auditing*, not *scaffolding*.
2. **Grep the bundle / config / schema files the doc asserts on.** For a plan touching admission: list existing SHACL shape `@id`s and their property paths. For a plan touching vocabulary: list existing SKOS concept schemes and their `topConcept`s. For a plan referencing a routing policy: list existing routing-rule bundle nodes.
3. **Read the prior authoritative docs the new doc builds on.** The design plan, accepted ADRs, prior build-log plans, external review notes. Note every sentence that asserts current state. Prior docs may have been revised — the version in the repo NOW is the binding one, not the version cached in memory from earlier work.
4. **Read package READMEs.** They often carry the authoritative "status" table showing which subpaths are complete vs planned vs in-progress. Misreading the package layout (flat-five-packages vs one-consolidated-package-with-subpaths) is a top drift source.
5. **Check role / enum / service constants in the kernel.** If the doc proposes a new `role:X`, `SteeringTask:Y`, or kernel service, `grep` the relevant constants file first. If it already exists, the doc's B-dot-zero "add the constant" commit collapses to zero.
6. **Count tests (don't invent the number).** Plans often cite "baseline N tests"; verify N via `find -name '*.test.ts' | wc -l` or a vitest dry-run. Test deltas claimed per commit must add up.
7. **Produce a deltas artifact — explicitly.** A list of "prior doc says X / code says Y / resolution = Z" entries, where resolution is exactly one of:
   - **(a) Update prior doc first** — prior doc is stale; fix it before drafting the new one builds on it.
   - **(b) Drop the assumption from doc-to-be-drafted** — prior doc was aspirational; scope changed; acknowledge and adjust.
   - **(c) Confirm prior doc still applies** — no drift; the prior doc and code agree; the new doc inherits the contract.

   No resolution = no scaffold. The scaffold must rest on verified reality, or it imports the drift into new prose that then becomes its own future drift source.

**Produce and commit the deltas artifact** as its own atomic step. Apply the Core principle: if the artefact crosses the long-form threshold, **recurse** — treat the triangulation as its own long-form doc and run Stages 1-4 against it. If it stays below the threshold, render inline.

- **Below threshold (≤~30 lines, ~5 deltas or fewer, no open architecture questions)** — a `TodoWrite` block suffices. Render the deltas inline in the todos; one message; no staged authoring. Base case.
- **Above threshold (>~30 lines OR many deltas OR open architecture questions OR resolution maps)** — recurse per Core principle. Scaffold the triangulation doc with stub sections → fill each section via targeted Edit → synthesize. Commit the scaffold + each section-fill + the synthesis pass as separate microcommits on the plan's branch (or a sibling `docs/<plan-name>-triangulation` branch).

**Do not write a 600-line "quick rebase doc" in one `Write` call.** That reproduces the within-doc failure mode at the Stage-0 level — every argument for staged drafting at the final-doc level applies identically to the triangulation doc.

The triangulation — whether inline or recursively staged — is the rebase head: proof that the plan scaffold rests on observed reality.

### Stage 1 — Scaffold

Write the document as stub headers only. Include:
- Title + metadata (status, date, scope, supersedes)
- Executive summary **as a stub** (one sentence "*(stub — to be filled)*"), since the summary must reflect the filled body, not anticipate it
- Section headers — all of them, with one-line intent per section describing what that section will contain
- User-resolved decisions block (if the doc captures decisions) — also a stub
- Verification / Acceptance section header if the doc is actionable

**Commit the scaffold** as its own atomic change if the doc lives in a tracked file. For plan-mode work, write the scaffold in a single `Write` call.

### Stage 2 — Incremental section fill (one section per pass)

Fill **one section at a time**. One targeted `Edit` per section. Each pass:
- Reads only the section being filled plus the scaffold
- Writes the section body
- Does NOT touch adjacent sections
- Marks the corresponding todo as completed before moving on

This is the Chain-of-Thought + progressive-refinement pattern. Each section stays in focused context; the model isn't juggling the whole doc at once.

**Use live session tracking** to make each section-fill a visible micro-step: Claude native todos when available, Codex task/progress tracking when available, or a compact checklist otherwise. Commits for long docs land as multiple microcommits (one per section if the file is git-tracked); for plan-mode drafting, each `Edit` is the visible micro-step. Todos/tasks are live session progress only; the drafted document and later execution receipt are the durable evidence.

### Stage 3 — Critique-and-revise loops (inline as you discover needs)

While filling, if you discover a section needs more than one pass:
- Write the first draft
- Mark todo "in_progress" not "completed"
- Launch a Plan subagent with the drafted section as input and a critique prompt ("what's missing? what contradicts? what's unclear?")
- Apply the Plan subagent's corrections in a second `Edit`

This stage is optional per section. Use it for sections where the first draft is unusually complex (e.g., a multi-ADR lock-in block, a long verification matrix).

### Stage 4 — Final self-consistency synthesis

After all sections filled, do **one** additional pass:
- Read the full document from top to bottom in one `Read` call
- Grep for cross-section inconsistencies (numbers, counts, enum values, version strings, file paths that appear in multiple sections)
- Fix every contradiction in targeted `Edit` calls
- Tighten the executive summary now that the body is known
- Update the user-resolved decisions block if any decisions shifted mid-drafting

### Stage 5 — handoff to `execution-spec` skill (for actionable plans)

If the output is an **actionable plan** (execution spec, migration plan, consolidation doc, rollout ADR, or anything another agent/human will execute), the document must carry exactly one fenced `sdd:` block before implementation handoff.

**Authoring that block — the `requirement` / `change` / `source_authority` / `simplification_proof` / `validation` / `stage_gate` shape, the surface classification (existing / creates / future), the executable proof gate, and running `zeroh-sdd check` + `zeroh-sdd doctor` — belongs to the `execution-spec` skill, not this one.**

This skill stops at Stage 4. To produce an actionable plan: (a) finish Stage 4 here, (b) invoke `execution-spec` to add the `sdd:` block and run the contract check, (c) implementation agent picks up after `zeroh-sdd doctor` is green. Do not inline the SDD block authoring in this skill — that's `execution-spec`'s job and inlining it duplicates the contract.

### Stage 0 triangulation checklist (operationalised from rubric-pass lessons)

**Use this checklist before Stage 1 scaffolding** to catch the prose-vs-code drift class at authoring time, not at rubric-pass time:

1. **Enumerate packages/modules the doc will touch.** `ls packages/` + per-target: source LOC, test count, README presence, "status" markers. If a package the doc proposes already exists, the doc is *extending / auditing*, not *scaffolding*.
2. **Grep bundle / config / schema files the doc asserts on.** Existing SHACL shape `@id`s, SKOS concept schemes, routing-rule bundle nodes.
3. **Read prior authoritative docs the new doc builds on.** Prior design plans, accepted ADRs, build-logs, rubric passes from adjacent sprints.
4. **Read package READMEs.** Authoritative status tables. Misreading flat-five-packages vs one-consolidated-package-with-subpaths is a top drift source.
5. **Check role/enum/service constants in the kernel.** If the doc proposes a new `role:X`, grep the constants file first.
6. **Count tests (don't invent the number).** `find -name '*.test.ts' | wc -l` or vitest dry-run.
7. **Re-read prior rubric passes from adjacent sprints.** Rubric findings from sibling sprints often surface the same class of issue; skipping this re-discovers them.
8. **Produce a deltas artifact — explicitly.** "Prior doc says X / code says Y / resolution = Z" entries. No scaffold without a deltas artifact.

This is the step that distinguishes a staged-draft from a monolithic one. Monolithic drafts look coherent but silently contradict themselves. The synthesis pass is where you catch the drift.

### Stage 5 — invoke `execution-spec` (for actionable docs)

After Stage 4 synthesis, if the document will drive real implementation, invoke the `execution-spec` skill. It owns the SDD contract authoring + `zeroh-sdd check` / `zeroh-sdd doctor` workflow. Do not inline that work here — Stage 5 is delegation, not duplication.

## Why this method produces better output

There are **three distinct failure modes** that silently corrupt long-form drafting:

**Failure mode 1 — within-doc drift (coherence).** The model must hold the whole doc's constraints in working context by the end of the generation. For docs >~300 lines, attention to earlier sections degrades — later sections restate assumptions rather than inheriting them, and contradictions appear silently. **Stages 1-4 defeat this.** Each section-fill runs with fresh context narrowed to the scaffold + that section's intent; the synthesis pass catches cross-section contradictions mechanically via Read + grep, not by relying on the model to remember what it wrote 500 lines ago.

**Failure mode 2 — prose-vs-code drift (ground truth).** The model drafts against assumptions from prior docs (design plan, prior ADRs, prior build-log entries) that may have been revised, superseded, or never quite matched the code in the first place. New prose inherits the drift, blesses it as a fresh contract, and now TWO docs claim reality the code doesn't support. **Stage 0 defeats this.** A prose-vs-code rebase before any scaffold surfaces every delta: prior-doc says X; code says Y; resolve before drafting. The deltas artifact is the rebase head — proof the scaffold rests on observed reality.

**Failure mode 3 — contract-to-execution drift (discipline).** A document can be internally coherent and grounded in current code, yet still be globally under-disciplined: anonymous requirements, no deletion story, shortcut simplification, automation before source authority, old-branch contamination, or verification rows disguised as commits. **Stage 5 defeats this.** The SDD readiness pass treats the document as an execution contract and forces these boundary mistakes into the open before implementation starts.

All three failure modes are silent by default. Staged drafting makes them mechanical to detect.

This skill formalizes the method Anthropic calls "Chain-of-Thought" at the reasoning level, and that `Blade-Labs/zeroh-marketplace/plugins/zeroh-sdd/skills/` calls Speckit-style chaining at the doc level (`specify` → `clarify` → `plan` → `shapes` → `tasks` → `implement`). Stage 0 (prose-vs-code rebase) maps to the CWA invariant: a document is a contract, and its base state is the code; drafting without rebasing imports drift the same way writing code without checking contracts imports silent defaults. Stage 5 handoff adds a lightweight execution-discipline gate so a code-grounded doc also has to be sprint-grounded.

## The canonical workflow

```
0. Stage 0 — Triangulate (prose-vs-code rebase; BLOCKING — Stage 1 cannot start until this produces a deltas artifact)
   a. Bash ls / find — enumerate packages + modules the doc will touch
   b. Grep          — bundle / config / schema files the doc asserts on
   c. Read          — design plan, accepted ADRs, prior build-log plans, external-review notes
   d. Read          — package READMEs (authoritative status tables)
   e. Grep          — role / enum / service constants the doc references
   f. Bash          — count tests (baseline N); do not invent
   g. TodoWrite     — "deltas artifact" listing prior-doc vs code mismatches + resolution per mismatch
   h. BRANCH on artefact size (Core principle recursion check):
      - if artefact ≤ threshold (~30 lines / ~5 deltas / no open architecture qs)
          → render inline in TodoWrite; continue to step 1
      - if artefact > threshold
          → RECURSE: treat the triangulation as its own long-form doc;
            goto step 2 with the triangulation doc as subject;
            on return, resume at step 1
1. AskUserQuestion — clarify any hard requirements before the scaffold (ask AFTER triangulation — deltas may resolve some questions)
2. Write            — scaffold + exec-summary stub + section headers + one-line intents
3. TodoWrite        — one todo per section-fill, visible to user
4. For each section:
   a. Mark todo in_progress
   b. Edit           — fill the section body with a targeted edit
   c. Mark todo completed
   d. BRANCH on section size:
      - if single-Edit sufficient → section complete
      - if section > threshold after drafting → RECURSE: apply Stages 1-4 to the section as its own sub-doc
5. (Optional) Plan subagent — critique + revise any section with a shaky first draft
6. Read             — full doc top-to-bottom
7. Bash grep        — cross-section consistency checks (counts, enums, paths, versions)
8. Edit             — fix every contradiction surfaced
9. Edit             — tighten the executive summary + user-resolved decisions block
10. BRANCH on synthesis size:
     - if synthesis edits fit one commit → commit as "synthesis pass"
     - if synthesis opens >~300 LOC of rewrites → RECURSE: treat the synthesis as a sub-doc-of-its-own
11. For actionable docs only, invoke Stage 5 by handing off to `execution-spec`
    a. Input        — provide the Stage 4 synthesized document and deltas artifact
    b. Delegate     — `execution-spec` authors the exactly-one fenced `sdd:` block
    c. Run          — `zeroh-sdd check --plan <plan-file>` and `zeroh-sdd doctor --plan <plan-file>`
    d. Handoff      — implementation starts only after the execution contract is green or explicitly blocked/replanned

Recursion terminates when any branch reaches the base case (step 0h first branch or step 4d first branch). Stage 5 is deliberately non-recursive in v1; it should stay short and high-signal.
```

## Anti-examples (do NOT do these)

```
# ❌ Skipped triangulation; drafted against stale prior-doc state
Draft a B15+B16 plan with §2 "Scaffold @grc/llm-router (B15.0 prerequisite)"
against a develop branch where @grc/llm-router was already 1067 src LOC of
phase-α code — OpenRouter transport, Langfuse adapters, BudgetTracker with
ADR-012 logic, 3 test files, committed weeks earlier. Propose 6 new packages
while the design plan §4 module inventory explicitly consolidates them into
ONE package (@grc/legislation) with subpath exports. Propose 3 new SHACL
shapes while the bundle already carries a unified shape-normalized-legal-
statement combining LRML + routing fields. Stage 0 would have caught all of
this in two minutes of `ls packages/` + `grep '@id' bundle.jsonld` + `cat
packages/legislation/README.md`.

# ❌ Monolithic one-shot
Write a 600-line ADR for the promotion policy in a single Write call covering
Context, Decision, Consequences, 15 alternatives considered, ORSD alignment
for all 18 NFRs, verification matrix for all edge cases, and a full worked
example — without any scaffold, without any intermediate read-back, without
any synthesis pass.

# ❌ "Scaffold then fill in one pass"
Write the scaffold, then Edit the whole scaffold into the full body in one
call. This collapses stages 1-4 into one; defeats the purpose.

# ❌ No synthesis pass
Fill sections one-by-one, ship. Skips stage 4. Works for short docs; produces
silent contradictions for anything >~300 lines.

# ❌ Stop at synthesis for an execution spec
Ship a plan after stage 4 because it "reads cleanly", even though it still
contains two finish lines, a graph-ordering bug, phase-sized PRs, or VERIFY
rows masquerading as commits. Coherent prose is not yet a disciplined
execution contract. Fix: run stage 5 on any doc that will drive implementation.

# ❌ Cleanup creates a new registry beside the old registry
Refactor a monolithic bundle/list/config by adding `NEW_THING_REGISTRY`,
`module-manifest.yaml`, or a copied manifest map while the prior registry/checker
keeps owning the same facts. The new list may pass the local gate, but the system
now has two authoring surfaces. Fix: the same step must delete/subsume the older
list, or mark the new list as a temporary migration artefact with a named
deletion commit and a blocking gate.

# ❌ Sync-up pass without reading
Claim to have "done a final consistency pass" without actually running
`Read` on the full file. The consistency check must be mechanical.

# ❌ Stage 0 without a deltas artifact
Read around, nod, start drafting. No explicit list of "prior-doc says X / code
says Y / resolution = Z" means no rebase happened — just a warm-up pass the
model forgets by the time section 6 lands.

# ❌ Stage 0 with a monolithic deltas artifact
Produce a 600-line "quick rebase doc" in a single Write call containing:
prose preamble + 28-row delta table + 10-row resolution map + 3-question
locked-decisions block + 10-row K/TS/C disposition table + recommended
sprint-commit sequence. Within-doc contradictions (e.g. count mismatches
between §3.6 deltas and §4.2 resolutions) ship unresolved because
synthesis never ran. Same within-doc failure mode as a monolithic final
doc — the Core principle (self-similarity) means the same antipattern
applies at the Stage-0 level. Fix: branch on size at step 0h; if the
artefact is long, recurse into Stages 1-4 with the triangulation as
subject, landing scaffold + section-fills + synthesis as separate
microcommits before the final-doc scaffold starts.

# ❌ Stage 4 synthesis that opens a full rewrite
Synthesis pass discovers five cross-section contradictions; fix attempt
becomes a 400-LOC Edit rewriting §§1-6. The fix itself is a long-form
authoring pass that deserves its own scaffold → fill → synthesize
sequence per Core principle recursion step 10. Fix: branch on synthesis
size; treat the rewrite as a sub-doc; land it as its own staged-drafting
sequence with its own microcommits.
```

## Recursion base case

Recursion terminates when the artefact fits the short form:

- **Deltas artifact**: ≤ ~30 lines, ≤ ~5 deltas, no open architecture questions. Render inline in `TodoWrite`.
- **Section fill**: single targeted `Edit` produces a coherent self-consistent section of ≤ ~50 lines.
- **Synthesis**: edits to fix cross-section contradictions fit one commit of ≤ ~50 LOC changed.

Below the threshold, a single `Edit` or a single `TodoWrite` block is structurally equivalent to a full Stages-1-4 cycle on a smaller artefact — the work is identical in kind, only compressed because its size doesn't warrant the ceremony. The goal of the threshold is not to guard against "too small to recurse" but to stop the author from paying the recursion cost below the point where it buys drift-prevention.

## Concrete evidence

The plan file at `/root/.claude/plans/lets-compose-a-agents-md-tranquil-dahl.md` (836 lines) was authored using stages 1-4 of this method. The final-synthesis pass caught cross-section inconsistencies (e.g., "7 skills" in executive summary vs "8 skills" in Section 4) that monolithic drafting would have shipped unresolved. The AGENTS.md this skill lives beside was also authored this way, in eight incremental Edits.

Stage 0 was added after the `docs/phase-beta-b15-b16-plan` incident: a 1173-line plan file produced with stages 1-4 only (no triangulation) shipped with four silent prose-vs-code drifts — (1) proposed scaffolding `@grc/llm-router` when 1067 LOC already existed on develop; (2) proposed six new packages (`vocab-lrml`, `classifier-lrml`, `vocab-lkif`, `classifier-lkif`, `routing-policy`, `llm-router`) when `rebuild2-design-plan.md` §4 explicitly consolidates them into one `@grc/legislation` with subpath exports; (3) proposed three separate SHACL shapes when the bundle already had a unified `shape-normalized-legal-statement`; (4) proposed 6 LRML statement classes when the bundle's statement-class scheme enumerates 3. Within-doc coherence was perfect (stages 1-4 worked as advertised); the prose was a fully self-consistent description of a world that wasn't there. Stage 0 would have surfaced every one of these in a seven-line Bash + Read pass before scaffolding. This is why the rebase is mandatory, not advisory.

The Core principle (recursion first-class) was added after the 2026-04-19 kernel-refactor-sprint incident. The triangulation doc (`docs/build-log/kernel-refactor-triangulation.md`, 13 microcommits through `9671819`) initially drifted toward monolithic authoring — an 800+ word prose deltas artifact in one message — before the user corrected: *"if Commit 0 is taking so long, we haven't utilized the /staged-doc-drafting principles (microcommit, microtodo, scaffold first, etc) to the prose vs code rebase itself."* The recovery recursed per Core principle: scaffold → §1 past-sprint hygiene → §2 source-map → §3 deltas → §4 resolutions → §5 locked decisions → §6 K/TS/C disposition → §7 synthesis → §8 post-synthesis branch-consolidation addendum → §9 post-synthesis plugin-migration-audit addendum. Thirteen microcommits; each section below the threshold within itself; synthesis caught three cross-section contradictions that monolithic authoring would have shipped. The Core principle formalizes what that recovery demonstrated: the skill is self-similar, and recursion is the default behavior when any artefact crosses the long-form threshold.

Stage 5 was added after the 2026-04-24 manual rubric pass over `docs/build-log/spine-adoption-execution-2026-04-22.md`. The 2026-04-26 SDD retrofit moves repeated manual guardrails into `zeroh-sdd check` so implementation agents inherit them mechanically. The lesson was not "draft less"; it was "make the execution contract parseable, testable, and smaller than the prose around it." That is what Stage 5 handoff now encodes.

## Related skills

- `full-code-review` — composes with this skill end-to-end. `/full-code-review` Phase 4B invokes `staged-doc-drafting` to author + persist the multi-agent audit as a review artifact (scaffold → section-per-agent fill → synthesis). The pair is the canonical pattern for any code-review producing >~30 findings: Phase 1-3 of `/full-code-review` is the research layer; Stages 0-4 of this skill are the persistence layer. See `/full-code-review` §4B for the artifact structure it expects.
- `cwa-fallback-detector` — Stage 0 (prose-vs-code rebase) maps to the CWA invariant: a doc is a contract; its base state is the code; drafting without rebasing imports drift the way silent-default code imports unknowns. Same no-shortcuts discipline at a different layer.
- `adr-status-checker` — ADRs are a common target of this skill; Stage 0 is especially valuable for ADRs that reference a current "state of play" that may have moved since the ADR was first Proposed.
- `bundle-iri-source-of-truth` — when the doc is a bundle-extension sketch, the staged method applies; Stage 0 triangulates which IRIs already exist so the sketch extends rather than reintroduces.
- `provenance-completeness-auditor` — when the doc is a spec describing admitted-graph shapes, the synthesis pass catches field-list drift within the doc; Stage 0 catches the prior kind of drift — "the shape I'm specifying is already implemented; I'm writing a spec of the past".
- `docs/architecture/c4/discipline-rubric.md` — not a skill, but the canonical repo-local constitution behind the SDD rules when the doc is a rollout or execution contract.

## When NOT to invoke

This skill is for **long** docs. For short content — a PR description, a commit message, a single-page README, a one-section change — monolithic one-shot is fine and the staged overhead is pure cost. Rule of thumb: if the target is >~300 lines, use this skill; if <300, don't.
