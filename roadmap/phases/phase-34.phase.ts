import { definePhase } from '@/lib/roadmap/schema'

/**
 * GREENFIELD's keystone lands the missing-home remedy seam, packages the plugin, grades its
 * four model-loaded entry points, and records honest end-to-end evidence from empty and mature
 * repositories. Phases 29-33 create every consumed plugin path before this final plane runs.
 *
 * timing: band 4-6 × surface:false, N=7; recalibrate after CI/release generation lands
 */
export default definePhase({
  phase: 34,
  name: 'GREENFIELD keystone: packaging, dry-run evidence, and shard-ready delivery',
  plannedBy: { model: 'gpt-5.6-sol' },
  status: 'backlog',
  category: 'feature',
  kind: 'hardening',
  source:
    'GREENFIELD arc plane seam-packaging-validation; execution prompt §Design items 7-8; brief 34; and the 2026-09-04 ruling that greenfield establishes affected PR, sharded full CI, and build-once release strategy.',
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
    'plugins/zeroh-greenfield/skills/greenfield-init/references/ci-release-strategy.md',
    'plugins/zeroh-greenfield/templates/scripts/ci-shard-plan.mjs',
    'plugins/zeroh-greenfield/templates/github/workflows/ci.yml',
    'plugins/zeroh-greenfield/templates/github/workflows/release.yml',
    'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
    'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md',
    'plugins/zeroh-greenfield/DRYRUN-2026-09.md',
  ],
  stakeholderDemo:
    'An approved scratch repo proves the four-skill workflow, affected local gates, deterministic full-suite shards with merged evidence, and an exact-commit content-addressed artifact promoted through release without rebuilding.',
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
            'After `## Scaffolding`, add `## Missing homes` as the sole remedy owner: preserve each caller\'s STOP/infer behavior, name `/plugin install zeroh-greenfield@zeroh-marketplace`, say when the plugin is not installed, and delegate home authoring plus pointer writes to `brownfield-audit`; never authorize inline home creation. → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md',
          description:
            'Append exactly `(remedy: using-zeroh-roadmap/references/layout.md §Missing homes)` without changing behavior at the six named STOP/fallback/infer anchors in design-gate.md, plan-arc/SKILL.md, ux-designer.md, software-architect.md, test-engineer.md, and test-strategy/SKILL.md. → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/README.md',
          description:
            'Replace the false first-session auto-detection claim with the actual `roadmap init` scaffold path and the §Missing homes zeroh-greenfield/brownfield-audit remedy. → verify: bash -c "grep -qF \'roadmap init\' plugins/zeroh-roadmap/README.md && grep -qF \'zeroh-greenfield\' plugins/zeroh-roadmap/README.md && test \"$(grep -c \'On first session, the plugin detects\' plugins/zeroh-roadmap/README.md)\" = \"0\""',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs',
          description:
            'Add a node:test ratchet that reads the owner section and six exact files, requiring the section heading once and the exact pointer once per site; before commit follow do-phase/references/guard-mutation-proof.md and quote planted missing pointer RED, renamed owner heading RED, and an unrelated legal parenthetical GREEN in the transparency report. → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/DIET-LEDGER.md',
          description:
            'Add one 2026-09 ledger row for the six model-loaded-body edits with disposition `no trim — additive remedy pointer`; record the post-edit do-arc measurement and keep it at or below 11065. → verify: bash -c "grep -qF \'no trim — additive remedy pointer\' plugins/zeroh-roadmap/DIET-LEDGER.md && node /home/patrik/zeroh-marketplace/plugins/zeroh-roadmap/bin/roadmap.mjs measure --flow do-arc --assert 11065"',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs passes with one owner section and all six exact pointer clauses, after its three mutation-proof outcomes are quoted in 34.1 transparencyReport.how',
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
            'Create dated/SHA summaries and ordered R1-R28 evidence tables for four skills. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md\',\'utf8\'),a=[\'using-zeroh-greenfield\',\'greenfield-init\',\'brownfield-audit\',\'stack-decision\'];let p=-1;for(const n of a){let i=s.indexOf(\`## ${n}\`),e=s.indexOf(\'## \',i+3),b=s.slice(i,e<0?s.length:e),r=[...b.matchAll(/^\\| (R(?:[1-9]|1\\d|2[0-8])) \\| (?:PASS|N-A: [^|]+) \\| [^|]+ \\|$/gm)].map(m=>m[1]);if(i<=p||r.join()!==Array.from({length:28},(_,k)=>\'R\'+(k+1)).join()||b.includes(\'| FAIL |\'))process.exit(1);p=i}if((s.match(/^\\| (?:using-zeroh-greenfield|greenfield-init|brownfield-audit|stack-decision) \\|/gm)||[]).length!==4)process.exit(1)"',
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
      title: 'Prove native-host runs with inherited authority and machine-bound evidence',
      problem:
        'The arc completion bar requires successful Claude-native and Codex-native scratch runs, but prose-only success markers and permission-bypass flags cannot prove approval ordering, isolation, tree integrity, or idempotence.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/dry-runs/34.4-scripted-answers.md',
          description:
            'Author equivalent Claude and Codex briefs that run only inside a newly created scratch root with inherited/workspace-write authority. Explicitly forbid dangerously-skip-permissions, dangerously-bypass-approvals-and-sandbox, writes outside scratch, live product remotes, and unrecorded network/external actions. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/dry-runs/34.4-scripted-answers.md\',\'utf8\'),need=[\'mobile: none\',\'non-Blade\',\'approval response:\',\'second run:\',\'claude -p\',\'codex exec\',\'workspace-write\',\'AuthorityEnvelope\'];if(need.some(x=>!s.includes(x))||/dangerously-(?:skip-permissions|bypass-approvals-and-sandbox)/.test(s))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs',
          description:
            'Create a fixture driver that records host executable/version, plugin manifest digest, scratch identity, AuthorityEnvelope, ordered approval and first-write events, command exits, before/after tree hashes, diff allowlist, raw transcript SHA-256, and second-run tree equality for empty and brownfield runs; fail closed on missing or copied evidence. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/dry-runs/empty/receipt.json',
          description:
            'Run the empty-repository brief once under each real native host and persist machine receipts plus raw transcript digests; generate the Markdown summary from those receipts rather than accepting authored success strings. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/dry-runs/brownfield/receipt.json',
          description:
            'Run the zeroh-shaped fixture under each real native host, mechanically compute the gap-only diff, prove existing homes byte-identical, rerun, and require identical final trees with zero proposals and writes. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/DRYRUN-2026-09.md',
          description:
            'Generate a compact human report from the four receipts with direct paths and digests; a failed, unavailable, stale-head, authority-expanded, or incomplete arm remains explicit and blocks completion. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'Real Claude-native and Codex-native empty and brownfield arms identify executable/version, plugin digest, scratch root, exact authority, transcript digest, current commit, and command exits.',
        'For every arm, the recorded approval event precedes the first write; the empty tree contains all promised artifacts; brownfield existing homes are byte-identical and its diff is a mechanically computed subset of the approved gap allowlist.',
        'Every second run has zero proposals, zero writes, and the same final tree hash; missing, copied, stale, unavailable, failed, or expanded-authority evidence cannot be reported successful.',
        'No command or generated brief contains a permission/sandbox bypass flag.',
      ],
      files: [
        'plugins/zeroh-greenfield/dry-runs/34.4-scripted-answers.md',
        'plugins/zeroh-greenfield/dry-runs/empty/receipt.json',
        'plugins/zeroh-greenfield/dry-runs/brownfield/receipt.json',
        'plugins/zeroh-greenfield/DRYRUN-2026-09.md',
        'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
      interfaces: { consumes: ['all GREENFIELD outputs from phases 29-34.3'], produces: ['machine-bound native-host dry-run evidence', 'DRYRUN-2026-09.md projection'] },
    },
    {
      id: '34.5',
      title: 'Mutation-prove approval, ownership, routing, and idempotence behavior',
      problem:
        'Substring checks establish document shape but do not prove the behavior-owning skills refuse pre-approval writes, preserve existing homes, stop on absent siblings, or behave identically under Claude and Codex.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-behavior.test.mjs',
          description:
            'Drive deterministic empty and brownfield fixtures through the shared skill contracts; cover no approval, approval after proposal, absent roadmap/design plugin, present/partial/stale/missing homes, generated harness blocks, README additions/orphans, and second-run idempotence. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-behavior.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-behavior.test.mjs',
          description:
            'Plant one mutation at a time for approval-before-write, gap-only action, link-not-replace, exact sibling STOP, single-router dispatch, README drift red, and second-run no-op; compare canonical Claude/Codex outcomes and require every mutation red while the restored contract is green. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-behavior.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'No-approval and absent-sibling cases perform zero writes and return the exact bounded STOP/remedy.',
        'Present homes remain byte-identical; only approved missing/partial/stale gaps change; generated marker blocks survive byte-identically.',
        'README drift turns red, an approved repair turns green, and a repeated run is a no-op.',
        'Claude and Codex projections produce the same typed decisions and artifact set; every planted contract mutation makes the suite red.',
      ],
      files: ['plugins/zeroh-roadmap/test/fixture-consumer/greenfield-behavior.test.mjs'],
      testMode: 'tdd',
      done: false,
      dependsOn: ['34.4'],
      interfaces: { consumes: ['machine-bound native-host dry-run evidence'], produces: ['GREENFIELD behavioral conformance evidence'] },
    },
    {
      id: '34.6',
      title: 'Specify and mutation-prove six-archetype sharded CI plus exact-artifact release',
      problem:
        'A generic workflow over ambiguous project/spec identities cannot guarantee exact-once execution or apply honestly across Nx, web, Expo, Flutter, Gradle Android, and library/CLI estates. CI needs one lifecycle with explicit archetype inventory/executor/report adapters and a complete evidence-to-artifact protocol.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
          description:
            'TDD first with an executable simulated CI/fan-in/release harness. Plant missing, duplicate, red, retried, quarantined, malformed, stale-SHA, expired, ambiguous-producer, coverage-floor, test-count, report-digest, inventory-digest, build-digest, tag-SHA, and rebuild mutations. Validate workflow YAML with a real parser and actionlint when available; unavailable tooling is classified, never green. Record RED. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/ci-release-strategy.md',
          description:
            'Define the shared lifecycle and six adapter rows. Each archetype owns exactly one atomic identity type, canonical inventory command, shard argv, JUnit/coverage format, merge command, and build command: Nx projects; web/Expo test files plus Playwright specs; Flutter test files; Android Gradle modules/tasks; library/CLI node:test files. Unsupported tooling is proposed as unavailable with an install remedy, never counted green. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/scripts/ci-shard-plan.mjs',
          description:
            'Implement versioned deterministic planning over one adapter’s normalized disjoint identities. Sort and reject duplicates; count-balance with an explicit deterministic default weight; define Windows separator normalization, renamed/deleted identities, count=1, count>units with no emitted empty shards, permutation stability, manifest digest, and exact-once union proof between inventory and executed reports. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/github/workflows/ci.yml',
          description:
            'Generate PR affected validation and authoritative main/manual-full validation; nightly diagnoses but cannot become an ambiguous release producer. Full runs create shards, preserve first attempts, allow only bounded infrastructure retry, classify rerun-pass as blocking flaky, require quarantine owner/reason/expiry, always upload compact reports, merge canonical path-remapped coverage once, verify inventory/test-count/floors via approved baseline changes, then emit an attested evidence manifest `{sha,tree,suiteManifestDigest,shardReports,coverageDigest,buildDigest,producerRunId,expiresAt}`. Pin third-party actions to full commit SHA with version comments; use job-level least privilege, no fork secrets, bounded retention, and PR-only cancellation. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/templates/github/workflows/release.yml',
          description:
            'Resolve a tag/manual input to exact SHA; locate exactly one unexpired authoritative evidence manifest for that SHA; verify tree, inventory, shard-report, coverage, build, producer-run, and artifact digests; download and promote those bytes through a protected environment with deploy-job-only OIDC; never build. Missing credentials/evidence, multiple producers, digest drift, stale tag, or skipped promotion is red. Provider deployment remains an approved placeholder. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
        'Every one of six archetype adapters defines one disjoint identity inventory and exact argv/report/coverage/build contract; shard count 1 and >units are valid, and the executed union equals inventory exactly once.',
        'Required-test retries cannot erase first failure; bounded infra retry and quarantine metadata/expiry are enforced; malformed/partial reports, coverage or count regression, and unapproved baseline changes are red.',
        'Exactly one authoritative same-SHA unexpired evidence manifest binds full-suite inventory/reports/coverage to one content-addressed build; release verifies all links and promotes without rebuilding under least privilege and immutable action pins.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/greenfield-init/references/ci-release-strategy.md',
        'plugins/zeroh-greenfield/templates/scripts/ci-shard-plan.mjs',
        'plugins/zeroh-greenfield/templates/github/workflows/ci.yml',
        'plugins/zeroh-greenfield/templates/github/workflows/release.yml',
        'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['34.5'],
      interfaces: { consumes: ['32.5 safe affected/full bindings', 'six archetype manifests'], produces: ['six-adapter shard contract', 'authoritative CI evidence manifest', 'build-once release protocol'] },
    },
    {
      id: '34.7',
      title: 'Wire delivery into approval-gated init and re-prove final native trees',
      problem:
        'Delivery templates are not a GREENFIELD feature until the init workflow proposes, selects, writes, preserves, and verifies them. Earlier native receipts predate CI/release output, so final evidence must be regenerated after delivery wiring.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
          description:
            'Before writes, ask CI provider/release-environment questions and present the selected adapter, exact paths, lifecycle, secret placeholders, and preservation plan for approval. After approval, copy/fill the shard planner and workflows, merge rather than overwrite existing workflows, record commands, then validate. Brownfield collisions STOP for an explicit merge decision. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs plugins/zeroh-roadmap/test/fixture-consumer/greenfield-behavior.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md',
          description:
            'Bind the selected archetype adapter and CI/release files into the existing proposal/copy/validate order; ensure README commands and testCadence backstop point at generated workflow names. A second run proposes and writes nothing. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/dry-runs/empty/receipt.json',
          description:
            'Rerun real Claude-native and Codex-native empty fixtures after 34.6/34.7. Receipts must include selected adapter, workflow/parser exits, shard manifest/evidence schema digests, approval-before-first-write, final tree, and second-run no-op. Failed or unavailable arms remain blocking. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
        },
        {
          file: 'plugins/zeroh-greenfield/dry-runs/brownfield/receipt.json',
          description:
            'Rerun both native hosts on a brownfield fixture with an existing CI workflow. Prove byte preservation before explicit merge approval, bounded merged diff after approval, no secret defaults, valid delivery evidence, and idempotent second run. Regenerate DRYRUN-2026-09.md solely from receipts. → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'CI provider, archetype adapter, workflow paths, release environment, and collision behavior are proposed before any write; existing workflows are never overwritten without explicit merge approval.',
        'Claude and Codex final empty/brownfield receipts include CI/release outputs and machine validation, preserve approved boundaries, and have identical idempotent second-run trees.',
        'All shard/fan-in/release mutations remain red through the actual generated workflow and selected adapter; unavailable external validation is explicit and blocks a green claim.',
        'The stale phase-32 peval is regenerated with five tasks/current keyFiles and the final phase/arc reports supersede every pre-amendment gate artifact.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/pointers.md',
        'plugins/zeroh-greenfield/dry-runs/empty/receipt.json',
        'plugins/zeroh-greenfield/dry-runs/brownfield/receipt.json',
        'plugins/zeroh-greenfield/DRYRUN-2026-09.md',
        'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs',
        'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-behavior.test.mjs',
        'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['34.6'],
      interfaces: { consumes: ['34.6 delivery templates and mutation harness', '34.4 native receipt protocol'], produces: ['approval-gated delivery installation', 'final native GREENFIELD evidence'] },
    },
  ],
  reviewRecord: { date: '2026-09-04', model: 'pending-software-architect-review', verdict: 'NEEDS_WORK', via: 'executed' },
  notes:
    '## Hypotheses\n1. CONFIRMED — The six absent-home sites stop or go silent without naming a remedy because no protocol file owns remedy text. Evidence: plugins/zeroh-roadmap/skills/plan-arc/references/design-gate.md:94; plugins/zeroh-roadmap/skills/plan-arc/SKILL.md:91; plugins/zeroh-roadmap/agents/ux-designer.md:17; plugins/zeroh-roadmap/agents/software-architect.md:44; plugins/zeroh-roadmap/agents/test-engineer.md:14; plugins/zeroh-roadmap/skills/test-strategy/SKILL.md:16.\n2. REFUTED — The README first-session claim is implemented by a hook. Evidence: plugins/zeroh-roadmap/hooks/hooks.json has SessionStart only for session-lane-check.mjs and no scaffold action.\ninterview: skipped — arc member; GREENFIELD.arc.ts records every 2026-09-03 user ruling. userFacing false re-ratified by the GREENFIELD orchestrator ruling 2026-09-03: installable operator guidance is visible but is not a consumer runtime surface, so no flag applies. Full review is required because model-loaded protocols and a guard change. decisionRef: \'GREENFIELD orchestrator ruling 2026-09-03 — protocol-anchor ratchet, tdd\'. The ratchet is the house protocol-anchor pattern: a node:test file under plugins/zeroh-roadmap/cli/lib reads the seven protocol files and asserts one owner heading plus six pointer clauses; testMode tdd is ratified. testMode TDD for 34.4–34.5 is ratified: machine receipts, native-host evidence, negative behavior, semantic parity, and mutations are executable contracts; DRYRUN-2026-09.md is only their projection. A failed dry run escalates with transcript and blocks phase completion. Out of scope: skill-body changes beyond fixes needed for all R1-R28 grades to PASS. Planned phase-29–33 paths are consumed only after dependency order makes them real. Review repairs round 2 2026-09-03 (orchestrator, mechanical): 34.3 grade checker asserts the exact ordered R1..R28 id vector per skill; 34.1 test verifies run through the host capbuild wrapper. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): added mandatory hypotheses; ratified the protocol-anchor TDD seam; asserted every packaging field and ownership boundary; asserted four skill summaries, 112 verdict rows, byte/token equality, and caps; made four real native-host arms with inherited authority, machine receipts, behavioral mutations, config and idempotence proof the completion bar.',
})
