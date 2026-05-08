---
name: sdd-readiness
description: Validate whether an execution spec is ready to drive implementation.
---

# sdd-readiness

Run:

```bash
zeroh-sdd check --plan <plan>
zeroh-sdd doctor --plan <plan>
```

Ready means:

- exactly one valid fenced `sdd` block
- stage gate surfaces match repo truth
- validation commands are runnable proof commands
- shape gate references real shapes and parse boundaries when declared
- receipt/replan discipline is present for multi-step work

This skill proves readiness only. It does not prove implementation correctness.
