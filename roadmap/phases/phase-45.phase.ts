import { definePhase } from '../../lib/roadmap/schema'

/**
 * NATIVEGREEN documentation plane: publish only behavior proven by phase 43.
 *
 * timing: no reference data for band 7-9×surface:false
 */
export default definePhase({
  phase: 45,
  name: 'Truthful intent-to-green-PR README, guide, orientation, and clean-room onboarding',
  plannedBy: { model: 'gpt-5.6-sol' },
  status: 'backlog',
  category: 'docs',
  kind: 'hardening',
  source:
    'NATIVEGREEN documentation plane; truthful-visual-docs criterion, Disclosure visual canon, phase-43 claim inventory, and plugins/zeroh-roadmap/docs/ux-previews/intent-to-green-pr-visual-guide-layout.md.',
  priority: 'MEDIUM',
  arcId: 'NATIVEGREEN',
  dependsOn: [44],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/docs/doc-projection.json',
    'plugins/zeroh-roadmap/scripts/docs/build.mjs',
    'plugins/zeroh-roadmap/scripts/docs/check.mjs',
    'plugins/zeroh-roadmap/README.md',
    'plugins/zeroh-roadmap/docs/intent-to-green-pr.md',
    'plugins/zeroh-roadmap/docs/orientation.html',
    'plugins/zeroh-roadmap/docs/superpowers-comparison.md',
    'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
  ],
  stakeholderDemo:
    'A senior developer can open GitHub or the offline orientation and understand the proven lifecycle, safe defaults, Claude/Codex installation, recovery, artifacts and a neutral versioned Superpowers comparison in five minutes, with complete keyboard and text access.',
  userFacing: false,
  testScope: 'full',
  reviewScope: 'full',
  assumptions: [
    {
      claim: 'Phase 43 completed with a sealed claim inventory and phase 44 completed its concise-code/provenance gate before user documentation begins.',
      verify:
        'bash -c "grep -Eq \"status:.*done\" docs/roadmap/phases/phase-43.phase.ts && grep -Eq \"status:.*done\" docs/roadmap/phases/phase-44.phase.ts && node plugins/zeroh-roadmap/scripts/gauntlet-3.0/report.mjs --verify-seal plugins/zeroh-roadmap/gauntlet-3.0/results.json"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The Disclosure theme is the ratified visual canon and its local theme instructions remain present.',
      verify:
        'bash -c "test -f plugins/zeroh-design/themes/disclosure/CLAUDE.md && grep -qF \"Disclosure\" docs/roadmap/arcs/NATIVEGREEN.arc.ts"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The existing README and orientation are the established engineer-facing surfaces to evolve rather than replace.',
      verify:
        'bash -c "test -s plugins/zeroh-roadmap/README.md && test -s plugins/zeroh-roadmap/docs/orientation.html && test -s plugins/zeroh-roadmap/docs/ux-previews/intent-to-green-pr-visual-guide-layout.md"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The repository contains no approved local ELI5 invocation contract and NATIVEGREEN explicitly forbids adding one.',
      verify:
        'bash -c "grep -qF \"no local ELI5 skill/invocation copy\" docs/roadmap/arcs/NATIVEGREEN.arc.ts && ! rg -n -i \"/eli5|\\$eli5|invoke eli5\" plugins/zeroh-roadmap/README.md plugins/zeroh-roadmap/docs"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '45.1',
      title: 'Create one evidence-bound documentation projection',
      problem:
        'README, Markdown and HTML currently risk drifting independently; phase 43 provides the only safe feature claims, while manifests and registries own version, support, command and model facts.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/docs/doc-projection.json',
          description:
            'Define the canonical DocProjection data for lifecycle stages, support matrix, install commands, role/driver facts, artifacts, recovery, delivery/history/GC policy, limitations and source links; every behavioral claim references a verified phase-43 claim ID. → verify: node plugins/zeroh-roadmap/scripts/docs/check.mjs --projection-only',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/docs/build.mjs',
          description:
            'Implement loadDocProjection and renderDocumentation so generated fragments for README, the complete Markdown guide and orientation HTML share one fact source while retaining format-specific navigation and progressive disclosure. → verify: node --test --test-name-pattern="render|single source" plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
          description:
            'Add mutation-red checks for unknown/unverified claim IDs, manifest/version/model drift, unsupported capability, missing limitation, duplicate fact ownership and nondeterministic output. → verify: node --test --test-name-pattern="claim|drift|deterministic" plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'Every advertised runtime behavior resolves to a verified phase-43 claim ID; unavailable, unjudged and untested claims cannot render as supported.',
        'Manifest, role/driver registry and command facts are imported or checked against their owning sources rather than recopied as independent truth.',
        'Two consecutive builds are byte-identical and a stale generated surface fails the check command.',
      ],
      files: [
        'plugins/zeroh-roadmap/docs/doc-projection.json',
        'plugins/zeroh-roadmap/scripts/docs/build.mjs',
        'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
      interfaces: { consumes: ['Gauntlet 3 claim inventory'], produces: ['DocProjection', 'renderDocumentation'] },
    },
    {
      id: '45.2',
      title: 'Rewrite the GitHub README as the five-minute truthful entry point',
      problem:
        'The repository landing page must state the actual supported outcome and boundaries without overloading first-time readers or promising merge, repair, harness parity, or automatic behavior beyond phase-43 evidence.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/README.md',
          description:
            'Restructure the README into outcome, support/status, install, quick start, lifecycle, safe defaults, artifacts/recovery, delivery/history/GC, limitations, deeper guides and verification; keep an open green PR as default and distinguish configured merge/queue authority. → verify: node plugins/zeroh-roadmap/scripts/docs/check.mjs --surface readme',
        },
        {
          file: 'plugins/zeroh-roadmap/README.md',
          description:
            'Add text-native Mermaid or fenced fallback diagrams for intent→plan→execute→sweep→validate→normalize→PR→CI repair→exact-head green→eval and for typed halt/resume, each with adjacent prose equivalents and source links. → verify: node plugins/zeroh-roadmap/scripts/docs/check.mjs --diagrams plugins/zeroh-roadmap/README.md',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
          description:
            'Assert heading order, five-minute core length budget, exact default/authority language, current install snippets, complete diagram text equivalents, claim IDs and zero ELI5 invocation text. → verify: node --test --test-name-pattern="README" plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'README tells a senior developer what the plugin does, what is proven, how to install/use it in either parent, what it mutates, and how to recover without requiring HTML.',
        'Default terminal is an open non-draft exact-head green PR; merge/queue is described only as explicit configured authority.',
        'Every diagram has an adjacent complete text equivalent, every behavioral claim is evidence-bound, and no ELI5 invocation instruction appears.',
      ],
      files: ['plugins/zeroh-roadmap/README.md', 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs'],
      testMode: 'tdd',
      done: false,
      dependsOn: ['45.1'],
      interfaces: { consumes: ['DocProjection', 'renderDocumentation'], produces: ['GitHub README projection'] },
    },
    {
      id: '45.3',
      title: 'Publish complete clean-room Claude and Codex onboarding',
      problem:
        'A clean install must be reproducible from repository documentation alone, with parent-specific commands and permission behavior but one semantic workflow and no reliance on this development conversation.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/docs/intent-to-green-pr.md',
          description:
            'Author the complete Markdown guide with prerequisites, Claude and Codex install/update/validate/uninstall, clean-room initialization, intent/arc examples, permissions, artifacts, interruption/resume, PR/CI outcomes, correction policy, history/GC, troubleshooting, limitations and source-of-truth links. → verify: node plugins/zeroh-roadmap/scripts/docs/check.mjs --surface guide',
        },
        {
          file: 'plugins/zeroh-roadmap/docs/intent-to-green-pr.md',
          description:
            'Use parent-specific callouts only for actual capability/provenance differences; map native architect/developer/test/reviewer spawning and typed halt handling to the same semantic role IDs and receipts. → verify: node plugins/zeroh-roadmap/scripts/docs/check.mjs --clean-room-matrix',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
          description:
            'Run snippets in isolated Claude-shaped and Codex-shaped fixtures at the recorded versions, asserting clean second install, one mapping, validator success, no bypass posture, identical semantic receipts, and expected permission holds. → verify: node --test --test-name-pattern="clean-room|Claude|Codex" plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'A reader with no session context can install, validate, initialize, run, pause/resume, inspect artifacts, interpret holds, and uninstall under Claude or Codex.',
        'Clean second installs leave one mapping and both parent walkthroughs yield equivalent semantic receipts except explicitly documented capability/provenance differences.',
        'No example uses dangerously-skip-permissions, bypass-sandbox, or ELI5 invocation text.',
      ],
      files: ['plugins/zeroh-roadmap/docs/intent-to-green-pr.md', 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs'],
      testMode: 'tdd',
      done: false,
      dependsOn: ['45.2'],
      interfaces: { consumes: ['DocProjection', 'GitHub README projection'], produces: ['intent-to-green-pr Markdown guide'] },
    },
    {
      id: '45.4',
      title: 'Document a neutral versioned comparison with Superpowers',
      problem:
        'Users need a factual adjacent-methodology comparison, not marketing claims; volatile Superpowers facts must be versioned, sourced, scoped, and separated from local Gauntlet results.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/docs/superpowers-comparison.md',
          description:
            'Create a version/date/source-pinned comparison of goals, planning unit, execution, agents, TDD/review, persistence/resume, PR/CI delivery, history, cleanup and best-fit use; mark unknown/not-compared explicitly and avoid winner language. → verify: node plugins/zeroh-roadmap/scripts/docs/check.mjs --surface comparison',
        },
        {
          file: 'plugins/zeroh-roadmap/docs/doc-projection.json',
          description:
            'Add comparison metadata with observed versions, retrieval date, primary-source links, neutral vocabulary and expiry/revalidation rule; keep external facts separate from local phase-43 evidence claims. → verify: node plugins/zeroh-roadmap/scripts/docs/check.mjs --comparison-sources',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
          description:
            'Reject unversioned comparisons, superiority adjectives, absent source/date, external claims mapped to Gauntlet IDs, and stale comparison metadata while allowing explicit unknown/not-compared cells. → verify: node --test --test-name-pattern="Superpowers|comparison" plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'Every Superpowers statement is tied to a named version/date and primary source or is explicitly unknown/not compared.',
        'The comparison describes distinct scopes and tradeoffs neutrally and never claims Gauntlet 3 tested Superpowers unless a sealed condition actually did.',
        'Expiry metadata makes future stale comparison content fail the documentation check.',
      ],
      files: [
        'plugins/zeroh-roadmap/docs/superpowers-comparison.md',
        'plugins/zeroh-roadmap/docs/doc-projection.json',
        'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['45.1'],
      interfaces: { consumes: ['DocProjection'], produces: ['versioned Superpowers comparison'] },
    },
    {
      id: '45.5',
      title: 'Generate the Disclosure orientation with progressive disclosure and text parity',
      problem:
        'The existing orientation should become an offline visual explanation without turning HTML into a competing source or reducing access for narrow, keyboard, motion-sensitive, or non-visual readers.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/docs/orientation.html',
          description:
            'Generate the evolved Disclosure-canon page from DocProjection: evidence-led editorial typography, restrained technical diagrams, lifecycle and state views, artifact/recovery map, branch/history/GC panels, support/limitations, comparison link and source provenance. → verify: node plugins/zeroh-roadmap/scripts/docs/build.mjs --check',
        },
        {
          file: 'plugins/zeroh-roadmap/docs/orientation.html',
          description:
            'Implement semantic landmarks, skip link, logical headings, native details/summary disclosure, keyboard-visible focus, 320px reflow, AA token contrast, reduced-motion behavior and complete inline text alternatives with no required script/network dependency. → verify: node plugins/zeroh-roadmap/scripts/docs/check.mjs --accessibility plugins/zeroh-roadmap/docs/orientation.html',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
          description:
            'Assert Markdown/HTML claim and text-equivalent parity, offline assets, no hidden-only facts, first/second-visit disclosure state, 320px overflow guard, keyboard focus, reduced motion and deterministic generation. → verify: node --test --test-name-pattern="orientation|accessibility|offline" plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'Orientation follows the ratified Disclosure canon and remains an enhancement over complete README/Markdown content rather than a separate truth source.',
        'At 320px and desktop, all content and interactions are available by keyboard with visible focus, AA contrast, reduced motion and text alternatives.',
        'The document works offline with no external network dependency and two builds are byte-identical.',
      ],
      files: ['plugins/zeroh-roadmap/docs/orientation.html', 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs'],
      testMode: 'tdd',
      done: false,
      dependsOn: ['45.2', '45.3', '45.4'],
      interfaces: { consumes: ['DocProjection', 'intent-to-green-pr Markdown guide', 'versioned Superpowers comparison'], produces: ['Disclosure orientation HTML'] },
    },
    {
      id: '45.6',
      title: 'Wire documentation drift, snippets, links, accessibility, and clean-room checks into CI',
      problem:
        'Generated truth and onboarding decay unless CI runs one documented check covering projections, external links, snippets, offline output, accessibility and both clean-room parents.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/docs/check.mjs',
          description:
            'Implement checkDocumentation to validate projection schema/claims, generated drift, local/external links with recorded retry disposition, snippets, diagrams/text equivalents, accessibility, offline assets, comparison expiry and clean-room fixtures; emit typed per-check JSON. → verify: node --test plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/package.json',
          description:
            'Add one docs:check script invoking checkDocumentation without duplicating its flags or logic, and include it in the plugin test/CI path used by the repository gate. → verify: pnpm --dir plugins/zeroh-roadmap run docs:check',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
          description:
            'Plant stale generated bytes, broken local link, expired external fact, bad command snippet, inaccessible disclosure, external asset and Claude/Codex receipt drift; require named RED checks and an unchanged tree GREEN. → verify: node --test --test-name-pattern="CI mutation" plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'One docs:check command fails on projection drift, unsupported claims, broken links/snippets, accessibility/offline defects, expired comparison facts, or clean-room semantic divergence.',
        'External-link infrastructure failures are reported distinctly from invalid links and cannot silently green or trigger unrelated code edits.',
        'The full repository gate runs docs:check and leaves generated files unchanged.',
      ],
      files: [
        'plugins/zeroh-roadmap/scripts/docs/check.mjs',
        'plugins/zeroh-roadmap/package.json',
        'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['45.5'],
      interfaces: { consumes: ['renderDocumentation', 'Disclosure orientation HTML'], produces: ['docs:check'] },
    },
    {
      id: '45.7',
      title: 'Enforce concise, non-duplicative engineer documentation',
      problem:
        'A generated documentation system can still produce several long restatements of the same protocol or preserve incident archaeology; the user asked for a fast senior-engineer orientation and no excessive comments or documentation.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/docs/check.mjs',
          description:
            'Add an editorial-economy check with explicit per-surface budgets, duplicate-section detection, and durable-token scans for dates, phase IDs, attempt narration, codenames and postmortem prose outside version/source metadata; require links to canonical protocol and architecture owners instead of copied protocol bodies. → verify: node --test --test-name-pattern="editorial economy|archaeology|duplicate prose" plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
          description:
            'Mutation-test an oversized quick orientation, duplicated lifecycle prose, copied protocol instructions and incident narration while retaining versioned comparison dates, claim provenance and concise safety rationale as explicit allowlisted semantic data. → verify: node --test --test-name-pattern="editorial economy mutation" plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'README remains a five-minute senior-engineer entry point; the complete guide supplies operational depth and the HTML supplies visual progressive disclosure without three independent protocol copies.',
        'Generated surfaces link to canonical source owners, contain no incident archaeology or ELI5 invocation text, and retain only concise current invariants plus required version/provenance facts.',
        'The economy check is deterministic, names the exceeded surface/rule, and mutation fixtures prove it rejects both excess length and semantic duplication.',
      ],
      files: ['plugins/zeroh-roadmap/scripts/docs/check.mjs', 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs'],
      testMode: 'tdd',
      done: false,
      dependsOn: ['45.6'],
      interfaces: { consumes: ['docs:check'], produces: ['editorial-economy documentation gate'] },
    },
    {
      id: '45.8',
      title: 'Seal the final claim-truth and visual acceptance evidence',
      problem:
        'Individual projection checks do not by themselves prove that the final GitHub-native guide and Disclosure HTML advertise only implemented behavior or meet the arc acceptance signal as a coherent release surface.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
          description:
            'Add a final claim-closure fixture that enumerates every behavioral sentence/table cell/diagram label across README, Markdown and HTML, resolves it to a sealed phase-43 supported claim or a non-behavioral source fact, and mutation-fails unproven, unavailable, unjudged or stale claims. → verify: node --test --test-name-pattern="final claim closure" plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/docs/check.mjs',
          description:
            'Add a release-mode acceptance report covering GitHub-renderable Markdown/Mermaid with complete prose fallback, Disclosure HTML at 320px and desktop, keyboard/focus/reduced-motion/offline behavior, first/second-visit disclosure, clean-room parent snippets, respectful versioned Superpowers comparison, editorial economy and unchanged generated bytes. → verify: node plugins/zeroh-roadmap/scripts/docs/check.mjs --release --json',
        },
        {
          file: 'plugins/zeroh-roadmap/README.md',
          description:
            'Link the generated release acceptance report schema and exact reproduction command from the verification section without embedding results or claiming success before the command passes. → verify: node plugins/zeroh-roadmap/scripts/docs/check.mjs --surface readme --require-release-command',
        },
      ],
      acceptanceCriteria: [
        'Every final behavioral claim is backed by a sealed supported phase-43 claim; unavailable, unjudged, unsupported and untested behavior is absent or labeled as a limitation.',
        'The GitHub-viewable README and complete Markdown guide remain useful without HTML, and the Disclosure HTML is a deterministic, accessible, offline visual enhancement rather than another truth owner.',
        'One release check proves every truthful-visual-docs signal and leaves the worktree byte-identical; a mutation in each evidence class turns it red with a typed reason.',
      ],
      files: [
        'plugins/zeroh-roadmap/README.md',
        'plugins/zeroh-roadmap/scripts/docs/check.mjs',
        'plugins/zeroh-roadmap/cli/lib/docs-projection.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['45.7'],
      interfaces: { consumes: ['editorial-economy documentation gate', 'Gauntlet 3 claim inventory'], produces: ['truthful-visual-docs release evidence'] },
    },
  ],
  reviewRecord: { date: '2026-09-04', model: 'gpt-5.6-sol', verdict: 'READY', via: 'executed' },
  notes:
    '## Hypotheses\n1. CONFIRMED — the current engineer surfaces are independently authored and already contain stale/version-sensitive and competitive prose, while no generated DocProjection or docs:check seam exists; evidence: plugins/zeroh-roadmap/docs/orientation.html contains its own dated version footer and comparative claims, plugins/zeroh-roadmap/README.md is separately maintained, and plugins/zeroh-roadmap/package.json has no docs:check script.\n2. REFUTED — evolving only orientation.html can satisfy the arc: NATIVEGREEN locks GitHub and visual-guide surfaces, complete text equivalents, clean-room Claude/Codex onboarding and one source per fact, so README/Markdown, projection and checks are required.\ninterview: skipped — arc member; NATIVEGREEN.arc.ts records Disclosure canon, evolved orientation, neutral versioned comparison, clean-room parents and the no-ELI5 ruling. userFacing false ratified: these are developer-control-plane documentation and generated orientation assets, not a consumer runtime feature, so no feature flag applies. testScope full and reviewScope full ratified because public claims, install commands, both native parents, generated drift and release checks cross every supported harness. testMode tdd ratified for 45.1-45.8: each executable renderer/checker or declarative surface is guarded by mutation-red projection tests before acceptance. Licensing ratified: generated documents and tests remain under the plugin repository license; external Superpowers material is paraphrased from pinned primary sources with links, never copied. Phase 45 may advertise only claim IDs verified by phase 43; phase 44 owns non-user provenance relocation and 45 depends on it, making documentation the final plane. External Superpowers facts must be verified against primary sources during execution because they are version-sensitive. Review repairs 2026-09-04 (Mode A gpt-5.6-sol, --no-queue): restored promised 45.7-45.8 ledger coverage, added editorial-economy and final coherent truth/visual gates, corrected node:test option ordering, and added mandatory hardening hypotheses plus metadata ratifications. The boundary wrapper stopped in dependency preflight with ERR_PNPM_IGNORED_BUILDS before classifying paths. --no-queue: placement not applied.',
})
