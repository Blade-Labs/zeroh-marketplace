import { definePhase } from '@/lib/roadmap/schema'

/**
 * Post-gauntlet retrospective remediation — close the 29 findings of the v0.30.0→v0.33.0
 * three-reviewer coherence review (CLI / protocol / record-trail, 2026-08-26).
 *
 * Nothing in the range was wrong-headed; the findings cluster into four classes: dead-on-arrival
 * surface (roles.mjs, the executionMode mistake one level up), an empty release axis, derived
 * records drifted from the corpus they project, and one-home leaks. User ruling 2026-08-26:
 * "plan it, review then do it."
 * timing: no reference data for 7-9×surface:false
 */
export default definePhase({
  phase: 13,
  name: 'Retro remediation — roles seam, codex-journal home, census/audit truth, release axis, derived-record refresh',
  status: 'in-progress',
  plannedBy: { model: 'claude-fable-5' },
  category: 'fix',
  kind: 'hardening',
  source:
    'Three-agent retrospective coherence review of 1518f58..HEAD (2026-08-26, this session): CLI reviewer 8 findings, protocol reviewer 8, record-trail reviewer 13; synthesized and user-ratified for remediation.',
  priority: 'HIGH',
  dependsOn: [11],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/codex-journal.mjs',
    'plugins/zeroh-roadmap/cli/lib/landing.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/cli/commands/role.mjs',
    'plugins/zeroh-roadmap/cli/lib/roles.mjs',
    'plugins/zeroh-roadmap/cli/commands/followups.mjs',
    'plugins/zeroh-roadmap/cli/commands/audit.mjs',
    'plugins/zeroh-roadmap/bin/roadmap.mjs',
    'plugins/zeroh-roadmap/agents/intent-validator.md',
    'plugins/zeroh-roadmap/DIET-LEDGER.md',
    'plugins/zeroh-roadmap/templates/schema.ts',
    'lib/roadmap/schema.ts',
    'plugins/zeroh-roadmap/CHANGELOG.md',
    'roadmap/arcs/POLYSEAT.arc.ts',
    'roadmap/ROADMAP.md',
  ],
  stakeholderDemo:
    'The plugin’s role policy becomes a runnable verb instead of dead code, the codex journal gets a lib home, the census and audit stop lying, every derived record matches the corpus, and v0.34.0 ships with the first real CHANGELOG.',
  userFacing: false,
  assumptions: [
    {
      claim: 'roles.mjs still has NO runtime consumer outside its own test (codex.mjs hits are prompt strings, not imports).',
      verify:
        'bash -c "! grep -rln \\"from \'.*lib/roles.mjs\'\\" plugins/zeroh-roadmap/cli/commands plugins/zeroh-roadmap/bin | grep -v test"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The lib→command inversion is present: landing.mjs imports the journal helpers from commands/codex.mjs.',
      verify: 'bash -c "grep -qF \\"from \'../commands/codex.mjs\'\\" plugins/zeroh-roadmap/cli/lib/landing.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'audit check 4 is a raw includes() scan and the followups liveOnly filter is an unanchored regex (matchStatusField exists as the one home).',
      verify:
        'bash -c "grep -qF \\"includes(\'[NEEDS CLARIFICATION\\" plugins/zeroh-roadmap/cli/commands/audit.mjs && grep -qE \\"status:.s.\\\\*\\" plugins/zeroh-roadmap/cli/commands/followups.mjs; grep -qF \'status:\' plugins/zeroh-roadmap/cli/commands/followups.mjs && grep -qF \'export function matchStatusField\' plugins/zeroh-roadmap/cli/lib/phasescan.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The do-arc protocol-load budget sits at EXACTLY the assert (zero headroom) — every metered-skill byte in this phase must be net-zero or ledger-funded.',
      verify: 'bash -c "node plugins/zeroh-roadmap/bin/roadmap.mjs measure --flow do-arc --assert 13257 >/dev/null"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'POLYSEAT declares NO status field (defineArc returns the raw object; the Zod default renders it as planning downstream) despite all members done — the drift 13.6 closes.',
      verify:
        'bash -c "node --import tsx -e \\"import(\'./roadmap/arcs/POLYSEAT.arc.ts\').then(m=>process.exit(m.default.status===undefined?0:1))\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'intent-validator frontmatter is model: opus (the fail-safe the off-policy panel ran on) while software-architect carries the v0.32 fable-default precedent; arc-eval-judge’s model: sonnet is a documented design ruling and stays untouched.',
      verify:
        'bash -c "grep -qF \'model: opus\' plugins/zeroh-roadmap/agents/intent-validator.md && grep -qF \'model: fable\' plugins/zeroh-roadmap/agents/software-architect.md && grep -qF \'design ruling\' plugins/zeroh-roadmap/agents/arc-eval-judge.md"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '13.1',
      title: 'codex-journal gets a lib home — fix the lib→command inversion',
      problem:
        'cli/lib/landing.mjs imports findJournal/archiveJournal/RUN_LANE_ARTIFACTS from cli/commands/codex.mjs (the range’s one dependency inversion), and phase.mjs + gate.mjs reach into the same 862-line command module for journal mechanics — four consumers pulling prompt builders and spawn machinery along, plus a latent ESM cycle the moment codex.mjs needs landing.mjs.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/codex-journal.mjs',
          description:
            'Move the journal reader/writer surface OUT of commands/codex.mjs into a new lib module: findJournal, archiveJournal, findClosedJournal, RUN_LANE_ARTIFACTS, JournalUnreadableError and their private helpers, docblocks intact (a MOVE, not a rewrite) → verify: bash -c "grep -qF \'export function findJournal\' plugins/zeroh-roadmap/cli/lib/codex-journal.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            'commands/codex.mjs imports the moved surface from ../lib/codex-journal.mjs and RE-EXPORTS the same names (existing external importers keep working during this task; the next step migrates them); no behavior change → verify: bash -c "grep -qF \\"from \'../lib/codex-journal.mjs\'\\" plugins/zeroh-roadmap/cli/commands/codex.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs',
          description:
            'Point landing.mjs, commands/phase.mjs and commands/gate.mjs at ../lib/codex-journal.mjs (landing’s import becomes lib→lib; zero PRODUCTION-module grep hits remain for imports FROM commands/codex.mjs outside codex.mjs itself — a test importing the launcher’s buildPrompt is not the inversion; verify corrected at execution, see limitations) → verify: bash -c "! grep -rn \\"from \'.*commands/codex.mjs\'\\" plugins/zeroh-roadmap/cli/lib plugins/zeroh-roadmap/cli/commands | grep -v codex.mjs: | grep -v test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Re-run the suites that pin the journal behavior — codex, gate, phase, and the fixture-consumer land tests — unchanged (the move is proven by green, not by new tests) → verify: capbuild bash -c "node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs plugins/zeroh-roadmap/cli/commands/gate.test.mjs plugins/zeroh-roadmap/cli/commands/phase.test.mjs plugins/zeroh-roadmap/test/fixture-consumer/arc-land.test.mjs"',
        },
      ],
      acceptanceCriteria: [
        'No module under cli/lib or cli/commands (codex.mjs aside) imports from commands/codex.mjs; all four named suites green with zero test edits',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/codex-journal.mjs',
        'plugins/zeroh-roadmap/cli/commands/codex.mjs',
        'plugins/zeroh-roadmap/cli/lib/landing.mjs',
        'plugins/zeroh-roadmap/cli/commands/phase.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.mjs',
      ],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'The journal surface moved verbatim to cli/lib/codex-journal.mjs (LANES, prevReportName, RUN_LANE_ARTIFACTS, journalPath, journalDeclineReason, JournalUnreadableError, findJournal, archiveJournal, findClosedJournal — bodies + docblocks intact); codex.mjs imports only the names it uses; landing.mjs, phase.mjs, gate.mjs point at the lib. The lib→command inversion is gone. (The task landed a compat re-export from codex.mjs for its one test importer; the quality pass NARROWED the re-export to a single pinned findJournal (codex.test.mjs asserts it through five dynamic-import sites, so the seam stays); the other four re-exports were dead and were deleted.)',
        how:
          'Line-slice extraction (63-83, 85-175, 603-677) via script, module-load smoke on both files, then the four pinning suites: one RED surfaced the one seam the slices missed — journalParseFailure (stays with the launcher) calls journalDeclineReason (moved) — closed by exporting it from the lib; suites then 185/185 with zero test edits.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Step-3’s verify was over-broad and corrected in the plan at execution time (excludes *.test.mjs — roles.test.mjs imports the launcher’s buildPrompt, which is not the journal inversion); LANES/prevReportName/journalPath/journalDeclineReason are additionally exported from the lib beyond the plan’s five names because the launcher genuinely consumes them.',
      },
      interfaces: { consumes: [], produces: ['findJournal (cli/lib/codex-journal.mjs)'] },
    },
    {
      id: '13.2',
      title: 'roadmap role resolve — the roles layer gets a reachable seam',
      problem:
        'The 1,150-line role-resolution layer (ROLES, resolveRole, tier chains, RoleUnjudgedError) has zero runtime consumers — the executionMode class of mistake — while DIET-LEDGER rows deleted prose homes on the claim that resolveRole "enforces" them; the only executionResult.roles on disk was hand-written, and POLYSEAT’s judge panel ran on the frontmatter fallback instead of the configured judgeModel.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/role.mjs',
          description:
            'New thin command (arm.mjs pattern): `roadmap role resolve <role> [--driver <id>] [--json]` calls resolveRole with the consumer config’s modelPolicy and prints the resolved model + chain + substitution provenance; unknown role exits 1 named; a RoleUnjudgedError verdict exits 2 (refused). Registry row in bin/roadmap.mjs TREE: role: { phase: 13, sub: [\'resolve <role> [--driver <id>] [--json]\'] } → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/role.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/role.test.mjs',
          description:
            'Wired subprocess tests (RED first, tdd): judge-class role resolves to the config judgeModel (fable in a fixture config); absent modelPolicy falls back to the chain default; unknown role exit 1 named; --json parses; a driver override changes the chain per roles.mjs → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/role.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/agents/intent-validator.md',
          description:
            'Frontmatter model: opus → fable, mirroring the v0.32 software-architect precedent verbatim (the fail-safe default now equals the judge tier; a NAMED opus fallback line in the card body, as software-architect.md does). arc-eval-judge is NOT touched — its model: sonnet is a documented design ruling → verify: bash -c "grep -qF \'model: fable\' plugins/zeroh-roadmap/agents/intent-validator.md && grep -qF \'model: sonnet\' plugins/zeroh-roadmap/agents/arc-eval-judge.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/DIET-LEDGER.md',
          description:
            'True the rows that justified prose deletion with "resolveRole enforces": append a dated correction section naming the actual state at deletion time (convention-with-a-test, no runtime consumer) and the new seam (roadmap role resolve) that makes the claim true going forward → verify: bash -c "grep -qF \'role resolve\' plugins/zeroh-roadmap/DIET-LEDGER.md"',
        },
      ],
      acceptanceCriteria: [
        'roadmap role resolve intent-validator --json returns model fable against this repo’s config; the ledger correction names both the past overstatement and the new seam; roles.mjs gains a runtime consumer (grep from cli/commands finds role.mjs importing it)',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/role.mjs',
        'plugins/zeroh-roadmap/cli/commands/role.test.mjs',
        'plugins/zeroh-roadmap/bin/roadmap.mjs',
        'plugins/zeroh-roadmap/agents/intent-validator.md',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'roadmap role resolve landed (thin over resolveRole; exit 0 resolved / 1 unknown-named / 2 UNJUDGED carrying the library message) with its TREE row; roles.mjs has a runtime consumer. intent-validator frontmatter → fable with the MULTI-DRIVER §1 cite (arc-eval-judge’s sonnet ruling untouched); gate R1 then resolved the chain to a SINGLE fable tier per a software-architect Decision Contract, so the frontmatter fail-safe equals the chain head and there is no named opus fallback — fable down is honestly UNJUDGED. DIET-LEDGER carries the dated correction: the "resolveRole enforces" deletion rationale was an overstatement at deletion time; the verb makes it true now.',
        how:
          'TDD: test-engineer wrote 11 RED wired cases (implementability + 5 seeded mutations validated against a throwaway reference, then deleted); implementation had one real bug the suite caught — the roleId extractor excluded index 0 when --driver was absent (di+1===0) — fixed, 11/11. Live smoke: role resolve intent-validator --json → claude-fable-5 against this repo’s config. Consumed interface resolveRole grep-verified before building.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None — the claude driver default is documented in the command header, not sniffed.',
        limitations:
          'Spawner SKILL prose does not yet cite the verb (deliberate plan-time deferral: the do-arc budget sits at its exact ceiling; the verb + trued ledger close the finding, prose wiring is a named follow-up once headroom exists).',
      },
      interfaces: { consumes: ['resolveRole (cli/lib/roles.mjs)'], produces: [] },
    },
    {
      id: '13.3',
      title: 'Census and audit stop lying — matchStatusField + terminal-scoped check 4',
      problem:
        'followups.mjs liveOnly re-implements phase-status parsing with an unanchored whole-file regex (a live phase whose prose quotes a terminal status is silently under-counted — the exact phase-1787 bug matchStatusField exists to prevent, and audit check 14 inherits it); audit check 4 raw-includes() scans for [NEEDS CLARIFICATION with no done-phase scoping, permanently reporting two false MEDIUMs against done phase 8 and a standing HAS ISSUES verdict.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/followups.mjs',
          description:
            'Replace the liveOnly regex with matchStatusField(text) from ../lib/phasescan.mjs (anchored at definePhase, doc-prose immune); skip terminal iff the MATCHED field is done/historical/cancelled → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/followups.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/audit.mjs',
          description:
            'Check 4: resolve each phase’s status via matchStatusField and SKIP terminal phases; require the token to be TERMINATED — closed by a colon (question inline) or by a bracket (the documented bare form); an unterminated occurrence is a guard string naming the token, never one being asked → verify: bash -c "node plugins/zeroh-roadmap/bin/roadmap.mjs audit --json | node -e \'let c=[];process.stdin.on(String.fromCharCode(100,97,116,97),d=>c.push(d)).on(String.fromCharCode(101,110,100),()=>{const v=JSON.parse(c.join(String()));process.exit(v.findings.some(f=>String(f.phase)===String(8))?1:0)})\'"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/audit.test.mjs',
          description:
            'Tests (RED first, tdd): a DONE phase carrying the literal in prose/quotes yields no check-4 finding; a BACKLOG phase with a real TERMINATED marker still reds while an unterminated guard string does not (the check stays armed); a followups fixture with terminal-status prose in a live phase’s docblock counts the reference (pins the matchStatusField switch) → verify: capbuild bash -c "node --test plugins/zeroh-roadmap/cli/commands/audit.test.mjs plugins/zeroh-roadmap/cli/commands/followups.test.mjs"',
        },
      ],
      acceptanceCriteria: [
        'roadmap audit --json on THIS repo reports zero check-4 findings against phase 8 while a synthetic backlog-phase marker fixture still reds; the followups census counts a reference from a live phase whose docblock quotes a terminal status',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/followups.mjs',
        'plugins/zeroh-roadmap/cli/commands/audit.mjs',
        'plugins/zeroh-roadmap/cli/commands/audit.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/followups.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'The followups liveOnly skip now applies only to *.phase.ts whose status FIELD is terminal (isTerminalPhaseSource over matchStatusField — notes/arc files and prose-quoting live phases keep counting); audit check 4 fires only in NON-terminal phases and only on a TERMINATED token — closed by a colon (question inline) or by a bracket (the bare form every protocol home documents) — while an UNTERMINATED occurrence is a guard string naming the token. The colon-ONLY grammar shipped at task time was a false negative and was corrected at gate R1. Live result: roadmap audit --json on this repo is verdict CLEAN (was a standing HAS ISSUES on done phase 8).',
        how:
          'TDD: test-engineer added 5 RED cases across the two suites (satisfiability pre-proven on throwaway copies then reverted; the two suppressors exercised one at a time so a half-fix cannot pass). One implementation stumble: the matchStatusField import initially missed audit.mjs and every case redded on the ReferenceError — fixed, 68/68. GUARD MUTATION PROOF on check 4, RE-RUN at gate R2 against the corrected termination guard (the task-time proof named a colon-only code shape that no longer exists): (1) dead terminal-skip → not ok 10 AND not ok 11, 59 pass / 2 fail; (2) grammar reverted to the colon-only defect → not ok 12 (the boundary test), 60 pass / 1 fail; (3) decoy comment on the queued binding → 61/61; restored 61/61 with a clean git diff.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The colon-only grammar shipped at task time was a FALSE-NEGATIVE defect, caught at gate R1: every protocol home writes the marker bare, so a queued phase carrying a real unresolved question in the documented form audited CLEAN (the reviewer reproduced it). Corrected to TERMINATION — both documented forms fire, an UNTERMINATED guard string is data — with the bare form now test-pinned. Residual conservatism, accepted twice over: a LIVE phase quoting either terminated form in prose self-reds, so records describe the token instead of quoting it (the quality pass de-quoted 13.3’s own report; gate R1 de-quoted this plan’s step text).',
      },
      interfaces: { consumes: ['matchStatusField (cli/lib/phasescan.mjs)'], produces: [] },
    },
    {
      id: '13.4',
      title: 'bin + command docblocks tell the whole truth',
      problem:
        'Four small dishonesties in the discovery surface, all introduced or left behind in the range: the exit-code contract (header + --help footer) omits watch’s exit 5 UNOBSERVED; the codex TREE row hides the plan lane and status’s --plan flag; the capacity row prints a false [ROADCODE 11] arc tag; arc.mjs’s module docblock hides --ignore-capacity.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/bin/roadmap.mjs',
          description:
            'Header line and --help footer gain `· 5 watch UNOBSERVED`; codex TREE sub list gains `plan <N> --brief <path>` and status’s subs become `status <N> [--review|--plan]`; the capacity row’s provenance stops claiming ROADCODE (match how arc-less phases should print — give the entry an honest marker or the real owning context) → verify: bash -c "node plugins/zeroh-roadmap/bin/roadmap.mjs --help | grep -q \'5 watch UNOBSERVED\' && node plugins/zeroh-roadmap/bin/roadmap.mjs --help | grep -q \'plan <N>\'"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/arc.mjs',
          description:
            'Module docblock line for next gains [--ignore-capacity] (matching both usage strings the range already updated) → verify: bash -c "sed -n \'3p\' plugins/zeroh-roadmap/cli/commands/arc.mjs | grep -qF -- \'--ignore-capacity\'"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/driver.mjs',
          description:
            'Delete entrySkeleton’s unreachable unknown-driver fallbacks (every register/verify path calls resolveDriver first, which throws on an unknown id — the `known ? … : …` arms can never take the else branch); driver suite stays green → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/driver.test.mjs',
        },
      ],
      acceptanceCriteria: ['--help and the two docblocks agree with the code’s actual flags and exits; driver suite green after the dead-arm deletion'],
      files: ['plugins/zeroh-roadmap/bin/roadmap.mjs', 'plugins/zeroh-roadmap/cli/commands/arc.mjs', 'plugins/zeroh-roadmap/cli/commands/driver.mjs'],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'bin exit contract (header + --help footer) names exit 5 UNOBSERVED and the capacity/role special exits; the codex TREE row surfaces the plan lane and status’s --plan flag; the capacity and role rows carry arc: zeroh-marketplace instead of a false [ROADCODE N]; arc.mjs’s docblock line for next shows --ignore-capacity; entrySkeleton’s unreachable unknown-driver arms deleted with the reachability rationale in a comment.',
        how: 'Five small edits; both step verifies green; driver + role + codex suites 117/117 (the skeleton change is pinned by the existing register/verify tests).',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'The arc-tag choice for consumer-repo phases is `arc: zeroh-marketplace` (the repo whose roadmap shipped them) — a convention this row pair establishes; other arc-less rows keep the ROADCODE default they genuinely belong to.',
      },
    },
    {
      id: '13.5',
      title: 'Protocol trues — one-home cites, R28 tags, migration note, ledger re-measure',
      problem:
        'Seven protocol drifts: stale judgeModel-home cites in arc-sweep/validate-arc; the do-arc --executor-id gloss attached to the wrong placeholder; using-zeroh-roadmap lost two R28 honor-system tags and carries a pause-row contradicting the row below it; the schema migration notes still claim additive-only after the executionMode REMOVAL; phase-file-contract advertises a review-phase interfaces grep that does not exist; DESIGN-NOTES’ parallel resolution names an option not in its own list; the DIET-LEDGER’s last measurement no longer reproduces (+42 unledgered bytes, budget at exact ceiling).',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/arc-sweep/SKILL.md',
          description:
            'Point the judgeModel-home cites at MULTI-DRIVER.md §1 (arc-sweep and validate-arc; both replacements are SHORTER than the stale text — measure must not grow) → verify: bash -c "! grep -rn \'judgeModel\' plugins/zeroh-roadmap/skills/arc-sweep/SKILL.md plugins/zeroh-roadmap/skills/validate-arc/SKILL.md | grep -F \'review-phase\'"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
          description:
            'Move the session-dir gloss back behind <YOUR SESSION ID> and add a ≤1-line executor-id source (the id you mint for the subagent, unique per spawn) — net bytes ≤ 0 or ledger-funded → verify: bash -c "grep -qF \'unique per spawn\' plugins/zeroh-roadmap/skills/do-arc/SKILL.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md',
          description:
            'Restore the two (honor-system: …) R28 tags the diet deleted and true the pause-arc routing row to match the resume row + do-arc’s library-form ruling — funded by an equal in-file trim with a DIET-LEDGER row → verify: bash -c "test $(grep -c \'honor-system\' plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md) -ge 2"',
        },
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            'Append the v12 migration note: executionMode REMOVED (phase 11), NOT additive — a consumer object literal still carrying the key becomes a tsc excess-property error on schema sync; name the one-line consumer sweep. Byte-sync lib/roadmap/schema.ts → verify: bash -c "grep -qF \'v12\' plugins/zeroh-roadmap/templates/schema.ts && cmp plugins/zeroh-roadmap/templates/schema.ts lib/roadmap/schema.ts"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/plan-phase/references/phase-file-contract.md',
          description:
            'Re-word the interfaces claim (here and the plan-phase SKILL line citing it) to the checks that EXIST: executor-side consumes grep (do-phase + executor card); name produces as reviewer-judgment material, not a wired grep → verify: bash -c "! grep -qF \'review-phase can\' plugins/zeroh-roadmap/skills/plan-phase/references/phase-file-contract.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/DIET-LEDGER.md',
          description:
            'One dated reconciliation section: map the parallel-dispatch resolution onto its own options list (option 1 ratified; the using-zeroh-roadmap documentation half lands via this phase’s 13.5 row), correct DESIGN-NOTES :370’s stale executionMode cite in place, and re-measure the do-arc flow recording the true numbers (including the +42 B of phase-11 gate-round growth) with the assert still green → verify: bash -c "node plugins/zeroh-roadmap/bin/roadmap.mjs measure --flow do-arc --assert 13257 >/dev/null && grep -qF \'reconciliation\' plugins/zeroh-roadmap/DIET-LEDGER.md"',
        },
      ],
      acceptanceCriteria: [
        'measure --flow do-arc --assert 13257 exits 0 after ALL skill edits; every edited cite points at the current one home; the ledger reproduces today’s bytes',
      ],
      transparencyReport: {
        whatWasDone:
          'Six protocol trues: judgeModel cites → MULTI-DRIVER.md §1 (shorter, the true home); do-arc session gloss re-attached to SESSION ID and --executor-id got its source ("an id you mint, unique per spawn"); using-zeroh-roadmap regained both R28 honor-system tags and a truthful pause row; schema v12 migration note names the executionMode REMOVAL and the consumer sweep (synced); the interfaces reviewer-grep overclaim replaced with the wired execution-side contract in BOTH homes (contract reference + schema docblock); DESIGN-NOTES :370 marked inventory-of-record and the resolution mapped onto OPTION 1 explicitly; DIET-LEDGER reconciliation section records the unledgered +42 B and the fresh measurement.',
        how:
          'One scripted batch of anchored replacements; the cite shortenings FUNDED every addition: measure went 13,257 (exact ceiling) → 13,252/13,257 with the assert green — 5 tokens of headroom restored. All six step verifies green; schema suite PASS; measure suite 10/10.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The pause-arc row now says "stop anywhere; files are the truth" — the resume row directly below carries the do-arc route, so the pair reads as one; a longer reconciliation would have cost metered bytes for restated content.',
      },
      files: [
        'plugins/zeroh-roadmap/skills/arc-sweep/SKILL.md',
        'plugins/zeroh-roadmap/skills/validate-arc/SKILL.md',
        'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
        'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md',
        'plugins/zeroh-roadmap/templates/schema.ts',
        'lib/roadmap/schema.ts',
        'plugins/zeroh-roadmap/skills/plan-phase/SKILL.md',
        'plugins/zeroh-roadmap/skills/plan-phase/references/phase-file-contract.md',
        'plugins/zeroh-roadmap/DESIGN-NOTES.md',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
      ],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
    },
    {
      id: '13.6',
      title: 'Derived records rejoin the corpus',
      problem:
        'Four projections drifted from what they project: POLYSEAT parses as status planning with every member done and the eval finalized; the scorecard was regenerated at 7 records with 10 on disk; ROADMAP.md is untouched scaffold describing a process that never happened; orientation.html foots v0.30.0 and names the wrong Codex model. Plus three record trues: backlog tier-header residue, phase-6’s absent timestamps, phase-6’s owed independent read dischargeable by this retro review.',
      steps: [
        {
          file: 'roadmap/arcs/POLYSEAT.arc.ts',
          description:
            'Set status: \'merged\' (the members ARE in mainline history) with a dated comment citing the eval’s recorded no-sweep-report dock — the honest terminal state, not a claim a sweep ran → verify: bash -c "grep -qF \\"status: \'merged\'\\" roadmap/arcs/POLYSEAT.arc.ts"',
        },
        {
          file: 'roadmap/ROADMAP.md',
          description:
            'Rewrite lean from the real process: the phase/arc lifecycle actually run (plan-phase → review-phase queue → do-phase with kind-gates + rounds → curate → complete; arcs via plan-arc/do-arc), the real commands (roadmap status/gate/capacity), the real branch (feat/roadmap-arcs, no develop), created-date trued; delete the scaffold’s dead references (collect-phase-metrics gate, reviews/changelog.json emit); ONE evidence-location line: gate reports under roadmap/.gate/ are checkout-local (gitignored) — the durable substance lives in the committed .peval.json slot rows, so phase-record gate citations are local-evidence pointers → verify: bash -c "! grep -qF \'YYYY-MM-DD\' roadmap/ROADMAP.md && grep -qF \'do-phase\' roadmap/ROADMAP.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/docs/orientation.html',
          description:
            'True the footer (written-against version → v0.34.0 with today’s date) and the Codex model line (gpt-5.6-sol per drivers.mjs, the one home) — content edits only where stale, no redesign → verify: bash -c "grep -qF \'gpt-5.6-sol\' plugins/zeroh-roadmap/docs/orientation.html && grep -qF \'refreshed 2026-08-26\' plugins/zeroh-roadmap/docs/orientation.html"',
        },
        {
          file: 'roadmap/backlog.ts',
          description:
            'Delete the two orphaned tier-header comment blocks describing completed phases (the file’s own queue-only docblock forbids them); phase-6 metrics: backfill startedAt/completedAt/haltCount from git (first task commit 04c2a98-adjacent, completion commit) or record in the phase notes why they cannot be derived; append one phase-6 notes line discharging the owed independent read by citing this retro review (three fresh agents read the post-e73c6be tree, 2026-08-26) → verify: bash -c "! grep -qF \'ARC POLYSEAT tier\' roadmap/backlog.ts && grep -qF \'startedAt\' roadmap/phases/phase-6.phase.ts"',
        },
      ],
      acceptanceCriteria: [
        'A stranger reading only the records reconstructs POLYSEAT as finished, ROADMAP.md describes the process that actually runs (including where gate evidence durably lives), and no record still owes phase 6 anything',
      ],
      files: [
        'roadmap/arcs/POLYSEAT.arc.ts',
        'roadmap/ROADMAP.md',
        'plugins/zeroh-roadmap/docs/orientation.html',
        'roadmap/backlog.ts',
        'roadmap/phases/phase-6.phase.ts',
      ],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'POLYSEAT carries status merged with the dated no-sweep rationale; ROADMAP.md rewritten to the process actually run (lifecycle, evidence homes including the checkout-local .gate note, real branch strategy, the two prime rules); orientation.html trued (gpt-5.6-sol per the drivers registry; footer records written-against v0.30.0 AND refreshed-against v0.34.0); backlog orphan tier-headers deleted; phase-6 metrics backfilled from git (startedAt/completedAt/haltCount, commit-derived, provenance comment) and its owed independent read discharged in notes by citing the retro review.',
        how:
          'Anchored replacements + a full ROADMAP.md rewrite; phase validate green on 6 and 13; POLYSEAT status verified via typed import (note: the tsx dynamic-import wraps CJS interop — the object sits at m.default.default; my plan-time A5 probe read the wrapper and was vacuous — the CLAIM held via the grep-absence check, and the post-edit verification used the unwrapped read).',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The orientation footer deliberately keeps the written-against v0.30.0 provenance beside the refresh line — the plan verify demanded its absence and was amended in place (erasing provenance would be the dishonest form); scorecard regeneration moved to 13.8 by review so it postdates the gateRounds truing.',
      },
    },
    {
      id: '13.7',
      title: 'v0.34.0 — the release axis carries information',
      problem:
        'Phase 11 shipped a new public verb, a config block, a flag and a schema-field removal unversioned, and never surfaced the owed bump; the v0.33.0 bump message names one phase but released nine; there is no CHANGELOG, so the version axis reconstructs nothing.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/CHANGELOG.md',
          description:
            'Author the first CHANGELOG from the record trail: entries for 0.30.0 (gauntlet), 0.31.0 (planning lean + followup lifecycle), 0.32.0 (architect fable default), 0.33.0 (honest scope: phase 10 AND the nine unnamed phases that rode it — POLYSEAT arc, driver/eval/attribution machinery, handoff skill), 0.34.0 (phase 11 capacity admission + executionMode removal + this remediation). Keep entries to shipped-surface bullets, one screen total → verify: bash -c "grep -qF \'0.34.0\' plugins/zeroh-roadmap/CHANGELOG.md && grep -qF \'0.31.0\' plugins/zeroh-roadmap/CHANGELOG.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/package.json',
          description:
            'Bump 0.33.0 → 0.34.0 in package.json + .claude-plugin/plugin.json, regenerate the five manifests via node scripts/emit-manifests.mjs (never hand-edit), and append the discharge entry to phase-11’s executionResult.surfaced[] ("version bump owed — surfaced late; discharged by v0.34.0, phase 13") → verify: bash -c "cd plugins/zeroh-roadmap && node scripts/emit-manifests.mjs --check && grep -qF \'0.34.0\' package.json && grep -qF \'DISCHARGED by v0.34.0\' ../../roadmap/phases/phase-11.phase.ts"',
        },
      ],
      acceptanceCriteria: [
        'emit-manifests --check exits 0 at 0.34.0; the CHANGELOG maps every minor since the gauntlet to its real shipped surface; phase-11’s record no longer silently omits the bump decision',
      ],
      files: [
        'plugins/zeroh-roadmap/CHANGELOG.md',
        'plugins/zeroh-roadmap/package.json',
        'plugins/zeroh-roadmap/.claude-plugin/plugin.json',
        'roadmap/phases/phase-11.phase.ts',
      ],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'CHANGELOG.md authored from the record trail (0.30.0 gauntlet → 0.34.0), with 0.33.0 explicitly naming the nine phases that rode it unnamed — the release-axis gap the retro found; version bumped to 0.34.0 in package.json + plugin.json with the five generated manifests regenerated (--check exit 0); phase-11 executionResult.surfaced[] gained the honest late-surfaced/discharged bump entry.',
        how: 'Emitter-regenerated manifests (never hand-edited); both step verifies green; phase validate green on 11 and 13. The verify’s lowercase discharge token was trued to the record’s wording rather than editing the record to fit the verify.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The CHANGELOG is reconstructed from records, not from a contemporaneous log — 0.31.0/0.32.0 entries are summaries of their bump commits and phase records, and the 0.33.0 rider list is the retro’s enumeration, not a per-commit audit.',
      },
    },
    {
      id: '13.8',
      title: 'One gateRounds counting convention, then the scorecard rejoins the corpus',
      problem:
        'executionResult.gateRounds is counted two ways across the ten done records — phases 1/2/4/5 count agent rounds (round ≥ 1) only, phases 3/6/8/9/10/11 count every round including the round-0 quality pass — and eval-score.mjs means over the raw number, so the POLYSEAT code-confidence gateRoundsMean mixes conventions. Separately the scorecard was last regenerated at 7 phase records with 10 on disk.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            'The gateRounds field docblock DEFINES the convention: every recorded round INCLUDING round 0 (the majority + current practice); byte-sync lib/roadmap/schema.ts → verify: bash -c "grep -qF \'including round 0\' plugins/zeroh-roadmap/templates/schema.ts && cmp plugins/zeroh-roadmap/templates/schema.ts lib/roadmap/schema.ts"',
        },
        {
          file: 'roadmap/phases/phase-1.phase.ts',
          description:
            'True the four outlier records to the convention (phases 1, 2, 4, 5: each +1, a count correction not testimony, dated same-line comment naming phase 13) → verify: bash -c "grep -qF \'phase 13\' roadmap/phases/phase-1.phase.ts && grep -qF \'phase 13\' roadmap/phases/phase-5.phase.ts"',
        },
        {
          file: 'roadmap/arc-evals/scorecard.json',
          description:
            'LAST: regenerate via node plugins/zeroh-roadmap/bin/roadmap.mjs eval scorecard (never hand-edit) so the mean reflects one convention and all ten records feed the cells → verify: bash -c "python3 -c \"import json,glob;n=json.load(open(\'roadmap/arc-evals/scorecard.json\'))[\'notes\'];t=[x for x in n if \'phase record\' in x][0];import re;f,sup=map(int,re.findall(r\'(\\\\d+) (?:phase )?record\',t));exit(0 if f+sup==len(glob.glob(\'roadmap/arc-evals/*.peval.json\')) else 1)\""',
        },
      ],
      acceptanceCriteria: [
        'Every done record counts gateRounds under the one documented convention; the regenerated scorecard notes name ten phase records',
      ],
      files: [
        'plugins/zeroh-roadmap/templates/schema.ts',
        'lib/roadmap/schema.ts',
        'roadmap/phases/phase-1.phase.ts',
        'roadmap/phases/phase-2.phase.ts',
        'roadmap/phases/phase-4.phase.ts',
        'roadmap/phases/phase-5.phase.ts',
        'roadmap/arc-evals/scorecard.json',
      ],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'The gateRounds docblock now DEFINES the convention (every recorded round including round 0 = the array length) and names why it matters (eval-score means over the number); phases 1, 4, 5 trued +1 with dated same-line comments; phase 2 needed no change (its array was already 5 — the retro’s outlier list was one phase too wide, verified by counting every record). Scorecard regenerated after the truing.',
        how:
          'Counted array length vs field for all ten done records before editing: six matched the convention, three were short, one (phase 2) already matched. Schema synced byte-identical; validate green on all four. The scorecard’s notes account for all ten records as 5 fed + 5 SUPPRESSED (arc-covered dedupe) — the plan’s naive \'10 phase record\' verify was wrong about the generator’s own accounting and was trued at execution to assert fed+suppressed equals the .peval.json count.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Truing the counts shifts POLYSEAT’s recorded gateRoundsMean (the eval record itself is a dated artifact and was NOT rewritten — evals are testimony, not derived state); the scorecard reflects the corrected corpus going forward.',
      },
    },
  ],
  notes:
    'interview: skipped — scope is the user-ratified synthesis of the three-reviewer retro (2026-08-26, "plan it, review then do it"). ' +
    '## Hypotheses (root cause of the drift class): (1) CONFIRMED — derived and release records have NO regeneration trigger wired to the events that invalidate them: the scorecard regenerates only on manual eval runs, version bumps are human-gated but nothing FORCES the surfaced[] prompt (phase 10 surfaced it, phase 11 forgot), arc status is hand-set, and doc footers date themselves; every drifted artifact drifted exactly at such an ungated event. Evidence: the execution-side records (gates, metrics, pevals), which DO have wired writers, reconcile byte-for-byte across all ten phases. (2) REFUTED — gate indiscipline: every phase in the range carries a green authoritative gate and recorded rounds; no drift lives inside a single phase’s own artifacts. (3) NOT TESTED — whether an audit check should own derived-record freshness (scorecard age vs peval count, arc status vs member statuses); named as a candidate follow-up, not built here. ' +
    'DECISIONS MADE AT PLAN TIME (grounded, with precedents): POLYSEAT terminal status = merged (factually in mainline; the eval already records the sweep skip — claiming swept would lie); intent-validator frontmatter → fable mirrors commit 4d3bf6c’s software-architect precedent verbatim, arc-eval-judge untouched (its sonnet pin is a documented design ruling); the role seam is a thin read-only verb (house arm.mjs pattern) — spawner SKILL wiring is deliberately deferred (budget at exact ceiling; the verb + ledger truth close the finding, prose wiring is a follow-up once headroom exists). ' +
    'BUDGET RAIL: assumption 4 pins the zero-headroom constraint; 13.5 is the only task allowed to touch metered skills and its acceptance criterion re-runs the assert after ALL edits. ' +
    'userFacing: false — plugin/CLI/records machinery; no consumer app surface, no flag applies. Zero-test tasks are legitimate: 13.1 is a proven-by-green move, 13.4-13.7 are docs/records/release acts; the executable-logic fixes (13.2, 13.3) are tdd.',
})
