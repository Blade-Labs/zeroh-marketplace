---
name: greenfield-init
description: Handle requests phrased as initialize, scaffold, or create a new repository through an approval-gated setup with sourced stack, design, standards, and roadmap pointers.
---

# Greenfield initialization

Use this workflow only after `using-zeroh-greenfield` finds no brownfield
markers. Load each reference only at the step that names it.
Not this skill: route initial trigger selection through `using-zeroh-greenfield`, repositories with existing markers through `brownfield-audit`, and alternative selection through `stack-decision`. Use `roadmap/arc-evals/phase-32.peval.json` as the 2026-09-04 initialized-home evidence.

## Read-only compatibility preflight

Before the interview, proposal, approval request, generator, or any consumer write,
require `roadmap` and run `roadmap config capabilities --json`. The response must be
valid JSON with `configVersion: 1`, `scopeManifestProtocol:
"scope-manifest-json-v1"`, and slots `unit-scoped`, `unit-affected`, and
`unit-impacted`. If the command is absent, exits nonzero, returns malformed or older
capabilities, print `/plugin install zeroh-roadmap@zeroh-marketplace` and STOP with
zero consumer writes.
Before approval, run only that named roadmap command; specifically do not invoke `roadmap init`, including `roadmap init --help`. The CLI command-help dispatch keeps `roadmap init --help` read-only; `plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs` later rejects any observed preapproval mutation.

## Interview

Load `references/prd-interview.md`. Ask one question at a time and retain
unknowns. Do not write the PRD yet.

Invoke `zeroh-greenfield:stack-decision` after the platforms and constraints
are known. It owns the stack alternatives and decision-record text.

## Draft proposal

Load these references in order and assemble a complete proposal:

1. `references/design-system.md` for the design-system choice or sibling handoff.
2. `references/archetypes/<name>.md` for the chosen generator and file shape, where `<name>` is `web`, `flutter`, `android`, `expo`, `nx-monorepo`, or `library-cli`.
3. `references/standards.md` for repository conventions and documentation.

Present every proposed operation in this exact table:

| Artifact | Target | Reason |
| --- | --- | --- |
| <artifact-or-command> | <consumer-path> | <why-it-is-needed> |

Include generator commands as artifacts. Cover the PRD,
decision records, design pointers, archetype, standards, harness files, README,
and roadmap configuration before requesting approval.

Also emit this parser-bound object with concrete values and exactly the seven gate keys:

```json
{"type":"proposal","artifacts":[{"path":"<repository-relative-path>","reason":"<reason>"}],"commands":[{"command":"<command>"}],"gates":{"lint":"<command-or-none>","types":"<command-or-none>","unit":"<command-or-none>","integration":"<command-or-none>","build":"<command-or-none>","e2e":"<command-or-none>","emit":"<command-or-none>"}}
```

Define paths relative to the consumer root, reasons as non-empty approval rationale, and `none` as an approved absence with its reason in the proposal table. `plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs` rejects unsafe, broad, duplicate, or unproposed artifact paths.

## Approval gate

Ask for the exact response `APPROVE GREENFIELD PLAN`.

STOP before any write or generator run unless that exact response follows the
complete proposal. Do not interpret partial agreement as approval. Record the
approved plan and response in `docs/PRD.md §Decisions` during execution.
Treat this gate as enforced by `plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs`; other approval interpretation is honor-system.

If a Blade brand requires the design sibling and it is absent, show
`/plugin install zeroh-design@zeroh-marketplace` and STOP that branch. Do not
substitute either sibling's work.

## Execute approved plan

Execute only approved rows through the following headings in order. Run the selected archetype generator first, then write the PRD, decision records, standards, architecture and UX indexes, and harness adapters.

## Structure

Populate README structure from the selected manifest's `## File tree` and
approved `## Generator` and `## Post-steps` outputs.

## Commands

Populate README commands from the selected manifest’s `## Verify` and test conventions.
Resolve `templates/scripts/check-readme-catalog.mjs` from the installed zeroh-greenfield plugin root, copy it to consumer path `scripts/check-readme-catalog.mjs`, and run the selected manifest checker.
Record its exit code before Done.


## Roadmap configuration

Run `roadmap init`, then apply only the keys from `references/pointers.md`.

Never replace an existing home discovered after approval. Stop with the changed
evidence and draft a revised proposal instead.

## Verify

Follow `references/pointers.md` to execute every non-`none` gate from the consumer root, recording cwd/exit and approved absence reasons. Run the selected archetype's Verify command, the README catalog check, and
`roadmap config check`. Report each command and exit status. A failing command
keeps the initialization incomplete.

## Done

Return Done only when every approved artifact exists, every unapproved path is unchanged,
the approval ruling is in the PRD, the catalog check passes, and
`roadmap config check` exits `0`. Report the artifact paths and verification
results; do not use a prose-only success claim.

After auditing the completed tree, emit `{"type":"audit-result","proposals":[],"writes":[],"gaps":[]}` only when the skill proposes and writes nothing. `plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs` later cross-checks the claim against independent observer events and tree snapshots; treat other STOP and preservation instructions as honor-system.
