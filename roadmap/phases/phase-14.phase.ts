import { definePhase } from '@/lib/roadmap/schema'

/**
 * MINESWEEP plane 1 — worktree/lane lifecycle accounting.
 *
 * The 2026-08-31 mining found 19 stray sibling worktrees (~6.5 GB) across four consumers,
 * every sampled one dead (pgid gone, journal unarchived). Root causes are mechanical and
 * live in THIS plugin: the plan lane has no done-moment at all, an already-gone lane's
 * merged branch survives disposal, and nothing surfaces the accumulation (report-only by
 * operator ruling — no sweep verb; visibility + done-moments are the fix class).
 * Evidence + design rationale: roadmap/arc-prompts/MINESWEEP-execution-prompt.md §lanes;
 * arc: roadmap/arcs/MINESWEEP.arc.ts (LOCKED: report-only accounting; plan-lane close
 * mirrors the review lane's ratified consume-the-verdict pattern).
 *
 * ## Hypotheses (why lanes accumulate)
 * 1. CONFIRMED — disposal only fires at done-moments that real flows never reach: run-lane
 *    disposal lives solely in `phase land`/`arc land` (codexLaneSource reads ONLY 'run'
 *    journals, cli/commands/phase.mjs), hold-for-user merge policies and hand-harvests
 *    never call them, and the plan lane has NO close (statusCodex archives only the review
 *    lane — one `lane === 'review' && state === 'complete'` site, probe below). Evidence:
 *    atlas 11 merged-and-done lanes on disk; atlas-codex-plan-22 dead since 2026-08-29.
 * 2. REFUTED — "leaks are crash-orphans": the phase-6 audit proved the squatting exec
 *    lanes had FULLY MERGED branches (their done-verbs ran; only cleanup was prose).
 * 3. REFUTED — "operators skip a provided sweep verb": none exists, by operator ruling
 *    (cli/lib/worktree.mjs RECOVERY text: "no sweep verb exists").
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 14,
  name: 'Lane lifecycle accounting: inventory classifier, audit/status surfacing, plan-lane close, branch-delete gap',
  status: 'in-progress',
  plannedBy: { model: 'claude-fable-5' },
  category: 'fix',
  kind: 'hardening',
  arcId: 'MINESWEEP',
  source:
    'MINESWEEP plane "Lane lifecycle" — 2026-08-31 mining (.building/eval-mining-2026-08-31.md §Q1); user ask quoted in arc ledger: "pls check we dispose of all properly".',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
    'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/audit.mjs',
    'plugins/zeroh-roadmap/cli/commands/audit.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/status.mjs',
    'plugins/zeroh-roadmap/cli/commands/status.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
  ],
  stakeholderDemo:
    'Every leaked lane worktree is visible with its class and exact remedy from `roadmap audit` and counted in `roadmap status`; a harvested codex plan lane closes itself on the next status read exactly like the review lane; an already-deleted lane no longer strands its merged branch.',
  userFacing: false,
  assumptions: [
    {
      claim:
        'statusCodex archives ONLY the review lane today (exactly one review-gated archive site), so the plan lane has no done-moment.',
      verify:
        'bash -c "test \\"$(grep -c \\"lane === \'review\' && state === \'complete\'\\" plugins/zeroh-roadmap/cli/commands/codex.mjs)\\" = \\"1\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: "The plan lane's hand-off artifact is CODEX-PLAN.md, registered on LANES.plan.",
      verify:
        'bash -c "grep -qF \\"plan: { prefix: \'codex-plan-\', report: \'CODEX-PLAN.md\'\\" plugins/zeroh-roadmap/cli/lib/codex-journal.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim:
        'disposeWorktree returns branchDeleted:false on the already-gone path without attempting the merged-branch delete (the phase-6 recorded residue this phase closes).',
      verify:
        'bash -c "grep -qF \'return { disposed: true, alreadyDisposed: true, reason: null, detail: null, branchDeleted: false }\' plugins/zeroh-roadmap/cli/lib/worktree.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'isSlotDir is exported from worktree.mjs (the classifier must exclude session slots by the one existing membership test).',
      verify: "bash -c \"grep -qF 'export function isSlotDir' plugins/zeroh-roadmap/cli/lib/worktree.mjs\"",
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '14.1',
      title: 'disposeWorktree: an already-gone lane still deletes its merged branch',
      problem:
        'disposeWorktree(repoRoot, dir, {branch}) short-circuits when dir no longer exists (prune ride-along) and returns branchDeleted:false without ever asking whether the given branch is merged — so `arc land` over a hand-removed lane archives the journal but strands the merged codex/<ids> branch forever (recorded residue of marketplace phase 6; live specimens in atlas).',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
          description:
            'In disposeWorktree\'s `!existsSync(dir)` arm: before returning, when `branch` is given and `merge-base --is-ancestor branch integrationRef` holds, run the same `branch -D` + report shape as the normal path (branchDeleted true/false + detail on failure); an unmerged branch stays, exactly as on the normal path → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'already-gone lane still deletes its merged branch\' cli/lib/worktree.test.mjs && capbuild node --test cli/lib/worktree.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
          description:
            'Add two tests against a real tmp repo: (a) "already-gone lane still deletes its merged branch" — create lane branch, merge to integration ref, remove the worktree dir by hand, dispose → alreadyDisposed:true AND branchDeleted:true AND `git branch --list` empty for it; (b) "already-gone lane keeps an unmerged branch" (name verbatim) → branchDeleted:false and the branch survives → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'keeps an unmerged branch\' cli/lib/worktree.test.mjs && capbuild node --test cli/lib/worktree.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'Disposing an already-removed lane whose merged branch is passed deletes that branch (test a); an unmerged branch is never deleted (test b) — both directions in the suite',
        'The normal-path disposal behavior is byte-unchanged outside the !existsSync arm: git diff shows no edit below the liveness check in disposeWorktree',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/worktree.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-31',
      transparencyReport: {
        whatWasDone:
          "disposeWorktree's already-gone arm now asks the SAME merged-ness question the normal path asks: after the prune ride-along (which must run first — a stale worktree entry still holds the branch checked out, so `branch -D` would refuse), a given branch that is an ancestor of integrationRef is deleted and reported; an unmerged branch stays, because it is then the only named handle on that work. The delete lives in a new module-level helper deleteIfMerged(quiet, repoRoot, dir, branch, integrationRef) → { branchDeleted, detail }, which also NAMES a merged branch that would not delete (a held ref lock) rather than swallowing it into a bare false.",
        how:
          "TDD: test-engineer wrote the two cases blind to the implementation and confirmed the RED — (a) 'already-gone lane still deletes its merged branch' failed on `branchDeleted false !== true` with the branch still resolving; (b) 'keeps an unmerged branch' was GREEN at HEAD by construction (it is the over-deletion guard, not a red-first case). Implementation then took the suite to 32/32 via capbuild node --test cli/lib/worktree.test.mjs. Both new cases also pin disposed/alreadyDisposed true and the metadata prune, so a fix that buys the branch delete by dropping the ride-along fails.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "deleteIfMerged is NOT shared with the normal path's branch-delete block: acceptance criterion 2 freezes everything below the liveness check byte-for-byte, and the normal path must ask `merged` BEFORE its removal (there is no removal to order against here). So one rule has two callers by deliberate plan ruling, not by oversight — the normal path's copy carries its own worktree-context wording.",
      },
    },
    {
      id: '14.2',
      title: 'surveyLanes: the ONE lane-inventory classifier (worktree.mjs export)',
      problem:
        'Nothing enumerates lane worktrees with their lifecycle state, so accumulation is invisible until someone runs `git worktree list` by hand. The arc\'s singleSeam demands ONE classifier consumed by audit, status and codex status — a second worktree-enumeration parser is the forked-seam hazard.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
          description:
            "Export surveyLanes(root): parse `git -C root worktree list --porcelain`; skip the primary (samePath) and slots (isSlotDir); match each remaining dir to its journal by worktree-path equality via samePath/resolve on BOTH sides (architect note N2 — the refuseIfLive precedent: a relative --worktree in a journal must not yield a phantom legacy row for its own absolute twin) across live AND .closed codex journals of all LANES (unreadable → 'unknown', never a throw); classes: 'live' (pgid groupAlive) · 'stale-run'/'stale-plan'/'stale-review' · 'closed' · 'legacy' (no journal). Rows { dir, branch, class, journalPath|null, remedy }. Inventory + liveness ONLY — no dirty/unpushed probes (notes) → verify: bash -c \"grep -qF 'export function surveyLanes' plugins/zeroh-roadmap/cli/lib/worktree.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
          description:
            'Tests over a real tmp repo + real worktrees: a live-pgid lane (spawn a sleeping child, use its pid as journal pgid) classifies live; a dead-pgid run journal classifies stale-run with the land remedy; a journal-less worktree classifies legacy; a slot dir (-wt-1) and the primary never appear; an unreadable journal yields class unknown, never a throw → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'surveyLanes\' cli/lib/worktree.test.mjs && capbuild node --test cli/lib/worktree.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'surveyLanes classifies live / stale-<lane> / closed / legacy / unknown with a runnable remedy string per row; live lanes and slots are never presented as actionable',
        'The classifier never throws on unreadable journals and runs no per-dir status/rev-list probes (grep: no `status --porcelain` and no `rev-list` inside surveyLanes)',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/worktree.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs'],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['surveyLanes(root) from cli/lib/worktree.mjs'] },
      done: true,
      doneDate: '2026-08-31',
      transparencyReport: {
        whatWasDone:
          "surveyLanes(root) landed in cli/lib/worktree.mjs: it indexes every codex journal in .building/ — all three lanes, live AND .closed forms, read through the LANES table so no second name grammar exists — keyed by RESOLVED worktree path, then walks `git worktree list --porcelain` and returns one row { dir, branch, class, journalPath, remedy } per lane worktree, skipping the primary (samePath) and session slots (isSlotDir). Classes: live (pgid groupAlive) / stale-run|stale-plan|stale-review (suffix = the journal's own lane, because the three lanes have three different done-moments) / closed (archived journal, tree left behind) / legacy (no journal) / unknown (a journal that will not read). A live journal outranks an archived one for the same tree. Remedies are per-ROW pasteable commands: the run lane's `cd <dir> && roadmap phase land <N>`, the plan/review lanes' own consume-read `roadmap codex status <N> --plan|--review`, and a named git removal for closed/legacy.",
        how:
          "TDD: test-engineer wrote 10 cases blind to the implementation against real tmp repos, real git worktrees at the launcher's own path shape and real journals, with liveness proven by a REAL detached process group measured twice (live → reaped → surveyed again, so a cached or presence-inferred 'live' cannot pass). All 10 were RED on the missing export; the suite is now 42/42 (capbuild node --test cli/lib/worktree.test.mjs, exit 0, zero `not ok` lines). A module-load smoke over codex.mjs + landing.mjs confirms the new lib→lib import of codex-journal.mjs introduces no cycle.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "An unreadable journal is attributed to a lane by its raw bytes NAMING that directory; one truncated BEFORE its worktree field can name nothing, so it instead downgrades every otherwise-legacy lane to `unknown` with journalPath null. That is deliberately conservative — the codex-journal doctrine forbids folding an unreadable record into `no record` — but it means one corrupt file can widen the unknown class beyond the lane it really covers. Both directions are test-pinned.",
      },
    },
    {
      id: '14.3',
      title: 'roadmap audit check 15: stray lane worktrees (report-only)',
      problem:
        'The audit catalogue (checks 1-14) never looks at worktrees, so review flows that run audit cannot see the leak class. The user ruling requires the check to fire automatically wherever audit already runs — a new manual verb is the rejected alternative.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/audit.mjs',
          description:
            "Add the git-tier '── Check 15: stray lane worktrees ──' block after check 14: call surveyLanes(repoRoot); one finding per non-live row — severity MEDIUM for stale-run/stale-plan/stale-review/closed (a done-moment exists; message names it verbatim from row.remedy), LOW for legacy/unknown (manual inspection). Zero rows or a lanes-free consumer yields zero findings. Report-only: the check never removes anything (arc honesty rail 1) → verify: bash -c \"grep -qF 'Check 15' plugins/zeroh-roadmap/cli/commands/audit.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/audit.test.mjs',
          description:
            'Following the suite\'s caught-RED + clean-GREEN fixture pattern: a fixture repo with a dead-journal codex worktree yields the check-15 MEDIUM finding carrying the remedy text; the clean twin (no lane worktrees) yields no check-15 finding; a live-pgid lane yields none (three fixtures, real git worktrees in tmp) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'check 15\' cli/commands/audit.test.mjs && capbuild node --test cli/commands/audit.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        '`roadmap audit` on the stray-lane fixture reports each stray with class + runnable remedy at the declared severity; the clean and live fixtures report nothing for check 15 (both directions)',
        'Second audit run over the unchanged fixture reports identically (no flapping) — asserted in the test',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/audit.mjs', 'plugins/zeroh-roadmap/cli/commands/audit.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['14.2'],
      interfaces: { consumes: ['surveyLanes(root) from 14.2'], produces: [] },
      done: true,
      doneDate: '2026-08-31',
      transparencyReport: {
        whatWasDone:
          "audit.mjs gained the git-tier check 15 after check 14: it calls surveyLanes(repo) and emits one finding per NON-LIVE row — MEDIUM for stale-run/stale-plan/stale-review/closed (a done-moment exists, and the message carries that row's remedy verbatim), LOW for legacy/unknown (only inspection is honest, and the message says so rather than claiming a done-moment it cannot name). `live` is never a finding; slots and the primary are not rows at all. The survey is skipped entirely when the consumer has no .git (the shape every other fixture in that suite has), and a git repo whose worktrees cannot be enumerated yields a LOW naming the failure rather than a silent all-clear. Report-only: nothing in the block removes, prunes or deletes. The module docblock's check inventory was trued from 14 to 15.",
        how:
          "TDD: test-engineer wrote 6 cases blind to the implementation over REAL git fixture repos with real `git worktree add` lanes at the launcher's sibling path shape, real journals, and real detached process groups; 3 were RED with `(none)` findings (the audit completed and simply carried no check-15 finding), 3 GREEN-by-pairing. Suite now 67/67, exit 0, zero `not ok` lines. Live smoke: `roadmap audit --json` on this repo named the one real legacy worktree (zeroh-marketplace-roadcode) at LOW with its inspect-then-remove remedy — verdict HAS ISSUES, exit 0, nothing removed. GUARD MUTATION PROOF on check 15 (scoped runner, baseline 6/6): (1) planted violation — the non-live filter inverted so the check stops looking at strays → RED, 3 pass / 3 fail (the two stray fixtures and the stability case); (2) anchor drift — `export function surveyLanes` renamed in worktree.mjs → LOUD degrade, 0 pass / 6 fail, `SyntaxError: The requested module '../lib/worktree.mjs' does not provide an export named 'surveyLanes'`; (3) decoy — the nearest LEGAL patterns (a LIVE lane, a lane-free git repo, a non-git consumer) → GREEN 3/3. Both mutations reverted from pristine copies; `git diff` on the two paths then showed only the intended 38-line audit addition.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '14.4',
      title: 'roadmap status: stray-lane count line',
      problem:
        'status is the one command every protocol entry (plan, review, do, handoff) already runs, so it is the automatic surfacing seam — but it prints lane tables without ever counting the lanes that outlived their run.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/status.mjs',
          description:
            "After the existing lane table render: rows = surveyLanes(repo) non-live rows; when rows.length > 0 print one line `strays: <n> lane worktree(s) past their done-moment — run \\`roadmap audit\\` for each remedy` and add strayLanes: n to the --json shape; print nothing and omit the key at zero → verify: bash -c \"grep -qF 'strayLanes' plugins/zeroh-roadmap/cli/commands/status.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/status.test.mjs',
          description:
            'Two fixtures: with a dead-journal lane worktree the line and the --json strayLanes:1 appear; without one neither appears (doesNotMatch guarded by spawnSync stderr+stdout capture — the phase-11 lesson) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'strayLanes\' cli/commands/status.test.mjs && capbuild node --test cli/commands/status.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'status prints the stray count + audit pointer exactly when non-live lanes exist, in text and --json, and stays silent at zero (both directions in the suite)',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/status.mjs', 'plugins/zeroh-roadmap/cli/commands/status.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['14.2'],
      interfaces: { consumes: ['surveyLanes(root) from 14.2'], produces: [] },
      done: true,
      doneDate: '2026-08-31',
      transparencyReport: {
        whatWasDone:
          "derive() gained step 8: the count of surveyLanes(repo) rows whose class is not `live`. printHuman prints one line after the lane table — `strays: <n> lane worktree(s) past their done-moment — run `roadmap audit` for each remedy` — and the --json object carries strayLanes: <n>. At zero BOTH are absent: the line is not printed and the key is omitted, never a 0. The module docblock now names two additive divergences from the legacy oracle instead of one. The per-lane class and remedy stay with audit check 15, which this line points at rather than restating; status.mjs's pre-existing porcelain parse (sidecar correlation, step 1) is untouched — this appends to the seam, it does not fork it.",
        how:
          "TDD: test-engineer wrote 6 cases (15-20) over real git estates with real lane worktrees at the launcher's sibling path shape and real detached process groups; 4 were RED (`0 !== 1`, `undefined !== 2`, `undefined !== 1` twice) and 2 were the zero-direction guards that cannot be red before the line exists. Every absence assertion runs against stdout AND stderr combined (the phase-11 lesson the plan names). Suites after the implementation: status 19/19, status.parity 2/2, both exit 0. Live smoke on this repo: the human line reads `strays: 1` and --json carries strayLanes: 1, matching audit check 15's one real finding.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The test-engineer added a sixth case beyond the plan's two fixtures (20: a live lane BESIDE a stale one → strayLanes 1), because cases 15/18/19 are all satisfied by a naive `surveyLanes(repo).length` that never filters `live`. The plan's files[] already lists status.test.mjs, so this is extra coverage inside the task's own diff, not an added file.",
      },
    },
    {
      id: '14.5',
      title: 'codex status: next-step hint per terminal state',
      problem:
        'A dead or finished run lane prints its state and stops; recovery is operator-improvised every time (atlas: 9/9 quota deaths hand-finished; "no resume verb" complaint). The relaunch/land verbs already exist — the state read just never names them.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            "In statusCodex's final write path, append a stderr `next:` hint keyed on (lane, state): run+complete → `cd <worktree> && roadmap phase land <N>` (per phase, the lane's done-moment); run+dead-no-report → relaunch `roadmap codex run <ids…>` (the journalled RESUME RULE skips done tasks; prior report is preserved as .prev); run+blocked → read <report path> then relaunch after resolving; plan+complete → the 14.6 consume read; review handled by its existing archive. stdout JSON stays byte-identical (parsers consume it) → verify: bash -c \"grep -qF 'next:' plugins/zeroh-roadmap/cli/commands/codex.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Per terminal state (fixture journals + report files, dead pgid): the hint names the right verb and the right worktree/ids; the running state prints no hint; stdout JSON parses unchanged (assert JSON.parse succeeds and carries no `next` key) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'next-step hint\' cli/commands/codex.test.mjs && capbuild node --test cli/commands/codex.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'Each terminal state (complete / dead-no-report / blocked) prints its runnable next step on stderr; running prints none; stdout JSON is byte-compatible (tests assert both directions)',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd',
      done: false,
    },
    {
      id: '14.6',
      title: 'Plan-lane close: consume-the-plan disposes a HARVESTED plan lane',
      problem:
        'The plan lane has no done-moment: its phase file gets cherry-picked to the primary by the supervising session and the worktree+branch then squat forever (atlas-codex-plan-22). The review lane\'s ratified pattern (consume the verdict on status read → archive + dispose) is the arc-LOCKED design to mirror; disposeWorktree\'s SHA-based unpushed check cannot serve it because a cherry-pick changes SHAs — harvest is CONTENT-carried, and the plan lane\'s ONE-FILE invariant makes a content proof total.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            "Add archivePlanLane(root, jPath, journal, reportPath), called from statusCodex when lane==='plan' && state==='complete' (verdict-keyed like the review site). Guards, each a stderr refusal keeping the lane: (a) pgid groupAlive → live; (b) worktree dirty beyond untracked lane artifacts (CODEX-PLAN.md, .building/); (c) `diff --name-only <journal.base>...HEAD` (THREE-dot: merge-base diff — journal.base is a moving ref the harvest itself advances, so a two-dot tree-diff would call every sibling landing an invariant breach) ≠ exactly the one phase file → invariant breach; (d) harvested ⇔ TWO-arm blob proof (architect amendment A2 — strict byte-equality would refuse the NORMAL harvest-then-amend flow: Mode A repairs routinely edit the file after harvest): `git -C root rev-parse <integrationRefOf(config)>:<phaseFile>` blob-equals `git -C wt rev-parse HEAD:<phaseFile>` OR the lane's HEAD blob id appears among `git -C root rev-parse <sha>:<phaseFile>` over `git -C root log --format=%H <integrationRef> -- <phaseFile>` (the harvest commit carried the lane's exact bytes; a never-harvested lane or a re-plan of the number never puts that blob in the history); neither arm → NOT harvested, refusal names `git -C <root> cherry-pick <branch tip sha>` → verify: bash -c \"grep -qF 'archivePlanLane' plugins/zeroh-roadmap/cli/commands/codex.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            'On all guards passing: copy CODEX-PLAN.md to the jPath-derived archived twin (the archiveReviewLane one-shot archivedAt pattern, keyed the same way), then `git -C root worktree remove --force <wt>` + `branch -D codex-plan/<ids>` + `worktree prune`, all anchored -C root with cwd root (the METERTENANT rule), and stamp the journal in place (live name, archivedAt + archivedReport) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'consume-the-plan\' cli/commands/codex.test.mjs && capbuild node --test cli/commands/codex.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Real tmp repo + real plan worktree fixtures: (a) harvested (file cherry-picked to integration ref, byte-equal) → status read archives the plan, removes worktree AND branch; a second read still resolves the journal (live name — the archiveReviewLane pattern), serves the archived report with archivedAt stamped, and attempts no re-archive (never a "no journal covers" miss); (b) unharvested → refusal text contains the cherry-pick command and NOTHING is removed; (c) live pgid → untouched; (d) a second changed file on the branch → invariant refusal, nothing removed; (e) harvested THEN amended at the integration ref (Mode A repairs the harvested file) → still closes via the blob-history arm → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'unharvested\' cli/commands/codex.test.mjs && capbuild node --test cli/commands/codex.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'A harvested plan lane closes on the next `codex status <N> --plan` read: plan archived beside the journal, worktree and codex-plan branch gone, journal stamped (live name + archivedAt, the archiveReviewLane pattern); the re-read resolves the same journal, serves the archived report, and never re-archives or reports "no journal covers" (state coverage: second read)',
        'Unharvested, live, dirty, and invariant-breach lanes all refuse with the named reason and remedy; nothing is ever removed on a refusal (each direction has a test)',
        'The harvest proof reads committed blob ids on both sides (`git rev-parse ref:path`), never working-tree files: byte-equal at, or in the committed history of, the phase file at the integration ref',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['14.5'],
      done: false,
    },
  ],
  notes:
    'interview: skipped — arc member; scope from the MINESWEEP arc interview record (user mandate 2026-08-31) and its LOCKED decisions. ' +
    'reviewScope full (new seam surveyLanes + a disposal-adjacent write path). ' +
    'Design ruling (recorded, architect-grade): archivePlanLane does NOT route through disposeWorktree — the rail\'s orphan check is SHA-reachability and a harvest is a cherry-pick (content-carried, new SHA), so the rail would refuse every legitimate close; the plan lane\'s ONE-FILE invariant (codex.mjs plan envelope, "ONE FILE MAY CHANGE") makes the content-proof total, and guards (a)-(d) re-provide liveness+dirt safety at equal strictness. Weakening disposeWorktree with an override flag was considered and rejected (it would soften the rail for every caller). ' +
    'Out-of-scope blast radius, documented: existing stray worktrees in atlas/azure are consumer-side operator work once check 15 names them (arc DEFERRED item); slot retirement stays a held human act (isSlotDir exclusion); harness-created worktrees (Claude Code worktree isolation) carry no journal and classify legacy by design. ' +
    'Verify rehearsal attestation: red-now probes executed 2026-08-31 — grep -cF surveyLanes/archivePlanLane/"check 15" all 0 at HEAD (each step-verify red for exactly the symbol its diff adds); assumption probes executed, all exit 0 (results in assumptions); no negative greps in this phase. Review re-rehearsal (Mode A, 2026-08-31): all four assumption verifies re-run exit 0; every step verify re-run red at HEAD via its grep half — the two formerly runner-only clauses (14.1 test step, 14.6 test step) were GREEN at HEAD (both suites pass, capbuild-verified exit 0) and were re-anchored on strings their own diffs add ("keeps an unmerged branch", "unharvested" — both grep -cF 0 at HEAD), so every clause now has an achievable red. ' +
    'singleSeam-1 reading, recorded: the arc names "codex status hints" a classifier consumer; 14.5 keys hints on the one journal statusCodex already holds (plus the shared groupAlive liveness primitive) and adds NO worktree enumeration — the seam bar ("never a second worktree-enumeration parser") is met without importing surveyLanes there. status.mjs\'s pre-existing porcelain parse (sidecar correlation, line ~64) predates the seam and is untouched by 14.4, which only appends the surveyLanes-fed stray line.',
})
