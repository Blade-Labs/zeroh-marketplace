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
  status: 'backlog',
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
    "No feature flag applies: this phase hardens CLI orchestration and measurement artifacts, not a product-visible surface.\n\nSCAFFOLD DECISION: scripts/scaffold-roadmap.sh stops creating roadmap/arcs/example.arc.ts. templates/example.arc.ts remains installed with the plugin as opt-in reference material; changing its id or phase number would still make any copied file a live arc, while removing the copy step makes fresh consumers truthfully arc-free. cli/commands/init.test.mjs pins both absence of the file and absence of the misleading creation line.\n\nFINGERPRINT DECISION: assembleConsumerFingerprint(toplevel, { identityRoot = toplevel } = {}) keeps language and corpusSize derived from the active checkout, but derives repo from identityRoot. emitPhaseEvalRecord passes mainCheckout(toplevel) as identityRoot, so linked worktrees share the primary checkout basename without reading a remote or under-counting worktree phase files.\n\nERROR DECISION: refuseIfLive routes its exact same-lane journal through findJournal so JournalUnreadableError owns the typed path and deletion remedy. gate-report.mjs adds GateReportUnreadableError carrying the newest path plus JSON/Zod detail; latestReport returns null only when no run file exists and throws for an unreadable newest report. Existing callers already catch operational errors or are extended to name this error; none may translate it back to 'no report'.\n\n## Hypotheses\n1. CONFIRMED — seven seam-specific omissions survived because each happy-path shape existed while one discriminator, attribution field, or parse failure was dropped at a boundary; evidence: cli/commands/codex.mjs refuseIfLive, cli/lib/eval-collect.mjs summarizeGateRuns/assemblePhaseEvalRecord, cli/lib/gate-report.mjs latestReport, cli/commands/gate.mjs early returns, and scripts/scaffold-roadmap.sh copy the reported behavior verbatim.\n2. REFUTED — one shared parser or schema defect causes all seven symptoms; the sites cross journal JSON, gate reports, scaffold shell, eval projection, argument dispatch, and git identity, with no common implementation seam.",
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
      done: false,
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
      done: false,
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
      done: false,
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
      done: false,
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
      done: false,
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
      done: false,
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
