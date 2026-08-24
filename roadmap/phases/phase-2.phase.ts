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
  status: 'in-progress',
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
