import { definePhase } from '@/lib/roadmap/schema'

/**
 * Model policy per role — the consumer chooses who fills every role, per repo and per run.
 *
 * Owner ruling 2026-09-02 (reasoned in-session): the unit of choice is the ROLE. Any role
 * (developer, test-engineer, architect, quality-pass, code-reviewer, intent-validator,
 * executor) may be filled by any registered model in any combination; a repo carries a
 * default policy in roadmap.config.json; a single run ("do arc with codex") overrides it;
 * every firing AND the policy in force are recorded so the scorecard can compare
 * combinations with data. Exactly one role stays pinned: `arc-eval-judge` = sonnet, the
 * baseline the eval trend compares against (eval.mjs:613 PINNED_JUDGE_MODEL). Three named
 * presets spell the defaults everywhere the same way: `claude` (the roles table as it is),
 * `codex` (everything sol, architect fable), `codex-full` (everything sol). Motive: two
 * lanes (codex-22-21, codex-23) sat blocked on the claude-opus-5 allowance with all tasks
 * done because quality-pass is pinned to Opus while codex tokens went unused.
 *
 * ## Hypotheses
 * 1. CONFIRMED — the only consumer re-route is class-wide and judge-only: resolveRole leads a
 *    chain with `judgeModel` when `role.class === 'judge'` (roles.mjs:215); builder roles carry
 *    1-entry `[OPUS]` chains (roles.mjs:80-140) that roles.test.mjs:105 pins; nothing per-role.
 * 2. CONFIRMED — the codex model is registered (MODEL_IDS.SOL → driver codex, drivers.mjs:124,
 *    `subagents: 'native'` at :60) but unnameable from config: MODEL_ALIASES (drivers.mjs:110-114)
 *    knows fable/sonnet/opus only.
 * 3. CONFIRMED — nothing carries a per-run override: `roadmap arm` parses --inline/--note/
 *    --base-ref/--mode (arm.mjs:22-25) and the sidecar stamps mode/note/baseRef
 *    (sidecar.mjs:109-111); `codex run` takes --worktree/--base (codex.mjs:455-456);
 *    PhaseExecutionResultShape records `roles[]` firings (templates/schema.ts:312) but no
 *    policy snapshot.
 * 4. REFUTED — "the lane resolves roles for its own driver": `roadmap role resolve` defaults
 *    driverId to 'claude' (role.mjs:13) and the run prompt (codex.mjs:152) names the resolver
 *    without `--driver codex`.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 24,
  name: 'Model policy per role: presets, per-repo defaults, per-run --models override, recorded snapshot, sonnet judge pinned',
  status: 'backlog',
  plannedBy: { model: 'claude-fable-5-1' },
  reviewRecord: { date: '2026-09-02', model: 'claude-fable-5-1', verdict: 'READY', via: 'executed' },
  category: 'feature',
  kind: 'logic',
  source:
    'Owner ruling 2026-09-02 15:12-15:19Z: run a full arc with codex, with claude, or any mix per role; repo default in roadmap.config.json, per-run override at spawn ("do arc with codex"), all recorded for later evaluation; arc-eval-judge stays sonnet everywhere. Priority: Anthropic tokens are burning on roles codex could fill.',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [23],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
    'plugins/zeroh-roadmap/cli/lib/roles.mjs',
    'plugins/zeroh-roadmap/cli/lib/roles.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/config.mjs',
    'plugins/zeroh-roadmap/cli/roadmap.config.schema.json',
    'plugins/zeroh-roadmap/cli/commands/role.mjs',
    'plugins/zeroh-roadmap/cli/commands/arm.mjs',
    'plugins/zeroh-roadmap/cli/lib/sidecar.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/templates/schema.ts',
    'lib/roadmap/schema.ts',
    'plugins/zeroh-roadmap/MULTI-DRIVER.md',
    'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
    'roadmap/roadmap.config.json',
  ],
  stakeholderDemo:
    'zeroh (empty policy) runs claude by default; `do arc <ID> --models codex` there gives a codex developer, tester, quality-pass and reviewer with a fable architect; atlas sets preset codex-full and every arc is codex end to end; in every case each phase record carries the policy in force plus every firing, and arc-eval-judge resolves to sonnet no matter what the policy says.',
  userFacing: false,
  assumptions: [
    {
      claim: 'No per-role policy, preset, or codex alias exists anywhere in the plugin runtime.',
      verify:
        'bash -c "test \\"$(grep -rlE \'MODEL_PRESETS|builderModel|modelPolicy\\\\.roles|--models\' plugins/zeroh-roadmap/cli plugins/zeroh-roadmap/hooks | wc -l)\\" = \\"0\\" && test \\"$(grep -cE \'^\\\\s*sol:\' plugins/zeroh-roadmap/cli/lib/drivers.mjs)\\" = \\"0\\""',
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
    {
      claim: 'The eval judge pin is a single constant equal to the arc-eval-judge chain head.',
      verify: 'bash -c "grep -qF \\"PINNED_JUDGE_MODEL = \'claude-sonnet-5\'\\" plugins/zeroh-roadmap/cli/commands/eval.mjs && grep -qF \'tierChain: Object.freeze([SONNET])\' plugins/zeroh-roadmap/cli/lib/roles.mjs"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '24.1',
      title: 'Presets, the sol alias, and a per-role policy in the resolver — the sonnet judge pinned',
      problem:
        "resolveRole (roles.mjs:212-215) prepends `judgeModel` for judge-class roles only; there is no per-role lead, no default lead, no preset, and MODEL_ALIASES cannot even spell the codex model — so \"codex developer with a fable architect\" is inexpressible.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
          description:
            "MODEL_ALIASES gains `sol: MODEL_IDS.SOL` (a CONFIG spelling; cards keep Claude-harness aliases, so roles.test's card↔chain-head check is untouched); drivers.test.mjs + roles.test.mjs:143 alias-map expectations gain the entry → verify: bash -c \"grep -qE '^\\\\s*sol: MODEL_IDS.SOL' plugins/zeroh-roadmap/cli/lib/drivers.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/drivers.test.mjs >/dev/null 2>&1\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/roles.mjs',
          description:
            "Export `MODEL_PRESETS = { claude: {}, codex: { default: SOL, roles: { 'software-architect': FABLE } }, 'codex-full': { default: SOL } }`, `PINNED_ROLES = ['arc-eval-judge']`, and `leadFor(role, policy)`: `policy.roles[id]` ?? (class judge ? policy.judgeModel : undefined) ?? `policy.default` ?? none; a pinned role ignores `default` and THROWS PinnedRoleError when `roles` names it. resolveRole opts gain `policy` (`{ preset?, default?, roles?, judgeModel? }`, preset expanded first, explicit keys layered on top); the led chain is `[lead, ...tierChain]`, alias-normalised; a walk down still records `substituted` from the lead. ROLES entries and the 1-entry-chain rule stay untouched → verify: bash -c \"grep -qF 'MODEL_PRESETS' plugins/zeroh-roadmap/cli/lib/roles.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/roles.test.mjs >/dev/null 2>&1\"",
        },
      ],
      acceptanceCriteria: [
        "roles.test matrix, every cell asserted: preset codex under driver codex → quality-pass/test-engineer/code-reviewer gpt-5.6-sol NATIVE and software-architect claude-fable-5 child-cli; preset codex-full → architect gpt-5.6-sol native; preset claude / empty policy → today's answers byte-for-byte; the same policies under driver claude → codex models reach as child-cli; roles['test-engineer']='opus' over default sol wins for that role only; legacy judgeModel still leads judge roles; arc-eval-judge → claude-sonnet-5 under every preset and default, and roles['arc-eval-judge'] throws PinnedRoleError naming the pin; a led model forced unavailable falls to the card tier with substituted.from = the lead",
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/drivers.mjs', 'plugins/zeroh-roadmap/cli/lib/drivers.test.mjs', 'plugins/zeroh-roadmap/cli/lib/roles.mjs', 'plugins/zeroh-roadmap/cli/lib/roles.test.mjs'],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['MODEL_PRESETS', 'PINNED_ROLES', 'PinnedRoleError', 'resolveRole opts.policy', 'MODEL_ALIASES.sol'] },
      done: false,
    },
    {
      id: '24.2',
      title: 'modelPolicy in config: preset, default, roles — validated, generated, printed, parsed from --models',
      problem:
        'ModelPolicyShape (config.mjs:86) is `{ judgeModel: z.string() }` and the generated schema forbids other keys, so no repo can declare a preset or a per-role map; nothing parses a `--models` argument.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/config.mjs',
          description:
            "ModelPolicyShape → `{ preset?: enum(keys of MODEL_PRESETS), default?: string, roles?: record(roleId → string), judgeModel?: string (legacy, judge-class lead) }` — all optional, `{}` = the table. Regenerate cli/roadmap.config.schema.json (`node cli/generate-config-schema.mjs`; config.test's drift subtest deep-equals it); `roadmap config check` (cli/commands/config.mjs:107) prints the effective policy per role class instead of `judge=` alone → verify: bash -c \"grep -qF 'preset' plugins/zeroh-roadmap/cli/lib/config.mjs && grep -qF 'preset' plugins/zeroh-roadmap/cli/roadmap.config.schema.json && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/config.test.mjs >/dev/null 2>&1\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/roles.mjs',
          description:
            "`policyFromArg(text)`: a preset name, or comma pairs `role=alias` with `default=alias` allowed (`codex`, `default=sol,software-architect=fable`); unknown role/preset/alias → a named error listing the legal ones. `mergePolicy(repo, invocation)`: invocation keys win, `source` recorded as 'invocation' | 'config' | 'table'. The role verb: `--models <arg>` and `--driver <id>` both accepted, the effective policy loaded from config and merged → verify: bash -c \"grep -qF 'policyFromArg' plugins/zeroh-roadmap/cli/lib/roles.mjs && grep -qF -- '--models' plugins/zeroh-roadmap/cli/commands/role.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/commands/role.test.mjs >/dev/null 2>&1\"",
        },
      ],
      acceptanceCriteria: [
        'A config with { preset: "codex" } parses; { preset: "gpt" } reds naming the three presets; { roles: { "arc-eval-judge": "sol" } } reds at config check naming the pin; `roadmap role resolve quality-pass --driver codex --models codex` prints gpt-5.6-sol (native) on a repo whose config is empty; the schema JSON equals its regeneration',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/config.mjs', 'plugins/zeroh-roadmap/cli/lib/config.test.mjs', 'plugins/zeroh-roadmap/cli/roadmap.config.schema.json', 'plugins/zeroh-roadmap/cli/commands/config.mjs', 'plugins/zeroh-roadmap/cli/lib/roles.mjs', 'plugins/zeroh-roadmap/cli/commands/role.mjs', 'plugins/zeroh-roadmap/cli/commands/role.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['24.1'],
      interfaces: { consumes: ['MODEL_PRESETS from 24.1', 'resolveRole opts.policy from 24.1'], produces: ['RoadmapConfig.modelPolicy.{preset,default,roles}', 'policyFromArg', 'mergePolicy'] },
      done: false,
    },
    {
      id: '24.3',
      title: 'The per-run override travels: arm and codex run take --models; sidecar, journal and phase record carry the snapshot',
      problem:
        '"do arc with codex" has no carrier: arm.mjs:22-25 parses no --models, sidecar.mjs:109-111 stamps mode/note/baseRef only, codex.mjs:455-456 takes --worktree/--base only, and PhaseExecutionResultShape (templates/schema.ts:294) records firings but never the policy that was in force.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            "PhaseExecutionResultShape gains optional `modelPolicy: { source: enum(['invocation','config','table']), preset?, default?, roles? }`; the arc sidecar (validated in sidecar.mjs, no schema-home shape) carries the same object. Mirror line-identically in lib/roadmap/schema.ts in the same commit (vendor-pair) → verify: bash -c \"grep -qF 'modelPolicy' plugins/zeroh-roadmap/templates/schema.ts && diff <(grep -A 6 'modelPolicy: z' plugins/zeroh-roadmap/templates/schema.ts) <(grep -A 6 'modelPolicy: z' lib/roadmap/schema.ts) >/dev/null\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/arm.mjs',
          description:
            "`roadmap arm <arc> --models <arg>` parses via policyFromArg, merges with the repo config and stamps `modelPolicy` (with source) into the sidecar; `roadmap codex run … --models <arg>` does the same into the lane journal, and both lane prompts name the effective policy verbatim with the instruction: pass it to `roadmap role resolve <role> --driver codex --models <arg>` and stamp `executionResult.modelPolicy` from it; arm-disarm.test / codex.test cover the stamp and the prompt line → verify: bash -c \"grep -qF -- '--models' plugins/zeroh-roadmap/cli/commands/arm.mjs && grep -qF -- '--models' plugins/zeroh-roadmap/cli/commands/codex.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/commands/arm-disarm.test.mjs cli/commands/codex.test.mjs >/dev/null 2>&1\"",
        },
      ],
      acceptanceCriteria: [
        'arm --models codex writes modelPolicy { source: invocation, preset: codex } into the sidecar and refuses --models naming arc-eval-judge; codex run --models codex-full journals it and its prompt carries the exact resolver call; a phase record carrying executionResult.modelPolicy validates in both schema homes; an absent --models records the config policy with source config (or table when the config is empty); the envelope-overhead ratchet stays green',
      ],
      files: ['plugins/zeroh-roadmap/templates/schema.ts', 'lib/roadmap/schema.ts', 'plugins/zeroh-roadmap/cli/commands/arm.mjs', 'plugins/zeroh-roadmap/cli/commands/arm-disarm.test.mjs', 'plugins/zeroh-roadmap/cli/lib/sidecar.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['24.2'],
      interfaces: { consumes: ['policyFromArg from 24.2', 'mergePolicy from 24.2'], produces: ['PhaseExecutionResult.modelPolicy', 'sidecar.modelPolicy'] },
      done: false,
    },
    {
      id: '24.4',
      title: 'do-arc routes by the resolved executor; MULTI-DRIVER §1 is the one home of presets, precedence and the pin',
      problem:
        'do-arc always spawns a Claude phase-executor Agent (SKILL.md:36) and its arm step (SKILL.md:27) knows no --models; MULTI-DRIVER.md §1 documents judgeModel only. Without the routing rule a codex policy still runs the executor on Opus.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/MULTI-DRIVER.md',
          description:
            '§1 gains: the three presets as a table, the precedence line (invocation --models > repo modelPolicy > roles table), the per-role/default keys, the legacy judgeModel note, and the pin (`arc-eval-judge` = sonnet, refused in any override — the eval trend baseline, eval.mjs PINNED_JUDGE_MODEL). The resolver signature line adds `policy`. No other file restates it → verify: bash -c "grep -qF \'codex-full\' plugins/zeroh-roadmap/MULTI-DRIVER.md && grep -qF \'PINNED_ROLES\' plugins/zeroh-roadmap/MULTI-DRIVER.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/do-arc/SKILL.md',
          description:
            'Trigger line accepts `--models <preset|pairs>`; Step 1 arms with it; the loop step 3 gains ONE sentence: when `roadmap role resolve phase-executor --driver claude --models <arg>` returns the codex model, delegate the whole arc via `roadmap codex run --arc <ID> --base <ref> --models <arg>` and audit its CODEX-REPORT per the codex-delegation section — never an Agent spawn of a Claude executor. `roadmap measure --flow do-arc --assert 13339` stays green (fund in-file + DIET-LEDGER row if needed) → verify: bash -c "grep -qF \'codex run --arc\' plugins/zeroh-roadmap/skills/do-arc/SKILL.md && cd plugins/zeroh-roadmap && node bin/roadmap.mjs measure --flow do-arc --assert 13339 >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'MULTI-DRIVER §1 is the only prose home of presets/precedence/pin (grep for codex-full across skills/agents finds only the do-arc trigger line and MULTI-DRIVER); do-arc names the delegation branch once; the do-arc measure assert holds',
      ],
      files: ['plugins/zeroh-roadmap/MULTI-DRIVER.md', 'plugins/zeroh-roadmap/skills/do-arc/SKILL.md', 'plugins/zeroh-roadmap/DIET-LEDGER.md'],
      testMode: 'none',
      dependsOn: ['24.3'],
      done: false,
    },
    {
      id: '24.5',
      title: 'This consumer defaults to preset codex; the live resolver and config check agree',
      problem:
        'roadmap/roadmap.config.json:19-21 carries judgeModel: fable only, so the next codex lane here still shells out to Opus for quality-pass and test-engineer.',
      steps: [
        {
          file: 'roadmap/roadmap.config.json',
          description:
            'modelPolicy becomes { "preset": "codex" } (codex builders and reviewers, fable architect, sonnet judge); `roadmap config check` exits 0 and prints the effective policy; live probes recorded in the transparencyReport: quality-pass --driver codex → gpt-5.6-sol (native); software-architect --driver codex → claude-fable-5 (child-cli); arc-eval-judge --driver codex → claude-sonnet-5; the same three with `--models codex-full` → architect gpt-5.6-sol native, judge still sonnet → verify: bash -c "grep -qF \'\\"preset\\": \\"codex\\"\' roadmap/roadmap.config.json && out=$(node plugins/zeroh-roadmap/bin/roadmap.mjs role resolve quality-pass --driver codex 2>&1) && case \\"$out\\" in *\'gpt-5.6-sol (native)\'*) exit 0;; *) echo \\"$out\\"; exit 1;; esac"',
        },
      ],
      acceptanceCriteria: [
        'config check green with the printed policy; the six live resolutions hold; `roadmap audit` stays CLEAN apart from pre-existing findings',
      ],
      files: ['roadmap/roadmap.config.json'],
      testMode: 'none',
      dependsOn: ['24.2'],
      done: false,
    },
  ],
  notes:
    'interview: conducted in-session 2026-09-02 15:12-15:19Z — the owner ruled the role as the unit of choice, per-repo defaults plus a per-run override, everything recorded, arc-eval-judge pinned to sonnet everywhere (the eval trend baseline and the one cross-family reading when builders and reviewers share a family); the three presets and the precedence order are the planner\'s technical shape, made here. Supersedes the first draft of this phase (class-wide judgeModel/builderModel keys — too coarse to express "codex developer with a fable architect"). ' +
    'userFacing false: plugin/CLI internals and this repo\'s config; no product surface, no flag. testMode none on 24.4 (prose + measure) and 24.5 (a JSON edit proven by live resolver probes and config check). ' +
    'Recorded decision: under preset codex or codex-full, codex reviews codex. The no-self-judge rule (gate-report.mjs, phase 17.2) keys on the recorded role label; a native codex subagent under the code-reviewer label satisfies it; MULTI-DRIVER §1 forbids only the INLINE fallback for roles whose card forbids grading its own work. The owner accepted the trade on 2026-09-02; the recorded snapshot + firings are what lets the scorecard show whether it costs quality. ' +
    'conflictsWith 23: both edit skills/do-arc/SKILL.md and both spend the do-arc load budget (23 re-ratcheted it to 13,339; 24.4 asserts that figure) — serialize behind 23. ' +
    'Out of scope, recorded: a roles-table reorder (the config leads the chain; the table stays the ruled default per roles.test.mjs:105); re-verifying the codex driver entry (roadmap driver verify codex); a scorecard slice by modelPolicy.preset (the snapshot lands here; the projection is eval work once records exist); the do-phase inline path in a Claude session already spawns roles by the resolver, so it inherits the policy with no prose change. ' +
    'Verify rehearsal attestation: assumption probes executed 2026-09-02 at plan time — MODEL_PRESETS/builderModel/roles-map/--models 0 files and no sol alias; the judge-only lead literal present; the claude driver default present and --driver codex absent from codex.mjs; the sonnet pin constant and the arc-eval-judge chain head both present (all exit 0). Step verifies red-now via their grep halves (no sol alias, no MODEL_PRESETS, no preset key in config or schema, no --models in arm/codex/role, no modelPolicy in the schemas, no codex-full in MULTI-DRIVER, no codex run --arc in do-arc, config still judgeModel fable); runner clauses inherit polarity from the grep representatives. Mode A review EXECUTED 2026-09-02 on the reshaped plan (claude-fable-5-1, standalone inline): every cited anchor re-opened at HEAD (arm.mjs:22-25, sidecar.mjs:109-111, codex.mjs:152/455-456, role.mjs:13, roles.mjs:78/212-215, templates/schema.ts:294/312, eval.mjs:613, do-arc SKILL.md:27/36); blast radius: judgeModel\'s only other code consumer is the config-check printout (cli/commands/config.mjs:107, in 24.2); eval.mjs/eval-score.mjs judgeModel is the eval-judge pin, untouched by design; arm has no suite of its own — arm-disarm.test.mjs is the home. READY, no repairs beyond the test-home name. Ratified: testMode none on 24.4/24.5; userFacing false. Placement unchanged: HIGH behind 23 (conflict spacing) → 3 of 4.',
})
