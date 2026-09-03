# GREENFIELD — execution prompt (the one home of arc rationale)

Read by do-arc before driving; cited by the arc entity, phase `source` fields and designRef
summaries. Nothing here is restated elsewhere.

## The bar

A repo that runs `zeroh-greenfield` follows good practice from day one, or, if it already
exists, learns exactly which practices it lacks and gets only those. Every write is proposed
and approved first. The plugin is skills and templates only. It never invents a stack, a
registry, a number or a design language: every option cites a source, every archetype carries
a verify command that was run on this box, and every token has one owner.

## Why this exists (the two incidents)

**viky-agent-2, 2026-09-01/02.** The mobile design record shows ratification with iteration
("yes, nice, but"), not rejection — so the owner's dissatisfaction never entered any lesson,
eval or follow-up. The deeper cause was upstream of the designer: the arc locked "one
renderer, two shells" (a Kotlin WebView wrapping the Electron renderer; Flutter listed only as
a rejected alternative) without a platform decision that showed alternatives with trade-offs.
The ux-designer then did what its inputs allow: transcribe the desktop canon into a 390×844
frame. The zeroh-roadmap plugin has zero mobile vocabulary (grep for shadcn, Tailwind,
Flutter, Android, mobile: no hits). Lesson: the stack decision must be a gate with options,
made before design; and a missing-home STOP must name a remedy.

**zeroh monorepo sweep, 2026-09-03.** Mature where it counts (ten dependency constraints on a
five-axis tag taxonomy, a first-party generators package with sync generators emitting a repo
catalog, a token preset projected to CSS and shadcn slots with a byte-check test) and missing
exactly what this plugin authors: no PRD, no ADR, no CODE-STYLE, no architecture index, no
ux-canon, no designHomes/testConventions, a README catalog missing 5 of 19 projects despite a
"keep in sync" line, and five near-duplicate harness instruction files whose CLAUDE.md is 60%
an Nx-generated block. Neither the roadmap plugin nor superpowers is on disk there today.

## Design (the ratified architecture designRef)

Prior art searched: plugins/zeroh-design (themes/ = files dropped into the consumer;
skills/blade-design/references/ = model-loaded; Path 1/2/3 design-system check),
plugins/zeroh-sdd (specify/clarify interview skills; .codex-plugin manifest shape),
plugins/zeroh-roadmap (using-zeroh-roadmap router + references/layout.md scaffolding home;
config shapes DesignHomesShape + testConventions in cli/lib/config.mjs; six absent-home sites),
viky-agent-2 roadmap.config.json designHomes + docs/ux-canon.md, the zeroh monorepo.

1. **Four skills.** `using-zeroh-greenfield` (router + greenfield-vs-brownfield detection by a
   marker table), `greenfield-init` (workflow: interview → PRD → stack ADR → design decision →
   generator → standards → pointers → `roadmap init`), `brownfield-audit` (detect stack, gap
   table, author only the missing, wire pointers, reconcile harness files and README),
   `stack-decision` (the ADR text and the three-way mobile trade-off; standalone trigger
   "which stack"). PRD interview, design system and archetypes are `references/` loaded at
   their step. Bodies ≤ 100–200 lines per SKILL-AUTHORING-STANDARD R7; sibling boundaries
   declared both ways (R17).
2. **Templates split.** `templates/` at plugin root holds consumer-dropped skeletons with
   `<angle-bracket>` placeholders: AGENTS.md, CLAUDE.md (an `@AGENTS.md` import plus
   harness-specific lines only), docs/PRD.md, docs/adr/0001-tech-stack.md,
   docs/adr/0002-design-system.md, docs/CODE-STYLE.md, docs/architecture.md (an INDEX),
   docs/ux-canon.md, README.md (with the catalog table and its check), CONTRIBUTING.md
   (commit grammar + the four documentation rules).
3. **Archetype manifests** under `skills/greenfield-init/references/archetypes/<name>.md`, one
   fixed heading order: Generator · Post-steps · File tree · Conventions delta ·
   testConventions · designHomes · Verify. Manifests are TIMELESS reference docs
   (documentation-rules.md): `## Verify` carries the exit-code command only, versions as caret
   ranges. The dated observed results (date · command · observed exit/result or `generator
   absent — <install command>` · box) live in ONE evidence record, `VERIFY-RECORD-2026-09.md`
   at the plugin root: the web row is written by the task that authors the contract, every
   other archetype task appends its own row after running its manifest's Verify (ratified
   2026-09-03 on the phase-31 review QUESTION). Six in v1:
   `web` (create-next-app + `shadcn init` + registries + tokens with a byte-check guard),
   `flutter` (`flutter create` + shadcn_flutter), `android` (Gradle/Compose/Material 3),
   `expo` (create-expo-app + react-native-reusables or equivalent, cited), `nx-monorepo`
   (create-nx-workspace, mirrored on zeroh: apps/* + packages/* with no libs/, five-axis tags +
   depConstraints, sync generators emitting a repo catalog, a first-party generators package,
   base tsconfig with no paths + synced solution tsconfig, `affected -t lint,typecheck,test,build`,
   `nx:noop` opt-out, a language-axis option TypeScript / TypeScript+Python(uv)), `library-cli`.
   Local zeroh quirks are NOT generalized: team ownership/CODEOWNERS system, tsdown, three
   side-by-side test runners, the radix-nova style, the `.building/` work log.
4. **Design system.** Web default: shadcn/ui + Tailwind v4 (CSS-first, no tailwind.config),
   tokens as one source projected to CSS variables and shadcn slots with a byte-check test,
   `registries` key in components.json naming the chosen open registries (registry.directory
   entries; beautifului.dev is MIT copy-paste primitives, cited as a source, not a registry).
   Mobile per chosen stack: shadcn_flutter (shared token names with web), Material 3 tokens
   (translated), react-native-reusables. Blade brand → hand off to `zeroh-design:blade-design`
   Path 2 and write pointers only (theme in ux-canon, `designHomes.ux.bindingDesignSystem`,
   the ADR line); zeroh-design absent → say so with the install command.
5. **Standards + pointers.** Conventions live once in AGENTS.md (`## Conventions`, `## Don't`,
   `## Generalize-forward`, flag-first and hold[] rules where the archetype has releases);
   CLAUDE.md imports it. README gets a catalog table and a check command (where a generated
   catalog exists, reconcile against it; else the manifest declares the check). Pointers use
   only keys zeroh-roadmap accepts; ORDER: `roadmap init` first (it refuses an existing config
   and writes no optional blocks), then add designHomes/testConventions/gateCommands, then
   `roadmap config check`.
6. **Brownfield.** Detect by marker table (package managers, framework files, existing docs,
   harness files, roadmap config); build a gap table (artefact · state · evidence · proposed
   action); respect existing homes (index + link); reconcile harness files to one AGENTS.md
   home; reconcile README against the catalog; detect `.superpowers/` or docs/superpowers and
   do not collide; propose, wait for approval, then act.
7. **Roadmap seam.** ONE section `## Missing homes` in
   plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/layout.md names the remedy;
   the six sites (design-gate.md §4, plan-arc/SKILL.md gate line, agents/ux-designer.md,
   agents/software-architect.md fallback, agents/test-engineer.md, skills/test-strategy) get a
   one-clause pointer "(remedy: layout.md §Missing homes)"; behaviour unchanged when
   greenfield is not installed; a ratchet test guards section + six pointers; README's
   first-session claim is trued.
8. **Packaging.** `.claude-plugin/plugin.json` + hand-written `.codex-plugin/plugin.json`
   (zeroh-sdd shape, no hooks key), marketplace.json entry (category development), LICENSE,
   README; no package.json, no scripts.

## Research digest

- shadcn registries: registry.directory (community registries built into the CLI);
  namespaced registries in components.json, installed as `shadcn add @name/component`;
  `shadcn add <url>` for a single item.
- beautifului.dev: MIT, copy-paste AI-interface primitives (approval cards, streaming text,
  chat composer); no CLI or registry endpoint found on 2026-09-03 (docs URL 404).
- Flutter: shadcn_flutter (84 components on shadcn tokens; Android/iOS/web/desktop; adoptable
  inside MaterialApp), forui (lighter shadcn-inspired). Native: Compose + Material 3 tokens.
  Cross-platform: Expo + react-native-reusables (shadcn port).
- Ecosystem overlap: superpowers brainstorming (one question at a time → design doc, per piece
  of work), official feature-dev (per feature), Claude `/init` (needs existing code), official
  frontend-design (aesthetic direction; the ux-designer already cites it where available). None
  does greenfield project init with a stack gate, standards authoring and structure templates.

## Honesty rails (binding, see the arc entity)

Nothing before approval · never a second home · conventions land once · no invented
stacks/registries/numbers · absent tools are said, never worked around.
