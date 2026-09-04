import { definePhase } from '@/lib/roadmap/schema'

/**
 * Establish the skills-and-templates foundation for zeroh-greenfield.
 *
 * timing: band 1-3 × surface:false, N=2, median 219.3 min, p80 221.5 min
 */
export default definePhase({
  phase: 29,
  name: 'zeroh-greenfield skeleton, initialization interview, and consumer templates',
  plannedBy: { model: 'gpt-5.6-sol' },
  status: 'in-progress',
  category: 'feature',
  kind: 'logic',
  source:
    'GREENFIELD arc member; roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design is the designRef and roadmap/arcs/GREENFIELD.arc.ts carries the locked decisions and promise ledger.',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [],
  arcId: 'GREENFIELD',
  userFacing: false,
  reviewScope: 'full',
  keyFiles: [
    'plugins/zeroh-greenfield/.claude-plugin/plugin.json',
    'plugins/zeroh-greenfield/README.md',
    'plugins/zeroh-greenfield/LICENSE.txt',
    'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/prd-interview.md',
    'plugins/zeroh-greenfield/templates/',
  ],
  stakeholderDemo:
    'The zeroh-greenfield plugin can interview for a PRD, stop for approval before setup, route stack and design decisions to their owners, and drop a complete standards-ready document skeleton into a consumer.',
  assumptions: [
    {
      claim: 'The zeroh-greenfield plugin tree does not exist, so this phase creates rather than migrates it.',
      verify: 'test ! -e plugins/zeroh-greenfield',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'zeroh-design provides the skills-only manifest and Apache-2.0 license precedents this phase mirrors.',
      verify:
        "node -e \"const fs=require('fs'); const p=JSON.parse(fs.readFileSync('plugins/zeroh-design/.claude-plugin/plugin.json','utf8')); if(p.category!=='design'||p.author?.name!=='Blade Labs'||!fs.readFileSync('plugins/zeroh-design/LICENSE.txt','utf8').includes('Apache License')) process.exit(1)\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The GREENFIELD design fixes four skills and makes using-zeroh-greenfield the single trigger router.',
      verify:
        "bash -c \"grep -qF 'four skills (router, greenfield-init, brownfield-audit, stack-decision)' roadmap/arcs/GREENFIELD.arc.ts && grep -qF 'One router: skills/using-zeroh-greenfield/SKILL.md is the only dispatch table' roadmap/arcs/GREENFIELD.arc.ts\"",
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '29.1',
      title: 'Create the skills-only plugin skeleton and its single dispatch router',
      problem:
        'The reserved zeroh-greenfield plugin has no directory, manifest, license, README, or activation seam. The arc requires one router to distinguish new-repo setup from brownfield gap filling and to assign the roadmap-planning and design-token boundaries to their sibling plugins.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/.claude-plugin/plugin.json',
          description:
            'Create the manifest with name, development category, setup description, and Blade Labs author; add no package/scripts/hooks/agents/JS/TS → verify: node -e "const f=require(\'fs\'),p=JSON.parse(f.readFileSync(\'plugins/zeroh-greenfield/.claude-plugin/plugin.json\')),r=\'plugins/zeroh-greenfield\',b=[\'package.json\',\'scripts\',\'hooks\',\'agents\'].some(x=>f.existsSync(r+\'/\'+x))||[\'scripts\',\'hooks\',\'agents\'].some(x=>x in p)||f.readdirSync(r,{recursive:true}).some(x=>/\\.[cm]?[jt]s$/.test(x));process.exit(p.name===\'zeroh-greenfield\'&&p.category===\'development\'&&p.description&&p.author?.name===\'Blade Labs\'&&!b?0:1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
          description:
            'Author the sole dispatch table with three exact rows and both sibling boundaries → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md\',\'utf8\'),x=[\'init / new repo / scaffold | greenfield-init\',\'audit / fill gaps / brownfield | brownfield-audit\',\'stack choice / mobile stack | stack-decision\',\'zeroh-roadmap plans and runs phases\',\'zeroh-design owns Blade tokens and themes\'];if(x.some(v=>!s.includes(v)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
          description:
            'Add every greenfield/brownfield detection-marker row → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md\',\'utf8\'),x=[\'Marker | Greenfield | Brownfield\',\'package-manager locks\',\'framework files\',\'existing docs\',\'harness files\',\'roadmap config\'];if(x.some(v=>!s.includes(v)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/README.md',
          description:
            'Document purpose, all four skills, `/plugin install zeroh-greenfield@zeroh-marketplace`, and link the GREENFIELD execution prompt; apply `plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/documentation-rules.md` [FIXED: anchor was missing the plugins/zeroh-roadmap/ prefix and did not resolve] → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/README.md\',\'utf8\');for(const x of [\'/plugin install zeroh-greenfield@zeroh-marketplace\',\'using-zeroh-greenfield\',\'greenfield-init\',\'brownfield-audit\',\'stack-decision\',\'roadmap/arc-prompts/GREENFIELD-execution-prompt.md\'])if(!s.includes(x))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/LICENSE.txt',
          description:
            'Copy the zeroh-design Apache License 2.0 family text into LICENSE.txt without altering its legal terms → verify: cmp -s plugins/zeroh-design/LICENSE.txt plugins/zeroh-greenfield/LICENSE.txt',
        },
      ],
      acceptanceCriteria: [
        'The manifest has name, development category, nonempty setup description, and Blade Labs author; the plugin tree has no package.json, scripts, hooks, agents, JS, or TS.',
        'The sole router contains all three exact trigger-to-skill rows, the Greenfield/Brownfield marker table, and explicit zeroh-roadmap planning/execution and zeroh-design Blade-token boundaries.',
        'README names installation, all four skills, and the execution-prompt design home; LICENSE.txt is byte-identical to plugins/zeroh-design/LICENSE.txt.',
      ],
      files: [
        'plugins/zeroh-greenfield/.claude-plugin/plugin.json',
        'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
        'plugins/zeroh-greenfield/README.md',
        'plugins/zeroh-greenfield/LICENSE.txt',
      ],
      testMode: 'none',
      interfaces: {
        consumes: [],
        produces: ['using-zeroh-greenfield dispatch table', 'zeroh-greenfield plugin manifest'],
      },
      done: true,
      doneDate: '2026-09-04',
      transparencyReport: {
        whatWasDone:
          'Created the skills-only zeroh-greenfield plugin manifest, Apache-2.0 license, concise README, and the single trigger router for initialization, brownfield audits, and stack decisions.',
        how:
          'Mirrored the existing zeroh-design manifest and license conventions, retained the fuller package metadata needed by the planned Codex manifest, and made the router choose brownfield behavior whenever any repository marker exists. All five task checks passed, and the phase types slot was declared-none and green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '29.2',
      title: 'Author the approval-gated greenfield-init workflow and PRD interview reference',
      problem:
        'The plugin needs an executable workflow that turns a one-question-at-a-time product interview into named artifacts while preserving the arc honesty rail: no consumer write or generator run may occur before the user approves the complete what/where/why proposal.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/prd-interview.md',
          description:
            'Define a one-question-at-a-time interview for Product, Audience, Platforms, Constraints, Non-goals, Success signals, and Brand (Blade or not); map each answer to the same docs/PRD.md heading and allow `Don\'t know yet` → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/prd-interview.md\',\'utf8\');for(const h of [\'Product\',\'Audience\',\'Platforms\',\'Constraints\',\'Non-goals\',\'Success signals\',\'Brand\'])if(!s.includes(h+\' | docs/PRD.md §\'+h))process.exit(1);if(!s.includes(\"Don\'t know yet\")||!s.includes(\'one question at a time\'))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
          description:
            'Order all workflow headings, cite every step reference, and cap the body at 200 lines → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md\',\'utf8\'),h=\'Interview|Draft proposal|Approval gate|Execute approved plan|Verify|Done\'.split(\'|\').map(x=>\'## \'+x),p=h.map(x=>s.indexOf(x)),r=\'prd-interview.md|zeroh-greenfield:stack-decision|references/design-system.md|references/archetypes/<name>.md|references/standards.md|references/pointers.md|roadmap init|README.md\'.split(\'|\');if(p.some((v,i)=>v<0||(i&&v<=p[i-1]))||r.some(v=>!s.includes(v))||s.split(/^---$/m).slice(2).join(\'\').split(/\\n/).length-1>200)process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
          description:
            'Gate all writes/generators behind `Artifact | Target | Reason`, exact `APPROVE GREENFIELD PLAN`, and a pre-write STOP; record approval in docs/PRD.md §Decisions. Name install-and-STOP exits for both siblings and an artifact-based done contract → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md\',\'utf8\');for(const x of [\'Artifact | Target | Reason\',\'APPROVE GREENFIELD PLAN\',\'STOP before any write or generator run\',\'docs/PRD.md §Decisions\',\'/plugin install zeroh-roadmap@zeroh-marketplace\',\'/plugin install zeroh-design@zeroh-marketplace\',\'roadmap config check exits 0\'])if(!s.includes(x))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'The seven interview fields each map literally to their matching docs/PRD.md heading, use one-question-at-a-time behavior, and retain the `Don\'t know yet` escape.',
        'The six fixed workflow headings appear in order; the ≤200-line body cites the interview and all four step-scoped references, calls stack-decision, and orders roadmap init before pointer edits.',
        'The proposal table, exact approval line, pre-write STOP, Decisions ruling, both sibling install commands, and artifact-based successful roadmap config check done condition are literal contracts.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/prd-interview.md',
      ],
      testMode: 'none',
      dependsOn: ['29.1'],
      interfaces: {
        consumes: ['using-zeroh-greenfield dispatch table from 29.1'],
        produces: [
          'zeroh-greenfield:greenfield-init',
          'references/design-system.md',
          'references/archetypes/<name>.md',
          'references/standards.md',
          'references/pointers.md',
        ],
      },
      done: true,
      doneDate: '2026-09-04',
      transparencyReport: {
        whatWasDone:
          'Authored the seven-field, one-question-at-a-time PRD interview and the complete greenfield-init workflow from interview through artifact-based completion.',
        how:
          'The workflow loads references only at their owning steps, delegates stack decisions, lists every proposed write or generator in an Artifact/Target/Reason table, and requires the exact approval response before any mutation. It stops with explicit sibling install remedies and verifies the archetype, README catalog, and roadmap configuration. All three task checks passed; the phase types slot was declared-none and green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '29.3',
      title: 'Create the consumer-dropped documentation and harness templates',
      problem:
        'greenfield-init has no consumer artifact shapes to propose or write. The templates must establish one conventions home, an import-only Claude adapter, matching PRD sections, architecture and UX indexes, contribution rules, and a README whose catalog can be mechanically checked without pre-filling archetype-specific content.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/templates/AGENTS.md',
          description:
            'Create the harness-neutral `## Conventions`, `## Don\'t`, `## Generalize-forward`, and `## Flag-first delivery` contract in that order; use placeholders for phase-32 fills and make `hold[]` conditional on release-bearing archetypes → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/templates/AGENTS.md\',\'utf8\'),h=[\'## Conventions\',\"## Don\'t\",\'## Generalize-forward\',\'## Flag-first delivery\'];if(h.some((x,i)=>s.indexOf(x)<0||(i&&s.indexOf(x)<=s.indexOf(h[i-1]))))process.exit(1);if(!s.includes(\'<conventions>\')||!s.includes(\'<release-bearing-archetype: hold[]>\'))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/CLAUDE.md',
          description:
            'Create only the `@AGENTS.md` import then `<harness-specific-lines>`; reject copied convention sections → verify: node -e "const a=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/templates/CLAUDE.md\',\'utf8\').trimEnd().split(/\\r?\\n/),s=a.join(\'\\n\');if(a.length!==2||a[0]!==\'@AGENTS.md\'||a[1]!==\'<harness-specific-lines>\'||[\'## Conventions\',\"## Don\'t\",\'## Generalize-forward\',\'## Flag-first delivery\'].some(x=>s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/docs/PRD.md',
          description:
            'Create the seven interview sections then Decisions, with placeholders and a dated ruling row; apply `plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/documentation-rules.md` [FIXED: anchor was missing the plugins/zeroh-roadmap/ prefix and did not resolve] → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/templates/docs/PRD.md\',\'utf8\'),h=[\'Product\',\'Audience\',\'Platforms\',\'Constraints\',\'Non-goals\',\'Success signals\',\'Brand\',\'Decisions\'],p=h.map(x=>s.indexOf(\'## \'+x));if(p.some((v,i)=>v<0||(i&&v<=p[i-1]))||h.slice(0,7).some(x=>!s.includes(\'<\'+x.toLowerCase().replaceAll(\' \',\'-\')+\'>\'))||!s.includes(\'| <date> | <ruling> | <reason> |\'))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/docs/architecture.md',
          description:
            'Create an architecture INDEX with `<topic>` and `<path>` link rows; apply `plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/documentation-rules.md` [FIXED: anchor was missing the plugins/zeroh-roadmap/ prefix and did not resolve] → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/templates/docs/architecture.md\',\'utf8\');if(!s.includes(\'## Topic index\')||!s.includes(\'| <topic> | <path> |\'))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/docs/ux-canon.md',
          description:
            'Create Visual language, Component vocabulary, Interaction rules, then one Binding design system pointer; use placeholders, never token values → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/templates/docs/ux-canon.md\',\'utf8\'),h=[\'Visual language\',\'Component vocabulary\',\'Interaction rules\',\'Binding design system\'].map(x=>\'## \'+x);if(h.some((x,i)=>s.indexOf(x)<0||(i&&s.indexOf(x)<=s.indexOf(h[i-1])))||(s.match(/^## Binding design system$/gm)||[]).length!==1||!s.includes(\'<binding-design-system-path>\'))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/README.md',
          description:
            'Create CODE-STYLE, README, and CONTRIBUTING contracts → verify: node -e "const f=require(\'fs\'),a=f.readFileSync(\'plugins/zeroh-greenfield/templates/docs/CODE-STYLE.md\',\'utf8\'),b=f.readFileSync(\'plugins/zeroh-greenfield/templates/README.md\',\'utf8\'),c=f.readFileSync(\'plugins/zeroh-greenfield/templates/CONTRIBUTING.md\',\'utf8\');if([\'## Lint\',\'## Format\',\'<lint-command>\',\'<format-command>\'].some(x=>!a.includes(x))||[\'## Structure\',\'## Commands\',\'## Catalog\',\'<catalog-check-command>\'].some(x=>!b.includes(x))||[\'type(scope): imperative summary\',\'72 characters\',\'Clear and concise\',\'No duplication\',\'Timeless\',\'Current\'].some(x=>!c.includes(x)))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'All eight files listed by task 29.3 exist; their required variable slots use the literal angle-bracket placeholders named in the step verifies.',
        'AGENTS has all four sections in contract order; CLAUDE.md is exactly the import plus harness placeholder and contains none of those four headings.',
        'PRD has all seven interview fields in order plus Decisions; architecture is an index and ux-canon has exactly one binding-system heading and pointer placeholder.',
        'CODE-STYLE, README, and CONTRIBUTING each satisfy their full step verify, including commit grammar, 72-character cap, and Clear and concise / No duplication / Timeless / Current.',
      ],
      files: [
        'plugins/zeroh-greenfield/templates/AGENTS.md',
        'plugins/zeroh-greenfield/templates/CLAUDE.md',
        'plugins/zeroh-greenfield/templates/docs/PRD.md',
        'plugins/zeroh-greenfield/templates/docs/architecture.md',
        'plugins/zeroh-greenfield/templates/docs/ux-canon.md',
        'plugins/zeroh-greenfield/templates/docs/CODE-STYLE.md',
        'plugins/zeroh-greenfield/templates/CONTRIBUTING.md',
        'plugins/zeroh-greenfield/templates/README.md',
      ],
      testMode: 'none',
      dependsOn: ['29.2'],
      interfaces: {
        consumes: ['zeroh-greenfield:greenfield-init from 29.2'],
        produces: [
          'templates/AGENTS.md',
          'templates/CLAUDE.md',
          'templates/docs/PRD.md',
          'templates/docs/architecture.md',
          'templates/docs/ux-canon.md',
          'templates/docs/CODE-STYLE.md',
          'templates/README.md',
          'templates/CONTRIBUTING.md',
        ],
      },
      done: true,
      doneDate: '2026-09-04',
      transparencyReport: {
        whatWasDone:
          'Created the eight consumer-dropped templates for the conventions home, harness adapter, PRD, architecture and UX indexes, code style, contribution rules, and repository catalog.',
        how:
          'Kept every variable value as an explicit angle-bracket placeholder, made AGENTS.md the only convention home, reduced CLAUDE.md to its import and harness slot, and shaped the documentation as concise indexes and contracts. All six task checks passed; the phase types slot was declared-none and green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
  ],
  reviewRecord: { date: '2026-09-04', model: 'gpt-5.6-sol', verdict: 'READY', via: 'executed' },
  notes:
    'interview: skipped — the GREENFIELD arc entity records the user interview and locked decisions on 2026-09-03. userFacing false: this phase authors plugin skills and consumer-drop templates, not a runtime consumer feature, so no flag applies. kind logic: the SKILL.md files carry workflow and dispatch behavior; testMode none follows the declarative-artifact rule. The repository gate runs zeroh-roadmap\'s suite, which this plugin-prose diff does not affect; review stays full because the approval and ownership seams are new and subtle. Timing uses the recorded 1-3 × surface:false cohort. Later-phase paths references/design-system.md, references/archetypes/<name>.md, references/standards.md, and references/pointers.md are PLANNED outputs of phases 30-32, not claims that those paths resolve at HEAD; R21 therefore cannot pass at phase 29, so final R1-R28 grading is owned by phase 34 task 34.3 after every cited reference exists. Documentation-producing tasks apply plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/documentation-rules.md [FIXED: path was missing the plugins/zeroh-roadmap/ prefix]. Apache-2.0 is Allowed anywhere for this copied license, evidenced by plugins/zeroh-design/LICENSE.txt and governed by plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/external-assets-licensing.md. Duplicate probe 2026-09-03: `grep -rln -F zeroh-greenfield roadmap/phases roadmap/backlog.ts` returned no hits; roadmap status showed no active arc lane and phase 29 was launcher-reserved. Plan-time probes 2026-09-03: plugins/zeroh-greenfield and every target anchor were absent; zeroh-design manifest category/author and Apache license probes passed; GREENFIELD four-skill/single-router probes passed. Verify rehearsal: all three assumption commands exited 0; every step verify was executed and exited non-zero because its exact target file/directory is absent, which is the condition its task removes. Negative CLAUDE section checks are paired with the positive two-line adapter contract. Falsifiers: creating plugins/zeroh-greenfield falsifies assumption 1; changing/removing the design manifest or license falsifies 2; changing the locked arc seam text falsifies 3. Cross-phase dependencies: none consumed; this phase produces the reference filenames and template/router contracts phases 30-32 extend. Closing review and queue mutation are disabled by the lane envelope. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): removed premature 29.4 in favor of 34.3; completed router/manifest/forbidden-tree checks; completed interview/workflow/approval checks; completed eight-template and three-file checks; recorded Apache-2.0 Allowed anywhere.',
})
