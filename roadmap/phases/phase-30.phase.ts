import { definePhase } from '@/lib/roadmap/schema'

/**
 * GREENFIELD decisions plane: sourced stack rulings and one-owner design-system guidance.
 *
 * The standalone `stack-decision` skill owns the option matrices and the text written into
 * the two expensive-to-reverse ADRs. This phase declares only stack-decision's side of its
 * boundaries: phase 29 owns greenfield-init and phase 33 authors the brownfield-audit side.
 * The design-system reference keeps web and mobile token bindings
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
            'Author five named matrices with ≥2 rows; Mobile has exactly three. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md\',\'utf8\'),H=[...s.matchAll(/^## (.+)$/gm)];for(const n of [\'Web\',\'Mobile\',\'Monorepo\',\'Library-CLI\',\'Backend\']){const a=H.filter(x=>x[1]===n);if(a.length!==1)throw n;const i=a[0].index,e=H.find(x=>x.index>i)?.index||s.length,L=s.slice(i,e).split(\'\\n\').filter(x=>/^\\|/.test(x)),r=L.slice(2);if(L[0]?.toLowerCase()!==\'| option | pros | cons | better when | component reuse | source |\'||r.length<(n===\'Mobile\'?3:2)||n===\'Mobile\'&&r.length!==3||r.some(x=>!/(https?:\\/\\/|\\| `?[@a-z0-9._-]+`? \\|$)/.test(x))||n===\'Mobile\'&&![\'Flutter\',\'Kotlin\',\'Expo\'].every(x=>r.some(y=>y.includes(x))))throw n}"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
          description:
            'Define triggers and output fields; declare only stack-decision\'s side of both caller boundaries. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md\',\'utf8\'),a=[\'Ask exactly one selection question per applicable matrix.\',\'Do not preselect any option before the user\\\'s answer.\',\'<YYYY-MM-DD>: <selected option> — <reason>\',\'greenfield-init\',\'phase 33 authors the brownfield-audit side\',\'adrPath\',\'rulingLine\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e asserts one required heading each, exact six-column headers, at least two rows per matrix, exactly three Mobile rows containing Flutter/Kotlin/Expo, and a URL or package source per row.',
        'node -e asserts the exact one-question and no-preselection sentences, dated ruling pattern, and literal `adrPath` and `rulingLine` fields.',
        'stack-decision declares only its own boundary side with greenfield-init and brownfield-audit; phase 33 authors the brownfield-audit side.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
        'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md',
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
            'Create the design-system ADR with ordered headings, sourced rows, and the exact Blade rule. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md\',\'utf8\'),h=[\'Status\',\'Date\',\'Context\',\'Options\',\'Ruling\',\'Consequences\',\'Revisit when\'];let p=-1;for(const x of h){const n=s.indexOf(\'## \'+x);if(n<=p)process.exit(1);p=n}const o=s.slice(s.indexOf(\'## Options\'),s.indexOf(\'## Ruling\')),r=s.slice(s.indexOf(\'## Ruling\'),s.indexOf(\'## Consequences\'));if(!o.includes(\'| option | pros | cons | better when | component reuse | source |\')||!r.includes(\'<YYYY-MM-DD>\')||!s.includes(\'For Blade, store pointers only; tokens are owned by zeroh-design.\'))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e checks both templates for ordered Status/Date/Context/Options/Ruling/Consequences/Revisit when headings, the six-column header, and a Ruling-section <YYYY-MM-DD>.',
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
            'Define shadcn/ui, Tailwind v4, four components.json init keys, and a valid registries example; reject the legacy config filename. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md\',\'utf8\');if(!/[\\\"\\\']style[\\\"\\\']\\s*:/.test(s)||!/[\\\"\\\']baseColor[\\\"\\\']\\s*:/.test(s)||!/[\\\"\\\']cssVariables[\\\"\\\']\\s*:/.test(s)||!/[\\\"\\\']iconLibrary[\\\"\\\']\\s*:/.test(s)||!/[\\\"\\\']registries[\\\"\\\']\\s*:/.test(s)||!/(https:\\/\\/[^\\s\\\"]+\\/r\\/|@[-a-z0-9_]+\\/)/i.test(s))process.exit(1)" && ! grep -qF `tailwind.config` plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
          description:
            'Require a byte-check guard and fonts, palette, spacing ux-canon inputs. beautifului.dev is MIT, tier Allowed anywhere, per the cited policy heading. → verify: bash -c "grep -qF `byte-check guard` plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md && grep -qF `fonts | palette | spacing | ux-canon` plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md && grep -qF `plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/external-assets-licensing.md §The tiers` plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md && grep -qF `MIT — Allowed anywhere` plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
          description:
            'Add one sourced mobile mapping row each for shadcn_flutter, Material 3, and react-native-reusables, mapping fonts, palette, and spacing into ux-canon. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md\',\'utf8\'),r=s.split(\'\\n\').filter(x=>/^\\|/.test(x));for(const n of [\'shadcn_flutter\',\'Material 3\',\'react-native-reusables\']){const a=r.filter(x=>x.includes(n));if(a.length!==1||![\'ux-canon\',\'fonts\',\'palette\',\'spacing\'].every(x=>a[0].includes(x))||!/(https?:\\/\\/|`?[@a-z0-9._-]+`? \\|$)/.test(a[0]))process.exit(1)}"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
          description:
            'For Blade, call zeroh-design Path 2 and write only the three pointer targets; add the exact absent-plugin STOP sentence. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md\',\'utf8\'),a=[\'designHomes.ux.bindingDesignSystem\',\'ux-canon pointer line\',\'ADR line\',\'If zeroh-design is absent, print `/plugin install zeroh-design@zeroh-marketplace` and STOP.\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e checks the web branch for all four components.json init values and a registries value matching an HTTPS /r/ URL or namespaced @name/ form.',
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
            'Record a complete R1–R28 scorecard with evidence and no FAIL. → verify: node -e "const s=require(\'fs\').readFileSync(\'roadmap/phases/phase-30.phase.ts\',\'utf8\'),t=s.match(/id: \'30.4\'[\s\S]*?transparencyReport:[\s\S]*?(?=\n    },)/)?.[0]||\'\';for(let i=1;i<=28;i++)if((t.match(new RegExp(`^\\\\| R\${i} \\\\| (?:PASS|N-A: [^|]+) \\\\| [^|]+ \\\\|$`,\'gm\'))||[]).length!==1)process.exit(1);if(/\|\s*FAIL\s*\|/.test(t))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
          description:
            'Keep the body ≤100 lines and one reference level; resolve cited paths using the explicit phase-29–33 allowlist; R17 checks only this skill. → verify: node -e "const f=require(\'fs\'),p=\'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md\',s=f.readFileSync(p,\'utf8\'),a=[\'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md\',\'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md\'];if(s.split(/\\r?\\n/).length>100||!s.includes(\'references/matrices.md\')||!s.includes(\'Not this skill:\')||![\'greenfield-init\',\'brownfield-audit\'].every(x=>s.includes(x)))process.exit(1);for(const x of s.match(/(?:plugins\/[-\w./]+|references\/[-\w./]+)/g)||[]){const y=x.startsWith(\'references/\')?p.replace(/SKILL.md$/,x):x;if(!f.existsSync(y)&&!a.includes(y))throw y}"',
        },
      ],
      acceptanceCriteria: [
        'node -e asserts exactly one scorecard row for every R1 through R28, evidence cells, and zero cells equal to FAIL.',
        'node -e asserts every plugins/ and references/ path cited by stack-decision resolves or is in the explicit phase-29–33 planned-path allowlist.',
        'bash -c checks both sibling names only inside stack-decision/SKILL.md: `grep -qF greenfield-init plugins/zeroh-greenfield/skills/stack-decision/SKILL.md && grep -qF brownfield-audit plugins/zeroh-greenfield/skills/stack-decision/SKILL.md`.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
        'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md',
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
    'interview: skipped — GREENFIELD.arc.ts records the parent arc interview and dated user rulings on 2026-09-03; this member implements its decisions plane. userFacing false: these are model-loaded skills and consumer-dropped templates, with no application runtime surface, so no feature flag applies. testMode none for all tasks under skills/using-zeroh-roadmap/references/test-worthiness.md: markdown skills/templates are declarative artifacts; exact structural checks and the R1–R28 review are their checks. reviewScope full because this phase introduces a new callable skill and cross-skill output seam. Timing cohort read from roadmap/arc-evals/timing-stats.json. Plan-time source probes on 2026-09-03: HTTP 200 for Next.js, Vite, Remix, Nx, Turborepo, pnpm workspaces, NestJS, Hono, Fastify, shadcn Tailwind-v4/components.json/namespace/registry index, pub.dev shadcn_flutter, Android Compose Material 3, Expo create-project, registry.directory docs, and beautifului.dev/license; npm exposed @react-native-reusables/cli while react-native-reusables.com DNS returned no host, so the plan requires the npm/GitHub source rather than that dead domain. The fetched shadcn registry index contained healthy named entries including @1st-pouf, @23rd, @7ovr, @8bitcn, @aceternity, @ai-elements, and @assistant-ui; execution selects at least two fitting entries by exact fetched name+URL and records the fetch evidence, with no invented namespace. Assumption probes all exited 0: the arc one-owner line, Blade Path 2 plus globals.css contract, both absolute zeroh prior-art files, and R1/R28 quality-bar anchors. Verify rehearsal: every step verify exits non-zero before phase 29 produces plugins/zeroh-greenfield; each failure is the target file absence removed by the planned work. The negative grep rejects the legacy Tailwind config string and is paired with positive init-key assertions. Phase 30 declares only its own side of both boundaries; phase 29 owns greenfield-init and phase 33 authors the brownfield-audit side. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): removed all phase-33 writes and sibling-side checks; made all five matrices and selection rules structural; enforced ordered ADRs and Blade token ownership; enforced init values, registry, token guard, mobile mappings, Blade STOP, and Allowed anywhere placement; enforced R1–R28 rows, zero FAIL cells, and cited-path resolution. Verify-clause bar ruled by the GREENFIELD orchestrator 2026-09-03: step verifies on prose skills prove STRUCTURE (sections, order, rows, forbidden strings, required phrases); BEHAVIOUR is proved by phase 34.4\'s dry runs and validate-arc, never by a grep.',
})
