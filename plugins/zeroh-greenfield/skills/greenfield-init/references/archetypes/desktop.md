# Desktop

Confirm operating systems, filesystem/native integration, permission and distribution needs.

## Prerequisites and creation

The selected framework SDK and target OS toolchain. Native packaging may require a matching host.

Tauri, Electron, Flutter or platform-native tooling are examples. Choose by requirements and verify the selected official generator.

## Minimal shape and rationale

Application entry, domain behavior, narrow native/I/O boundary, tests and README launch instructions; retain framework-generated target structure.

Treat privileged native operations as explicit interfaces; keep presentation unprivileged where the framework supports it.

## Run and test

Launch a local executable and exercise the first journey, then test a meaningful behavior. Verify each claimed OS separately. Distribution/signing can remain out of scope.

Record concrete commands after inspecting generated output. This recipe is guidance, not an observed platform acceptance result. Missing tooling or an unrun target remains unverified. Canonical architecture and test homes can be README sections.

Sources to check when selecting tooling: https://v2.tauri.app/start/ · https://www.electronjs.org/docs/latest/tutorial/tutorial-first-app · https://docs.flutter.dev/platform-integration/desktop
