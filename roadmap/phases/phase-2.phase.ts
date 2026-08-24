import { definePhase } from '@/lib/roadmap/schema'

/**
 * POLYSEAT plane 2 of 4 — the driver registry.
 *
 * Launch semantics for non-Claude models are hardcoded: cli/commands/codex.mjs
 * launch() spawns a literal `codex exec --dangerously-bypass-approvals-and-sandbox`.
 * Adding grok — or any harness — means editing the launcher; capabilities are
 * assumed, not proven (the codex plugin_hooks nuance and the 0.145+ agent_type
 * caveat were both discovered only by probing). The registry makes a new driver
 * ONE verified entry, and makes "verified" mean pasted provenance.
 *
 * Schema hazard this phase also closes (architect risk 6): driver.lane is a
 * CLOSED enum `z.enum(['session','codex'])` at templates/schema.ts — a third
 * driver's phase file fails its import-time parse and reads as corruption.
 */
export default definePhase({
  phase: 2,
  name: 'Driver registry — one home for launch semantics, probed capabilities, open lane field',
  status: 'done',
  completedDate: '2026-08-24',
  arcId: 'POLYSEAT',
  plannedBy: { model: 'claude-opus-5[1m]' },
  category: 'feature',
  kind: 'logic',
  source:
    'Arc POLYSEAT plane 2 — designRef MULTI-DRIVER.md §2 Driver registry; rationale in roadmap/arc-prompts/POLYSEAT-execution-prompt.md.',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/cli/commands/driver.mjs',
    'plugins/zeroh-roadmap/templates/schema.ts',
    'plugins/zeroh-roadmap/cli/lib/validate.mjs',
    'plugins/zeroh-roadmap/bin/roadmap.mjs',
    'lib/roadmap/schema.ts',
  ],
  stakeholderDemo:
    'Adding a new AI model as a worker is one registry entry plus one verification run — no launcher edits — and a phase file written by any driver always loads instead of reading as corruption.',
  assumptions: [
    {
      claim: 'The codex argv is still hardcoded in launch() — the seam this phase extracts.',
      verify:
        "grep -qF \"'--dangerously-bypass-approvals-and-sandbox'\" plugins/zeroh-roadmap/cli/commands/codex.mjs",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'driver.lane is still the closed two-member enum at import time.',
      verify:
        "grep -qF \"lane: z.enum(['session', 'codex'])\" plugins/zeroh-roadmap/templates/schema.ts",
      onFalse: 'ESCALATE',
    },
    {
      claim:
        "zeroh-sdd's probe pattern (the report shape this phase's verify command copies) still exists in the sibling plugin.",
      verify: 'test -f plugins/zeroh-sdd/scripts/codex-hook-discovery.mjs',
      onFalse: 'ESCALATE',
    },
  ],
  notes:
    "DESIGN (locked, architect risk 8): the registry lives in CODE — cli/lib/drivers.mjs — never in roadmap.config.json (capabilities are per-HOST facts; the config is a per-CONSUMER binding; a context-free verified flag there would become a lie the moment the host changes — the committed verifiedAt on a DRIVERS entry stays honest ONLY because it is host-stamped evidence: {date, host, command, output} names where it was proven, never a claim about YOUR host). Full probe reports go to consumer-root .building/driver-verify-<id>.json — at HEAD that path is untracked but NOT ignored (only plugins/zeroh-roadmap/.gitignore covers .building/; the repo root has no .gitignore), so 2.3 adds the root ignore entry in the same commit: provenance is per-host and must never be committable. Entry schema: { id, family, bin, launch: { argv, promptChannel, sandboxPosture }, resume, roleCapabilities, verifiedAt: { date, host, command, output } } — verifiedAt carries PASTED probe output, never a bare boolean. Populated entries: codex (extracted from launch()), claude (child-CLI: `claude -p --agents '<json>'`, verified on this host 2026-08-23). grok: NO entry — `roadmap driver register` refuses an unverified id, which is how the empty slot stays honest (arc honesty rail 1).\n\nLANES STAY: the LANES table in codex.mjs owns lane mechanics (journal/report/sentinel) — orthogonal to drivers (singleSeam 4). launch() keeps its detach/stdin/journal shape and sources ONLY argv from launchArgv('codex', …); the literal spawn argv is deleted in the same commit, and the ratchet test (singleSeam 2) greps that no model-binary argv exists outside drivers.mjs.\n\nLANE FIELD OPENING (architect risk 6, user requirement 'grok later without surgery'): templates/schema.ts PhaseExecutionResultShape.driver.lane widens to z.string().min(1) so a phase file ALWAYS loads regardless of who wrote it; the 'is this a known driver/lane?' check moves to the validation ENGINE — cli/lib/validate.mjs, where result.warnings is assembled (bin/validate-roadmap-file.mjs only PRINTS warnings, and `roadmap phase validate` shares the engine — a bin-side check would miss the CLI face) — as a WARNING that names the unknown id and the known set (read from drivers.mjs + 'session') — a warning, never a parse failure, so 700+ historical files and future drivers both survive. NOTE the arc's decision sweep worded this as 'a superRefine naming unknown ids': a Zod superRefine issue FAILS the parse (resurrecting the corruption bug) and consumer copies of schema.ts have no drivers.mjs to read, so the validator warning is the mechanism that honors risk 6's intent; the phase deviates from the sweep's wording deliberately. Downstream shapes are already open strings (attribution.drivers[].lane, ScorecardDriverCellShape.lane — verified by the architect), and lane SEMANTICS stay 'how it was launched' so no scorecard cohort re-partition occurs (risk 7: no baseline reset).\n\nVERIFY VERB: `roadmap driver verify <id>` probes — bin exists, --version, codex `features list` parse (multi_agent/hooks), a read-only exec smoke — sourcing the binary from resolveDriver(id).bin (never a literal; the 2.2 ratchet holds), and writes the PASS/FAIL table + interpretation + pasted evidence to .building/driver-verify-<id>.json, exit 0/2; shaped after plugins/zeroh-sdd/scripts/codex-hook-discovery.mjs (report structure only — not its hooks.json backup dance, and note its markerScript is Windows-only). `roadmap driver register <id>` contract: without FRESH PASS provenance it refuses, exit 2, naming `roadmap driver verify <id>` as the remediation — fresh = .building/driver-verify-<id>.json present at the consumer root, its host field equal to the current os.hostname() (a copied file is not proof), every probe pass:true; WITH it, register exits 0 and prints the drivers.mjs entry skeleton to paste — guidance only, it NEVER edits drivers.mjs (the registry is committed code a human lands). TREE row added in bin/roadmap.mjs.\n\nCONSUMER SYNC: the lane widening is a templates/schema.ts edit — byte-sync this repo's lib/roadmap/schema.ts in the same commit (the copies are byte-identical at HEAD, diff -q exit 0; scripts/schema.test.ts asserts SHAPES only and 'trusts the sync' per its own comment — the diff clause in 2.4's verify is the sync guard); azure_private_agent / mudarabah2 / viki-agent pick it up at their next plugin bump (named, not chased).\n\nREVIEW RATIFICATIONS (Mode A, 2026-08-23, judged by claude-fable-5): testMode 'tdd' ratified for all four tasks (each pairs impl + test files; 2.2 and 2.4 carry recorded falsifications); no testScope or reviewScope relaxations declared; userFacing none — CLI + schema only, the arc's design gate recorded the UX skip.",
  gateRounds: [
    {
      round: 1,
      agent: "code-reviewer",
      verdict: "findings-fixed",
      summary:
        "6 findings (1 HIGH, 4 MEDIUM, 1 LOW), all fixed in 227cfe0. HIGH: runProbe matched expect tokens as SUBSTRINGS, so a codex feature table reading 'hooks removed false' passed the capabilities probe, and 'plugin_hooks removed false' alone satisfied the 'hooks' token with the real feature absent \u2014 the reviewer reproduced both against a fake binary. Fixed with line-anchored regexes carrying the value column and falsified both ways (value-false FAIL, plugin_hooks-only FAIL, real host still PASS). MEDIUM: the claude entry declared hooks/plugins that its own pasted evidence never showed (now records only subagents + headlessPrint); entrySkeleton interpolated raw probe output into a template literal, so a backtick in 'codex exec --help' made the entry it told a human to paste unparseable JavaScript (now JSON-encoded, with a backtick in the fake fixture and a parse assertion, falsified by restoring the interpolation); the done-flip test carrying the not-gated-on-isNewToGit rule never committed its fixture, so the placement it exists for was unguarded (now committed, falsified by gating the lint \u2014 only that case reds); register printed an unqualified 'is verified' without the report's interpretation. LOW: a why-the-rule-exists docblock paragraph trimmed to its operative sentence. The reviewer independently re-ran ratchet mutation 1 and reproduced the quoted RED exactly, re-ran both verifiedAt commands byte-for-byte on this host, and confirmed the schema byte-sync plus the absence of any exhaustive match on driver.lane.",
    },
    {
      round: 2,
      agent: "code-reviewer",
      verdict: "findings-fixed",
      summary:
        "7 findings (1 HIGH, 4 MEDIUM, 2 LOW). Six fixed in d34a6b0; one surfaced. HIGH: the round-1 HIGH fix had NO regression guard \u2014 the reviewer re-planted the exact pre-fix substring matcher in a scratch copy and driver.test.mjs stayed 8/8 green, so the one defect that mattered was the one nothing held. Four feature-table cases now decide the capabilities probe. MEDIUM: the replacement regex over-constrained the STATUS column, so a real codex table reading 'hooks under development true' would have gone FAIL and refused registration on a capability the table reports ON (crying wolf) \u2014 widened to the value column only. MEDIUM: register printed an entry skeleton straight from the report file without checking whose binary it probed, so codex's evidence filed as driver-verify-grok.json registered grok on it, printing 'undefined' where the interpretation should be \u2014 freshProvenance now refuses a foreign-binary report, a missing interpretation, and an id absent from the registry. MEDIUM: task 2.1's report claimed 'Capability values are PROBED, not declared' while its own limitations conceded roleCapabilities is unasserted \u2014 narrowed to what holds. LOW: a cwd outside a git repo was the one path answering with a stack trace; the TREE row rendered '[ROADCODE 2]' for a command no ROADCODE phase owns, now tagged by its arc. SURFACED, not fixed: UNRECORDED_DRIVER in cli/lib/eval-score.mjs guesses lane 'session' for every unattributed phase, inflating the session cohort \u2014 pre-existing, outside this diff, and unblocked BY this phase's lane widening; it belongs to plane 3, which owns attribution. Reviewer confirmed the schema byte-sync survived both fix rounds and drove falsifications A/B/C in scratch copies.",
    },
    {
      round: 3,
      agent: "code-reviewer",
      verdict: "findings-fixed",
      summary:
        "5 findings (4 MEDIUM, 1 LOW), all fixed in 7c32a95; the reviewer also re-drove the round-2 falsifications and confirmed each reproduces. The substantive one: the capability patterns were NOT line-confined despite the docblock saying so, because JS \\s matches \\n \u2014 demonstrated end-to-end with a fake codex printing 'hooks removed false' followed by a bare 'true' line, which the probe certified PASS at exit 0, the honesty rail approving a feature the table reports OFF. Separators are now [ \\t] and a fifth table case pins the bridged-row form at exit 2. Second: the round-2 stack-trace fix used a bare `catch {}`, so git missing inside a REAL checkout was misdiagnosed as 'not a git repository' with a remediation that cannot help \u2014 the cosmetic fix had traded away the actual error, which now rides along as 'git said: <cause>' with a test asserting it. Third: `date` was the one entrySkeleton input freshProvenance never validated, so an undated report registered at exit 0 and printed date: \"undefined\" into the entry a human is told to paste into committed code; the never-prints-undefined pin now covers both fields. Fourth: task 2.3's report stated three of the six refusal conditions. LOW: the module docblock's FRESH definition under-specified the same contract. Verified clean by the reviewer: no round-1 or round-2 fix regressed, the two schema copies still byte-identical, all four tasks' acceptance criteria met, the prefix binding cannot be defeated by a bin that is a prefix of another, no stale consumer of the widened lane, and docblock discipline holds on every added line.",
    },
    {
      round: 4,
      agent: "code-reviewer",
      verdict: "findings-fixed",
      summary:
        "4 findings (2 MEDIUM, 2 LOW), all fixed in 860fc6e, and a convergence judgement: every earlier falsification narrative reproduces exactly as written (the reviewer re-drove six mutations including the 2.2 ratchet's :212 quote and the 2.4 closed-enum restoration, all verbatim), both registry entries' pasted provenance re-proves byte-identically on this host, the two schema copies are byte-identical, and all four tasks' acceptance criteria hold \u2014 what remained was one function applying its own distrust discipline to most inputs but not all. MEDIUM: the capability patterns read the row's LAST token rather than its value column, so 'hooks removed false true' (a trailing default column) and 'hooks removed false default was true' were both certified ON \u2014 the round-3 bridged-row hole rotated from vertical to horizontal; replaced with a tokenising featureOn() that requires the row whose FIRST token is the feature to end in true and to state no other verdict before it. MEDIUM: freshProvenance validated top-level fields but never a probe ROW, so a row missing 'output' silently dropped that evidence from the pasteable entry, 'output: true' rendered a boolean into it, and a null element threw an uncaught TypeError at exit 1 \u2014 against the one input this command exists to distrust. LOW: a report with no 'host' refused with the literal text 'undefined' and misdiagnosed a malformed report as a foreign-host copy. LOW: '--agents' was satisfied by '--agents-legacy' \u2014 the round-1 longer-name hole surviving on the claude side, which had no adversarial fixture at all. Reviewer agreed with routing UNRECORDED_DRIVER's lane guess and ensureBuildingIgnored's root resolution to plane 3.",
    },
    {
      round: 5,
      agent: "code-reviewer",
      verdict: "findings-fixed",
      summary:
        "CAP ROUND. 5 findings (3 MEDIUM, 2 LOW), all fixed in a521f38, each mutation-proven by the executor before commit. The important one broke a landed acceptance criterion: DRIVERS[id] walked the prototype chain, so resolveDriver('constructor') RETURNED a function and 'toString'/'__proto__' resolved instead of refusing \u2014 task 2.1 requires an unknown id to throw naming the known set, never a silent undefined \u2014 and `verify toString` crashed with a stack trace; the probe-set lookup had the identical hole. Both now use Object.hasOwn, pinned across five prototype keys at both entry points. Second: freshProvenance dereferenced the parsed document before proving it an object, so a file containing literally `null` threw an uncaught TypeError at exit 1 \u2014 the same class round 4 closed for a probe ELEMENT but not for the document; now proven a non-array object first, pinned for null/array/number/string. Third: task 2.3's transparencyReport still credited the round-1/2 line-anchored regex that round 4 had replaced, so the durable record described an honesty rail the code no longer used; it now carries the real four-round history. LOW: featureOn returned on the FIRST matching row, so a table stating one feature twice with opposite verdicts was decided by row order rather than refused as self-contradicting; LOW: `date` was proven non-empty but never a date, so an unparseable value was stamped truncated to ten characters into the pasteable entry. The reviewer also drove 19 adversarial feature tables (CRLF, tabs, pipes, NBSP, True/TRUE, name-only rows, JSON-shaped output) and found 18 decide as a careful human would, every divergence failing CLOSED, and re-drove the 2.2 ratchet and 2.4 enum falsifications verbatim including the :212 line number. HONEST GAP: because this was the cap round, the five fixes it produced did NOT receive an independent sixth review \u2014 they carry the executor's own mutation proofs (four drives, each reddening exactly its own case) and a green full gate, which is weaker evidence than a fresh reviewer.",
    },
  ],
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1141,
      total: 1141,
      notes:
        'The consumer binds ONE slot: unit = the whole plugin suite (node --test over the bin/cli/hooks/scripts/test files + scripts/schema.test.ts), plus the plugin-native history-comments scan of the phase diff (0 findings). lint/types/build/integration/e2e are declaredAbsent in roadmap.config.json, not skipped by this phase.',
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
  metrics: {
    commits: 1,
    linesAdded: 1130,
    linesRemoved: 29,
    filesChanged: 14,
    testsAtStart: 1096,
    testsAtEnd: 1141,
    testsAdded: 45,
    startedAt: '2026-08-24T10:59:17.000Z',
    completedAt: '2026-08-24T13:26:37.000Z',
    haltCount: 0,
  },
  executionResult: {
    phase: 2,
    status: 'done',
    driver: { model: 'claude-opus-5[1m]', lane: 'session' },
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      "Onboarding order for a driver with NO entry yet: `roadmap driver verify <id>` sources its binary from resolveDriver(id).bin, so it refuses an unregistered id (exit 2, naming the known set) — a brand-new driver must have a draft entry landed in cli/lib/drivers.mjs before it can be probed. The register-refuses-unverified rail (arc honesty rail 1) holds either way, and resolveDriver's message now states the real order instead of naming a command that cannot run. If plane 4 wants a probe-before-entry path it needs a deliberate --bin door, never a silent fallback.",
      "The codex exec-smoke probe runs `<bin> exec --help`: it proves the exec entrypoint exists and parses, NOT that a model turn succeeds. The probe name, the recorded command and the interpretation all say only that, and no roleCapabilities value is derived from it — but a reader of a green verify report should not take it for end-to-end proof.",
      "The claude entry's launch.argv (['-p', '--agents', <json>]) is NOT pinned by a literal fixture the way codex's is, because nothing launches it yet. Plane 4 is its first caller and should pin it at the moment it lands one, or that entry stays a declaration with no behavioural guard.",
      "Widening the SHARED DriverShape opened PhaseEvalRecord.attribution.driver.lane with it, so two checks in plugins/zeroh-roadmap/scripts/schema.test.ts that pinned the closed vocabulary were re-pinned to the open one (both still reject a blank lane). That file is outside this phase's planned files[]; the change is a contract update, not a weakening, but it edits a shape phase 1 landed.",
      "The driver.model binding phase 3 task 3.1 step 1 requires was deliberately left to THAT task, whose step text instructs adding it, sourced from the driver-verify probe this phase built. Exactly one home; phase 2's entry schema stays the one its notes locked.",
      "The gate hit its 5-round cap WITH findings, so the five fixes round 5 produced (Object.hasOwn on both registry lookups, the document-is-an-object check, the unparseable-date refusal, the contradicting-row refusal, and the task-2.3 report correction) never received an independent sixth review. They carry the executor's own mutation proofs — four drives, each reddening exactly its own case and nothing else — plus a green full gate. That is weaker evidence than a fresh reviewer and is the one place in this phase where the review chain stops short of the code.",
      "Two forward-capability paths in cli/commands/driver.mjs are unreachable with only two registered drivers and so are exercised by no test: GENERIC_PROBES and interpret()'s `generic` branch, which exist so a newly landed third entry gets presence-proven with its capabilities recorded UNPROVEN. Whichever plane lands driver number three should be the one to pin them. Separately, ensureBuildingIgnored recognises only the exact lines `.building/` and `.building`, so a consumer root already ignoring `/.building/` gets a harmless duplicate entry.",
      "FOR PLANE 3 (attribution): UNRECORDED_DRIVER in cli/lib/eval-score.mjs is { model: 'unrecorded', lane: 'session' } — the model is honestly unrecorded, the LANE is a guess, so every phase with no recorded driver is counted as an in-harness session run by eval-scorecard and eval-score, inflating the very cohort the arc exists to compare against. Pre-existing and outside this diff, but THIS phase unblocks the fix: attribution.driver is DriverShape.strict(), so lane 'unrecorded' failed the closed enum and now parses. Fix is lane: 'unrecorded' plus the three eval-scorecard.test.mjs assertions pinning the literal; the new validator WARN then names it instead of the cohort absorbing it. Arc honesty rail 2 is the reason this is not cosmetic.",
      "DIET-LEDGER.md's arc-mode row cites templates/schema.ts by LINE for PhaseExecutionResultShape.driver; that anchor was already stale before this phase and the lane docblock widened the drift by a few lines. Pre-existing, outside this diff, and due a stable-anchor retarget the next time that row is touched.",
    ],
    hardStops: [],
    gateRounds: 5,
  },
  tasks: [
    {
      id: '2.1',
      title: 'drivers.mjs — the registry module with codex and claude entries',
      problem:
        'Launch semantics live as literals inside the codex command, so every new driver is a launcher edit and no capability claim is ever backed by a probe.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
          description:
            "Author DRIVERS (frozen) with codex + claude entries per the notes' schema, resolveDriver(id) (unknown id throws naming the known set), and launchArgv(id, { worktree }) returning the exact argv launch() uses today for codex → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/drivers.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/drivers.test.mjs',
          description:
            "Pin: for a sample worktree, codex launchArgv AND the entry's bin byte-compare against a literal fixture of today's spawn inputs — bin 'codex', argv ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', <worktree>, '-'] (spawn OPTIONS stay in launch(), pinned by codex.test.mjs, so bin + argv equality is what makes the extraction behaviour-preserving); resolveDriver throws on grok naming known ids → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/drivers.test.mjs",
        },
      ],
      acceptanceCriteria: [
        "launchArgv('codex', …) plus the entry's bin reproduce today's spawn inputs exactly, asserted against a literal fixture",
        "resolveDriver('grok') throws an error naming the known driver ids — never a silent undefined",
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
        'plugins/zeroh-roadmap/cli/lib/drivers.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      transparencyReport: {
        whatWasDone:
          "cli/lib/drivers.mjs landed as the frozen DRIVERS registry with codex + claude entries in the planned shape ({ id, family, bin, launch: { argv, promptChannel, sandboxPosture }, resume, roleCapabilities, verifiedAt }), plus resolveDriver(id) (throws naming the offending id, every known id, and the verify/register remediation) and launchArgv(id, opts) delegating to the entry's argv thunk. Both entries carry verifiedAt with probe output pasted verbatim from this host (codex-cli 0.144.5: hooks stable/true, multi_agent stable/true, plugin_hooks removed/false, plugins stable/true; claude 2.1.241 with --agents and -p present), stamped with date, host and the exact command.",
        how:
          "TDD: test-engineer wrote cli/lib/drivers.test.mjs blind to the implementation and ran it RED for the right reason (ERR_MODULE_NOT_FOUND on ./drivers.mjs, 1 fail), then the module landed and the file went 6/6 GREEN under capbuild node --test. The codex fixture is written out literally in the test ('exec', '--dangerously-bypass-approvals-and-sandbox', '-C', <worktree>, '-') and never rebuilt from the registry's own data; a second case with a different worktree pins that the path is threaded rather than baked. verifiedAt.output is PROBED and pasted verbatim — codex features list and claude --help were run on this host and their raw output is what that field carries. roleCapabilities beside it is a hand-written DECLARATION with no mechanical link to the evidence; the discipline is that a human keeps it to what the pasted output shows, and gate round 1 caught the claude entry breaking exactly that. resolveDriver's message names the remediation commands 2.3 implements, so an unknown id is a routed refusal rather than a dead end. types slot: declared-none (gate run 2 --slots types GREEN).",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The claude entry's launch.argv builds ['-p', '--agents', <json>] from an `agents` option rather than a worktree, and is not pinned by a literal fixture the way codex's is: no caller launches it yet (plane 4 is the first consumer) and inventing an expectation now would either over-constrain that work or be capitulated later. It is covered only by the entry-shape/provenance sweep. resume, family, promptChannel, sandboxPosture and roleCapabilities are likewise unasserted for both entries — no acceptance criterion covers them, and a test written against values with no recorded expectation would be a second source of truth. The driver.model binding phase 3 task 3.1 step 1 needs is deliberately NOT here: that step's own text instructs adding it, sourced from the driver-verify probe 2.3 builds, so it has exactly one home and this entry schema stays the one the phase notes locked.",
      },
    },
    {
      id: '2.2',
      title: 'launch() consumes the registry; the ratchet forbids stray model argv',
      problem:
        'The literal spawn argv in codex.mjs is the parallel-system seed: as long as it exists, a second driver gets a second hardcoded launcher.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            "launch() builds its spawn from the registry — resolveDriver('codex').bin as the binary, launchArgv('codex', { worktree }) as the argv; delete the literal bin string AND the literal argv in the same commit (a surviving 'codex' bin literal is the same parallel-system seed); LANES and all detach/stdio/journal mechanics unchanged → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/drivers.test.mjs',
          description:
            "The singleSeam-2 ratchet: grep -F the cli/ tree for the QUOTED argv literal '--dangerously-bypass-approvals-and-sandbox' (quote characters included) asserting zero hits outside drivers.mjs and drivers.test.mjs's fixture. NOT `spawn('codex'` — the spawn call is multiline, so that grep already exits 1 at HEAD with the literal still present (an unfalsifiable token); the quote-inclusive form matches exactly codex.mjs's code line today and never the unquoted docblock prose. Falsify by re-adding the quoted literal to a scratch copy and confirming the red → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/drivers.test.mjs",
        },
      ],
      acceptanceCriteria: [
        'All 16 codex.test.mjs tests stay green with the registry-sourced argv',
        'The ratchet reds under its reintroduced-literal falsification, recorded in the transparencyReport',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/codex.mjs',
        'plugins/zeroh-roadmap/cli/lib/drivers.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      transparencyReport: {
        whatWasDone:
          "launch() in cli/commands/codex.mjs now spawns resolveDriver('codex').bin with launchArgv('codex', { worktree }); both the literal bin string and the literal argv array are gone from the file in the same commit. LANES, the detach/stdio/journal/liveness mechanics and every other line of the lane are untouched. drivers.test.mjs gained the singleSeam-2 ratchet: an in-process walk of the whole cli/ tree fixed-string searching for the QUOTE-INCLUSIVE token '--dangerously-bypass-approvals-and-sandbox', asserting zero hits outside lib/drivers.mjs and lib/drivers.test.mjs, with a failure message naming each offending file:line and the launchArgv remediation.",
        how:
          "The ratchet was written FIRST (test-engineer, blind to the extraction) and ran RED against the untouched tree: \"model-specific argv outside the driver registry: cli/commands/codex.mjs:210 — source it from launchArgv('codex', { worktree }) in cli/lib/drivers.mjs\". After the extraction the file is 7/7 and codex.test.mjs is 16/16 (23/23 together, capbuild node --test). GUARD MUTATION PROOF, three drives: (1) planted violation — the literal argv array put back into launch() on the real tree → RED, \"model-specific argv outside the driver registry: cli/commands/codex.mjs:212\", then reverted from a pristine copy and git diff confirmed only the intended extraction remains; (2) anchor drift — the registry's argv renamed to '--yolo' in a throwaway tree copy → LOUD, \"stale needle: '--dangerously-bypass-approvals-and-sandbox' no longer appears in lib/drivers.mjs — retarget this ratchet at the registry's current argv\", never a silent pass; (3) decoy — codex.mjs's docblock carries the UNQUOTED flag name in prose and is NOT flagged (the RED named only the code line), which is exactly why the needle is quote-inclusive rather than the plan's rejected `spawn('codex'` form. Anchor honesty is asserted three ways before the scan: the root must be a directory, the walk must yield >0 files, and BOTH allowlisted paths must appear in the walked set. types slot: declared-none (gate run 2 --slots types GREEN).",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "Two files outside this task's planned files[] were touched, both because the extraction falsified a claim they carried. codex.mjs's module-header invariant line said \"direct CLI with --dangerously-bypass-approvals-and-sandbox\", which after the extraction named a literal the file no longer holds; it now points at cli/lib/drivers.mjs as the home of bin + argv + sandboxPosture. DIET-LEDGER.md's Codex-delegation-lane row cited \"cli/commands/codex.mjs:122 spawns ['exec', '--dangerously-bypass-approvals-and-sandbox', ...]\" as its enforced-by-code evidence — a line number that had already drifted to 210 and a claim the extraction voided; the row now cites the registry entry, launch()'s consumption of it, and the ratchet, by stable anchor rather than line number. The ratchet's scope is the plugin's own cli/ tree only: a consumer repo that hand-rolled a codex launch outside this plugin is not covered by it (nothing in this arc gives the plugin a view of consumer source).",
      },
    },
    {
      id: '2.3',
      title: 'roadmap driver verify / register — probed capabilities with pasted provenance',
      problem:
        'Capabilities are currently assumed in both directions (plugin_hooks "removed", agent_type present) — the arc\'s honesty rail requires declared AND verified, with the evidence on disk.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/driver.mjs',
          description:
            "New command: `verify <id>` runs the probe set from the notes with the binary from resolveDriver(id).bin, writes consumer-root .building/driver-verify-<id>.json { date, host, probes: [{name, command, output, pass}], interpretation }, exits 0 all-pass / 2 any-fail, and adds `.building/` to the consumer-root .gitignore (absent at HEAD — the root has NO .gitignore, only the plugin dir ignores .building/); `register <id>` implements the notes' contract verbatim: refuse-without-fresh-PASS (exit 2, naming the verify command) / exit 0 printing the drivers.mjs entry guidance, never editing drivers.mjs → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/driver.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/bin/roadmap.mjs',
          description:
            "TREE row: driver: { sub: ['verify <id>', 'register <id>'], desc: 'probe a driver's real capabilities (pasted provenance); register refuses unverified' } → verify: node plugins/zeroh-roadmap/bin/roadmap.mjs --help | grep -qF 'driver'",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/driver.test.mjs',
          description:
            'Hermetic: a fake codex on PATH yields PASS rows with its actual output pasted; an absent binary yields FAIL + exit 2, never a throw; register without provenance refuses with the remediation line → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/driver.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'verify writes provenance whose output fields are the probe stdout verbatim, not summaries',
        'register on an unverified id exits 2 naming `roadmap driver verify <id>` as the remediation',
        'register with fresh all-PASS provenance (same-host, per the notes) exits 0 printing the entry guidance and leaves drivers.mjs byte-unchanged',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/driver.mjs',
        'plugins/zeroh-roadmap/cli/commands/driver.test.mjs',
        'plugins/zeroh-roadmap/bin/roadmap.mjs',
        '.gitignore',
      ],
      testMode: 'tdd',
      done: true,
      transparencyReport: {
        whatWasDone:
          "cli/commands/driver.mjs landed with both verbs. `verify <id>` runs a per-driver probe set against resolveDriver(id).bin (codex: --version, features list read for multi_agent + hooks, a read-only `exec --help` smoke; claude: --version, --help read for --agents + --print; any other registered id gets the generic presence set and an interpretation that says its capabilities are UNPROVEN). The codex feature read went through four gate rounds before it was honest: a substring test (round 1 caught `plugin_hooks removed false` satisfying `hooks`), then a line-anchored regex (round 3 caught \s crossing newlines, round 4 caught a trailing default column supplying the `true`), and finally the tokenising featureOn() that stands today — exactly one row may name the feature, it must end in `true`, and it must state no other verdict. The claude read is still a pair of line-anchored flag patterns, boundary-tightened in round 4., writes { date, host, probes: [{name, command, output, pass}], interpretation } to the consumer root's .building/driver-verify-<id>.json, ensures `.building/` is ignored at that root, and exits 0 all-pass / 2 any-fail. `register <id>` reads that provenance and refuses — exit 2, naming `roadmap driver verify <id>` — unless the file exists, is a JSON object, carries a non-empty host / parseable date / interpretation, that host equals os.hostname(), the id is in the registry, its probes are a non-empty array of objects each carrying a non-empty name / command / output, every probe passed, and every probe's command names that driver's own binary. With all of them it exits 0 printing an entry skeleton built from the report's own pasted evidence. Only the first three conditions were in the plan; gate rounds 2 through 5 added the rest, each after a case that registered a driver on evidence that was not its own, printed an absent field into the pasteable entry, or crashed with a stack trace on the one input this command exists to distrust. It never opens drivers.mjs for writing. bin/roadmap.mjs gained the driver TREE row. The repo-root .gitignore (absent at HEAD) was produced by running the real verify and carries `.building/`.",
        how:
          "TDD: test-engineer wrote cli/commands/driver.test.mjs blind to the implementation and ran it RED (7 fail / 1 vacuous, every failure the honest \"roadmap driver: not yet implemented\" dispatcher branch, not a broken harness); the command then landed 8/8 GREEN, and the three affected suites are 31/31 together. The verbatim rail is the strongest test in the file: every non-empty line of every probes[].output must be a line the fake binary actually printed, plus a run-unique marker so no assertion can be satisfied by the text drivers.mjs already carries — a summary, truncation or rewritten verdict all red. An absent binary is recorded as a FAIL row with spawnSync's error message as evidence and exits 2 with no stack frame in stderr. Real runs on this host: codex 3/3 PASS, claude 2/2 PASS, `register grok` refuses naming the verify command, `register codex` prints the skeleton with the probe output embedded. types slot: declared-none (gate run 2 --slots types GREEN).",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The .gitignore entry is written by the COMMAND (an idempotent ensureBuildingIgnored at the consumer root), not by a one-off repo edit, and this commit carries the .gitignore that running it here produced. Both of the plan's statements are then true at once, and the honesty rail holds in every consumer rather than only in this repo — a repo-only edit would leave every other consumer's per-host provenance committable. Residual, named rather than silent: `verify` requires a registry entry, because the binary comes from resolveDriver(id).bin, so a brand-new driver's onboarding order is land-a-draft-entry → verify → register-prints-the-canonical-entry. resolveDriver's unknown-id message previously named `roadmap driver verify <id>` as the remediation, which for an unregistered id is a command that cannot run; it now states the real order. The `exec-smoke` probe runs `<bin> exec --help`: it proves the exec entrypoint exists and parses, NOT that a model turn succeeds — the probe name and the interpretation line say only what was proven, and no probe result is read as evidence for a capability it did not exercise.",
      },
    },
    {
      id: '2.4',
      title: 'The lane field opens; unknown ids get NAMED by the validator, never a parse failure',
      problem:
        "driver.lane's closed enum makes a third driver's phase file fail import-time Zod — unloadable, indistinguishable from corruption. The check belongs in the validator, where it can read the registry and warn by name.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            "Widen PhaseExecutionResultShape.driver.lane from z.enum(['session','codex']) to z.string().min(1); byte-sync lib/roadmap/schema.ts in the same commit (scripts/schema.test.ts asserts shapes but trusts the sync — the negative grep is red while the enum survives, the diff clause is red on an unsynced copy; a POSITIVE grep for z.string().min(1) is useless here, that exact text already sits on the attribution and scorecard lane fields) → verify: ! grep -qF \"z.enum(['session', 'codex'])\" plugins/zeroh-roadmap/templates/schema.ts && diff -q plugins/zeroh-roadmap/templates/schema.ts lib/roadmap/schema.ts && (cd plugins/zeroh-roadmap && capbuild npx tsx scripts/schema.test.ts)",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/validate.mjs',
          description:
            "Add the registry-read WARNING in the validation ENGINE, where `const warnings =` is assembled in validateRoadmapFile (the bin only prints result.warnings, and `roadmap phase validate` shares the engine — a bin-side check would miss the CLI face): a phase whose parsed.executionResult?.driver?.lane is neither 'session' nor a DRIVERS id (static import of ./drivers.mjs — no cycle, drivers.mjs imports nothing back) warns naming the unknown value and the known set; NOT gated on isNewToGit (a data warning, not an authoring lint); bin/validate-roadmap-file.mjs needs NO edit; exit codes unchanged → verify: capbuild node --test plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs',
          description:
            "A phase file with lane 'grok-exec' PARSES (import-time survives — the corruption bug is dead) and validate emits the named warning; falsify the fix by restoring the closed enum in a scratch schema and asserting the old parse failure returns → verify: capbuild node --test plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs",
        },
      ],
      acceptanceCriteria: [
        "A phase file carrying an unknown lane loads and validates with a WARNING naming the value and known ids — exit code unchanged",
        'The falsification (closed enum restored → parse failure returns) is recorded in the transparencyReport',
      ],
      files: [
        'plugins/zeroh-roadmap/templates/schema.ts',
        'lib/roadmap/schema.ts',
        'plugins/zeroh-roadmap/cli/lib/validate.mjs',
        'plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      transparencyReport: {
        whatWasDone:
          "DriverShape.lane widened from z.enum(['session', 'codex']) to z.string().min(1) in templates/schema.ts, byte-synced into lib/roadmap/schema.ts (diff -q clean), with a docblock clause stating that KNOWN-ness is a validation question answered by the engine. cli/lib/validate.mjs gained driverLaneWarnings(): a phase whose executionResult.driver.lane is neither 'session' nor a DRIVERS id gets `WARN phase N: executionResult.driver.lane '<value>' is not a known lane — known: <set>` plus the land-the-entry remediation. It is assembled OUTSIDE the isNewToGit authoring-lint gate, so a done-flip of an existing file warns; exit codes are untouched. bin/validate-roadmap-file.mjs needed no edit — it already prints result.warnings, and `roadmap phase validate` shares the engine.",
        how:
          "TDD: test-engineer appended 4 cases to bin/validate-roadmap-file.test.mjs blind to the implementation. RED was exactly the warning half (16 pass / 2 fail: \"the lane lint names the offending phase\" and \"a done-flip edits an existing file — the lint is not status-gated\"); the parse half was already green because the schema widening had landed. After the lint shipped: 19/19, and 25/25 with cli/lib/validate.test.mjs. The known set is read from DRIVERS at runtime by both the lint and the test, so a third driver landing in the registry tightens the assertion automatically instead of drifting. FALSIFICATION of the widening, driven and reverted: the closed enum restored in templates/schema.ts → 3 RED, the first being \"an unknown lane must load — the closed enum is dead\", with the exit-code-parity test red beside it — i.e. the corruption bug returns exactly when the enum does; reverted from a pristine copy and the byte-sync re-verified. The KNOWN-lane decoy (session plus every registry id) stays silent. Step-1 verify chain run whole: negative grep OK, diff -q OK, schema.test.ts PASS. types slot: declared-none (gate run 2 --slots types GREEN).",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The widening lands on the SHARED DriverShape, so PhaseEvalRecord's attribution.driver lane opens with it. That is what the step's own verify demands — its negative grep spans the whole file, and the shape was hoisted specifically to make this a one-line edit — and it is the coherent reading: a record shape that refused an unknown lane would fail to emit for exactly the third-driver phases the arc exists to measure. Consequence, outside this task's planned files[]: two checks in plugins/zeroh-roadmap/scripts/schema.test.ts pinned the old closed vocabulary and were re-pinned to the new contract rather than deleted — 'an unlisted lane rejects until the enum widens deliberately' became 'an UNKNOWN lane parses; only empty rejects', and the eval-record check now round-trips session/codex/grok-exec and asserts a BLANK lane rejects. Both keep a real invariant (min(1)); neither was weakened to pass. Scorecard cohorts key on the lane string, so an unknown lane opens a NEW cohort and every existing cohort keeps its key — no baseline reset. Consumer copies of schema.ts carry no drivers.mjs, which is why the known-lane check lives in the plugin's engine and not in a Zod refine; a consumer reading its own schema.ts directly still gets the open parse, just not the warning.",
      },
    },
  ],
})
