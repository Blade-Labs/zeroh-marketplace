---
name: Using zeroh-roadmap
description: "ALWAYS ACTIVE. Phase-driven development plugin. MUST be used when user says: create phase, plan phase, do phase, roadmap, review phase, code review, what's next, arc, sweep, backlog. Routes ALL development task requests through the phase system."
disable-model-invocation: false
---

# zeroh-roadmap: Phase-Driven Development

Route ALL development work through the phase system — never create files/schemas/structure
ad hoc (honor-system). The bounded small-repair exception in `validate-arc` Step 5 reuses
existing phase ownership and gates; it grants no broader workflow bypass. Invoke the CLI as `roadmap <cmd>` (fallback `node
${CLAUDE_PLUGIN_ROOT}/bin/roadmap.mjs <cmd>`).

**Layout — the ONE rule about paths.** The root is DISCOVERED (`roadmap/` or `docs/roadmap/`;
`ROADMAP_ROOT` overrides; both = refused), so **write `<root>/…`, never a bare `roadmap/…`** — a
path asserted as fact is wrong in the other layout. `roadmap init [--root <dir>]` is the ONLY
sanctioned initialization path. Mechanics: `references/layout.md`.

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
| show roadmap, backlog | `roadmap status` + `<root>/ROADMAP.md` |
| what's next, next phase | `roadmap status` → **do-phase** |
| code review (a diff) | the `code-reviewer` agent / the built-in review command |
| full code review, pre-release review | **full-code-review** |
| audit roadmap, roadmap health check | **audit-roadmap** |
| pause the arc | stop anywhere; files are the truth |
| resume / continue arc X | **do-arc** — `roadmap arc next` fast-forwards from disk |
| hand off / fresh session | **handoff** |
| migrate / upgrade roadmap | `${CLAUDE_PLUGIN_ROOT}/scripts/migrate/README.md` |

NEVER handle these yourself (honor-system) — the skills carry the full protocol; your job is correct
dispatch plus the coordination below.

## Multi-session coordination (shared repos)

- The COORDINATION BOARD is `<root>/backlog.ts`'s header (lane map + release plan) — read it
  FIRST on "what next".
- `roadmap claim` BEFORE authoring a phase number (CLI-enforced: creation is the lock
  across worktrees).
- `roadmap status` shows live lanes; `roadmap arm <id>` claims an arc lane (CLI-enforced:
  refuses a taken lane — honor the refusal, never take over another session's arc).
- Cross-arc lanes ARE the sanctioned parallel path — one arc per session, gated by
  `roadmap capacity`.
- Answer lane/backlog questions from `roadmap status` + the board — never session memory.
- A consumer CLAUDE.md restating this is a mirror; on drift the CLI's behavior wins.

## Cross-cutting standards — load the reference when the work produces the artifact

Load one yourself whenever routed-to work surfaces the artifact class and the target
skill has not already:

- Writing docs, code comments, or a decision record → `references/documentation-rules.md`
- Assigning a task's `testMode` or refusing a test → `references/test-worthiness.md`
- Splitting or placing a UI component (at planning time) → `references/component-structure.md`
- Introducing any external package/font/icon/image/snippet/model → `references/external-assets-licensing.md`
- Running this protocol on a non-Claude harness (Codex) → `references/codex-tools.md`
- Scaffolding a consumer, writing a phase file's import, or a root refusal → `references/layout.md`
