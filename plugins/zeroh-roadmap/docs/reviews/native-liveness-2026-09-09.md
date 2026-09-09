# Native phase waiting and recovery observations

Observed 2026-09-09 while updating PR #42. Synthetic local jobs only; no product implementation, real orphan-reaper event, OOM pressure, notification-loss injection or full host restart. Codex used the current native collaboration/exec tools; installed binaries were Codex CLI 0.153.4 and Claude Code 2.1.257. Claude used Fable with generic native Agent/Bash tools and hooks disabled. This is a test of native lifecycle primitives and the proposed supervisor procedure, not an end-to-end run of an installed Roadmap arc.

## Prior working behavior retained

The former `bb2c08c` watch/liveness implementation distinguished corroborated stall from unobserved work, attributed activity to the executor, and reported rather than automatically respawning. `5da8a20` corrected the older unconditional stalled fallback; `71c83f0` corrected foreign transcript attribution. Preserve those distinctions. Do not restore transcript-age death heuristics, per-task beacon prose or the sidecar/workflow engine.

## Observations

| Host / case | Observed result | Continuation |
| --- | --- | --- |
| Codex delayed success | Native session 53276 exited 0 | Next fixture step ran without user input. |
| Codex delayed failure | Session 28416 exited 7 | Failure consumed; next fixture step ran. |
| Codex capbuild deadline | Session 57260 exited 1 with explicit timeout/interruption | Not mistaken for success; next fixture step ran. |
| Codex controlled cancellation | Session 40624 exited 143 after SIGTERM of its verified owned fixture process | Cancellation recorded; next step ran. This was not a real reaper event. |
| Codex delayed observation | Session 96943 reconciled later and returned 0 | No duplicate launch. This simulated delayed consumption, not lost notification delivery. |
| Codex fresh-agent command adoption | Different agent received `Unknown process id 37974` | Failed adoption; no relaunch or claimed success. Its first fixture read also hit the host's existing bwrap restriction. |
| Codex original-agent resume | Original owning agent consumed session 37974, exit 0, after returning and being resumed | Saved checkpoint/result matched; continuation marker written. |
| Claude delayed success | Background task bs9qs964d exited 0 | Supervisor consumed native result. |
| Claude delayed failure | Background task ba6e4nm52 exited 7 | Failure consumed, not treated as an unfinished wait. |
| Claude capbuild deadline | Background task bxliklvm1 exited 1, explicit timeout/interruption | Correctly reported failed. |
| Claude worker stops early | Worker a43a29fd706b5234d went idle before consuming all results | Supervisor resumed the same worker via SendMessage without a user message; remaining results and a continuation marker were recorded. |

Claude's observation lasted approximately 130 seconds overall. Its child could not discover TaskOutput, but received native terminal notifications; the supervisor could use TaskOutput and SendMessage. This asymmetry is why the supervisor must reconcile partial worker returns rather than assume every child exposes identical tools. An Edit permission refusal was handled with an allowed Write to the same synthetic file; no access scope changed.

Codex fixture evidence remained in `/tmp/roadmap-liveness-codex-eKgCDn/`; Claude fixture evidence in `/tmp/roadmap-liveness-claude-20260909/`. These temporary paths are local observations, not portable dependencies. No raw transcripts, credentials or large logs are committed.

## Resulting contract

Use fresh phase contexts, but resume the same owner for interrupted work and repairs. A command handle is not necessarily transferable to another agent. Capture handles at launch, consume actual exits, preserve compact progress, and let the supervisor resume an early-returning worker. Unknown state requires investigation; it never justifies duplicate writers. Keep waits and recovery within authorized time/spend limits.

One worktree per arc is the normal ownership unit, reused by its phase workers. Delivery is a separate plan choice: per-arc PRs, dependent stacked PRs, or a batch integration branch and final PR. The batch can deliberately reuse a single worktree when its arcs are sequential. No new worktree or landing runtime was introduced or claimed tested here; existing claim tests cover shared Git ownership.

## Remaining boundary

These observations support managed waiting and same-worker continuation while the native host is alive. They do not establish automatic recovery after the entire CLI/session dies, a notification is genuinely lost, or the original worker becomes permanently inaccessible. Installed Herdr 0.8.0 help exposes lifecycle inspection/wait/prompt operations, but no dedicated restart/wake guarantee was verified. Such recovery needs a tested host facility; neither an advisory write hook nor a beacon file provides it.

The Roadmap instructions now state this boundary instead of claiming complete unattended crash recovery. A broader guarantee must be tested at the host layer before advertising it.
