import { definePhase } from '@/lib/roadmap/schema'

/**
 * GREENFIELD standards-and-pointers plane: one conventions home, mechanically current README,
 * and roadmap-native configuration wiring. Phase 29 supplies the consumer-file contracts and
 * phase 31 supplies the six archetype manifests; this phase teaches greenfield-init how to fill
 * those contracts without duplicating facts or writing before approval.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 32,
  name: 'Author standards once, enforce README catalog currency, and wire roadmap-native pointers',
  status: 'backlog',
  plannedBy: { model: 'gpt-5.6-sol' },
  arcId: 'GREENFIELD',
  category: 'feature',
  kind: 'logic',
  source:
    'roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design item 5 (standards + pointers), the GREENFIELD promise ledger, and greenfield brief 32; user rulings: conventions land once in AGENTS.md, harness files point rather than copy, and README currency is catalog-checked rather than promised in prose.',
  priority: 'HIGH',
  dependsOn: [29, 31],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md',
    'plugins/zeroh-greenfield/templates/README.md',
    'plugins/zeroh-greenfield/templates/CONTRIBUTING.md',
    'plugins/zeroh-greenfield/templates/scripts/check-readme-catalog.mjs',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md',
  ],
  stakeholderDemo:
    'In an approved scratch consumer, AGENTS.md is the sole conventions home, CLAUDE.md imports it, roadmap config check resolves the manifest-derived design and test pointers, and the README catalog check passes when current but reports both a missing project row and a nonexistent extra row.',
  userFacing: false,
  reviewScope: 'full',
  assumptions: [
    {
      claim: 'The GREENFIELD arc assigns standards, README currency, and pointer wiring to phase 32 and records conventions-in-claude-md and readme-as-prose as rejected alternatives.',
      verify:
        "bash -c \"grep -qF \\\"phases: [32]\\\" roadmap/arcs/GREENFIELD.arc.ts && grep -qF \\\"option: 'conventions-in-claude-md'\\\" roadmap/arcs/GREENFIELD.arc.ts && grep -qF \\\"option: 'readme-as-prose'\\\" roadmap/arcs/GREENFIELD.arc.ts\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'roadmap init refuses an existing config and writes only the required placeholder gateCommands block, leaving optional pointer blocks absent.',
      verify:
        "bash -c \"grep -qF 'if (existsSync(configPath))' plugins/zeroh-roadmap/cli/commands/init.mjs && grep -qF '...PLACEHOLDER_CONFIG' plugins/zeroh-roadmap/cli/commands/init.mjs && test \\\"$(grep -cF 'designHomes:' plugins/zeroh-roadmap/cli/commands/init.mjs)\\\" = 0\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The roadmap config seam accepts designHomes, testConventions, and gateCommands with the exact nested design-home vocabulary this phase will document.',
      verify:
        "bash -c \"grep -qF 'const DesignHomesShape = z.strictObject({' plugins/zeroh-roadmap/cli/lib/config.mjs && grep -qF 'qualityExemplar: z.string().optional()' plugins/zeroh-roadmap/cli/lib/config.mjs && grep -qF 'copyRules: z.string().optional()' plugins/zeroh-roadmap/cli/lib/config.mjs && grep -qF 'bindingDesignSystem: z.string().optional()' plugins/zeroh-roadmap/cli/lib/config.mjs && grep -qF 'testConventions: z.array(z.string()).optional()' plugins/zeroh-roadmap/cli/lib/config.mjs && grep -qF 'gateCommands: GateCommandsShape' plugins/zeroh-roadmap/cli/lib/config.mjs\"",
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '32.1',
      title: 'Specify approval-gated filling rules for every standards template and harness pointer',
      problem:
        'Phase 29 creates standards templates as section contracts, but greenfield-init still needs one precise authoring reference that maps approved interview and archetype facts into them while preserving AGENTS.md as the only conventions home and leaving generated harness blocks untouched.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md',
          description:
            "Create the reference per `plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/documentation-rules.md`: require a `file | source facts | planned sections` proposal and approval before writes; fill AGENTS.md `## Conventions` from the manifest delta plus approved answers and `## Don’t` from rejected practices; cite `plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md` for `## Generalize-forward` without restating it; include Flag-first and `hold[]` pointers only for release-bearing archetypes. → verify: grep -qF 'plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md' plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md",
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md',
          description:
            "Define the remaining fills exactly: CLAUDE.md keeps `@AGENTS.md` plus Claude-only harness lines; other detected harness files point to AGENTS.md and never copy it; preserve bytes inside generated marker pairs including `<!-- nx configuration start/end -->`; derive CODE-STYLE.md from the chosen archetype’s existing lint/format configuration without creating another config; make architecture.md a topic-doc index; fill ux-canon.md from the approved design decision and link an existing token/design home. → verify: grep -qF '<!-- nx configuration start/end -->' plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md",
        },
      ],
      acceptanceCriteria: [
        "grep -qF 'proposal' plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md && grep -qF 'approval' plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md",
        "grep -qF '@AGENTS.md' plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md && grep -qF 'CODE-STYLE.md' plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md && grep -qF 'architecture.md' plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md && grep -qF 'ux-canon.md' plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md",
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md'],
      testMode: 'none',
      done: false,
      interfaces: {
        consumes: ['phase 29 standards-template section contracts', 'phase 31 ## Conventions delta'],
        produces: ['standards.md authoring contract'],
      },
    },
    {
      id: '32.2',
      title: 'Make README project currency a dependency-free catalog invariant',
      problem:
        'A “keep README in sync” sentence did not prevent zeroh’s catalog from omitting 5 of 19 projects. The consumer needs a stable table contract and a dropped Node checker that compares both directions against generated catalog data or the selected manifest’s declared project roots.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/templates/README.md',
          description:
            "Add a `Project | Path | Purpose` table bounded by `<!-- repo-catalog:start -->` and `<!-- repo-catalog:end -->`; Path is the unique identity, Project is the expected catalog name, and Purpose remains human-authored so the checker does not duplicate prose ownership. → verify: grep -qF '<!-- repo-catalog:start -->' plugins/zeroh-greenfield/templates/README.md",
        },
        {
          file: 'plugins/zeroh-greenfield/templates/scripts/check-readme-catalog.mjs',
          description:
            "Add the dependency-free ESM checker with `--help` usage: from the consumer root parse the bounded README table; when the manifest-selected generated catalog path exists, accept its root array or `projects[]` and normalize string entries or `{ name, path|root }`; otherwise enumerate immediate project directories beneath each manifest-derived `--project-root`; compare normalized relative Path plus name in both directions, report every `missing README project` and `unknown README project`, and exit 1 for missing markers, malformed/duplicate rows, unreadable catalog shapes, missing rows, or extra rows. → verify: node plugins/zeroh-greenfield/templates/scripts/check-readme-catalog.mjs --help",
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            "In every phase-31 archetype manifest, append the concrete catalog-check command to `## Verify`, using `--catalog emitted/repo-catalog.json` where its Post-steps generate that file and otherwise one `--project-root` per project-bearing directory named by `## File tree`; do not add a new manifest heading. → verify: test \"$(grep -rlF check-readme-catalog.mjs plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/*.md | wc -l)\" = 6",
        },
      ],
      acceptanceCriteria: [
        'A scratch consumer with matching alpha and beta rows exits 0; deleting beta exits 1 and prints `missing README project: beta (packages/beta)`; adding `apps/ghost` only to the table exits 1 and prints `unknown README project: ghost (apps/ghost)`.',
        'The same comparison contract runs from a generated catalog and from manifest-derived `--project-root` fallbacks without external packages.',
        "test \"$(grep -rlF 'check-readme-catalog.mjs' plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/*.md | wc -l)\" = 6",
      ],
      files: [
        'plugins/zeroh-greenfield/templates/README.md',
        'plugins/zeroh-greenfield/templates/scripts/check-readme-catalog.mjs',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md',
      ],
      testMode: 'none',
      done: false,
      interfaces: {
        consumes: ['phase 31 ## Post-steps', 'phase 31 ## File tree', 'phase 31 ## Verify'],
        produces: ['README repo-catalog table', 'check-readme-catalog.mjs'],
      },
    },
    {
      id: '32.3',
      title: 'Wire manifest values through the existing zeroh-roadmap config seam in safe order',
      problem:
        'Greenfield must not invent a parallel configuration vocabulary or overwrite the required config created by roadmap init. The reference must copy the accepted shapes from plugins/zeroh-roadmap/cli/lib/config.mjs and make initialization, optional-key editing, and validation an ordered contract.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md',
          description:
            "Create the pointer-wiring reference with the fixed order: if zeroh-roadmap is absent, print `/plugin install zeroh-roadmap@zeroh-marketplace` and stop; otherwise run `roadmap init` first, relying on `plugins/zeroh-roadmap/cli/commands/init.mjs` refusal when config exists and its omission of optional blocks; only then merge approved manifest values; finally run `roadmap config check` and stop on failure. → verify: grep -qF '/plugin install zeroh-roadmap@zeroh-marketplace' plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md",
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md',
          description:
            "Copy the exact `plugins/zeroh-roadmap/cli/lib/config.mjs` shapes and no greenfield-only key: `designHomes.architecture.{home, extendProtocol}`, `designHomes.ux.{canon[], qualityExemplar, copyRules, bindingDesignSystem}`, `testConventions: string[]`, and required plus optional `gateCommands.*` slots; map values from each selected manifest’s `## designHomes`, `## testConventions`, and `## Verify`, preserving existing unrelated keys. → verify: grep -qF 'designHomes.ux.bindingDesignSystem' plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md",
        },
      ],
      acceptanceCriteria: [
        "grep -qF 'roadmap init' plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md && grep -qF 'roadmap config check' plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md",
        "grep -qF 'designHomes.architecture.extendProtocol' plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md && grep -qF 'designHomes.ux.canon' plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md && grep -qF 'testConventions' plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md && grep -qF 'gateCommands' plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md",
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md'],
      testMode: 'none',
      done: false,
      interfaces: {
        consumes: ['phase 31 ## testConventions', 'phase 31 ## designHomes', 'phase 31 ## Verify'],
        produces: ['pointers.md wiring contract'],
      },
    },
    {
      id: '32.4',
      title: 'Finish the contributor contract and make README construction an explicit init step',
      problem:
        'The remaining phase-29 templates need their fill contract: contributors need the repository commit and documentation rules without process archaeology, and greenfield-init needs to build README structure and commands from selected-manifest facts before invoking the catalog check.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/templates/CONTRIBUTING.md',
          description:
            "Fill the template with commit grammar `<type>(<scope>): <imperative summary>`, the four linked documentation rules (clear and concise, no duplication, timeless, current), and the rule that a standalone decision record is created only for a boundary/security decision or one expensive to reverse; cite `plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/documentation-rules.md` as the standard and do not copy its explanatory prose. → verify: grep -qF 'expensive to reverse' plugins/zeroh-greenfield/templates/CONTRIBUTING.md",
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
          description:
            "Make the approved standards stage call `references/standards.md`, then state the README step precisely: fill Structure from the selected manifest’s `## File tree`; fill Commands from `## Generator`, `## Post-steps`, and `## Verify`; materialize the README catalog checker and the manifest’s exact check command; run it before presenting completion; then call `references/pointers.md`. → verify: grep -qF 'check-readme-catalog.mjs' plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md",
        },
      ],
      acceptanceCriteria: [
        "grep -qF '<type>(<scope>): <imperative summary>' plugins/zeroh-greenfield/templates/CONTRIBUTING.md && grep -qF 'No duplication' plugins/zeroh-greenfield/templates/CONTRIBUTING.md",
        "grep -qF '## File tree' plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md && grep -qF '## Generator' plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md && grep -qF '## Post-steps' plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md && grep -qF '## Verify' plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md",
      ],
      files: [
        'plugins/zeroh-greenfield/templates/CONTRIBUTING.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
      ],
      testMode: 'none',
      dependsOn: ['32.1', '32.2', '32.3'],
      interfaces: {
        consumes: ['standards.md authoring contract from 32.1', 'README repo-catalog table from 32.2', 'check-readme-catalog.mjs from 32.2', 'pointers.md wiring contract from 32.3'],
        produces: ['greenfield-init standards/README/pointers sequence'],
      },
      done: false,
    },
  ],
  notes:
    'interview: skipped — GREENFIELD is an arc member and its 2026-09-03 interview and user rulings are recorded in roadmap/arcs/GREENFIELD.arc.ts. Four tasks are intentional: the brief reserves this tightly coupled standards-and-pointers plane at four contracts; splitting declarative template fills would add gate cost without an independent boundary. userFacing false: this phase changes model-loaded authoring instructions and consumer-dropped templates, not a rendered or runtime feature, so no flag applies. Test modes are none per test-worthiness: documentation and templates are declarative, and there is no committed consumer-template test home; task 32.2 is proven by its two-way plan-time scratch probe and execution-time scratch observables rather than a bespoke spec. README probe observed 2026-09-03: consistent catalog exit 0; missing beta row exit 1 with `missing README project: beta (packages/beta)`; extra ghost row exit 1 with `unknown README project: ghost (apps/ghost)`. Config probes observed 2026-09-03: DesignHomesShape, architecture, qualityExemplar, copyRules, bindingDesignSystem, testConventions, gateCommands, init refusal, and placeholder-only init anchors all present (exit 0). Verify rehearsal: all three assumption commands exited 0; every step command and command-shaped criterion exited non-zero now because its phase-29/31-dependent target file is absent on this branch, which is the exact state the planned diff removes; task 32.2 scratch observable ran green/red/red as recorded. Full review is retained because the dropped catalog executable contains normalization and bidirectional comparison logic. Auto review and queueing are disabled by the planning-lane envelope; supervising session owns them.',
})
