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
            'Define detection rows for package-manager locks, framework files, monorepo tools, existing docs, harness files, roadmap config, `.superpowers/` or `docs/superpowers`, and design-system files; each row names evidence globs and the present/partial/missing/stale interpretation without treating absence as proof of a stack → verify: bash -c "grep -qF \'| Marker | Evidence | Interpretation |\' plugins/zeroh-greenfield/skills/brownfield-audit/references/marker-table.md && grep -qF \'docs/superpowers\' plugins/zeroh-greenfield/skills/brownfield-audit/references/marker-table.md && grep -qF \'components.json\' plugins/zeroh-greenfield/skills/brownfield-audit/references/marker-table.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
          description:
            'Author the ≤200-line detect → gap table → propose → approval → act → verify workflow. Fix the five columns and total state vocabulary; existing homes get index/link, missing ADRs call stack-decision, approval lands in the PRD Decisions section or tech-stack ADR Context, and missing approval/tools STOP. Cite sibling references and declare both-way boundaries → verify: bash -c "grep -qF \'## Detect\' plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md && grep -qF \'Artefact | State | Evidence path | Proposed action | Existing home to LINK\' plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md && test \"$(wc -l < plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md)\" -le 200"',
        },
      ],
      acceptanceCriteria: [
        'The skill names all five gap-table columns, all four normal states plus `observed: <result>`, and an existing-home row can prescribe only an index/link rather than a replacement document.',
        'Before the approval heading, `SKILL.md` permits no write or generator action; missing approval and absent zeroh-roadmap/zeroh-design each have a literal STOP response and install guidance.',
        'The workflow satisfies SKILL-AUTHORING-STANDARD R11, R13, R17, and R23: ordered headings, named exits, two-way sibling boundaries, and an artifact-defined completion verdict.',
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
            'Define reconciliation: AGENTS.md owns shared conventions; CLAUDE.md keeps `@AGENTS.md`, harness-only lines, and generated-marker bytes; every other named harness home becomes a pointer while retaining unique material. Require the exact diff before approval, cite the POLYSEAT prompt for no-Claude-privilege, and apply documentation rules → verify: bash -c "grep -qF \'nx configuration start\' plugins/zeroh-greenfield/skills/brownfield-audit/references/harness-files.md && grep -qF \'roadmap/arc-prompts/POLYSEAT-execution-prompt.md\' plugins/zeroh-greenfield/skills/brownfield-audit/references/harness-files.md"',
        },
      ],
      acceptanceCriteria: [
        'The reference assigns shared conventions only to AGENTS.md and gives every named harness surface a pointer/import treatment, with harness-specific lines preserved rather than discarded.',
        'The Nx start/end block is specified as byte-preserved, and the executor must show the proposed harness diff before recording approval or changing a file.',
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
            'Discover the catalog source and run phase 32’s checker against README.md. On red, propose rows only where catalog entries and project roots exist; show them before approval, rerun to green, and report orphan rows without inventing or silently deleting them. Apply documentation rules → verify: grep -qF \'templates/scripts/check-readme-catalog.mjs\' plugins/zeroh-greenfield/skills/brownfield-audit/references/readme-reconcile.md',
        },
      ],
      acceptanceCriteria: [
        'The reference uses phase 32’s one checker for both the initial red and final green and never describes a second catalog comparison algorithm.',
        'Every proposed README row is backed by both a catalog entry and an existing project root; stale README-only rows receive an explicit observed verdict.',
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
            'Create the ≤25-file fixture: package workspaces, Nx config, dependency constraints, six generic app/package project files, a six-project emitted catalog, four-row README catalog, two architecture topics, duplicate harness guidance around an Nx block, and two components files without registries. Omit the named gap homes and all Blade/zeroh content → verify: bash -c "test -f plugins/zeroh-greenfield/fixtures/zeroh-shaped/nx.json && test -f plugins/zeroh-greenfield/fixtures/zeroh-shaped/emitted/repo-catalog.json && test \"$(find plugins/zeroh-greenfield/fixtures/zeroh-shaped -type f | wc -l)\" -le 25 && test \"$(find plugins/zeroh-greenfield/fixtures/zeroh-shaped -name project.json | wc -l)\" = 6"',
        },
        {
          file: 'plugins/zeroh-greenfield/fixtures/README.md',
          description:
            'Document each synthetic gap and the exact oracle: present boundaries/catalog; partial README/harness/architecture/design-system; missing PRD/ADR/CODE-STYLE/ux-canon/roadmap config/superpowers, each with evidence and action. Mark content synthetic and apply documentation rules → verify: bash -c "grep -qF \'| Artefact | State | Evidence path | Proposed action | Existing home to LINK |\' plugins/zeroh-greenfield/fixtures/README.md && grep -qF \'| PRD | missing |\' plugins/zeroh-greenfield/fixtures/README.md"',
        },
      ],
      acceptanceCriteria: [
        'The fixture contains at most 25 files, exactly six project.json files, a six-project emitted catalog, and exactly four corresponding README catalog rows; every catalog project root exists.',
        'Both components.json files omit `registries`; CLAUDE.md contains a paired Nx-generated marker block; no PRD, ADR, CODE-STYLE, architecture index, ux-canon, roadmap config, superpowers directory, Blade name, or copied zeroh prose exists.',
        'fixtures/README.md carries the complete expected gap table with evidence paths and actions, including the present, partial, and missing rows phase 34 must reproduce.',
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
    'Interview skipped: this is an arc-member phase and roadmap/arcs/GREENFIELD.arc.ts records the 2026-09-03 interview and locked brownfield rulings. userFacing false: this phase authors model-loaded workflow/reference content and a test fixture, not a consumer product surface, so no flag applies. testMode none on all tasks per skills/using-zeroh-roadmap/references/test-worthiness.md: markdown, JSON/config fixture files, and process contracts are declarative/NEVER classes; their falsifiable step commands and phase-34 dry run are the checks. reviewScope full: this is a new behavior-owning skill seam whose approval ordering and no-second-home rail warrant the full agent chain. Four tasks are below the preferred 5-8 because the supplied scope has exactly four independently reviewable contracts; splitting the mechanical fixture or prose references further would invent boundaries. Phase 29/30/32 paths are planned dependencies and may be absent while parallel planning lanes author them; execution order makes them real before phase 33. Out of scope: plugin packaging and dry-run execution belong to phase 34; templates and checker implementation belong to phases 29/32; stack/design decision text belongs to phase 30. Plan-time zeroh probe observed: emitted catalog has 19 projects; README Workspace Catalog has 14 rows (five missing); docs/architecture has four topic files; CLAUDE.md is 42 lines with a 23-line Nx marker block; AGENTS.md/GEMINI.md repeat guidance; two components.json files have no registries key; PRD/ADR/CODE-STYLE/architecture index/ux-canon/roadmap config/superpowers are absent. Verify rehearsal: all three assumptions exited 0. Every exact step verify exited non-zero because its phase-owned output file/directory is absent; the failure reason is exactly the artifact each step creates. No negative post-diff grep is used.',
})
