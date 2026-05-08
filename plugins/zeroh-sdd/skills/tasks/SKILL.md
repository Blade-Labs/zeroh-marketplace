---
name: tasks
description: Break the current execution spec into proof-preserving implementation tasks.
---

# tasks

Create tasks only inside the active stage surface.

Use Claude native todos (`TodoWrite` in non-interactive/SDK sessions, Task tools in interactive Claude Code) as the live mirror of the current MC. Todos are not durable truth; the execution spec, receipt, and optional epic tracker row are.

Each task must include:

- target file or package
- expected proof signal
- shape or parse-boundary impact
- stop condition
- whether it updates an optional tracker item

Do not create future-gate detail beyond dependency notes. Future work is planned after the current receipt.
