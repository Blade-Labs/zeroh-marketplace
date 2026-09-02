import { definePhase } from '@/lib/roadmap/schema'

/**
 * Driver-native role filling — a consumer can point EVERY protocol role at codex.
 *
 * Owner ruling 2026-09-02 ("use codex for full arc/phases work"): a codex lane should build,
 * test, quality-pass, review and complete a phase itself, never shelling out to Claude
 * children. Twice on 2026-09-01/02 a lane sat blocked for hours because the quality-pass
 * role is pinned to claude-opus-5 and that allowance ran out. Today the only re-route a
 * consumer owns is `modelPolicy.judgeModel`, judge-class roles only (MULTI-DRIVER.md §1), and
 * even that cannot name the codex model — `MODEL_ALIASES` knows fable/sonnet/opus. This phase
 * adds the symmetric `modelPolicy.builderModel`, the `sol` alias, teaches do-arc to delegate a
 * whole arc to the codex lane when its executor resolves there, and flips THIS consumer.
 *
 * ## Hypotheses
 * 1. CONFIRMED — builder roles have no consumer re-route: resolveRole leads the chain with
 *    `judgeModel` only when `role.class === 'judge'` (roles.mjs:215); every builder role
 *    (phase-executor, software-developer, test-engineer, quality-pass, ux-designer) carries a
 *    1-entry chain `[OPUS]` (roles.mjs:80-140) that roles.test.mjs:105 pins as the ruled state.
 * 2. CONFIRMED — the codex model is registered but unnameable from config: `MODEL_IDS.SOL`
 *    routes to the codex driver (drivers.mjs:124) whose capabilities are `subagents: 'native'`
 *    (drivers.mjs:60), yet `MODEL_ALIASES` (drivers.mjs:110-114) has no alias for it, so
 *    `modelPolicy.judgeModel: 'sol'` would be passed through as an unknown id.
 * 3. REFUTED — "the lane already resolves roles for its own driver": `roadmap role resolve`
 *    defaults `driverId` to 'claude' (role.mjs:13) and the codex run prompt (codex.mjs:152)
 *    names the resolver without the `--driver codex` flag, so a lane asking the verb is told
 *    how a CLAUDE session would reach the role.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 24,
  name: 'Driver-native roles: modelPolicy.builderModel, the sol alias, arc delegation to the codex lane',
  status: 'backlog',
  plannedBy: { model: 'claude-fable-5-1' },
  reviewRecord: { date: '2026-09-02', model: 'claude-fable-5-1', verdict: 'READY', via: 'executed' },
  category: 'feature',
  kind: 'logic',
  source:
    'Owner ruling 2026-09-02: "use codex for full arc/phases work". Two lane blocks on the claude-opus-5 allowance (codex-22-21 on 2026-09-01T22:17Z; codex-23 on 2026-09-02T14:2xZ) while every task was done and only the Opus-pinned quality-pass round was owed.',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [23],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
    'plugins/zeroh-roadmap/cli/lib/drivers.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/roles.mjs',
    'plugins/zeroh-roadmap/cli/lib/roles.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/config.mjs',
    'plugins/zeroh-roadmap/cli/lib/config.test.mjs',
    'plugins/zeroh-roadmap/cli/roadmap.config.schema.json',
    'plugins/zeroh-roadmap/cli/commands/role.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/MULTI-DRIVER.md',
    'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
    'roadmap/roadmap.config.json',
  ],
  stakeholderDemo:
    'With modelPolicy { judgeModel: "sol", builderModel: "sol" } a codex lane resolves quality-pass, test-engineer and code-reviewer to gpt-5.6-sol NATIVE and finishes a phase with no Claude child in the chain; a Claude session with the same config reaches them as codex children; an unset builderModel leaves every existing consumer exactly as today; do-arc hands a whole arc to `roadmap codex run --arc` when its executor resolves to the codex model.',
  userFacing: false,
  assumptions: [
    {
      claim: 'MODEL_ALIASES carries no alias for the codex model.',
      verify: 'bash -c "test \\"$(grep -cE \'^\\s*sol:\' plugins/zeroh-roadmap/cli/lib/drivers.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'ModelPolicyShape knows judgeModel only; no builderModel exists anywhere in the plugin.',
      verify: 'bash -c "test \\"$(grep -rl builderModel plugins/zeroh-roadmap/cli plugins/zeroh-roadmap/skills plugins/zeroh-roadmap/MULTI-DRIVER.md | wc -l)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'resolveRole leads a chain with the asked model for judge-class roles only.',
      verify: 'bash -c "grep -qF \\"role.class === \'judge\' && asked\\" plugins/zeroh-roadmap/cli/lib/roles.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The role verb defaults its driver to claude and the codex run prompt names the resolver without --driver.',
      verify:
        'bash -c "grep -qF \\"const driverId = di >= 0 ? driverValue : \'claude\'\\" plugins/zeroh-roadmap/cli/commands/role.mjs && ! grep -qF -- \'--driver codex\' plugins/zeroh-roadmap/cli/commands/codex.mjs"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '24.1',
      title: 'The sol alias: modelPolicy can name the codex model',
      problem:
        "MODEL_ALIASES (drivers.mjs:110-114) maps fable/sonnet/opus only, so a consumer writing modelPolicy.judgeModel: 'sol' is passed the raw string through resolveRole's alias normalisation (roles.mjs:212-214) and gets 'nothing runs it'.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
          description:
            "Add `sol: MODEL_IDS.SOL` to MODEL_ALIASES with the docblock rule: an alias is a CONFIG spelling (modelPolicy), not a card frontmatter alias — cards stay Claude-harness aliases and roles.test's card↔chain-head check is unchanged. drivers.test.mjs + roles.test.mjs:143 alias-map expectations gain the entry → verify: bash -c \"grep -qE '^\\\\s*sol: MODEL_IDS.SOL' plugins/zeroh-roadmap/cli/lib/drivers.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/drivers.test.mjs cli/lib/roles.test.mjs >/dev/null 2>&1\"",
        },
      ],
      acceptanceCriteria: [
        "resolveRole('code-reviewer', 'codex', { judgeModel: 'sol' }) returns { model: 'gpt-5.6-sol', mode: 'native' }; the same under driver 'claude' returns mode 'child-cli'; roles.test's frontmatter↔chain-head test is untouched and green",
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/drivers.mjs', 'plugins/zeroh-roadmap/cli/lib/drivers.test.mjs', 'plugins/zeroh-roadmap/cli/lib/roles.test.mjs'],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ["MODEL_ALIASES.sol"] },
      done: false,
    },
    {
      id: '24.2',
      title: 'modelPolicy.builderModel: the config key, validated, in the generated schema',
      problem:
        'ModelPolicyShape (config.mjs:86) is `{ judgeModel: z.string() }` with additionalProperties false in the generated JSON schema, so a consumer cannot declare a builder re-route at all — config check reds the key.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/config.mjs',
          description:
            "ModelPolicyShape gains `builderModel: z.string().optional()` with the docblock: leads BUILDER-class chains exactly as judgeModel leads judge chains; an alias (MODEL_ALIASES) or a model id; absent = today's behaviour. Regenerate cli/roadmap.config.schema.json with `node cli/generate-config-schema.mjs` (the config.test drift subtest deep-equals it); `roadmap config check` (cli/commands/config.mjs:107) prints `judge=… builder=…` → verify: bash -c \"grep -qF 'builderModel' plugins/zeroh-roadmap/cli/lib/config.mjs && grep -qF 'builderModel' plugins/zeroh-roadmap/cli/roadmap.config.schema.json && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/config.test.mjs >/dev/null 2>&1\"",
        },
      ],
      acceptanceCriteria: [
        'A config carrying { judgeModel: "sol", builderModel: "sol" } parses; one carrying builderModel: 42 reds naming the field; the committed schema JSON equals the regenerated one',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/config.mjs', 'plugins/zeroh-roadmap/cli/lib/config.test.mjs', 'plugins/zeroh-roadmap/cli/roadmap.config.schema.json', 'plugins/zeroh-roadmap/cli/commands/config.mjs'],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['RoadmapConfig.modelPolicy.builderModel'] },
      done: false,
    },
    {
      id: '24.3',
      title: 'resolveRole leads builder chains with builderModel; the role verb reads both keys and takes --driver',
      problem:
        "resolveRole (roles.mjs:212-215) prepends the asked model for judge-class roles only; role.mjs:22 loads judgeModel alone and defaults driverId to 'claude' (role.mjs:13), so a codex lane asking `roadmap role resolve quality-pass` is told 'claude-opus-5 (child-cli)' — the Claude answer.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/roles.mjs',
          description:
            "resolveRole opts gain `builderModel`; the chain is `[asked, ...tierChain]` where asked = judgeModel for class 'judge' and builderModel for class 'builder' (alias-normalised exactly like judgeModel). A led chain that walks down still records `substituted` from the LED head. ROLES entries and roles.test's 1-entry-chain rule stay untouched — the lead is config, never a table edit → verify: bash -c \"grep -qF 'builderModel' plugins/zeroh-roadmap/cli/lib/roles.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/roles.test.mjs >/dev/null 2>&1\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/role.mjs',
          description:
            'The verb loads modelPolicy.{judgeModel,builderModel} and passes both; `--driver` keeps its claude default (a Claude session is the common caller) and the usage line documents `--driver codex`. role.test.mjs: matrix over {driver claude|codex} × {builderModel unset|sol} × {quality-pass, test-engineer, code-reviewer, software-architect} → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'builderModel\' cli/commands/role.mjs && capbuild node --test cli/commands/role.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        "Under driver codex with builderModel sol: quality-pass and test-engineer resolve to gpt-5.6-sol NATIVE; under driver claude: gpt-5.6-sol CHILD-CLI; builderModel unset: unchanged (claude-opus-5); sol forced unavailable: falls to the card tier with substituted { from: gpt-5.6-sol }; judge roles ignore builderModel and builder roles ignore judgeModel (both directions asserted)",
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/roles.mjs', 'plugins/zeroh-roadmap/cli/lib/roles.test.mjs', 'plugins/zeroh-roadmap/cli/commands/role.mjs', 'plugins/zeroh-roadmap/cli/commands/role.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['24.1', '24.2'],
      interfaces: { consumes: ['MODEL_ALIASES.sol from 24.1', 'RoadmapConfig.modelPolicy.builderModel from 24.2'], produces: ['resolveRole opts.builderModel'] },
      done: false,
    },
    {
      id: '24.4',
      title: 'The lane asks as itself; do-arc delegates the arc when its executor resolves to codex; one home documents the rule',
      problem:
        'codex.mjs:152 tells the lane to fill roles per the resolver but never says `--driver codex`, so a lane that asks the verb gets the Claude answer; do-arc always spawns a phase-executor Agent even when the consumer has routed that role to codex; MULTI-DRIVER.md §1 (the ONE home) states the judgeModel rule only.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            'Both lane prompts (run :152, plan :248) name the exact verb `roadmap role resolve <role> --driver codex` and add: a role that resolves to your own model is filled NATIVELY (your subagent), recorded via native — never inline unless the resolver says inline. codex.test.mjs pins the literal in both prompts; the envelope-overhead ratchet (roles.test.mjs MAX_ENVELOPE_PROTOCOL_RATIO) must stay green → verify: bash -c "grep -qF -- \'--driver codex\' plugins/zeroh-roadmap/cli/commands/codex.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/commands/codex.test.mjs cli/lib/roles.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/MULTI-DRIVER.md',
          description:
            '§1 `class` bullet becomes the two-key rule: judgeModel leads judge chains, builderModel leads builder chains, both optional, alias or id, `sol` = the codex model; the resolver signature line adds builderModel. One paragraph, no restatement elsewhere → verify: bash -c "grep -qF \'builderModel\' plugins/zeroh-roadmap/MULTI-DRIVER.md && grep -qF \'builderModel\' plugins/zeroh-roadmap/cli/lib/roles.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
          description:
            "Step 1 gains ONE sentence: when `roadmap role resolve phase-executor` returns the codex model, delegate the whole arc via `roadmap codex run --arc <ID> --base <integration ref>` (the existing lane) and audit its CODEX-REPORT per the codex-delegation section — never an Agent spawn of a Claude executor. Cite MULTI-DRIVER §1; `roadmap measure --flow do-arc --assert 13339` stays green, funded in-file if needed with a DIET-LEDGER row → verify: bash -c \"grep -qF 'codex run --arc' plugins/zeroh-roadmap/skills/do-arc/SKILL.md && cd plugins/zeroh-roadmap && node bin/roadmap.mjs measure --flow do-arc --assert 13339 >/dev/null 2>&1\"",
        },
      ],
      acceptanceCriteria: [
        'Both lane prompts carry the exact verb with --driver codex (test-pinned); do-arc names the delegation branch once; MULTI-DRIVER §1 is the only prose home of the two-key rule; the do-arc measure assert holds',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/codex.mjs',
        'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
        'plugins/zeroh-roadmap/MULTI-DRIVER.md',
        'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
      ],
      testMode: 'tdd',
      dependsOn: ['24.3'],
      interfaces: { consumes: ['resolveRole opts.builderModel from 24.3'], produces: [] },
      done: false,
    },
    {
      id: '24.5',
      title: 'This consumer routes every role to codex; the live resolver agrees',
      problem:
        'roadmap/roadmap.config.json:19-21 carries judgeModel: fable only; until it names sol for both classes, the next codex lane blocks on the Opus allowance exactly as codex-22-21 and codex-23 did.',
      steps: [
        {
          file: 'roadmap/roadmap.config.json',
          description:
            'modelPolicy becomes { "judgeModel": "sol", "builderModel": "sol" }; `roadmap config check` exits 0; live probes recorded in the transparencyReport: `role resolve quality-pass --driver codex` → gpt-5.6-sol (native); `code-reviewer --driver codex` → native; `software-architect --driver claude` → gpt-5.6-sol (child-cli), the fable→sol→opus chain intact behind the lead → verify: bash -c "grep -qF \'\\"builderModel\\": \\"sol\\"\' roadmap/roadmap.config.json && out=$(node plugins/zeroh-roadmap/bin/roadmap.mjs role resolve quality-pass --driver codex 2>&1) && case \\"$out\\" in *\'gpt-5.6-sol (native)\'*) exit 0;; *) echo \\"$out\\"; exit 1;; esac"',
        },
      ],
      acceptanceCriteria: [
        'config check green; the three live resolutions above hold; `roadmap audit` stays CLEAN apart from pre-existing findings; the independence rule (gate-report.mjs no-self-judge, phase 17.2) is untouched — a codex-spawned reviewer is a recorded native firing under a distinct role label, which is the ruling the owner made',
      ],
      files: ['roadmap/roadmap.config.json'],
      testMode: 'none',
      dependsOn: ['24.3'],
      done: false,
    },
  ],
  notes:
    'interview: conducted in-session 2026-09-02 — the owner ruled "use codex for full arc/phases work" after two lanes blocked on the Opus allowance; the shape (a builderModel key symmetric to judgeModel, a sol alias, do-arc delegation, this consumer flipped) is the planner\'s technical decision, made here: config-led chains keep the roles table and its 1-entry rule as the ruled default, so every other consumer is unchanged. ' +
    'userFacing false: plugin/CLI internals and this repo\'s own config; no product surface, no flag. testMode none on 24.5: a JSON config edit whose proof is the live resolver probes and config check. ' +
    'Recorded decision: with both keys at sol, codex builds AND reviews. The no-self-judge rule (gate-report.mjs INDEPENDENT_REVIEW_ENFORCEMENT_AT, phase 17.2) keys on the recorded agent label, not the model family; a native codex subagent under the code-reviewer label satisfies it, and MULTI-DRIVER §1 forbids only the INLINE fallback for roles whose card forbids grading its own work. The owner accepted that trade on 2026-09-02. ' +
    'conflictsWith 23: both edit skills/do-arc/SKILL.md and both spend the do-arc load budget (23 re-ratcheted it to 13,339 under the operator ruling; 24.4 asserts that figure) — serialize behind 23. ' +
    'Out of scope, recorded: a codex-family driver for do-phase INLINE in a Claude session (the session is the driver; builderModel routes its spawned roles to codex children, which is the intended reach); a roles-table reorder (a second tier on builder roles is a user ruling per roles.test.mjs:105 — not needed when config leads the chain); re-verifying the codex driver registry entry (roadmap driver verify codex) — its native-subagent capability is already the recorded evidence. ' +
    'Verify rehearsal attestation: assumption probes executed 2026-09-02 at plan time — no sol alias (0 hits), builderModel 0 files, the judge-only lead literal present, the claude driver default + missing --driver codex both present (all exit 0). Step verifies red-now via their grep halves (no sol alias, no builderModel anywhere, no --driver codex, no codex run --arc in do-arc, config still fable); runner clauses inherit polarity from the grep representatives. Mode A review EXECUTED 2026-09-02 (claude-fable-5-1, standalone inline): READY after two [FIXED] repairs — the config-check printout (cli/commands/config.mjs:107) joins 24.2 as the one other code consumer of judgeModel; the 24.5 step trimmed under the cap. Blast radius probed: eval.mjs/eval-score.mjs judgeModel is the eval-judge pin, a different concept, untouched; prose homes citing judgeModel for judge spawns stay correct. Ratified: testMode none on 24.5; userFacing false. Placement: HIGH, conflictsWith 23 (in progress at index 0) forces one entry between → 3 of 4.',
})
