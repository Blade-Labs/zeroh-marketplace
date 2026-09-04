import { definePhase } from '@/lib/roadmap/schema'

/**
 * GREENFIELD standards-and-pointers plane: one conventions home, mechanically current README,
 * and roadmap-native configuration wiring. Phase 29 supplies the consumer-file contracts and
 * phase 31 supplies the six archetype manifests; this phase teaches greenfield-init how to fill
 * those contracts without duplicating facts or writing before approval.
 *
 * timing: band 4-6 × surface:false, N=5; recalibrate after the source-aware gate task lands
 */
export default definePhase({
  phase: 32,
  name: 'Author standards once, enforce README catalog currency, and wire roadmap-native pointers',
  status: 'in-progress',
  plannedBy: { model: 'gpt-5.6-sol' },
  arcId: 'GREENFIELD',
  category: 'feature',
  kind: 'logic',
  source:
    'roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design item 5, the GREENFIELD promise ledger, greenfield brief 32, and the 2026-09-04 affected-first ruling; conventions land once, README currency is checked, and source-aware Nx gates fail toward full.',
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
    'plugins/zeroh-greenfield/templates/scripts/run-nx-test-tier.mjs',
    'plugins/zeroh-roadmap/cli/lib/config.mjs',
    'plugins/zeroh-roadmap/cli/lib/config.test.mjs',
    'plugins/zeroh-roadmap/cli/roadmap.config.schema.json',
    'plugins/zeroh-roadmap/cli/commands/config.mjs',
    'plugins/zeroh-roadmap/cli/lib/gate-report.mjs',
    'plugins/zeroh-roadmap/cli/commands/config.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/slots.mjs',
    'plugins/zeroh-roadmap/cli/lib/slots.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
    'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/landing.mjs',
    'plugins/zeroh-roadmap/cli/lib/landing.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/landing-mechanics.test.mjs',
  ],
  stakeholderDemo:
    'In an approved scratch Nx consumer, roadmap config check resolves testCadence and distinct full/scoped/affected/impacted gates; a leaf source runs only affected projects, unsafe scope visibly falls back full, and the standards plus README invariants remain green.',
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
      done: true,
      transparencyReport: { whatWasDone: 'Created the approval-gated standards and harness-pointer authoring contract.', how: 'Assigned conventions solely to AGENTS.md, preserved generated blocks, and bound code style, architecture, and UX sources.', compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'Declarative template guidance only.' },
      interfaces: {
        consumes: ['phase 29 standards-template section contracts', 'phase 31 ## Conventions delta'],
        produces: ['standards.md authoring contract'],
      },
    },
    {
      id: '32.2',
      title: 'Make README project currency a dependency-free catalog invariant',
      problem:
        'A “keep README in sync” sentence did not prevent zeroh’s catalog from omitting 5 of 19 projects. The consumer needs a stable table contract and a dropped Node checker that compares both directions against generated catalog data or the selected manifest’s declared project roots. GREENFIELD.arc.ts LOCKED DECISIONS, 2026-09-03 (ruling on the phase-32 review), classifies a file the plugin drops into and runs in the consumer as a TEMPLATE, not plugin code.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/templates/README.md',
          description:
            "Add a `Project | Path | Purpose` table bounded by `<!-- repo-catalog:start -->` and `<!-- repo-catalog:end -->`; Project/name is the row key, Path mirrors catalog root, and Purpose stays human-authored. → verify: node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/templates/README.md','utf8'),a=['<!-- repo-catalog:start -->','| Project | Path | Purpose |','<!-- repo-catalog:end -->'];const p=a.map(x=>s.indexOf(x));if(p.some(x=>x<0)||!(p[0]<p[1]&&p[1]<p[2]))process.exit(1)\"",
        },
        {
          file: 'plugins/zeroh-greenfield/templates/scripts/check-readme-catalog.mjs',
          description:
            "Implement the dependency-free checker, both catalog shapes, both input modes, and named bidirectional errors. → verify: node -e \"const f=require('fs'),c=require('child_process'),p='plugins/zeroh-greenfield/templates/scripts/check-readme-catalog.mjs',s=f.readFileSync(p,'utf8'),a=['--catalog','--project-root','missing README project','orphan README project'],h=/includes\\(['\\\"]--help|case\\s+['\\\"]--help/,n=/Array\\.isArray\\((\\w+)\\)\\s*\\?\\s*\\1\\s*:\\s*\\1\\.projects/;if(c.spawnSync(process.execPath,['--check',p]).status||a.some(x=>!s.includes(x))||!h.test(s)||!n.test(s))process.exit(1)\"",
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            "Append each checker command under Verify: nx uses `--catalog emitted/repo-catalog.json`; the other five use `--project-root .`. → verify: node -e \"const f=require('fs'),d='plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/',a=['web','flutter','android','expo','nx-monorepo','library-cli'];for(const n of a){const s=f.readFileSync(d+n+'.md','utf8'),v=s.slice(s.indexOf('## Verify')),x=n==='nx-monorepo'?'--catalog emitted/repo-catalog.json':'--project-root .';if(!v.startsWith('## Verify')||!v.includes('node scripts/check-readme-catalog.mjs '+x))process.exit(1)}\"",
        },
      ],
      acceptanceCriteria: [
        'A scratch matrix runs `--help` (0), exact catalog agreement (0), then missing row, orphan row, malformed row, duplicate README name, duplicate catalog name, invalid catalog shape, and nonexistent catalog root (all 1 with their named diagnostics).',
        'The matrix repeats exact agreement, missing row, orphan row, duplicate name, and nonexistent directory through manifest-derived `--project-root`; missing rows print `missing README project: <name>` and orphan rows print `orphan README project: <name>`.',
        "node -e \"const f=require('fs'),d='plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/',ns=['web','flutter','android','expo','nx-monorepo','library-cli'];for(const n of ns){const s=f.readFileSync(d+n+'.md','utf8'),v=s.slice(s.indexOf('## Verify')),arg=n==='nx-monorepo'?'--catalog emitted/repo-catalog.json':'--project-root .',r=new RegExp('node scripts/check-readme-catalog\\\\.mjs\\\\s+'+arg.replaceAll('.','\\\\.'));if(!v.startsWith('## Verify')||!r.test(v))process.exit(1)}\"",
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
      done: true,
      transparencyReport: { whatWasDone: 'Added the bounded README catalog and dependency-free bidirectional checker, then wired all six manifest Verify sections.', how: 'The checker accepts catalog and project-root modes, validates shapes and duplicates, and names missing/orphan rows.', compromises: 'No plugin test harness exists; behavior is exercised by scratch probes and phase 34.', decisionRef: 'GREENFIELD orchestrator ruling 2026-09-03 — skills+templates-only plugin ships no test harness; proof = plan-time two-way probe + phase 34.4 dry run', skipped: 'None', hardcoded: 'None', limitations: 'Purpose text remains intentionally human-authored.' },
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
            "Add one slot/command/source table per archetype with all seven non-empty required base gate rows and schema-supported optional rows. → verify: node -e \"F=require('fs'),D='plugins/zeroh-greenfield/skills/greenfield-init/references/',P=F.readFileSync(D+'pointers.md','utf8'),S='build e2e emit integration lint types unit';for(N of'web flutter android expo nx-monorepo library-cli'.split(' ')){Q=new RegExp('^### '+N+'$','gm');if((P.match(Q)||[]).length!=1)throw 0;B=P.slice(P.search(Q)).split(/\\n### /)[0];R=[...B.matchAll(/^\\|\\s*(\\w+)\\s*\\|\\s*([^|]+?)\\s*\\|\\s*([^|]+?)\\s*\\|$/gm)].filter(X=>X[1]!='slot');if(B.split('| slot | command | source |').length!=2||R.length<7||S.split(' ').some(Z=>!R.some(X=>X[1]==Z))||R.some(X=>!X[2].trim()))throw 0}\"",
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md',
          description:
            "Bind sources to manifest headings or `placeholder`. → verify: node -e \"process.chdir('plugins/zeroh-greenfield/skills/greenfield-init/references');F=require('fs'),C=require('child_process'),P=F.readFileSync('pointers.md')+'';for(N of'web flutter android expo nx-monorepo library-cli'.split(' ')){B=P.slice(P.indexOf('### '+N)).split(/\\n### /)[0];M=F.readFileSync('archetypes/'+N+'.md')+'';R=[...B.matchAll(/^\\|\\s*\\w+\\s*\\|\\s*([^|]+?)\\s*\\|\\s*(## testConventions|## Post-steps|placeholder)\\s*\\|$/gm)];if(R.length<7)throw 0;for(X of R)if(X[2]!='placeholder'&&(!M.split(X[2])[1]?.split(/^## /m)[0].includes(X[1].trim())||C.spawnSync('grep',['-Fq',X[1].trim(),'archetypes/'+N+'.md']).status))throw 0}\"",
        },
      ],
      acceptanceCriteria: [
        "node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md','utf8'),h=['## Tool gate','## Config branch','## Merge manifest pointers','## Validate'],p=h.map(x=>s.indexOf(x));if(p.some(x=>x<0)||p.some((x,i)=>i&&x<=p[i-1])||!s.includes('roadmap config check'))process.exit(1)\"",
        "node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md','utf8'),a=['absent','roadmap init','present','never run','MERGE only missing keys','preserv','designHomes.architecture.home','designHomes.architecture.extendProtocol','designHomes.ux.canon','designHomes.ux.qualityExemplar','designHomes.ux.copyRules','designHomes.ux.bindingDesignSystem','testConventions','gateCommands.lint','gateCommands.types','gateCommands.unit','gateCommands.integration','gateCommands.build','gateCommands.e2e','gateCommands.emit'];if(a.some(x=>!s.includes(x)))process.exit(1)\"",
        "node -e \"process.chdir('plugins/zeroh-greenfield/skills/greenfield-init/references');F=require('fs'),C=require('child_process'),P=F.readFileSync('pointers.md')+'',S='build e2e emit integration lint types unit';for(N of'web flutter android expo nx-monorepo library-cli'.split(' ')){Q=new RegExp('^### '+N+'$','gm');if((P.match(Q)||[]).length!=1)throw 0;B=P.slice(P.search(Q)).split(/\\n### /)[0];M=F.readFileSync('archetypes/'+N+'.md')+'';R=[...B.matchAll(/^\\|\\s*(\\w+)\\s*\\|\\s*([^|]+?)\\s*\\|\\s*(## testConventions|## Post-steps|placeholder)\\s*\\|$/gm)];if(B.split('| slot | command | source |').length!=2||R.length<7||S.split(' ').some(Z=>!R.some(X=>X[1]==Z))||R.some(X=>!X[2].trim()))throw 0;for(X of R)if(X[3]!='placeholder'&&(!M.split(X[3])[1]?.split(/^## /m)[0].includes(X[2].trim())||C.spawnSync('grep',['-Fq','--',X[2].trim(),'archetypes/'+N+'.md']).status))throw 0}\"",
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md'],
      testMode: 'none',
      done: true,
      transparencyReport: { whatWasDone: 'Documented safe roadmap-native pointer merging and seven required base gate slots plus schema-supported optional slots for the selected archetype.', how: 'The contract gates plugin availability, distinguishes absent and present config branches, preserves existing keys, maps only supported pointer vocabulary, and validates both paths.', compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'Commands remain explicit placeholders when manifests do not prescribe the slot.' },
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
            "Require manifest-derived README content, then the exact copy/run/exit sentences before pointers and Done. → verify: node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md','utf8'),h=['references/standards.md','## Structure','## Commands','Copy templates/scripts/check-readme-catalog.mjs into the consumer at scripts/check-readme-catalog.mjs.',\"Run the selected manifest's exact checker command.\",'Record its exit code before Done.','references/pointers.md','## Done'],p=h.map(x=>s.indexOf(x));if(p.some((x,i)=>x<0||(i&&x<=p[i-1]))||'## File tree|## Generator|## Post-steps|## Verify'.split('|').some(x=>!s.includes(x)))process.exit(1)\"",
        },
      ],
      acceptanceCriteria: [
        "node -e \"const s=require('fs').readFileSync('plugins/zeroh-greenfield/templates/CONTRIBUTING.md','utf8'),a=['<type>(<scope>): <imperative summary>','Clear and concise','No duplication','Timeless','Current','boundary','security','expensive to reverse','documentation-rules.md'];if(a.some(x=>!s.includes(x)))process.exit(1)\"",
        "bash -c \"grep -qF 'Copy templates/scripts/check-readme-catalog.mjs into the consumer at scripts/check-readme-catalog.mjs.' plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md && grep -qF \\\"Run the selected manifest's exact checker command.\\\" plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md && grep -qF 'Record its exit code before Done.' plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md && node -e \\\"const s=require('fs').readFileSync('plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md','utf8'),h=['references/standards.md','## Structure','## Commands','Copy templates/scripts/check-readme-catalog.mjs into the consumer at scripts/check-readme-catalog.mjs.',\\\"Run the selected manifest's exact checker command.\\\",'Record its exit code before Done.','references/pointers.md','## Done'],p=h.map(x=>s.indexOf(x));if(p.some(x=>x<0)||p.some((x,i)=>i&&x<=p[i-1]))process.exit(1)\\\"\"",
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
      done: true,
      transparencyReport: { whatWasDone: 'Finished the contributor contract and made manifest-derived README construction and catalog verification explicit.', how: 'The contribution template links the documentation rules and durable-decision bar; greenfield-init now orders standards, README structure, commands, checker copy/run/evidence, pointers, and Done.', compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'None' },
    },
    {
      id: '32.5',
      title: 'Generate affected-first roadmap gates with safe scope manifests and full fallback',
      problem:
        'Roadmap relevant scope currently sees only test files, so source changes can skip runtime verification. GREENFIELD also omits testCadence, lacks installed-version compatibility, and would expose phase filenames to shell interpolation. The contract needs one source-aware, manifest-safe seam that fails toward full.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs',
          description:
            'TDD first through real gate plan/run and landing homes: leaf source without colocated tests reaches unit-affected; exact tests reach unit-scoped; arc @manifest/range reaches unit-impacted; full fallback is byte-identical. Cover deleted files, empty scope, alias/report serialization, manifest cleanup, old capability response, Git failure, and adversarial filenames containing whitespace, leading dash, quotes, dollar/substitution, semicolon, and newline. Record RED. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/slots.mjs',
          description:
            'Add strict unit-affected/integration-affected config keys and one versioned `scope-manifest-json-v1` protocol for phase and arc: gate and landing own temporary JSON manifests of validated living paths, substitute only a validated quoted `@manifest` token through `{manifest}`, and always clean it. Existing `{files}` consumers remain compatible, but GREENFIELD-generated scoped/affected commands use manifests. Relevant receives all phase-own paths; scoped receives exact/colocated tests; missing/malformed/unsafe scope or manifest failure resolves byte-identical full. Update slot aliases, reports, parser/schema, and tests. → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/slots.test.mjs plugins/zeroh-roadmap/cli/commands/gate.test.mjs plugins/zeroh-roadmap/cli/lib/config.test.mjs plugins/zeroh-roadmap/cli/commands/config.test.mjs plugins/zeroh-roadmap/cli/lib/landing.test.mjs plugins/zeroh-roadmap/cli/lib/landing-mechanics.test.mjs plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/config.mjs',
          description:
            'Add a read-only `roadmap config capabilities --json` contract reporting configVersion, accepted gate slots, and scopeManifestProtocol. Greenfield probes it before proposing affected keys; missing unit-affected/unit-impacted/{manifest} support prints the exact marketplace update command and STOPs before consumer writes. Test current and legacy capability fixtures. → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/config.test.mjs plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/scripts/run-nx-test-tier.mjs',
          description:
            'Implement the dependency-free selector over one roadmap-owned scope-manifest-json-v1 @JSON manifest or a validated base..head input. Convert manifest paths to exact `npm exec -- nx affected -t test --files=...` argv without shell re-parsing; inspect range files before selection; and use `npm exec -- nx run-many -t test` on missing, malformed, Git-failed, or unsafe root/workspace/lock/test-runner scope. Emit machine-readable tier/reason/argv, reject nonexistent exact-test targets, and pin argv in fake-Nx assertions. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
          description:
            'Move roadmap availability and `roadmap config capabilities --json` into the first read-only preflight, before proposal, approval, generator, standards, README, or any other consumer write. Absent command, nonzero/malformed response, protocol version below `scope-manifest-json-v1`, or missing required slots prints the exact marketplace upgrade command and STOPs with zero writes. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs plugins/zeroh-roadmap/test/fixture-consumer/greenfield-behavior.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            'Own the exact distinct full, scoped-manifest, affected-manifest, and impacted command strings plus local/phase/arc/full-CI cadence under testConventions. Pointer rows must be derived from this heading, never placeholder text, and every command uses the selected npm package manager form. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md',
          description:
            'After the capability probe and approval, merge testCadence.enabled plus distinct unit full, unit-scoped `{manifest}`, unit-affected `{manifest}`, and unit-impacted `{range}` bindings while preserving existing values. Lint/types/build own one affected target each. Update the seven-required-base-row invariant to admit and validate only schema-supported optional rows; copy the selector before config check. Record RED/GREEN and supersede the stale four-task eval. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/cli/lib/slots.test.mjs plugins/zeroh-roadmap/cli/commands/gate.test.mjs plugins/zeroh-roadmap/cli/lib/config.test.mjs plugins/zeroh-roadmap/cli/commands/config.test.mjs plugins/zeroh-roadmap/cli/lib/landing.test.mjs plugins/zeroh-roadmap/cli/lib/landing-mechanics.test.mjs plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs',
        'Real gate plan/run selects affected for leaf source, scoped for exact tests, impacted for arc inputs, and byte-identical full for unsafe/indeterminate scope; reports, aliases, deleted paths, and manifest cleanup are proven.',
        'No consumer filename is shell-interpolated: generated bindings receive only a validated @manifest token; adversarial filenames cannot split argv or execute; nonexistent exact targets cannot green.',
        'A legacy roadmap capability probe STOPs before writes with an upgrade remedy; current config accepts every generated key; prior task 32.3 still requires seven base rows and validates only supported optional rows.',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/roadmap.config.schema.json',
        'plugins/zeroh-roadmap/cli/lib/config.mjs',
        'plugins/zeroh-roadmap/cli/lib/config.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/config.mjs',
        'plugins/zeroh-roadmap/cli/commands/config.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/slots.mjs',
        'plugins/zeroh-roadmap/cli/lib/slots.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/gate-report.mjs',
        'plugins/zeroh-roadmap/cli/lib/landing.mjs',
        'plugins/zeroh-roadmap/cli/lib/landing.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/landing-mechanics.test.mjs',
        'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-test-selection.test.mjs',
        'plugins/zeroh-greenfield/templates/scripts/run-nx-test-tier.mjs',
        'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['32.3'],
      interfaces: {
        consumes: ['roadmap test-scope ladder', 'phase-own files', 'Nx affected graph'],
        produces: ['manifest-safe source-aware gate seam', 'read-only compatibility capability', 'generated affected-first Nx selector'],
      },
    },
  ],
  reviewRecord: { date: '2026-09-04', model: 'pending-independent-review', verdict: 'NEEDS_WORK', via: 'executed' },
  notes:
    'interview: skipped — GREENFIELD is an arc member and its 2026-09-03 and 2026-09-04 user rulings are recorded in roadmap/arcs/GREENFIELD.arc.ts. Five tasks are intentional: 32.1–32.4 retain the standards-and-pointers contracts; 32.5 adds the independently executable affected-test seam required by the 2026-09-04 ruling. userFacing false: this phase changes model-loaded authoring instructions and consumer-dropped templates, not a rendered or runtime feature, so no flag applies. Tasks 32.1–32.4 remain testMode none because their documentation and templates are declarative; 32.5 is TDD because it adds executable selection and roadmap integration behavior. Task 32.2 architecture ruling: GREENFIELD.arc.ts LOCKED DECISIONS, 2026-09-03 (ruling on the phase-32 review), says “skills + templates only” governs the plugin runtime shape and a file dropped into and run in the consumer is a TEMPLATE, not plugin code; therefore templates/scripts/check-readme-catalog.mjs remains in scope. Task 32.2 deviation: the skills+templates-only plugin ships no test harness; its executable checker is proven by the plan-time two-way/error-path probe and phase 34.4 dry run; decisionRef: \'GREENFIELD orchestrator ruling 2026-09-03 — skills+templates-only plugin ships no test harness; proof = plan-time two-way probe + phase 34.4 dry run\'. README probe observed 2026-09-03: consistent catalog exit 0; missing beta row exit 1 with `missing README project: beta (packages/beta)`; extra ghost row exit 1 with `orphan README project: ghost (apps/ghost)`. Config probes observed 2026-09-03: DesignHomesShape, architecture, qualityExemplar, copyRules, bindingDesignSystem, testConventions, gateCommands, init refusal, and all seven init.mjs placeholder strings present (exit 0). Phase 32 owns the shared harness-file invariants in standards.md; phase 33 cites that owner and supplies only the brownfield reconciliation delta. Verify rehearsal: all three assumption commands exited 0; every step command and command-shaped criterion exited non-zero because its phase-29/31-dependent output is absent, the exact state the diff removes; task 32.2 scratch observable covered help, matching, missing, orphan, malformed, duplicate, catalog-shape, and project-root branches. Full review is retained because the dropped checker contains normalization and bidirectional comparison logic. Auto review and queueing are disabled by the planning-lane envelope; supervising session owns them. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): strengthened 32.1 complete standards and harness assertions; recorded the 32.2 no-test-harness deviation and full behavior matrix; made 32.3 existing-config merge flow, exact gate mapping, placeholders, and validation explicit; strengthened 32.4 contributor and init-sequence assertions.\nReview repairs round 2 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): cited the consumer-dropped-template ruling for 32.2; enforced standards → README Structure → README Commands → checker → pointers → Done in 32.4.\nReview repairs round 3 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): 32.2 structurally asserts checker parsing, flags, normalization, red messages, and six exact invocation forms; 32.3 parses seven unique gate-slot rows and cross-checks each command against an archetype manifest; 32.4 requires exact copy, run, and exit-code sentences in fixed order; scratch red/green rehearsal observed every repaired clause exit 1 incomplete and exit 0 complete.\nReview repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): unified the 32.2 orphan diagnostic vocabulary; restored per-archetype seven-slot command-to-manifest-heading mappings with structural and grep-F source checks; scratch rehearsal recorded structural RED 1/GREEN 0, binding RED 1/GREEN 0, and wrong-source RED 1.',
})
