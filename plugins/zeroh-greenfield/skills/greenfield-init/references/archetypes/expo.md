# Expo mobile

Confirm Android/iOS targets and whether required native capabilities fit the selected workflow.

## Prerequisites and creation

Node/package manager plus required emulator/device tooling; an iOS simulator requires a supported Apple host.

Use the current approved Expo generator and inspect its actual output.

## Minimal shape and rationale

app/ or src/ according to selected template, a domain module, tests and README run instructions.

Share domain code where useful; isolate native APIs and platform-specific presentation.

## Run and test

Launch the first screen on each required available target and test a meaningful behavior. Report untested iOS or device features separately.

Record concrete commands after inspecting generated output. This recipe is guidance, not an observed platform acceptance result. Missing tooling or an unrun target remains unverified. Canonical architecture and test homes can be README sections.

Sources to check when selecting tooling: https://docs.expo.dev/get-started/create-a-project/ · https://docs.expo.dev/develop/unit-testing/
