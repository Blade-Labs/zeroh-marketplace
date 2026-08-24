import { definePhase } from '@/lib/roadmap/schema'

/**
 * POLYSEAT plane 3 of 4 — mechanical attribution.
 *
 * Attribution today is model self-report, and it drops silently: measured in
 * mudarabah2 on 2026-08-23, 12/702 phases carry executionResult.driver and
 * 7/702 carry plannedBy — five consecutive recent phases (715–719) are blank.
 * The launcher KNOWS what it launched; asking the model to remember to write
 * it is why the planner column of the scorecard is empty by construction.
 *
 * Two mechanical seams: the codex lanes journal the registry driver at launch
 * and reconcile it against the landed phase file; the validator WARNS by name
 * on missing attribution (never REDs — 700 historical files stay green).
 * Plus the additive roles[] shape phase 4 will populate.
 */
export default definePhase({
  phase: 3,
  name: 'Mechanical attribution — launcher stamps, validator warns, roles shape lands',
  status: 'in-progress',
  arcId: 'POLYSEAT',
  plannedBy: { model: 'claude-opus-5[1m]' },
  category: 'feature',
  kind: 'logic',
  source:
    'Arc POLYSEAT plane 3 — designRef MULTI-DRIVER.md (attribution); rationale in roadmap/arc-prompts/POLYSEAT-execution-prompt.md.',
  priority: 'MEDIUM',
  dependsOn: [2],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.mjs',
    'plugins/zeroh-roadmap/cli/lib/validate.mjs',
    'plugins/zeroh-roadmap/templates/schema.ts',
    'lib/roadmap/schema.ts',
    'plugins/zeroh-roadmap/cli/lib/executor-arm.mjs',
    'plugins/zeroh-roadmap/cli/commands/result.mjs',
    'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
  ],
  stakeholderDemo:
    'Who planned and who executed every phase is recorded by the machinery that launched the work — a missing attribution is a named warning at validate time instead of a silent hole in the model comparison.',
  assumptions: [
    {
      claim:
        'The codex-lane journal still carries no driver identity (the launch writes phases/lane/worktree/pgid, no model). The word driver DOES appear in codex.mjs prose (header + buildPrompt), so the probe is scoped to the journal-literal line.',
      verify:
        "bash -c \"grep -qF 'pgid: child.pid' plugins/zeroh-roadmap/cli/commands/codex.mjs && ! grep -F 'pgid: child.pid' plugins/zeroh-roadmap/cli/commands/codex.mjs | grep -qF driver\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'executionResult carries no roles field yet — the addition is genuinely additive.',
      verify:
        "bash -c \"! grep -qF 'roles' plugins/zeroh-roadmap/templates/schema.ts\"",
      onFalse: 'ESCALATE',
    },
  ],
  notes:
    "DESIGN (locked): stamping is mechanical WHERE A LAUNCHER EXISTS, a named warning where not. (a) Codex lanes: launch() adds driver { model, lane } from the phase-2 registry entry to the journal it already writes; statusCodex SURFACES it for free (its JSON spreads the journal); the `gate run --verify-complete` path RECONCILES, resolving the primary checkout via mainCheckout() because it runs inside the codex worktree — a landed phase file whose executionResult.driver is absent or disagrees while a run-lane journal exists is an ERROR naming both values (the journal is launcher truth; the file is model self-report; disagreement means one of them lies). (b) Claude-inline sessions have no launcher chokepoint — plan-phase/do-phase skills already instruct plannedBy/driver; the validator warning (3.2) is the mechanical catch for forgotten stamps, which is exactly how 715–719 would have been caught. (c) executionResult.roles?: [{ role, model, via: 'native'|'child-cli'|'inline', substituted?: { from, to, reason } }] lands ADDITIVE in templates/schema.ts now so phase 4's resolver has a recording target and the schema ships once — the same land-the-shape-early pattern the assumptions field used (its docblock records phase 1372 authored the behaviour later).\n\nWARNING SEVERITIES (never RED): backlog phase missing plannedBy → warn naming the file and the one-line fix; done phase missing executionResult.driver → warn; done phase whose driver.lane is unknown to the registry → the phase-2 warning already covers it. Warnings ride the existing result.warnings channel — COMPUTED in cli/lib/validate.mjs (the engine; bin/validate-roadmap-file.mjs and the `roadmap phase validate` face both already print result.warnings), placed OUTSIDE the isNewToGit authoring-lint gate so a done-flip of an existing file still warns — exit codes unchanged, honoring the 700-historical-files reality.\n\nREVIEW RATIFICATIONS (Mode A, 2026-08-23): testMode tdd ratified on all three tasks (each step's verify is a test-file tripwire the task itself authors); no testScope/reviewScope relaxations declared; userFacing n/a (CLI + schema only).\n\nSESSION-LANE RECONCILE (task 3.4 — operator ruling 2026-08-23, root-caused LIVE during this arc's own phase-1 spawn): the do-arc orchestrator wrote driver.model claude-fable-5 into an opus-card executor's spawn prompt — a spawner-asserted identity overrides the executor's self-knowledge, and NO planned gate catches a session-lane WRONG stamp (result check is shape-only with driver optional; 3.1 is journal-gated; 3.2 catches absence only). Fix shape = 3.1 repeated on the session lane: the arm file (the session lane's launch journal, already written pre-spawn at the chokepoint) records the REQUESTED alias read from the agent card; result check reconciles the executor's self-stamp against it by family prefix. The spawner NEVER asserts a model id — singleSeam 3's carve-out ('a model self-reports only what the launcher cannot know') applies because the harness resolves the card alias silently: the executor's own context is the only exact-id evidence.",
  tasks: [
    {
      id: '3.1',
      title: 'The codex lanes journal their driver and reconcile it at landing',
      problem:
        'The journal records phases/worktree/pgid but not WHO ran — so lane-executed work depends on the model remembering to self-report the very identity the launcher already knows.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            "launch() writes driver: { model, lane } into the journal from resolveDriver('codex'). Phase 2's landed entry schema ({ id, family, bin, launch, resume, roleCapabilities, verifiedAt }) declares NO model id — add the declared model binding to the codex entry (additive, drivers.mjs, sourced from the driver-verify probe); unknowable = ESCALATE, never a journaled guess (honesty rail 2). statusCodex needs no surface change (its JSON spreads ...j). Extract statusCodex's journal lookup (exact path, then the multi-phase .building scan) into an exported findJournal(root, ids, lane) it now calls → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            "In the --verify-complete path: locate the RUN-lane journal via findJournal (step 1) rooted at mainCheckout(cwd) from cli/lib/gitroot.mjs — verify-complete runs INSIDE the codex worktree (buildPrompt's own instruction) while journals live under the PRIMARY checkout's .building/, where gitToplevel alone never looks. Journal present: file executionResult.driver ABSENT or DISAGREEING is a named error carrying both values plus the journal path and startedAt (journal = launcher truth; a stale journal from a superseded run is diagnosable by its date). No journal = no check (inline sessions) → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Journal-carries-driver pinned on the fake-codex launch path; findJournal pins the exact-name and multi-phase-scan cases (the statusCodex behavior, now shared) → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
          description:
            'Reconciliation fixtures: a phase file claiming a different model reds with both values named; agreement passes; driver absent WITH a journal present reds; no journal passes silently; the journal is found from a linked-worktree cwd (fixture via git worktree add) → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'A lane launch journals { model, lane } read from the registry, asserted on the fake-codex path',
        'verify-complete reds a driver mismatch AND a journal-present absent driver, naming journal truth vs file claim, passes agreement, and resolves the journal from inside the codex worktree (mainCheckout)',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/codex.mjs',
        'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.mjs',
        'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
    },
    {
      id: '3.2',
      title: 'The validator names every attribution hole',
      problem:
        'Nothing catches a forgotten plannedBy or driver stamp — the 715–719 five-in-a-row silent drop. A named warning at validate time is the cheapest possible catch and REDs nothing historical.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/validate.mjs',
          description:
            "Compute both warnings in validateRoadmapFile — the engine (bin/validate-roadmap-file.mjs and `roadmap phase validate` both already print result.warnings, no edit there) — OUTSIDE the isNewToGit-gated authoring-lint block: a done-flip edits an EXISTING file, so a warning inside that gate never fires for the 715–719 case. backlog status missing plannedBy → 'phase N: plannedBy missing — add plannedBy: { model: <your model id> }'; done status missing executionResult.driver → equivalent line naming the field; historical/cancelled never warn → verify: capbuild node --test plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs',
          description:
            'A backlog fixture without plannedBy warns and exits as before; WITH plannedBy stays silent; a historical-status fixture never warns (grandfathered); falsify by asserting the warning text against a deliberately wrong expected string first (RED), then correct → verify: capbuild node --test plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'Both warning classes fire with copy-pasteable one-line fixes; historical phases never warn',
        'Exit codes are byte-identical to before on every fixture — warnings only',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/validate.mjs',
        'plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
    },
    {
      id: '3.3',
      title: 'executionResult.roles lands additive, ready for the resolver',
      problem:
        "Phase 4's role resolver needs a recording target for { role, model, via, substituted } — landing the shape with the schema-sync discipline now means the schema ships once and phase 4 is purely behavioural.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            "Add roles?: array of { role, model, via: z.enum(['native','child-cli','inline']), substituted?: { from, to, reason } } to PhaseExecutionResultShape, optional-additive with a docblock naming phase 4 as the writer (the assumptions-field precedent) and noting resolveRole's `mode` return is what gets recorded as `via` (same enum, phase 4's notes); byte-sync lib/roadmap/schema.ts → verify: cd plugins/zeroh-roadmap && capbuild npx tsx scripts/schema.test.ts",
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/schema.test.ts',
          description:
            'The three roles cases on PhaseExecutionResultShape (today it has ZERO roles coverage, so the step-1 verify would be vacuous without this): a roles array parses; via outside the three modes fails naming the enum; roles absent parses unchanged → verify: cd plugins/zeroh-roadmap && capbuild npx tsx scripts/schema.test.ts',
        },
      ],
      acceptanceCriteria: [
        'A phase file with a roles array parses; one with via outside the three modes fails with the enum error; files without roles parse unchanged',
      ],
      files: [
        'plugins/zeroh-roadmap/templates/schema.ts',
        'lib/roadmap/schema.ts',
        'plugins/zeroh-roadmap/scripts/schema.test.ts',
      ],
      testMode: 'tdd',
      done: false,
    },
    {
      id: '3.4',
      title: 'The session lane reconciles the executor stamp against the armed card alias',
      problem:
        "A spawner-asserted model id in a spawn prompt overrides the executor's self-knowledge unchecked: on 2026-08-23 the POLYSEAT orchestrator instructed an opus-card phase-executor to stamp driver.model claude-fable-5, and nothing would have caught it — result check validates shape only, 3.1's reconcile is journal-gated (codex lane), 3.2 warns only on ABSENT attribution. The arm file is the session lane's launch journal; it must carry what the launcher requested so the return can be reconciled.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/executor-arm.mjs',
          description:
            "armExecutor gains optional expectedModelAlias, recorded additively in the arm JSON ({ sessionId, executorId, expectedModelAlias, armedAt }); the executor-arm command reads the alias MECHANICALLY from the phase-executor agent card's frontmatter model: line (default: agents/phase-executor.md resolved beside the plugin CLI; --agent-card <path> overrides; no card / no model line = field absent, never guessed) and prints what it recorded. detectArm/staleArms/liveArm semantics untouched \u2192 verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/executor-arm.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/result.mjs',
          description:
            "After a valid parse with --phase N: read .building/<N>-executor.armed; a recorded expectedModelAlias reconciles against parsed driver.model via the family map { fable: 'claude-fable', opus: 'claude-opus', sonnet: 'claude-sonnet', haiku: 'claude-haiku' } (prefix match). Mismatch \u2192 exit 2 naming armed alias (launcher truth of the request) vs driver.model (executor self-report) plus the arm path; driver ABSENT under a recorded alias \u2192 exit 2 (the session-lane analog of 3.1's journal-present-absent-driver error); alias 'inherit' or outside the map \u2192 a NAMED skip line on stderr, exit unchanged (loud, never red on an unmappable alias); no arm / no recorded alias \u2192 behavior byte-identical to today \u2192 verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/result.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
          description:
            "The mid-band spawn step gains the prohibition + mechanism in two sentences: the spawn prompt NEVER asserts the executor's model id (the executor stamps its own exact id from its harness context; the launcher records lane and the requested card alias via executor-arm), and result check reconciles the two \u2014 cite the 2026-08-23 fable-for-opus near-miss \u2192 verify: bash -c \"grep -qF 'NEVER asserts the executor' plugins/zeroh-roadmap/skills/do-arc/SKILL.md\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/result.test.mjs',
          description:
            "Fixtures: the PLANTED 2026-08-23 defect (armed alias opus, returned driver.model claude-fable-5) reds naming both values; agreement (opus / claude-opus-5) passes; driver absent under a recorded alias reds; alias 'inherit' prints the named skip and passes; no arm passes byte-identical; arm-alias recording pinned in executor-arm.test.mjs (card parsed; missing card = absent field). Guard-mutation-proof: the planted-defect fixture IS the quoted RED \u2192 verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/result.test.mjs",
        },
      ],
      acceptanceCriteria: [
        'The arm records the requested model alias read from the agent card, and result check reds a family mismatch AND a driver absent under a recorded alias, naming armed alias vs returned driver.model plus the arm path; agreement, inherit, and no-arm paths stay green',
        "The planted 2026-08-23 defect (armed 'opus', returned 'claude-fable-5') is RED in the fixture suite, quoted in the transparencyReport; do-arc SKILL.md forbids spawner-asserted model ids",
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/executor-arm.mjs',
        'plugins/zeroh-roadmap/cli/lib/executor-arm.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/result.mjs',
        'plugins/zeroh-roadmap/cli/commands/result.test.mjs',
        'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
      ],
      testMode: 'tdd',
      done: false,
    },
  ],
})
