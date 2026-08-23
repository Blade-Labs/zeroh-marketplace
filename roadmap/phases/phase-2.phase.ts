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
  status: 'backlog',
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
      done: false,
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
      done: false,
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
      done: false,
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
      done: false,
    },
  ],
})
