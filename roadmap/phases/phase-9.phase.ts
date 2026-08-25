import { definePhase } from '@/lib/roadmap/schema'

/**
 * POLYSEAT executor follow-ups — close seven fail-open or attribution seams.
 *
 * Each defect was reproduced by source inspection after phases 1–8 landed. The
 * changes stay inside the roadmap plugin and extend the existing sibling tests.
 * timing: no reference data for 7-9×surface:false
 */
export default definePhase({
  phase: 9,
  name: 'POLYSEAT follow-up hardening — honest journals, gates, and eval identity',
  status: 'in-progress',
  plannedBy: { model: 'gpt-5.6-sol' },
  category: 'fix',
  kind: 'hardening',
  source: '.building/plan-brief-9.md — seven out-of-scope defects surfaced by POLYSEAT executors.',
  priority: 'HIGH',
  dependsOn: [8],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/cli/lib/gate-report.mjs',
    'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.mjs',
    'plugins/zeroh-roadmap/scripts/scaffold-roadmap.sh',
  ],
  stakeholderDemo:
    'Roadmap operators get named failures for corrupt evidence, filtered gate runs stay visibly partial, role attribution reaches eval records, fresh scaffolds contain no phantom arc, and one consumer keeps one fingerprint across worktrees.',
  userFacing: false,
  assumptions: [
    {
      claim: 'JournalUnreadableError is exported by codex.mjs and already models path-plus-parse-failure remediation.',
      verify:
        "bash -c \"grep -qF 'export class JournalUnreadableError' plugins/zeroh-roadmap/cli/commands/codex.mjs && grep -qF 'delete it if that run is gone' plugins/zeroh-roadmap/cli/commands/codex.mjs\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'GateRunReportShape carries a non-empty optional slotFilter written by filtered gate runs.',
      verify:
        "bash -c \"grep -qF 'slotFilter: z.string().min(1).optional()' plugins/zeroh-roadmap/cli/lib/gate-report.mjs && grep -qF 'slotFilter: opts.slots' plugins/zeroh-roadmap/cli/commands/gate.mjs\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'PhaseEvalRecordShape accepts attribution.roles while assemblePhaseEvalRecord currently copies only plannedBy and driver.',
      verify:
        "bash -c \"grep -qF 'roles: z.record' plugins/zeroh-roadmap/templates/schema.ts && ! sed -n '/export function assemblePhaseEvalRecord/,/return record/p' plugins/zeroh-roadmap/cli/lib/eval-collect.mjs | grep -qF 'executionResult?.roles'\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'mainCheckout is the existing git-common-dir-based resolver for the primary checkout of a linked worktree.',
      verify:
        "bash -c \"grep -qF 'export function mainCheckout' plugins/zeroh-roadmap/cli/lib/gitroot.mjs && grep -qF 'gitCommonDir(cwd)' plugins/zeroh-roadmap/cli/lib/gitroot.mjs\"",
      onFalse: 'ESCALATE',
    },
  ],
  notes:
    "No feature flag applies: this phase hardens CLI orchestration and measurement artifacts, not a product-visible surface. REVIEW RATIFICATIONS (Mode A, 2026-08-25, claude-fable-5): all 4 assumptions probed PASS at HEAD; latestReport blast radius verified closed (validate.mjs, curate.mjs, gate.mjs — all in plan); tdd testMode ratified on all 7 tasks; step verifies use bare node --test on single files — executors run them under capbuild per host rules, ratified as written; userFacing false ratified.\n\nSCAFFOLD DECISION: scripts/scaffold-roadmap.sh stops creating roadmap/arcs/example.arc.ts. templates/example.arc.ts remains installed with the plugin as opt-in reference material; changing its id or phase number would still make any copied file a live arc, while removing the copy step makes fresh consumers truthfully arc-free. cli/commands/init.test.mjs pins both absence of the file and absence of the misleading creation line.\n\nFINGERPRINT DECISION: assembleConsumerFingerprint(toplevel, { identityRoot = toplevel } = {}) keeps language and corpusSize derived from the active checkout, but derives repo from identityRoot. emitPhaseEvalRecord passes mainCheckout(toplevel) as identityRoot, so linked worktrees share the primary checkout basename without reading a remote or under-counting worktree phase files.\n\nERROR DECISION: refuseIfLive routes its exact same-lane journal through findJournal so JournalUnreadableError owns the typed path and deletion remedy. gate-report.mjs adds GateReportUnreadableError carrying the newest path plus JSON/Zod detail; latestReport returns null only when no run file exists and throws for an unreadable newest report. Existing callers already catch operational errors or are extended to name this error; none may translate it back to 'no report'.\n\n## Hypotheses\n1. CONFIRMED — seven seam-specific omissions survived because each happy-path shape existed while one discriminator, attribution field, or parse failure was dropped at a boundary; evidence: cli/commands/codex.mjs refuseIfLive, cli/lib/eval-collect.mjs summarizeGateRuns/assemblePhaseEvalRecord, cli/lib/gate-report.mjs latestReport, cli/commands/gate.mjs early returns, and scripts/scaffold-roadmap.sh copy the reported behavior verbatim.\n2. REFUTED — one shared parser or schema defect causes all seven symptoms; the sites cross journal JSON, gate reports, scaffold shell, eval projection, argument dispatch, and git identity, with no common implementation seam.",
  tasks: [
    {
      id: '9.1',
      title: 'Make same-lane relaunches fail typed on corrupt journals',
      problem:
        'refuseIfLive parses its exact journal without the guarded findJournal path, so a truncated same-lane journal escapes as a raw SyntaxError at relaunch time.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            'Replace refuseIfLive’s direct JSON.parse(readFileSync(jPath)) with findJournal(root, ids, lane), preserving the live/dead pgid messages while allowing JournalUnreadableError to carry the exact path and deletion remedy → verify: bash -c "grep -qF \'refuseIfLive — a truncated same-lane journal\' plugins/zeroh-roadmap/cli/commands/codex.test.mjs && node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Add a relaunch fixture with truncated codex-plan journal JSON and assert a named JournalUnreadableError diagnostic includes the file and delete/relaunch remedy, never SyntaxError → verify: bash -c "grep -qF \'never reports raw SyntaxError\' plugins/zeroh-roadmap/cli/commands/codex.test.mjs && node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs"',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs exits 0 with the corrupt same-lane relaunch fixture naming its journal path and remedy',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/codex.mjs',
        'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-25',
      transparencyReport: {
        whatWasDone:
          'refuseIfLive no longer reads its same-lane journal with a bare JSON.parse. The read routes through findJournal, so a truncated journal is refused as a named JournalUnreadableError carrying the exact path and the delete-and-relaunch remedy (exit 1 — nothing was PROVEN live, the evidence is unreadable) instead of escaping as a raw SyntaxError out of planCodex/runCodex/reviewCodex.',
        how:
          'test-engineer wrote the RED fixture first (a truncated .building/codex-plan-900.json driven through a real `roadmap codex plan` subprocess); it failed on the defect verbatim — `roadmap: SyntaxError: Unexpected end of JSON input at refuseIfLive (codex.mjs:311)` — with a passing dead-pgid positive control beside it so the fix could not be "refuse everything". The implementation keeps the same-lane question scoped to the EXACT journal the launch would overwrite (found?.path === jPath): a first cut that accepted any journal findJournal covers shadowed the worktree-level guard and turned "a LIVE run under a different journal id refuses a launch into the same worktree" red, because an arc journal codex-50-51.json began answering for id 50 with a message that never names the file. Scoping to the exact path reopened one hole — findJournal returns a readable BROADER journal without throwing, masking an unreadable exact journal beside it — closed by refusing when the exact file is on disk yet is not what findJournal returned; journalParseFailure() re-derives the parse message and THROWS if the file parses on re-read rather than leaving a dead branch. Two extra tests pin both halves. GUARD MUTATION PROOF, three results: (1) planted violation `if (false && existsSync(jPath) && found?.path !== jPath)` produced `not ok 48 - refuseIfLive — a readable ARC journal covering these ids never masks an unreadable exact journal`, 48 pass / 1 fail; (2) planted violation widening the same-lane check back to `if (found)` produced `not ok 6 - a LIVE run under a different journal id refuses a launch into the same worktree` AND `not ok 49 - refuseIfLive — the same-lane check reads the EXACT journal, leaving an arc journal to the worktree guard`, 47 pass / 2 fail; (3) decoy, a comment appended to the `building` binding, stayed 49 pass / 0 fail. Restored and re-verified: capbuild node --test cli/commands/codex.test.mjs = 49/49.',
        compromises: 'None — the exact-journal scoping and the mask guard were both implemented, not deferred.',
        skipped: 'None — both step verifies ran and passed.',
        hardcoded: 'None — no new literals; the refusal reuses JournalUnreadableError and the existing LANES table.',
        limitations:
          'Two tests beyond the two the steps named were added (the arc-journal mask, and the exact-journal scoping that keeps the worktree guard reachable) because the implementation separated a seam the plan had folded together. The unreadable-journal refusal exits 1, deliberately distinct from the 2 a proven-live run earns; no caller distinguished those before, so nothing downstream reads the difference yet.',
      },
    },
    {
      id: '9.2',
      title: 'Distinguish missing gate reports from unreadable newest evidence',
      problem:
        'latestReport catches JSON and GateRunReportShape failures as null, causing appendAgentRound, curate, validate, and verify-complete to claim no report exists over corrupt evidence on disk.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/gate-report.mjs',
          description:
            'Add exported GateReportUnreadableError(path, cause) and make latestReport return null only for zero run files; JSON or GateRunReportShape failure for the newest file throws with its path and parse detail → verify: bash -c "grep -qF \'latestReport — corrupt newest report throws GateReportUnreadableError\' plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs && node --test plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs',
          description:
            'Pin absent-directory null separately from malformed JSON and schema-drifted newest reports, asserting both failure forms name the concrete run path and cause → verify: bash -c "grep -qF \'schema-drifted newest report\' plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs && node --test plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            'Catch GateReportUnreadableError in --record-round and --verify-complete only to prefix the active command, return the existing refusal code, and preserve the path/detail instead of emitting no readable report → verify: bash -c "grep -qF \'verify-complete — corrupt newest report names the report\' plugins/zeroh-roadmap/cli/commands/gate.test.mjs && node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
          description:
            'Exercise corrupt newest evidence through --record-round and --verify-complete, asserting neither command uses the no-report wording → verify: bash -c "grep -qF \'record-round — corrupt newest report\' plugins/zeroh-roadmap/cli/commands/gate.test.mjs && node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/validate.mjs',
          description:
            'Catch GateReportUnreadableError in gateReportConsistencyErrors and return a done-without-green-gate-report finding that names the corrupt path and cause instead of crashing validation or treating it as absent → verify: bash -c "grep -qF \'phase validate — corrupt newest gate report is a named finding\' plugins/zeroh-roadmap/cli/lib/validate.test.mjs && node --test plugins/zeroh-roadmap/cli/lib/validate.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/curate.test.mjs',
          description:
            'Drive curation with corrupt newest evidence and assert GateReportUnreadableError aborts before update-ref, preserving HEAD, tree, and report bytes while naming the path → verify: bash -c "grep -qF \'curate — corrupt newest gate report aborts before history mutation\' plugins/zeroh-roadmap/cli/lib/curate.test.mjs && node --test plugins/zeroh-roadmap/cli/lib/curate.test.mjs"',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs plugins/zeroh-roadmap/cli/commands/gate.test.mjs plugins/zeroh-roadmap/cli/lib/validate.test.mjs plugins/zeroh-roadmap/cli/lib/curate.test.mjs exits 0 and distinguishes absent, malformed JSON, and schema-drifted reports without mutating curation history',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/gate-report.mjs',
        'plugins/zeroh-roadmap/cli/lib/gate-report.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/validate.mjs',
        'plugins/zeroh-roadmap/cli/lib/validate.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/curate.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-25',
      transparencyReport: {
        whatWasDone:
          'gate-report.mjs gained an exported GateReportUnreadableError(path, cause) and latestReport now returns null ONLY when a phase has zero run files. A newest run file that will not JSON.parse, or that misses GateRunReportShape, throws with its concrete path and the JSON/Zod detail. gate run --record-round and --verify-complete name the class and preserve the path instead of claiming no report; phase validate turns it into a done-without-green-gate-report FINDING naming the file and the cause; curate keeps aborting before update-ref, now for the right reason.',
        how:
          'test-engineer wrote six RED tests across the four suites first, each failing on the defect verbatim — validate returned kind "ok" for a done phase whose newest report would not parse, --record-round printed "gate report: no run report for phase 1310 to record a round into" with two run files on disk, --verify-complete printed "no readable report under roadmap/.gate/1410/", and curate aborted as a bare Error rather than the typed one. Every fixture seeds an OLDER well-formed report beneath the corrupt newest one, so an implementation that scanned backwards for the first readable run would go green on stale evidence; positive controls restore a well-formed newest report in place so corruption is provably the only variable. The implementation keeps the newest-file-decides rule explicit and never repairs or deletes evidence. The verify-complete zero-run-file branch was reworded off "no readable report" (that phrase now belongs to the unreadable case alone) to "no run report under roadmap/.gate/N/ (the directory exists but holds no run-<seq>-*.json)". GUARD MUTATION PROOF, three results: (1) planted violation restoring both swallows (`catch { return null }` for JSON and for the shape refusal) produced exactly the six new tests red — `not ok 54/55/77/99/100/108`, 102 pass / 6 fail; (2) planted violation replacing the newest-file rule with a scan-back-to-the-first-readable-run fallback produced 97 pass / 11 fail, adding `not ok 80 - latestReport — picks the newest run`, `not ok 101 - latestReport — a well-formed newest report still returns { path, report }, even behind an older corrupt one` and `not ok 43 - gate run --verify-complete over a FILTERED latest report`; (3) decoy, a comment appended to the `files` binding, stayed 108 pass / 0 fail. Restored and re-verified: 108/108, plus phase.test.mjs + the two fixture-consumer suites + eval-collect.test.mjs at 67/67.',
        compromises: 'None — every caller of latestReport was audited and either guarded or confirmed to propagate honestly.',
        skipped: 'None — all six step verifies ran and passed.',
        hardcoded: 'None — the Zod detail is derived from the issue list, never a copied literal.',
        limitations:
          'curate.mjs needed no edit: executeCurate reads latestReport BEFORE update-ref and phase.mjs already surfaces a non-CurateError with its message and exit 1, so the typed throw aborts before any history mutation on its own. appendAgentRound and recordCuration keep their own zero-run-file throws, so "no report at all" and "the report will not read" now have two distinct messages rather than one.',
      },
    },
    {
      id: '9.3',
      title: 'Exclude filtered gate reports from eval round summaries',
      problem:
        'summarizeGateRuns emits every parsed run without exposing slotFilter, so routine subset checks are counted as complete gate rounds.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
          description:
            'In summarizeGateRuns skip GateRunReportShape records whose slotFilter is present before projecting startedAt, green, rounds, and slotFailures; full reports retain their current ordering and shape → verify: bash -c "grep -qF \'summarizeGateRuns — excludes slotFilter reports\' plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs && node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs',
          description:
            'Seed interleaved full and slotFilter reports and assert only full runs remain, including the non-initial case where a filtered report is newest → verify: bash -c "grep -qF \'newest filtered report is still excluded\' plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs && node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs"',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs exits 0 and an interleaved filtered report contributes zero summary entries',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
        'plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-25',
      transparencyReport: {
        whatWasDone:
          'summarizeGateRuns now skips any GateRunReportShape record whose slotFilter is present, after the safeParse and before the projection. A --slots subset check no longer contributes a gate-round entry, and its recorded agent rounds no longer reach the eval at all. Full reports keep their ordering and their projected shape byte-for-byte.',
        how:
          'test-engineer wrote three RED tests first, driving real run-<seq>-<ts>.json files through the production writeReport: interleaved full/filtered/full/filtered, a filtered report as BOTH the newest and the oldest, and an all-full positive control beside an all-filtered corpus. RED was 30 pass / 3 fail, failing on the defect — four entries where two were expected, with the filtered runs contributing a round-9 subset-only-reviewer that belongs to no phase. GUARD MUTATION PROOF, three results: (1) planted violation deleting the guard line entirely produced `not ok 31/32/33`, 30 pass / 3 fail; (2) planted violation narrowing it to the FIRST filtered report (`report.slotFilter && out.length === 0`) — the shape a naive fix takes — produced `not ok 31/32`, 31 pass / 2 fail, so the non-initial case is genuinely load-bearing; (3) decoy, `report.slotFilter !== undefined` (an equivalent test against a schema field that is either absent or a non-empty string), stayed 33 pass / 0 fail. Restored and re-verified: 33/33.',
        compromises: 'None — the exclusion was implemented at the projection boundary, not narrowed or deferred.',
        skipped: 'None — both step verifies ran and passed.',
        hardcoded: 'None — the guard reads the schema field, no slot-name list.',
        limitations:
          'The guard is presence-based, matching GateRunReportShape, where slotFilter is either absent or a non-empty string; a future partial-run marker that is not slotFilter would need its own exclusion. checkPhaseConsistency and the verify-complete eval refresh already refused filtered reports independently, so this closes the third and last door rather than introducing the rule.',
      },
    },
    {
      id: '9.4',
      title: 'Carry execution role bindings into phase eval attribution',
      problem:
        'assemblePhaseEvalRecord copies plannedBy and executionResult.driver field by field but omits executionResult.roles even though PhaseEvalRecordShape already accepts the snapshot.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
          description:
            'Copy parsed.executionResult.roles into attribution.roles by role key with model only, matching PhaseEvalRecordShape’s strict record and retaining absent-as-absent semantics → verify: bash -c "grep -qF \'assemblePhaseEvalRecord — copies executionResult.roles\' plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs && node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs',
          description:
            'Assert multiple role bindings survive into attribution.roles with exact keys/models while a record without roles still omits the field → verify: bash -c "grep -qF \'roles stay absent when execution recorded none\' plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs && node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs"',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs exits 0 and the assembled record preserves every recorded role model without fabricating absent roles',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
        'plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-25',
      transparencyReport: {
        whatWasDone:
          "assemblePhaseEvalRecord now projects executionResult.roles into attribution.roles through a new exported projectRoleModels(phase, roles), and returns { record, warnings } so the projection's own losses can be spoken. emitPhaseEvalRecord prints each warning to stderr before validation, in the existing measurement voice (the gate verdict is unaffected).",
        how:
          "The plan pre-made 'copy by role key with model only' but not the duplicate-role case, and the source shape makes it reachable: executionResult.roles is an ARRAY of per-firing bindings while attribution.roles is a RECORD holding one model per role. Real committed data already duplicates (phase-5 records code-reviewer three times, phase-8 twice) and this phase produced the first DISAGREEING duplicate. A software-architect Decision Contract call returned PROCEED_WITH_FIX for option (c): agreeing duplicates collapse to their single model, a role whose firings disagree is OMITTED and NAMED in warnings rather than collapsed, absent stays absent (undefined) and an empty list becomes {} so 'the resolver bound nothing' stays distinguishable from 'no bindings recorded'. Keys are built with Object.fromEntries in first-firing order — a plain assignment would silently lose a role literally named __proto__, and unstable order would churn the committed record on re-runs. test-engineer then wrote three RED tests against that contract, fed with phase-5's committed firing array verbatim, RED at 33 pass / 3 fail. GUARD MUTATION PROOF, four results: (1) planted violation last-wins collapse produced `not ok 36 - assemblePhaseEvalRecord — a role whose firings DISAGREE on the model is omitted and NAMED, never collapsed`, 35 pass / 1 fail; (2) planted violation returning {} for an absent roles list produced `not ok 35 - assemblePhaseEvalRecord — roles stay absent when execution recorded none`, 35 pass / 1 fail; (3) planted violation first-wins collapse produced `not ok 36` again, 35 pass / 1 fail — so both collapse directions are pinned, not just one; (4) decoy, `distinct.length === 1` rewritten as the equivalent `new Set(models).size === 1`, stayed 36 pass / 0 fail. Restored and re-verified: eval-collect.test.mjs + gate.test.mjs = 91/91.",
        compromises:
          'None — the collapse was NOT taken. The one swallow that survived the first cut (a firing missing role or model dropped by `continue`) was flagged by test-engineer and closed in the same task: it now pushes a warning naming the entry, so an unreachable-through-the-bridge malformation is still spoken.',
        skipped: 'None — both step verifies ran and passed.',
        hardcoded: 'None — no model ids or role ids appear in the projection; it reads whatever the phase file recorded.',
        limitations:
          "ADDITIVE DEVIATION from files[]: cli/commands/gate.mjs is a third file, needed because assemblePhaseEvalRecord's return shape changed and its single caller must print the warnings; plugin-internal, no consumer contract touched. The projection stays lossy by design — `via` and `substituted` cannot travel at all under a strict `{ model }` value, so the tier-fallback walk never reaches the scorecard. That is surfaced as a named follow-up rather than fixed here: widening PhaseEvalRecordShape.attribution.roles to the per-firing array is a consumer-contract change (byte-synced templates/schema.ts) and wants its own phase.",
        decisionRef:
          'software-architect Decision Contract, 2026-08-25 — verdict PROCEED_WITH_FIX, option (c) omit-and-name; rejected (a) silent collapse as a swallow, (b) throw as over-refusal of schema-valid input, (d) schema widening as out of scope and a named follow-up.',
      },
    },
    {
      id: '9.5',
      title: 'Keep fresh scaffolds free of a live example arc',
      problem:
        'scaffold-roadmap.sh copies templates/example.arc.ts as roadmap/arcs/example.arc.ts, making id A with phases [1] live in every fresh consumer before any arc is authored.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/scaffold-roadmap.sh',
          description:
            'Keep roadmap/arcs creation because arcs remain opt-in, but remove the example.arc.ts copy/skip branch and its creation messages so scaffolding produces an empty arcs directory → verify: bash -c "grep -qF \'init --scaffold leaves roadmap/arcs opt-in and empty\' plugins/zeroh-roadmap/cli/commands/init.test.mjs && node --test plugins/zeroh-roadmap/cli/commands/init.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/init.test.mjs',
          description:
            'Extend the real init --scaffold subprocess fixture to assert roadmap/arcs exists, the example arc file does not, and stdout does not claim it was created; leave the installed example template untouched as plugin reference → verify: bash -c "grep -qF \'never claims the example arc was created\' plugins/zeroh-roadmap/cli/commands/init.test.mjs && node --test plugins/zeroh-roadmap/cli/commands/init.test.mjs"',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/cli/commands/init.test.mjs exits 0 and a second scaffold run leaves the opt-in arcs directory empty without an example creation message',
      ],
      files: [
        'plugins/zeroh-roadmap/scripts/scaffold-roadmap.sh',
        'plugins/zeroh-roadmap/cli/commands/init.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-25',
      transparencyReport: {
        whatWasDone:
          'scaffold-roadmap.sh no longer copies templates/example.arc.ts into a fresh consumer. The whole copy/skip branch is gone, so `roadmap init --scaffold` creates an EMPTY roadmap/arcs/ directory and its output never mentions example.arc.ts in either wording. templates/example.arc.ts stays installed with the plugin as opt-in reference material.',
        how:
          'test-engineer wrote two RED tests driving the real `roadmap init --scaffold` subprocess, RED at 3 pass / 2 fail on the defect verbatim: a fresh scaffold must leave roadmap/arcs/ EMPTY, and the listing came back holding example.arc.ts. It also proved independently, by running the CLI twice in a throwaway repo, that BOTH arms of the removed if/else were misleading: run 1 printed `Created roadmap/arcs/example.arc.ts` and run 2 printed `Skipped roadmap/arcs/example.arc.ts (already exists)`, so removing only the Created wording would have left the second run lying. The tests assert the WHOLE directory listing is empty rather than just the one filename, which is what makes the rename mutation below fail. GUARD MUTATION PROOF, four results: (1) planted violation restoring the exact copy/skip branch produced `not ok 4` and `not ok 5`, 3 pass / 2 fail; (2) planted violation keeping the copy under a DIFFERENT name (sample.arc.ts) also produced `not ok 4/5`, 3 pass / 2 fail, so the listing assertion catches an example the filename check would miss; (3) planted violation deleting templates/example.arc.ts instead of the copy step produced `not ok 4/5`, 3 pass / 2 fail, so the wrong fix is pinned too; (4) decoy, a comment line above the mkdir, stayed 5 pass / 0 fail. Restored and re-verified: init.test.mjs 5/5.',
        compromises: 'None — the copy step was removed outright rather than made conditional or renamed.',
        skipped: 'None — both step verifies ran and passed.',
        hardcoded: 'None — no paths or ids were introduced; a block was deleted.',
        limitations:
          'Consumers scaffolded before this change still carry roadmap/arcs/example.arc.ts on disk; the scaffold is not a migration and does not remove it, so an existing consumer stays as it is until someone deletes the file. roadmap/arcs/ is still created because arcs remain opt-in and the directory is deliberately outside the audit REQUIRED_ARTIFACTS set.',
      },
    },
    {
      id: '9.6',
      title: 'Refuse --slots where gate modes cannot apply it',
      problem:
        'parseArgs accepts --slots for --record-round and --verify-complete, but both modes return before buildPlan constructs and applies the filter.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            'After parsing and phase validation, reject opts.slots combined with recordRound or verifyComplete at the dispatch boundary, naming both conflicting flags and returning usage/refusal before report reads or writes → verify: bash -c "grep -qF \'gate run refuses --slots with --record-round\' plugins/zeroh-roadmap/cli/commands/gate.test.mjs && node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
          description:
            'Add both conflict permutations and assert named diagnostics plus byte-identical existing report evidence, while default --slots execution remains accepted → verify: bash -c "grep -qF \'gate run refuses --slots with --verify-complete\' plugins/zeroh-roadmap/cli/commands/gate.test.mjs && node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs"',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs exits 0; both unsupported combinations refuse by flag name without mutating a report, and ordinary filtered execution remains covered',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/gate.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-25',
      transparencyReport: {
        whatWasDone:
          'roadmap gate run now refuses --slots combined with --record-round or --verify-complete at the dispatch boundary, after phase-number validation and before any report is read or written. The refusal names both conflicting flags, explains that neither mode executes slots, points at the standalone filtered run, and exits 1 (usage). The default execute path keeps --slots exactly as it was.',
        how:
          'test-engineer wrote both permutations plus an over-refusal control, RED at 56 pass / 2 fail on the defect verbatim: with --slots types present, --record-round still printed `recorded round 1 (code-reviewer: clean)` and --verify-complete still printed `phase 1420 consistent with the latest green gate report` — the flag silently ignored and the full-scope action taken. The byte-snapshot assertion is the load-bearing one for --record-round (a guard placed after appendAgentRound would still have mutated the report); test-engineer falsified it separately by stripping the earlier asserts and confirming it fails on the appended agents[] entry, so it is not decorative. Exit 1 rather than 2 follows the CLI vocabulary in roadmap --help: 0 clean / 1 usage-config / 2 check-failed-or-refused, and two flags that cannot be combined is a usage error. GUARD MUTATION PROOF, three results: (1) planted violation disabling the guard produced `not ok 56` and `not ok 57`, 56 pass / 2 fail; (2) planted violation narrowing it to --record-round only produced `not ok 57`, 57 pass / 1 fail, so the verify-complete arm is independently pinned; (3) OVER-refusal violation rejecting --slots on the execute path too produced 53 pass / 5 fail, reddening `not ok 24/25/42/43/58` — the ordinary filtered run is genuinely protected against a fix that refuses too much. Restored and re-verified: gate.test.mjs 58/58.',
        compromises: 'None — the refusal lands at the dispatch boundary rather than being softened into a warning.',
        skipped: 'None — both step verifies ran and passed.',
        hardcoded: 'None — the flag names come from the same literals parseArgs reads.',
        limitations:
          'parseArgs still ACCEPTS --slots in every mode; the conflict is caught one level up at dispatch, which is where the test contract pins it and where the phase number is already validated for the diagnostic. A future third read-only mode would need adding to the unfilterable ternary — the guard enumerates the two modes that exist rather than deriving them.',
      },
    },
    {
      id: '9.7',
      title: 'Normalize consumer identity across linked worktrees',
      problem:
        'emitPhaseEvalRecord fingerprints the active git toplevel basename, so linked codex worktrees partition one repository into separate consumer cohorts.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
          description:
            'Extend assembleConsumerFingerprint with identityRoot defaulting to toplevel; use identityRoot only for repo basename while language and corpusSize continue reading the active checkout → verify: bash -c "grep -qF \'assembleConsumerFingerprint — identityRoot normalizes only repo identity\' plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs && node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            'In emitPhaseEvalRecord pass mainCheckout(toplevel) as assembleConsumerFingerprint’s identityRoot, reusing the imported git-common-dir resolver without changing artifact placement → verify: bash -c "grep -qF \'gate eval fingerprint matches primary checkout from linked worktree\' plugins/zeroh-roadmap/cli/commands/gate.test.mjs && node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs',
          description:
            'Pin that identityRoot changes repo only and that active-checkout tsconfig/package/phases still determine language and corpusSize → verify: bash -c "grep -qF \'active checkout still owns language and corpusSize\' plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs && node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
          description:
            'Run the existing linked-worktree fixture through eval emission and assert its consumerFingerprint.repo equals the primary checkout basename on initial emit and verify-complete refresh → verify: bash -c "grep -qF \'verify-complete refresh keeps the primary checkout fingerprint\' plugins/zeroh-roadmap/cli/commands/gate.test.mjs && node --test plugins/zeroh-roadmap/cli/commands/gate.test.mjs"',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs plugins/zeroh-roadmap/cli/commands/gate.test.mjs exits 0 and initial plus refreshed worktree records use the primary repo name while retaining worktree corpus metadata',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/eval-collect.mjs',
        'plugins/zeroh-roadmap/cli/lib/eval-collect.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
    },
  ],
})
