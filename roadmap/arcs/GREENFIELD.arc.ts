import { defineArc } from '@/lib/roadmap/schema'

/**
 * GREENFIELD — zeroh-greenfield, the project-init plugin.
 *
 * A new marketplace plugin that makes a repo follow good practice from day one: a PRD
 * interview, a tech-stack decision record with alternatives, a design-system decision
 * (shadcn/ui + tokens on web; Flutter / native Android / Expo presented with trade-offs on
 * mobile), archetype templates as markdown manifests wrapping the ecosystem generators,
 * authoring of the standards zeroh-roadmap already knows how to read (AGENTS.md conventions
 * imported by CLAUDE.md, CODE-STYLE, architecture index, ux-canon, README with a catalog
 * check), the roadmap designHomes + testConventions pointers, then `roadmap init`. Brownfield
 * mode fills only what is missing. One seam in zeroh-roadmap routes a missing-home stop to
 * the plugin. Rationale, research digests (registries, shadcn_flutter, the viky-agent-2
 * mobile-design incident, the zeroh monorepo sweep) live ONLY in
 * roadmap/arc-prompts/GREENFIELD-execution-prompt.md.
 *
 * LOCKED DECISIONS (user rulings, dated):
 * - 2026-09-03: plugin name is zeroh-greenfield; it is a SEPARATE marketplace plugin, not a
 *   zeroh-roadmap feature (roadmap just went through the phase-26 diet; init content is large
 *   and changes at another cadence; sdd and superpowers users get it too).
 * - 2026-09-03: skills + templates ONLY — no CLI, no node code, no package.json in the plugin
 *   (rejectedAlternatives: skills-plus-cli).
 * - 2026-09-03: the mobile stack is NEVER defaulted: Flutter + shadcn_flutter, native Android
 *   (Kotlin / Compose / Material 3) and Expo / React Native are all presented with pros, cons
 *   and "better when"; the user decides (rejectedAlternatives: flutter-default).
 * - 2026-09-03: v1 ships SIX archetypes: web app, Flutter mobile, native Android, Expo
 *   cross-platform, Nx monorepo, library/CLI (rejectedAlternatives: three-archetype-v1).
 * - 2026-09-03: brownfield gap-fill mode is IN v1 (viky-agent-2, atlas, zeroh all exist).
 * - 2026-09-03 (design-gate ratification, amended by the zeroh sweep): four skills not seven;
 *   tokens have ONE owner (zeroh-design) and greenfield writes only pointers when a Blade
 *   brand applies; brownfield respects existing doc homes (index + link, never a second
 *   home); README currency is a MECHANISM (catalog-backed check), not prose; conventions
 *   land ONCE in AGENTS.md and CLAUDE.md imports it; the Nx archetype mirrors what zeroh
 *   proved; the design-system default ships tokens projected with a byte-check guard; the
 *   Nx manifest carries a language-axis option (TypeScript + Python/uv) instead of a seventh
 *   archetype (rejectedAlternatives: seven-skills, conventions-in-claude-md, readme-as-prose).
 * - 2026-09-03 (ruling on the phase-32 review question): "skills + templates only" governs the PLUGIN's
 *   runtime shape; a file the plugin DROPS INTO THE CONSUMER and that runs there (the README catalog
 *   check script, precedent plugins/zeroh-design/themes/<theme>/setup.sh) is a TEMPLATE, not plugin code.
 * - 2026-09-04: generated repositories use affected-first local verification. Nx consumers
 *   receive distinct full, file-scoped, project-affected, and arc-impacted roadmap gate bindings;
 *   phase work never maps `unit` to an unqualified workspace sweep. Unknown impact and changes to
 *   test, runner, workspace, lockfile, or root configuration fail toward the full tier. Generated
 *   CI/release is the required consumer backstop (rejectedAlternative: full-suite-every-phase).
 * - 2026-09-04: CI and release strategy are GREENFIELD outputs from day one. PRs run affected
 *   validation; main/nightly run deterministic configurable full-suite shards whose reports and
 *   coverage merge before floors; releases promote the exact already-tested content-addressed
 *   artifact rather than rebuilding (rejectedAlternative: late-monolithic-release-suite).
 * - 2026-09-03: codex manifest is hand-written in the zeroh-sdd shape (no package.json, so
 *   emit-manifests cannot cover it); marketplace entry category "development".
 *
 * DEFERRED (named owner + escalation point):
 * - Marketplace-level architecture doc home: designHomes.architecture.home points at
 *   plugins/zeroh-roadmap and its extendProtocol names MULTI-DRIVER.md, which does not
 *   cover cross-plugin design. This arc records its design in the execution prompt and in the
 *   plugin's README (owner: user decides a marketplace-level home; escalation: the next
 *   cross-plugin arc's design gate names the same gap).
 * - `prd-interview` as its own skill once a second caller beyond greenfield-init appears
 *   (owner: plan-phase of that caller; architect generalize-forward verdict).
 * - emit-manifests.mjs accepting a package-less `--root` so skills-only plugins get the
 *   manifest drift ratchet (consumers: zeroh-greenfield, zeroh-design; owner: zeroh-roadmap
 *   backlog; escalation: a hand-edited codex manifest drifts from plugin.json).
 * - Further archetypes (iOS/SwiftUI, Python service) as manifests only; superpowers
 *   coexistence beyond "detect and do not collide" (zeroh has neither roadmap nor superpowers
 *   on disk today — owner: user when zeroh adopts either).
 * - Stray claim 35 (a `claim --help` probe reserved it): unused; numbers need uniqueness,
 *   not contiguity.
 *
 * Review repair 2026-09-04: phase 34 final evidence must prove real gate execution,
 * individual document-gap coverage, conditional Blade dependency, and canonical
 * migrated-root discovery; earlier document-shape checks do not establish these.
 * PROMISE LEDGER (plan-arc Step 2c — audited by arc-sweep / validate-arc)
 * promise                                   | kind        | fulfilled by
 * standards-first                           | criterion   | 29.2 (greenfield-init approval gate) + 33.1 (brownfield gap table + approval) + 34.4 + 34.5 (dry runs)
 * tradeoffs-not-defaults                    | criterion   | 30.1 (stack-decision matrices) + 30.2 (ADR template with "better when" row)
 * shard-ready-delivery                      | criterion   | 34.6 (six adapters + CI evidence/artifact protocol) + 34.7 (approval-gated install + final native proof)
 * beautiful-by-default                      | criterion   | 30.3 (design-system reference) + 31.1 (web archetype manifest) + 32.3 (pointer wiring) + 34.4 + 34.5
 * six-archetypes                            | criterion   | 31.1–31.6 (one manifest per archetype, each with a verify command run on this box)
 * readme-current                            | criterion   | 32.2 (README template + catalog check) + 33.3 (brownfield README reconcile) + 34.5
 * affected-first-verification               | criterion   | 32.5 (Nx tier bindings + safe selector) + 34.7 (final native and mutation proof)
 * roadmap-offers-setup                      | criterion   | 34.1 (layout.md §Missing homes + six pointer clauses + ratchet test)
 * execution-prompt §Design                  | designRef   | 29.1 (plugin skeleton + router) + 29.3 (templates dir split) + 34.1 (routing seam)
 * "conventions land once, one owner"        | honestyRail | 32.1 (AGENTS.md home, CLAUDE.md @import) + 33.2 (harness-file reconciliation)
 * "never author a second home for a fact"   | honestyRail | 33.1 (gap table cites existing homes) + 30.3 (zeroh-design handoff writes pointers only)
 * "nothing written before approval"         | honestyRail | 29.2 + 33.1 + 34.4 + 34.5
 * "no invented stacks or registries"        | honestyRail | 30.1 (every option row cites a source) + 31.x (verify commands)
 * skill catalog is one router               | singleSeam  | 29.1
 * archetype manifest heading contract       | singleSeam  | 31.1 (defines it) — 31.2–31.6 conform; runtime evidence is truthfully classified
 * stack ADR text owned by stack-decision    | singleSeam  | 30.2 (called by 29.x and 33.x, never restated)
 * pointer keys = zeroh-roadmap config shapes| singleSeam  | 32.3
 * one missing-home remedy (layout.md)     | singleSeam  | 34.1 (the only remedy text; six sites carry a pointer clause + ratchet test)
 * USER ASK: "questionnaire of what this project is about" | request | 29.2 (PRD interview reference, one question at a time)
 * USER ASK: "suggested tech stack, pros cons"              | request | 30.1 + 30.2
 * USER ASK: "reusability of components"                    | request | 30.1 (reuse row per mobile option) + 30.3 (shared tokens web+mobile)
 * USER ASK: "beautiful designs out of the box, like shadcn and open registries" | request | 30.3 + 31.1 (registries key in components.json; beautifului.dev as copy-paste source)
 * USER ASK: "file structure convention, use or suggest best structure" | request | 31.1–31.6 (file tree per manifest) + 33.1 (brownfield keeps the existing one)
 * USER ASK: "update readme even if needed so it is up to date" | request | 32.2 + 33.3
 * USER ASK: "first time use perhaps offer to do this set up" | request | 34.1
 * USER ASK: "from day one build for sharding / parallel execution; CI and release strategy" | request | 34.6
 * USER ASK: "PRD what the project is about if it is completely from scratch" | request | 29.2 + 29.3 (PRD template)
 * USER ASK: "templates for android app, web app, cross-platform, monorepo nx" | request | 31.2 (Android) 31.1 (web) 31.4 (Expo) 31.5 (Nx)
 * USER ASK: "add new plugin to our marketplace"            | request | 34.2 (marketplace entry + codex manifest)
 * USER ASK: "only run affected test suite not full"         | request | 32.5 (generated local/phase/arc cadence) + 34.5 (fallback mutation proof)
 */
export default defineArc({
  id: 'GREENFIELD',
  name: 'zeroh-greenfield — a repo follows good practice from day one, with approval, or fills its gaps',
  baseRef: 'feat/roadmap-arcs',
  // Claimed numbers, dependency order: 29 skeleton + init workflow; 30 decisions; 31 archetypes;
  // 32 standards authoring + pointers; 33 brownfield; 34 roadmap seam + packaging + dry runs.
  planes: [
    { name: 'skeleton-and-interview', phases: [29] },
    { name: 'decisions', phases: [30] },
    { name: 'archetypes', phases: [31] },
    { name: 'standards-and-pointers', phases: [32] },
    { name: 'brownfield', phases: [33] },
    { name: 'seam-packaging-validation', phases: [34] },
  ],
  designRefs: [
    {
      kind: 'architecture',
      ref: 'roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design',
      status: 'designed',
      summary:
        'Skills+templates plugin reusing zeroh-design\'s split (consumer-dropped files in templates/, model-loaded knowledge in skills/*/references/); four skills (router, greenfield-init, brownfield-audit, stack-decision); archetypes as markdown manifests with a fixed heading contract; tokens owned by zeroh-design with greenfield writing pointers; one absent-home remedy owner in using-zeroh-roadmap/references/layout.md §Missing homes with six one-clause pointers; conventions land once in AGENTS.md, imported by CLAUDE.md. Prior art: plugins/zeroh-design themes split, zeroh-sdd specify/clarify, viky-agent-2 designHomes, zeroh monorepo generators + token contract.',
    },
  ],
  // design gate: UX sub-gate skipped — the plugin has no rendered surface of its own (docs,
  // templates and prompts); the surfaces it CREATES in consumers are judged by their
  // archetype verify commands and the beautiful-by-default criterion, 2026-09-03.
  rejectedAlternatives: [
    { option: 'skills-plus-cli', why: 'User ruling 2026-09-03: skills and templates only; a Node CLI would make the plugin a package with tests and a release cadence of its own.', decidedBy: 'user', decidedAt: '2026-09-03' },
    { option: 'flutter-default', why: 'User ruling 2026-09-03: never default the mobile stack; present all three with trade-offs and "better when", the user decides.', decidedBy: 'user', decidedAt: '2026-09-03' },
    { option: 'three-archetype-v1', why: 'User ruling 2026-09-03: v1 ships all six archetypes.', decidedBy: 'user', decidedAt: '2026-09-03' },
    { option: 'late-monolithic-release-suite', why: 'User ruling 2026-09-04: establish deterministic parallel shards, evidence aggregation, and build-once promotion at project creation so suite growth changes shard count rather than delivery architecture.', decidedBy: 'user', decidedAt: '2026-09-04' },
    { option: 'seven-skills', why: 'Architect 2026-09-03 under the phase-26 load-budget lesson: PRD interview, design system and archetype scaffold are steps of greenfield-init, loaded as references at their step; only "which mobile stack" earns standalone activation.', decidedBy: 'software-architect (claude-fable-5)', decidedAt: '2026-09-03' },
    { option: 'conventions-in-claude-md', why: 'zeroh sweep 2026-09-03: five near-duplicate harness files and an Nx-generated CLAUDE.md block; one harness-neutral home (AGENTS.md) imported by CLAUDE.md upholds the POLYSEAT no-Claude-privilege ruling.', decidedBy: 'supervising session (claude-fable-5-1) from the zeroh sweep', decidedAt: '2026-09-03' },
    { option: 'readme-as-prose', why: 'zeroh sweep 2026-09-03: the README catalog omits 5 of 19 projects despite a "keep in sync" instruction; currency must be a catalog-backed check.', decidedBy: 'supervising session (claude-fable-5-1) from the zeroh sweep', decidedAt: '2026-09-03' },
    { option: 'inline-brand-tokens', why: 'Architect 2026-09-03: tokens have one owner (zeroh-design); greenfield writes pointers, never a second copy.', decidedBy: 'software-architect (claude-fable-5)', decidedAt: '2026-09-03' },
    { option: 'full-suite-every-phase', why: 'User ruling 2026-09-04 after the GREENFIELD phase-30 gate measured roughly 33 minutes: use related/file-scoped tests during implementation and phase gates, impacted tests at arc landing, and reserve the full sweep for unsafe-to-scope changes plus CI/release backstops.', decidedBy: 'user', decidedAt: '2026-09-04' },
  ],
  singleSeams: [
    'One router: skills/using-zeroh-greenfield/SKILL.md is the only dispatch table (trigger → skill); no other skill re-lists triggers.',
    'One archetype manifest contract: the fixed heading order (Generator · Post-steps · File tree · Conventions delta · testConventions · designHomes · Verify) is defined once and every manifest conforms; a manifest missing a heading is invalid.',
    'One ADR author: stack-decision owns the tech-stack and design-system ADR text; greenfield-init and brownfield-audit call it and never restate a matrix.',
    'One pointer vocabulary: every key greenfield writes into roadmap.config.json is a key zeroh-roadmap\'s config schema accepts (designHomes.*, testConventions[], testCadence.*, gateCommands.*); no greenfield-only key.',
    'One missing-home remedy: using-zeroh-roadmap/references/layout.md §Missing homes is the only place that names the remedy; the six sites carry a one-clause pointer, never the remedy text.',
  ],
  honestyRails: [
    'Nothing is written to the consumer before an approval line: every PRD, ADR, standards file, pointer and generator run is presented (what, where, why) and approved first; brownfield lists the gap table and waits.',
    'Never author a second home for a fact: an existing standards doc, token contract or architecture topic is indexed and linked, never restated; a Blade brand hands tokens to zeroh-design and writes pointers only.',
    'Conventions land once: AGENTS.md is the home; CLAUDE.md and other harness files import or point, never copy.',
    'No invented stacks, registries or numbers: every option row in a decision matrix cites a real source (package, registry, doc); every archetype manifest carries a verify command, and the dated observed result of running it on this box lives in the plugin\'s VERIFY-RECORD-2026-09.md (manifests stay timeless).',
    'Absent tools are said, never worked around: zeroh-design or zeroh-roadmap not installed → name the install command and stop that branch; never inline what the sibling owns.',
    'Affected never means guessed: generated scoped and impacted commands consume the roadmap-provided files/range through one selector seam; missing, malformed, or unsafe scope selects the full tier and records why. A file-scoped command must red on a nonexistent target.',
  ],
  acceptanceCriteria: [
    {
      id: 'standards-first',
      job: 'out of the box it follows practices and standards in a repo if they exist, and if they don\'t, it will first with suggestions and approval create them (user verbatim, 2026-09-03)',
      surfaces: ['console'],
      signal:
        'judged on TWO scratch repos after a full driver run: (a) an empty directory → the run presents the PRD, stack ADR, design decision, standards set and pointers as proposals, writes NOTHING before the recorded approval line, then leaves docs/PRD.md, docs/adr/0001-tech-stack.md, AGENTS.md (+ CLAUDE.md import), docs/CODE-STYLE.md, docs/architecture.md, docs/ux-canon.md, README.md and a roadmap.config.json whose `roadmap config check` resolves; (b) a zeroh-shaped fixture with mature boundaries, generators and a token contract but no PRD/ADR/CODE-STYLE/ux-canon → the gap table names exactly those, the run touches no existing home (git diff limited to the gap files + README + config), and architecture.md/ux-canon.md LINK the existing docs; both judged on a second run (idempotent: no changes proposed)',
      tier: 'wired',
      bar: 'zero writes before approval on both repos; zero rewrites of an existing home on (b); config check green on both; every non-none gate executes with cwd/exit evidence; each missing PRD/ADR/CODE-STYLE/architecture-index/UX-canon has its own approved artifact row; non-Blade repairs work without zeroh-design; migrated roots are preserved and ambiguous roots stop',
    },
    {
      id: 'tradeoffs-not-defaults',
      job: 'provide suggested tech stack, pros cons … we should provide all 3 right? and some pros/cons for user to decide, like what is better when (user verbatim, 2026-09-03)',
      surfaces: ['console'],
      signal:
        'in the empty-repo run that answers "mobile" in the interview, docs/adr/0001-tech-stack.md shows Flutter + shadcn_flutter, native Android (Kotlin/Compose/Material 3) and Expo/React Native as three option rows each with pros, cons, a "better when" line, a component-reuse line and a cited source, plus the user\'s recorded choice; the web and monorepo decisions show at least two options each; no row is a default pre-selected without a choice line',
      tier: 'wired',
      bar: 'three mobile rows every time, sources on every row, the choice recorded as a dated ruling',
    },
    {
      id: 'beautiful-by-default',
      job: 'if there is web UX design and not stated otherwise, I want the roadmap plugin to be building beautiful designs out of the box, like shadcn and open registries (user verbatim, 2026-09-03)',
      surfaces: ['console'],
      signal:
        'the web-archetype scratch run leaves components.json with the shadcn init settings AND a `registries` key naming the chosen open registries, a tokens source projected to CSS with a byte-check guard, docs/ux-canon.md naming fonts/palette/spacing and the binding design system, and roadmap.config.json designHomes.ux pointing at them so `roadmap config check` prints resolved bindings; with a Blade brand answer, the run hands off to zeroh-design and ux-canon carries the theme pointer instead of tokens',
      tier: 'wired',
      bar: 'ux-designer-consumable canon + registries configured; no restated tokens on the Blade path',
    },
    {
      id: 'six-archetypes',
      job: 'templates for android app, web app, cross-platform, monorepo nx and so on (user verbatim, 2026-09-03)',
      surfaces: ['console'],
      signal:
        'each of the six archetype manifests (web, flutter, android, expo, nx-monorepo, library-cli) carries a Generator command and a Verify command; running the Verify on this box in a scratch directory yields the manifest\'s documented file tree and matches that archetype\'s row in VERIFY-RECORD-2026-09.md (date · command · observed · box · tool version · execution commit), judged for all six after the manifests landed and again after any manifest edit',
      tier: 'wired',
      bar: 'six structurally valid manifests; every available generator run is green; unavailable generators are classified `unavailable — <install command>` and never counted as green or failed',
    },
    {
      id: 'readme-current',
      job: 'update readme even if needed so it is up to date (user verbatim, 2026-09-03)',
      surfaces: ['console'],
      signal:
        'after the empty-repo run the README names every top-level directory and every command the manifest declared; after the zeroh-shaped brownfield run the README catalog lists all fixture projects (the fixture starts with five missing, mirroring zeroh) and the manifest\'s catalog check command reds when a project is added without a README row — judged after adding one more project to the fixture',
      tier: 'wired',
      bar: 'catalog check exists and reds on drift; no README row invented for a project that does not exist',
    },
    {
      id: 'roadmap-offers-setup',
      job: 'during first time use perhaps offer to do this set up … project init (user verbatim, 2026-09-03)',
      surfaces: ['console'],
      signal:
        'in a consumer whose roadmap.config.json lacks designHomes, plan-arc\'s design gate and the ux-designer agent still stop, and their stop text names the remedy from layout.md §Missing homes (zeroh-greenfield, the brownfield-audit skill, the install command); a ratchet test in zeroh-roadmap\'s suite fails if any of the six sites loses its pointer clause or the section is renamed; judged after the phase lands and after the next zeroh-roadmap release',
      tier: 'wired',
      bar: 'six pointer clauses + one owner section, guarded by a test; behaviour unchanged when greenfield is not installed',
    },
    {
      id: 'affected-first-verification',
      job: 'local and phase verification runs tests affected by the change while generated guidance names CI/release as the required full-regression backstop (user ruling, 2026-09-04)',
      surfaces: ['console'],
      signal:
        'the Nx archetype emits testCadence.enabled plus distinct lint, types, build, full unit, unit-scoped `{files}`, unit-affected `{files}`, and unit-impacted `{range}` bindings; end-to-end roadmap fixture runs prove a leaf source without a colocated test uses the affected-project slot, arc input selects the union of affected projects, a nonexistent target reds, and unsafe or unparseable scope selects the full unit tier with a recorded reason',
      tier: 'wired',
      bar: 'roadmap gate plan/run activates affected bindings; no duplicated combined command; ordinary source changes avoid full unit; every unsafe or indeterminate selection fails toward full; generated testCadence guidance explicitly requires CI/release full regression',
    },
    {
      id: 'shard-ready-delivery',
      job: 'from day one, broad CI is parallelizable and release promotes exactly what the full suite proved (user ruling, 2026-09-04)',
      surfaces: ['console'],
      signal:
        'a generated scratch repository for each of the six archetype adapters has an affected PR workflow and full main/nightly workflow whose stable configurable shard manifest assigns every atomic identity exactly once, uploads compact results on red or green, merges reports and coverage before floors, and publishes one content-addressed build artifact; release requires the aggregate for the same commit and promotes that digest without rebuilding',
      tier: 'wired',
      bar: 'shard count 1 and greater are valid without workflow redesign; omissions, duplicates, incomplete reports, coverage/test-count regression, stale commit, skipped credentials, digest mismatch, or release rebuild are red; permissions and retention are bounded',
    },
  ],
  descopes: [
  {
    "item": "tradeoffs-not-defaults: owner accepts missing observed mobile three-option and dated-choice ADR proof for GREENFIELD 1.0.0; authored instructions remain, runtime outcome is not claimed proven.",
    "ratifiedBy": "user: just accept ot , and go on",
    "ratifiedAt": "2026-09-06T08:06:21.266079+00:00"
  },
  {
    "item": "beautiful-by-default: owner accepts missing observed web registry/token-check/UX bindings and Blade pointer-only handoff proof for GREENFIELD 1.0.0; authored guidance remains, runtime outcome is not claimed proven.",
    "ratifiedBy": "user: just accept ot , and go on",
    "ratifiedAt": "2026-09-06T08:06:21.266079+00:00"
  }
],
  criteriaRatifications: [
    "2026-09-06T08:06:21.266079+00:00 owner accepted the two closing-review evidence gaps and instructed continuation. Six criteria MET; two accepted exceptions, not proven. GREENFIELD-only bounded closure amendment approved; product source unchanged.",
    '2026-09-03 (planning, phase-31 review QUESTION): six-archetypes signal/bar re-homed the dated observed results from the manifests to VERIFY-RECORD-2026-09.md — manifests stay timeless per documentation-rules.md; the honesty rail and execution prompt §Design item 3 were amended in the same commit.',
  ],
  status: 'planning',
})
