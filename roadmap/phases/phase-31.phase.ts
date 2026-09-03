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
    'GREENFIELD arc plane `archetypes`; roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design items 3–4 and §Research digest; user ruling 2026-09-03 that v1 ships all six archetypes.',
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
        'greenfield-init lacks the web recipe. create-next-app, shadcn, and Tailwind are MIT (npm view probes) and tier `Allowed anywhere` under external-assets-licensing.md §The tiers, including in the shipped web client.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/README.md',
          description:
            'Define exact heading order and require a literal generator, non-empty tree, and exit-code Verify. Route observations only to the evidence record. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/README.md\',\'utf8\'),r=/^## Generator[\\s\\S]*^## Post-steps[\\s\\S]*^## File tree[\\s\\S]*^## Conventions delta[\\s\\S]*^## testConventions[\\s\\S]*^## designHomes[\\s\\S]*^## Verify/m;if(!r.test(s)||(s.match(/^## /gm)||[]).length!==7||![\'literal generator command\',\'non-empty\',\'exit-code command\',\'VERIFY-RECORD-2026-09.md\'].every(x=>s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
          description:
            'Assert web sources and license. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md\',\'utf8\'),a=[\'npx create-next-app@^16\',\'https://nextjs.org/docs/app/api-reference/cli/create-next-app\',\'https://ui.shadcn.com/docs/installation/next\',\'https://tailwindcss.com/docs/installation/framework-guides/nextjs\',\'MIT\',\'Allowed anywhere\',\'components.json\',\'registries\',\'Playwright\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*npx\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run web.md\'s Verify in a scratch directory; create the five-column evidence table and write only the web row. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),l=s.split(/\\r?\\n/),h=\'| archetype | date | command | observed | box |\',q=l.filter(x=>x===h),r=l.filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]!==\'archetype\'&&!/^[-:]+$/.test(x[0]));if(q.length!==1||r.length!==1||r[0].length!==5||r[0][0]!==\'web\'||!/^2026-09-03$/.test(r[0][1])||!r[0][2]||r[0][3]!==\'exit 0\'||!r[0][4])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'The README and web manifest each contain the seven required headings exactly once and in contract order; `web.md` cites `references/design-system.md` rather than copying its token contract.',
        '`web.md` cites create-next-app with a caret range and its Verify checks package.json, src/app/page.tsx and src/app/globals.css; the dated evidence row records the generator and Verify exit 0.',
        '`web.md` names the official Next.js and shadcn sources, Tailwind v4 CSS-first output, a concrete namespaced registry mapping, Playwright test convention, and the Flag-first delivery citation for generated consumer conventions.',
        '`VERIFY-RECORD-2026-09.md` has the exact archetype/date/command/observed/box header and exactly one five-cell data row, for web, with date, non-empty command and box, and observed `exit 0`.',
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
        'The native Android recipe is missing. The Android/Gradle project template is Apache-2.0 and tier `Allowed anywhere` under external-assets-licensing.md §The tiers, including in the shipped Android client (Gradle upstream LICENSE probe).',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md',
          description:
            'Assert Android sources and license. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md\',\'utf8\'),a=[\'https://developer.android.com/develop/ui/compose/setup-app\',\'https://developer.android.com/build\',\'https://developer.android.com/jetpack/androidx/releases/compose-material3\',\'https://developer.android.com/guide/topics/manifest/uses-sdk-element\',\'Apache-2.0\',\'Allowed anywhere\',\'minSdk = 23\',\'selected floor\',\'./gradlew test\',\'./gradlew connectedAndroidTest\'];if(a.some(x=>!s.includes(x))||/AndroidX minSdk 23 default/.test(s))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*gradle\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run this manifest\'s Verify in a scratch directory and append its android row to VERIFY-RECORD-2026-09.md. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]===\'android\');if(r.length!==1||r[0].length!==5||!/^2026-09-03$/.test(r[0][1])||!r[0][2]||!(r[0][3]===\'exit 0\'||/^generator absent — \\S/.test(r[0][3]))||!r[0][4])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`android.md` contains the seven headings in contract order and cites Android Developers for Kotlin-only Compose setup, Gradle KTS, Material 3, and API-level compatibility; minSdk 23 is explicitly this archetype’s selected floor, not a claimed AndroidX default.',
        'Its Verify checks executable `./gradlew` plus app/build.gradle.kts and app/src/main/AndroidManifest.xml; the Android evidence row records the absent generator and an install command.',
        'The conventions delta and literal testConventions distinguish local JUnit (`./gradlew test`) from device Compose tests (`./gradlew connectedAndroidTest`).',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md', 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1'], produces: ['android.md'] },
    },
    {
      id: '31.3',
      title: 'Author the Flutter archetype',
      problem:
        'The Flutter option is missing. Flutter is BSD-3-Clause and shadcn_flutter is MIT (Flutter LICENSE and pub.dev license probes); both are tier `Allowed anywhere` under external-assets-licensing.md §The tiers in the shipped client.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md',
          description:
            'Assert Flutter sources and licenses. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md\',\'utf8\'),a=[\'https://docs.flutter.dev/reference/create-new-app\',\'https://pub.dev/packages/shadcn_flutter\',\'flutter create\',\'shadcn_flutter: ^0.0.54\',\'BSD-3-Clause\',\'MIT\',\'Allowed anywhere\',\'flutter test\',\'pubspec.yaml\',\'lib/main.dart\',\'test/widget_test.dart\',\'references/design-system.md\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*flutter\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run this manifest\'s Verify in a scratch directory and append its flutter row to VERIFY-RECORD-2026-09.md. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]===\'flutter\');if(r.length!==1||r[0].length!==5||!/^2026-09-03$/.test(r[0][1])||!r[0][2]||!(r[0][3]===\'exit 0\'||/^generator absent — \\S/.test(r[0][3]))||!r[0][4])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`flutter.md` contains all seven headings in order, cites the official Flutter create command and pub.dev `shadcn_flutter: ^0.0.54`, and cites rather than restates phase 30’s token contract.',
        'Its Verify checks pubspec.yaml, lib/main.dart, and test/widget_test.dart; the Flutter evidence row records the absent generator with the official SDK install remedy.',
        'The literal testConventions value is `flutter test`, and designHomes bind both architecture and UX homes produced by greenfield-init.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md', 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1', 'references/design-system.md from phase 30'], produces: ['flutter.md'] },
    },
    {
      id: '31.4',
      title: 'Author the Expo archetype',
      problem:
        'The Expo option is missing. create-expo-app is BSD-3-Clause and @react-native-reusables/cli is MIT (npm view probes); both are tier `Allowed anywhere` under external-assets-licensing.md §The tiers in the shipped client.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md',
          description:
            'Assert Expo sources and licenses. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md\',\'utf8\'),a=[\'https://docs.expo.dev/get-started/create-a-project/\',\'https://github.com/mrzachnugent/react-native-reusables\',\'npx create-expo-app@^4\',\'npx @react-native-reusables/cli@^0.7\',\'BSD-3-Clause\',\'MIT\',\'Allowed anywhere\',\'package.json\',\'app.json\',\'references/design-system.md\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*npx\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run this manifest\'s Verify in a scratch directory and append its expo row to VERIFY-RECORD-2026-09.md. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]===\'expo\');if(r.length!==1||r[0].length!==5||!/^2026-09-03$/.test(r[0][1])||!r[0][2]||r[0][3]!==\'exit 0\'||!r[0][4])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`expo.md` contains the seven headings in contract order and cites the official Expo SDK 57 generator and React Native Reusables CLI rather than the nonexistent unscoped npm package.',
        'Its Verify checks package.json, app.json, and the generated app directory; the evidence row records successful create-expo-app scratch generation and the manifest Verify exit 0.',
        'Shared token work is a citation to phase 30’s design-system reference; the manifest does not create a second token owner.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md', 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1', 'references/design-system.md from phase 30'], produces: ['expo.md'] },
    },
    {
      id: '31.5',
      title: 'Author the zeroh-proven Nx monorepo archetype',
      problem:
        'The Nx recipe must preserve the proven zeroh seams. create-nx-workspace is MIT (npm view probe) and tier `Allowed anywhere` under external-assets-licensing.md §The tiers as repository tooling.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            'Assert Nx source and license. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md\',\'utf8\'),a=[\'https://nx.dev/getting-started/installation\',\'npx create-nx-workspace@^23\',\'MIT\',\'Allowed anywhere\',\'depConstraints\',\'generators.json\',\'emitted/repo-catalog.json\',\'nx:noop\',\'affected -t lint,typecheck,test,build\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*npx\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            'Add both language options, five exclusions, and Verify paths including absent libs/. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md\',\'utf8\'),a=[\'TypeScript + Python (uv)\',\'Not generalized from zeroh\',\'CODEOWNERS\',\'tsdown\',\'three test runners\',\'radix-nova\',\'.building/\',\'nx.json\',\'package.json\',\'tsconfig.base.json\',\'packages/\',\'libs/\'];if(!a.every(x=>s.includes(x))||!/libs[^\\n]*(absent|not exist)|! -e libs/.test(s))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run this manifest\'s Verify in a scratch directory and append its nx-monorepo row to VERIFY-RECORD-2026-09.md. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]===\'nx-monorepo\');if(r.length!==1||r[0].length!==5||!/^2026-09-03$/.test(r[0][1])||!r[0][2]||r[0][3]!==\'exit 0\'||!r[0][4])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`nx-monorepo.md` contains all seven headings in contract order, uses a caret Nx range, and Verify requires nx.json, package.json, tsconfig.base.json and packages/ present with libs/ absent; the evidence row records its green scratch run.',
        'The manifest maps each prior-art seam to a concrete output: five tag axes + depConstraints, first-party generators.json, emitted/repo-catalog.json shape consumed by the README check, no base paths + Nx-synced solution tsconfig, affected four-target gate, and nx:noop.',
        'The TypeScript/Python choice is an option row inside this manifest, and all five zeroh-local exclusions are explicit.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md', 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1'], produces: ['nx-monorepo.md'] },
    },
    {
      id: '31.6',
      title: 'Author the publish-ready TypeScript library/CLI archetype',
      problem:
        'The library/CLI recipe is missing. Vite, tsup, and Vitest are MIT (npm view probes) and tier `Allowed anywhere` under external-assets-licensing.md §The tiers as repository tooling and published package code.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md',
          description:
            'Assert library sources and licenses. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md\',\'utf8\'),a=[\'https://vite.dev/guide/\',\'https://tsup.egoist.dev/\',\'https://nodejs.org/api/test.html\',\'npx create-vite@^8\',\'tsup: ^8.5\',\'vitest: ^\',\'MIT\',\'Allowed anywhere\',\'exports\',\'bin\',\'files\',\'dts\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*npx\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run this manifest\'s Verify in a scratch directory and append its library-cli row to VERIFY-RECORD-2026-09.md. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]===\'library-cli\');if(r.length!==1||r[0].length!==5||!/^2026-09-03$/.test(r[0][1])||!r[0][2]||r[0][3]!==\'exit 0\'||!r[0][4])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`library-cli.md` contains all seven headings in contract order, anchors Vite and tsup with caret ranges, and uses Node’s documented built-in test runner; the evidence row records the generator and Verify run.',
        'The documented package.json contract exposes library imports through `exports`, the executable through `bin`, limits publishing with `files`, and emits JavaScript plus declarations from tsup.',
        'Its Verify checks package.json, both named source entry modules and tsup.config.ts; its testConventions include `node --test` plus a built CLI `--help` smoke command.',
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),a=[\'web\',\'android\',\'flutter\',\'expo\',\'nx-monorepo\',\'library-cli\'],r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]!==\'archetype\'&&!/^[-:]+$/.test(x[0]));if(r.length!==6||a.some(n=>r.filter(x=>x[0]===n).length!==1)||r.some(x=>x.length!==5||!x[1]||!x[2]||!x[3]||!x[4]))process.exit(1)"',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md', 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md'],
      testMode: 'none',
      done: false,
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1'], produces: ['library-cli.md'] },
    },
  ],
  notes:
    'interview: skipped — this is GREENFIELD arc member phase 31; the arc entity records the 2026-09-03 interview and six-archetype ruling. userFacing false: these are model-loaded reference manifests with no direct rendered or runtime user surface, so no feature flag applies. reviewScope none: the diff is documentation-only declarative reference content; schema validation and command/source rehearsal are higher-value than an implementation review chain. Documentation standard: plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/documentation-rules.md. Planned phase paths from dependencies are intentionally cited before phases 29/30 land. Orchestrator ruling: manifests remain timeless, cite package caret ranges, and contain only an exit-code command under Verify; plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md solely owns dated observations. Expo and library/CLI require scratch generation plus their manifest Verify on this box, matching web and Nx; unavailable Android/Flutter generators record an install remedy. Step verifies rehearse red-now because every target is absent, and each asserts the complete ordered-heading/content/tree/Verify contract its task creates. Assumption probes exited 0. External sources live in each manifest. Out of scope: scripts/CLI implementation, a seventh archetype, and phase 30 token-contract text.\nMetadata ratifications 2026-09-03: 31.1: create-next-app MIT + shadcn MIT + tailwindcss MIT → Allowed anywhere.\nMetadata ratifications 2026-09-03: 31.2: Android/Gradle template Apache-2.0 → Allowed anywhere.\nMetadata ratifications 2026-09-03: 31.3: flutter BSD-3-Clause + shadcn_flutter MIT → Allowed anywhere.\nMetadata ratifications 2026-09-03: 31.4: create-expo-app BSD-3-Clause + @react-native-reusables/cli MIT → Allowed anywhere.\nMetadata ratifications 2026-09-03: 31.5: create-nx-workspace MIT → Allowed anywhere.\nMetadata ratifications 2026-09-03: 31.6: vite MIT + tsup MIT + vitest MIT → Allowed anywhere.\nReview repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): ordered seven-heading checks; complete per-manifest contract checks; timeless manifests with one dated evidence record; Android minSdk claim narrowed; valid shadcn_flutter YAML; Expo and library/CLI scratch generation plus Verify required.\nReview repairs round 2 2026-09-03: ratified every external license and placement tier; required official source and license text; enforced complete timeless manifest sections; parsed six evidence rows structurally.\nReview repairs round 3 2026-09-03: evidence-row ownership follows manifest ownership; 31.1 creates the five-column schema and web row only; 31.2–31.6 append and structurally verify their own rows; 31.6 gates the final six-row aggregate; scratch row assertions exited red=1 and green=0.',
})
