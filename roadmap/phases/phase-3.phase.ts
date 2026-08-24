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
  status: 'done',
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
      transparencyReport: {
        whatWasDone:
          "PhaseExecutionResultShape gained roles?: Array<{ role, model, via: 'native'|'child-cli'|'inline', substituted?: { from, to, reason } }>, optional and additive, directly under driver. Its docblock states the operative rules only: plane 4's resolver is the writer, `via` records that resolver's `mode` return so an inline fulfillment is never indistinguishable from a native one, substituted names who was asked / who answered / why, and optional means absent is distinguishable from zero bindings recorded. lib/roadmap/schema.ts was byte-synced from templates/schema.ts (diff -q exit 0 both before and after).",
        how:
          "TDD: test-engineer wrote four checks in scripts/schema.test.ts blind to the implementation and ran them RED for the right reason — the sharpest being \"PhaseExecutionResultShape declares no `roles` key (declared: phase, status, driver, checkpoint, escalation, compromises, skipped, hardcoded, surfaced, hardStops, gateRounds) — an absent roles is then indistinguishable from a stripped unknown key and this case would pass vacuously\", which is the real hazard here: the shape is a plain z.object, so it STRIPS unknown keys and a naive absence assertion would have been green before the field existed. It then falsified all four against a throwaway copy of the schema (never the real file, deleted after): the field exactly as specified turns every check green, and five one-at-a-time mutations each red exactly one check — via: z.string() reds only the enum case, .default([]) instead of .optional() reds only the absent case, role made optional reds only the half-filled case, dropping substituted reds only the round-trip case, and replacing the enum with an anonymous refine reds the enum case specifically on its NAMING leg (\"the rejection must NAME the enum\"), which is what stops that case degenerating into 'any error will do'. Verified after landing: the four roles checks ok and the whole schema suite PASS — 0 failure(s); gate run 3 --slots types GREEN; result.test.mjs 9/9, which matters because `roadmap result check` parses through the CONSUMER's copy — proof the byte-sync is real and not just diff-clean.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The shape is landed but nothing WRITES it yet, so nothing proves the field is the right shape for the resolver — only that it parses what plane 4 says it will produce. That is the deliberate cost of landing the schema early, and the risk is that plane 4 discovers it needs a fifth field and pays a second schema edit anyway. Consumers other than this repo (azure_private_agent, mudarabah2, viki-agent) pick the widened shape up at their next plugin bump; they are named here, not chased. The plan wrote the criterion as three cases; a fourth (a binding missing role/model/via rejects) was added because a recording target that accepts a half-filled binding records nothing — it widens coverage and narrows nothing.",
      },
      done: true,
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
        'plugins/zeroh-roadmap/cli/commands/executor-arm.mjs',
        'plugins/zeroh-roadmap/cli/commands/executor-arm-disarm.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/result.mjs',
        'plugins/zeroh-roadmap/cli/commands/result.test.mjs',
        'plugins/zeroh-roadmap/bin/roadmap.mjs',
        'plugins/zeroh-roadmap/workflows/arc-plane.workflow.mjs',
        'plugins/zeroh-roadmap/test/fixture-consumer/arc-next.test.mjs',
        'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
      ],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          "armExecutor gained an optional expectedModelAlias, recorded additively as { sessionId, executorId?, expectedModelAlias?, armedAt } — an empty alias records nothing, and the alias is deliberately NOT an exclusivity axis, so a re-arm may change it without refusing. The executor-arm COMMAND reads that alias mechanically from the agent card's frontmatter model: line (default agents/phase-executor.md resolved beside the plugin CLI; --agent-card <path> overrides; no card or no frontmatter key = absent, never guessed) and prints what it recorded or that it recorded nothing. result.mjs reconciles after a valid parse with --phase N: the arm's alias maps through ALIAS_FAMILY { fable, opus, sonnet, haiku } to a model-id prefix; a returned driver.model of another family is exit 2 naming armed alias, returned id and arm path, a driver ABSENT under a recorded alias is exit 2, an unmappable alias (inherit, or anything not in the map) is a NAMED skip at unchanged exit, and no arm / no recorded alias is byte-identical to before. do-arc's spawn step now states the prohibition; the bin TREE row carries --agent-card.",
        how:
          "TDD across three seams: 42 lib cases, 15 command cases, 21 result cases, written blind and RED first. THE PLANTED 2026-08-23 DEFECT, quoted verbatim as criterion 2 requires: \"not ok 10 - result check — THE PLANTED 2026-08-23 DEFECT: armed 'opus', returned 'claude-fable-5' => exit 2 naming both sides ... error: a spawner-asserted model id must not survive the return; stdout: {\\\"phase\\\":9001,...,\\\"driver\\\":{\\\"model\\\":\\\"claude-fable-5\\\",\\\"lane\\\":\\\"session\\\"},...} stderr: (empty) 0 !== 2\" — that RED output IS the defect: the fable-for-opus stamp echoed back, stderr empty, exit 0. The card parse is frontmatter-BOUNDED and line-anchored, pinned by two tests a first-match-anywhere grep would fail: a card whose prose discusses model: below the fence (the real arc-eval-judge.md shape, which says model: sonnet on three lines), and a card whose frontmatter description: value quotes the token model: claude-fable-5 BEFORE the real declaration. LIVE mutation proof on this executor's OWN arm rather than a fixture — the arm was re-armed and recorded expectedModelAlias 'opus' from the real card, then: this executor's honest id claude-opus-5[1m] exits 0 SILENTLY (the decoy — prefix matching must accept a suffixed real-world id); claude-fable-5 exits 2 with \"driver.model 'claude-fable-5' is not of the family the launcher requested — the arm records alias 'opus' (family 'claude-opus-*') at .../3-executor.armed\"; a driver-less result exits 2 naming the alias and the arm path. PRIME RULE 1 was invoked on the SKILL.md step: the do-arc loaded set measured EXACTLY 13257 tokens at HEAD against a PROTOCOL_LOAD_BUDGET_TOKENS of 13257 asserted over the real tree by measure.test.mjs, so ANY addition red the gate — the minimal one-sentence version still breached by 57. The architect returned PROCEED_WITH_FIX path 1 (diet-funded, the mechanism DIET-LEDGER.md already names five times), rejecting a budget raise as four files of ratchet surgery to buy 60 tokens available for free, and named four non-operative passages to cut with a justification each (a parenthetical inventorying fields the CLI prints, a cross-reference label, and two rationale clauses whose rules survive in the same sentence). do-arc/SKILL.md went 10,423 B to 10,404 B and the flow to 13,252 — under budget, with PROTOCOL_LOAD_BUDGET_TOKENS untouched at 13257 — and each cut carries a DIET-LEDGER row with its disposition and evidence. Verified: measure 10/10, executor-arm lib 42/42, command 15/15, result 21/21, gate run 3 --slots types GREEN. CORRECTION, recorded by gate round 0: the --slots history-comments GREEN this report originally claimed was read BEFORE this task's test files landed, and the slot was RED at the task's own commit over four dated comment lines the quality pass then found and reworded into standing-hazard form. The slot is green over the working tree at round 0 (0 findings) — the original claim was stale, not false-negative tooling.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "Step 3 asked the doc to cite the 2026-08-23 near-miss; the operator ruling of 2026-08-24 (docs carry operative rules only, why lives in git WHY: blocks) post-dates the plan and supersedes that instruction, so the citation lives in the commit WHY: block, this report, and task 3.4's own problem field instead. The criterion itself — that do-arc SKILL.md forbids spawner-asserted model ids — is met verbatim. files[] gained six entries the plan did not declare: the executor-arm COMMAND and its test file (step 1 assigns the card read to the command, but files[] named only the lib), bin/roadmap.mjs for the --agent-card TREE row, and DIET-LEDGER.md for the funding rows. Gate round 1 added the last two: arc-plane.workflow.mjs is the OTHER door onto the arm and was arming without the alias, so the reconcile it invokes itself silently no-opped, and arc-next.test.mjs pins that door. ALIAS_FAMILY covers the four Claude card aliases only; a card pinning a non-Claude model records an alias that maps to nothing and is announced-and-skipped, which is honest but means the session lane cannot yet reconcile a cross-family executor — that is plane 4's roles work. The reconcile compares FAMILY, not the exact model: an opus-card executor stamping any claude-opus-* id passes, so a wrong-version-same-family stamp is not caught. And the arm proves what was REQUESTED, never what the harness actually resolved — if a harness silently serves a different family than the card asked for, this reds the honest executor rather than the harness.",
      },
      done: true,
    },
  ],
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1200,
      total: 1200,
      notes:
        'The consumer binds ONE slot: unit = the whole plugin suite (node --test over bin/cli/hooks/scripts/test plus scripts/schema.test.ts), alongside the plugin-native history-comments scan of the phase diff (0 findings) and lint-diff. Baseline at phase start was 1141; this phase added 59. lint/types/build/integration are declaredAbsent in roadmap.config.json, not skipped by this phase — which is why the round-0 finding of a broken function in cli/lib/executor-arm.mjs mattered: no slot here would ever have caught it.',
    },
    integrationTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — this consumer has no integration tier.',
    },
    e2eTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — a CLI + schema phase with no rendered surface.',
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
        "6 fixes, 2 surfaced, 0 hard-stops. driverReconcileProblems wrote its unpinned-model announce to stderr from inside a compute-problems function, so no caller could reconcile without emitting — split into driverReconcile returning { problems, notes }, stderr and exit codes byte-identical. Task 3.4 had spelled the arm path inline in result.mjs, duplicating the armPath() cli/lib/executor-arm.mjs has owned since 1737.2 — exported and reused, with the test-side copy deliberately left as an independent oracle. The executor-arm no-alias line claimed the card declared no model even when no card existed at that path. Four comment lines carried dated incident narration, which was a LIVE history-comments RED at the phase base sha rather than a style call; reworded to the standing hazard, re-scan 0 findings. Two docblocks lost pure-rationale paragraphs per the 2026-08-24 operator ruling. SURFACED: task 3.4's transparencyReport claimed --slots history-comments GREEN when the read predated its own test files landing (corrected in the phase file), and the driverReconcile notes path had no test (closed by the executor with two fixtures, mutation-proven).",
    },
    {
      round: 1,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        "6 findings; the reviewer fixed 3 with falsification and the executor fixed the 3 left for a scope call. The reviewer's three share one shape — a guard this phase added could be DISARMED SILENTLY: findJournal swallowed a JSON parse failure to null so a corrupt journal read as no-journal and skipped the whole attribution reconcile with zero output; reconcileArmedAlias swallowed a truncated JSON arm identically; and nothing prunes lane journals, so an abandoned codex run REDs an honest inline stamp forever, a false-RED direction whose cheapest operator exit was to stamp a lie, now remediated by naming the journal path to delete. EXECUTOR FIXED: arc-plane.workflow.mjs armed WITHOUT expectedModelAlias, so the result check it invokes 60 lines later silently no-opped — the exact fable-for-opus hole 3.4 exists to close, in the workflow that backstops do-arc; cardModelAlias was lifted into cli/lib/executor-arm.mjs so both doors read one implementation, pinned by arc-next N12b and mutation-proven. A flag-shaped --agent-card value silently fell back to the DEFAULT card, recording the wrong alias and redding an honest executor — now a usage error. Exit 2 now uniformly means stdout is empty.",
    },
    {
      round: 2,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        "Verified the round-0 and round-1 fixes and caught a HIGH REGRESSION ROUND 1 HAD INTRODUCED, which is exactly why this round existed: R1 made findJournal THROW on an unreadable journal instead of swallowing it, but the throw was UNSCOPED — any codex-*.json that failed to parse threw for EVERY phase. Reproduced: with only .building/codex-99.json truncated, `gate run 3 --verify-complete` exited 2 for an honest inline session that never had a journal, so one abandoned journal blocked the LANDING GATE for every phase in the checkout. Fixed by filename-candidacy scoping. MEDIUM: the R1 lift had copy-pasted preflightLine into cli/lib/executor-arm.mjs where it was unreferenced AND called two identifiers that module never imports — a latent ReferenceError that lint/types (declared-none here) could never catch; deleted. LOW: task 3.4's files[] omitted the workflow and its test (corrected). LOW accepted: the flag-shaped --agent-card rejection routes into the shared usage line, matching the sibling convention.",
    },
    {
      round: 3,
      agent: 'code-reviewer',
      verdict: 'clean',
      summary:
        "Zero findings, tree untouched. Aimed at R2's own fix on the reasoning that logic written under pressure to fix a regression is where a third defect hides, and it PROVED rather than read: filename-candidacy is sound at the source (journalPath and launch consume the same ids array, so name and phases cannot diverge for a launcher-produced journal), and every disagreement case was probed live — ordering, the review-lane prefix, prefix/substring confusion. The guard still fires (corrupt codex-91.json throws for [91], null for [3]; the arc shape throws in both directions; a superset lookup returns null). Nothing new is swallowed. It did not trust R2's falsification claim: stripping the scoping reds codex test 22 for the right reason, and it built an INDEPENDENT gate-level probe the phase does not have — a done phase plus an abandoned corrupt journal through verify-complete, exit 0 with the fix and exit 2 without — reproducing the operator symptom at the seam that actually broke. All four acceptance criteria re-verified after three rounds of edits. SURFACED as pre-existing and out of scope: refuseIfLive parses a journal unguarded, so `codex run` over a truncated journal dies with a bare SyntaxError naming neither the file nor the remedy — loud, not silent, predates this arc (bc396a4), belongs in its own commit.",
    },
  ],
  metrics: {
    commits: 8,
    linesAdded: 2059,
    linesRemoved: 96,
    filesChanged: 29,
    testsAtStart: 1141,
    testsAtEnd: 1200,
    testsAdded: 59,
    startedAt: '2026-08-24T13:31:22.000Z',
    completedAt: '2026-08-24T16:47:47.000Z',
    haltCount: 0,
  },
  compromises: 'None',
  completedDate: '2026-08-24',
  executionResult: {
    phase: 3,
    status: 'done',
    driver: { model: 'claude-opus-5[1m]', lane: 'session' },
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      "Assumption 2's tripwire FAILED at Step 0 and this executor proceeded anyway, deliberately and on the record: the probe greps the WHOLE of templates/schema.ts for 'roles', and plane 1 had since landed PhaseEvalRecordShape.attribution.roles — a different shape. The underlying claim (executionResult carries no roles field) was verified precisely against the PhaseExecutionResultShape block, 0 hits, before any code. The probe was stale, not the claim.",
      "The gate plan the spawn card named (reviewScope none) is not the one the CLI derived: at task time it resolved LIGHT, and by gate time the diff had grown to 26 files across 5 classes and it resolved FULL. The CLI plan was followed, which is why a quality pass ran at all — and that pass found a live history-comments RED the phase's own record had claimed green.",
      "An independent review of the LAST fixes is owed for the arc sweep: round 3 was clean and touched nothing, so the round-2 fixes it verified did receive independent review — but round 3's own reading was not itself re-reviewed. Standard cap-round residue, weaker evidence than a fresh pass.",
      "PRE-EXISTING, surfaced by round 3 and NOT fixed here: refuseIfLive in cli/commands/codex.mjs parses a lane journal unguarded, so `roadmap codex run <N>` over a truncated journal dies with a bare SyntaxError naming neither the corrupt file nor the remedy — the same class this phase closed one function away, on the launch path. It predates the arc (bc396a4) and is loud rather than silent, so it is a follow-up, not a phase-3 regression.",
      "The codex driver's pinned model is verified LISTED on this host (codex debug models), not verified to be what a server-side default would have chosen — pinning -m is what makes the journal true, and the trade is that a retired slug now fails the lane loudly at launch instead of running on a silent fallback.",
    ],
    hardStops: [],
    gateRounds: 4,
  },
})
