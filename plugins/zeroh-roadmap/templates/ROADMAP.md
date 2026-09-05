# Roadmap

The installed roadmap CLI discovers the canonical roadmap root. This directory
contains `phases/`, `backlog.ts`, and the shared `lib/schema.ts`; phase files use
`definePhase()` from that schema. Do not create a second root or configuration.

## Phase execution

Use `/do-phase N` to execute a planned phase. The installed do-phase workflow owns
task sequencing, commits, reviews, and completion; this document is a pointer to
that workflow, not a separate execution procedure.

## Validation

Use `roadmap gate plan N` to inspect the required gate and `roadmap gate run N` to
execute its mechanical checks. The discovered `roadmap.config.json` supplies
`gateCommands`. Missing or invalid bindings require correction; never infer them
from harness prose or a package manager.

After recording the phase's completion evidence, run
`roadmap gate run N --verify-complete` to verify consistency. Consult `roadmap --help`
and the installed workflow for command details and the current review protocol.

## Integration

The discovered configuration's `mergePolicy` controls integration, landing, and
push behavior. When `mergePolicy` is absent, hold integration and push for the user.
The existence of a phase or a successful gate does not select a branch or remote.
