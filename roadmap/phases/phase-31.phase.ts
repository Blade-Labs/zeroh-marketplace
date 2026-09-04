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
  status: 'in-progress',
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
        'greenfield-init lacks the web recipe. GREENFIELD.arc.ts `criteriaRatifications` (2026-09-03 phase-31 review QUESTION) ratifies timeless manifests with dated observations in VERIFY-RECORD-2026-09.md. create-next-app, shadcn, and Tailwind are MIT (npm view probes) and tier `Allowed anywhere` under external-assets-licensing.md §The tiers, including in the shipped web client.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/README.md',
          description:
            'Define exact heading order and require a literal generator, non-empty tree, and exit-code Verify. Route observations only to the evidence record. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/README.md\',\'utf8\'),r=/^## Generator[\\s\\S]*^## Post-steps[\\s\\S]*^## File tree[\\s\\S]*^## Conventions delta[\\s\\S]*^## testConventions[\\s\\S]*^## designHomes[\\s\\S]*^## Verify/m;if(!r.test(s)||(s.match(/^## /gm)||[]).length!==7||![\'literal generator command\',\'non-empty\',\'exit-code command\',\'VERIFY-RECORD-2026-09.md\'].every(x=>s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
          description:
            'Assert web contract tokens. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md\',\'utf8\'),a=[\'npx create-next-app@^16\',\'https://nextjs.org/docs/app/api-reference/cli/create-next-app\',\'https://ui.shadcn.com/docs/installation/next\',\'https://tailwindcss.com/docs/installation/framework-guides/nextjs\',\'MIT\',\'Allowed anywhere\',\'references/design-system.md\',\'src/app/page.tsx\',\'src/app/globals.css\',\'Tailwind v4\',\'CSS-first\',\'Flag-first delivery\',\'components.json\',\'registries\',\'@magicui\',\'https://magicui.design/r/{name}.json\',\'beautifului.dev\',\'Playwright\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*npx\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
          description:
            'Bind promised web files to Verify and require one concrete namespaced registry mapping. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md\',\'utf8\'),m=[...s.matchAll(/^## (.+)$/gm)],b=s.slice(m[6].index),a=[\'package.json\',\'src/app/page.tsx\',\'src/app/globals.css\'];if(a.some(x=>!b.includes(x))||!s.includes(\'@magicui: https://magicui.design/r/{name}.json\'))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run web.md\'s Verify in a scratch directory; create the seven-column evidence table and write only the web row. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),l=s.split(/\\r?\\n/),h=\'| archetype | date | command | observed | box | tool version | execution commit |\',q=l.filter(x=>x===h),r=l.filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]!==\'archetype\'&&!/^[-:]+$/.test(x[0]));if(q.length!==1||r.length!==1||r[0].length!==7||r[0][0]!==\'web\'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r[0][1])||!r[0][2]||r[0][3]!==\'exit 0\'||!r[0][4]||!r[0][5]||!r[0][6])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        'The README and web manifest each contain the seven required headings exactly once and in contract order; `web.md` cites `references/design-system.md` rather than copying its token contract.',
        '`web.md` cites create-next-app with a caret range and its Verify checks package.json, src/app/page.tsx and src/app/globals.css; the dated evidence row records the generator and Verify exit 0 plus tool version and execution commit.',
        '`web.md` names the official Next.js and shadcn sources, Tailwind v4 CSS-first output, a concrete namespaced registry mapping, Playwright test convention, and the Flag-first delivery citation for generated consumer conventions.',
        '`VERIFY-RECORD-2026-09.md` has the exact archetype/date/command/observed/box/tool-version/execution-commit header and exactly one seven-cell data row, for web, with actual execution date, non-empty command/box/tool version/execution commit, and observed `exit 0`.',
      ],
      files: [
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/README.md',
        'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/web.md',
        'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
      ],
      testMode: 'none',
      done: true,
      doneDate: '2026-09-04',
      transparencyReport: {
        whatWasDone: 'Defined the seven-heading archetype manifest contract, authored the web archetype, and created the single dated verification evidence table.',
        how: 'The web manifest binds create-next-app, official Next.js/shadcn/Tailwind sources, CSS-first output, registry mapping, Playwright, design homes, and a one-line file-shape Verify. A real isolated create-next-app 16.3.4 run completed successfully and its Verify passed; the evidence row records the host, tool version, command, exit, and execution commit. All five task checks passed and the types slot was declared-none and green.',
        compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'None',
      },
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
            'Assert Android sources, stack statements, and license. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md\',\'utf8\'),a=[\'https://developer.android.com/develop/ui/compose/setup-app\',\'https://developer.android.com/build\',\'https://developer.android.com/jetpack/androidx/releases/compose-material3\',\'https://developer.android.com/guide/topics/manifest/uses-sdk-element\',\'Kotlin-only\',\'Gradle KTS\',\'Material 3\',\'Apache-2.0\',\'Allowed anywhere\',\'minSdk = 23\',\'selected floor\'];if(a.some(x=>!s.includes(x))||/AndroidX minSdk 23 default/.test(s))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*gradle\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md',
          description:
            'Bind promised commands to their sections and require concrete Verify checks. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md\',\'utf8\'),m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),c=[\'./gradlew test\',\'./gradlew connectedAndroidTest\'],v=[\'test -x ./gradlew\',\'app/build.gradle.kts\',\'app/src/main/AndroidManifest.xml\'];if(c.some(x=>!b(3).includes(x)||!b(4).includes(x))||v.some(x=>!b(6).includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run Verify in scratch and append the Android absent-generator/install row. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]===\'android\'),o=/^unavailable — (?:sudo |brew |apt(?:-get)? |sdkmanager |snap |curl )\\S.*$/;if(r.length!==1||r[0].length!==7||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r[0][1])||!r[0][2]||!o.test(r[0][3])||!r[0][4]||!r[0][5]||!r[0][6])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`android.md` contains the seven headings in contract order and cites Android Developers for Kotlin-only Compose setup, Gradle KTS, Material 3, and API-level compatibility; minSdk 23 is explicitly this archetype’s selected floor, not a claimed AndroidX default.',
        'Its Verify checks executable `./gradlew` plus app/build.gradle.kts and app/src/main/AndroidManifest.xml; the Android evidence row records the absent generator and an install command.',
        'The conventions delta and literal testConventions distinguish local JUnit (`./gradlew test`) from device Compose tests (`./gradlew connectedAndroidTest`).',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/android.md', 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md'],
      testMode: 'none',
      done: true,
      doneDate: '2026-09-04',
      transparencyReport: {
        whatWasDone: 'Authored the native Android archetype and appended its honest unavailable-generator evidence row.',
        how: 'The manifest binds Kotlin-only Compose, Gradle KTS, Material 3, the selected minSdk floor, local and device tests, design homes, and concrete wrapper/build/manifest checks. The host probe confirmed Gradle is unavailable, so the evidence records a sdkmanager remedy rather than a green generation claim. All four task checks passed and the types slot was declared-none and green.',
        compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'None',
      },
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1'], produces: ['android.md'] },
    },
    {
      id: '31.3',
      title: 'Author the Flutter archetype',
      problem:
        'The Flutter option is missing. Flutter and shadcn_flutter 0.0.54 are BSD-3-Clause and tier `Allowed anywhere` under external-assets-licensing.md §The tiers in the shipped client; the latter is ratified by `curl -fsSL https://pub.dev/api/archives/shadcn_flutter-0.0.54.tar.gz | tar -xzO LICENSE`.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md',
          description:
            'Assert Flutter sources, BSD licenses, token citation, tests, and paths. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md\',\'utf8\'),a=[\'https://docs.flutter.dev/reference/create-new-app\',\'https://pub.dev/packages/shadcn_flutter\',\'flutter create\',\'shadcn_flutter: ^0.0.54\',\'Flutter: BSD-3-Clause\',\'shadcn_flutter 0.0.54: BSD-3-Clause\',\'Allowed anywhere\',\'flutter test\',\'pubspec.yaml\',\'lib/main.dart\',\'test/widget_test.dart\',\'references/design-system.md\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*flutter\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md',
          description:
            'Require both design-home bindings plus promised test and Verify paths in their sections. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md\',\'utf8\'),m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),d=[\'designHomes.architecture.home\',\'designHomes.ux.canon\'],p=[\'pubspec.yaml\',\'lib/main.dart\',\'test/widget_test.dart\'];if(d.some(x=>!b(5).includes(x))||!b(4).includes(\'flutter test\')||p.some(x=>!b(6).includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run Verify in scratch and append the Flutter absent-generator/install row. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]===\'flutter\'),o=/^unavailable — (?:brew |apt(?:-get)? |snap |curl )\\S.*$/;if(r.length!==1||r[0].length!==7||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r[0][1])||!r[0][2]||!o.test(r[0][3])||!r[0][4]||!r[0][5]||!r[0][6])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`flutter.md` contains all seven headings in order, cites the official Flutter create command and pub.dev `shadcn_flutter: ^0.0.54`, and cites rather than restates phase 30’s token contract.',
        'Its Verify checks pubspec.yaml, lib/main.dart, and test/widget_test.dart; the Flutter evidence row records the absent generator with an SDK install command.',
        'The literal testConventions value is `flutter test`, and designHomes bind both architecture and UX homes produced by greenfield-init.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/flutter.md', 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md'],
      testMode: 'none',
      done: true,
      doneDate: '2026-09-04',
      transparencyReport: {
        whatWasDone: 'Authored the Flutter archetype and appended its honest unavailable-SDK evidence row.',
        how: 'The manifest binds the official generator, shadcn_flutter caret dependency and licenses, shared design reference, generated files, Flutter tests, and both design homes. The host probe confirmed Flutter is unavailable, so the evidence records an SDK install remedy rather than a green run. All four task checks passed and the types slot was declared-none and green.',
        compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'None',
      },
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
            'Assert Expo sources, SDK, generated path, token citation, and licenses. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md\',\'utf8\'),a=[\'https://docs.expo.dev/get-started/create-a-project/\',\'https://github.com/mrzachnugent/react-native-reusables\',\'npx create-expo-app@^4\',\'npx @react-native-reusables/cli@^0.7\',\'SDK 57\',\'BSD-3-Clause\',\'MIT\',\'Allowed anywhere\',\'package.json\',\'app.json\',\'my-app/app/\',\'references/design-system.md\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*npx\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md',
          description:
            'Require the generated app path in the tree and all promised targets in Verify. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md\',\'utf8\'),m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index);if(!b(2).includes(\'my-app/app/\')||![\'package.json\',\'app.json\',\'test -d my-app/app\'].every(x=>b(6).includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run this manifest\'s Verify in a scratch directory and append its expo row to VERIFY-RECORD-2026-09.md. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]===\'expo\');if(r.length!==1||r[0].length!==7||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r[0][1])||!r[0][2]||r[0][3]!==\'exit 0\'||!r[0][4]||!r[0][5]||!r[0][6])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`expo.md` contains the seven headings in contract order and cites the official Expo SDK 57 generator and React Native Reusables CLI rather than the nonexistent unscoped npm package.',
        'Its Verify checks package.json, app.json, and the generated app directory; the evidence row records successful create-expo-app scratch generation and the manifest Verify exit 0.',
        'Shared token work is a citation to phase 30’s design-system reference; the manifest does not create a second token owner.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/expo.md', 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md'],
      testMode: 'none',
      done: true,
      transparencyReport: {
        whatWasDone: 'Authored the Expo archetype and appended its successful scratch-generation evidence row.',
        how: 'The manifest binds the official SDK 57 generator, React Native Reusables CLI, licenses, shared design reference, generated-file contract, tests, and design homes. create-expo-app 4.0.0 completed on the shared host; its current SDK 57 template placed routes under src/app, so the scratch rehearsal moved that compatibility path to the plan-ratified app location before the one-line manifest Verify passed. All four task checks and the declared-none types slot passed.',
        compromises: 'The current SDK 57 template emits src/app while the ratified phase contract requires app; the evidence command records the compatibility move explicitly.', skipped: 'None', hardcoded: 'None', limitations: 'The path move was rehearsed only in disposable scratch output.',
      },
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
            'Assert Nx source, license, and every proven seam. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md\',\'utf8\'),a=[\'https://nx.dev/getting-started/installation\',\'npx create-nx-workspace@^23\',\'MIT\',\'Allowed anywhere\',\'type:\',\'scope:\',\'domain:\',\'kind:\',\'stability:\',\'depConstraints\',\'generators.json\',\'emitted/repo-catalog.json\',\'README\',\'no base paths\',\'Nx-synced solution tsconfig\',\'nx:noop\',\'affected -t lint,typecheck,test,build\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*npx\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            'Add both language options, five exclusions, and Verify paths including absent libs/. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md\',\'utf8\'),a=[\'TypeScript only\',\'TypeScript + Python (uv)\',\'Not generalized from zeroh\',\'CODEOWNERS\',\'tsdown\',\'three test runners\',\'radix-nova\',\'.building/\',\'nx.json\',\'package.json\',\'tsconfig.base.json\',\'packages/\',\'libs/\'];if(!a.every(x=>s.includes(x))||!/libs[^\\n]*(absent|not exist)|! -e libs/.test(s))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md',
          description:
            'Require tag axes, option row, catalog/TypeScript contracts, and exact Verify targets. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md\',\'utf8\'),a=[\'type:\',\'scope:\',\'domain:\',\'kind:\',\'stability:\'],m=[...s.matchAll(/^## (.+)$/gm)],v=s.slice(m[6].index),p=[\'nx.json\',\'package.json\',\'tsconfig.base.json\',\'packages/\',\'test ! -e libs\'];if(a.some(x=>!s.includes(x))||p.some(x=>!v.includes(x))||!/^\\|.*TypeScript \\+ Python \\(uv\\).*\\|$/m.test(s)||!s.includes(\'README consumes emitted/repo-catalog.json\')||!s.includes(\'compilerOptions.paths absent\')||!s.includes(\'Nx-synced solution tsconfig\'))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run this manifest\'s Verify in a scratch directory and append its nx-monorepo row to VERIFY-RECORD-2026-09.md. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]===\'nx-monorepo\');if(r.length!==1||r[0].length!==7||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r[0][1])||!r[0][2]||r[0][3]!==\'exit 0\'||!r[0][4]||!r[0][5]||!r[0][6])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`nx-monorepo.md` contains all seven headings in contract order, uses a caret Nx range, and Verify requires nx.json, package.json, tsconfig.base.json and packages/ present with libs/ absent; the evidence row records its green scratch run.',
        'The manifest maps each prior-art seam to a concrete output: five tag axes + depConstraints, first-party generators.json, emitted/repo-catalog.json shape consumed by the README check, no base paths + Nx-synced solution tsconfig, affected four-target gate, and nx:noop.',
        'The TypeScript/Python choice is an option row inside this manifest, and all five zeroh-local exclusions are explicit.',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/nx-monorepo.md', 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md'],
      testMode: 'none',
      done: true,
      transparencyReport: {
        whatWasDone: 'Authored the zeroh-proven Nx monorepo archetype and appended its successful scratch evidence row.',
        how: 'The manifest maps the ratified Nx seams to a concrete generator, language option table, five tag axes, dependency constraints, generator/catalog contracts, TypeScript layout, affected gate, nx:noop, exclusions, design homes, and one-line Verify. create-nx-workspace 23.2.0 generated the integrated TypeScript workspace and the manifest Verify passed. All five task checks and the declared-none types slot passed.',
        compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'The scratch rehearsal validates the generated root contract; consumer-specific projects remain intentionally ungenerated.',
      },
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1'], produces: ['nx-monorepo.md'] },
    },
    {
      id: '31.6',
      title: 'Author the publish-ready TypeScript library/CLI archetype',
      problem:
        'The library/CLI recipe is missing. Vite and tsup are MIT (npm view probes) and tier `Allowed anywhere` under external-assets-licensing.md §The tiers as repository tooling and published package code.',
      steps: [
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md',
          description:
            'Assert library sources, licenses, package contract, entries, and test commands. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md\',\'utf8\'),a=[\'https://vite.dev/guide/\',\'https://tsup.egoist.dev/\',\'https://nodejs.org/api/test.html\',\'npx create-vite@^8\',\'tsup: ^8.5\',\'MIT\',\'Allowed anywhere\',\'exports\',\'bin\',\'files\',\'dts\',\'src/index.ts\',\'src/cli.ts\',\'tsup.config.ts\',\'node --test\',\'node dist/cli.js --help\'];if(a.some(x=>!s.includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md',
          description:
            'Shape. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md\')+\'\',h=\'Generator|Post-steps|File tree|Conventions delta|testConventions|designHomes|Verify\',m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),f=x=>[...x.matchAll(/```[^\\n]*\\n([\\s\\S]*?)```/g)],t=f(b(2)),v=f(b(6));if(m.map(x=>x[1]).join(\'|\')!==h||!/```[^\\n]*\\n\\s*npx\\b/.test(b(0))||!(t[0]?.[1].trim().split(\'\\n\').length>=5)||(b(4).match(/`[^`]+`|\"[^\"]+\"/g)||[]).length<2||!b(5).includes(\'designHomes.ux.canon\')||v.length!==1||/\\n/.test(v[0][1].trim())||/observed:|20\\d\\d-\\d\\d-\\d\\d/.test(b(6)))throw 0"',
        },
        {
          file: 'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md',
          description:
            'Bind both entries and tsup config to Verify, and both test commands to testConventions and Verify. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md\',\'utf8\'),m=[...s.matchAll(/^## (.+)$/gm)],b=n=>s.slice(m[n].index,m[n+1]?.index),p=[\'src/index.ts\',\'src/cli.ts\',\'tsup.config.ts\'],c=[\'node --test\',\'node dist/cli.js --help\'];if(p.some(x=>!b(6).includes(x))||c.some(x=>!b(4).includes(x)||!b(6).includes(x)))process.exit(1)"',
        },
        {
          file: 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md',
          description:
            'Run this manifest\'s Verify in a scratch directory and append its library-cli row to VERIFY-RECORD-2026-09.md. → verify: node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]===\'library-cli\');if(r.length!==1||r[0].length!==7||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r[0][1])||!r[0][2]||r[0][3]!==\'exit 0\'||!r[0][4]||!r[0][5]||!r[0][6])process.exit(1)"',
        },
      ],
      acceptanceCriteria: [
        '`library-cli.md` contains all seven headings in contract order, anchors Vite and tsup with caret ranges, and uses Node’s documented built-in test runner; the evidence row records the generator and Verify run.',
        'The documented package.json contract exposes library imports through `exports`, the executable through `bin`, limits publishing with `files`, and emits JavaScript plus declarations from tsup.',
        'Its Verify checks package.json, both named source entry modules and tsup.config.ts; its testConventions include `node --test` plus a built CLI `--help` smoke command.',
        'node -e "const s=require(\'fs\').readFileSync(\'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md\',\'utf8\'),a=[\'web\',\'android\',\'flutter\',\'expo\',\'nx-monorepo\',\'library-cli\'],r=s.split(/\\r?\\n/).filter(x=>/^\\|/.test(x)).map(x=>x.split(\'|\').slice(1,-1).map(y=>y.trim())).filter(x=>x[0]!==\'archetype\'&&!/^[-:]+$/.test(x[0])),o=/^unavailable — (?:sudo |brew |apt(?:-get)? |sdkmanager |flutter |snap |npx |curl )\\S.*$/;if(r.length!==6||a.some(n=>r.filter(x=>x[0]===n).length!==1)||r.some(x=>x.length!==7||!x[1]||!x[2]||!(x[3]===\'exit 0\'||o.test(x[3]))||!x[4]||!x[5]||!x[6]||!/^[0-9a-f]{7,40}$/.test(x[6])))process.exit(1)"',
      ],
      files: ['plugins/zeroh-greenfield/skills/greenfield-init/references/archetypes/library-cli.md', 'plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md'],
      testMode: 'none',
      done: true,
      transparencyReport: {
        whatWasDone: 'Authored the publish-ready TypeScript library/CLI archetype and appended its successful scratch evidence row.',
        how: 'The manifest binds Vite, tsup, the package exports/bin/files contract, separate API and CLI entries, declarations, Node test runner, built help smoke, shared design homes, and a one-line Verify. A create-vite 8.3.0 scratch was adapted to the documented tsup 8.5.1 contract; its build, one Node test, CLI help, and complete manifest Verify passed under capbuild. All four task checks and the declared-none types slot passed.',
        compromises: 'The first declaration build exposed the generated Vite tsconfig’s browser-only types; the scratch recipe added @types/node and the node type before the successful rerun.', skipped: 'None', hardcoded: 'None', limitations: 'The scratch package was not published to a registry.',
      },
      dependsOn: ['31.1'],
      interfaces: { consumes: ['archetype heading contract from 31.1', 'VERIFY-RECORD-2026-09.md evidence schema from 31.1'], produces: ['library-cli.md'] },
    },
  ],
  reviewRecord: { date: '2026-09-04', model: 'gpt-5.6-sol', verdict: 'READY', via: 'executed' },
  notes:
    'Review repairs round 6 2026-09-03 (orchestrator, mechanical, no-invented-registries rail): the web manifest\'s namespaced registry example is Magic UI (`@magicui: https://magicui.design/r/{name}.json`; probe 2026-09-03: curl -fsSI https://magicui.design/r/marquee.json → 200; beautifului.dev DOES expose shadcn registry items (probe 2026-09-03: https://www.beautifului.dev/r/button.json → HTTP 200, type registry:ui; an earlier probe of a non-existent item name returned 404 and was misread as a missing registry) — Magic UI is the SELECTED namespaced registry example here and beautifului.dev is cited as a copy-paste source; a consumer may add it as a second registry entry, which is a selection, not a capability claim); 31.5 asserts both language-axis rows (TypeScript only · TypeScript + Python (uv)); 31.6 drops Vitest from the ratified tsup + node:test recipe and its licensing line. ' +
    'interview: skipped — this is GREENFIELD arc member phase 31; the arc entity records the 2026-09-03 interview and six-archetype ruling. userFacing false: these are model-loaded reference manifests with no direct rendered or runtime user surface, so no feature flag applies. reviewScope none: the diff is documentation-only declarative reference content; schema validation and command/source rehearsal are higher-value than an implementation review chain. Documentation standard: plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/documentation-rules.md. Planned phase paths from dependencies are intentionally cited before phases 29/30 land. Orchestrator ruling: manifests remain timeless, cite package caret ranges, and contain only an exit-code command under Verify; plugins/zeroh-greenfield/VERIFY-RECORD-2026-09.md solely owns dated observations. Expo and library/CLI require scratch generation plus their manifest Verify on this box, matching web and Nx; unavailable Android/Flutter generators record an install remedy and are not counted green. Step verifies rehearse red-now because every target is absent, and each asserts the complete ordered-heading/content/tree/Verify contract its task creates. Assumption probes exited 0. External sources live in each manifest. Out of scope: scripts/CLI implementation, a seventh archetype, and phase 30 token-contract text.\nMetadata ratifications 2026-09-03: 31.1: create-next-app MIT + shadcn MIT + tailwindcss MIT → Allowed anywhere; Magic UI registry example MIT (probe: GitHub API repos/magicuidesign/magicui/license 2026-09-03) → Allowed anywhere as a namespaced registry the consumer opts into; beautifului.dev MIT (site footer, probed 2026-09-03) → Allowed anywhere as a cited copy-paste source; it also serves shadcn registry items (see the round-8 probe) but is not the selected registry example.\nMetadata ratifications 2026-09-03: 31.2: Android/Gradle template Apache-2.0 → Allowed anywhere.\nMetadata ratifications 2026-09-03: 31.3: flutter BSD-3-Clause + shadcn_flutter 0.0.54 BSD-3-Clause → Allowed anywhere; probe: `curl -fsSL https://pub.dev/api/archives/shadcn_flutter-0.0.54.tar.gz | tar -xzO LICENSE`.\nMetadata ratifications 2026-09-03: 31.4: create-expo-app BSD-3-Clause + @react-native-reusables/cli MIT → Allowed anywhere.\nMetadata ratifications 2026-09-03: 31.5: create-nx-workspace MIT → Allowed anywhere.\nMetadata ratifications 2026-09-03: 31.6: vite MIT + tsup MIT → Allowed anywhere (Vitest removed from the ratified tsup + node:test recipe in round 6).\nReview repairs round 2 2026-09-03: ratified every external license and placement tier; required official source and license text; enforced complete timeless manifest sections; parsed six evidence rows structurally.\nReview repairs round 3 2026-09-03: evidence-row ownership follows manifest ownership; 31.1 creates the seven-column schema and web row only; 31.2–31.6 append and structurally verify their own rows; 31.6 gates the final six-row aggregate; scratch row assertions exited red=1 and green=0.\nArc ratification 2026-09-03: roadmap/arcs/GREENFIELD.arc.ts `criteriaRatifications` phase-31 review QUESTION and roadmap/arc-prompts/GREENFIELD-execution-prompt.md §Design item 3 make manifests timeless and place observed results in VERIFY-RECORD-2026-09.md.\nReview repairs 2026-09-03 (Mode A gpt-5.6-sol, BLOCKED → repaired by codex gpt-5.6-sol): 31.1 asserts design-system/page/globals/Tailwind-v4/CSS-first/Flag-first/registry and Verify bindings; 31.2 asserts Kotlin-only/Gradle-KTS/Material-3 plus section-bound Gradle paths and absent-generator evidence; 31.3 corrects shadcn_flutter 0.0.54 to BSD-3-Clause with its archive probe and asserts both designHomes bindings; 31.4 asserts SDK 57 and my-app/app/ in tree and Verify; 31.5 asserts five tag axes, no base paths, Nx-synced solution tsconfig, emitted-catalog README consumption, and the option row; 31.6 asserts both entries, tsup.config.ts, node --test, and built CLI --help in testConventions and Verify; round-5 scratch rehearsal exit codes red=1 and green=0 for every added predicate.',
})
