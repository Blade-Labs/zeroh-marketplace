---
name: "Audit Roadmap"
description: "Read-only consistency check of typed progress and references."
user-invocable: true
---

# Audit Roadmap

Inspect `roadmap status`, the backlog, active phase/arc files and their consumer schema. Run `roadmap phase validate <path>` on the requested active records. Report duplicate IDs, broken references/dependencies, inconsistent completion or deferred coverage and missing intent baselines. An unavailable loader or failed command is unresolved, not a clean audit.

Compare claimed progress with relevant Git/code evidence where requested. Preserve archived history and distinguish a legacy schema from a corrupted record. Do not rewrite files, upgrade schemas, execute work or impose a new framework as part of this read-only audit. Report findings and the smallest proposed repair.
