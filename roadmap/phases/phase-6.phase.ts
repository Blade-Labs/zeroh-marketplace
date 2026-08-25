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
  status: 'in-progress',
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
    "LOCKED (operator ruling 2026-08-23, verbatim intent): no standalone sweep/clean command — disposal has NO verb of its own; no timer reaper of any period. Disposal fires ONLY inside verbs that already exist, at their success moments. A lane that never reaches its done-verb keeps its worktree — that is correct (in-flight work is sacred); the accumulation class this kills is DONE work whose cleanup was honor-system prose.\n\nTHE DISPOSAL RAIL (shared helper, one home — cli/lib/worktree.mjs beside landPhase): disposeWorktree(repoRoot, dir, { expectBranchMerged, allowUntracked }) refuses with NAMED reasons — dirty tree (untracked .building/ excepted, matching the audit protocol, PLUS caller-named lane artifacts via allowUntracked: the run lane's CODEX-REPORT.md is never committed by contract (codex.mjs header), so without the exception EVERY codex-lane disposal refuses on its own report; review lanes dispose untracked-tolerant — the detached read-only lane never commits and its --doc file is a copy from the primary (reviewCodex docblock) — so only MODIFIED TRACKED files refuse there), unpushed commits (log @{u}.. or --not --remotes), live pgid in a lane journal — and on refusal KEEPS the worktree and prints why; on pass: git worktree remove, delete the branch ONLY when fully merged into the integration ref, git worktree prune ride-along. Every git call anchors at repoRoot, never the disposed dir — phase land runs INSIDE the worktree it disposes (the landing.mjs METERTENANT rule: post-merge acts anchor on the PRIMARY checkout). Refusal is stderr + nonzero detail in the land report, never a land failure — landing succeeded; disposal reports honestly.\n\nDONE-MOMENTS AND THEIR OWNERS (the whole design):\n(1) PHASE LAND (runLandCli path in cli/commands/phase.mjs → landPhase in cli/lib/worktree.mjs): slot-lane landing keeps the slot (its lifecycle is reuse-via-reset) but prunes metadata; a land whose source is a codex lane worktree ({root}-codex-<ids>, journal via findJournal ROOTED AT mainCheckout(cwd) — journals live under the PRIMARY .building/ while phase land runs inside the worktree, the phase-3 anchor) disposes worktree + merged codex/* branch + archives the journal (renamed .closed.json so status reads a closed lane honestly, never dead-no-report — the statusCodex closed-read in (3) is that promise's mechanism). REACHABILITY (review finding 2026-08-23): today the codex lane NEVER reaches this seam — do-phase's Integration-routing paragraph lands codex work by MANUAL rebase + ff-only merge from the primary, and runLand refuses under executionIsolation 'primary' (executionIsolationOf defaults to 'primary'; this consumer's roadmap.config.json sets no override). So (1) also makes phase land the codex lane's landing verb: accept a JOURNAL-CONFIRMED codex-lane source regardless of executionIsolation — source-keyed safety, the land rebases the codex worktree and moves the integration ref while the primary tree stays untouched, exactly the guarantee the manual routing gave; the isolation refusal stays for every non-codex source. landPhase's rebase+guarded-ff IS the documented manual sequence mechanized; 6.4 reroutes the skill prose to match.\n(2) ARC LAND (landArc in cli/lib/landing.mjs — do-arc SKILL already names it the cleanup owner: 'arc land completes the BOOKKEEPING only (cleanup, RunnerSummary, push)'): extend its existing cleanup to dispose every landed member's codex-lane worktree via the same rail; probe at execution what its cleanup ALREADY covers and extend, never fork (the plan-arc reuse rule).\n(3) REVIEW COMPLETE (statusCodex in cli/commands/codex.mjs): when state=complete on a review-lane journal, ARCHIVE the lane — copy CODEX-REVIEW.md to the primary's .building/codex-review-<ids>-REPORT.md, remove the detached worktree (no branch exists — review lanes add --detach), stamp the journal archived; idempotent (a second status on an archived lane reports state=complete from the relocated report). The stale-sentinel mtime guard semantics MUST survive unchanged — the archived-journal read path bypasses the worktree report entirely. statusCodex also RESOLVES archived RUN-lane journals: probe codex-<ids>.closed.json + a closed-journal scan, reporting an honest closed state (exit 0) — the live journalRe class [\\d-] excludes '.', so .closed.json escapes both lane scans today and a landed lane would otherwise read 'no journal covers phase(s)'. Status gains a completion SIDE EFFECT deliberately: consuming the verdict IS the review lane's done-moment, and the alternative is a new close verb the ruling forbids.\n(4) SKILL PROSE → MECHANISM: do-phase's codex-delegation 'clean up the worktree' line becomes a pointer to (1)'s mechanics (one line, DIET-LEDGER row for the trim); plan-phase's verify-rehearsal scratch-worktree protocol already instructs removal — verify at execution it names `git worktree remove` explicitly, tighten only if not.\n\nOUT OF SCOPE, honestly: harness-created worktrees (EnterWorktree isolation, ad-hoc session scratchpads like the seven /tmp ones from the audit) are not plugin flows — the plugin cannot own their lifecycle; the prune ride-alongs in (1)/(2) at least clear their dead REPO METADATA when /tmp dies. Slot worktree retirement (a slot dir no session will ever reclaim) stays manual — slots are persistent by design and npm-ci-expensive to recreate.\n\nWHY dependsOn [3]: phase 3 lands findJournal (the shared journal scan this reuses) and the journal driver key; both phases edit codex.mjs journal/status seams — strict ordering beats a conflict fence.\n\n## Hypotheses\n1. CONFIRMED — cleanup exists only as honor-system skill prose at TWO do-phase SKILL.md sites ('clean up the worktree' in the delegation paragraph; 'remove the worktree, the `codex/<N>` branch AND the `.building/codex-<N>.json` journal' in Integration routing) with NO code path disposing codex/review worktrees: the only programmatic remove in the CLI is landArc's own sidecar cleanup (landing.mjs worktree-remove step). Evidence: grep for worktree remove/worktreeRemove across cli/ hits landing.mjs alone; the 2026-08-23 audit found two FULLY MERGED exec lanes still squatting.\n2. REFUTED — 'leaks are crash-orphans, so done-verb hooks would not have fired anyway': the audit's exec-lane worktrees had fully merged branches — their done-verbs ran to completion; only the cleanup was prose. (True crash-orphans are the in-flight class the ruling deliberately keeps sacred.)\n3. NOT TESTED — 'operators skip the prose because manual disposal feels unsafe without checks': plausible contributor; the refusal-first rail removes the risk either way.\n\nREVIEW RATIFICATIONS (Mode A, 2026-08-23): testMode tdd ratified on 6.1–6.3 (each step's verify is the test tripwire the task itself authors); 6.4 testMode none ratified — declarative markdown/ledger artifacts guarded by the step-level grep verify plus the designHomes DIET-LEDGER protocol (declarative-artifact rule). No testScope/reviewScope relaxations declared; userFacing n/a (CLI + skill prose). Assumption 3 fails at plan time BY DESIGN: it is the execution-time tripwire proving dependsOn [3] actually delivered the exported findJournal before this phase leans on it (the phase-5 assumption-2 precedent).",
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
      done: false,
    },
  ],
})
