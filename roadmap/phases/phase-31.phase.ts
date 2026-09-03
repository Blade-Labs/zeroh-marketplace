import { definePhase } from '@/lib/roadmap/schema'

/**
 * Six executable archetype manifests for greenfield-init.
 *
 * Each manifest is model-loaded knowledge, not a script: it names the real ecosystem generator,
 * the exact post-generation edits, the resulting two-level tree, consumer convention/config
 * values, and one falsifiable tree check. The README owns the
 * seven-heading contract once; the six manifests conform without restating its rationale.
 * Dated plan-time observations live only in VERIFY-RECORD-2026-09.md.
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
    'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
  ],
  stakeholderDemo:
    'Select any of the six greenfield archetypes and read one timeless manifest from generator through verification, then inspect the single dated evidence record for its scratch result on this host.',
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
            'Define exact heading order and require a literal generator, non-empty tree, and exit-code Verify. Route observations only to the evidence record. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/README.md\',\'utf8\'),r=/^## Generator[\\s\\S]*^## Post-steps[\\s\\S]*^## File tree[\\s\\S]*^## Conventions delta[\\s\\S]*^## testConventions[\\s\\S]*^## designHomes[\\s\\S]*^## Verify/m;if(!r.test(s)||(s.match(/^## /gm)||[]).length!==7||![\'literal generator command\',\'non-empty\',\'exit-code command\',\'VERIFY-RECORD-2026-09.md\'].every(x=>s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
          description:
            'Write the web contract. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md\',\'utf8\'),r=/^## Generator[\\s\\S]*^## Post-steps[\\s\\S]*^## File tree[\\s\\S]*```[^\\n]*\\n[^`\\n]+[\\s\\S]*^## Conventions delta[\\s\\S]*^## testConventions[\\s\\S]*^## designHomes[\\s\\S]*^## Verify\\s*\\n+`[^`]+`/m;if(!r.test(s)||(s.match(/^## /gm)||[]).length!==7||![\'npx create-next-app@^16\',\'components.json\',\'registries\',\'Playwright\',\'references/design-system.md\'].every(x=>s.includes(x))||/observed:|2026-09-03/.test(s))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Create the six dated evidence rows with commands, result/remedy, and box. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),a=[\'web\',\'android\',\'flutter\',\'expo\',\'nx-monorepo\',\'library-cli\'];for(const x of a){const m=s.match(new RegExp(\'^\\\\|(?=[^\\n]*\\\\b\'+x+\'\\\\b)(?=[^\\n]*2026-09-03)[^\\n]+\',\'gm\'))||[];if(m.length!==1||!m[0].includes([\'android\',\'flutter\'].includes(x)?\'generator absent —\':\'exit 0\'))process.exit(1)}if(![\'Generator command\',\'Verify command\',\'Box\'].every(x=>s.includes(x)))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'The README and web manifest each contain the seven required headings exactly once and in contract order; `web.md` cites `references/design-system.md` rather than copying its token contract.',
        '`web.md` cites create-next-app with a caret range and its Verify checks package.json, src/app/page.tsx and src/app/globals.css; the dated evidence row records the generator and Verify exit 0.',
        '`web.md` names the official Next.js and shadcn sources, Tailwind v4 CSS-first output, a concrete namespaced registry mapping, Playwright test convention, and the Flag-first delivery citation for generated consumer conventions.',
        '`VERIFY-RECORD-2026-09.md` has exactly one archetype row for each of the six manifests, with date, commands, observed result or absent-generator remedy, and box.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/README.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
        'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
      ],
      testMode: 'none',
      done: false,
      interfaces: {
        consumes: ['references/design-system.md from phase 30'],
        produces: ['archetype heading contract', 'VERIFY-RECORD-2026-09.md evidence schema', 'web.md'],
      },
    },
    {
      id: '31.2',
      title: 'Author the native Android archetype',
      problem:
        'The six-archetype promise lacks a native Android manifest with an explicitly selected compatibility floor, Kotlin/Compose/Material 3 structure, and honest generator-availability evidence.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md',
          description:
            'Write the Android contract. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md\')+\'\',r=/^## Generator[\\s\\S]*^## Post-steps[\\s\\S]*^## File tree[\\s\\S]*```[^\\n]*\\n[^`\\n]+[\\s\\S]*^## Conventions delta[\\s\\S]*^## testConventions[\\s\\S]*^## designHomes[\\s\\S]*^## Verify\\s*\\n+`[^`]+`/m,a=[\'Android Studio\',\'minSdk = 23\',\'selected floor\',\'./gradlew test\',\'./gradlew connectedAndroidTest\',\'app/build.gradle.kts\',\'AndroidManifest.xml\'];if(!r.test(s)||(s.match(/^## /gm)||[]).length!==7||!a.every(x=>s.includes(x))||/observed:|2026-09-03|AndroidX minSdk 23 default/.test(s))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`android.md` contains the seven headings in contract order and cites Android Developers for Kotlin-only Compose setup, Gradle KTS, Material 3, and API-level compatibility; minSdk 23 is explicitly this archetype’s selected floor, not a claimed AndroidX default.',
        'Its Verify checks executable `./gradlew` plus app/build.gradle.kts and app/src/main/AndroidManifest.xml; the Android evidence row records the absent generator and an install command.',
        'The conventions delta and literal testConventions distinguish local JUnit (`./gradlew test`) from device Compose tests (`./gradlew connectedAndroidTest`).',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1'], produces: ['android.md'] },
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
            'Write the Flutter contract. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md\',\'utf8\'),r=/^## Generator[\\s\\S]*^## Post-steps[\\s\\S]*^## File tree[\\s\\S]*```[^\\n]*\\n[^`\\n]+[\\s\\S]*^## Conventions delta[\\s\\S]*^## testConventions[\\s\\S]*^## designHomes[\\s\\S]*^## Verify\\s*\\n+`[^`]+`/m,a=[\'flutter create\',\'shadcn_flutter: ^0.0.54\',\'flutter test\',\'pubspec.yaml\',\'lib/main.dart\',\'test/widget_test.dart\',\'references/design-system.md\'];if(!r.test(s)||(s.match(/^## /gm)||[]).length!==7||!a.every(x=>s.includes(x))||/observed:|2026-09-03/.test(s))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`flutter.md` contains all seven headings in order, cites the official Flutter create command and pub.dev `shadcn_flutter: ^0.0.54`, and cites rather than restates phase 30’s token contract.',
        'Its Verify checks pubspec.yaml, lib/main.dart, and test/widget_test.dart; the Flutter evidence row records the absent generator with the official SDK install remedy.',
        'The literal testConventions value is `flutter test`, and designHomes bind both architecture and UX homes produced by greenfield-init.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1', 'references/design-system.md from phase 30'], produces: ['flutter.md'] },
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
            'Write the Expo contract. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md\',\'utf8\'),h=\'Generator,Post-steps,File tree,Conventions delta,testConventions,designHomes,Verify\'.split(\',\'),a=[\'npx create-expo-app@^4\',\'npx @react-native-reusables/cli@^0.7\',\'package.json\',\'app.json\',\'references/design-system.md\'];let p=-1;if(h.some(x=>(p=s.indexOf(\'## \'+x,p+1))<0)||(s.match(/^## /gm)||[]).length!==7||!a.every(x=>s.includes(x))||!/## File tree[\\s\\S]*```[^\\n]*\\n[^`\\n]+/.test(s)||!/## Verify\\s*\\n+`[^`]+`/.test(s)||/observed:|2026-09-03/.test(s))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`expo.md` contains the seven headings in contract order and cites the official Expo SDK 57 generator and React Native Reusables CLI rather than the nonexistent unscoped npm package.',
        'Its Verify checks package.json, app.json, and the generated app directory; the evidence row records successful create-expo-app scratch generation and the manifest Verify exit 0.',
        'Shared token work is a citation to phase 30’s design-system reference; the manifest does not create a second token owner.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1', 'references/design-system.md from phase 30'], produces: ['expo.md'] },
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
            'Write the Nx contract. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md\',\'utf8\'),h=\'Generator,Post-steps,File tree,Conventions delta,testConventions,designHomes,Verify\'.split(\',\'),a=[\'npx create-nx-workspace@^23\',\'depConstraints\',\'generators.json\',\'emitted/repo-catalog.json\',\'nx:noop\',\'affected -t lint,typecheck,test,build\'];let p=-1;if(h.some(x=>(p=s.indexOf(\'## \'+x,p+1))<0)||(s.match(/^## /gm)||[]).length!==7||!a.every(x=>s.includes(x))||!/## File tree[\\s\\S]*```[^\\n]*\\n[^`\\n]+/.test(s)||!/## Verify\\s*\\n+`[^`]+`/.test(s)||/observed:|2026-09-03/.test(s))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            'Add both language options, five exclusions, and Verify paths including absent libs/. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md\',\'utf8\'),a=[\'TypeScript + Python (uv)\',\'Not generalized from zeroh\',\'CODEOWNERS\',\'tsdown\',\'three test runners\',\'radix-nova\',\'.building/\',\'nx.json\',\'package.json\',\'tsconfig.base.json\',\'packages/\',\'libs/\'];if(!a.every(x=>s.includes(x))||!/libs[^\\n]*(absent|not exist)|! -e libs/.test(s))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`nx-monorepo.md` contains all seven headings in contract order, uses a caret Nx range, and Verify requires nx.json, package.json, tsconfig.base.json and packages/ present with libs/ absent; the evidence row records its green scratch run.',
        'The manifest maps each prior-art seam to a concrete output: five tag axes + depConstraints, first-party generators.json, emitted/repo-catalog.json shape consumed by the README check, no base paths + Nx-synced solution tsconfig, affected four-target gate, and nx:noop.',
        'The TypeScript/Python choice is an option row inside this manifest, and all five zeroh-local exclusions are explicit.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1'], produces: ['nx-monorepo.md'] },
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
            'Write the library/CLI contract. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md\',\'utf8\'),h=\'Generator,Post-steps,File tree,Conventions delta,testConventions,designHomes,Verify\'.split(\',\'),a=[\'npm create vite@^8\',\'tsup: ^8.5\',\'exports\',\'bin\',\'files\',\'dts\',\'node --test\',\'--help\',\'tsup.config.ts\'];let p=-1;if(h.some(x=>(p=s.indexOf(\'## \'+x,p+1))<0)||(s.match(/^## /gm)||[]).length!==7||!a.every(x=>s.includes(x))||!/## File tree[\\s\\S]*```[^\\n]*\\n[^`\\n]+/.test(s)||!/## Verify\\s*\\n+`[^`]+`/.test(s)||/observed:|2026-09-03/.test(s))process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`library-cli.md` contains all seven headings in contract order, anchors Vite and tsup with caret ranges, and uses Node’s documented built-in test runner; the evidence row records the generator and Verify run.',
        'The documented package.json contract exposes library imports through `exports`, the executable through `bin`, limits publishing with `files`, and emits JavaScript plus declarations from tsup.',
        'Its Verify checks package.json, both named source entry modules and tsup.config.ts; its testConventions include `node --test` plus a built CLI `--help` smoke command.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1'], produces: ['library-cli.md'] },
    },
  ],
  notes:
    'interview: skipped — this is GREENFIELD arc member phase 31; the arc entity records the 2026-09-03 interview and six-archetype ruling. userFacing false: these are model-loaded reference manifests with no direct rendered or runtime user surface, so no feature flag applies. reviewScope none: the diff is documentation-only declarative reference content; schema validation and command/source rehearsal are higher-value than an implementation review chain. Documentation standard: plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/documentation-rules.md. Planned phase paths from dependencies are intentionally cited before phases 29/30 land. Orchestrator ruling: manifests remain timeless, cite package caret ranges, and contain only an exit-code command under Verify; plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md solely owns dated observations. Expo and library/CLI require scratch generation plus their manifest Verify on this box, matching web and Nx; unavailable Android/Flutter generators record an install remedy. Step verifies rehearse red-now because every target is absent, and each asserts the complete ordered-heading/content/tree/Verify contract its task creates. Assumption probes exited 0. External sources live in each manifest. Out of scope: scripts/CLI implementation, a seventh archetype, and phase 30 token-contract text. Review repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): ordered seven-heading checks; complete per-manifest contract checks; timeless manifests with one dated evidence record; Android minSdk claim narrowed; valid shadcn_flutter YAML; Expo and library/CLI scratch generation plus Verify required; metadata ratifications retained.',
})
