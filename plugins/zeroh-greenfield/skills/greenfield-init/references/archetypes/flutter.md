# Flutter

Confirm required platforms, native integration and whether a shared Dart UI suits the product.

## Prerequisites and creation

Flutter SDK and target-specific tooling; inspect flutter doctor output.

Use flutter create for the selected targets following current docs; preserve approved target choices.

## Minimal shape and rationale

lib/ with entry screen and small domain seam, test/, generated target folders and README commands.

Keep domain behavior independent of platform plugins where useful.

## Run and test

Run flutter test with a behavior assertion, then launch the actual app on each required available target. A successful unit test does not prove device integration.

Record concrete commands after inspecting generated output. This recipe is guidance, not an observed platform acceptance result. Missing tooling or an unrun target remains unverified. Canonical architecture and test homes can be README sections.

Sources to check when selecting tooling: https://docs.flutter.dev/get-started · https://docs.flutter.dev/testing
