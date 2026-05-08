# zeroh-sdd Codex Guidance

Use this template in a consuming repository when Codex should follow the ZeroH SDD loop.

## Operating Doctrine

- For non-trivial coding work, use `zeroh-sdd:sdd-planning` first.
- For obvious next-slice work, use `zeroh-sdd:execution-spec` directly.
- The durable runtime contract is `.specify/workflows/active-stage.json`, not the chat transcript or a todo list.
- Do not edit implementation files until an execution spec has exactly one fenced `sdd` block and `zeroh-sdd stage set` has opened the active stage.
- Work only inside `active-stage.allowedPaths` while the stage is open.
- Run the declared proof command before claiming the stage is complete.
- Finish with `zeroh-sdd stage finish` and a receipt before selecting the next MC.
- Separate current-gate findings from branch-baseline noise in receipts and summaries.

## Codex-Specific Notes

- Codex hooks are useful steering and guardrail adapters, but the deterministic truth is the repo-local SDD state plus `check`, `doctor`, and CI.
- Treat live session progress as disposable. Durable truth lives in execution specs, receipts, optional epic tracker rows, and active-stage state.
- If a proof tool is missing, record `TOOL_MISSING` or `TOOL_UNRUNNABLE` as proof-command replan context instead of blaming the edited file.
