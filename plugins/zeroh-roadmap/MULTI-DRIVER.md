# Native Claude and Codex execution

Roadmap supplies instructions, role briefs and typed progress. The installed host owns file tools, shell commands, agent dispatch, model configuration, permissions and Git/provider operations. There is no Roadmap driver or workflow runtime.

## Dispatch

The supervising session reads the selected skill and coordinates the next phase. On Claude, use the native agent tool and installed role cards if available. On Codex, use the native collaboration tools exposed to the session and pass the relevant role brief. Named Claude agent cards do not imply Codex registration. Inspect actual tool descriptions rather than copying a version-specific call signature from documentation.

Give each worker a bounded packet: actual checkout, phase and approved intent, relevant conventions, write ownership, existing check commands and budget. Avoid duplicating the entire session into every helper. A phase-executor is a worker for one phase, not a nested arc orchestrator.

A worker that cannot spawn requests the helper from the supervisor; the supervisor dispatches and relays its result. Use the host's actual follow-up/wait facilities. If native worker dispatch is absent, implementation can run inline with honest attribution. Required independent review cannot be replaced by the author's own role-play; report it pending if a separate reviewer is unavailable.

## Models and authority

Respect explicit owner model choices and the active host configuration. Do not override them using a plugin registry, infer models from obsolete aliases, or launch a detached cross-provider CLI as a silent fallback. When an explicitly required model is unavailable, report that exact limitation. An independent context matters for review; claiming a model name is not evidence of independence or execution.

Reuse the user's existing scope and authorization. Native tools enforce their own access and permission boundaries. A child cannot increase authority by being dispatched. Resolve an actual refusal with the host's documented access mechanism or report it; do not copy an inaccessible workflow into a scratch driver to bypass the boundary.

## Progress and checks

The session selects work from typed progress and dependencies, obtains an exclusive work claim, and executes ordinary project commands through its shell. Respect installed host resource admission for heavy work. No plugin heartbeat, process reaper, gate runner or custom scheduler participates.

Run `roadmap phase validate <path>` before queueing/completion on both hosts. Hooks are fail-soft, incomplete diagnostics and are not evidence of automatic prevention on Codex. Observe actual command exits, native worker completion and relevant runtime behavior. Unknown or interrupted checks remain unresolved.

Review is proportional: close on a clean first pass; follow up on changed behavior; three rounds is a ceiling. Original-intent acceptance remains independent and must exercise the actual required behavior. Neither a typed record nor an agent's confident prose authenticates owner consent or proves a product works.
