import { definePhase } from '@/lib/roadmap/schema'

/**
 * Establish the skills-and-templates foundation for zeroh-greenfield.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 29,
  name: 'zeroh-greenfield skeleton, initialization interview, and consumer templates',
  plannedBy: { model: 'gpt-5.6-sol' },
  status: 'backlog',
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
    {
      claim: 'The skill quality standard contains the complete R1 through R28 grading vocabulary used by task 29.4.',
      verify:
        "bash -c \"grep -qF '**R1. Delta-only paragraphs.**' plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md && grep -qF '**R28. Hard constraints name their enforcement**' plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md\"",
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
            'Create the Claude plugin manifest with name `zeroh-greenfield`, category `development`, a setup-focused description, and the Blade Labs author object copied from the zeroh-design precedent; do not add package.json, scripts, hooks, agents, or Node code → verify: node -e "const p=JSON.parse(require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/.claude-plugin/plugin.json\',\'utf8\')); if(p.name!==\'zeroh-greenfield\'||p.category!==\'development\'||p.author?.name!==\'Blade Labs\') process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
          description:
            'Author the only dispatch table: init/new-repo/scaffold → `greenfield-init`; audit/fill-gaps/brownfield → `brownfield-audit`; stack-choice/mobile-stack → `stack-decision`. Add the greenfield/brownfield marker table and both-way ownership boundaries with zeroh-roadmap and zeroh-design under R17 → verify: grep -qF "brownfield-audit" plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
        },
        {
          file: 'plugins/zeroh-greenfield/README.md',
          description:
            'Document what the plugin does, its four-skill catalog, `/plugin install zeroh-greenfield@zeroh-marketplace`, and a concise design summary linked to the GREENFIELD execution prompt; apply `skills/using-zeroh-roadmap/references/documentation-rules.md` and keep detailed contracts in their owning skills/references → verify: bash -c "grep -qF \"/plugin install zeroh-greenfield@zeroh-marketplace\" plugins/zeroh-greenfield/README.md && grep -qF \"greenfield-init\" plugins/zeroh-greenfield/README.md && grep -qF \"brownfield-audit\" plugins/zeroh-greenfield/README.md && grep -qF \"stack-decision\" plugins/zeroh-greenfield/README.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/LICENSE.txt',
          description:
            'Copy the zeroh-design Apache License 2.0 family text into LICENSE.txt without altering its legal terms → verify: cmp -s plugins/zeroh-design/LICENSE.txt plugins/zeroh-greenfield/LICENSE.txt',
        },
      ],
      acceptanceCriteria: [
        'The manifest parses as JSON and identifies zeroh-greenfield as a Blade Labs development plugin.',
        'The router assigns every locked trigger family once and names greenfield/brownfield detection plus both sibling ownership boundaries.',
        'The plugin root contains no package.json, scripts directory, JavaScript, or TypeScript file.',
        'README installation and four-skill catalog are scan-visible, and LICENSE.txt is byte-identical to the zeroh-design license.',
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
      done: false,
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
            'Define the scope-first, one-question-at-a-time interview for product, audience, platforms, constraints, non-goals, success signals, and Blade-or-not brand; map every answer to its docs/PRD.md section and provide the literal `Don\'t know yet` escape value, following the specify/clarify precedent → verify: bash -c "grep -qF \"## Product\" plugins/zeroh-greenfield/skills/greenfield-init/references/prd-interview.md && grep -qF \"## Non-goals\" plugins/zeroh-greenfield/skills/greenfield-init/references/prd-interview.md && grep -qF \"Don\'t know yet\" plugins/zeroh-greenfield/skills/greenfield-init/references/prd-interview.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
          description:
            'Author a ≤200-body-line workflow ordered interview → PRD → CALL `zeroh-greenfield:stack-decision` → planned design/archetype/standards/pointers references → `roadmap init` before optional config → README. Mark phase-30–32 reference paths as planned, not HEAD citations → verify: grep -qF "zeroh-greenfield:stack-decision" plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
          description:
            'Before every write/generator run, present artifact/target/reason proposal rows and require an explicit approval line recorded as a dated `docs/PRD.md` §Decisions ruling. Add STOP exits for missing approval and absent zeroh-roadmap/zeroh-design, each with its install command → verify: grep -qF "## Approval gate" plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
        },
      ],
      acceptanceCriteria: [
        'The workflow order is reconstructible from headings, references the single interview owner, and never embeds a stack matrix.',
        'A run without the exact approval line reaches a named STOP before any write or generator command; an approved run records the approval under docs/PRD.md §Decisions.',
        'Every missing-sibling branch names the appropriate marketplace install command and stops only that branch.',
        'The workflow body stays within 200 lines and defines completion as the named consumer artifacts plus a successful roadmap config check.',
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
      done: false,
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
            'Create the harness-neutral `## Conventions`, `## Don\'t`, `## Generalize-forward`, and `## Flag-first delivery` section contract; include `hold[]` only for release-bearing archetypes, use placeholders for phase-32 content, and cite rather than duplicate the consumer rule → verify: grep -qF "## Flag-first delivery" plugins/zeroh-greenfield/templates/AGENTS.md',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/CLAUDE.md',
          description:
            'Create the Claude adapter with `@AGENTS.md` as its import line and only `<harness-specific-lines>` after it; do not restate conventions → verify: bash -c "test \"$(head -n 1 plugins/zeroh-greenfield/templates/CLAUDE.md)\" = \"@AGENTS.md\" && grep -qF \"<harness-specific-lines>\" plugins/zeroh-greenfield/templates/CLAUDE.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/docs/PRD.md',
          description:
            'Create the PRD skeleton with sections matching every prd-interview answer and `## Decisions` containing the dated-ruling row shape; apply `skills/using-zeroh-roadmap/references/documentation-rules.md` → verify: bash -c "grep -qF \"## Product\" plugins/zeroh-greenfield/templates/docs/PRD.md && grep -qF \"## Success signals\" plugins/zeroh-greenfield/templates/docs/PRD.md && grep -qF \"## Decisions\" plugins/zeroh-greenfield/templates/docs/PRD.md && grep -qF \"<date>\" plugins/zeroh-greenfield/templates/docs/PRD.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/docs/architecture.md',
          description:
            'Create an architecture INDEX with `<topic>` and `<path>` link rows rather than a second architecture narrative; apply `skills/using-zeroh-roadmap/references/documentation-rules.md` → verify: bash -c "grep -qF \"## Topic index\" plugins/zeroh-greenfield/templates/docs/architecture.md && grep -qF \"<topic>\" plugins/zeroh-greenfield/templates/docs/architecture.md && grep -qF \"<path>\" plugins/zeroh-greenfield/templates/docs/architecture.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/docs/ux-canon.md',
          description:
            'Create the UX canon skeleton for visual language, component vocabulary, interaction rules, and one binding design-system pointer; use placeholders and never duplicate token values → verify: bash -c "grep -qF \"## Visual language\" plugins/zeroh-greenfield/templates/docs/ux-canon.md && grep -qF \"## Component vocabulary\" plugins/zeroh-greenfield/templates/docs/ux-canon.md && grep -qF \"## Interaction rules\" plugins/zeroh-greenfield/templates/docs/ux-canon.md && grep -qF \"## Binding design system\" plugins/zeroh-greenfield/templates/docs/ux-canon.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/README.md',
          description:
            'Create docs/CODE-STYLE.md; combine the consumer README structure/commands/catalog/check skeleton with the template-to-skill map in templates/README.md; create CONTRIBUTING.md with `type(scope): imperative summary`, the 72-character cap, and the four documentation principles → verify: grep -qF "<catalog-check-command>" plugins/zeroh-greenfield/templates/README.md',
        },
      ],
      acceptanceCriteria: [
        'All eight required consumer template files exist, and each variable value uses an `<angle-bracket>` placeholder.',
        'CLAUDE.md imports AGENTS.md and contains no copied Conventions, Don\'t, Generalize-forward, or Flag-first section.',
        'PRD headings cover every interview field and expose a dated Decisions row; architecture.md is an index and ux-canon.md has exactly one binding-system pointer home.',
        'The consumer README carries structure, commands, catalog, and catalog-check placeholders; CONTRIBUTING carries the exact commit grammar, 72-character limit, and all four documentation principles.',
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
      done: false,
    },
    {
      id: '29.4',
      title: 'Grade both new skills against every authoring-standard rule and fix failures',
      problem:
        'The router and workflow are model-loaded behavior, so structural checks alone cannot establish that they meet the repository R1–R28 quality bar. Review needs a durable per-rule verdict for both bodies after all fixes, including explicit N-A reasons where a rule does not apply.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
          description:
            'Grade the router against R1–R28 in plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md, fix every FAIL in the owning skill/reference, and preserve its single-router boundary → verify: bash -c "grep -qF \"brownfield-audit\" plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md && grep -qF \"zeroh-roadmap\" plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md && grep -qF \"zeroh-design\" plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
          description:
            'Grade greenfield-init against R1–R28, fix every FAIL in the owning skill/reference, and recheck the ≤200 body-line cap, execution-order headings, named failure exits, literal downstream artifact contract, and artifact-based done condition → verify: bash -c "test $(awk \"BEGIN{n=0; body=0} /^---$/{n++; next} n>=2{body++} END{print body}\" plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md) -le 200 && grep -qF \"## Approval gate\" plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md && grep -qF \"## Done\" plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/README.md',
          description:
            'Add `## Standard compliance` with one R1–R28 row per rule and separate router/init verdict columns; every cell is PASS or `N-A: <reason>`, with no FAIL remaining, and cite the standard rather than copying its rule text → verify: bash -c "grep -qF \"## Standard compliance\" plugins/zeroh-greenfield/README.md && test \"$(grep -c \"^| R[0-9]\" plugins/zeroh-greenfield/README.md)\" = \"28\" && test \"$(grep -c \"FAIL\" plugins/zeroh-greenfield/README.md)\" = \"0\""',
        },
      ],
      acceptanceCriteria: [
        'README Standard compliance has exactly 28 rule rows, two skill verdict columns, and no FAIL verdict.',
        'Every N-A verdict names why the rule does not apply; PASS verdicts are consistent with the final skill and reference files.',
        'The final router remains the sole trigger table, and greenfield-init remains at or below 200 body lines with heading-order execution and named STOP exits.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/prd-interview.md',
        'plugins/zeroh-greenfield/README.md',
      ],
      testMode: 'none',
      dependsOn: ['29.3'],
      interfaces: {
        consumes: ['using-zeroh-greenfield dispatch table from 29.1', 'zeroh-greenfield:greenfield-init from 29.2'],
        produces: ['README.md Standard compliance R1-R28 grade table'],
      },
      done: false,
    },
  ],
  notes:
    'interview: skipped — the GREENFIELD arc entity records the user interview and locked decisions on 2026-09-03. userFacing false: this phase authors plugin skills and consumer-drop templates, not a runtime consumer feature, so no flag applies. kind logic: the SKILL.md files carry workflow and dispatch behavior; testMode none follows the declarative-artifact rule. The repository gate runs zeroh-roadmap\'s suite, which this plugin-prose diff does not affect; review stays full because the approval and ownership seams are new and subtle. Timing uses the recorded 4-6 × surface:false cohort. Later-phase paths references/design-system.md, references/archetypes/<name>.md, references/standards.md, and references/pointers.md are explicitly planned outputs, not claims that those paths resolve at HEAD. Documentation-producing tasks apply skills/using-zeroh-roadmap/references/documentation-rules.md. Duplicate probe 2026-09-03: `grep -rln -F zeroh-greenfield roadmap/phases roadmap/backlog.ts` returned no hits; roadmap status showed no active arc lane and phase 29 was launcher-reserved. Plan-time probes 2026-09-03: plugins/zeroh-greenfield and every target anchor were absent; zeroh-design manifest category/author and Apache license probes passed; GREENFIELD four-skill/single-router probes passed; R1 and R28 standard anchors passed. Verify rehearsal: all four assumption commands exited 0; every step verify was executed and exited non-zero because its exact target file/directory is absent, which is the condition its task removes. No negative-removal grep is used. Falsifiers: creating plugins/zeroh-greenfield falsifies assumption 1; changing/removing the design manifest or license falsifies 2; changing the locked arc seam text falsifies 3; renaming/removing either endpoint rule falsifies 4. Cross-phase dependencies: none consumed; this phase produces the reference filenames and template/router contracts phases 30-32 extend. Closing review and queue mutation are disabled by the lane envelope; self-review found no duplicate, deferred decision, later-task dependency, unclosed promise, or lifecycle state requiring an additional criterion.',
})
