# Followup File Contract

This contract governs the file-based lifecycle of `<root>/followups/*.md`. It is a sibling of,
and must never be merged with, the debt-record-scoped `openFollowups` census in
`cli/lib/landing.mjs:106`.

## Frontmatter grammar

Every triaged followup starts with YAML frontmatter:

```yaml
---
status: parked
trigger: "The named event that promotes this followup"
review-by: 2026-12-31
---
```

- `status` is required and is exactly one of `live`, `parked`, `superseded`, or `spent`.
- `trigger` is required when `status: parked`; it is a non-empty named promoting event.
- `review-by` is optional. When present, it is an ISO `YYYY-MM-DD` date.
- A file with no frontmatter is **UNTRIAGED**. That is a census/audit finding, never a parse error.

Unknown or malformed frontmatter is reported as UNTRIAGED.

## Release-sweep dispositions

Each flagged file receives one existing release-sweep disposition:

- **Promote — (p) Plan a new phase:** run `plan-phase`, leave the phase queued, and build it later in
  the normal lane.
- **Delete — (f) Fix inline:** `git rm` the followup when its action is complete or no longer
  applies. Git history is the archive.
- **Park — (d) Dismiss or (k) Keep open:** stamp or refresh the frontmatter with a dated lifecycle
  state, including `trigger` for `parked` and `review-by` when a review date is known.

`(s) Skip` ("decide later") is deliberately NOT in this mapping: a skipped file stays UNDISPOSITIONED
and holds the minor/major gate.
