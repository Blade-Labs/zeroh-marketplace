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
        'plugins/zeroh-roadmap/cli/lib/drivers.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/driver.mjs',
        'plugins/zeroh-roadmap/cli/commands/driver.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.mjs',
        'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
      ],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          "The codex entry in cli/lib/drivers.mjs gained model: 'gpt-5.6-sol' and its launch argv now PINS it (-m before -C), so the model is a command the launcher issues rather than a server-side default it hopes for; the id has exactly one home (CODEX_MODEL) shared by the field and the argv. New export driverStamp(entry) -> { model: entry.model ?? null, lane: entry.id } is the one composer of launcher attribution, and launch() in codex.mjs writes driver: driverStamp(entry) into the journal it already writes. statusCodex's journal lookup (exact name, then the .building multi-phase scan) was extracted to the exported findJournal(root, ids, lane) -> { path, journal } | null, which statusCodex now calls. gate.mjs --verify-complete reconciles through it: rooted at mainCheckout(cwd) because verify-complete runs INSIDE the codex worktree while journals live under the primary checkout, a journal-present phase file whose executionResult.driver is absent, whose model disagrees, or whose lane disagrees is exit 2 naming journal truth beside the file claim plus the journal path and startedAt; no journal (an inline session) is no check. driver.mjs gained the model-pin probe (codex debug models) with a modelListed(slug) predicate, so the declared id is PROVEN listed on this host, not asserted.",
        how:
          "TDD. The registry leg's tests were written first in cli/lib/drivers.test.mjs and ran RED (\"SyntaxError: The requested module './drivers.mjs' does not provide an export named 'driverStamp'\"); the codex/gate leg was written by test-engineer blind to the implementation and ran RED for its own reason per case (journalled model undefined vs 'gpt-5.6-sol'; \"codex.mjs must export findJournal\" 'undefined' vs 'function'; the reconcile cases 0 !== 2 with the fixture's own \"phase NNNN consistent with the latest green gate report\" on stdout proving the gate itself ran). PRIME RULE 1 was invoked before any code: the step instructs sourcing the model from the phase-2 driver-verify probe, and that probe cannot yield one — codex --version gives a CLI version, codex features list gives flags, codex doctor prints literally 'model <default> - openai', and ~/.codex/config.toml pins no model. The software-architect returned PROCEED_WITH_FIX: the model is not unknowable, it is UNDECLARED, and the launcher owns the declaration — pin -m and the journal records a command instead of a hope (singleSeam 3's 'a model self-reports only what the launcher cannot know'). It also named the same-binary probe this executor had missed, codex debug models, which satisfies freshProvenance's startsWith(bin + ' ') rail without weakening it. The pinned value is independently corroborated: five of the six most recent rollouts on this host, all source=exec (this lane's own launch mode), record \"model\":\"gpt-5.6-sol\", and ~/.codex/models_cache.json lists it priority 1 — corroboration only, deliberately NOT read at runtime, which would create a second source of truth outside the registry and a host-layout dependency. roadmap driver verify codex was re-run on this host: PASS version / capabilities / exec-smoke / model-pin. GUARD MUTATION PROOFS, three results each. The MODEL_LITERAL ratchet needle: planted violation (the literal appended to cli/commands/beacon.mjs) RED — \"model-specific launch literal outside the driver registry: cli/commands/beacon.mjs:52 ('gpt-5.6-sol')\"; anchor drift (CODEX_MODEL renamed in the registry) LOUD — \"stale needle: 'gpt-5.6-sol' no longer appears in lib/drivers.mjs — retarget this ratchet at the registry's current launch literals\"; decoy (clean tree) GREEN 11/11. The modelListed guard: four planted catalog lies each RED at exit 2 naming the model-pin probe (slug absent, supported_in_api false, slug listed twice, unparseable JSON) and the honest-catalog decoy GREEN. Verified: gate run 3 --slots types GREEN (declared-none), and 134/134 across the codex, gate, driver, drivers, status and arc suites under capbuild.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "files[] gained three entries the plan did not declare — cli/lib/drivers.test.mjs (the registry leg's own TDD tests), and cli/commands/driver.mjs + driver.test.mjs, which the architect's fix required so the declared model is verified rather than asserted. Pinning -m changes real lane runtime behaviour: if OpenAI retires the slug the codex lane now fails LOUDLY at launch instead of silently running another model while the journal asserts Sol. That is the deliberate trade and roadmap driver verify codex reds first, but no test proves it here — only a real launch against a retired slug would. The reconcile compares model and lane only; nothing checks that the journal belongs to the run that produced THESE commits beyond printing its startedAt for a human to read, so a stale journal from a superseded run of the same phase is diagnosable but not mechanically rejected. The claude entry pins no model (the harness resolves the session model), so its lane stamps model: null and the model half is announced UNRECONCILED — pinning a session model id is phase 4's roles work, not this seam's.",
      },
      done: true,
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
        'plugins/zeroh-roadmap/cli/lib/eval-score.mjs',
        'plugins/zeroh-roadmap/cli/lib/eval-score.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/eval-scorecard.test.mjs',
      ],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          "attributionWarnings(phase) landed in cli/lib/validate.mjs's warnings array, OUTSIDE the isNewToGit authoring-lint gate: a backlog phase with no plannedBy and a done phase with no executionResult.driver each draw one WARN naming the phase and carrying the single line that fixes it; historical and cancelled never warn; exit codes are untouched, so the ~700 committed phase files stay green. The engine is the only edit — bin/validate-roadmap-file.mjs and the `roadmap phase validate` face both already print result.warnings. In the same seam, the handed-off UNRECORDED_DRIVER defect was fixed: cli/lib/eval-score.mjs's sentinel was { model: 'unrecorded', lane: 'session' }, so every unattributed phase was credited to the session cohort and inflated it against the lanes that do report; it is now { model: 'unrecorded', lane: 'unrecorded' }, which parses because phase 2 opened the lane enum.",
        how:
          "TDD: test-engineer wrote six fixtures blind to the implementation and ran them RED for the right reason — \"expected exactly ONE stderr line naming 'plannedBy'; got 0. stderr: (empty)\" and the same for 'executionResult.driver' — with the four over-fire guards (stamped twin, historical, cancelled) GREEN from the start. The plan's falsification was run twice: the in-file wrong-string swap reds only at the earlier absent-output gate pre-implementation, so a second, discriminating one fed the spec'd warning line through the same assertions and REDs on the wrong expectation (expected /plannedByModel=<id>/, actual the real line) then passes corrected. The done-flip case is pinned with a COMMITTED fixture and an explicit assertGitTracked(true), so an implementation placed inside the isNewToGit gate leaves it red — that placement is the whole point of the rule, since the 715-719 drops were done-flips of files git already had. Live mutation proof outside the fixtures: plannedBy was stripped from the real roadmap/phases/phase-4.phase.ts and `roadmap phase validate` printed \"WARN phase 4: plannedBy missing — add plannedBy: { model: <your model id> }...\" while still exiting 0 and reporting OK; the file was restored (git diff clean). Three pre-existing fixtures in the grammar/description-length blocks went red because they are backlog phases with no plannedBy — the new rule firing correctly. The FIXTURE was corrected (plannedBy added to stepsPhase), never the assertion: those tests still assert their own lint is silent on a committed file, and still red if it is not. The UNRECORDED_DRIVER change reddened five pinned assertions across two suites (one deepEqual on the constant, a driverCell lookup key and its lane assertion, and two attribution expectations); each was updated to the corrected literal, and the scorecard test gained a new assertion that the session cohort holds NO unattributed phase — the inflation this fixes. Verified: gate run 3 --slots types GREEN, validate-roadmap-file 25/25, validate 6/6, phase 71/71, eval-score 55/55, eval-scorecard 46/46, eval + eval-collect 125/125.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "files[] gained the three eval-* files: the UNRECORDED_DRIVER lane fix was handed to this task by phase 2's executor to land in-seam with the validator work, and the plan's files[] predates that hand-off. The rule warns on a backlog phase missing plannedBy and a done phase missing driver, and deliberately not on a done phase missing plannedBy — the plan named those two classes and widening it here would warn on hundreds of historical done files whose planner is genuinely unrecoverable. Nothing yet warns at PLAN time (plan-phase writes the file, the write-hook prints the warning, and a planner who does not read stderr still lands an unstamped file); the mechanical catch for that is a launcher stamp, which is what task 3.4 does for the session lane. Changing the UNRECORDED_DRIVER lane re-partitions historical scorecard cohorts: any phase previously counted in the session cell now counts in an unrecorded cell, so a scorecard read from before this commit is not comparable to one after it.",
      },
      done: true,
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
