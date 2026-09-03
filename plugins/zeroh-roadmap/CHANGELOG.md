# Changelog — zeroh-roadmap

Reconstructed 2026-08-26 (phase 13.7) from the committed record trail; maintained forward.
One entry per minor: the shipped surface, not the story.

## 0.39.0 — 2026-09-03
- Lane evidence survives the land (phase 28): `roadmap phase land` carries the lane's gate
  reports and executor beacon into the primary checkout before disposing the worktree, and the
  adherence scorer falls back to the committed eval record (curation and verify-complete stamps,
  per-task landed commit shas) when the checkout-local twin is absent — landed lane phases no
  longer fail `tripwires-ran` / `curation-evidence` / `verify-complete-passed` by construction.
- Journals discriminate on worktree: `findJournal` skips a journal recorded for another
  directory, journal filenames admit an arm label (`codex-<N>.<label>.json`, `codex run --label`),
  and `executor-arm --worktree <dir>` writes a lane-shaped journal so a session-run worktree arm
  reconciles at verify-complete and lands with `phase land`.
- The Co-Authored-By trailer names the actual driver (`driverTrailer` in roles.mjs; curate and
  the codex prompt share it).
- `gate run --record-round` past the correctness cap refuses without `--cap-override <reason>`;
  the eval record and scorecard carry `roundsPastCap`.

## 0.38.0 — 2026-09-03
- Protocol diet with a ruler (phase 26): a per-paragraph trim map with a named disposition and
  evidence for every passage of the nine never-trimmed skills and cards (DIET-PLAN-2026-09.md);
  `roadmap eval adherence <N> [--json] [--since <date>]` scores any landed phase's protocol
  adherence from its own records (ten checks, driver-attributed); the trims landed and
  `PROTOCOL_LOAD_BUDGET_TOKENS` ratcheted down to the measured do-arc load (11,065 tokens,
  −17.1%); a two-driver execution trial (opus 5 vs gpt-5.6-sol on phases 27 and 7) recorded in
  DIET-TRIAL-2026-09.md with the restore rule applied once. The consumer schema now keeps
  gate-round model attribution instead of stripping it.
- Curate stops at the integration ref (phase 27): `roadmap phase curate` clamps its range to the
  merge-base with the integration branch, so commits already published there are never squashed.
- Graft measured trial (phase 7) landed as the opus-driven trial arm.
- The guard-mutation reference no longer claims correctness rounds are uncapped; the round-brief
  cap rules every round.

## 0.37.0 — 2026-09-02
- Gate loop convergence (phase 25): the reviewer's typed findings (severity, confidence, file,
  fixing commit) and the recording sha persist on every round; `roadmap gate round-brief <N>`
  decides continue / close / clean / cap from the recorded severities — only CRITICAL/HIGH
  continue the loop, MEDIUM/LOW are fixed and recorded as `fixed-closed`; later rounds review
  the delta since the previous round plus the closure of prior findings; the eval records and
  scorecard carry findings by severity and the rounds-on-low-only share. First data point: phase
  25's own gate closed in two rounds (0/1/1/1).

## 0.36.0 — 2026-09-02
- Roadmap root discovery (phase 23): the data root is `roadmap/` or `docs/roadmap/` (first with a
  marker; `ROADMAP_ROOT` overrides; both = refused by name); the schema seam lives at
  `<root>/lib/schema.ts` for new consumers (legacy `lib/roadmap/schema.ts` still recognized);
  `scaffold-roadmap.sh --root` / `roadmap init --root`; templates import the schema relatively;
  one Layout rule in the router (`references/layout.md`), every skill cites it.
- Model policy per role (phase 24): `modelPolicy` presets `claude` / `codex` / `codex-full`,
  per-repo `default` + `roles` map, `sol` alias for the codex model; per-run `--models` on
  `roadmap arm` and `roadmap codex run`, recorded on the sidecar, the lane journal and
  `executionResult.modelPolicy`; `roadmap role resolve --driver --models`; do-arc delegates the
  arc to the codex lane when the executor resolves there; `arc-eval-judge` pinned to sonnet and
  refuses any override. This consumer runs preset `codex`.
- Budget ruling (phase 23.5): the do-arc protocol-load ceiling moves 13,257 → 13,339 to carry
  the Layout rule (DIET-LEDGER).

## 0.35.0 — 2026-09-02
- MINESWEEP arc (phases 14-20, landed 2026-09-01; sweep green, intent validation 6/6, eval
  finalized): the mined failure classes closed.
  - Lane lifecycle (14): stray-lane inventory classifier (`surveyLanes`), `roadmap audit` check 15 +
    `status` stray count, `codex plan` close, branch-delete on dispose.
  - Codex lane hardening (15): lockfile-keyed worktree bootstrap (pnpm/npm decided by the committed
    lockfile), absolute CLI path + commit grammar in every envelope, plan post-run validation,
    `codex plan --arc` refusal.
  - Commit-grammar tolerant attribution (16): one matcher home (`cli/lib/gitscan.mjs`), widened
    read of legacy subject forms, deviant-grammar WARNs, grammar taught in the agent cards.
  - Delegated-lane gate integrity (17): widened `gateRounds` identities incl. `self-review`,
    no-self-judge refusal at `--verify-complete` for codex-lane completions (dated cutoff).
  - Measurement repairs (18): consumer schema-drift check (audit 16), lessons merge-back on land,
    eval-gap visibility, census noise cut.
  - Cross-repo gate awareness (19): `productRepos` floors review scope; arm-time product-tree
    overlap refusal.
  - Anti-vacuity (20): scoped-runner cannot-fail probe, widened polarity lint, executable
    `assumptions[].verify` tripwires run before any code.
- Arc-sweep follow-ups (21): one exported `listWorktrees` porcelain enumerator under all four
  parsers, lockfile-aware tsx-absent hint, one taught task-subject form (envelope colon dropped).
- Plan-side integrity (22): `PhaseShape.reviewRecord` (the durable Mode A verdict, written at
  queue time), audit check 17 (queued/in-progress phase without review evidence), citation-integrity
  WARN for invented path anchors in phase prose, and a plugin version-drift line in `roadmap status`
  for sessions running a stale cache snapshot.

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
