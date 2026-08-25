import { definePhase } from '@/lib/roadmap/schema'

/**
 * POLYSEAT corrective (validate-arc round 1) — the plan lane.
 *
 * Validation 2026-08-24 returned two GAPs sharing one root: no delivery path
 * hands skills/plan-phase/SKILL.md to a non-Claude driver, so no codex-planned
 * phase exists and the scorecard's planner cells hold one family. Verdicts:
 * roadmap/arc-evals/POLYSEAT-2026-08-24-verdicts.json. This phase adds the
 * third codex lane, binds the missing validationTiers key, and drives the lane
 * once on a real brief so a gpt-planned phase file lands.
 *
 * timing: no reference data for band 4-6×surface:false
 */
export default definePhase({
  phase: 8,
  name: 'Codex plan lane — deliver plan-phase by path, bind validationTiers, drive it once',
  status: 'done',
  arcId: 'POLYSEAT',
  plannedBy: { model: 'claude-fable-5' },
  category: 'feature',
  kind: 'logic',
  source:
    'validate-arc POLYSEAT round 1 — gaps any-model-full-protocol (plan half) + measure-planner-vs-executor (planner family); suggestedFix from both judges, roadmap/arc-evals/POLYSEAT-2026-08-24-verdicts.json.',
  priority: 'HIGH',
  dependsOn: [4],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
    'plugins/zeroh-roadmap/MULTI-DRIVER.md',
    'roadmap/roadmap.config.json',
  ],
  userFacing: false,
  stakeholderDemo:
    'Any registered model can now PLAN roadmap work, not just execute it — codex plans a real phase reading the same plan-phase protocol Claude reads, and the scorecard planner comparison gains its second model family.',
  assumptions: [
    {
      claim: 'No plan lane exists yet (probe 2026-08-24: LANES = {run, review}).',
      verify: 'bash -c "! grep -qF codex-plan- plugins/zeroh-roadmap/cli/commands/codex.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The deliver-by-path envelope anchor this lane copies still exists.',
      verify: 'bash -c "grep -qF \'YOUR PROTOCOL IS A FILE\' plugins/zeroh-roadmap/cli/commands/codex.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'validationTiers is absent from the consumer config (probe 2026-08-24: keys are gateCommands, modelPolicy, designHomes).',
      verify: 'bash -c "! grep -qF validationTiers roadmap/roadmap.config.json"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The plan protocol file exists to deliver.',
      verify: 'test -f plugins/zeroh-roadmap/skills/plan-phase/SKILL.md',
      onFalse: 'ESCALATE',
    },
  ],
  notes:
    "PRE-MADE DECISIONS: (1) LANES gains plan: { prefix: 'codex-plan-', report: 'CODEX-PLAN.md', journalRe: /^codex-plan-[\\d-]+\\.json$/ } — the review-lane idiom exactly; PLAN_SKILL resolves skills/plan-phase/SKILL.md beside RUN_SKILL/REVIEW_SKILL (fileURLToPath, plugin-move-safe). (2) buildPlanPrompt mirrors buildReviewPrompt: the protocol-is-a-file line, the references clause, targets, then LANE OVERRIDES ONLY — worktree discipline (the plan act edits EXACTLY roadmap/phases/phase-<N>.phase.ts plus the roadmap claim artifact; never backlog.ts, never source), commit grammar 'docs(roadmap): phase <N> — <desc>', the CODEX-PLAN.md report contract, the CODEX-RUN-(COMPLETE|BLOCKED) sentinel, and the brief: `roadmap codex plan <N> --brief <path>` requires --brief (a plan without an input is a hallucination invitation; refuse with remediation naming the flag). plannedBy: the protocol already instructs the planner to stamp its own model id; the launcher journals driver { model, lane: 'codex' } mechanically via the shared launch() — no new attribution surface. (3) Launch mechanics are SHARED (launch(), liveness guard, sentinel, status): a plan lane entry rides findJournal and statusCodex for free — singleSeam 4 (lane mechanics stay single; a new lane adds a LANES entry, never a parallel launcher). (4) Duplication guard: PLAN_PHASE_OWNED string set in codex.test.mjs sampled from plan-phase SKILL.md's protocol-owned lines (e.g. 'KNOW THE DIFF BEFORE WRITING THE TASK', 'roadmap claim', '[NEEDS CLARIFICATION]', 'ESCALATE TO ARCHITECT'); each must grep >0 in the SKILL and 0 in the generated prompt — the run-lane guard shape verbatim. (5) validationTiers binding (strict shape { command, scopedSlot?, variants?, notes? }): wired: { command: 'node plugins/zeroh-roadmap/bin/roadmap.mjs', notes: 'wired criteria drive the plugin CLI; each criterion signal names its own subcommand' }; live-ui/live-host stay unbound (no UI surface in this consumer) — absent keys are legal in ValidationTiersShape. (6) The DRIVE (task 8.4) targets the follow-up-fixes brief listed in .building/plan-brief-9.md (authored in 8.4 from the executors' surfaced items: refuseIfLive unguarded parse; summarizeGateRuns slotFilter inlet; assemblePhaseEvalRecord not copying executionResult.roles into attribution.roles; templates/example.arc.ts + scaffold-roadmap.sh collision; latestReport swallow; --slots silently ignored under --record-round/--verify-complete; worktree consumerFingerprint split). Phase 9 is CLAIMED inside 8.4 via roadmap claim before the drive. The planned phase merges back to feat/roadmap-arcs but is NOT queued by this phase — review-phase owns queueing (its Mode A pass runs after this phase completes, as with any authored plan). REVIEW RATIFICATIONS deferred to the Mode A pass. userFacing false: CLI tooling, no product surface, no flag applies. NAMED RISK: codex plan quality is unknown on first drive — the review-phase gate after is the containment; a BLOCKED sentinel or invalid phase file is an honest escalation, never retried blind.",
  completedDate: '2026-08-25',
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1278,
      total: 1278,
      notes:
        'Authoritative full gate: roadmap/.gate/8/run-000006-2026-08-25T01-46-35-386Z.json — GREEN, 1,278/1,278, run on the FINAL tree after the round-2 fixes. 18 tests added (1,260 baseline). lint, types, build and integration are declared-none in gateCommands; the lint-diff and plugin-native history-comments hygiene slots both exit 0.',
    },
    integrationTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — this CLI phase has no integration tier.',
    },
    e2eTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — no rendered surface.',
    },
    build: 'clean',
    preReview: 'clean',
  },
  gateRounds: [
    {
      round: 0,
      agent: 'quality-pass',
      verdict: 'findings-fixed',
      summary:
        'PASS. Fixed the two-lane docblocks left behind when the third lane landed (that paragraph is where the duplication guard sends readers on failure), a double read of argv for --brief, past-tense narration against the history-comments ratchet, and a dead test-helper parameter. Ratified all five additive deviations and confirmed both invariants: one LANES entry with no parallel launcher, and PLAN_PHASE_OWNED enforcing deliver-by-path on both arms. Left one real bug to the executor (the multi-lane hint concatenating flags into an unrunnable command) and one [SPECULATIVE] hard-stop it deliberately did not sweep.',
    },
    {
      round: 1,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Correctness round: 1 MEDIUM + 4 LOW. The MEDIUM was real breakage — join(root, absolutePath) yields <root>/abs, so an absolute --brief that exists refused as missing while naming a path the caller can see, and the carry-in copied from the same wrong source. Also: the existing-file guard checked the primary checkout while the worktree comes from --base; two lane flags resolved first-match-wins; a shared worktree raced the poll-hint test against the liveness guard; a stale header docblock. The reviewer independently re-ran a PLAN_PHASE_OWNED mutation proof and confirmed it reproduces the quoted message.',
    },
    {
      round: 2,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Not a clean round, and the finding that matters is that all 5 entered with the round-1 fix. repoRelative normalized only the absolute branch, so an unnormalized docs/../../out.md still escaped the checkout — the very hazard the fix was written to close, proven empirically by the reviewer. The new worktree-side guard blamed --base for a file a previous dead run had committed and prescribed burning a fresh number, which would duplicate the plan rather than harvest the commit holding it. Plus: the base check ran only after a full npm ci and left an orphan branch; a legal in-repo ..config.md refused as an escape; and a lane flag contradicting its subcommand still launched silently. All fixed. CORRECTION (owed round 3, independent reviewer, 2026-08-25): 'each mutation-proved' was FALSE for the base-side collision guard — no fixture commits a phase file on a real base ref, so its mutant stays green; the brief-is-a-FILE check is likewise unpinned. Both routed to phase 9 as same-seam gate findings with the worktree-guard misleading-remedy MEDIUM and the --brief-resolving-to-root LOW.',
    },
  ],
  metrics: {
    commits: 14,
    linesAdded: 736,
    linesRemoved: 55,
    filesChanged: 5,
    testsAtStart: 1260,
    testsAtEnd: 1278,
    testsAdded: 18,
    startedAt: '2026-08-24T23:25:33Z',
    completedAt: '2026-08-25T01:55:44Z',
    haltCount: 0,
  },
  executionResult: {
    phase: 8,
    status: 'done',
    driver: { model: 'claude-opus-5[1m]', lane: 'session' },
    roles: [
      { role: 'quality-pass', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
    ],
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      "Round 2 raised findings and its fixes (076732d) were NOT re-reviewed independently — the gate cap ended the loop there rather than have the executor self-review its own last fixes. A round 3 over 076732d + feeac94 is genuinely OWED. The two round-2 MEDIUMs both entered with a fix round, which is the concrete argument for running it.",
      "quality-pass raised a [SPECULATIVE] hard-stop it deliberately did not sweep: runCodex/reviewCodex/planCodex now repeat the same four-line preamble (--worktree/--base index parse, mkdirSync('.building'), journalPath), and the default worktree is derivable from the LANES table. A laneSetup(root, ids, lane, argv) would make a fourth lane a pure table entry. Not swept because the default base differs per lane (develop vs HEAD) and several factorings are equally valid — it wants a planned task.",
      'Phase 9 (roadmap/phases/phase-9.phase.ts, cherry-picked as 76d578c) is on this branch but deliberately NOT queued and carries NO review: the plan lane disables the protocol closing review pass, and CODEX-PLAN.md self-reports zero role firings. review-phase Mode A owns both the review and the queueing. Its plan QUALITY is unjudged by this phase, by design (the phase named that as its risk); the claim made here is only that it is schema-valid, 7 bounded tasks, 0 clarification markers, plannedBy gpt-5.6-sol.',
      'The lane worktree /home/patrik/zeroh-marketplace-codex-plan-9 and branch codex-plan/9 are left in place so CODEX-PLAN.md (never committed, per the lane contract) survives as evidence of the drive. They need cleanup at arc landing.',
      "The round-2 summary recorded into gate report run-000002 cites the fix commit as 30fd0f0; the real sha is 076732d. The rounds were re-recorded correctly into the authoritative run-000006 report, and this phase file's gateRounds carry the accurate narrative — the stale run-000002 copy is superseded, not authoritative.",
      "The reviewer noted a residual symlink case in repoRelative: a repo-committed symlink pointing outside the checkout could still route the carry-in write outside the worktree. Judged out of threat model for a self-use CLI over one's own checkout, and recorded rather than silently accepted.",
    ],
    hardStops: [],
    gateRounds: 3,
  },
  tasks: [
    {
      id: '8.1',
      title: 'The plan lane — LANES entry, PLAN_SKILL, buildPlanPrompt, --brief door',
      problem:
        'skills/plan-phase/SKILL.md is delivered to no driver: LANES = {run, review} only, so a non-Claude model structurally cannot plan a phase — the exact privilege criterion any-model-full-protocol forbids.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            "Add the plan LANES entry, PLAN_SKILL constant, buildPlanPrompt (per notes decisions 1-2), and the `plan <N> --brief <path>` subcommand wired through the SHARED launch()/liveness/status mechanics; missing --brief refuses with remediation naming the flag → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Pin: the plan journal carries driver { model, lane } on the fake-codex path; the generated plan prompt hands PLAN_SKILL by path; missing --brief refuses; findJournal resolves the codex-plan- prefix → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'roadmap codex plan <N> --brief <path> launches with a journal stamped by the launcher; the prompt contains the plan-phase SKILL path and no protocol body; --brief is mandatory with a named refusal',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/codex.mjs',
        'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
      ],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          "The plan lane: LANES.plan = { prefix 'codex-plan-', report 'CODEX-PLAN.md', journalRe /^codex-plan-[\\d-]+\\.json$/ }, a PLAN_SKILL constant beside RUN_SKILL/REVIEW_SKILL, buildPlanPrompt, and `roadmap codex plan <N> --brief <path>` wired through the shared launch()/refuseIfLive/findJournal/statusCodex mechanics. --brief is mandatory. 10 tests added.",
        how:
          'TDD: the plan-lane tests were appended and run FIRST — 8 red on `roadmap codex: usage:` (no plan subcommand) against 27 pre-existing green; the implementation turned them green, 36/36. buildPlanPrompt mirrors buildReviewPrompt: protocol-is-a-file line, references clause, target, then LANE OVERRIDES ONLY (worktree discipline, the one-file rule naming roadmap/backlog.ts, the docs(roadmap) commit grammar, the CODEX-PLAN.md report contract, the sentinel, the plannedBy stamp, the role-resolver bullet, NO REACHABLE USER). The missing-flag refusal throws before any worktree work, naming the flag and printing the re-run command. Verify: `capbuild node --test cli/commands/codex.test.mjs` → 36 pass / 0 fail.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "Four additive deviations, none narrowing the criterion: (a) LANES entries gained `flag` (run null, review '--review', plan '--plan') and the lane selector derives from that table instead of a hardcoded --review ternary, so adding a lane stays one entry; (b) statusCodex's `!found` branch now names the lane whose journal DOES cover the ids plus the exact flag — `roadmap codex status 9` on a plan journal otherwise reported 'no run journal covers' over a journal sitting right there; (c) the worktree setup common to run (branch + npm ci) and review (--detach, no install) was extracted to ensureWorktree and the --doc carry-in to carryIn, because the plan act BOTH commits and validates through the consumer's tsx — the alternative was a third copy-pasted setup; (d) an extra guard + test refuses planning onto a number whose phase file already exists, since this lane authors a freshly reserved number and would otherwise clobber a real plan. The lane is machinery only until task 8.4 fires it.",
      },
      done: true,
    },
    {
      id: '8.2',
      title: 'PLAN_PHASE_OWNED duplication guard',
      problem:
        'Without the guard the plan lane can silently regrow a paraphrased protocol — the drift the run lane paid off in 4.2.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            "PLAN_PHASE_OWNED set per notes decision 4: each string greps >0 in skills/plan-phase/SKILL.md and 0 in the generated plan prompt; a set member absent from the SKILL fails loudly (anchor drift is loud, not green) → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs",
        },
      ],
      acceptanceCriteria: [
        'The guard reds when a protocol-owned string is planted into buildPlanPrompt (mutation proof quoted in the transparencyReport) and stays green as shipped',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          'PLAN_PHASE_OWNED — 9 strings plan-phase/SKILL.md owns (the two prime-rule headlines, PROCEED_WITH_TASK, the number-reservation command, the clarification marker, the validate step, the timing-stats citation, and both references/ siblings) — each asserted >0 in the SKILL and 0 in the generated plan prompt.',
        how:
          "The run lane's guard shape verbatim, including its precondition half: a set member absent from the SKILL fails LOUDLY rather than passing on nothing. Anchors were chosen by grepping the SKILL for protocol-BODY lines the envelope has no business restating; the docblock records why each is owned and lists the lane material asserted present by the sibling overrides test.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'MUTATION PROOF, both directions, reverted after each. (A) planting `PRIME RULE 1: KNOW THE DIFF BEFORE WRITING THE TASK ...` into buildPlanPrompt reds the guard: `"KNOW THE DIFF BEFORE WRITING THE TASK" belongs to skills/plan-phase/SKILL.md — the plan prompt restating it forks the protocol and makes the eval scorecard\'s planner cells compare briefings rather than models; fix cli/commands/codex.mjs buildPlanPrompt`. (B) appending an anchor the SKILL does not carry reds the precondition arm instead, so drift is loud rather than silently green. (C) DECOY, driven after the task commit and quoted here: a lane line brushing every anchor in its nearest LEGAL wording (\'Your number was reserved by the launcher, so there is nothing to claim; a clarification you cannot resolve ends the run; validate before you commit; cite the timing cohort the protocol names.\') stays GREEN — the guard keys on the owned strings, not on their subject matter, so it will not cry wolf on lawful lane material. As shipped: 37 pass / 0 fail (39 after the two 8.4 fixes).',
      },
      done: true,
    },
    {
      id: '8.3',
      title: 'MULTI-DRIVER plan-lane line + validationTiers binding',
      problem:
        "The lane table documents run/review only, and the consumer config binds no validation tier — every judge this arc ran had to fall back to the criterion's own named commands.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/MULTI-DRIVER.md',
          description:
            "One line in the lane row of the glossary + the §2 lane list: plan delivers skills/plan-phase/SKILL.md, report CODEX-PLAN.md — operative statement only, budget-neutral (MULTI-DRIVER.md is outside the do-arc measured set; confirm with roadmap measure --flow do-arc unchanged) → verify: bash -c \"grep -qF 'CODEX-PLAN.md' plugins/zeroh-roadmap/MULTI-DRIVER.md\"",
        },
        {
          file: 'roadmap/roadmap.config.json',
          description:
            'Add validationTiers per notes decision 5 (wired bound to the plugin CLI, notes clause; live tiers stay absent) → verify: bash -c "node plugins/zeroh-roadmap/bin/roadmap.mjs status >/dev/null"',
        },
      ],
      acceptanceCriteria: [
        'Config strict-parses with the new key (roadmap status exits 0); MULTI-DRIVER names the plan lane; do-arc measured set unchanged at 13256',
      ],
      files: ['plugins/zeroh-roadmap/MULTI-DRIVER.md', 'roadmap/roadmap.config.json'],
      testMode: 'none',
      transparencyReport: {
        whatWasDone:
          "MULTI-DRIVER.md: the glossary lane row now reads `run` / `plan` / `review`, and one paragraph names what each mission delivers and hands off (plan → skills/plan-phase, CODEX-PLAN.md, --brief required). roadmap.config.json gained validationTiers.wired bound to `node plugins/zeroh-roadmap/bin/roadmap.mjs`, with live-ui / live-host deliberately absent.",
        how:
          'Operative statements only, no dated archeology, one rationale clause ("a fourth mission is one LANES entry, never a second launcher"). Verifies: `grep -qF CODEX-PLAN.md plugins/zeroh-roadmap/MULTI-DRIVER.md` exit 0; `roadmap status` exit 0 (the config strict-parses with the new key against ValidationTiersShape, where absent tier keys are legal).',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The binding is live, not decorative: agents/intent-validator.md resolves a criterion's tier through this key and reports a gap naming the missing binding when it is absent — which is what every judge in this arc's round 1 had to do. Budget: `roadmap measure --flow do-arc` reads 13253 tokens over the same 8 files before and after; both files touched here are outside the measured set. (The phase text says 13256 — the measured figure on this tree is 13253; the criterion that matters, UNCHANGED, holds.)",
      },
      done: true,
    },
    {
      id: '8.4',
      title: 'Drive the lane once — codex plans the follow-up-fixes phase for real',
      problem:
        "Machinery without a firing record is exactly what the criteria refuse: the planned-phase artifact (plannedBy gpt family, schema-valid) must exist on disk before the re-judge.",
      steps: [
        {
          file: 'roadmap/phases/phase-8.phase.ts',
          description:
            'Claim the next number via roadmap claim (expected 9); author .building/plan-brief-9.md from the surfaced follow-up list in notes decision 6 (each item one line: symptom + file + why it matters); record the claimed number in the transparencyReport → verify: test -f .building/plan-brief-9.md',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            'Run roadmap codex plan 9 --brief .building/plan-brief-9.md --base feat/roadmap-arcs; poll roadmap codex status 9; on COMPLETE, verify in the lane worktree: the phase file exists, roadmap phase validate 9 exits 0, plannedBy carries a gpt-family model id, and the journal driver stamp agrees; merge the single docs commit back to feat/roadmap-arcs (do NOT queue phase 9 — review-phase owns that); a BLOCKED sentinel or invalid file → escalate with the log path, never a blind retry → verify: bash -c "node plugins/zeroh-roadmap/bin/roadmap.mjs phase validate 9"',
        },
      ],
      acceptanceCriteria: [
        "A real codex plan run completed: journal + CODEX-PLAN.md + a schema-valid roadmap/phases/phase-9.phase.ts on feat/roadmap-arcs with plannedBy { model: 'gpt-5.6-sol' } (or the registry's pinned gpt id), produced from the same plan-phase SKILL.md Claude reads",
      ],
      files: ['roadmap/phases/phase-8.phase.ts'],
      batchMode: true,
      testMode: 'none',
      transparencyReport: {
        whatWasDone:
          "`roadmap claim` returned 9; .building/plan-brief-9.md was authored from the seven surfaced follow-ups (each probed against the real code first, so the brief states symptom + file + why it matters rather than a remembered summary); `roadmap codex plan 9 --brief .building/plan-brief-9.md --base feat/roadmap-arcs` was launched ONCE and reached CODEX-RUN-COMPLETE. roadmap/phases/phase-9.phase.ts is on feat/roadmap-arcs (cherry-pick 09e8682 → 09e8682's content, 287 lines, 7 tasks).",
        how:
          "Verified before merging anything back: exactly ONE commit on codex-plan/9 touching exactly ONE file; `roadmap phase validate 9` OK in the lane worktree and again on feat/roadmap-arcs; plannedBy { model: 'gpt-5.6-sol' } agrees with the launcher's journal driver { model: 'gpt-5.6-sol', lane: 'codex' } (the registry pin, not a self-report); 0 [NEEDS CLARIFICATION] markers; roadmap/backlog.ts untouched. Phase 9 is deliberately NOT queued — review-phase Mode A owns that. Journal .building/codex-plan-9.json, log .building/codex-plan-9.log, report /home/patrik/zeroh-marketplace-codex-plan-9/CODEX-PLAN.md (uncommitted, as the contract requires); the lane worktree is left in place so that evidence survives.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The drive found two real defects in the 8.1 lane, both fixed under this phase with mutation-proved tests rather than deferred: launch()'s poll hint still chose run-vs-review by a hardcoded ternary, so the plan lane printed the RUN-lane poll for a live plan journal; and statusCodex spread the journal LAST into its output, so `j.report` (a bare filename) overwrote the resolved report path AND the deliberate null that marks a stale report — wrong for every lane whose journal carries `report`, not just the new one. CODEX-PLAN.md self-reports 'Role firings: None' — the planner filled no protocol role and represented no review as having run; its own independent-review step was disabled by the lane, so phase 9 carries NO review yet and must not be queued until review-phase Mode A runs. Plan QUALITY is unjudged here by design (the phase's named risk): schema-valid, 7 bounded tasks, 0 markers is the whole claim.",
      },
      done: true,
    },
  ],
})
