import { definePhase } from '@/lib/roadmap/schema'

/**
 * GREENFIELD decisions plane: sourced stack rulings and one-owner design-system guidance.
 *
 * The standalone `stack-decision` skill owns the option matrices and the text written into
 * the two expensive-to-reverse ADRs. `greenfield-init` and `brownfield-audit` call that owner
 * instead of carrying copies. The design-system reference keeps web and mobile token bindings
 * explicit, while a Blade brand delegates token materialisation to zeroh-design Path 2.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 30,
  name: 'Stack decisions, ADR templates, and design-system bindings for zeroh-greenfield',
  status: 'backlog',
  category: 'feature',
  kind: 'logic',
  source:
    'GREENFIELD arc plane decisions: .building/greenfield-briefs/30.md and roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design items 1 and 4 plus §Research digest.',
  priority: 'HIGH',
  dependsOn: [29],
  conflictsWith: [],
  arcId: 'GREENFIELD',
  userFacing: false,
  testScope: 'static',
  reviewScope: 'full',
  created: '2026-09-03',
  plannedBy: { model: 'gpt-5.6-sol' },
  keyFiles: [
    'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
    'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md',
    'plugins/zeroh-greenfield/templates/docs/adr/0001-tech-stack.md',
    'plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
  ],
  stakeholderDemo:
    'A mobile project receives three sourced stack rows with component-reuse trade-offs and no preselected winner, records the user selection as a dated ruling in both ADR flow and output, and binds the resulting design system without duplicating Blade brand tokens.',
  assumptions: [
    {
      claim: 'The GREENFIELD arc assigns stack ADR text to one stack-decision seam.',
      verify: "grep -F -q 'One ADR author: stack-decision owns the tech-stack and design-system ADR text' roadmap/arcs/GREENFIELD.arc.ts",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'zeroh-design Path 2 exists and loads DESIGN.md, PRINCIPLES.md, and globals.css for the selected brand.',
      verify:
        "grep -F -q 'Path 2 — No project files, theme and stack inferred' plugins/zeroh-design/skills/blade-design/SKILL.md && grep -F -q 'references/[theme]/globals.css' plugins/zeroh-design/skills/blade-design/SKILL.md",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The zeroh token contract and theme-preset generator exist as read-only prior art for source-to-CSS projection.',
      verify:
        'test -f /home/patrik/zeroh/apps/website/docs/TOKEN-CONTRACT.md && test -f /home/patrik/zeroh/packages/generators/src/generators/theme-presets.ts',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The skill quality bar defines the complete R1 through R28 grading contract.',
      verify:
        "grep -F -q '**R1. Delta-only paragraphs.**' plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md && grep -F -q '**R28. Hard constraints name their enforcement**' plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md",
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '30.1',
      title: 'Stack-decision owns sourced matrices and the one-question ruling contract',
      problem:
        'GREENFIELD needs one callable owner for tech-stack ADR prose. Without a fixed matrix grammar and caller boundaries, init and audit can drift, preselect a mobile stack, or cite options that were never verified.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md',
          description:
            'Author five matrices; gate backend on an API answer. Use `option | pros | cons | better when | component reuse | source`; every row ends in a URL or `package:<name>` → verify: awk -F\'|\' \"{for(i=2;i<8;i++)gsub(/^ +| +\\$/,\\\"\\\",\\$i)} \\$2\\$3\\$4\\$5\\$6\\$7==\\\"optionprosconsbetter whencomponent reusesource\\\"{h++;a=1;next} a&&/^\\|/&&\\$2!~/^---/{for(i=2;i<7;i++)if(!length(\\$i))exit 1;if(NF!=8||\\$7!~/^(https?:\\/\\/|package:)/)exit 1;r++;if(\\$2~/Flutter|Kotlin|Expo/)m++} !/^\\|/{a=0} END{exit !(h==5&&r==14&&m==3)}\" plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
          description:
            'Define triggers and exact one-question/no-preselection sentences. Emit a dated ruling and `{ adrPath, rulingLine }`; declare greenfield-init ownership and cite phase 33 for brownfield-audit → verify: node -e "const f=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md\',\'utf8\');for(const s of [\'which stack\',\'tech stack\',\'mobile stack\',\'Ask exactly one selection question per applicable matrix.\',\'Do not preselect any option before the user\\\'s answer.\',\'<YYYY-MM-DD>: <selected option> — <reason>\',\'greenfield-init\',\'phase 33 owns the brownfield-audit caller-side boundary\',\'adrPath\',\'rulingLine\'])if(!f.includes(s))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'All five tables have the exact six-column header; all 14 option rows fill every column and end in a URL or package name; exactly three are the mandated mobile options.',
        'The skill asks exactly one selection question per applicable matrix, records no mobile winner before that answer, and emits the literal `adrPath` and `rulingLine` fields.',
        'stack-decision declares its own boundary with greenfield-init (created by phase 29) and cites phase 33 for brownfield-audit, which phase 33 creates after depending on phase 30; each caller receives ADR output rather than matrix copies.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
        'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
      ],
      testMode: 'none',
      interfaces: {
        produces: [
          'zeroh-greenfield:stack-decision',
          'matrix row: option | pros | cons | better when | component reuse | source',
          'StackDecisionOutput.adrPath',
          'StackDecisionOutput.rulingLine',
        ],
        consumes: [],
      },
      done: false,
    },
    {
      id: '30.2',
      title: 'Tech-stack and design-system ADR templates preserve sourced alternatives and rulings',
      problem:
        'The two GREENFIELD selections are expensive to reverse and therefore clear the documentation-rules decision bar, but no consumer-dropped templates yet preserve sources, consequences, and revisit conditions.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/templates/docs/adr/0001-tech-stack.md',
          description:
            'Create the tech-stack ADR per the documentation-rules path; order Status → Date → Context → Options → Ruling → Consequences → Revisit when and retain sourced rows plus dated ruling → verify: node -e "const f=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/templates/docs/adr/0001-tech-stack.md\',\'utf8\'),h=[\'Status\',\'Date\',\'Context\',\'Options\',\'Ruling\',\'Consequences\',\'Revisit when\'];let p=-1;for(const x of h){const n=f.indexOf(\'## \'+x);if(n<=p)process.exit(1);p=n}for(const s of [\'| option | pros | cons | better when | component reuse | source |\',\'<YYYY-MM-DD>: <selected option> — <reason>\'])if(!f.includes(s))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md',
          description:
            'Create the design-system ADR with ordered headings, sourced rows, dated ruling, Blade pointer, and exact `stores pointers only` rule → verify: node -e "const f=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md\',\'utf8\'),h=[\'Status\',\'Date\',\'Context\',\'Options\',\'Ruling\',\'Consequences\',\'Revisit when\'];let p=-1;for(const x of h){const n=f.indexOf(\'## \'+x);if(n<=p)process.exit(1);p=n}for(const s of [\'| option | pros | cons | better when | component reuse | source |\',\'<YYYY-MM-DD>: <selected option> — <reason>\',\'<binding design system path or Blade pointer>\',\'stores pointers only\'])if(!f.includes(s))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'Both templates contain status/date/context, sourced option rows with `better when`, a dated ruling, consequences, and `Revisit when`.',
        'The tech-stack template can receive the 30.1 row grammar without dropping a column or source; the design-system template stores a pointer, never Blade token values.',
      ],
      files: [
        'plugins/zeroh-greenfield/templates/docs/adr/0001-tech-stack.md',
        'plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md',
      ],
      testMode: 'none',
      dependsOn: ['30.1'],
      interfaces: {
        consumes: ['matrix row: option | pros | cons | better when | component reuse | source'],
        produces: ['templates/docs/adr/0001-tech-stack.md', 'templates/docs/adr/0002-design-system.md'],
      },
      done: false,
    },
    {
      id: '30.3',
      title: 'Greenfield design-system reference binds web, mobile, tokens, registries, and Blade handoff',
      problem:
        'greenfield-init needs one step-scoped reference that turns the approved stack and brand answers into durable design homes. The path must support beautiful web defaults and mobile token parity without creating a second owner for Blade tokens.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
          description:
            'Define shadcn/ui, Tailwind v4, components.json init values, exact no-config rule, and two fetched namespace rows; cite official sources → verify: node -e "const f=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md\',\'utf8\');for(const s of [\'components.json init values\',\'@theme inline\',\'Do not create tailwind.config.\',\'https://ui.shadcn.com/docs/components-json\',\'https://ui.shadcn.com/docs/registry/namespace\',\'https://ui.shadcn.com/r/registries.json\'])if(!f.includes(s))process.exit(1);if((f.match(/^\\| @[^|]+ \\| https?:\\/\\/[^|]+ \\|$/gm)||[]).length<2)process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
          description:
            'Define token projection with a byte-difference guard and ux-canon inputs. Classify beautifului.dev client material as `Allowed anywhere` per the licensing policy path; cite it as source-not-registry → verify: node -e "const f=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md\',\'utf8\');for(const s of [\'TOKEN-CONTRACT.md\',\'theme-presets.ts\',\'byte-difference guard\',\'fonts | palette | spacing | ux-canon\',\'beautifului.dev/license\',\'Allowed anywhere\',\'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/external-assets-licensing.md\',\'source, not a registry\'])if(!f.includes(s))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
          description:
            'Map each approved mobile stack to its binding and source: shadcn_flutter with shared web token names; Compose Material 3 with translated color/typography/shape; react-native-reusables with shared semantic names. Each row maps fonts/palette/spacing into ux-canon → verify: awk -F\'|\' \"BEGIN{n=0} /shadcn_flutter|Material 3|react-native-reusables/{if(NF<6||\\$0!~/https?:\\/\\/|package:/||\\$0!~/ux-canon/||\\$0!~/font/||\\$0!~/palette/||\\$0!~/spacing/)exit 1;n++} END{exit !(n==3)}\" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
          description:
            'For Blade, call `zeroh-design:blade-design` Path 2; permit greenfield to write exactly the bindingDesignSystem, ux-canon, and ADR pointer classes, never token values. If absent, print the install command and STOP before tokens → verify: node -e "const f=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md\',\'utf8\');for(const s of [\'zeroh-design:blade-design\',\'Path 2\',\'/plugin install zeroh-design@zeroh-marketplace\',\'STOP before tokens\',\'designHomes.ux.bindingDesignSystem\',\'ux-canon pointer\',\'ADR pointer\',\'never token values\'])if(!f.includes(s))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'The web branch yields Tailwind-v4 CSS-first settings, components.json init values and at least two registry namespaces whose exact names and URLs were present in the fetched registry index.',
        'The token byte guard detects a changed generated CSS projection; fonts, palette, and spacing remain explicit ux-canon inputs.',
        'All three mobile bindings are present, and the Blade path writes only three pointer classes after zeroh-design materialises its owned files; the absent-plugin branch stops with the exact install command.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md'],
      testMode: 'none',
      dependsOn: ['30.2'],
      interfaces: {
        consumes: ['templates/docs/adr/0002-design-system.md'],
        produces: ['skills/greenfield-init/references/design-system.md'],
      },
      done: false,
    },
    {
      id: '30.4',
      title: 'Grade stack-decision against all 28 authoring rules and close every failure',
      problem:
        'A new independently activated workflow skill is not shippable until its activation, boundaries, progressive disclosure, output contract, failure exits, stable citations, and hard-constraint enforcement have been graded against the repository quality bar.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
          description:
            'Score R1–R28, fix every FAIL, and record evidence in task 30.4 transparencyReport. Enforce the ≤100-line cap, one-level reference, greenfield-init boundary, phase-33 citation, and R21 resolution → verify: task 30.4 transparencyReport contains exactly 28 labeled PASS/FAIL/N-A rows, zero FAILs, the measured body count at most 100, one-level `references/matrices.md` load, resolved URL/path results, `Not this skill:`, greenfield-init ownership, and `phase 33 owns the brownfield-audit caller-side boundary`',
        },
      ],
      acceptanceCriteria: [
        'Task 30.4 transparencyReport contains 28 labeled verdict rows with evidence and zero unfixed FAILs.',
        'The finished reference body is at most 100 lines; matrices load from one cited reference level; every URL/path resolves; stack-decision and phase-29 greenfield-init assign ADR prose to stack-decision, while phase 33 owns the later brownfield caller-side check.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
        'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
      ],
      testMode: 'none',
      dependsOn: ['30.1', '30.2', '30.3'],
      interfaces: {
        consumes: ['zeroh-greenfield:stack-decision', 'skills/greenfield-init/references/design-system.md'],
        produces: ['R1-R28 scorecard'],
      },
      done: false,
    },
  ],
  notes:
    'interview: skipped — GREENFIELD.arc.ts records the parent arc interview and dated user rulings on 2026-09-03; this member implements its decisions plane. userFacing false: these are model-loaded skills and consumer-dropped templates, with no application runtime surface, so no feature flag applies. testMode none for all tasks under skills/using-zeroh-roadmap/references/test-worthiness.md: markdown skills/templates are declarative artifacts; exact structural checks and the R1–R28 review are their checks. reviewScope full because this phase introduces a new callable skill and cross-skill output seam. Timing cohort read from roadmap/arc-evals/timing-stats.json. Plan-time source probes on 2026-09-03: HTTP 200 for Next.js, Vite, Remix, Nx, Turborepo, pnpm workspaces, NestJS, Hono, Fastify, shadcn Tailwind-v4/components.json/namespace/registry index, pub.dev shadcn_flutter, Android Compose Material 3, Expo create-project, registry.directory docs, and beautifului.dev/license; npm exposed @react-native-reusables/cli while react-native-reusables.com DNS returned no host, so the plan requires the npm/GitHub source rather than that dead domain. The fetched shadcn registry index contained healthy named entries including @1st-pouf, @23rd, @7ovr, @8bitcn, @aceternity, @ai-elements, and @assistant-ui; execution selects at least two fitting entries by exact fetched name+URL and records the fetch evidence, with no invented namespace. Assumption probes all exited 0: the arc one-owner line, Blade Path 2 plus globals.css contract, both absolute zeroh prior-art files, and R1/R28 quality-bar anchors. Verify rehearsal: every step verify exits non-zero before phase 29 produces plugins/zeroh-greenfield; each failure is the target file absence removed by the planned work. No negative grep is used. Phase 30 declares only its side of the greenfield-init boundary; phase 33 creates brownfield-audit after depending on phase 30 and owns that caller-side boundary. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): removed the phase-30/33 boundary cycle; made matrix, question, ADR, design binding, and scorecard checks structural; named beautifului-derived client material tier Allowed anywhere.',
})
