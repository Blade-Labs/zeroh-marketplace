# zeroh-sdd v1

This plugin is a Claude Code runtime for Shape-Driven Development.

The invariant:

```text
execution-spec -> active-stage.json -> hooks enforce boundary -> proof command -> receipt -> doctor -> next slice
```

Use `execution-spec` before implementation. Do not edit outside the active stage surface. Do not commit, push, merge, complete a task, or stop while an active stage is open.

Primary commands:

```bash
zeroh-sdd check --plan <plan>
zeroh-sdd doctor --plan <plan>
zeroh-sdd stage status
zeroh-sdd stage finish --status passed --proof-result "<command => pass>"
zeroh-sdd self-test
```

Hard blocks protect stage integrity. AP findings are advisory JIT context unless the active `stage_gate` or `shape_gate` makes them part of proof.
