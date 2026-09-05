## Generator
```sh
gradle init --type basic --dsl kotlin --project-name my-app
```

Follow the Kotlin-only Compose setup at
https://developer.android.com/develop/ui/compose/setup-app and Gradle KTS build
guidance at https://developer.android.com/build. The Gradle template is
Apache-2.0, tier `Allowed anywhere`.

## Post-steps
Create the Android application module with Compose and Material 3 from
https://developer.android.com/jetpack/androidx/releases/compose-material3.
Set `minSdk = 23` as this archetype's selected floor after checking API needs
against https://developer.android.com/guide/topics/manifest/uses-sdk-element.
It is not an AndroidX default.

## File tree
```text
my-app/
  gradlew
  settings.gradle.kts
  app/build.gradle.kts
  app/src/main/AndroidManifest.xml
```

## Conventions delta
Use Gradle KTS and Kotlin-only sources. Local JVM tests run `./gradlew test`;
device Compose tests run `./gradlew connectedAndroidTest`.

## testConventions
Bind `./gradlew test` to unit tests and `./gradlew connectedAndroidTest` to
device integration tests.

## designHomes
Set `designHomes.architecture.home` to `docs/architecture.md` and
`designHomes.ux.canon` to `docs/ux-canon.md`; translate the approved Material 3
mapping from `references/design-system.md`.

## Verify
```sh
test -x ./gradlew && test -f app/build.gradle.kts && test -f app/src/main/AndroidManifest.xml && node scripts/check-readme-catalog.mjs --project-root .
```

## CI and release adapter

Select `android` in `.github/greenfield-delivery.json` and follow
[the shared CI/release strategy](../ci-release-strategy.md) for its exact inventory,
executor, raw report, coverage merge and build contract. Bind runner/build argv
into the shard manifest before execution; require exact-once leaf/file selection.
Generate `scripts/ci-shard-plan.mjs`, `.github/workflows/ci.yml` and
`.github/workflows/release.yml` only from the approved preservation plan.
Missing tooling/reporters are unavailable with the adapter install remedy.
Affected PR checks backstop into authoritative full shards on main/manual runs;
release promotes the same verified artifact bytes without rebuilding.
