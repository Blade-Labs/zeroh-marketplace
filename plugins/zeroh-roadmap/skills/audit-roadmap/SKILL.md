---
name: "Audit Roadmap"
description: "Read-only structural audit across the roadmap (15 checks). Never reads source code. Reports findings only — never fixes."
user-invocable: true
metadata:
  keywords: audit, roadmap, consistency, check, health, drift
---

# Audit Roadmap

**Trigger:** `audit roadmap`, `/audit-roadmap`, `check roadmap consistency`, `roadmap health check`.

The 15 structural checks are CODE. Run them:

```bash
roadmap audit          # human report grouped by severity
roadmap audit --json   # machine findings + verdict
```

Checks (all mechanical, over phase files + backlog + archive, never source):
1 dangling phase deps · 2 dep cycles · 3 backlog→missing phase · 4 `[NEEDS CLARIFICATION]`
(CRITICAL if the phase is queued) · 5 done phase with an undone task · 6 bad task deps ·
7 stale in-progress (>30d) · 8 duplicate numbers (active+archive) · 9 missing `kind` ·
10 stale/archived backlog entries · 11 oversized tasks sans `batchMode` · 12 archive
integrity (status/version/debt) · 13 limitations disposed pre-archive · 14 followup hygiene ·
15 stray lane worktrees (report-only: a non-live lane past its done-moment, MEDIUM with that
lane's own runnable close, LOW for a journal-less or unreadable one). Plus arc↔phase consistency.

**Verdict + exit:** `BROKEN` (exit 2) = any CRITICAL/HIGH — do NOT run `/do-phase` or cut a
release until they clear. `HAS ISSUES` (exit 0) = MEDIUM/LOW only. `CLEAN` (exit 0) = none.
For check 14, a spent/superseded stamp on a STILL-REFERENCED followup is HIGH and BREAKS the
audit (deleting it would break the referrer); an UNTRIAGED orphan is MEDIUM; a spent orphan and a
past `review-by` are LOW. The check reports rather than fixes, but that one HIGH does set the verdict.

**Report-only.** Never edits files — the user runs `/plan-phase` or hand-fixes. Report
literally; don't infer intent.

**Not this skill:** a plain diff review (the `code-reviewer` agent) · `review-phase` (ONE phase, reads source) ·
`full-code-review` (app code). `audit` is the cross-phase STRUCTURAL auditor — shallow
across all phases, never deep into one.
</content>
