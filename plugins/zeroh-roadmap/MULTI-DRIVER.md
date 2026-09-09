# Native Claude and Codex execution

Roadmap supplies instructions, role briefs and typed progress. The installed host owns file tools, shell commands, agent dispatch, model configuration, permissions and Git/provider operations. There is no Roadmap driver or workflow runtime.

## Dispatch

The supervising session reads the selected skill and coordinates the next phase. On Claude, use the native agent tool and installed role cards if available. On Codex, use the native collaboration tools exposed to the session and pass the relevant role brief. Named Claude agent cards do not imply Codex registration. Inspect actual tool descriptions rather than copying a version-specific call signature from documentation.

Give each worker a bounded packet: actual checkout, phase and approved intent, relevant conventions, write ownership, existing check commands and budget. Avoid duplicating the entire session into every helper. A phase-executor is a worker for one phase, not a nested arc orchestrator.

A worker that cannot spawn requests the helper from the supervisor; the supervisor dispatches and relays its result. Use the host's actual follow-up/wait facilities. If native worker dispatch is absent and the user has not explicitly required delegation, implementation can run inline with honest attribution. Required independent review cannot be replaced by the author's own role-play; report it pending if a separate reviewer is unavailable.

## Models and authority

Respect explicit owner model choices and the active host configuration. Do not override them using a plugin registry, infer models from obsolete aliases, or launch a detached cross-provider CLI as a silent fallback. When an explicitly required model is unavailable, report that exact limitation. An independent context matters for review; claiming a model name is not evidence of independence or execution.

Reuse the user's existing scope and authorization. Native tools enforce their own access and permission boundaries. A child cannot increase authority by being dispatched. Resolve an actual refusal with the host's documented access mechanism or report it; do not copy an inaccessible workflow into a scratch driver to bypass the boundary.

## Role choices and cross-harness delegation

Architect and developer are responsibilities, not fixed models. Reuse the owner's explicit role choices from the session or canonical project guidance, and record a pointer in the arc plan when the choice must survive a fresh session. Name both harness and model for each role; configure them through actual host settings or supported invocation options. The absence of `model` in a shared role card does not establish the desired split: default inheritance can otherwise put every role on the supervisor's model.

Examples of valid intended splits, subject to installed model availability:

| Architect | Developer / phase executor | Natural execution path |
| --- | --- | --- |
| Claude Fable | GPT-5.6 Sol | Claude architecture context; Codex developer context |
| GPT-6 Astra | Claude Opus 5 | Codex architecture context; Claude developer context |
| Claude Fable | Claude Opus 5 | Claude native subagents with explicit per-role models |
| GPT-6 Astra | GPT-5.6 Sol | Codex native subagents with explicit per-role models |

The supervisor can run in either harness. Prefer native subagents when the selected role model is supported there; using a native agent tool does not by itself make the other provider's model available. Use the actual exposed model parameter or supported custom-agent configuration. Respect an exact requested version; do not replace it with a floating family alias or claim that the requested model ran without checking available host metadata. Account restrictions and host overrides can change resolution; report a mismatch and honor the owner's choice instead of silently continuing on another model.

The developer choice applies to phase execution unless the owner separately selected a phase-executor model. Architect work includes consequential architecture decisions and planning/replanning that needs that judgment; it does not require another architecture agent for every routine task. Reviewer/tester choices remain separate when explicitly supplied; otherwise follow host configuration with honest attribution. Independent review requires a distinct context, not necessarily a different provider.

An authorized cross-harness call is supported as a deliberate execution path, not a silent fallback or permission workaround. A supervisor or a bounded worker with permitted shell access may start the other installed CLI (`codex exec --model ...` or `claude -p --model ...`). If that child lacks the necessary tool/access, ask its supervisor to perform the already-authorized delegation. Both CLIs have their own authentication, permissions, configuration and plugin discovery; none is inherited merely because the parent launched a subprocess. Do not strip safety settings or bypass a refusal to make the crossing work.

Pass the selected role brief, exact checkout, bounded task, relevant intent, write ownership, chosen model and budget. Check that the target can read those inputs. If it needs Roadmap skills, verify their installed availability or provide the relevant current instructions explicitly; a prompt naming a plugin is not proof it loaded. Keep writes in the arc's existing worktree, with no concurrent writer to the same scope.

Launch through a managed native shell task, retain its handle and consume its real terminal result. Use supported structured output and the CLI's returned session identity for follow-ups; never assume a native Agent ID and a CLI session ID are interchangeable. Resume through the original owning context and target CLI's supported resume facility. The child harness may use its own native subagents for the assigned task, but must not create another arc orchestrator or an uncontrolled chain back into the first harness. The caller remains responsible for result collection, recovery and the overall budget.

Cross-harness output is a proposed result: inspect actual files, checks and role outcome before accepting it; exit zero alone does not prove completion. This transport does not confer unattended full-host recovery. Earlier pilots exercised Codex-supervised Claude CLI calls and same-harness native workers; the full four-pair architecture/development matrix and reverse Claude-to-Codex execution have not been validated by those observations.

## Progress and checks

The session selects work from typed progress and dependencies, obtains an exclusive work claim, and executes ordinary project commands through its shell. Respect installed host resource admission for heavy work. No plugin heartbeat, process reaper, gate runner or custom scheduler participates.

Run `roadmap phase validate <path>` before queueing/completion on both hosts. Hooks are fail-soft, incomplete diagnostics and are not evidence of automatic prevention on Codex. Observe actual command exits, native worker completion and relevant runtime behavior. Unknown or interrupted checks remain unresolved.

Review is proportional: close on a clean first pass; follow up on changed behavior; three rounds is a ceiling. Original-intent acceptance remains independent and must exercise the actual required behavior. Neither a typed record nor an agent's confident prose authenticates owner consent or proves a product works.

## Long-running phase ownership

Use a fresh executor context for each phase. Give it the phase, approved arc, checkout, relevant conventions and a bounded budget; do not fork the entire accumulated arc conversation by default. Keep exploration and build logs in the worker. The supervisor retains decisions, dependency readiness, worker/job handles and short results, inspecting detailed output only for a specific gap. Resume that worker for repairs; after acceptance close or retire it using available native lifecycle tools. If the user requests delegated execution, do not silently replace it with an inline multi-phase run when dispatch is unavailable.

A worker owns its managed command from launch to observed terminal result. Launch heavy commands through the installed resource wrapper inside a native command/session tool. Capture the returned handle immediately; use native waiting/result tools, not detached shell work plus a promise to check later. A wait timeout means the wait ended, not the command. Keep waiting or inspect the actual handle; do not end supervision merely because authorized work is pending. Prefer event waits over rapid polling. Respect the approved total time/spend budget; on exhaustion retain pending work and its last observed state for a checked handoff or bounded extension, never infer death or launch a duplicate.

The supervisor owns the worker's lifecycle. Use native completion notifications/waits as the primary path, with a bounded reconciliation interval supported by the host. Before yielding control, enter the actual native wait tied to the worker ID; do not merely state that monitoring is active. If relying on an external wake mechanism, confirm its registration through the host before leaving the turn. If no such facility exists, keep the supervisor active within budget and report host-independent unattended recovery as unavailable. On a wait timeout, inspect worker state and any pending command handle. A quiet compiler or admission queue is not a stalled agent. No model-generated heartbeat, transcript age, sibling commit or elapsed wall-time alone establishes death. Native task handles must be attributed to the actual worker and checkout.

When a worker returns with unfinished work, inspect its result and saved progress. Resume it after a recoverable failure or helper review; if replacing it, first confirm the old worker and writers stopped or explicitly transfer the running command. Resume the owning worker first: native command handles can be scoped to its context and inaccessible to another agent. Preserve the handle and observe through that owner rather than relaunching the command. Transfer observation only after the host confirms that the receiving context can access it; an unknown handle is not evidence the process died. Unknown ownership blocks duplicate execution, not investigation. After a terminal failure, diagnose and retry only the affected operation within the approved budget; honor explicit user cancellation.

Before compaction or a worker handoff, persist only what another context needs: checkout/branch, phase, worker ID, outstanding command handles, last observed state, next action and ownership. Use existing progress and a small local checkpoint where necessary; do not copy logs into the main conversation or commit transient host handles as product evidence. A new context reconciles those handles against current host state before acting. Handles may not transfer between agents or survive a full host restart. When the owner cannot resume, inspect authoritative process/resource-wrapper state and retained terminal output through supported host tools; if ownership or completion cannot be established, report that specific recovery limitation instead of inventing an exit code.

Native waits provide continuation while the host remains active. Automatic recovery after a dead CLI/session or a genuinely lost notification requires a tested session-host wake/restart facility; Roadmap does not provide that service. Do not claim unattended crash recovery from a written skill, beacon or completion schema. The installed resource wrapper may intentionally terminate orphaned commands; inspect its real result and retained output instead of interpreting disappearance as success.

## Worktrees and delivery

Default to one branch/worktree per arc, shared sequentially by its phase workers. Review that same worktree read-only. Do not create one worktree per phase; use extra worktrees only for genuinely independent concurrent work with an explicit integration owner. Different worktrees in one repository share ownership claims, so use distinct arc IDs and preserve the actual claim owner.

Agree delivery once for the authorized arc sequence and record it in the approved plan or linked project guidance: target branch, arc order/dependencies, PR grouping and merge authority. Respect the actual repository policy; never assume the target is `main` or `develop`.

- **Per arc:** one PR for each independently useful arc. Each lands when its own acceptance and required integration checks pass and merging is authorized; later arcs need not delay it.
- **Stacked:** dependent arcs use separate branches/worktrees based on their predecessor and PRs targeting that predecessor until it lands. Keep the child PR open while its predecessor lands on the agreed target; do not merge the child into the unlanded predecessor. Then retarget/rebase the child onto that target, inspect the remaining diff and pass required checks before merging it; never publish the same cumulative diff as three independent PRs to the target branch.
- **Batch:** a tightly coupled sequence has one integration branch and one final PR to the agreed target. Sequential arcs may deliberately reuse its worktree; concurrent arcs integrate through their separate worktrees. Land the batch only after all included arcs and combined acceptance pass. Keep per-arc progress and ownership distinct even when delivery is grouped.

Creating, pushing, merging and releasing follow existing authorization. A batch is not automatically released merely because its final arc is done. A user may select three PRs instead of one without replanning the product outcomes.
