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
Before approval, allow read-only repository/tool inspection and preparation in an isolated directory outside the consumer. Do not run generators or write in the consumer; specifically do not invoke `roadmap init`, including `roadmap init --help`. The CLI command-help dispatch keeps `roadmap init --help` read-only; `plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs` later rejects any observed preapproval mutation.

## Interview

Load `references/prd-interview.md`. Ask one question at a time and retain
unknowns. Do not write the PRD yet.

Invoke `zeroh-greenfield:stack-decision` after the platforms and constraints
are known. It owns the stack alternatives and decision-record text.
Aim for the smallest runnable prototype that demonstrates the user's success signal.
Reuse answers already supplied; ask only unresolved questions that change the foundation.
Choose the relevant platform template (web-only, Android-only, or multi-platform),
then propose the file structure, architecture/stack rationale, test strategy,
one meaningful test and a documented local run command. Unknown product details
may remain in the PRD; unresolved tooling needed to run the prototype must be resolved.

Local prototype setup is the default. Ask about CI/release infrastructure only
when the user requests delivery or existing project requirements call for it.
Do not require sharding, a protected environment or cloud choices to start locally.
Retain unselected infrastructure as deferred; never invent credentials or authorize deployment.

## Draft proposal

Load these references in order and assemble a complete proposal:

1. `references/design-system.md` for the design-system choice or sibling handoff.
2. `references/archetypes/<name>.md` for the chosen generator and file shape, where `<name>` is `web`, `flutter`, `android`, `expo`, `nx-monorepo`, or `library-cli`.
3. `references/standards.md` for repository conventions and documentation.
4. Only for selected delivery setup: `references/ci-release-strategy.md` for its adapter, commands, lifecycle and preservation plan.
5. `references/pointers.md` for delivery/config paths and their copy/validate order.

The supplied archetype manifests describe their named example stacks; they are
not permission to replace the approved stack. Derive the generator, file tree,
design integration and verification commands from the actual selection. For an
alternative such as SvelteKit, Vite, Turborepo or plain JavaScript, adapt those rows
explicitly and verify the selected tooling before approval. If no compatible
scaffold is available, say so and resolve that specific choice; never silently
run the Next.js/Nx/tsup example against a different ruling.

Present every proposed operation in this exact table:

| Artifact | Target | Reason |
| --- | --- | --- |
| <artifact-or-command> | <consumer-path> | <why-it-is-needed> |

Include generator commands as artifacts. Cover the PRD,
decision records, design pointers, archetype, standards, harness files, README,
roadmap configuration, and a runnable first prototype. Include the four delivery outputs only when delivery setup was selected.
Inspect existing workflow paths first. STOP on any collision until the complete
proposal names an explicit merge decision, the preserved jobs/markers and exact
delta. Approval covers only that listed merge.

Also emit this parser-bound object with concrete values and exactly the seven gate keys:

```json
{"type":"proposal","artifacts":[{"path":"<repository-relative-path>","reason":"<reason>"}],"commands":[{"command":"<command>"}],"gates":{"lint":"<command-or-none>","types":"<command-or-none>","unit":"<command-or-none>","integration":"<command-or-none>","build":"<command-or-none>","e2e":"<command-or-none>","emit":"<command-or-none>"}}
```

When delivery is selected, include the concrete `delivery` object specified in `references/pointers.md` and bind its validation commands. Otherwise omit `delivery` and record that CI/release setup is deferred; deferred infrastructure is not an initialization failure.

Define paths relative to the consumer root, reasons as non-empty approval rationale, and `none` as an approved absence with its reason in the proposal table. `plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs` rejects unsafe, broad, duplicate, or unproposed artifact paths.

## Approval gate

Obtain explicit approval of the concrete proposed changes. Reuse approval already
given for that scope; do not ask again solely to obtain a magic phrase. Native
validation fixtures use `APPROVE GREENFIELD PLAN` as their machine-observed approval
marker. STOP before consumer writes or generators without approval. A partial
approval authorizes only the selected rows; revise dependent operations accordingly. Record the
approved plan and response in `docs/PRD.md §Decisions` during execution.
The native fixture verifies its approval marker; everyday authorization is interpreted by the host, not authenticated by a hash or runner flag.

If a Blade brand requires the design sibling and it is absent, show
`/plugin install zeroh-design@zeroh-marketplace` and STOP that branch. Do not
substitute either sibling's work.

## Execute approved plan

For a multi-line executable program, load `references/prepared-program.md`: save it once, preflight it and execute its reviewed bytes. Keep simple commands direct. Execute only approved rows through the following headings in order. Run the selected archetype generator first, then write the PRD, decision records, standards, architecture and UX indexes, and harness adapters.

## Structure

Populate README structure from the selected manifest's `## File tree` and
approved `## Generator` and `## Post-steps` outputs.

## Commands

Populate README commands from the selected manifest’s `## Verify` and test conventions.
Resolve `templates/scripts/check-readme-catalog.mjs` from the installed zeroh-greenfield plugin root, copy it to consumer path `scripts/check-readme-catalog.mjs`, and run the selected manifest checker.
Record its exit code before Done.


## Delivery

Skip this section when delivery is deferred. Otherwise copy the approved planner and workflows from the installed plugin templates,
write the approved delivery configuration and fill the selected environment.
Merge approved existing workflow jobs and markers; never overwrite them silently.
Follow `references/pointers.md` to bind README commands and the CI backstop.
Installation does not authorize publishing or deployment.

## Roadmap configuration

Run `roadmap init`, then apply only the keys from `references/pointers.md`.

Never replace an existing home discovered after approval. Stop with the changed
evidence and draft a revised proposal instead.

## Verify

Follow `references/pointers.md` to execute every non-`none` gate from the consumer root, recording cwd/exit and approved absence reasons. Run the selected archetype's Verify command, the README catalog check, and
`roadmap config check`. Report each command and exit status. A failing command
keeps the initialization incomplete. Only for selected delivery setup, validate the installed workflow YAML and
execute the installed delivery planner/workflow mutation suite, recording actual
commands and terminal test totals. Record optional actionlint path/version or
unavailability; it cannot replace mandatory validation.

## Done

Return Done only when every approved artifact exists, every unapproved path is unchanged,
the approval ruling is in the PRD, the first prototype runs with its documented command, its meaningful test passes, the catalog check passes, and
`roadmap config check` exits `0`. Report the artifact paths and verification
results; do not use a prose-only success claim.

After auditing the completed tree, emit `{"type":"audit-result","proposals":[],"writes":[],"gaps":[]}` only when the skill proposes and writes nothing. `plugins/zeroh-roadmap/test/fixture-consumer/greenfield-live-evidence.test.mjs` later cross-checks the claim against independent observer events and tree snapshots; treat other STOP and preservation instructions as honor-system.
