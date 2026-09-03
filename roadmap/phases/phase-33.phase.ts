import { definePhase } from '@/lib/roadmap/schema'

/**
 * GREENFIELD brownfield plane — audit an established repository, propose only its gaps,
 * reconcile duplicated instruction/catalog surfaces, and leave a compact oracle fixture for
 * the keystone dry run. Design: roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design item 6.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 33,
  name: 'Brownfield gap audit, harness and README reconciliation, and zeroh-shaped oracle fixture',
  status: 'backlog',
  plannedBy: { model: 'gpt-5.6-sol' },
  category: 'feature',
  kind: 'logic',
  source:
    'Arc GREENFIELD designRef roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design item 6 and the zeroh sweep in §Why this exists; scope and user rulings are fixed by roadmap/arcs/GREENFIELD.arc.ts.',
  priority: 'HIGH',
  dependsOn: [29, 30, 32],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
    'plugins/zeroh-greenfield/skills/brownfield-audit/references/marker-table.md',
    'plugins/zeroh-greenfield/skills/brownfield-audit/references/harness-files.md',
    'plugins/zeroh-greenfield/skills/brownfield-audit/references/readme-reconcile.md',
    'plugins/zeroh-greenfield/fixtures/zeroh-shaped/',
    'plugins/zeroh-greenfield/fixtures/README.md',
  ],
  stakeholderDemo:
    'Against the zeroh-shaped fixture, brownfield-audit reports the expected present/partial/missing/stale rows, writes nothing before approval, then proposes only missing homes plus precise harness and README reconciliations.',
  userFacing: false,
  reviewScope: 'full',
  assumptions: [
    {
      claim: 'GREENFIELD assigns phase 33 to its brownfield plane and locks brownfield into v1.',
      verify:
        'bash -c "grep -qF \"{ name: \'brownfield\', phases: [33] }\" roadmap/arcs/GREENFIELD.arc.ts && grep -qF \'brownfield gap-fill mode is IN v1\' roadmap/arcs/GREENFIELD.arc.ts"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The workflow-skill quality bar still defines heading-order, failure-exit, and artifact-done rules R11, R13, and R23.',
      verify:
        'bash -c "grep -qF \'R11. Heading order = execution order\' plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md && grep -qF \'R13. Failure exits are named\' plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md && grep -qF \'R23. Done is an artifact\' plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The read-only zeroh prior art has a 19-project emitted catalog, four architecture topic docs, and no PRD, ADR directory, CODE-STYLE, architecture index, ux-canon, or roadmap config.',
      verify:
        'bash -c "test \"$(node -e \"console.log(require(\'/home/patrik/zeroh/emitted/repo-catalog.json\').projects.length)\")\" = 19 && test \"$(find /home/patrik/zeroh/docs/architecture -maxdepth 1 -type f | wc -l)\" = 4 && test ! -e /home/patrik/zeroh/docs/PRD.md && test ! -d /home/patrik/zeroh/docs/adr && test ! -e /home/patrik/zeroh/docs/CODE-STYLE.md && test ! -e /home/patrik/zeroh/docs/architecture.md && test ! -e /home/patrik/zeroh/docs/ux-canon.md && test ! -e /home/patrik/zeroh/roadmap.config.json"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '33.1',
      title: 'Brownfield audit workflow and total gap-table contract',
      problem:
        'The new plugin has no brownfield workflow that can distinguish established repository assets from gaps, preserve an existing fact home, or enforce the arc honesty rail that approval precedes every write. The workflow must consume stack-decision and the standards/pointer templates without copying their contracts.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/brownfield-audit/references/marker-table.md',
          description:
            'Define one marker-table row each for package managers, framework files, monorepo tools, docs, harness files, roadmap config, superpowers directories, and design-system files. Give every row evidence globs and present/partial/missing/stale interpretation; absence never proves a stack → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/marker-table.md\',\'utf8\'); for(const x of [\'| Marker | Evidence | Interpretation |\',\'Package managers\',\'Framework files\',\'Monorepo tools\',\'Docs\',\'Harness files\',\'Roadmap config\',\'Superpowers directory\',\'Design-system files\']) if(!s.includes(x)) process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
          description:
            'Author the ≤200-line detect → gap table → propose → approval → act → verify workflow. Fix the five columns and four states; existing homes get links, ADR gaps call stack-decision, and approval is recorded in PRD Decisions or ADR Context. Name missing-approval and absent-sibling STOP/install branches, both sibling boundaries, and artifact verdicts → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md\',\'utf8\'),h=[\'## Detect\',\'## Gap table\',\'## Propose\',\'## Approval\',\'## Act\',\'## Verify\',\'## Done\']; let p=-1; for(const x of h){const n=s.indexOf(x);if(n<=p)process.exit(1);p=n} for(const x of [\'Artefact | State | Evidence path | Proposed action | Existing home to LINK\',\'present\',\'partial\',\'missing\',\'stale\',\'approval before any write\',\'STOP\',\'/plugin install zeroh-roadmap@zeroh-marketplace\',\'/plugin install zeroh-design@zeroh-marketplace\',\'Not this skill: greenfield-init\',\'Not this skill: stack-decision\',\'verdict\']) if(!s.includes(x))process.exit(1); if(s.split(/\\n/).length>200)process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/marker-table.md\',\'utf8\');for(const x of [\'Package managers\',\'Framework files\',\'Monorepo tools\',\'Docs\',\'Harness files\',\'Roadmap config\',\'Superpowers directory\',\'Design-system files\'])if(!s.includes(x))process.exit(1)"',
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md\',\'utf8\');for(const x of [\'Artefact | State | Evidence path | Proposed action | Existing home to LINK\',\'present\',\'partial\',\'missing\',\'stale\',\'observed: <result>\',\'index and link\',\'approval before any write\',\'STOP\',\'/plugin install zeroh-roadmap@zeroh-marketplace\',\'/plugin install zeroh-design@zeroh-marketplace\',\'Not this skill: greenfield-init\',\'Not this skill: stack-decision\',\'verdict\'])if(!s.includes(x))process.exit(1)"',
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md\',\'utf8\'),h=[\'## Detect\',\'## Gap table\',\'## Propose\',\'## Approval\',\'## Act\',\'## Verify\',\'## Done\'];let p=-1;for(const x of h){const n=s.indexOf(x);if(n<=p)process.exit(1);p=n}"',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
        'plugins/zeroh-greenfield/skills/brownfield-audit/references/marker-table.md',
      ],
      testMode: 'none',
      interfaces: {
        consumes: [
          'zeroh-greenfield:stack-decision from phase 30',
          'references/pointers.md from phase 32',
          'templates/ from phase 29',
        ],
        produces: ['zeroh-greenfield:brownfield-audit', 'Brownfield gap-table contract'],
      },
      done: false,
    },
    {
      id: '33.2',
      title: 'Harness files reconcile to one AGENTS.md conventions home',
      problem:
        'Established repositories can carry near-duplicate AGENTS.md, CLAUDE.md, GEMINI.md, Copilot, Cursor, Codex, Gemini, OpenCode, and agents instructions. Rewriting them independently creates drift and can corrupt generated harness blocks such as Nx configuration.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/brownfield-audit/references/harness-files.md',
          description:
            'Keep this reference brownfield-delta-only and cite `greenfield-init/references/standards.md` as owner of shared harness invariants. Inventory every existing harness file and its unique material, show an exact reduce-to-pointer diff before approval, and byte-compare every auto-generated marker block before/after; cite POLYSEAT for no-Claude privilege → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/harness-files.md\',\'utf8\');for(const x of [\'greenfield-init/references/standards.md\',\'inventory\',\'unique material\',\'reduce-to-pointer diff\',\'before approval\',\'byte-for-byte\',\'auto-generated marker\',\'roadmap/arc-prompts/POLYSEAT-execution-prompt.md\'])if(!s.includes(x))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/harness-files.md\',\'utf8\');for(const x of [\'greenfield-init/references/standards.md\',\'inventory\',\'unique material\',\'reduce-to-pointer diff\',\'before approval\',\'byte-for-byte\',\'auto-generated marker\'])if(!s.includes(x))process.exit(1)"',
        'The brownfield reference explicitly delegates AGENTS ownership, imports/pointers, and shared generated-block rules to phase 32’s standards.md; it contains only discovery, unique-material inventory, exact pre-approval diff, and byte-preservation deltas.',
      ],
      files: ['plugins/zeroh-greenfield/skills/brownfield-audit/references/harness-files.md'],
      testMode: 'none',
      done: false,
    },
    {
      id: '33.3',
      title: 'README catalog reconciliation reuses the generated catalog check',
      problem:
        'Zeroh demonstrates that a prose instruction to keep a workspace catalog current can coexist with missing rows. Brownfield mode needs an exact source-of-truth comparison and must neither invent projects nor duplicate phase 32’s checker algorithm.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/brownfield-audit/references/readme-reconcile.md',
          description:
            'Discover the catalog and run phase 32’s checker for an initial red. Propose additions only with both a catalog entry and existing root, classify README-only rows as orphans for explicit retain/remove approval, then rerun the same checker to final green. Apply documentation rules → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/readme-reconcile.md\',\'utf8\');for(const x of [\'templates/scripts/check-readme-catalog.mjs\',\'initial red\',\'final green\',\'catalog entry\',\'existing project root\',\'orphan\',\'retain\',\'remove\',\'approval\'])if(!s.includes(x))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/readme-reconcile.md\',\'utf8\');for(const x of [\'templates/scripts/check-readme-catalog.mjs\',\'initial red\',\'final green\',\'catalog entry\',\'existing project root\',\'orphan\',\'retain\',\'remove\',\'approval\'])if(!s.includes(x))process.exit(1)"',
        'The reference invokes phase 32’s checker for both red and green, requires catalog-entry-plus-existing-root proof for additions, and leaves orphan deletion to explicit approval rather than invention or silent removal.',
      ],
      files: ['plugins/zeroh-greenfield/skills/brownfield-audit/references/readme-reconcile.md'],
      testMode: 'none',
      interfaces: {
        consumes: ['templates/scripts/check-readme-catalog.mjs from phase 32'],
        produces: ['Brownfield README reconciliation contract'],
      },
      done: false,
    },
    {
      id: '33.4',
      title: 'Small zeroh-shaped fixture and expected gap-table oracle',
      problem:
        'Phase 34 and validate-arc need a deterministic brownfield repository that reproduces zeroh’s structural gaps without copying zeroh content, Blade team names, or local conventions. Without a committed oracle, a plausible but incomplete audit cannot be distinguished from the required result.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/fixtures/zeroh-shaped/',
          description:
            'Create the ≤25-file fixture with Nx/workspaces, six generic projects and catalog entries, exactly four README rows including one orphan whose root is absent, and at least one catalog project omitted from README. Include duplicate harness text around paired Nx markers, two components files without registries, and an architecture topic naming a removed package. Omit all gap homes and Blade/zeroh content → verify: node -e "const fs=require(\'fs\'),p=\'plugins/zeroh-greenfield/fixtures/zeroh-shaped/\',c=JSON.parse(fs.readFileSync(p+\'emitted/repo-catalog.json\')).projects,r=fs.readFileSync(p+\'README.md\',\'utf8\'),a=fs.readFileSync(p+\'docs/architecture/workflow.md\',\'utf8\'),h=fs.readFileSync(p+\'CLAUDE.md\',\'utf8\');if(c.length!==6||(r.match(/^\\|[^|]+\\|[^|]+\\|[^|]+\\|$/gm)||[]).length!==4||!c.every(x=>fs.existsSync(p+(x.path||x.root)))||!c.some(x=>!r.includes(x.path||x.root))||!r.includes(\'apps/orphan\')||fs.existsSync(p+\'apps/orphan\')||!a.includes(\'removed package\')||!h.includes(\'nx configuration start\')||!h.includes(\'nx configuration end\'))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/fixtures/README.md',
          description:
            'Document every synthetic condition and an exact five-column oracle. Its expected gap table must contain present, partial, missing, and stale rows, including the orphan README row, missing catalog row, and removed-package architecture evidence. Mark the fixture synthetic and apply documentation rules → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/fixtures/README.md\',\'utf8\');for(const x of [\'| Artefact | State | Evidence path | Proposed action | Existing home to LINK |\',\'| present |\',\'| partial |\',\'| missing |\',\'| stale |\',\'orphan\',\'removed package\'])if(!s.includes(x))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e "const fs=require(\'fs\'),p=\'plugins/zeroh-greenfield/fixtures/zeroh-shaped/\',c=JSON.parse(fs.readFileSync(p+\'emitted/repo-catalog.json\')).projects,r=fs.readFileSync(p+\'README.md\',\'utf8\');if(c.length!==6||(r.match(/^\\|[^|]+\\|[^|]+\\|[^|]+\\|$/gm)||[]).length!==4||!c.every(x=>fs.existsSync(p+(x.path||x.root)))||!c.some(x=>!r.includes(x.path||x.root))||!r.includes(\'apps/orphan\')||fs.existsSync(p+\'apps/orphan\'))process.exit(1)"',
        'bash -c "p=plugins/zeroh-greenfield/fixtures/zeroh-shaped; test \"$(find \"$p\" -type f | wc -l)\" -le 25 && test \"$(find \"$p\" -name project.json | wc -l)\" = 6 && test \"$(grep -rlF \'\"registries\"\' \"$p\"/apps/web/components.json \"$p\"/packages/ui/components.json | wc -l)\" = 0 && grep -qF \'nx configuration start\' \"$p\"/CLAUDE.md && grep -qF \'nx configuration end\' \"$p\"/CLAUDE.md && test ! -e \"$p\"/docs/PRD.md && test ! -d \"$p\"/docs/adr && test ! -e \"$p\"/docs/CODE-STYLE.md && test ! -e \"$p\"/docs/architecture.md && test ! -e \"$p\"/docs/ux-canon.md && test ! -e \"$p\"/roadmap.config.json && test ! -e \"$p\"/.superpowers && test ! -e \"$p\"/docs/superpowers && test \"$(grep -RilE \'bladelabs|Blade|@bladelabs\' \"$p\" | wc -l)\" = 0"',
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/fixtures/README.md\',\'utf8\');for(const x of [\'| Artefact | State | Evidence path | Proposed action | Existing home to LINK |\',\'| present |\',\'| partial |\',\'| missing |\',\'| stale |\',\'orphan\',\'removed package\'])if(!s.includes(x))process.exit(1)"',
      ],
      files: [
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/package.json',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/nx.json',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/eslint.config.mjs',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/emitted/repo-catalog.json',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/README.md',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/CLAUDE.md',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/AGENTS.md',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/GEMINI.md',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/apps/web/project.json',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/apps/api/project.json',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/apps/admin/project.json',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/packages/shared/project.json',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/packages/ui/project.json',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/packages/generators/project.json',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/apps/web/components.json',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/packages/ui/components.json',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/docs/architecture/boundaries.md',
        'plugins/zeroh-greenfield/fixtures/zeroh-shaped/docs/architecture/workflow.md',
        'plugins/zeroh-greenfield/fixtures/README.md',
      ],
      testMode: 'none',
      batchMode: true,
      interfaces: { consumes: [], produces: ['fixtures/zeroh-shaped', 'Expected brownfield gap table'] },
      done: false,
    },
  ],
  notes:
    'Interview skipped: this is an arc-member phase and roadmap/arcs/GREENFIELD.arc.ts records the 2026-09-03 interview and locked brownfield rulings. userFacing false: this phase authors model-loaded workflow/reference content and a test fixture, not a consumer product surface, so no flag applies. testMode none on all tasks per skills/using-zeroh-roadmap/references/test-worthiness.md: markdown, JSON/config fixture files, and process contracts are declarative/NEVER classes; their falsifiable step commands and phase-34 dry run are the checks. reviewScope full: this is a new behavior-owning skill seam whose approval ordering and no-second-home rail warrant the full agent chain. Four tasks are below the preferred 5-8 because the supplied scope has exactly four independently reviewable contracts; splitting the mechanical fixture or prose references further would invent boundaries. Phase 29/30/32 paths are planned dependencies and may be absent while parallel planning lanes author them; execution order makes them real before phase 33. Out of scope: plugin packaging and dry-run execution belong to phase 34; templates and checker implementation belong to phases 29/32; stack/design decision text belongs to phase 30. Plan-time zeroh probe observed: emitted catalog has 19 projects; README Workspace Catalog has 14 rows (five missing); docs/architecture has four topic files; CLAUDE.md is 42 lines with a 23-line Nx marker block; AGENTS.md/GEMINI.md repeat guidance; two components.json files have no registries key; PRD/ADR/CODE-STYLE/architecture index/ux-canon/roadmap config/superpowers are absent. Verify rehearsal: all three assumptions exited 0. Every exact step verify exited non-zero because its phase-owned output file/directory is absent; the failure reason is exactly the artifact each step creates. Negative fixture assertions explicitly compare counts to zero. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): strengthened marker/workflow/README/fixture falsifiers; delegated shared harness invariants to phase 32 and retained only brownfield deltas; added orphan, missing-catalog, stale-doc fixture conditions and the four-state oracle.',
})
