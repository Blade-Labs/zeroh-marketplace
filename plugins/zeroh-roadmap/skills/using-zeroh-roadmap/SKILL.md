---
name: Using zeroh-roadmap
description: "ALWAYS ACTIVE. Phase-driven development plugin. MUST be used when user says: create phase, plan phase, do phase, roadmap, review phase, code review, what's next, arc, sweep, backlog. Routes ALL development task requests through the phase system."
disable-model-invocation: false
---

# zeroh-roadmap: Phase-Driven Development

Route ALL development work through the phase system — never create files/schemas/structure
ad hoc (honor-system: no hook blocks this; the routing table is the control).
Invoke the CLI as `roadmap <cmd>` (fallback `node
${CLAUDE_PLUGIN_ROOT}/bin/roadmap.mjs <cmd>`). A bare repo → `roadmap init` scaffolds
`roadmap/` + `roadmap.config.json` — the ONLY sanctioned initialization path.

## Routing — what the user says → what you invoke

| User says | Invoke |
|---|---|
| create / plan phase, add to roadmap | **plan-phase** |
| do / start / execute phase N | **do-phase** |
| review / verify / check phase N | **review-phase** |
| plan / create / new arc | **plan-arc** |
| do / execute / run arc | **do-arc** |
| arc sweep, pre-merge sweep | **arc-sweep** |
| release sweep, resolve release debts | **release-sweep** — manual-only; ask the user to run `/release-sweep` |
| validate arc, intent validation | **validate-arc** |
| arc landed / eval the arc | **eval-arc** (do-arc Step 9 auto-runs it) |
| show roadmap, backlog | `roadmap status` + `roadmap/ROADMAP.md` |
| what's next, next phase | `roadmap status` → **do-phase** |
| code review (a diff) | the `code-reviewer` agent / the built-in review command (skill retired 2026-08-14, no outcome delta) |
| full code review, pre-release review | **full-code-review** |
| audit roadmap, roadmap health check | **audit-roadmap** |
| pause the arc | stop anywhere; resume = relaunch the plane workflow |
| resume / continue arc X | **do-arc** — `roadmap arc next` fast-forwards from disk |
| migrate / upgrade roadmap | `${CLAUDE_PLUGIN_ROOT}/scripts/migrate/README.md` |

NEVER handle these yourself — the skills carry the full protocol; your job ends at
correct dispatch plus the coordination steps below (honor-system: no mechanism blocks
inline handling — the review gates catch its artifacts, not the act).

## Multi-session coordination (shared repos)

- The COORDINATION BOARD is `roadmap/backlog.ts`'s header (lane map + release plan) —
  read it FIRST on "what next".
- `roadmap claim` BEFORE authoring a phase number (CLI-enforced: creation-is-the-lock,
  shared across worktrees).
- `roadmap status` shows live lanes; `roadmap arm <id>` claims an arc lane (CLI-enforced:
  refuses a taken lane — honor the refusal, never take over another session's arc).
- Answer roadmap/lane/backlog questions from `roadmap status`, `roadmap/ROADMAP.md`, and
  the board — never from session memory.
- A consumer repo's CLAUDE.md restating this protocol is a mirror; this skill is the
  owner — on drift, the CLI's actual behavior wins.

## Cross-cutting standards — load the reference when the work produces the artifact

Downstream skills cite these same files at their own steps; load one yourself whenever
routed-to work surfaces the artifact class and the target skill has not already:

- Writing docs, code comments, or a decision record → `references/documentation-rules.md`
- Assigning a task's `testMode` or refusing a test → `references/test-worthiness.md`
- Splitting or placing a UI component (at planning time) → `references/component-structure.md`
- Introducing any external package/font/icon/image/snippet/model → `references/external-assets-licensing.md`

Provenance: this routing is exercised in the primary consumer repo — 16 ArcEvalReports
under `roadmap/arc-evals/*.json` (2026-07-19 → 2026-08-12).
