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
  status: 'backlog',
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
    "DESIGN (locked): stamping is mechanical WHERE A LAUNCHER EXISTS, a named warning where not. (a) Codex lanes: launch() adds driver { model, lane } from the phase-2 registry entry to the journal it already writes; statusCodex SURFACES it for free (its JSON spreads the journal); the `gate run --verify-complete` path RECONCILES, resolving the primary checkout via mainCheckout() because it runs inside the codex worktree — a landed phase file whose executionResult.driver is absent or disagrees while a run-lane journal exists is an ERROR naming both values (the journal is launcher truth; the file is model self-report; disagreement means one of them lies). (b) Claude-inline sessions have no launcher chokepoint — plan-phase/do-phase skills already instruct plannedBy/driver; the validator warning (3.2) is the mechanical catch for forgotten stamps, which is exactly how 715–719 would have been caught. (c) executionResult.roles?: [{ role, model, via: 'native'|'child-cli'|'inline', substituted?: { from, to, reason } }] lands ADDITIVE in templates/schema.ts now so phase 4's resolver has a recording target and the schema ships once — the same land-the-shape-early pattern the assumptions field used (its docblock records phase 1372 authored the behaviour later).\n\nWARNING SEVERITIES (never RED): backlog phase missing plannedBy → warn naming the file and the one-line fix; done phase missing executionResult.driver → warn; done phase whose driver.lane is unknown to the registry → the phase-2 warning already covers it. Warnings ride the existing result.warnings channel — COMPUTED in cli/lib/validate.mjs (the engine; bin/validate-roadmap-file.mjs and the `roadmap phase validate` face both already print result.warnings), placed OUTSIDE the isNewToGit authoring-lint gate so a done-flip of an existing file still warns — exit codes unchanged, honoring the 700-historical-files reality.\n\nREVIEW RATIFICATIONS (Mode A, 2026-08-23): testMode tdd ratified on all three tasks (each step's verify is a test-file tripwire the task itself authors); no testScope/reviewScope relaxations declared; userFacing n/a (CLI + schema only).",
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
  ],
})
