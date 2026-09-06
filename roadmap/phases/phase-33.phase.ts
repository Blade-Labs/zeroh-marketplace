import { definePhase } from '@/lib/roadmap/schema'

/**
 * Review amendment: marker categories are detection inputs, not artifact-gap cardinality.
 * Expand required document homes independently; only Blade requires zeroh-design.
 * Canonical roadmap discovery covers docs/roadmap, overrides, and ambiguity.
 * Final repaired behavior is re-proven by phase 34; historical gates are retained.
 * GREENFIELD brownfield plane — audit an established repository, propose only its gaps,
 * reconcile duplicated instruction/catalog surfaces, and leave a compact oracle fixture for
 * the keystone dry run. Design: roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design item 6.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 33,
  name: 'Brownfield gap audit, harness and README reconciliation, and zeroh-shaped oracle fixture',
  status: 'done',
  completedDate: '2026-09-04',
  gate: {
    lint: 'clean', typeCheck: 'clean',
    unitTests: { passed: 1834, total: 1834, notes: 'Post-R2 authoritative gate run-000001 was GREEN; the capped unit suite completed in 1,865,100 ms.' },
    integrationTests: { passed: 0, total: 0, notes: 'declared-none; phase 34 owns executable brownfield dry runs.' },
    e2eTests: { passed: 0, total: 0, notes: 'declared-none; no rendered surface.' },
    build: 'clean',
  },
  gateRounds: [
    { round: 0, agent: 'quality-pass', model: 'gpt-5.6-sol', verdict: 'clean', findings: [], summary: 'Quality pass removed an assertion-oriented fixture comment and found no correctness defects.' },
    { round: 1, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'findings-fixed', summary: 'Independent review found malformed checker input, an unsupported catalog key, and incorrect oracle cardinality; R1 repaired all three.', findings: [
      { file: 'plugins/zeroh-greenfield/fixtures/zeroh-shaped/README.md', severity: 'HIGH', confidence: 99, description: 'Fixture README lacked checker markers and the three-column shape.', fixedInCommit: '52f0629' },
      { file: 'plugins/zeroh-greenfield/fixtures/zeroh-shaped/emitted/repo-catalog.json', severity: 'HIGH', confidence: 99, description: 'Catalog used unsupported path keys rather than root.', fixedInCommit: '52f0629' },
      { file: 'plugins/zeroh-greenfield/fixtures/README.md', severity: 'HIGH', confidence: 97, description: 'Oracle had four summary rows rather than one row per eight markers.', fixedInCommit: '52f0629' },
    ] },
    { round: 2, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'findings-fixed', summary: 'Follow-up review found incorrect classifications, non-path evidence, and a present-row action; R2 repaired semantics and the malformed whole-cell verifier.', findings: [
      { file: 'plugins/zeroh-greenfield/fixtures/README.md', severity: 'HIGH', confidence: 98, description: 'Several oracle states contradicted the marker evidence.', fixedInCommit: '0f2a626' },
      { file: 'plugins/zeroh-greenfield/fixtures/README.md', severity: 'HIGH', confidence: 97, description: 'Evidence cells contained summaries rather than concrete paths.', fixedInCommit: '0f2a626' },
      { file: 'plugins/zeroh-greenfield/fixtures/README.md', severity: 'HIGH', confidence: 99, description: 'A present row carried a proposed action.', fixedInCommit: '0f2a626' },
    ] },
    { round: 3, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'clean', findings: [], summary: 'Independent final review verified the repaired classifications, paths, gap-only actions, checker behavior, and nested-cell verifier.' },
  ],
  metrics: { commits: 8, linesAdded: 163, linesRemoved: 24, filesChanged: 24, testsAtStart: 1834, testsAtEnd: 1834, testsAdded: 0, startedAt: '2026-09-04T20:22:00.000Z', completedAt: '2026-09-04T21:05:29.000Z' },
  compromises: 'Curation was skipped because 25 foreign phase and arc commits interleave the phase range; the CLI correctly refused to rewrite them.',
  executionResult: {
    phase: 33, status: 'done', driver: { model: 'gpt-5.6-sol', lane: 'codex' },
    modelPolicy: { source: 'config', preset: 'codex' },
    roles: [
      { role: 'quality-pass', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
    ],
    compromises: ['Curation refused 25 interleaved foreign commits, so audited phase commits remain unsquashed.', 'Corrected a mechanically impossible whole-cell condition verifier to search substrings within parsed cells; provenance-only text remains covered by its dedicated fixture assertion.'],
    skipped: [], hardcoded: ['Deterministic fixture-only project names and paths.'],
    surfaced: ['The sole catalog checker now reaches intended missing/orphan diagnostics.', 'The oracle has exactly eight semantically classified marker rows with concrete evidence paths.', 'Independent review required two repair rounds before CLEAN.'],
    hardStops: [], gateRounds: 4,
  },
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
            'Make Propose gap-only, make Act link existing homes, and call the three declared owners by exact id without destructive Act language → verify: bash -c "f=plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md; node -e \"const s=require(\'fs\').readFileSync(process.argv[1],\'utf8\'),p=s.slice(s.indexOf(\'## Propose\'),s.indexOf(\'## Approval\')),a=s.slice(s.indexOf(\'## Act\'),s.indexOf(\'## Verify\'));for(const x of [\'Proposals are emitted ONLY for gap-table rows in state missing / partial / stale.\',\'A \\`present\\` row yields NO proposal.\'])if(!p.includes(x))process.exit(1);if(!a.includes(\'An existing home is LINKED from the index/canon, never replaced.\')||/rewrite|replace the existing|overwrite/i.test(a))process.exit(1)\" \"$f\" && grep -qF \'zeroh-greenfield:stack-decision\' \"$f\" && grep -qF \'skills/greenfield-init/references/standards.md\' \"$f\" && grep -qF \'skills/greenfield-init/references/pointers.md\' \"$f\""',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
          description:
            'Add a STOP/install branch for each required absent sibling; zeroh-design is required only by an approved Blade handoff, never by non-Blade gap repair → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md\',\'utf8\');for(const x of [\'zeroh-roadmap absent: STOP and offer /plugin install zeroh-roadmap@zeroh-marketplace\',\'zeroh-design absent: STOP and offer /plugin install zeroh-design@zeroh-marketplace\',\'greenfield-init absent: STOP and offer /plugin install zeroh-greenfield@zeroh-marketplace\'])if(!s.includes(x))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/references/marker-table.md\',\'utf8\'),n=[\'Package managers\',\'Framework files\',\'Monorepo tools\',\'Docs\',\'Harness files\',\'Roadmap config\',\'Superpowers directory\',\'Design-system files\'],r=s.split(/\\n/).filter(x=>x.startsWith(\'|\')).filter((x,i)=>i&&!/^\\|\\s*-/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim()));if(r.length!==8||n.some(x=>r.filter(y=>y[0]===x&&y[1]&&y[2]).length!==1))process.exit(1)"',
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md\',\'utf8\'),h=[\'## Detect\',\'## Gap table\',\'## Propose\',\'## Approval\',\'## Act\',\'## Verify\',\'## Done\'],at=x=>s.indexOf(x);let p=-1;for(const x of h){const n=at(x);if(n<=p)process.exit(1);p=n}if(/\\b(write|create|generate|run `npx|scaffold)\\b/i.test(s.slice(at(h[0]),at(h[2])))||!s.slice(at(h[2]),at(h[3])).includes(\'Record approval before any write.\'))process.exit(1);for(const x of [\'zeroh-roadmap absent: STOP and offer /plugin install zeroh-roadmap@zeroh-marketplace\',\'zeroh-design absent: STOP and offer /plugin install zeroh-design@zeroh-marketplace\',\'greenfield-init absent: STOP and offer /plugin install zeroh-greenfield@zeroh-marketplace\'])if(!s.includes(x))process.exit(1)"',
        'bash -c "f=plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md; node -e \"const s=require(\'fs\').readFileSync(process.argv[1],\'utf8\'),p=s.slice(s.indexOf(\'## Propose\'),s.indexOf(\'## Approval\')),a=s.slice(s.indexOf(\'## Act\'),s.indexOf(\'## Verify\'));for(const x of [\'Proposals are emitted ONLY for gap-table rows in state missing / partial / stale.\',\'A \\`present\\` row yields NO proposal.\'])if(!p.includes(x))process.exit(1);if(!a.includes(\'An existing home is LINKED from the index/canon, never replaced.\')||/rewrite|replace the existing|overwrite/i.test(a))process.exit(1)\" \"$f\" && grep -qF \'zeroh-greenfield:stack-decision\' \"$f\" && grep -qF \'skills/greenfield-init/references/standards.md\' \"$f\" && grep -qF \'skills/greenfield-init/references/pointers.md\' \"$f\""',
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
      done: true,
      transparencyReport: {
        whatWasDone: 'Authored the ordered brownfield audit workflow and its total eight-row marker contract.',
        how: 'The workflow separates read-only detection from gap-only proposals, records approval before any write, links existing homes, names sibling-plugin STOP branches, and requires a final evidence artifact. The marker reference gives every required artefact a non-empty evidence glob and interpretation. Structural acceptance checks and phase validation passed.',
        compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'Behavioral dry-run proof is intentionally owned by phase 34.4.',
      },
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
      done: true,
      transparencyReport: {
        whatWasDone: 'Authored the brownfield-only harness reconciliation contract.',
        how: 'The reference delegates shared invariants, inventories every common harness surface, requires exact pre-approval pointer diffs, preserves unique guidance, and byte-compares generated marker blocks including Nx regions. Both structural acceptance checks passed.',
        compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'Actual repository diffs remain approval-gated runtime work.',
      },
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
      done: true,
      transparencyReport: {
        whatWasDone: 'Authored the README catalog reconciliation contract.',
        how: 'The reference reuses phase 32’s checker for both initial red and final green, gates additions on catalog-entry-plus-existing-root, and makes orphan removal approval-gated. Its sole-comparator acceptance check passed.',
        compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'The reference delegates all catalog comparison behavior to the shipped checker.',
      },
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
            'Create the capped six-project fixture with four README rows, catalog omission/orphan, duplicate Conventions, registry-free components, and an architecture reference to nonexistent packages/legacy-widgets → verify: bash -c "p=plugins/zeroh-greenfield/fixtures/zeroh-shaped; node -e \"const f=require(\'fs\'),p=process.argv[1],r=f.readFileSync(p+\'/README.md\',\'utf8\').split(/\\n/).filter(x=>x.startsWith(\'|\')).filter((x,i)=>i&&!/^\\|\\s*-/.test(x));if(r.length!==4)process.exit(1)\" \"$p\" && test \"$(find \"$p\" -type f | wc -l)\" -le 25 && test \"$(find \"$p\" -name project.json | wc -l)\" = 6 && test ! -d \"$p/packages/legacy-widgets\" && grep -qF \'packages/legacy-widgets\' \"$p\"/docs/architecture/*.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/fixtures/README.md',
          description:
            'Document an exact five-column gap-table oracle with all four states → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/fixtures/README.md\',\'utf8\'),t=s.split(/\\n/).filter(x=>x.startsWith(\'|\')),r=t.filter((x,i)=>i&&!/^\\|\\s*-/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim()));if(t[0]!==\'| Artefact | State | Evidence path | Proposed action | Existing home to LINK |\'||r.some(x=>x.length!==5)||[\'present\',\'partial\',\'missing\',\'stale\'].some(x=>!r.some(y=>y[1]===x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/fixtures/README.md',
          description:
            'Map every fixture condition to an oracle data row → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/fixtures/README.md\',\'utf8\'),r=s.split(/\\n/).filter(x=>x.startsWith(\'|\')).filter((x,i)=>i&&!/^\\|\\s*-/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())),n=[\'six existing project roots\',\'four README data rows\',\'orphan README row\',\'catalog project omitted from README\',\'duplicate harness guidance\',\'components registries absent\',\'removed-package architecture reference\',\'gap homes absent\'];if(n.some(x=>!r.some(y=>y.some(z=>z.includes(x)))))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e "const f=require(\'fs\'),p=\'plugins/zeroh-greenfield/fixtures/zeroh-shaped/\',c=JSON.parse(f.readFileSync(p+\'emitted/repo-catalog.json\')).projects,r=f.readFileSync(p+\'README.md\',\'utf8\'),rows=r.split(/\\n/).filter(x=>x.startsWith(\'|\')).filter((x,i)=>i&&!/^\\|\\s*-/.test(x));if(c.length!==6||rows.length!==4||!c.every(x=>f.existsSync(p+(x.path||x.root)))||!c.some(x=>!r.includes(x.path||x.root))||!r.includes(\'apps/orphan\')||f.existsSync(p+\'apps/orphan\'))process.exit(1)"',
        'bash -c "p=plugins/zeroh-greenfield/fixtures/zeroh-shaped; test \"$(find \"$p\" -type f | wc -l)\" -le 25 && test \"$(find \"$p\" -name project.json | wc -l)\" = 6 && test \"$(grep -rlF \'\"registries\"\' \"$p\"/apps/web/components.json \"$p\"/packages/ui/components.json | wc -l)\" = 0 && grep -qF \'nx configuration start\' \"$p\"/CLAUDE.md && grep -qF \'nx configuration end\' \"$p\"/CLAUDE.md && test ! -e \"$p\"/docs/PRD.md && test ! -d \"$p\"/docs/adr && test ! -e \"$p\"/docs/CODE-STYLE.md && test ! -e \"$p\"/docs/architecture.md && test ! -e \"$p\"/docs/ux-canon.md && test ! -e \"$p\"/roadmap.config.json && test ! -e \"$p\"/.superpowers && test ! -e \"$p\"/docs/superpowers && test \"$(grep -RilE \'bladelabs|Blade|@bladelabs\' \"$p\" | wc -l)\" = 0"',
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/fixtures/README.md\',\'utf8\'),t=s.split(/\\n/).filter(x=>x.startsWith(\'|\')),r=t.filter((x,i)=>i&&!/^\\|\\s*-/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())),n=[\'six existing project roots\',\'four README data rows\',\'orphan README row\',\'catalog project omitted from README\',\'duplicate harness guidance\',\'components registries absent\',\'removed-package architecture reference\',\'gap homes absent\'];if(t[0]!==\'| Artefact | State | Evidence path | Proposed action | Existing home to LINK |\'||r.some(x=>x.length!==5)||[\'present\',\'partial\',\'missing\',\'stale\'].some(x=>!r.some(y=>y[1]===x))||n.some(x=>!r.some(y=>y.some(z=>z.includes(x)))))process.exit(1)"',
        'bash -c "p=plugins/zeroh-greenfield/fixtures/zeroh-shaped; test \"$(grep -cF \'## Conventions\' \"$p\"/AGENTS.md)\" = 1 && test \"$(grep -cF \'## Conventions\' \"$p\"/GEMINI.md)\" = 1 && cmp <(sed -n \'/## Conventions/,$p\' \"$p\"/AGENTS.md) <(sed -n \'/## Conventions/,$p\' \"$p\"/GEMINI.md) && test ! -d \"$p/packages/legacy-widgets\" && grep -qF \'packages/legacy-widgets\' \"$p\"/docs/architecture/*.md && node -e \"const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/fixtures/README.md\',\'utf8\'),r=s.split(/\\n/).filter(x=>x.startsWith(\'|\')).filter((x,i)=>i&&!/^\\|\\s*-/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim()));if(!r.some(x=>x[1]===\'stale\'&&x.some(y=>y.includes(\'packages/legacy-widgets\'))))process.exit(1)\""',
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
      done: true,
      transparencyReport: {
        whatWasDone: 'Created the capped zeroh-shaped brownfield fixture and five-column expected gap-table oracle.',
        how: 'The fixture has six real project roots, a checker-compatible four-row README with both omissions and an orphan, duplicated harness conventions with a generated Nx block, registry-free component configs, absent gap homes, and a stale reference to a nonexistent package. The eight-row oracle maps exactly one row per marker and covers present, partial, missing, and stale states. All four acceptance commands passed. Independent review caught and drove repairs for the README markers/shape, catalog root key, oracle cardinality, evidence paths, classifications, and gap-only actions; the real checker now reaches the intended missing/orphan red rather than a malformed-input error. The condition-map verifier was corrected from exact whole-cell equality to substring search within parsed cells, and the provenance-only zeroh-prose condition remains covered by its dedicated fixture grep rather than masquerading as a gap row.',
        compromises: 'None', skipped: 'None', hardcoded: 'Fixture-only deterministic names and paths are intentional oracle data.', limitations: 'The fixture models structure only and deliberately contains no application sources.',
      },
    },
  ],
  reviewRecord: { date: '2026-09-04', model: 'gpt-5.6-sol', verdict: 'READY', via: 'executed' },
  notes:
    'Interview skipped: this is an arc-member phase and roadmap/arcs/GREENFIELD.arc.ts records the 2026-09-03 interview and locked brownfield rulings. userFacing false: this phase authors model-loaded workflow/reference content and a test fixture, not a consumer product surface, so no flag applies. testMode none on all tasks per skills/using-zeroh-roadmap/references/test-worthiness.md: markdown, JSON/config fixture files, and process contracts are declarative/NEVER classes; their falsifiable step commands and phase-34 dry run are the checks. reviewScope full: this is a new behavior-owning skill seam whose approval ordering and no-second-home rail warrant the full agent chain. Four tasks are below the preferred 5-8 because the supplied scope has exactly four independently reviewable contracts; splitting the mechanical fixture or prose references further would invent boundaries. Phase 29/30/32 paths are planned dependencies and may be absent while parallel planning lanes author them; execution order makes them real before phase 33. Out of scope: plugin packaging and dry-run execution belong to phase 34; templates and checker implementation belong to phases 29/32; stack/design decision text belongs to phase 30. Plan-time zeroh probe observed: emitted catalog has 19 projects; README Workspace Catalog has 14 rows (five missing); docs/architecture has four topic files; CLAUDE.md is 42 lines with a 23-line Nx marker block; AGENTS.md/GEMINI.md repeat guidance; two components.json files have no registries key; PRD/ADR/CODE-STYLE/architecture index/ux-canon/roadmap config/superpowers are absent. Verify rehearsal: all three assumptions exited 0. Every exact step verify exited non-zero because its phase-owned output file/directory is absent; the failure reason is exactly the artifact each step creates. Negative fixture assertions explicitly compare counts to zero. Fixture row-parser rehearsal: a correct four-data-row Markdown table exited 0; its three-data-row mutation exited 1. Verify-clause bar ruled by the GREENFIELD orchestrator 2026-09-03: step verifies on prose skills prove STRUCTURE (sections, order, rows, forbidden verbs, required phrases); BEHAVIOUR (approval gating, no-second-home, idempotence) is proved by phase 34.4\'s dry runs and validate-arc\'s standards-first criterion, never by a grep. A reviewer finding that a prose verify \'does not prove the mechanism\' is answered by this line, not by another grep. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): fixed fixture row counting; structurally enforced marker rows and cells; enforced workflow order, read-only detection, approval and sibling STOP branches; made the phase-32 checker the sole README comparator with addition/orphan guards; covered every fixture condition and oracle mapping; enforced gap-only proposals, link-not-replace Act behavior, exact owner calls, and a nonexistent removed-package architecture target tied to the stale oracle row. Review repairs round 3 2026-09-03 (orchestrator): scratch-copy 33.1 structural clause RED 1 / GREEN 0; scratch-copy 33.4 stale-package clause RED 1 / GREEN 0.',
})
