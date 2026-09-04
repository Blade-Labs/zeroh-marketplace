---
name: greenfield-init
description: Interview for and execute an approval-gated new-repository setup with sourced stack, design, standards, and roadmap pointers.
---

# Greenfield initialization

Use this workflow only after `using-zeroh-greenfield` finds no brownfield
markers. Load each reference only at the step that names it.

## Read-only compatibility preflight

Before the interview, proposal, approval request, generator, or any consumer write,
require `roadmap` and run `roadmap config capabilities --json`. The response must be
valid JSON with `configVersion: 1`, `scopeManifestProtocol:
"scope-manifest-json-v1"`, and slots `unit-scoped`, `unit-affected`, and
`unit-impacted`. If the command is absent, exits nonzero, returns malformed or older
capabilities, print `/plugin install zeroh-roadmap@zeroh-marketplace` and STOP with
zero consumer writes.

## Interview

Load `references/prd-interview.md`. Ask one question at a time and retain
unknowns. Do not write the PRD yet.

Invoke `zeroh-greenfield:stack-decision` after the platforms and constraints
are known. It owns the stack alternatives and decision-record text.

## Draft proposal

Load these references in order and assemble a complete proposal:

1. `references/design-system.md` for the design-system choice or sibling handoff.
2. `references/archetypes/<name>.md` for the chosen generator and file shape.
3. `references/standards.md` for repository conventions and documentation.

Present every proposed operation in this exact table:

| Artifact | Target | Reason |
| --- | --- | --- |
| <artifact-or-command> | <consumer-path> | <why-it-is-needed> |

The proposal includes generator commands as artifacts. It must cover the PRD,
decision records, design pointers, archetype, standards, harness files, README,
and roadmap configuration before requesting approval.

## Approval gate

Ask for the exact response `APPROVE GREENFIELD PLAN`.

STOP before any write or generator run unless that exact response follows the
complete proposal. Do not interpret partial agreement as approval. Record the
approved plan and response in `docs/PRD.md §Decisions` during execution.

If a Blade brand requires the design sibling and it is absent, show
`/plugin install zeroh-design@zeroh-marketplace` and STOP that branch. Do not
substitute either sibling's work.

## Execute approved plan

Execute only the approved rows, in order:

1. Run the selected archetype generator and its post-steps.
2. Write `docs/PRD.md` and the stack/design decision records.
3. Write standards, architecture and UX indexes, and harness adapters.
4. Reconcile `README.md` with the generated tree.

## Structure

Populate README structure from the selected manifest's `## File tree` and
approved `## Generator` and `## Post-steps` outputs.

## Commands

Populate README commands from the selected manifest's `## Verify` and test
conventions. Copy templates/scripts/check-readme-catalog.mjs into the consumer at scripts/check-readme-catalog.mjs.
Run the selected manifest's exact checker command.
Record its exit code before Done.

5. Run `roadmap init` before editing any roadmap pointer.
6. Apply only the keys from `references/pointers.md`.

Never replace an existing home discovered after approval. Stop with the changed
evidence and draft a revised proposal instead.

## Verify

Run the selected archetype's Verify command, the README catalog check, and
`roadmap config check`. Report each command and exit status. A failing command
keeps the initialization incomplete.

## Done

Done means every approved artifact exists, every unapproved path is unchanged,
the approval ruling is in the PRD, the catalog check passes, and
`roadmap config check exits 0`. Report the artifact paths and verification
results; do not use a prose-only success claim.
