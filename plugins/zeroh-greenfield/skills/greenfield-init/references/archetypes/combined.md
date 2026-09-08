# Combined surfaces

Select surfaces required now and one vertical slice spanning them. Separate later ambitions from acceptance.

## Prerequisites and creation

Prerequisites of each chosen surface and shared service, if any.

Compose the selected recipes. A monorepo, Nx or shared UI is not automatic; use the simplest justified layout.

## Minimal shape and rationale

web/, mobile/ or desktop/ only for selected surfaces; a shared contract package only when there is an actual consumer; documented per-surface commands.

Share contracts/domain logic where compatible and keep platform capabilities explicit. Do not force different platforms into one UI abstraction.

## Run and test

Run the vertical slice across required surfaces and test the shared boundary plus relevant platform behavior. Report each unavailable surface as unverified; one passing platform cannot stand in for another.

Record concrete commands after inspecting generated output. This recipe is guidance, not an observed platform acceptance result. Missing tooling or an unrun target remains unverified. Canonical architecture and test homes can be README sections.

Sources to check when selecting tooling: Use official sources linked from each selected surface recipe.
