# Product requirements

## Product and audience

This established workspace contains the projects in the [catalog](../emitted/repo-catalog.json). Product audience, application behavior and business acceptance criteria have not been supplied.

## Platforms and constraints

Retain the existing JavaScript ES-module projects, npm lockfile and Nx workspace. Preserve runtime files and project identities. See the [technology decision](adr/0001-tech-stack.md).

## Non-goals

This repair introduces no runtime scaffold, mobile platform, Blade integration, registry, product remote or deployment. Unknown requirements remain unknown.

## Success signals

Existing shared and ui tests and builds execute successfully. Documentation points to canonical homes, the README agrees with the existing catalog, and installed delivery outputs pass validation.

## Brand and delivery

Brand and visual requirements are unspecified. [Design evidence](adr/0002-design-system.md) is retained. Delivery uses GitHub Actions with protected environment `greenfield-validation`; the deployment provider is unavailable (`none`).
