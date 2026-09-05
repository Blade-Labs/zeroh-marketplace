# ADR 0001: Technology stack

## Status

Existing evidence recorded; runtime selection remains unresolved.

## Date

2026-09-05

## Context

[package.json](../../package.json) declares a private workspace and nx ^23.0.0. [nx.json](../../nx.json) has empty targetDefaults. The six catalog project files declare application or library identity without runnable targets. No package-manager lock, package scripts, compiler configuration, tests, or application implementation is present.

## Ruling

Preserve the established Nx structural layout. Do not infer a working runtime, an installed Nx version, or an additional language toolchain from project metadata. No replacement stack or generator is selected. Mobile: none.

## Consequences

Application gates are explicitly absent until real tooling exists. Dependency direction remains explicit under [AGENTS.md](../../AGENTS.md); architectural authority remains in the [architecture index](../architecture.md).

## Revisit when

Approved product requirements and actual executable project targets provide evidence for a runtime decision.
