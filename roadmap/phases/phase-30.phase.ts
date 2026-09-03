import { definePhase } from '@/lib/roadmap/schema'

/** GREENFIELD decisions plane: three tasks; phase 34.3 owns durable four-skill grading. */
export default definePhase({
  phase: 30,
  name: 'Stack decisions, ADR templates, and design-system bindings for zeroh-greenfield',
  plannedBy: { model: 'gpt-5.6-sol' },
  status: 'backlog', category: 'feature', kind: 'logic', priority: 'HIGH',
  source: 'GREENFIELD arc entity roadmap/arcs/GREENFIELD.arc.ts and roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design items 1 and 4 plus §Research digest.',
  dependsOn: [29], conflictsWith: [], arcId: 'GREENFIELD', userFacing: false,
  testScope: 'static', reviewScope: 'full', created: '2026-09-03',
  keyFiles: [
    'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
    'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md',
    'plugins/zeroh-greenfield/templates/docs/adr/0001-tech-stack.md',
    'plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md',
  ],
  stakeholderDemo: 'Three tasks deliver sourced stack matrices, populated ADR alternatives, and web/mobile/Blade bindings; phase 34.3 later grades all four completed skills.',
  assumptions: [
    { claim: 'The arc assigns ADR text to stack-decision.', verify: "grep -F -q 'One ADR author: stack-decision owns the tech-stack and design-system ADR text' roadmap/arcs/GREENFIELD.arc.ts", onFalse: 'ESCALATE' },
    { claim: 'zeroh-design Path 2 exists.', verify: "grep -F -q 'Path 2 — No project files, theme and stack inferred' plugins/zeroh-design/skills/blade-design/SKILL.md", onFalse: 'ESCALATE' },
    { claim: 'Zeroh token prior art exists.', verify: 'test -f /home/patrik/zeroh/apps/website/docs/TOKEN-CONTRACT.md && test -f /home/patrik/zeroh/packages/generators/src/generators/theme-presets.ts', onFalse: 'ESCALATE' },
  ],
  tasks: [
    {
      id: '30.1', title: 'Own sourced stack matrices and the one-question ruling contract',
      problem: 'Without a fixed matrix grammar, API gate, and boundaries, callers can preselect mobile or invent sources.',
      steps: [
        { file: 'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md', description: "Author five matrices with ≥2 populated sourced rows; Mobile has exactly three. → verify: bash -c 'node -e \"let s=require(\\\"fs\\\").readFileSync(\\\"plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md\\\",\\\"utf8\\\"),H=[...s.matchAll(/^## (.+)/gm)];for(let n of [\\\"Web\\\",\\\"Mobile\\\",\\\"Monorepo\\\",\\\"Library-CLI\\\",\\\"Backend\\\"]){let a=H.filter(x=>x[1]===n),r=s.slice(a[0]?.index,H.find(x=>x.index>a[0]?.index)?.index||s.length).split(\\\"\\\\n|\\\").slice(3);if(a.length!==1||r.length!==(n===\\\"Mobile\\\"?3:r.length)||r.length<2||r.some(x=>!(/^\\\\S[^|]*\\\\|\\\\S[^|]*\\\\|\\\\S[^|]*\\\\|\\\\S[^|]*\\\\|\\\\S[^|]*\\\\| (https?:\\\\/\\\\/\\\\S+|[@a-z0-9][a-z0-9._\\\\/-]*) \\\\|$/.test(x)))||n===\\\"Mobile\\\"&&![\\\"Flutter\\\",\\\"Kotlin\\\",\\\"Expo\\\"].every(x=>r.some(y=>y.includes(x))))process.exit(1)}\"'" },
        { file: 'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md', description: "Define the exact selection, API gate, boundary, and output contracts. → verify: bash -c 'node -e \"const s=require(\\\"fs\\\").readFileSync(\\\"plugins/zeroh-greenfield/skills/stack-decision/SKILL.md\\\",\\\"utf8\\\"),a=[\\\"Ask exactly one selection question per applicable matrix.\\\",\\\"Do not preselect any option before the user answers.\\\",\\\"The backend matrix is presented ONLY when the PRD answers name an API.\\\",\\\"<YYYY-MM-DD>: <selected option> — <reason>\\\",\\\"greenfield-init\\\",\\\"phase 33 authors the brownfield-audit side\\\",\\\"adrPath\\\",\\\"rulingLine\\\"];if(a.some(x=>!s.includes(x)))process.exit(1)\"'" },
      ],
      acceptanceCriteria: ['The matrix check asserts every heading, header, row count, populated field, valid URL/package source, and all three named mobile choices.', 'The skill check asserts the exact one-question, no-preselection, Backend API gate, dated ruling, caller boundary, adrPath, and rulingLine contracts.'],
      files: ['plugins/zeroh-greenfield/skills/stack-decision/SKILL.md', 'plugins/zeroh-greenfield/skills/stack-decision/references/matrices.md'], testMode: 'none',
      interfaces: { consumes: [], produces: ['zeroh-greenfield:stack-decision', 'matrix row: option | pros | cons | better when | component reuse | source', 'StackDecisionOutput.adrPath', 'StackDecisionOutput.rulingLine'] }, done: false,
    },
    {
      id: '30.2', title: 'Preserve sourced ADR alternatives and rulings',
      problem: 'The expensive decisions need ordered ADRs with real alternatives, sources, consequences, and revisit conditions.',
      steps: [
        { file: 'plugins/zeroh-greenfield/templates/docs/adr/0001-tech-stack.md', description: "Create the ordered tech ADR with ≥2 populated sourced options and dated ruling. → verify: bash -c 'node -e \"let s=require(\\\"fs\\\").readFileSync(\\\"plugins/zeroh-greenfield/templates/docs/adr/0001-tech-stack.md\\\",\\\"utf8\\\"),h=\\\"Status,Date,Context,Options,Ruling,Consequences,Revisit when\\\".split(\\\",\\\"),p=-1;for(let x of h){let n=s.indexOf(\\\"## \\\"+x);if(n<=p)process.exit(1);p=n}let r=s.slice(s.indexOf(\\\"## Options\\\"),s.indexOf(\\\"## Ruling\\\")).split(\\\"\\\\n|\\\").slice(3);if(r.length<2||r.some(x=>{let c=x.split(\\\"|\\\").map(y=>y.trim());return c.length!==6||c.some(y=>!y)||!(/^https?:\\\\/\\\\/\\\\S+$/.test(c[5])||/^[@a-z0-9][a-z0-9._\\\\/-]*$/.test(c[5]))})||!s.includes(\\\"<YYYY-MM-DD>\\\"))process.exit(1)\"'" },
        { file: 'plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md', description: "Create ordered headings and cited shadcn/ui, Radix Themes, and MUI rows plus dated ruling and Blade rule. → verify: bash -c 'node -e \"let s=require(\\\"fs\\\").readFileSync(\\\"plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md\\\",\\\"utf8\\\"),p=-1;for(let x of \\\"Status,Date,Context,Options,Ruling,Consequences,Revisit when\\\".split(\\\",\\\")){let n=s.indexOf(\\\"## \\\"+x);if(n<=p)process.exit(1);p=n}let r=s.slice(s.indexOf(\\\"## Options\\\"),s.indexOf(\\\"## Ruling\\\")).split(\\\"\\\\n|\\\").slice(3);if(r.length<2||[\\\"shadcn/ui\\\",\\\"Radix Themes\\\",\\\"MUI\\\"].some(n=>!r.some(x=>x.includes(n)))||r.some(x=>!(/^https?:\\\\/\\\\/\\\\S+ \\\\|$/.test(x)||/ [@a-z0-9][a-z0-9._\\\\/-]* \\\\|$/.test(x)))||![\\\"<YYYY-MM-DD>\\\",\\\"For Blade, store pointers only; tokens are owned by zeroh-design.\\\"].every(x=>s.includes(x)))process.exit(1)\"'" },
      ],
      acceptanceCriteria: ['Both checks assert fixed heading order, ≥2 populated option rows, valid sources, and dated rulings.', 'The design ADR names cited shadcn/ui, Radix Themes, and MUI alternatives and the exact Blade pointer-only rule.'],
      files: ['plugins/zeroh-greenfield/templates/docs/adr/0001-tech-stack.md', 'plugins/zeroh-greenfield/templates/docs/adr/0002-design-system.md'], testMode: 'none', dependsOn: ['30.1'],
      interfaces: { consumes: ['matrix row: option | pros | cons | better when | component reuse | source'], produces: ['templates/docs/adr/0001-tech-stack.md', 'templates/docs/adr/0002-design-system.md'] }, done: false,
    },
    {
      id: '30.3', title: 'Bind web, mobile, tokens, registries, and Blade handoff',
      problem: 'The init reference must produce beautiful defaults and mobile parity without creating a second Blade token owner.',
      steps: [
        { file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md', description: "Assert shadcn/ui, Tailwind v4, four init keys, registry URL form, and no legacy config string. → verify: bash -c 'node -e \"const s=require(\\\"fs\\\").readFileSync(\\\"plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md\\\",\\\"utf8\\\");for(const x of [\\\"shadcn/ui\\\",\\\"Tailwind v4\\\",\\\"style\\\",\\\"baseColor\\\",\\\"cssVariables\\\",\\\"iconLibrary\\\",\\\"registries\\\"])if(!s.includes(x))process.exit(1);if(!(/https:\\\\/\\\\/[^\\\\s\\\"]+\\\\/r\\\\//.test(s)||/@[-a-z0-9_]+\\\\//i.test(s))||s.includes(\\\"tailwind.config\\\"))process.exit(1)\"'" },
        { file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md', description: "Assert the byte-difference guard, ux-canon inputs, and beautifului.dev MIT placement tier heading. → verify: bash -c 'node -e \"const s=require(\\\"fs\\\").readFileSync(\\\"plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md\\\",\\\"utf8\\\"),a=[\\\"The byte-check guard fails when generated CSS bytes differ from the token source projection.\\\",\\\"fonts | palette | spacing | ux-canon\\\",\\\"external-assets-licensing.md §The tiers\\\",\\\"## beautifului.dev — MIT — Allowed anywhere\\\"];if(a.some(x=>!s.includes(x)))process.exit(1)\"'" },
        { file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md', description: "Assert one populated, validly sourced mobile mapping row per stack with all ux-canon inputs. → verify: bash -c 'node -e \"let s=require(\\\"fs\\\").readFileSync(\\\"plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md\\\",\\\"utf8\\\"),r=s.split(\\\"\\\\n\\\").filter(x=>x.startsWith(\\\"|\\\"));for(let n of [\\\"shadcn_flutter\\\",\\\"Material 3\\\",\\\"react-native-reusables\\\"]){let a=r.filter(x=>x.includes(n));if(a.length!==1||![\\\"ux-canon\\\",\\\"fonts\\\",\\\"palette\\\",\\\"spacing\\\"].every(x=>a[0].includes(x))||!(/^.*\\\\| https?:\\\\/\\\\/\\\\S+ \\\\|$/.test(a[0])||/^.*\\\\| [@a-z0-9][a-z0-9._\\\\/-]* \\\\|$/.test(a[0])))process.exit(1)}\"'" },
        { file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md', description: "Assert zeroh-design:blade-design Path 2, three pointer targets, and the exact STOP sentence. → verify: bash -c 'node -e \"const s=require(\\\"fs\\\").readFileSync(\\\"plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md\\\",\\\"utf8\\\"),a=[\\\"zeroh-design:blade-design\\\",\\\"Path 2\\\",\\\"designHomes.ux.bindingDesignSystem\\\",\\\"ux-canon pointer line\\\",\\\"ADR line\\\",\\\"If zeroh-design is absent, print \\\"+String.fromCharCode(96)+\\\"/plugin install zeroh-design@zeroh-marketplace\\\"+String.fromCharCode(96)+\\\" and STOP.\\\"];if(a.some(x=>!s.includes(x)))process.exit(1)\"'" },
      ],
      acceptanceCriteria: ['Each web invariant is independently asserted: shadcn/ui, Tailwind v4, four init keys, registry URL/namespace form, and no tailwind.config string.', 'The exact byte guard, ux-canon inputs, licensing citation, and beautifului.dev Allowed-anywhere heading are asserted.', 'Every mobile row has a valid source; all three Blade pointers, explicit skill/Path 2 handoff, and STOP sentence are asserted.'],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/design-system.md'], testMode: 'none', dependsOn: ['30.2'],
      interfaces: { consumes: ['templates/docs/adr/0002-design-system.md'], produces: ['skills/greenfield-init/references/design-system.md'] }, done: false,
    },
  ],
  notes: 'interview: skipped — roadmap/arcs/GREENFIELD.arc.ts records every user ruling. userFacing false: declarative skill/template artifacts have no runtime surface, so no flag applies. testMode none follows skills/using-zeroh-roadmap/references/test-worthiness.md; phase 34.4 owns behavioral dry runs. reviewScope full because this is a callable skill seam. Assumption probes exited 0. Verify rehearsal round 3: all eight repaired clauses exited 1 red-before and 0 green-after on conforming scratch copies; nonsense-source mutations exited 1 and adding tailwind.config exited 1. Task 30.4 was removed like phase 29\'s premature grade task: phase 34.3 owns the durable R1-R28 grade for all four completed skills. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): preserved prior boundary and structure rulings. Review repairs 2026-09-03 round 3 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): made quoting safe; tightened sources and Backend gate; required populated sourced ADR alternatives; asserted design invariants; relocated grading to 34.3; replaced the stale brief citation.',
})
