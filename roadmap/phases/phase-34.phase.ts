import { definePhase } from '@/lib/roadmap/schema'

/**
 * GREENFIELD's keystone lands the missing-home remedy seam, packages the plugin, grades its
 * four model-loaded entry points, and records honest end-to-end evidence from empty and mature
 * repositories. Phases 29-33 create every consumed plugin path before this final plane runs.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 34,
  name: 'GREENFIELD keystone: missing-home remedy, packaging, skill grades, and dry-run evidence',
  plannedBy: { model: 'gpt-5.6-sol' },
  status: 'backlog',
  category: 'feature',
  kind: 'hardening',
  source:
    'GREENFIELD arc plane seam-packaging-validation; roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design items 7-8 and .building/greenfield-briefs/34.md.',
  priority: 'HIGH',
  arcId: 'GREENFIELD',
  dependsOn: [29, 30, 31, 32, 33],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/layout.md',
    'plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs',
    '.claude-plugin/marketplace.json',
    'plugins/zeroh-greenfield/.codex-plugin/plugin.json',
    'plugins/zeroh-greenfield/README.md',
    'plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md',
    'plugins/zeroh-greenfield/dry-runs/34.4-scripted-answers.md',
    'plugins/zeroh-greenfield/DRYRUN-2026-09.md',
  ],
  stakeholderDemo:
    'A missing roadmap design or test home names zeroh-greenfield as the one setup remedy, and installable Claude/Codex packaging plus dated empty- and brownfield-run evidence proves the four-skill workflow.',
  userFacing: false,
  reviewScope: 'full',
  assumptions: [
    {
      claim: 'All six missing-home call sites retain the exact STOP or infer behavior that task 34.1 only annotates.',
      verify:
        'bash -c "grep -qF \"surface that and STOP\" plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md && grep -qF \"absent key -> surface it and STOP the gate\" plugins/zeroh-roadmap/skills/plan-arc/SKILL.md && grep -qF \"surface that and STOP\" plugins/zeroh-roadmap/agents/ux-designer.md && grep -qF \"fall back to the repo\'s CLAUDE.md architecture sections\" plugins/zeroh-roadmap/agents/software-architect.md && grep -qF \"inferred from <files>\" plugins/zeroh-roadmap/agents/test-engineer.md && grep -qF \"infer from 2-3 existing test files nearest the code under test and say so\" plugins/zeroh-roadmap/skills/test-strategy/SKILL.md"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The zeroh-sdd Codex manifest is the package-less hand-written shape required for zeroh-greenfield packaging.',
      verify:
        'bash -c "grep -qF \"\\\"skills\\\": \\\"./skills/\\\"\" plugins/zeroh-sdd/.codex-plugin/plugin.json && test \"$(grep -c \"\\\"hooks\\\"\" plugins/zeroh-sdd/.codex-plugin/plugin.json)\" = \"0\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The marketplace registry entry shape includes name, description, relative source, category, and tags.',
      verify:
        'node -e "const m=require(\'./.claude-plugin/marketplace.json\');const p=m.plugins.find(x=>x.name===\'zeroh-design\');process.exit(p&&p.description&&p.source&&p.category&&Array.isArray(p.tags)?0:1)"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The pre-phase do-arc protocol load is exactly the enforced 11065-token ceiling.',
      verify:
        'bash -c "out=$(node /home/patrik/zeroh-marketplace/plugins/zeroh-roadmap/bin/roadmap.mjs measure --flow do-arc); code=$?; test $code = 0 && grep -qF \'| **11065** | **44246** | **TOTAL (8 files)** |\' <<<\"$out\""',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '34.1',
      title: 'Route every missing-home branch to one zeroh-greenfield remedy and ratchet the pointers',
      problem:
        'Six protocol sites stop or infer when designHomes, testConventions, or CLAUDE.md conventions are absent, but none names a setup remedy; README also claims an automatic first-session scaffold that the plugin does not perform.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/layout.md',
          description:
            'After `## Scaffolding`, add `## Missing homes` as the sole remedy owner: preserve each caller\'s STOP/infer behavior, name `/plugin install zeroh-greenfield@zeroh-marketplace`, say when the plugin is not installed, and delegate home authoring plus pointer writes to `brownfield-audit`; never authorize inline home creation. → verify: node --test plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md',
          description:
            'Append exactly `(remedy: using-zeroh-roadmap/references/layout.md §Missing homes)` without changing behavior at the six named STOP/fallback/infer anchors in design-gate.md, plan-arc/SKILL.md, ux-designer.md, software-architect.md, test-engineer.md, and test-strategy/SKILL.md. → verify: node --test plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/README.md',
          description:
            'Replace the false first-session auto-detection claim with the actual `roadmap init` scaffold path and the §Missing homes zeroh-greenfield/brownfield-audit remedy. → verify: bash -c "grep -qF \'roadmap init\' plugins/zeroh-roadmap/README.md && grep -qF \'zeroh-greenfield\' plugins/zeroh-roadmap/README.md && test \"$(grep -c \'On first session, the plugin detects\' plugins/zeroh-roadmap/README.md)\" = \"0\""',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs',
          description:
            'Add a node:test ratchet that reads the owner section and six exact files, requiring the section heading once and the exact pointer once per site; before commit follow do-phase/references/guard-mutation-proof.md and quote planted missing pointer RED, renamed owner heading RED, and an unrelated legal parenthetical GREEN in the transparency report. → verify: node --test plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/DIET-LEDGER.md',
          description:
            'Add one 2026-09 ledger row for the six model-loaded-body edits with disposition `no trim — additive remedy pointer`; record the post-edit do-arc measurement and keep it at or below 11065. → verify: bash -c "grep -qF \'no trim — additive remedy pointer\' plugins/zeroh-roadmap/DIET-LEDGER.md && node /home/patrik/zeroh-marketplace/plugins/zeroh-roadmap/bin/roadmap.mjs measure --flow do-arc --assert 11065"',
        },
      ],
      acceptanceCriteria: [
        'node --test plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs passes with one owner section and all six exact pointer clauses, after its three mutation-proof outcomes are quoted in 34.1 transparencyReport.how',
        'node /home/patrik/zeroh-marketplace/plugins/zeroh-roadmap/bin/roadmap.mjs measure --flow do-arc --assert 11065 exits 0 (observed before: 11065 tokens / 44246 bytes)',
        'README names roadmap init and zeroh-greenfield/brownfield-audit, and contains zero copies of `On first session, the plugin detects`',
      ],
      files: [
        'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/layout.md',
        'plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md',
        'plugins/zeroh-roadmap/skills/plan-arc/SKILL.md',
        'plugins/zeroh-roadmap/agents/ux-designer.md',
        'plugins/zeroh-roadmap/agents/software-architect.md',
        'plugins/zeroh-roadmap/agents/test-engineer.md',
        'plugins/zeroh-roadmap/skills/test-strategy/SKILL.md',
        'plugins/zeroh-roadmap/README.md',
        'plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
      ],
      testMode: 'tdd',
      done: false,
      interfaces: { produces: ['layout.md §Missing homes', 'protocol-refs ratchet'], consumes: [] },
    },
    {
      id: '34.2',
      title: 'Publish zeroh-greenfield through both marketplace manifests and document its boundaries',
      problem:
        'Phases 29-33 create a Claude plugin, but the repository marketplace has no zeroh-greenfield entry, Codex has no skills manifest, and users have no install or sibling-plugin boundary guide.',
      steps: [
        {
          file: '.claude-plugin/marketplace.json',
          description:
            'Add one `zeroh-greenfield` entry with non-empty description, exact source/category, and the five ordered tags. → verify: node -e "const f=require(\'fs\'),m=require(\'./.claude-plugin/marketplace.json\'),a=m.plugins.filter(x=>x.name===\'zeroh-greenfield\'),p=a[0],t=[\'greenfield\',\'brownfield\',\'project-init\',\'standards\',\'roadmap\'];if(a.length!==1||!p.description?.trim()||p.source!==\'./plugins/zeroh-greenfield\'||p.category!==\'development\'||JSON.stringify(p.tags)!==JSON.stringify(t)||!f.statSync(p.source).isDirectory())process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/.codex-plugin/plugin.json',
          description:
            'Match fields; add skills, no hooks, four capabilities. → verify: node -e "const c=require(\'./plugins/zeroh-greenfield/.codex-plugin/plugin.json\'),p=require(\'./plugins/zeroh-greenfield/.claude-plugin/plugin.json\'),j=JSON.stringify,s=j(c.interface),n=[\'using-zeroh-greenfield\',\'greenfield-init\',\'brownfield-audit\',\'stack-decision\'];if([\'name\',\'version\',\'author\',\'license\',\'repository\'].some(k=>j(c[k])!==j(p[k]))||c.skills!==\'./skills/\'||\'hooks\' in c||!c.interface?.capabilities?.length||!n.every(x=>s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/README.md',
          description:
            'Add ordered Claude/Codex install sections and `How it relates` with exactly three ownership rows. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/README.md\',\'utf8\'),h=[\'## Claude Code\',\'## Codex\',\'## How it relates\'];let p=-1;for(const x of h){let n=s.indexOf(x);if(n<=p)process.exit(1);p=n}const b=s.slice(p,s.indexOf(\'## \',p+3)<0?s.length:s.indexOf(\'## \',p+3)),r=[\'| zeroh-greenfield | Missing project homes |\',\'| zeroh-roadmap | Consume pointers and run phases |\',\'| zeroh-design | Blade tokens and themes |\'];if(!s.includes(\'zeroh-greenfield@zeroh-marketplace\')||r.some(x=>!b.includes(x))||(b.match(/^\\| zeroh-/gm)||[]).length!==3)process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e verifies exactly one marketplace entry with name, non-empty description, exact source, development category, exact non-empty tag set, and an existing source directory',
        'node -e verifies Codex name/version/author/license/repository parity, `skills: "./skills/"`, no hooks key, non-empty capabilities, and all four skill names in its interface',
        'node -e verifies Claude, Codex, then How it relates heading order plus the install literal and all three exact ownership rows',
      ],
      files: ['.claude-plugin/marketplace.json', 'plugins/zeroh-greenfield/.codex-plugin/plugin.json', 'plugins/zeroh-greenfield/README.md'],
      testMode: 'none',
      done: false,
      interfaces: { consumes: ['zeroh-greenfield .claude-plugin/plugin.json from 29.1'], produces: ['zeroh-greenfield marketplace entry', 'zeroh-greenfield Codex manifest'] },
    },
    {
      id: '34.3',
      title: 'Grade all four skills and establish their measured body-size baseline',
      problem:
        'The four completed skills have no single auditable rule-by-rule SKILL-AUTHORING-STANDARD grade or byte-derived token baseline, so packaging could publish a blocked or already-overweight model-loaded entry point.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md',
          description:
            'Create dated/SHA summaries and ordered R1-R28 evidence tables for four skills. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md\',\'utf8\'),a=[\'using-zeroh-greenfield\',\'greenfield-init\',\'brownfield-audit\',\'stack-decision\'];let p=-1;for(const n of a){let i=s.indexOf(\`## ${n}\`),e=s.indexOf(\'## \',i+3),b=s.slice(i,e<0?s.length:e),r=b.match(/^\\| R(?:[1-9]|1\\d|2[0-8]) \\| (?:PASS|N-A: [^|]+) \\| [^|]+ \\|$/gm)||[];if(i<=p||r.length!==28||b.includes(\'| FAIL |\'))process.exit(1);p=i}if((s.match(/^\\| (?:using-zeroh-greenfield|greenfield-init|brownfield-audit|stack-decision) \\|/gm)||[]).length!==4)process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
          description:
            'Score/fix the router against R1-R28; cap its body at 100 and record exact lines, bytes, integer bytes/4, cap 100, empty FAIL ids, and PASS in its summary row. → verify: node -e "const fs=require(\'fs\'),n=\'using-zeroh-greenfield\',p=\`plugins/zeroh-greenfield/skills/${n}/SKILL.md\`,x=fs.readFileSync(p),s=x.toString(),a=s.split(/\\r?\\n/),k=a.reduce((z,v)=>z+(v===\'---\'),0),lines=a.slice(a.findIndex(v=>v===\'---\',1)+1).length-1,b=x.length,t=Math.floor(b/4),g=fs.readFileSync(\'plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md\',\'utf8\');if(k<2||lines>100||!g.includes(\`| ${n} | ${p} | ${lines} | ${b} | ${t} | 100 | — | PASS |\`))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
          description:
            'Score/fix init against R1-R28; cap its body at 200 and record exact lines, bytes, integer bytes/4, cap 200, empty FAIL ids, and PASS. → verify: node -e "const fs=require(\'fs\'),n=\'greenfield-init\',p=\`plugins/zeroh-greenfield/skills/${n}/SKILL.md\`,x=fs.readFileSync(p),a=x.toString().split(/\\r?\\n/),lines=a.slice(a.findIndex(v=>v===\'---\',1)+1).length-1,b=x.length,t=Math.floor(b/4),g=fs.readFileSync(\'plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md\',\'utf8\');if(lines>200||!g.includes(\`| ${n} | ${p} | ${lines} | ${b} | ${t} | 200 | — | PASS |\`))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
          description:
            'Score/fix audit against R1-R28; cap its body at 200 and record exact lines, bytes, integer bytes/4, cap 200, empty FAIL ids, and PASS. → verify: node -e "const fs=require(\'fs\'),n=\'brownfield-audit\',p=\`plugins/zeroh-greenfield/skills/${n}/SKILL.md\`,x=fs.readFileSync(p),a=x.toString().split(/\\r?\\n/),lines=a.slice(a.findIndex(v=>v===\'---\',1)+1).length-1,b=x.length,t=Math.floor(b/4),g=fs.readFileSync(\'plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md\',\'utf8\');if(lines>200||!g.includes(\`| ${n} | ${p} | ${lines} | ${b} | ${t} | 200 | — | PASS |\`))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
          description:
            'Score/fix stack-decision against R1-R28; cap its body at 100 and record exact lines, bytes, integer bytes/4, cap 100, empty FAIL ids, and PASS. → verify: node -e "const fs=require(\'fs\'),n=\'stack-decision\',p=\`plugins/zeroh-greenfield/skills/${n}/SKILL.md\`,x=fs.readFileSync(p),a=x.toString().split(/\\r?\\n/),lines=a.slice(a.findIndex(v=>v===\'---\',1)+1).length-1,b=x.length,t=Math.floor(b/4),g=fs.readFileSync(\'plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md\',\'utf8\');if(lines>100||!g.includes(\`| ${n} | ${p} | ${lines} | ${b} | ${t} | 100 | — | PASS |\`))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e asserts four fixed-order skill sections, exactly 28 R1-R28 rows in each section, exactly four summary rows, evidence cells, and zero FAIL verdicts',
        'each per-skill node -e recomputes body lines, byte length, integer bytes/4, and matches every recorded summary field including cap, empty FAIL ids, and PASS',
        'the same four per-skill checks enforce 100-line caps for router/decision and 200-line caps for init/audit',
      ],
      files: [
        'plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md',
        'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
        'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
        'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
      ],
      testMode: 'none',
      done: false,
      interfaces: { consumes: ['four zeroh-greenfield SKILL.md bodies from phases 29-33'], produces: ['SKILL-AUTHORING-GRADES.md baseline'] },
    },
    {
      id: '34.4',
      title: 'Prove successful empty-repository and idempotent brownfield dry runs',
      problem:
        'The arc completion bar requires two successful headless scratch runs. A failed run is not evidence of completion: preserve its transcript in executionResult with status escalated, then stop the phase until approval ordering, artifacts, green config, bounded brownfield diff, and second-run idempotence all pass.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/dry-runs/34.4-scripted-answers.md',
          description:
            'Author both scripted briefs. Include `cd <scratch>; ROADMAP_EXECUTOR_PHASE=34 CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude -p --model <model> --dangerously-skip-permissions < brief.md > run.log` or `codex exec --dangerously-bypass-approvals-and-sandbox -m gpt-5.6-sol -C <scratch> - < brief.md > run.log`. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/dry-runs/34.4-scripted-answers.md\',\'utf8\');for(const x of [\'mobile: none\',\'non-Blade\',\'approval response:\',\'second run:\',\'claude -p\',\'codex exec\'])if(!s.includes(x))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/DRYRUN-2026-09.md',
          description:
            'Run the empty brief in fresh scratch and record success evidence. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/DRYRUN-2026-09.md\',\'utf8\'),h=[\'## Empty web dry run\',\'### Proposal before write\',\'Writes before approval: 0\',\'### Approval line\',\'### Resulting tree\',\'Artifacts: PRD,ADR,AGENTS,CLAUDE,CODE-STYLE,architecture,ux-canon,README,roadmap.config\',\'### README and catalog\',\'### roadmap config check\',\'Exit code: 0\',\'Status: SUCCEEDED\'];let p=-1;for(const x of h){let n=s.indexOf(x,p+1);if(n<=p)process.exit(1);p=n}"',
        },
        {
          file: 'plugins/zeroh-greenfield/DRYRUN-2026-09.md',
          description:
            'Run the zeroh fixture; failure escalates with run.log and blocks completion. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/DRYRUN-2026-09.md\',\'utf8\'),h=[\'## Zeroh-shaped brownfield dry run\',\'### Expected versus observed gaps\',\'### Approval line\',\'Writes before approval: 0\',\'### Diff allowlist\',\'Allowlist verdict: PASS\',\'Existing-home changes: 0\',\'### roadmap config check\',\'Exit code: 0\',\'### Second run\',\'Proposals: 0\',\'Diff files: 0\',\'Status: SUCCEEDED\'];let p=-1;for(const x of h){let n=s.indexOf(x,p+1);if(n<=p)process.exit(1);p=n}if(/Status: FAILED|status: completed-with-failure/.test(s))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'node -e asserts the empty run evidence headings in contract order, a proposal-before-write transcript, approval line, resulting artifacts/tree, README/catalog evidence, green roadmap config check output, and `Status: SUCCEEDED`',
        'node -e asserts the brownfield expected/observed gap table, approval line, diff allowlist, zero existing-home changes, green config output, and `Status: SUCCEEDED`',
        'node -e asserts the brownfield second run records `Proposals: 0` and `Diff files: 0`, while any failed run requires executionResult.status `escalated` with its transcript and cannot complete phase 34',
      ],
      files: ['plugins/zeroh-greenfield/dry-runs/34.4-scripted-answers.md', 'plugins/zeroh-greenfield/DRYRUN-2026-09.md'],
      testMode: 'none',
      done: false,
      interfaces: { consumes: ['all GREENFIELD outputs from phases 29-34.3'], produces: ['DRYRUN-2026-09.md evidence'] },
    },
  ],
  notes:
    '## Hypotheses\n1. CONFIRMED — The six absent-home sites stop or go silent without naming a remedy because no protocol file owns remedy text. Evidence: plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md:94; plugins/zeroh-roadmap/skills/plan-arc/SKILL.md:91; plugins/zeroh-roadmap/agents/ux-designer.md:17; plugins/zeroh-roadmap/agents/software-architect.md:44; plugins/zeroh-roadmap/agents/test-engineer.md:14; plugins/zeroh-roadmap/skills/test-strategy/SKILL.md:16.\n2. REFUTED — The README first-session claim is implemented by a hook. Evidence: plugins/zeroh-roadmap/hooks/hooks.json has SessionStart only for session-lane-check.mjs and no scaffold action.\ninterview: skipped — arc member; GREENFIELD.arc.ts records every 2026-09-03 user ruling. userFacing false re-ratified by the GREENFIELD orchestrator ruling 2026-09-03: installable operator guidance is visible but is not a consumer runtime surface, so no flag applies. Full review is required because model-loaded protocols and a guard change. decisionRef: \'GREENFIELD orchestrator ruling 2026-09-03 — protocol-anchor ratchet, tdd\'. The ratchet is the house protocol-anchor pattern: a node:test file under plugins/zeroh-roadmap/cli/lib reads the seven protocol files and asserts one owner heading plus six pointer clauses; testMode tdd is ratified. testMode none for 34.4 is ratified: its evidence is the transcript and artifacts in DRYRUN-2026-09.md. A failed dry run escalates with transcript and blocks phase completion. Out of scope: skill-body changes beyond fixes needed for all R1-R28 grades to PASS. Planned phase-29–33 paths are consumed only after dependency order makes them real. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): added mandatory hypotheses; ratified the protocol-anchor TDD seam; asserted every packaging field and ownership boundary; asserted four skill summaries, 112 verdict rows, byte/token equality, and caps; made two successful headless dry runs with config and idempotence proof the completion bar.',
})
