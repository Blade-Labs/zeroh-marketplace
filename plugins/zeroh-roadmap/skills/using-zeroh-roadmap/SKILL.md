---
name: Using zeroh-roadmap
description: "ALWAYS ACTIVE. Phase-driven development plugin. MUST be used when user says: create phase, plan phase, do phase, roadmap, review phase, code review. Routes ALL development task requests through the phase system."
disable-model-invocation: false
---

# zeroh-roadmap: Phase-Driven Development

Route ALL development work through the phase system — never create files/schemas/structure ad hoc.
Invoke the CLI as `roadmap <cmd>` (fallback `node
${CLAUDE_PLUGIN_ROOT}/bin/roadmap.mjs <cmd>`). A bare repo → `roadmap init` scaffolds `roadmap/` +
`roadmap.config.json`.

## Routing — what the user says → what you invoke

| User says | Invoke |
|---|---|
| create / plan phase, add to roadmap | **plan-phase** |
| do / start / execute phase N | **do-phase** |
| review / verify / check phase N | **review-phase** |
| plan / create / new arc | **plan-arc** |
| do / execute / run arc | **do-arc** |
| arc sweep, pre-merge sweep | **arc-sweep** |
| validate arc, intent validation | **validate-arc** |
| arc landed / eval the arc | **eval-arc** (do-arc Step 9 auto-runs it) |
| show roadmap, backlog | `roadmap status` + `roadmap/ROADMAP.md` |
| what's next, next phase | `roadmap status` → **do-phase** |
| code review | **code-review** |
| full code review, pre-release review | **full-code-review** |
| audit roadmap, roadmap health check | **audit-roadmap** |
| pause the arc | stop anywhere; resume = relaunch the plane workflow |
| resume / continue arc X | **do-arc** — `roadmap arc next` fast-forwards from disk |
| migrate / upgrade roadmap | `${CLAUDE_PLUGIN_ROOT}/scripts/migrate/README.md` |

NEVER handle these yourself — the skills carry the full protocol.

## Multi-session coordination (shared repos)

- The COORDINATION BOARD is `roadmap/backlog.ts`'s header (lane map + release plan) — read it FIRST
  on "what next".
- `roadmap claim` BEFORE authoring a phase number (creation-is-the-lock, shared across worktrees).
- `roadmap status` shows live lanes; `roadmap arm <id>` claims an arc lane, refusing a taken one.
