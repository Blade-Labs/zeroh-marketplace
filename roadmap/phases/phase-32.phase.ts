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
            "Create ordered Proposal/approval, AGENTS, harness, generated-block, CODE-STYLE, architecture-index, and UX-canon sections. Require `file | source facts | planned sections` and approval before writes. AGENTS.md alone owns Conventions, Don’t, Generalize-forward, Flag-first, and release-only hold[]; cite the design gate. → verify: node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md','utf8');if('## Proposal and approval|file | source facts | planned sections|approval|## AGENTS.md|## Conventions|## Don’t|## Generalize-forward|design-gate.md|Flag-first|hold[]'.split('|').some(x=>!s.includes(x)))process.exit(1)\"",
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md',
          description:
            "Own the harness invariant phase 33 cites: CLAUDE.md is `@AGENTS.md` plus harness-only lines; other harnesses point, never copy; generated blocks including Nx markers stay byte-for-byte. Derive CODE-STYLE from lint/format config, index architecture, and link UX canon to its token home. → verify: node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md','utf8');if('## Harness pointers|@AGENTS.md|harness-only|never copy|## Generated blocks|<!-- nx configuration start -->|<!-- nx configuration end -->|byte-for-byte|## CODE-STYLE.md|lint|format|## Architecture index|## UX canon|token'.split('|').some(x=>!s.includes(x)))process.exit(1)\"",
        },
      ],
      acceptanceCriteria: [
        "node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md','utf8'),h=['## Proposal and approval','## AGENTS.md','## Harness pointers','## Generated blocks','## CODE-STYLE.md','## Architecture index','## UX canon'],p=h.map(x=>s.indexOf(x));if(p.some(x=>x<0)||p.some((x,i)=>i&&x<=p[i-1]))process.exit(1)\"",
        "node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/standards.md','utf8'),a=['file | source facts | planned sections','approval','## Conventions','## Don’t','## Generalize-forward','Flag-first','hold[]','@AGENTS.md','harness-only','never copy','<!-- nx configuration start -->','<!-- nx configuration end -->','byte-for-byte','lint','format','index','token'];if(a.some(x=>!s.includes(x)))process.exit(1)\"",
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
            "Add a `Project | Path | Purpose` table bounded by `<!-- repo-catalog:start -->` and `<!-- repo-catalog:end -->`; Project/name is the row key, Path mirrors catalog root, and Purpose stays human-authored. → verify: node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/templates/README.md','utf8'),a=['<!-- repo-catalog:start -->','| Project | Path | Purpose |','<!-- repo-catalog:end -->'];const p=a.map(x=>s.indexOf(x));if(p.some(x=>x<0)||!(p[0]<p[1]&&p[1]<p[2]))process.exit(1)\"",
        },
        {
          file: 'plugins/zeroh-greenfield/templates/scripts/check-readme-catalog.mjs',
          description:
            "Add a dependency-free ESM CLI: `--help` exits 0; README rows key by Project/name; `--catalog` accepts only a root array or `{ projects: [...] }` of `{ name, root }`; `--project-root` derives pairs from immediate directories. Red on missing markers, malformed/duplicate rows or entries, nonexistent roots, missing README rows, and orphans; green only on exact agreement. → verify: scratch probes return help=0 and match=0; missing, orphan, malformed, duplicate, bad-shape, and nonexistent-root cases return 1 with named diagnostics",
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            "In all six manifests append the catalog-check command inside `## Verify`: use `--catalog emitted/repo-catalog.json` where Post-steps generate it, otherwise one `--project-root` per project-bearing File-tree directory. → verify: node -e \"const f=require('fs'),d='plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/';for(const n of ['web','flutter','android','expo','nx-monorepo','library-cli']){const s=f.readFileSync(d+n+'.md','utf8'),i=s.indexOf('## Verify');if(i<0||s.indexOf('check-readme-catalog.mjs',i)<0)process.exit(1)}\"",
        },
      ],
      acceptanceCriteria: [
        'A scratch matrix runs `--help` (0), exact catalog agreement (0), then missing row, orphan row, malformed row, duplicate README name, duplicate catalog name, invalid catalog shape, and nonexistent catalog root (all 1 with their named diagnostics).',
        'The matrix repeats exact agreement, missing row, orphan row, duplicate name, and nonexistent directory through manifest-derived `--project-root`; missing rows print `missing README project: <name>` and orphan rows print `orphan README project: <name>`.',
        "node -e \"const f=require('fs'),d='plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/';for(const n of ['web','flutter','android','expo','nx-monorepo','library-cli']){const s=f.readFileSync(d+n+'.md','utf8'),i=s.indexOf('## Verify');if(i<0||s.indexOf('check-readme-catalog.mjs',i)<0)process.exit(1)}\"",
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
            "Create ordered Tool gate, Config branch, Merge pointers, Validate sections. Absent plugin prints its install command and STOP. No config runs init then merges; existing config never runs init and MERGEs only missing keys, preserving every key. Config check ends both branches and STOPs on red. → verify: node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md','utf8');if('## Tool gate|/plugin install zeroh-roadmap@zeroh-marketplace|STOP|## Config branch|absent|roadmap init|present|never run|MERGE only missing keys|preserv|## Merge manifest pointers|## Validate|roadmap config check'.split('|').some(x=>!s.includes(x)))process.exit(1)\"",
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md',
          description:
            "Document only config.mjs pointer keys: architecture home/extendProtocol; UX canon, qualityExemplar, copyRules, bindingDesignSystem; and testConventions. → verify: node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md','utf8');if('designHomes.architecture.home|designHomes.architecture.extendProtocol|designHomes.ux.canon|designHomes.ux.qualityExemplar|designHomes.ux.copyRules|designHomes.ux.bindingDesignSystem|testConventions'.split('|').some(x=>!s.includes(x)))process.exit(1)\"",
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md',
          description:
            "Map archetype testConventions/Verify exactly to gateCommands lint, types, unit, integration, build, e2e, emit. Empty slots use init.mjs literals. → verify: node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md','utf8');if('gateCommands.lint|gateCommands.types|gateCommands.unit|gateCommands.integration|gateCommands.build|gateCommands.e2e|gateCommands.emit|npm run lint|npm run type-check|npm test|npm run test:integration|npm run build|npm run test:e2e|npm run emit:phases'.split('|').some(x=>!s.includes(x)))process.exit(1)\"",
        },
      ],
      acceptanceCriteria: [
        "node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md','utf8'),h=['## Tool gate','## Config branch','## Merge manifest pointers','## Validate'],p=h.map(x=>s.indexOf(x));if(p.some(x=>x<0)||p.some((x,i)=>i&&x<=p[i-1])||!s.includes('roadmap config check'))process.exit(1)\"",
        "node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md','utf8'),a=['absent','roadmap init','present','never run','MERGE only missing keys','preserv','designHomes.architecture.home','designHomes.architecture.extendProtocol','designHomes.ux.canon','designHomes.ux.qualityExemplar','designHomes.ux.copyRules','designHomes.ux.bindingDesignSystem','testConventions','gateCommands.lint','gateCommands.types','gateCommands.unit','gateCommands.integration','gateCommands.build','gateCommands.e2e','gateCommands.emit'];if(a.some(x=>!s.includes(x)))process.exit(1)\"",
        "node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md','utf8'),a=['npm run lint','npm run type-check','npm test','npm run test:integration','npm run build','npm run test:e2e','npm run emit:phases'];if(a.some(x=>!s.includes(x)))process.exit(1)\"",
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
            "Fill the template with commit grammar `<type>(<scope>): <imperative summary>`, exact linked rule phrases `Clear and concise`, `No duplication`, `Timeless`, and `Current`, plus the standalone-record bar for boundary/security decisions or choices expensive to reverse. Cite documentation-rules.md without copying its explanations. → verify: node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/templates/CONTRIBUTING.md','utf8'),a=['<type>(<scope>): <imperative summary>','Clear and concise','No duplication','Timeless','Current','boundary','security','expensive to reverse','documentation-rules.md'];if(a.some(x=>!s.includes(x)))process.exit(1)\"",
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
          description:
            "Call standards.md. Fill README Structure from File tree and Commands from Generator, Post-steps, Verify; materialize and run the exact checker command, call pointers.md, then complete. → verify: node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md','utf8'),a='references/standards.md|## Structure|## File tree|## Commands|## Generator|## Post-steps|## Verify|check-readme-catalog.mjs|references/pointers.md|## Done'.split('|'),p=a.map(x=>s.indexOf(x));if(p.some(x=>x<0)||!(p[0]<p[1]&&p[1]<p[7]&&p[7]<p[8]&&p[8]<p[9]))process.exit(1)\"",
        },
      ],
      acceptanceCriteria: [
        "node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/templates/CONTRIBUTING.md','utf8'),a=['<type>(<scope>): <imperative summary>','Clear and concise','No duplication','Timeless','Current','boundary','security','expensive to reverse','documentation-rules.md'];if(a.some(x=>!s.includes(x)))process.exit(1)\"",
        "node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md','utf8'),a='references/standards.md|## Structure|## File tree|## Commands|## Generator|## Post-steps|## Verify|check-readme-catalog.mjs|references/pointers.md|## Done'.split('|'),p=a.map(x=>s.indexOf(x));if(p.some(x=>x<0)||!(p[0]<p[1]&&p[1]<p[7]&&p[7]<p[8]&&p[8]<p[9]))process.exit(1)\"",
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
    'interview: skipped — GREENFIELD is an arc member and its 2026-09-03 interview and user rulings are recorded in roadmap/arcs/GREENFIELD.arc.ts. Four tasks are intentional: the brief reserves this tightly coupled standards-and-pointers plane at four contracts; splitting declarative template fills would add gate cost without an independent boundary. userFacing false: this phase changes model-loaded authoring instructions and consumer-dropped templates, not a rendered or runtime feature, so no flag applies. Test modes are none per test-worthiness: documentation and templates are declarative. Task 32.2 deviation: the skills+templates-only plugin ships no test harness; its executable checker is proven by the plan-time two-way/error-path probe and phase 34.4 dry run; decisionRef: \'GREENFIELD orchestrator ruling 2026-09-03 — skills+templates-only plugin ships no test harness; proof = plan-time two-way probe + phase 34.4 dry run\'. README probe observed 2026-09-03: consistent catalog exit 0; missing beta row exit 1 with `missing README project: beta (packages/beta)`; extra ghost row exit 1 with `orphan README project: ghost (apps/ghost)`. Config probes observed 2026-09-03: DesignHomesShape, architecture, qualityExemplar, copyRules, bindingDesignSystem, testConventions, gateCommands, init refusal, and all seven init.mjs placeholder strings present (exit 0). Phase 32 owns the shared harness-file invariants in standards.md; phase 33 cites that owner and supplies only the brownfield reconciliation delta. Verify rehearsal: all three assumption commands exited 0; every step command and command-shaped criterion exited non-zero because its phase-29/31-dependent output is absent, the exact state the diff removes; task 32.2 scratch observable covered help, matching, missing, orphan, malformed, duplicate, catalog-shape, and project-root branches. Full review is retained because the dropped checker contains normalization and bidirectional comparison logic. Auto review and queueing are disabled by the planning-lane envelope; supervising session owns them. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): strengthened 32.1 complete standards and harness assertions; recorded the 32.2 no-test-harness deviation and full behavior matrix; made 32.3 existing-config merge flow, exact gate mapping, placeholders, and validation explicit; strengthened 32.4 contributor and init-sequence assertions.',
})
