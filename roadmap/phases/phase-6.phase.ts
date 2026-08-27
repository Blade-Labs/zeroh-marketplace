import { definePhase } from '@/lib/roadmap/schema'

/**
 * Worktree disposal moves into the lifecycle verbs that already own the
 * done-moment. Operator ruling 2026-08-23: NOT "another command to clean
 * worktrees", NOT a timer reaper — "worktrees are getting created as part of
 * following the roadmap plugin, they should always get cleaned once they are
 * done."
 *
 * Evidence (2026-08-23 manual audit that triggered this): 10 stale worktrees
 * across two consumers — two exec-lane worktrees squatting slot dirs with
 * FULLY MERGED branches (wt-4/exec-2275, wt-5/exec-2370), seven dead-session
 * scratchpad worktrees, one 5-week-idle rebuild lane. Every one was created
 * by a plugin flow whose skill prose PROMISES cleanup (do-phase SKILL.md:
 * "backlog-groom, clean up the worktree") — the honor system accumulates;
 * the done-verbs must own it.
 */
export default definePhase({
  phase: 6,
  name: 'Worktree disposal owned by the done-verbs — land cleans, review-complete archives',
  status: 'done',
  plannedBy: { model: 'claude-opus-5[1m]' },
  category: 'fix',
  kind: 'hardening',
  source:
    'Operator ruling 2026-08-23 after the manual 10-worktree cleanup: lifecycle-owned disposal at completion, explicitly rejecting a standalone sweep command and any timer reaper.',
  priority: 'MEDIUM',
  dependsOn: [3],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/landing.mjs',
    'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/cli/commands/phase.mjs',
    'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
  ],
  stakeholderDemo:
    'Landing a phase or arc leaves no orphan worktree behind, and a finished delegated review packs its verdict into the primary checkout and removes its own worktree — the machinery that opened each workspace closes it.',
  assumptions: [
    {
      claim:
        'The landing engines are where the done-moment lives: landPhase in cli/lib/worktree.mjs and landArc/landCommand in cli/lib/landing.mjs.',
      verify:
        "bash -c \"grep -qF 'export function landPhase' plugins/zeroh-roadmap/cli/lib/worktree.mjs && grep -qF 'export function landArc' plugins/zeroh-roadmap/cli/lib/landing.mjs\"",
      onFalse: 'ESCALATE',
    },
    {
      claim:
        "do-phase's codex-delegation section still carries the honor-system cleanup prose this phase mechanizes.",
      verify: "grep -qF 'clean up the worktree' plugins/zeroh-roadmap/skills/do-phase/SKILL.md",
      onFalse: 'ESCALATE',
    },
    {
      claim:
        'findJournal is exported from the codex command (POLYSEAT phase 3 extraction) so disposal can locate lane journals without duplicating the scan.',
      verify: "grep -qF 'export function findJournal' plugins/zeroh-roadmap/cli/commands/codex.mjs",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'No timer/interval machinery exists in the CLI for this phase to accidentally extend.',
      verify:
        'bash -c "! grep -rqE \\"setInterval|setTimeout\\\\(.*[0-9]{4}\\" plugins/zeroh-roadmap/cli/commands/ plugins/zeroh-roadmap/cli/lib/landing.mjs"',
      onFalse: 'ESCALATE',
    },
  ],
  notes:
    "OWED-READ DISCHARGED 2026-08-26 (phase 13.6): the round-3-fixes independent read owed in executionResult.surfaced was served by the three-agent retrospective review of 1518f58..HEAD (2026-08-26, fresh reviewers over the post-e73c6be tree); no residual owed. LOCKED (operator ruling 2026-08-23, verbatim intent): no standalone sweep/clean command — disposal has NO verb of its own; no timer reaper of any period. Disposal fires ONLY inside verbs that already exist, at their success moments. A lane that never reaches its done-verb keeps its worktree — that is correct (in-flight work is sacred); the accumulation class this kills is DONE work whose cleanup was honor-system prose.\n\nTHE DISPOSAL RAIL (shared helper, one home — cli/lib/worktree.mjs beside landPhase): disposeWorktree(repoRoot, dir, { expectBranchMerged, allowUntracked }) refuses with NAMED reasons — dirty tree (untracked .building/ excepted, matching the audit protocol, PLUS caller-named lane artifacts via allowUntracked: the run lane's CODEX-REPORT.md is never committed by contract (codex.mjs header), so without the exception EVERY codex-lane disposal refuses on its own report; review lanes dispose untracked-tolerant — the detached read-only lane never commits and its --doc file is a copy from the primary (reviewCodex docblock) — so only MODIFIED TRACKED files refuse there), unpushed commits (log @{u}.. or --not --remotes), live pgid in a lane journal — and on refusal KEEPS the worktree and prints why; on pass: git worktree remove, delete the branch ONLY when fully merged into the integration ref, git worktree prune ride-along. Every git call anchors at repoRoot, never the disposed dir — phase land runs INSIDE the worktree it disposes (the landing.mjs METERTENANT rule: post-merge acts anchor on the PRIMARY checkout). Refusal is stderr + nonzero detail in the land report, never a land failure — landing succeeded; disposal reports honestly.\n\nDONE-MOMENTS AND THEIR OWNERS (the whole design):\n(1) PHASE LAND (runLandCli path in cli/commands/phase.mjs → landPhase in cli/lib/worktree.mjs): slot-lane landing keeps the slot (its lifecycle is reuse-via-reset) but prunes metadata; a land whose source is a codex lane worktree ({root}-codex-<ids>, journal via findJournal ROOTED AT mainCheckout(cwd) — journals live under the PRIMARY .building/ while phase land runs inside the worktree, the phase-3 anchor) disposes worktree + merged codex/* branch + archives the journal (renamed .closed.json so status reads a closed lane honestly, never dead-no-report — the statusCodex closed-read in (3) is that promise's mechanism). REACHABILITY (review finding 2026-08-23): today the codex lane NEVER reaches this seam — do-phase's Integration-routing paragraph lands codex work by MANUAL rebase + ff-only merge from the primary, and runLand refuses under executionIsolation 'primary' (executionIsolationOf defaults to 'primary'; this consumer's roadmap.config.json sets no override). So (1) also makes phase land the codex lane's landing verb: accept a JOURNAL-CONFIRMED codex-lane source regardless of executionIsolation — source-keyed safety, the land rebases the codex worktree and moves the integration ref while the primary tree stays untouched, exactly the guarantee the manual routing gave; the isolation refusal stays for every non-codex source. landPhase's rebase+guarded-ff IS the documented manual sequence mechanized; 6.4 reroutes the skill prose to match.\n(2) ARC LAND (landArc in cli/lib/landing.mjs — do-arc SKILL already names it the cleanup owner: 'arc land completes the BOOKKEEPING only (cleanup, RunnerSummary, push)'): extend its existing cleanup to dispose every landed member's codex-lane worktree via the same rail; probe at execution what its cleanup ALREADY covers and extend, never fork (the plan-arc reuse rule).\n(3) REVIEW COMPLETE (statusCodex in cli/commands/codex.mjs): when state=complete on a review-lane journal, ARCHIVE the lane — copy CODEX-REVIEW.md to the primary's .building/codex-review-<ids>-REPORT.md, remove the detached worktree (no branch exists — review lanes add --detach), stamp the journal archived; idempotent (a second status on an archived lane reports state=complete from the relocated report). The stale-sentinel mtime guard semantics MUST survive unchanged — the archived-journal read path bypasses the worktree report entirely. statusCodex also RESOLVES archived RUN-lane journals: probe codex-<ids>.closed.json + a closed-journal scan, reporting an honest closed state (exit 0) — the live journalRe class [\\d-] excludes '.', so .closed.json escapes both lane scans today and a landed lane would otherwise read 'no journal covers phase(s)'. Status gains a completion SIDE EFFECT deliberately: consuming the verdict IS the review lane's done-moment, and the alternative is a new close verb the ruling forbids.\n(4) SKILL PROSE → MECHANISM: do-phase's codex-delegation 'clean up the worktree' line becomes a pointer to (1)'s mechanics (one line, DIET-LEDGER row for the trim); plan-phase's verify-rehearsal scratch-worktree protocol already instructs removal — verify at execution it names `git worktree remove` explicitly, tighten only if not.\n\nOUT OF SCOPE, honestly: harness-created worktrees (EnterWorktree isolation, ad-hoc session scratchpads like the seven /tmp ones from the audit) are not plugin flows — the plugin cannot own their lifecycle; the prune ride-alongs in (1)/(2) at least clear their dead REPO METADATA when /tmp dies. Slot worktree retirement (a slot dir no session will ever reclaim) stays manual — slots are persistent by design and npm-ci-expensive to recreate.\n\nWHY dependsOn [3]: phase 3 lands findJournal (the shared journal scan this reuses) and the journal driver key; both phases edit codex.mjs journal/status seams — strict ordering beats a conflict fence.\n\n## Hypotheses\n1. CONFIRMED — cleanup exists only as honor-system skill prose at TWO do-phase SKILL.md sites ('clean up the worktree' in the delegation paragraph; 'remove the worktree, the `codex/<N>` branch AND the `.building/codex-<N>.json` journal' in Integration routing) with NO code path disposing codex/review worktrees: the only programmatic remove in the CLI is landArc's own sidecar cleanup (landing.mjs worktree-remove step). Evidence: grep for worktree remove/worktreeRemove across cli/ hits landing.mjs alone; the 2026-08-23 audit found two FULLY MERGED exec lanes still squatting.\n2. REFUTED — 'leaks are crash-orphans, so done-verb hooks would not have fired anyway': the audit's exec-lane worktrees had fully merged branches — their done-verbs ran to completion; only the cleanup was prose. (True crash-orphans are the in-flight class the ruling deliberately keeps sacred.)\n3. NOT TESTED — 'operators skip the prose because manual disposal feels unsafe without checks': plausible contributor; the refusal-first rail removes the risk either way.\n\nREVIEW RATIFICATIONS (Mode A, 2026-08-23): testMode tdd ratified on 6.1–6.3 (each step's verify is the test tripwire the task itself authors); 6.4 testMode none ratified — declarative markdown/ledger artifacts guarded by the step-level grep verify plus the designHomes DIET-LEDGER protocol (declarative-artifact rule). No testScope/reviewScope relaxations declared; userFacing n/a (CLI + skill prose). Assumption 3 fails at plan time BY DESIGN: it is the execution-time tripwire proving dependsOn [3] actually delivered the exported findJournal before this phase leans on it (the phase-5 assumption-2 precedent).",
  version: '0.32.0',
  completedDate: '2026-08-25',
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: { passed: 1366, total: 1366, notes: 'the whole plugin suite via the consumer unit slot; +54 over the 1312 baseline, across five files' },
    integrationTests: { passed: 0, total: 0, notes: "declared-none in this consumer's gateCommands; the fixture-consumer tier inside the unit slot IS the integration level, and its 36 tests are green" },
    e2eTests: { passed: 0, total: 0, notes: 'no e2e slot — CLI plugin, no UI surface' },
    build: 'clean',
    notes:
      "lint/types/build are declared-none in this consumer; the binding mechanical slots are unit, lint-diff and the history-comments ratchet, all exit 0 (run-000014). The hardening closure verification was driven against the REAL CLI in scratch consumers rather than only in-suite: `roadmap phase land` from inside a codex worktree landed, disposed the worktree, deleted the merged branch and archived the journal; `roadmap codex status` then read the archived lane as 'closed' exit 0 where it had printed 'no journal covers phase(s) 500' exit 1 before; a complete review lane self-archived and stayed readable on a second read; a blocking untracked file kept its worktree with the land still green; and a journal naming a session slot was refused by both the land and the status read. Falsified in the other direction too: the same fixture driven against the pre-phase code (bf08360, restored verbatim into a scratch plugin copy) refuses the land outright under executionIsolation 'primary' and leaks both the worktree and the branch — the audit's exact finding.",
  },
  gateRounds: [
    {
      round: 0,
      agent: 'quality-pass',
      verdict: 'findings-fixed',
      summary:
        'Deduplicated a byte-identical groupAlive probe and the hand-written run-lane artifact list (now RUN_LANE_ARTIFACTS in the module that owns LANES.run.report); dropped a redundant guard and two duplicated comments; moved the dedupe rationale into the helper implementing it. Hard-stopped [SPECULATIVE] on unifying findClosedJournal with findJournal. Surfaced one REAL bug: archiveReviewLane skipped its copy when the ids-keyed destination already existed, so a relaunched review disposed its lane and left status serving the previous verdict.',
      findings: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          severity: 'MEDIUM',
          confidence: 90,
          agent: 'quality-pass',
          description:
            "archiveReviewLane guarded its copy on `!existsSync(archived)`. A second `codex review <N>` writes a fresh journal, so the archive fires and the new lane IS disposed — but the copy was skipped because the previous review's verdict occupied the ids-keyed path, leaving `codex status` serving a superseded verdict from a lane it had just removed.",
          fixedInCommit: '25b8df9',
        },
      ],
    },
    {
      round: 1,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Nine findings, all fixed in e13778d, each pinned by a test that reds without the fix. The HIGH was reproduced empirically in a scratch repo.',
      findings: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
          severity: 'HIGH',
          confidence: 90,
          agent: 'code-reviewer',
          description:
            'The unpushed reachability rail FAILED OPEN: one dangling ref under refs/remotes makes `rev-list --not --branches --remotes --tags` exit 128, and `orphan.ok && count > 0` read that as "nothing is orphaned", falling through to `worktree remove --force`. For a `branch: null` lane — what archiveReviewLane passes — the commits survive only in the reflog. Now an unresolvable HEAD or an unanswerable query refuses "failed".',
          fixedInCommit: 'e13778d',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          severity: 'MEDIUM',
          confidence: 90,
          agent: 'code-reviewer',
          description:
            "The review done-moment was one-shot. `state === 'complete'` with a LIVE process group is reachable (a driver writes its sentinel before its group exits, and do-phase polls status in a loop), so a poll in that window archived the verdict, got reason 'live', and no later status ever retried — the worktree leaked forever, the exact class this phase exists to kill. The relocation stays one-shot; the disposal now retries while the worktree exists.",
          fixedInCommit: 'e13778d',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs',
          severity: 'MEDIUM',
          confidence: 90,
          agent: 'code-reviewer',
          description:
            'Arc land disposed a member lane but never archived its journal, so `codex status` read dead-no-report exit 2 for a lane that ran and landed, while the same lane landed by `phase land` read closed — two answers for one lane. archiveJournal moved into codex.mjs as the shared home and arc land calls it.',
          fixedInCommit: 'e13778d',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          severity: 'MEDIUM',
          confidence: 85,
          agent: 'code-reviewer',
          description:
            'codexLaneSource confirmed a source purely by path equality with the journal, and `codex run --worktree <existing dir>` journals whatever it is handed — so a provisioned slot, or the primary checkout itself, could be confirmed as a codex lane and disposed. Now neither can be.',
          fixedInCommit: 'e13778d',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          severity: 'MEDIUM',
          confidence: 85,
          agent: 'code-reviewer',
          description:
            'A JournalUnreadableError was swallowed to null, so a truncated launch record produced the isolation refusal — whose remedy is actively harmful: flipping the knob makes the land succeed and take the not-a-lane branch, silently never disposing the lane.',
          fixedInCommit: 'e13778d',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs',
          severity: 'LOW',
          confidence: 85,
          agent: 'code-reviewer',
          description:
            "A throw on lane #1 skipped disposal of lanes #2..N, and the outer catch's message sent the operator at the sidecar/claims acts that had already succeeded. Each disposal is now isolated and named.",
          fixedInCommit: 'e13778d',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
          severity: 'LOW',
          confidence: 85,
          agent: 'code-reviewer',
          description:
            'A merged branch that would not delete (checked out elsewhere, a ref lock) was discarded into a bare boolean, so the caller printed "disposed the lane" over a leak nobody could see. The pass path now carries the git text in `detail`.',
          fixedInCommit: 'e13778d',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          severity: 'LOW',
          confidence: 85,
          agent: 'code-reviewer',
          description:
            "A closed lane spread the journal unresolved, emitting the bare report NAME for a file the land had force-removed with the worktree — a path that exists nowhere. Now `report: null`.",
          fixedInCommit: 'e13778d',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          severity: 'LOW',
          confidence: 80,
          agent: 'code-reviewer',
          description:
            'driverReconcile asked only findJournal, whose class excludes ".", so once a land archived the journal every gate re-run silently took the "inline session = no check" path and stopped comparing executionResult.driver against launcher truth. It now falls back to findClosedJournal.',
          fixedInCommit: 'e13778d',
        },
      ],
    },
    {
      round: 2,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Reviewed the R1 FIXES and found two of them had recreated the symptom they closed. Eight findings, all fixed in 6a9b423.',
      findings: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs',
          severity: 'MEDIUM',
          confidence: 97,
          agent: 'code-reviewer',
          description:
            'The R1 archive gate was `r.disposed && !r.alreadyDisposed`, which skips exactly the case where the lane IS gone (/tmp died, or a sibling removed it) — so arc land left the journal live and `codex status` read dead-no-report for a landed member, the very symptom R1 finding 3 was raised against, while `phase land` did the opposite. Now gated on `disposed` alone.',
          fixedInCommit: '6a9b423',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs',
          severity: 'MEDIUM',
          confidence: 90,
          agent: 'code-reviewer',
          description:
            'The R1 slot guard was applied to one of the two disposal call sites; codexLaneDirs had none, so `arc land` could still force-remove a provisioned slot. isSlotDir/samePath hoisted into worktree.mjs — the module that owns the <root>-wt-<k> namespace — and applied at both.',
          fixedInCommit: '6a9b423',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          severity: 'MEDIUM',
          confidence: 95,
          agent: 'code-reviewer',
          description:
            'The pass-path `detail` R1 added had NO reader in any of the three callers, so the field was dead and a leaked merged branch stayed invisible — the symptom the R1 finding described verbatim. phase land now writes it; the arc record spreads it.',
          fixedInCommit: '6a9b423',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
          severity: 'MEDIUM',
          confidence: 85,
          agent: 'code-reviewer',
          description:
            "The new fail-closed refusal has repo-GLOBAL blast radius — refs are shared, so one dangling entry refuses every lane in the consumer — and a land is a one-shot done-moment with no sweep verb allowed to return. The remedy now travels in the refusal text (how to find the bad ref, how to finish by hand); a run-lane retry was judged out of scope and the round 3 reviewer independently confirmed from the code that no success-moment exists to hang one on.",
          fixedInCommit: '6a9b423',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          severity: 'MEDIUM',
          confidence: 88,
          agent: 'code-reviewer',
          description:
            "findClosedJournal swallowed a corrupt archived journal (archiveJournal's write is not atomic), so driverReconcile returned no problems where its own contract two lines above says a journal that EXISTS and will not parse is a PROBLEM, never an absence. An opt-in strict mode used by the gate caller alone restores the loud guard.",
          fixedInCommit: '6a9b423',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          severity: 'LOW',
          confidence: 92,
          agent: 'code-reviewer',
          description:
            'The R1 unreadable-journal message was printed and then FOLLOWED by the isolation refusal, so the operator received the harmful remedy underneath the honest one. codexLaneSource now returns a distinct unreadable refusal and runLand refuses with that alone.',
          fixedInCommit: '6a9b423',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs',
          severity: 'LOW',
          confidence: 90,
          agent: 'code-reviewer',
          description:
            "The R1 per-lane try wrapped the archive too, so an archive failure pushed a second 'errored' entry after the lane's 'disposed' one — two contradictory outcomes for one worktree, with the archive failure blamed on the disposal. The archive has its own try and its own cleanup warning.",
          fixedInCommit: '6a9b423',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          severity: 'LOW',
          confidence: 93,
          agent: 'code-reviewer',
          description:
            "isSlotDir's comment claimed two independent reads where the registry leg could only ever return a directory the shape test already matched — a rationale the code cannot have. The dead read is gone and the comment is honest.",
          fixedInCommit: '6a9b423',
        },
      ],
    },
    {
      round: 3,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        "Reviewed the R2 fixes ANALYTICALLY (no suites — the full mechanical gate ran concurrently on this shared host; the executor ran every verification instead). Cleared both shape-change hunts it was pointed at (the codexLaneSource union at its single call site, disposedNow's scope) and confirmed the fail-closed scope ruling from the code: a second `phase land` cannot re-attempt, because landPhase throws on the already-landed head and runLand returns 2 before disposeSource, so there is no success-moment to hang a retry on. Six findings, all fixed in e73c6be.",
      findings: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          severity: 'MEDIUM',
          confidence: 85,
          agent: 'code-reviewer',
          description:
            'archiveReviewLane is a THIRD disposeWorktree call site and the R2 slot guard had reached only two — and this one fires from a READ command. `codex review <N> --worktree <root>-wt-3` plus any status read would force-remove a slot, with untracked-tolerance meaning even its node_modules would not refuse. It now refuses, says so, and still delivers the verdict.',
          fixedInCommit: 'e73c6be',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
          severity: 'MEDIUM',
          confidence: 90,
          agent: 'code-reviewer',
          description:
            'The failed-removal refusal reported the PROBE\'s output rather than the --force attempt\'s, and the comment three lines above says the probe always fails on the allowUntracked lane artifacts — so every real failure (locked worktree, EACCES, main working tree) was reported as "contains modified or untracked files". This site also lacked the remediation the other two terminal refusals gained.',
          fixedInCommit: 'e73c6be',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          severity: 'MEDIUM',
          confidence: 88,
          agent: 'code-reviewer',
          description:
            "disposeSource's docstring promised it never throws, but archiveJournal (writeFileSync + rmSync on the primary's .building) was unguarded — an EACCES there propagated out of runLand as a stack trace over a land whose merge and push had already succeeded, with no word about the journal left reading live. The arc side already had its own catch; the two verbs now agree.",
          fixedInCommit: 'e73c6be',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          severity: 'LOW',
          confidence: 95,
          agent: 'code-reviewer',
          description: 'Two imports (realpathSync, resolve) orphaned by the R2 hoist of samePath/isSlotDir into worktree.mjs.',
          fixedInCommit: 'e73c6be',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          severity: 'LOW',
          confidence: 90,
          agent: 'code-reviewer',
          description:
            "The doc block R2 wrote to explain `strict` sat immediately above archiveJournal's own block, so it documented nothing and findClosedJournal had none. Moved onto the function it describes.",
          fixedInCommit: 'e73c6be',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
          severity: 'LOW',
          confidence: 90,
          agent: 'code-reviewer',
          description:
            "R2 inserted the RECOVERY constant between disposeWorktree's JSDoc and the function, detaching the rail's entire contract doc from the rail. Hoisted above it.",
          fixedInCommit: 'e73c6be',
        },
      ],
    },
  ],
  metrics: {
    commits: 12,
    linesAdded: 2478,
    linesRemoved: 63,
    filesChanged: 13,
    testsAtStart: 1312,
    testsAtEnd: 1366,
    testsAdded: 54,
    // Backfilled from git (the move-to-in-progress commit and 04c2a98 'mark phase 6 complete'):
    // commit-derived wall clock. haltCount is deliberately ABSENT — the executor beacons that
    // would evidence a halt are gone, and the scorecard's haltRate filters on the key's absence
    // precisely so an unknown is not scored as a clean run.
    startedAt: '2026-08-25T09:36:37Z',
    completedAt: '2026-08-25T13:53:04Z',
  },
  compromises: 'None',
  executionResult: {
    phase: 6,
    status: 'done',
    driver: { model: 'claude-opus-5[1m]', lane: 'session' },
    roles: [
      { role: 'test-engineer', model: 'claude-opus-5[1m]', via: 'native' },
      { role: 'quality-pass', model: 'claude-opus-5[1m]', via: 'native' },
      { role: 'code-reviewer', model: 'claude-opus-5[1m]', via: 'native' },
    ],
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      "The round 3 fixes (commit e73c6be) did not themselves receive an independent review round — the gate cap says a final round with findings is SURFACED rather than self-reviewed. They were verified by scoped suites, the full mechanical gate (run-000014, green), and a live end-to-end drive of all four verbs, but a fourth independent read is OWED for the arc sweep.",
      "[SPECULATIVE] hard-stop from the quality pass, still open: findClosedJournal is a structural parallel of findJournal (exact-name probe, then a .building scan, then a phases-cover check). Unifying them needs a flag that toggles findJournal's heavily-pinned JournalUnreadableError semantics; round 2 then required exactly such a flag for the gate reconcile, so a narrow `strict` seam now exists and a future unification has a starting point. Left for a human call.",
      "cli/lib/landing.mjs now imports three symbols (archiveJournal, findJournal, RUN_LANE_ARTIFACTS) from cli/commands/codex.mjs — a lib importing a command. Sanctioned by codex.mjs's own docblock and required by this phase's assumption 3, but the boundary is now load-bearing enough that the next journal consumer should extract a lib-level journal/lane-contract module rather than become a fourth importer.",
      "Arc land archives the journal of an ALREADY-GONE lane but never deletes its merged codex/<ids> branch — disposeWorktree's missing-dir early return cannot reach the branch delete, and the archive then closes the journal, so no verb looks at that branch again. Branch accumulation is a strictly smaller class than worktree accumulation and closing it would need a done-moment the operator ruling does not grant; recorded so a later round does not rediscover it as a bug.",
    ],
    hardStops: [],
    limitations: [
      "History stays GRANULAR: `roadmap phase curate 6` refuses, naming `docs(roadmap): mark phase 6 complete` as a foreign commit interleaving the range. The cause is an ordering slip by this executor — the protocol's binding order is gate, then curate, then the completion commit, and the completion commit went first. It was left alone rather than forced: the four gate rounds cite fix commits by sha (25b8df9, e13778d, 6a9b423, e73c6be), and a squash would make every one of those references unreachable, which costs more than tidy history is worth. Twelve task/gate commits plus the completion commit reach the integration branch instead of 1-3 curated ones.",
      "`gate run 6 --verify-complete` passes with one WARNING it leaves to reviewer judgement: 42ca720 (the round-0 quality pass) touches only source files with no test in its diff. That commit is pure deduplication — one groupAlive probe replacing two byte-identical copies, and one exported RUN_LANE_ARTIFACTS replacing a hand-written list at two call sites — with no behaviour change, so no new test is owed; the existing suites cover it and all three later review rounds read it.",
    ],
    gateRounds: 4,
  },
  tasks: [
    {
      id: '6.1',
      title: 'The disposal rail — one refusal-first helper beside the landing engine',
      problem:
        'Disposal safety (dirty/unpushed/live checks with named refusals) must exist exactly once, or three done-verbs grow three slightly different unsafe copies — the hand-list drift class again, in rm form.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
          description:
            'Author disposeWorktree per the notes rail: refusal checks (dirty excepting untracked .building/ and caller-named allowUntracked artifacts, with an untracked-tolerant mode for read-only review lanes; unpushed; live journal pgid) each returning a named reason; every git call anchored at repoRoot, never the disposed dir (callers dispose the worktree they stand in); pass path removes worktree, deletes only-if-merged branch, prunes. worktree.test.mjs EXISTS (the slot-registry suite) — extend it, do not recreate → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
          description:
            'Hermetic fixtures proving every refusal names its reason and keeps the tree: dirty file → refused; unpushed commit → refused; live pgid journal → refused; clean+merged → removed with branch gone and metadata pruned; untracked .building/ alone → NOT a refusal; an untracked allowUntracked-named report alone → NOT a refusal; a modified TRACKED file under untracked-tolerant mode → still refused → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'All four refusal classes red with named reasons and leave the worktree intact, asserted per class',
        'The pass path removes worktree + merged branch + prunes, and an unmerged branch survives its worktree removal',
        'The untracked exceptions (allowUntracked, untracked-tolerant mode) never mask a modified tracked file',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
        'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
      ],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          'disposeWorktree(repoRoot, dir, { branch, integrationRef, allowUntracked, untrackedTolerant, pgid }) lands in cli/lib/worktree.mjs beside landPhase, plus a groupAlive process-group probe (the codex-journal pattern, absent from this module until now). Four refusal classes, each keeping the worktree and naming its reason: live pgid, dirty (modified TRACKED file, or an untracked file outside the exceptions), unpushed (commits no remote and no other branch carries), and a failed remove. The pass path removes the worktree, deletes the lane branch ONLY when it is fully merged into integrationRef, and prunes. cli/lib/worktree.test.mjs gains 11 tests (+386 lines, no existing test edited).',
        how:
          'TDD via test-engineer, contract-only brief (problem + acceptanceCriteria + files + the type signature; never the steps). RED proven on the committed module: 27 tests, 16 pass, 11 fail, all 11 on the named missing export. GREEN after the implementation: 27/27. Three implementation traps the RED round surfaced and the tests then caught: (a) the module\'s own git() helper trims, which eats the leading space of `git status --porcelain`\'s FIRST line so a slice(3) parse names `rc/seed.txt` for `src/seed.txt` — disposal reads status UNTRIMMED; (b) `--exclude refs/heads/<b>` silently matches nothing against --branches (short form only — the same trap reclaimable() documents ten lines above), measured in a scratch repo: long form 0, short form 1; (c) `git branch -d` measures merged-ness against HEAD, so a parked primary would refuse a branch fully merged into develop — merged-ness is an explicit `merge-base --is-ancestor <branch> <integrationRef>` with -D behind it. Anchoring: every git call passes BOTH `-C <root>` and an explicit spawn cwd of repoRoot, so the caller can dispose the worktree it is standing in without the post-removal calls hitting ENOENT on a deleted cwd. `git worktree remove` refuses any untracked file, so the pass path falls back to --force — only ever on a tree this helper has already proven carries nothing but named-allowed artifacts.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The unpushed rail reads reachability from remotes/other-branches/tags, which in a checkout with NO remote configured means any lane commit not also on another branch refuses — correct for this design (the operator pushes or lands first) and pinned by the tests, but it means a purely local consumer never auto-disposes an unlanded lane. A fifth outcome beyond the plan\'s four refusal classes exists: reason \'failed\' for a `git worktree remove` that fails for a reason the checks did not predict, rather than laundering it as \'dirty\'.',
      },
      done: true,
      doneDate: '2026-08-25',
    },
    {
      id: '6.2',
      title: 'Phase land and arc land dispose what they landed',
      problem:
        "Landing is the done-moment for work-producing worktrees, but today it walks away: the audit's two merged exec lanes sat for weeks because nothing at land time owned closure. do-arc's own SKILL names arc land the cleanup owner — the claim must become true.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          description:
            "In the runLand success path: codex-lane source (findJournal rooted at mainCheckout(cwd) — journals live in the PRIMARY .building/) → disposeWorktree (allowUntracked: CODEX-REPORT.md, git anchored at the primary) + archive the journal to .closed.json; accept a journal-confirmed codex-lane source even under executionIsolation 'primary' (notes REACHABILITY design); slot-lane sources get prune ride-along only. Disposal refusal reports on stderr, never fails the land → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/phase.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs',
          description:
            "Probe landArc's existing cleanup scope first (today: sidecar worktree remove + sidecar/RESUME.md/claims, best-effort by law — extend that block, never fork); add per-landed-member codex-lane disposal through the same rail anchored at home (an arc delegated as ONE codex run shares one multi-phase journal + worktree — dedupe; an already-removed worktree reports already-disposed, never an error), with the arc land report listing each disposed/refused worktree by name → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/landing.test.mjs",
        },
      ],
      acceptanceCriteria: [
        'A landed codex-lane phase leaves no worktree, no merged codex/* branch, and a .closed.json journal; a refused disposal leaves the land GREEN with the named reason in the report',
        'Arc land disposes every landed member lane and its report names each disposal outcome',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/phase.mjs',
        'plugins/zeroh-roadmap/cli/lib/landing.mjs',
        'plugins/zeroh-roadmap/cli/commands/phase.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/landing.test.mjs',
      ],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          "runLand in cli/commands/phase.mjs gains codexLaneSource (mainCheckout(cwd) + the exported findJournal + path EQUALITY between the journal's worktree and cwd) and accepts such a source whatever executionIsolation says — the operator-approved design change that makes `roadmap phase land` the codex lane's landing verb. Every other source keeps the isolation refusal; the master/main rail still refuses first. After the push it disposes: worktree removed, merged codex/<N> branch deleted, journal RENAMED to codex-<ids>.closed.json (stamped closedAt/closedBy, never deleted). A slot lane keeps its worktree but rides the prune along. landArc in cli/lib/landing.mjs gains an injected `dispose = disposeWorktree` seam and a codexLaneDirs helper, wired INSIDE the existing best-effort cleanup block, one entry per lane in the land record (disposed / already-disposed / refused + reason + detail).",
        how:
          "TDD via test-engineer on a contract-only brief; 12 tests added across two files (phase.test.mjs 25\u219232, landing-mechanics.test.mjs 22\u219227), RED first with the failures quoted, then GREEN 32/32 and 27/27. The test-engineer falsified both suites against a throwaway reference implementation in the scratchpad and caught 13/13 mutations \u2014 including 'accept ANY journal' (drops the source-keying), 'delete the journal instead of renaming', 'drop allowUntracked', 'hardcode integrationRef develop', 'no dedupe', and 'fork a second try/catch instead of extending'. Dedupe is keyed on resolve(worktree): an arc delegated as ONE `codex run --arc` shares a single multi-phase journal across members, and a second call would run the rail against a directory the first removed. The lane branch is read from the checkout BEFORE the land (the journal records no branch, and after the rebase+ff the branch is the integration tip); landArc derives it from the journal's ids the way launch() builds it. Disposal runs LAST, after the push, because it removes the directory the earlier acts run in.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "PLAN DRIFT, named: the plan's step verify pointed at cli/lib/landing.test.mjs for the arc half, but landArc's cleanup is tested in cli/lib/landing-mechanics.test.mjs (landing.test.mjs holds the DECISION half only \u2014 the eight-blocker table and the followups arithmetic). The tests went to the real home. Two additions beyond the plan's letter: a slot-lane prune-ride-along test (grounded in the step's own 'slot-lane sources get prune ride-along only') and allowUntracked asserted on the arc path too (same run lane, same never-committed report). cli/lib/landing.mjs now imports findJournal from cli/commands/codex.mjs \u2014 a lib importing a command, which the module's own docblock sanctions ('shared rather than private because the reconcile at landing must find the same journal codex status does') and this phase's assumption 3 requires, but it is a layering the next journal-consumer should turn into a lib module rather than a third importer.",
      },
      done: true,
      doneDate: '2026-08-25',
    },
    {
      id: '6.3',
      title: 'A complete review archives itself at the status read',
      problem:
        'Review lanes are detached read-only worktrees whose done-moment is the verdict being consumed — today the worktree outlives the verdict indefinitely, and the ruling forbids a close verb.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            "statusCodex on a review-lane journal at state=complete: copy the report to .building/codex-review-<ids>-REPORT.md in the primary, disposeWorktree untracked-tolerant (detached read-only lane, no branch — only modified tracked files refuse), stamp the journal archived; archived lanes report complete from the relocated report (idempotent). Also resolve archived RUN-lane journals (codex-<ids>.closed.json probe + closed-journal scan) to an honest closed state, exit 0, instead of 'no journal covers'. Stale-sentinel mtime semantics unchanged on live lanes → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Pin: complete → archived (report relocated, worktree gone, second status still complete); running lane untouched; stale-report lane untouched (mtime guard intact); review worktree with a MODIFIED TRACKED file → disposal refused with name, report still relocated; a .closed.json run journal resolves to closed with exit 0 → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'A complete review lane self-archives on first status read and stays readable forever after; all pre-existing codex tests stay green',
        'The mtime stale-sentinel behaviour is byte-identical on non-archived lanes, asserted by the existing tests unmodified',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/codex.mjs',
        'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
      ],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          "statusCodex gains the review lane's done-moment and the run lane's closed read. A COMPLETE, not-yet-archived review journal: the verdict is COPIED to <journal-dir>/codex-review-<ids>-REPORT.md, the detached worktree is disposed through the rail (untrackedTolerant, NO branch \u2014 a review lane owns none and the rail deletes a merged branch it is given), and the journal is STAMPED in place with archivedAt + archivedReport, keeping its live .json name so findJournal keeps resolving it. A new findClosedJournal (the closed twin of findJournal, same two lookups \u2014 exact name then scan) answers a miss with state 'closed' exit 0 instead of 'no journal covers'; LANES gains a per-lane closedRe beside journalRe, the table-driven shape the file already uses.",
        how:
          "TDD via test-engineer: 10 tests added (54\u219264), 6 RED on the missing behaviour and 4 deliberate negative regression guards, then GREEN 64/64 with all 54 pre-existing tests unedited. Falsified against a scratch reference implementation, 13/13 mutations caught \u2014 including 'archive fires on a stale/blocked sentinel', 'report moved instead of copied', 'journal renamed to .closed.json' (which breaks idempotence by losing the journal from findJournal), 'untrackedTolerant dropped', 'dispose called with a branch', 'closed probe made unconditional', and 'closed probe exact-name only' (which regresses every arc member but the first). The archival is keyed on the computed VERDICT (state === 'complete'), never on the report FILE, so a stale sentinel the mtime guard just rejected cannot archive a lane from behind and delete a live reviewer's worktree. Integration-level verification against the real CLI in a scratch consumer: `roadmap phase land 500` from inside a codex worktree landed, disposed and archived (worktree gone, branch gone, codex-500.closed.json); `roadmap codex status 500` then reported state 'closed' exit 0 where it had printed 'no journal covers phase(s) 500' exit 1 before the fix; `codex status 999` still misses, proving the probe manufactures nothing.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The plan said an archived lane reports 'complete' FROM the relocated report. Taken as 'once archived, report is ALWAYS the relocated path' that contradicts this phase's own acceptance criterion that every pre-existing codex test stays green unmodified: the pre-existing `status: report is the resolved PATH` test drives a review lane whose disposal REFUSES (its worktree is a bare mkdir) and asserts report === <worktree>/CODEX-REVIEW.md. The satisfiable reading, implemented: the archived copy answers only once the worktree's own report is GONE. Both intents hold simultaneously and nothing was renegotiated downward. Also: findClosedJournal is deliberately quiet about an unreadable closed candidate (unlike findJournal, which throws) \u2014 a closed lane proves nothing about liveness, so a corrupt one is not an answer rather than a refusal; if a consumer ever needs to audit closed journals, that silence is where to start.",
      },
      done: true,
      doneDate: '2026-08-25',
    },
    {
      id: '6.4',
      title: 'The skill prose stops promising what the verbs now do',
      problem:
        "do-phase's 'clean up the worktree' is the honor-system line the audit falsified; leaving it beside the mechanized path would be two owners for one fact.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
          description:
            "Replace BOTH cleanup carriers in do-phase SKILL.md — the delegation 'clean up the worktree' line AND Integration routing's manual rebase/ff-merge + 'remove the worktree...' sentence — with the land verb: integration + disposal = `roadmap phase land <N>` inside the codex worktree, refusals in the land report; DIET-LEDGER.md row, same commit; verify-rehearsal already names `git worktree remove`, tighten if drifted → verify: bash -c \"! grep -qF 'clean up the worktree' plugins/zeroh-roadmap/skills/do-phase/SKILL.md && ! grep -qF 'branch AND the' plugins/zeroh-roadmap/skills/do-phase/SKILL.md && grep -qF 'worktree remove' plugins/zeroh-roadmap/skills/plan-phase/references/verify-rehearsal.md\"",
        },
      ],
      acceptanceCriteria: [
        'Both do-phase cleanup carriers (the delegation prose AND the Integration-routing manual-merge sentence) are gone with their DIET-LEDGER row landed; codex integration routes through roadmap phase land; plan-phase verify-rehearsal still names git worktree remove',
      ],
      files: [
        'plugins/zeroh-roadmap/skills/do-phase/SKILL.md',
        'plugins/zeroh-roadmap/skills/plan-phase/references/verify-rehearsal.md',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
      ],
      testMode: 'none',
      transparencyReport: {
        whatWasDone:
          "Both cleanup carriers are gone from skills/do-phase/SKILL.md. The delegation paragraph's back-half list ends at 'then land it'; the Integration-routing paragraph no longer teaches a manual rebase + ff-merge-from-the-primary and no longer says to remove the journal \u2014 it names `roadmap phase land <N>` run INSIDE the codex worktree, the disposal it performs, the three refusal classes (stderr, land still green), and the backlog groom that follows. `codex status`'s typed vocabulary gains `closed`. A three-row DIET-LEDGER.md section lands in the same commit with per-passage dispositions and code+test evidence.",
        how:
          "The step verify passes both directions: `! grep -qF 'clean up the worktree' && ! grep -qF 'branch AND the' && grep -qF 'worktree remove' skills/plan-phase/references/verify-rehearsal.md`. verify-rehearsal already named `git worktree remove` explicitly, so the plan's conditional tighten was not needed \u2014 nothing changed there. Protocol-load budget: the first draft GREW do-phase 12,203 B \u2192 12,243 B (3,051 \u2192 3,061 tokens, total 13,263 \u2014 over the 13,253 ceiling), caught by `roadmap measure --flow do-arc` before the commit; a second pass tightened it to 12,181 B / 3,046 tokens, total 13,248, and `measure --flow do-arc --assert 13253` reports 'within budget'. codex.test.mjs greps this SKILL for its protocol-owned strings and stays green (74/74 with measure.test.mjs).",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The prose now describes disposal from the phase-land side only. Arc land's per-member lane disposal (task 6.2) and the review lane's archive-at-status (task 6.3) are NOT named in any skill \u2014 deliberately, since do-arc's SKILL already names arc land the cleanup owner and the review lane's close is a side effect of a command the reader already runs, and both surfaces are inside the measured zero-growth set. If either behaviour ever needs a reader-visible caveat, it costs budget that must be funded by a trim elsewhere.",
      },
      done: true,
      doneDate: '2026-08-25',
    },
  ],
})
