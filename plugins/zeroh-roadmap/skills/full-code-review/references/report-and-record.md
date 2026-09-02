# Report Template and Review Record Contract

## The report (`reviews/<YYYY-MM-DD>-FULL-CODE-REVIEW.md`)

~~~markdown
# Full Code Review — <YYYY-MM-DD> (scope: <path or "whole project">)

## Master Issue List

### Critical (<X> findings) — RELEASE BLOCKERS

**FCR-1** · `path/to/file.ts:42` · [<dimension>] · **<one-line title>**
```<lang>
<offending code snippet>
```
- **Problem**: what goes wrong, when, and what breaks
- **Fix**: specific remediation steps
- **Regression**: yes — matches <prior id / report path> | no

### High (<X> findings)
### Medium (<X> findings)
### Low (<X> findings)
(same entry shape; ids continue FCR-2, FCR-3, ...)

## Regression Check
- Prior records consulted: <paths> | none found (first review)
- Previously fixed items verified still fixed: <X>/<Y> (verified by re-reading
  current source, not by trusting resolution records)
- Regressions found: <FCR ids> | none

## Chased and cleared
- <suspicion pursued> — cleared: <the evidence that closed it (file read, git
  diff, traced path)>
(list every dead end actually chased; traced negatives are audit substance)

## Summary
- <X> critical, <Y> high, <Z> medium, <W> low
- Release decision: **BLOCKED** | **CLEAR**
- Top 3 areas needing attention: <...>
- Code health: <short assessment>
~~~

Every finding keeps its FCR id verbatim in the phase file steps and in the
review record's `findingsList` — that id is the traceability spine.

## The review record (`reviews/releases/v<version>-review.json`)

Version from `node -p "require('./package.json').version"`.

**If the file exists** (or siblings exist under `reviews/releases/`): mirror
the existing schema exactly — consumers extend it (see
`reviews/releases/v0.49.0-review.json` in azure_private_agent for a grown
example). Merge this run by APPENDING one entry to `rounds[]` and appending
this run's findings; never mutate or renumber prior rounds or prior findings.

**If creating from scratch**, use this minimal shape verbatim:

```json
{
  "version": "<semver>",
  "date": "<YYYY-MM-DD>",
  "verdict": "BLOCKED | CLEAR | RELEASED",
  "rounds": [
    { "round": 1, "instrument": "full-code-review", "agents": 8,
      "agentType": "code-reviewer",
      "report": "reviews/<YYYY-MM-DD>-FULL-CODE-REVIEW.md" }
  ],
  "findings": { "critical": 0, "high": 0, "medium": 0, "low": 0, "total": 0 },
  "findingsList": [
    { "id": "FCR-1", "severity": "critical", "agent": "<dimension>",
      "file": "path/to/file.ts:42", "description": "<one line>",
      "regression": "yes | no", "resolution": null }
  ],
  "gateTests": {
    "<slot-name>": { "status": "pass | fail | not-run",
                     "note": "<real counts, or the named gap>" }
  },
  "remediationPhase": 0,
  "deferredToBacklog": []
}
```

Rules:
- `findings` counts are sums over `findingsList` — recompute, never hand-edit.
- `gateTests` entries come from actually running the consumer's `gateCommands`
  slots (`<root>/roadmap.config.json`); take counts from the runner's own
  summary output or log artifacts. Absent slot or failed run → `"not-run"` plus
  a note naming why. Never invent a count.
- `resolution` stays `null` only until remediation; afterwards every entry is
  `"Fixed in phase <N>.<X> — <how>"` or `"Deferred to phase <M> — <reason>"`.
- `verdict` transitions: `BLOCKED`/`CLEAR` at review time; `RELEASED` only when
  all critical and high findings carry a `Fixed` resolution.
