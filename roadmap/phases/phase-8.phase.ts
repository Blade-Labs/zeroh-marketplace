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
  status: 'in-progress',
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
          'MUTATION PROOF, both directions, reverted after each. (A) planting `PRIME RULE 1: KNOW THE DIFF BEFORE WRITING THE TASK ...` into buildPlanPrompt reds the guard: `"KNOW THE DIFF BEFORE WRITING THE TASK" belongs to skills/plan-phase/SKILL.md — the plan prompt restating it forks the protocol and makes the eval scorecard\'s planner cells compare briefings rather than models; fix cli/commands/codex.mjs buildPlanPrompt`. (B) appending an anchor the SKILL does not carry reds the precondition arm instead, so drift is loud rather than silently green. As shipped: 37 pass / 0 fail.',
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
      done: false,
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
      done: false,
    },
  ],
})
