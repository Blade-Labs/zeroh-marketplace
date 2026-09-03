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
  arcId: 'GREENFIELD',
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
            'Define exactly one row per required marker, with a non-empty evidence glob and interpretation; absence never proves a stack → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/marker-table.md\',\'utf8\'),n=[\'Package managers\',\'Framework files\',\'Monorepo tools\',\'Docs\',\'Harness files\',\'Roadmap config\',\'Superpowers directory\',\'Design-system files\'],r=s.split(/\\n/).filter(x=>x.startsWith(\'|\')).filter((x,i)=>i&&!/^\\|\\s*-/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim()));if(r.length!==n.length||n.some(x=>r.filter(y=>y[0]===x&&y[1]&&y[2]).length!==1))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
          description:
            'Author the ordered ≤200-line detect-to-done workflow. Keep Detect and Gap table read-only and put the approval sentence in Propose → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md\',\'utf8\'),h=[\'## Detect\',\'## Gap table\',\'## Propose\',\'## Approval\',\'## Act\',\'## Verify\',\'## Done\'],p=h.map(x=>s.indexOf(x));if(p.some((x,i)=>x<0||(i&&x<=p[i-1]))||/\\b(write|create|generate|run `npx|scaffold)\\b/i.test(s.slice(p[0],p[2]))||!s.slice(p[2],p[3]).includes(\'Record approval before any write.\')||s.split(/\\n/).length>200)process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
          description:
            'Add one exact STOP/install branch for each absent sibling plugin → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md\',\'utf8\');for(const x of [\'zeroh-roadmap absent: STOP and offer /plugin install zeroh-roadmap@zeroh-marketplace\',\'zeroh-design absent: STOP and offer /plugin install zeroh-design@zeroh-marketplace\',\'greenfield-init absent: STOP and offer /plugin install zeroh-greenfield@zeroh-marketplace\'])if(!s.includes(x))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/marker-table.md\',\'utf8\'),n=[\'Package managers\',\'Framework files\',\'Monorepo tools\',\'Docs\',\'Harness files\',\'Roadmap config\',\'Superpowers directory\',\'Design-system files\'],r=s.split(/\\n/).filter(x=>x.startsWith(\'|\')).filter((x,i)=>i&&!/^\\|\\s*-/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim()));if(r.length!==8||n.some(x=>r.filter(y=>y[0]===x&&y[1]&&y[2]).length!==1))process.exit(1)"',
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md\',\'utf8\'),h=[\'## Detect\',\'## Gap table\',\'## Propose\',\'## Approval\',\'## Act\',\'## Verify\',\'## Done\'],at=x=>s.indexOf(x);let p=-1;for(const x of h){const n=at(x);if(n<=p)process.exit(1);p=n}if(/\\b(write|create|generate|run `npx|scaffold)\\b/i.test(s.slice(at(h[0]),at(h[2])))||!s.slice(at(h[2]),at(h[3])).includes(\'Record approval before any write.\'))process.exit(1);for(const x of [\'zeroh-roadmap absent: STOP and offer /plugin install zeroh-roadmap@zeroh-marketplace\',\'zeroh-design absent: STOP and offer /plugin install zeroh-design@zeroh-marketplace\',\'greenfield-init absent: STOP and offer /plugin install zeroh-greenfield@zeroh-marketplace\'])if(!s.includes(x))process.exit(1)"',
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
            'Keep this reference brownfield-delta-only: delegate shared invariants, inventory every harness file, show its pre-approval pointer diff, and preserve generated blocks → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/harness-files.md\',\'utf8\');for(const x of [\'greenfield-init/references/standards.md\',\'For every discovered harness file\',\'inventory its unique material\',\'show its exact reduce-to-pointer diff before approval\',\'byte-compare every auto-generated marker block before and after\',\'roadmap/arc-prompts/POLYSEAT-execution-prompt.md\'])if(!s.includes(x))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/harness-files.md\',\'utf8\');for(const x of [\'greenfield-init/references/standards.md\',\'inventory\',\'unique material\',\'reduce-to-pointer diff\',\'before approval\',\'byte-for-byte\',\'auto-generated marker\'])if(!s.includes(x))process.exit(1)"',
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/harness-files.md\',\'utf8\');for(const x of [\'For every discovered harness file\',\'inventory its unique material\',\'show its exact reduce-to-pointer diff before approval\',\'byte-compare every auto-generated marker block before and after\'])if(!s.includes(x))process.exit(1)"',
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
            'Use phase 32’s checker as the only comparator for initial red and final green. Require the exact catalog/root and orphan-approval guard phrases; reject a second comparison algorithm → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/readme-reconcile.md\',\'utf8\'),k=\'templates/scripts/check-readme-catalog.mjs\';for(const x of [k,\'initial red\',\'final green\',\'catalog-entry-plus-existing-root\',\'approval-gated orphan removal\'])if(!s.includes(x))process.exit(1);if(s.split(/\\n/).some(x=>/diff|compare|comparator/i.test(x)&&!x.includes(\'check-readme-catalog\')))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/readme-reconcile.md\',\'utf8\'),k=\'templates/scripts/check-readme-catalog.mjs\';for(const x of [k,\'initial red\',\'final green\',\'catalog-entry-plus-existing-root\',\'approval-gated orphan removal\'])if(!s.includes(x))process.exit(1);if(s.split(/\\n/).some(x=>/diff|compare|comparator/i.test(x)&&!x.includes(\'check-readme-catalog\')))process.exit(1)"',
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
            'Create the capped six-project fixture with four README data rows, catalog omission/orphan, duplicate Conventions guidance, two registry-free components files, stale architecture evidence, absent gap homes, and no copied zeroh prose → verify: bash -c "p=plugins/zeroh-greenfield/fixtures/zeroh-shaped; node -e \"const f=require(\'fs\'),p=process.argv[1],r=f.readFileSync(p+\'/README.md\',\'utf8\').split(/\\n/).filter(x=>x.startsWith(\'|\')).filter((x,i)=>i&&!/^\\|\\s*-/.test(x));if(r.length!==4)process.exit(1)\" \"$p\" && test \"$(find \"$p\" -type f | wc -l)\" -le 25 && test \"$(find \"$p\" -name project.json | wc -l)\" = 6"',
        },
        {
          file: 'plugins/zeroh-greenfield/fixtures/README.md',
          description:
            'Document an exact five-column gap-table oracle with all four states → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/fixtures/README.md\',\'utf8\'),t=s.split(/\\n/).filter(x=>x.startsWith(\'|\')),r=t.filter((x,i)=>i&&!/^\\|\\s*-/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim()));if(t[0]!==\'| Artefact | State | Evidence path | Proposed action | Existing home to LINK |\'||r.some(x=>x.length!==5)||[\'present\',\'partial\',\'missing\',\'stale\'].some(x=>!r.some(y=>y[1]===x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/fixtures/README.md',
          description:
            'Map every fixture condition to an oracle data row → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/fixtures/README.md\',\'utf8\'),r=s.split(/\\n/).filter(x=>x.startsWith(\'|\')).filter((x,i)=>i&&!/^\\|\\s*-/.test(x)),n=[\'six existing project roots\',\'four README data rows\',\'orphan README row\',\'catalog project omitted from README\',\'duplicate harness guidance\',\'components registries absent\',\'removed-package architecture reference\',\'gap homes absent\',\'zeroh prose absent\'];if(n.some(x=>!r.some(y=>y.includes(x))))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e "const f=require(\'fs\'),p=\'plugins/zeroh-greenfield/fixtures/zeroh-shaped/\',c=JSON.parse(f.readFileSync(p+\'emitted/repo-catalog.json\')).projects,r=f.readFileSync(p+\'README.md\',\'utf8\'),rows=r.split(/\\n/).filter(x=>x.startsWith(\'|\')).filter((x,i)=>i&&!/^\\|\\s*-/.test(x));if(c.length!==6||rows.length!==4||!c.every(x=>f.existsSync(p+(x.path||x.root)))||!c.some(x=>!r.includes(x.path||x.root))||!r.includes(\'apps/orphan\')||f.existsSync(p+\'apps/orphan\'))process.exit(1)"',
        'bash -c "p=plugins/zeroh-greenfield/fixtures/zeroh-shaped; test \"$(find \"$p\" -type f | wc -l)\" -le 25 && test \"$(find \"$p\" -name project.json | wc -l)\" = 6 && test \"$(grep -rlF \'\"registries\"\' \"$p\"/apps/web/components.json \"$p\"/packages/ui/components.json | wc -l)\" = 0 && grep -qF \'nx configuration start\' \"$p\"/CLAUDE.md && grep -qF \'nx configuration end\' \"$p\"/CLAUDE.md && test ! -e \"$p\"/docs/PRD.md && test ! -d \"$p\"/docs/adr && test ! -e \"$p\"/docs/CODE-STYLE.md && test ! -e \"$p\"/docs/architecture.md && test ! -e \"$p\"/docs/ux-canon.md && test ! -e \"$p\"/roadmap.config.json && test ! -e \"$p\"/.superpowers && test ! -e \"$p\"/docs/superpowers && test \"$(grep -RilE \'bladelabs|Blade|@bladelabs\' \"$p\" | wc -l)\" = 0"',
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/fixtures/README.md\',\'utf8\'),t=s.split(/\\n/).filter(x=>x.startsWith(\'|\')),r=t.filter((x,i)=>i&&!/^\\|\\s*-/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())),n=[\'six existing project roots\',\'four README data rows\',\'orphan README row\',\'catalog project omitted from README\',\'duplicate harness guidance\',\'components registries absent\',\'removed-package architecture reference\',\'gap homes absent\',\'zeroh prose absent\'];if(t[0]!==\'| Artefact | State | Evidence path | Proposed action | Existing home to LINK |\'||r.some(x=>x.length!==5)||[\'present\',\'partial\',\'missing\',\'stale\'].some(x=>!r.some(y=>y[1]===x))||n.some(x=>!r.some(y=>y.includes(x))))process.exit(1)"',
        'bash -c "p=plugins/zeroh-greenfield/fixtures/zeroh-shaped; test \"$(grep -cF \'## Conventions\' \"$p\"/AGENTS.md)\" = 1 && test \"$(grep -cF \'## Conventions\' \"$p\"/GEMINI.md)\" = 1 && cmp <(sed -n \'/## Conventions/,$p\' \"$p\"/AGENTS.md) <(sed -n \'/## Conventions/,$p\' \"$p\"/GEMINI.md)"',
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
    'Interview skipped: this is an arc-member phase and roadmap/arcs/GREENFIELD.arc.ts records the 2026-09-03 interview and locked brownfield rulings. userFacing false: this phase authors model-loaded workflow/reference content and a test fixture, not a consumer product surface, so no flag applies. testMode none on all tasks per skills/using-zeroh-roadmap/references/test-worthiness.md: markdown, JSON/config fixture files, and process contracts are declarative/NEVER classes; their falsifiable step commands and phase-34 dry run are the checks. reviewScope full: this is a new behavior-owning skill seam whose approval ordering and no-second-home rail warrant the full agent chain. Four tasks are below the preferred 5-8 because the supplied scope has exactly four independently reviewable contracts; splitting the mechanical fixture or prose references further would invent boundaries. Phase 29/30/32 paths are planned dependencies and may be absent while parallel planning lanes author them; execution order makes them real before phase 33. Out of scope: plugin packaging and dry-run execution belong to phase 34; templates and checker implementation belong to phases 29/32; stack/design decision text belongs to phase 30. Plan-time zeroh probe observed: emitted catalog has 19 projects; README Workspace Catalog has 14 rows (five missing); docs/architecture has four topic files; CLAUDE.md is 42 lines with a 23-line Nx marker block; AGENTS.md/GEMINI.md repeat guidance; two components.json files have no registries key; PRD/ADR/CODE-STYLE/architecture index/ux-canon/roadmap config/superpowers are absent. Verify rehearsal: all three assumptions exited 0. Every exact step verify exited non-zero because its phase-owned output file/directory is absent; the failure reason is exactly the artifact each step creates. Negative fixture assertions explicitly compare counts to zero. Fixture row-parser rehearsal: a correct four-data-row Markdown table exited 0; its three-data-row mutation exited 1. Verify-clause bar ruled by the GREENFIELD orchestrator 2026-09-03: step verifies on prose skills prove STRUCTURE (sections, order, rows, forbidden verbs, required phrases); BEHAVIOUR (approval gating, no-second-home, idempotence) is proved by phase 34.4\'s dry runs and validate-arc\'s standards-first criterion, never by a grep. A reviewer finding that a prose verify \'does not prove the mechanism\' is answered by this line, not by another grep. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): fixed fixture row counting; structurally enforced marker rows and cells; enforced workflow order, read-only detection, approval and sibling STOP branches; made the phase-32 checker the sole README comparator with addition/orphan guards; covered every fixture condition and oracle mapping.',
})
