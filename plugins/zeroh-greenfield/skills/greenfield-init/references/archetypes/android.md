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
test -x ./gradlew && test -f app/build.gradle.kts && test -f app/src/main/AndroidManifest.xml
```
