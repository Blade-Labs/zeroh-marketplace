# Changelog — zeroh-roadmap

Reconstructed 2026-08-26 (phase 13.7) from the committed record trail; maintained forward.
One entry per minor: the shipped surface, not the story.

## 0.34.0 — 2026-08-26
- `roadmap capacity` (phase 11): live box-resource admission — mem/load/busy signals, typed
  verdict, exit-3 gate, `--json`, deterministic probe seam; wired into `arc next` (blocked on a
  starved box, `--ignore-capacity` override), `status --json`, and an `arm` advisory.
- `executionMode` REMOVED from the phase schema (v12 migration note; consumer sweep is one grep).
- Retro remediation (phase 13): `roadmap role resolve` (the roles layer's runnable seam; judge
  routing per `modelPolicy.judgeModel`, exit-2 UNJUDGED), codex journal moved to
  `cli/lib/codex-journal.mjs`, followups census + audit check 4 anchored on the real status
  field and the real marker grammar, discovery-surface truth fixes (exit 5, the codex plan
  lane, docblocks), intent-validator judge-tier fail-safe (fable; single-tier chain per MULTI-DRIVER.md §1).

## 0.33.0 — 2026-08-26
- Zane-workflow adoption (phase 10): vertical-slice authoring rule, default-on plan interview
  with recorded skip, typed `ArcShape.rejectedAlternatives` + append-only erasure guard +
  adoption WARN + writer/reader wiring, executor `interfaces.consumes` pre-check.
- ALSO RIDING THIS MINOR, unnamed in its bump commit (the gap phase 13 closes): the POLYSEAT
  arc (phases 1-4, 8) and phases 5, 6, 9 — the driver registry + `roadmap driver verify|register`
  provenance rail, role→model tier chains (`cli/lib/roles.mjs`), per-phase eval records emitted
  at the gate + `roadmap eval scorecard`, executor identity hardening (executor-arm exclusivity,
  UNOBSERVED watch exit 5, heartbeat hook), the codex run/review/plan lanes with journals and
  archive-at-land, lifecycle-owned worktree disposal (`phase land` / `arc land`), the `handoff`
  skill, and the five generated integration manifests (`scripts/emit-manifests.mjs --check`).

## 0.32.0 — 2026-08-26
- software-architect defaults to fable with a NAMED opus fallback; model-policy prose collapsed
  into MULTI-DRIVER.md §1.

## 0.31.0 — 2026-08-25
- Planning lean: Lane B banding, step-contract lint (length + `→ verify:` grammar + polarity),
  `PhaseTask.interfaces`, one-home rationale; followup lifecycle (census + audit check 14 +
  release-sweep triage, `references/followup-contract.md`).

## 0.30.0 — 2026-08-14
- Skill Upgrade Gauntlet: five blind-trial-proven skill rewrites installed, verified fact-ports
  into four kept originals, `code-review` retired (severity rubric moved to the agent card);
  `SKILL-AUTHORING-STANDARD.md` becomes the enforceable bar (GAUNTLET-2026-08.md).
