# Nx workspace

Use only when several current projects justify project graph or boundary tooling; future ambitions alone do not.

## Prerequisites and creation

Toolchain for chosen applications, compatible Node/package manager and Nx version.

Use the selected Nx workspace generator after checking current documentation. Simpler workspaces are valid alternatives.

## Minimal shape and rationale

apps/ for independent entry points, libs/ or packages/ only for justified shared code, project tests and README commands.

Define real dependency boundaries; avoid extracting speculative shared libraries.

## Run and test

Run the selected application and its actual Nx test target. Check a shared contract only where sharing exists. No copied test-tier adapter or manifest protocol is required.

Record concrete commands after inspecting generated output. This recipe is guidance, not an observed platform acceptance result. Missing tooling or an unrun target remains unverified. Canonical architecture and test homes can be README sections.

Sources to check when selecting tooling: https://nx.dev/getting-started/intro
