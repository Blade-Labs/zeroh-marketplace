import { definePhase } from '@/lib/roadmap/schema'

/**
 * Six executable archetype manifests for greenfield-init.
 *
 * Each manifest is model-loaded knowledge, not a script: it names the real ecosystem generator,
 * the exact post-generation edits, the resulting two-level tree, consumer convention/config
 * values, and one falsifiable tree check with an honest dated observation. The README owns the
 * seven-heading contract once; the six manifests conform without restating its rationale.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 31,
  name: 'Six source-checked archetype manifests for greenfield-init',
  plannedBy: { model: 'gpt-5.6-sol' },
  status: 'backlog',
  category: 'feature',
  kind: 'logic',
  source:
    'GREENFIELD arc plane `archetypes`; roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design items 3–4 and §Research digest; .building/greenfield-briefs/31.md; user ruling 2026-09-03 that v1 ships all six archetypes.',
  priority: 'HIGH',
  dependsOn: [29, 30],
  conflictsWith: [],
  arcId: 'GREENFIELD',
  keyFiles: [
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/README.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
    'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md',
  ],
  stakeholderDemo:
    'Select any of the six greenfield archetypes and read one manifest from generator through verification; web and Nx reproduce their documented trees on this host, while unavailable mobile generators say so explicitly.',
  userFacing: false,
  reviewScope: 'none',
  assumptions: [
    {
      claim: 'The GREENFIELD arc assigns the archetype manifest contract and all six v1 manifests to phase 31.',
      verify: "grep -F \"archetype manifest heading contract       | singleSeam  | 31.1\" roadmap/arcs/GREENFIELD.arc.ts && grep -F \"six-archetypes                            | criterion   | 31.1–31.6\" roadmap/arcs/GREENFIELD.arc.ts",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'Phase 29 owns greenfield-init and phase 30 owns the design-system reference consumed here.',
      verify: "grep -F \"29 skeleton + init workflow; 30 decisions; 31 archetypes\" roadmap/arcs/GREENFIELD.arc.ts && grep -F \"30.3 (design-system reference) + 31.1\" roadmap/arcs/GREENFIELD.arc.ts",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The proven zeroh workspace has a first-party generator that emits emitted/repo-catalog.json with five-axis tag fields.',
      verify: "grep -F \"writeJson(tree, 'emitted/repo-catalog.json'\" /home/patrik/zeroh/packages/generators/src/generators/repo-catalog.ts && grep -F \"stability: tagValue(tags, 'stability')\" /home/patrik/zeroh/packages/generators/src/generators/repo-catalog.ts",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The proven zeroh workspace uses nx:noop as its explicit target opt-out and carries no compilerOptions.paths in the base TypeScript config.',
      verify: "grep -F '\"executor\": \"nx:noop\"' /home/patrik/zeroh/packages/generators/project.json && test \"$(grep -c '\"paths\"' /home/patrik/zeroh/tsconfig.base.json)\" = \"0\"",
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '31.1',
      title: 'Define the manifest contract and author the web archetype',
      problem:
        'greenfield-init has no single machine-readable-by-convention manifest contract and no web recipe joining the source-checked Next.js/shadcn commands to phase 30’s token and registry decisions.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/README.md',
          description:
            'Define the required heading order exactly once: Generator, Post-steps, File tree, Conventions delta, testConventions, designHomes, Verify. Require one exit-code Verify command plus `observed: YYYY-MM-DD — <result>` or `observed: generator absent — <install command>`; missing/reordered headings are invalid. Follow `skills/using-zeroh-roadmap/references/documentation-rules.md`. → verify: bash -c "f=plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/README.md; test \"$(grep -cE \\\"^## (Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify)$\\\" \"$f\")\" = 7"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
          description:
            'Author all seven headings with create-next-app, shadcn init, a `components.json.registries` entry, and phase 30 token projection/byte-check steps by citation. Record Playwright and designHomes, the generated tree, and scratch result. Name create-next-app + shadcn as MIT, allowed in shipped web artifacts; require upstream LICENSE verification before install per `external-assets-licensing.md`. → verify: grep -qF "observed: 2026-09-03 — exit 0" plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
        },
      ],
      acceptanceCriteria: [
        'The README and web manifest each contain the seven required headings exactly once and in contract order; `web.md` cites `references/design-system.md` rather than copying its token contract.',
        '`web.md` records the actual scratch probe: create-next-app 16.3.4 produced package.json, src/app/page.tsx and src/app/globals.css; the manifest Verify checks those paths and exits 0.',
        '`web.md` names the official Next.js and shadcn sources, Tailwind v4 CSS-first output, a concrete namespaced registry mapping, Playwright test convention, and the Flag-first delivery citation for generated consumer conventions.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/README.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
      ],
      testMode: 'none',
      done: false,
      interfaces: {
        consumes: ['references/design-system.md from phase 30'],
        produces: ['archetype heading contract', 'observed: grammar', 'web.md'],
      },
    },
    {
      id: '31.2',
      title: 'Author the native Android archetype',
      problem:
        'The six-archetype promise lacks a native Android manifest with a sourced platform floor, Kotlin/Compose/Material 3 structure, and an honest generator-availability result.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md',
          description:
            'Conform with Android Studio Empty Activity (Kotlin, Compose, Material 3, Gradle KTS), sourced minSdk 23, test conventions, designHomes, and tree. Record the absent Android tooling. Name Compose/Material 3 Apache-2.0, allowed in shipped mobile artifacts; require upstream LICENSE verification before install per `external-assets-licensing.md`. → verify: grep -qF "observed: generator absent" plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md',
        },
      ],
      acceptanceCriteria: [
        '`android.md` contains the seven headings in contract order and cites Android Developers for Kotlin-only Compose setup, Gradle KTS, Material 3, and the AndroidX minSdk 23 default.',
        'Its Verify checks executable `./gradlew` plus app/build.gradle.kts and app/src/main/AndroidManifest.xml, while the observed line truthfully records that Android tooling was absent on 2026-09-03.',
        'The conventions delta and literal testConventions distinguish local JUnit (`./gradlew test`) from device Compose tests (`./gradlew connectedAndroidTest`).',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'observed: grammar from 31.1'], produces: ['android.md'] },
    },
    {
      id: '31.3',
      title: 'Author the Flutter archetype',
      problem:
        'The Flutter option has no executable manifest tying `flutter create` and the current shadcn_flutter package to the shared token vocabulary without claiming an unavailable local tool ran.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md',
          description:
            'Conform with `flutter create`, shadcn_flutter 0.0.54, and a phase 30 token-bridge citation. Record `flutter test`, designHomes, tree, and absent Flutter SDK; cite Flutter documentation and pub.dev. Name Flutter + shadcn_flutter BSD-3-Clause, allowed in shipped mobile artifacts; require upstream LICENSE verification before install per `external-assets-licensing.md`. → verify: grep -qF "shadcn_flutter:^0.0.54" plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md',
        },
      ],
      acceptanceCriteria: [
        '`flutter.md` contains all seven headings in order, cites the official Flutter create command and pub.dev shadcn_flutter 0.0.54, and cites rather than restates phase 30’s token contract.',
        'Its Verify checks pubspec.yaml, lib/main.dart, and test/widget_test.dart; the observed line truthfully records Flutter absent on 2026-09-03 with the official SDK install remedy.',
        'The literal testConventions value is `flutter test`, and designHomes bind both architecture and UX homes produced by greenfield-init.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'observed: grammar from 31.1', 'references/design-system.md from phase 30'], produces: ['flutter.md'] },
    },
    {
      id: '31.4',
      title: 'Author the Expo archetype',
      problem:
        'The Expo option lacks a source-checked manifest for create-expo-app, React Native Reusables, shared token pointers, and a falsifiable generated-tree contract.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md',
          description:
            'Conform with create-expo-app’s SDK 57 template and the scoped React Native Reusables CLI; cite their docs and phase 30 tokens. Record tests, designHomes, tree, and registry result. Name create-expo-app BSD-3-Clause and Reusables CLI MIT, both allowed in shipped mobile artifacts; require upstream LICENSE verification per `external-assets-licensing.md`. → verify: grep -qF "@react-native-reusables/cli@latest" plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md',
        },
      ],
      acceptanceCriteria: [
        '`expo.md` contains the seven headings in contract order and cites the official Expo SDK 57 generator and React Native Reusables CLI rather than the nonexistent unscoped npm package.',
        'Its Verify checks package.json, app.json, and the generated app directory; the observed line says create-expo-app 4.0.0 was registry-resolvable on 2026-09-03 and does not claim a full generator pass.',
        'Shared token work is a citation to phase 30’s design-system reference; the manifest does not create a second token owner.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'observed: grammar from 31.1', 'references/design-system.md from phase 30'], produces: ['expo.md'] },
    },
    {
      id: '31.5',
      title: 'Author the zeroh-proven Nx monorepo archetype',
      problem:
        'A generic Nx starter would omit the structures proven in `/home/patrik/zeroh`: five-axis dependency tags, catalog-emitting first-party generators, synchronized solution references, and explicit no-op targets.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            'Conform with the noninteractive integrated TypeScript Nx generator, apps/* + packages/* and no libs/. Specify five tag axes + constraints, first-party generators, repo catalog + README check, solution config, affected gate, and nx:noop. Name Nx MIT, allowed anywhere as repository tooling; require upstream LICENSE verification per `external-assets-licensing.md`. → verify: grep -qF "emitted/repo-catalog.json" plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            'Add the language-axis option row: TypeScript only, or TypeScript + Python managed by uv; keep it one archetype. Add a `Not generalized from zeroh` paragraph excluding team ownership/CODEOWNERS, tsdown, three test runners, radix-nova, and `.building/`. Record the 2026-09-03 Nx 23.2.0 scratch pass and Verify `nx.json`, package.json, tsconfig.base.json, packages/, and absence of libs/. → verify: bash -c "f=plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md; grep -qF \"TypeScript + Python (uv)\" \"$f\" && grep -qF \"Not generalized from zeroh\" \"$f\" && grep -qF \"observed: 2026-09-03 — exit 0\" \"$f\""',
        },
      ],
      acceptanceCriteria: [
        '`nx-monorepo.md` contains all seven headings in contract order and its Verify matches the observed Nx 23.2.0 scratch tree: nx.json, package.json, tsconfig.base.json and packages/ present, libs/ absent.',
        'The manifest maps each prior-art seam to a concrete output: five tag axes + depConstraints, first-party generators.json, emitted/repo-catalog.json shape consumed by the README check, no base paths + Nx-synced solution tsconfig, affected four-target gate, and nx:noop.',
        'The TypeScript/Python choice is an option row inside this manifest, and all five zeroh-local exclusions are explicit.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'observed: grammar from 31.1'], produces: ['nx-monorepo.md'] },
    },
    {
      id: '31.6',
      title: 'Author the publish-ready TypeScript library/CLI archetype',
      problem:
        'The final v1 archetype lacks a concrete package layout that separates library exports from the executable entry point and proves both without inventing a bespoke generator.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md',
          description:
            'Conform using Vite vanilla-ts, then separate library/CLI entries, `bin`, `exports`, `files`, declarations, and tsup 8.5.1. Use `node --test` + CLI smoke; cite upstream sources and record the tree. Name Vite + tsup MIT, allowed anywhere as build tooling; require upstream LICENSE verification per `external-assets-licensing.md`. → verify: grep -qF "tsup 8.5.1" plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md',
        },
      ],
      acceptanceCriteria: [
        '`library-cli.md` contains all seven headings in contract order, cites real Vite 8.2.2 and tsup 8.5.1 package versions observed on 2026-09-03, and uses Node’s documented built-in test runner.',
        'The documented package.json contract exposes library imports through `exports`, the executable through `bin`, limits publishing with `files`, and emits JavaScript plus declarations from tsup.',
        'Its Verify checks package.json, both named source entry modules and tsup.config.ts; its testConventions include `node --test` plus a built CLI `--help` smoke command.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'observed: grammar from 31.1'], produces: ['library-cli.md'] },
    },
  ],
  notes:
    'interview: skipped — this is GREENFIELD arc member phase 31; the arc entity records the 2026-09-03 interview and six-archetype ruling. userFacing false: these are model-loaded reference manifests with no direct rendered or runtime user surface, so no feature flag applies. reviewScope none: the diff is documentation-only declarative reference content; schema validation and command/source rehearsal are higher-value than an implementation review chain. Documentation standard: skills/using-zeroh-roadmap/references/documentation-rules.md. Planned phase paths from dependencies are intentionally cited before phases 29/30 land. Plan-time probes (2026-09-03): create-next-app 16.3.4 scratch generation + tree Verify exit 0; create-nx-workspace 23.2.0 scratch generation + tree Verify exit 0; npm registry resolved create-expo-app 4.0.0, tsup 8.5.1, Vite 8.2.2, Vitest 5.0.0; pub.dev resolved shadcn_flutter 0.0.54; flutter, gradle, sdkmanager and avdmanager absent; the unscoped npm name react-native-reusables returned E404, so the plan uses the documented @react-native-reusables/cli. Step verifies rehearsed red-now: every heading/content grep exits non-zero because each target manifest is absent; that missing target is exactly what its task creates. Assumption probes all exited 0. No negative-removal grep is used. External sources are recorded in each manifest, not duplicated in this phase prose. Out of scope per the arc ruling: scripts/CLI implementation, a seventh archetype, and phase 30 token-contract text.',
})
