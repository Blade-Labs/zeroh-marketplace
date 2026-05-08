---
name: tasks
description: Break the current execution spec into proof-preserving implementation tasks.
---

# tasks

Create tasks only inside the active stage surface.

Use live session tracking as the live mirror of the current MC: Claude native todos when available, Codex task/progress tracking when available, or a compact checklist otherwise. Todos/tasks are not durable truth; the execution spec, receipt, and optional epic tracker row are.

Each task must include:

- target file or package
- expected proof signal
- shape or parse-boundary impact
- stop condition
- whether it updates an optional tracker item

Do not create future-gate detail beyond dependency notes. Future work is planned after the current receipt.
