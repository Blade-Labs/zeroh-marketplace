## Generator
```sh
flutter create my_app
```

Source: https://docs.flutter.dev/reference/create-new-app. Flutter is
BSD-3-Clause, tier `Allowed anywhere`.

## Post-steps
Add `shadcn_flutter: ^0.0.54` from
https://pub.dev/packages/shadcn_flutter and apply the token-name mapping from
`references/design-system.md`. Flutter: BSD-3-Clause; shadcn_flutter 0.0.54:
BSD-3-Clause. Both are `Allowed anywhere`.

## File tree
```text
my_app/
  pubspec.yaml
  lib/main.dart
  test/widget_test.dart
  analysis_options.yaml
```

## Conventions delta
Keep presentation widgets separate from application services and retain the
generated analyzer configuration.

## testConventions
Use `flutter test` for widgets and `flutter test integration_test` for device
flows when the project adds them.

## designHomes
Set `designHomes.architecture.home` to `docs/architecture.md` and
`designHomes.ux.canon` to `docs/ux-canon.md`.

## Verify
```sh
test -f pubspec.yaml && test -f lib/main.dart && test -f test/widget_test.dart && node scripts/check-readme-catalog.mjs --project-root .
```

## CI and release adapter

Select `flutter` in `.github/greenfield-delivery.json` and follow
[the shared CI/release strategy](../ci-release-strategy.md) for its exact inventory,
executor, raw report, coverage merge and build contract. Bind runner/build argv
into the shard manifest before execution; require exact-once leaf/file selection.
Generate `scripts/ci-shard-plan.mjs`, `.github/workflows/ci.yml` and
`.github/workflows/release.yml` only from the approved preservation plan.
Missing tooling/reporters are unavailable with the adapter install remedy.
Affected PR checks backstop into authoritative full shards on main/manual runs;
release promotes the same verified artifact bytes without rebuilding.
