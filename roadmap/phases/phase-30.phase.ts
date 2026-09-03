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
            'Author matrices: web (Next.js/shadcn, Vite/React, Remix); mobile (Flutter/shadcn_flutter, Kotlin/Compose/Material 3, Expo/React Native); monorepo (Nx, Turborepo, pnpm); library/CLI (tsdown/tsup, Vitest/node:test); API backend (NestJS, Hono, Fastify). Rows use `option | pros | cons | better when | component reuse | source`; gate backend on an API answer → verify: grep -F -q "Flutter + shadcn_flutter" plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md && grep -F -q "Kotlin + Compose + Material 3" plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md && grep -F -q "Expo + React Native" plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
          description:
            'Define triggers `which stack`, `tech stack`, `mobile stack`; load matrices, preselect no mobile winner, ask one question, and write the approved ADR with dated ruling. Declare `greenfield-init` and `brownfield-audit` boundaries; output `{ adrPath, rulingLine }` → verify: grep -F -q "which stack" plugins/zeroh-greenfield/skills/stack-decision/SKILL.md && grep -F -q "greenfield-init" plugins/zeroh-greenfield/skills/stack-decision/SKILL.md && grep -F -q "brownfield-audit" plugins/zeroh-greenfield/skills/stack-decision/SKILL.md && grep -F -q "adrPath" plugins/zeroh-greenfield/skills/stack-decision/SKILL.md && grep -F -q "rulingLine" plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
        },
      ],
      acceptanceCriteria: [
        "`grep -F -q` succeeds for all three mandated mobile option names, and each of those table rows contains all six row fields plus a fetched source URL.",
        'The skill asks exactly one selection question per applicable matrix, records no mobile winner before that answer, and emits the literal `adrPath` and `rulingLine` fields.',
        'Both caller boundaries are stated in stack-decision and in the phase-29 caller skills; the caller receives ADR output rather than duplicating matrix text.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
        'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
        'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
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
            'Create the tech-stack ADR template under `skills/using-zeroh-roadmap/references/documentation-rules.md`: Status, Date, Context, Options, Ruling, Consequences, and Revisit when. Options accepts rows copied without source loss from `matrices.md`, including `better when`; Ruling holds `<YYYY-MM-DD>: <selected option> — <reason>` and states that this expensive-to-reverse stack boundary warrants a standalone ADR → verify: grep -F -q "## Revisit when" plugins/zeroh-greenfield/templates/docs/adr/0001-tech-stack.md && grep -F -q "<YYYY-MM-DD>: <selected option>" plugins/zeroh-greenfield/templates/docs/adr/0001-tech-stack.md',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md',
          description:
            'Create the matching design-system ADR template with the same sections and row-preservation contract, plus `<binding design system path or Blade pointer>` and the dated ruling. State that the costly cross-surface token/component boundary warrants the record, while actual Blade tokens remain in zeroh-design-owned files → verify: grep -F -q "## Revisit when" plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md && grep -F -q "<binding design system path or Blade pointer>" plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md',
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
            'Define non-Blade web: shadcn/ui plus Tailwind v4 CSS-first (`@theme inline`, no `tailwind.config`); record `shadcn init` settings and healthy registry namespaces copied by exact name+URL from the fetched index. Cite the shadcn components.json, namespace, Tailwind-v4, and directory docs → verify: grep -F -q "registries" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md && grep -F -q "@theme inline" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md && grep -F -q "https://ui.shadcn.com/r/registries.json" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
          description:
            'Define one token source projected to CSS variables and shadcn slots, with a byte guard derived from the zeroh `TOKEN-CONTRACT.md` and `theme-presets.ts`; record fonts, palette, spacing as ux-canon inputs. Cite beautifului.dev/license as MIT copy-paste primitives and a source, not a registry → verify: grep -F -q "TOKEN-CONTRACT.md" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md && grep -F -q "theme-presets.ts" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md && grep -F -q "source, not a registry" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
          description:
            'Map the approved mobile stack to shadcn_flutter with shared web token names, Compose Material 3 with translated color/typography/shape tokens, or react-native-reusables, retaining the official/package source for each mapping and the same ux-canon fonts/palette/spacing inputs → verify: grep -F -q "shadcn_flutter" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md && grep -F -q "Material 3" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md && grep -F -q "react-native-reusables" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
          description:
            'For Blade, call `zeroh-design:blade-design` Path 2 to materialise DESIGN.md, PRINCIPLES.md, globals.css; greenfield writes only bindingDesignSystem, ux-canon, and ADR pointers. If absent, print the install command and STOP before tokens → verify: grep -F -q "zeroh-design:blade-design" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md && grep -F -q "/plugin install zeroh-design@zeroh-marketplace" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md && grep -F -q "designHomes.ux.bindingDesignSystem" plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
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
            'Score the finished skill rule-by-rule against `plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md` R1–R28, use PASS/FAIL/N-A plus evidence for every row, fix each FAIL in the skill or matrices reference, and record the final zero-unfixed-FAIL table in task 30.4 transparencyReport beside phase 29\'s skill grades. Re-run R17 against both callers and R21 against every cited URL/path → verify: test "$(sed -n \'/^---$/,/^---$/!p\' plugins/zeroh-greenfield/skills/stack-decision/SKILL.md | wc -l)" -le 200 && grep -F -q "Not this skill:" plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
        },
      ],
      acceptanceCriteria: [
        'Task 30.4 transparencyReport contains 28 labeled verdict rows with evidence and zero unfixed FAILs.',
        'The finished workflow body is at most 200 lines; its matrix is loaded from the cited one-level reference; every URL/path resolves; both phase-29 caller boundaries assign ADR prose to stack-decision.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
        'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
        'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
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
    'interview: skipped — GREENFIELD.arc.ts records the parent arc interview and dated user rulings on 2026-09-03; this member implements its decisions plane. userFacing false: these are model-loaded skills and consumer-dropped templates, with no application runtime surface, so no feature flag applies. testMode none for all tasks under skills/using-zeroh-roadmap/references/test-worthiness.md: markdown skills/templates are declarative artifacts; exact step greps and the R1–R28 review are their checks. reviewScope full because this phase introduces a new callable skill and cross-skill output seam. Timing cohort read from roadmap/arc-evals/timing-stats.json. Plan-time source probes on 2026-09-03: HTTP 200 for Next.js, Vite, Remix, Nx, Turborepo, pnpm workspaces, NestJS, Hono, Fastify, shadcn Tailwind-v4/components.json/namespace/registry index, pub.dev shadcn_flutter, Android Compose Material 3, Expo create-project, registry.directory docs, and beautifului.dev/license; npm exposed @react-native-reusables/cli while react-native-reusables.com DNS returned no host, so the plan requires the npm/GitHub source rather than that dead domain. The fetched shadcn registry index contained healthy named entries including @1st-pouf, @23rd, @7ovr, @8bitcn, @aceternity, @ai-elements, and @assistant-ui; execution selects at least two fitting entries by exact fetched name+URL and records the fetch evidence, with no invented namespace. Assumption probes all exited 0: the arc one-owner line, Blade Path 2 plus globals.css contract, both absolute zeroh prior-art files, and R1/R28 quality-bar anchors. Verify rehearsal: every step verify exited non-zero now because phase 29 has not yet produced plugins/zeroh-greenfield; each failure was the exact planned file absence. No negative grep is used. Duplicate probes for stack-decision and design-system.md returned no hits in roadmap/phases or backlog.ts before authoring and are re-run at closure.',
})
