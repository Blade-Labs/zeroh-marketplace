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
            'Add `zeroh-greenfield` beside the zeroh entries using the zeroh-design object shape, category `development`, source `./plugins/zeroh-greenfield`, and tags `greenfield`, `brownfield`, `project-init`, `standards`, `roadmap`. → verify: node -e "const fs=require(\'fs\');const m=JSON.parse(fs.readFileSync(\'.claude-plugin/marketplace.json\'));const p=m.plugins.find(x=>x.name===\'zeroh-greenfield\');process.exit(p&&p.category===\'development\'&&fs.statSync(p.source).isDirectory()?0:1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/.codex-plugin/plugin.json',
          description:
            'Hand-author the zeroh-sdd Codex manifest shape with `skills: "./skills/"`, no hooks key, and version `0.1.0` equal to `.claude-plugin/plugin.json`; carry the same identity, license, repository, interface, and four-skill capability copy. → verify: node -e "const c=require(\'./plugins/zeroh-greenfield/.codex-plugin/plugin.json\'),p=require(\'./plugins/zeroh-greenfield/.claude-plugin/plugin.json\');process.exit(c.version===p.version&&c.skills===\'./skills/\'&&!Object.hasOwn(c,\'hooks\')?0:1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/README.md',
          description:
            'Add Claude and Codex installation/use instructions plus `How it relates` boundaries: zeroh-greenfield authors missing project homes, zeroh-roadmap consumes their pointers and runs phases, and zeroh-design exclusively owns Blade tokens/themes. Follow skills/using-zeroh-roadmap/references/documentation-rules.md. → verify: bash -c "grep -qF \'zeroh-greenfield@zeroh-marketplace\' plugins/zeroh-greenfield/README.md && grep -qF \'zeroh-roadmap\' plugins/zeroh-greenfield/README.md && grep -qF \'zeroh-design\' plugins/zeroh-greenfield/README.md"',
        },
      ],
      acceptanceCriteria: [
        'node parses .claude-plugin/marketplace.json, finds one zeroh-greenfield entry whose category is development, and stat confirms its source directory exists',
        'the Claude and Codex plugin manifests both report version 0.1.0; Codex exposes ./skills/ and has no hooks key',
        'README gives install/use commands and assigns missing homes, roadmap execution, and Blade token ownership to exactly one named plugin each',
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
            'Create the plugin-root grade home with measurement date and HEAD SHA, then a fixed-order table for `using-zeroh-greenfield`, `greenfield-init`, `brownfield-audit`, `stack-decision`: Skill, Path, Body lines, Bytes, ≈Tokens (bytes/4), R7 cap, FAILs (rule ids), Grade; append an R1-R28 PASS/FAIL/N-A matrix with evidence paths and zero FAIL rows after fixes. Follow skills/using-zeroh-roadmap/references/documentation-rules.md. → verify: bash -c "grep -qF \'| Skill | Path | Body lines | Bytes | ≈Tokens (bytes/4) | R7 cap | FAILs (rule ids) | Grade |\' plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md && test \"$(grep -c \'| FAIL |\' plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md)\" = \"0\""',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
          description:
            'Score and fix the router against every R-rule in plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md; classify it as reference with R7 cap 100 and record its body lines, `wc -c` bytes, and integer bytes/4 tokens in the grade home. → verify: awk \'BEGIN{f=0;n=0} /^---$/{f++;next} f>=2{n++} END{exit !(n<=100)}\' plugins/zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
          description:
            'Score and fix the init workflow against every R-rule; classify it as multi-stage with R7 cap 200 and record body lines, `wc -c` bytes, and integer bytes/4 tokens in the grade home. → verify: awk \'BEGIN{f=0;n=0} /^---$/{f++;next} f>=2{n++} END{exit !(n<=200)}\' plugins/zeroh-greenfield/skills/greenfield-init/SKILL.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
          description:
            'Score and fix the audit workflow against every R-rule; classify it as multi-stage with R7 cap 200 and record body lines, `wc -c` bytes, and integer bytes/4 tokens in the grade home. → verify: awk \'BEGIN{f=0;n=0} /^---$/{f++;next} f>=2{n++} END{exit !(n<=200)}\' plugins/zeroh-greenfield/skills/brownfield-audit/SKILL.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
          description:
            'Score and fix the decision reference against every R-rule; classify it as reference with R7 cap 100 and record body lines, `wc -c` bytes, and integer bytes/4 tokens in the grade home. → verify: awk \'BEGIN{f=0;n=0} /^---$/{f++;next} f>=2{n++} END{exit !(n<=100)}\' plugins/zeroh-greenfield/skills/stack-decision/SKILL.md',
        },
      ],
      acceptanceCriteria: [
        'SKILL-AUTHORING-GRADES.md has four fixed-order summary rows and 28 rule rows per skill with evidence; every final grade is PASS and grep finds zero `| FAIL |` cells',
        'for each of the four SKILL.md paths, the recorded Bytes equals wc -c, ≈Tokens equals integer Bytes/4, and recorded Body lines excludes frontmatter',
        'router and stack-decision bodies are at most 100 lines; greenfield-init and brownfield-audit bodies are at most 200 lines',
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
      title: 'Record empty-repository and idempotent brownfield dry runs from this worktree',
      problem:
        'The arc criteria require real standards-first and beautiful-by-default evidence, but no dated transcript proves the plugin waits for approval, emits resolvable roadmap pointers, limits brownfield edits to gaps, or proposes nothing on a second run.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/DRYRUN-2026-09.md',
          description:
            'In session scratch, drive this lane\'s model headlessly through `using-zeroh-greenfield` with a scripted web brief (`mobile: none`, non-Blade); record date, transcript, proposals, approval line, resulting tree, README/catalog evidence, exact `roadmap config check` output, or the exact failure without claiming PASS. Follow skills/using-zeroh-roadmap/references/documentation-rules.md. → verify: bash -c "grep -qF \'## Empty web dry run\' plugins/zeroh-greenfield/DRYRUN-2026-09.md && grep -qF \'mobile: none\' plugins/zeroh-greenfield/DRYRUN-2026-09.md && grep -qF \'roadmap config check\' plugins/zeroh-greenfield/DRYRUN-2026-09.md"',
        },
        {
          file: 'plugins/zeroh-greenfield/DRYRUN-2026-09.md',
          description:
            'Copy `plugins/zeroh-greenfield/fixtures/zeroh-shaped/` into session scratch, drive `brownfield-audit`, and record the observed gap table beside the fixture expected table, approval line, `git diff --name-only` limited to gap files plus README/config, then a second-run transcript showing no changes proposed; record any incomplete run with WHY. → verify: bash -c "grep -qF \'## Zeroh-shaped brownfield dry run\' plugins/zeroh-greenfield/DRYRUN-2026-09.md && grep -qF \'## Second run\' plugins/zeroh-greenfield/DRYRUN-2026-09.md && grep -qF \'no changes proposed\' plugins/zeroh-greenfield/DRYRUN-2026-09.md"',
        },
      ],
      acceptanceCriteria: [
        'DRYRUN-2026-09.md records the empty-web brief, proposal-before-write transcript, approval line, resulting tree, non-Blade design artifacts, and roadmap config check output, or a dated explicit failure reason',
        'the brownfield record compares observed versus expected gaps and lists a diff containing only gap files, README, and roadmap config; no existing fixture home appears in that diff',
        'the brownfield second run records `no changes proposed`, or a dated explicit failure reason that does not claim idempotence passed',
      ],
      files: ['plugins/zeroh-greenfield/DRYRUN-2026-09.md'],
      testMode: 'none',
      done: false,
      interfaces: { consumes: ['all GREENFIELD outputs from phases 29-34.3'], produces: ['DRYRUN-2026-09.md evidence'] },
    },
  ],
  notes:
    'interview: skipped — arc member; GREENFIELD.arc.ts records the 2026-09-03 interview and locked decisions. No feature flag applies: this phase changes plugin protocol/docs/packaging and records dry-run evidence; it does not ship a consumer runtime surface. Full review is required because the phase edits model-loaded protocol bodies and adds a tree-shape guard. Architect Decision Contract: software-architect resolved via claude-fable-5 child-cli and returned PROCEED_WITH_TASK, locking plugins/zeroh-greenfield/SKILL-AUTHORING-GRADES.md plus the eight-column summary and bytes/4 measurement. Two earlier child-cli transport attempts completed without returning captured output; neither supplied a verdict; the third firing supplied the recorded verdict. Out of scope: changes to the four skill bodies beyond fixes required to turn their R1-R28 grades PASS; any broader redesign returns to the owning phase. Planned dependencies may be absent in this isolated planning lane but are guaranteed by GREENFIELD plane order before phase 34 executes.',
})
