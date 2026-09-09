# Android

Confirm Android-only, required device APIs, offline needs and minimum supported device constraints.

## Prerequisites and creation

Selected Android SDK/JDK, Gradle wrapper and usable emulator or device.

Use Android Studio project creation or the approved Android scaffold; Kotlin/Compose is an example, not a mandatory choice.

## Minimal shape and rationale

app/ with entry screen and domain/data seams, unit tests and device tests as needed; README prerequisites and run instructions.

Keep platform APIs behind a narrow boundary when it enables a useful local test.

## Run and test

Build using the project wrapper, launch on an emulator/device and test the first behavior. Run a local unit test and device test when the behavior depends on Android APIs.

Record concrete commands after inspecting generated output. This recipe is guidance, not an observed platform acceptance result. Missing tooling or an unrun target remains unverified. Canonical architecture and test homes can be README sections.

Sources to check when selecting tooling: https://developer.android.com/studio/projects/create-project · https://developer.android.com/training/testing
