---
name: Using zeroh-roadmap
description: "ALWAYS ACTIVE. Phase-driven development plugin. MUST be used when user says: create phase, plan phase, do phase, roadmap, review phase, code review. Routes ALL development task requests through the phase system."
disable-model-invocation: false
---

# zeroh-roadmap: Phase-Driven Development

**YOU MUST USE THIS PLUGIN FOR ALL DEVELOPMENT WORK.** Do not create files, schemas, or project structures on your own. Route everything through the phase system below.

## CRITICAL: First-Time Project Setup

**Before doing ANYTHING else**, check if `roadmap/phases/` exists in the project:

```bash
ls roadmap/phases/ 2>/dev/null
```

**If the directory does NOT exist**, you MUST scaffold the roadmap infrastructure FIRST:

1. Copy schema: `cp ${CLAUDE_PLUGIN_ROOT}/templates/schema.ts lib/roadmap/schema.ts` (create `lib/roadmap/` first)
2. Copy ROADMAP.md: `cp ${CLAUDE_PLUGIN_ROOT}/templates/ROADMAP.md roadmap/ROADMAP.md` (create `roadmap/` first)
3. Copy backlog: `cp ${CLAUDE_PLUGIN_ROOT}/templates/backlog.ts roadmap/backlog.ts`
4. Create phases dir: `mkdir -p roadmap/phases`
5. Create reviews dir: `mkdir -p reviews/releases`
6. Copy scripts: `cp ${CLAUDE_PLUGIN_ROOT}/scripts/{pre-review.sh,collect-phase-metrics.ts,build-dashboard.sh,generate-changelog-md.ts} scripts/` (create `scripts/` first)
7. Ensure `zod` is in dependencies: `pnpm add zod` (if not already)
8. Commit: `feat(roadmap): scaffold phase-driven development infrastructure`

**Do NOT skip this. Do NOT invent your own schema. Do NOT create phases manually.**

**If the directory DOES exist**, do a 1-line drift check against the plugin's current schema version. The canonical carries a `@zeroh-roadmap-schema vN` comment — read N from the plugin, compare against the target:

```bash
CANONICAL_VER=$(grep -oE '@zeroh-roadmap-schema v[0-9]+' "${CLAUDE_PLUGIN_ROOT}/templates/schema.ts" | head -1)
grep -qF "$CANONICAL_VER" lib/roadmap/schema.ts 2>/dev/null || echo "schema outdated"
```

Bumping the plugin's schema version is a single-line edit in `templates/schema.ts` — no migration of this grep needed.

If the output is `schema outdated`, print this one-line nudge to the user (once per session, do not repeat):

> ⚠️  New roadmap plugin update available. Tell me "upgrade the roadmap" or run `npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts` for a full upgrade report.

Do NOT run the audit automatically — the grep is the cheap sentinel, the audit is the expensive report the user opts into.

## Routing — What the User Says → What You Do

| User says | You MUST invoke |
|-----------|-----------------|
| "create phase for X", "plan phase for X", "add X to roadmap" | Invoke skill: **plan-phase** |
| "do phase N", "start phase N", "execute phase N" | Invoke skill: **do-phase** |
| "review phase N", "verify phase N", "check phase N" | Invoke skill: **review-phase** |
| "what's in the roadmap?", "show roadmap", "backlog" | Read `roadmap/ROADMAP.md` and list phases from `roadmap/phases/` |
| "what's next?", "next phase", "do next phase" | Read `roadmap/backlog.ts` — first entry is next to execute. Invoke **do-phase** |
| "code review", "review this code" | Invoke skill: **code-review** |
| "full code review", "pre-release review" | Invoke skill: **full-code-review** |
| "audit roadmap", "check roadmap consistency", "roadmap health check" | Invoke skill: **audit-roadmap** |
| "migrate roadmap", "upgrade roadmap", "apply the migration" | Run `npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts`, read the report, then drive remediation per the "Recommended next steps" section: schema first, missing scripts next, strict-fail phase files last. Confirm with user before every phase-file change. See `${CLAUDE_PLUGIN_ROOT}/scripts/migrate/README.md` for full details. |

**NEVER** handle these requests yourself. ALWAYS invoke the corresponding skill. The skills contain the full protocol — task format, validation gates, review agents, transparency reports.

## Phase Lifecycle

```
plan-phase    → creates phase-N.phase.ts (backlog)
do-phase N    → one task at a time, commit between each, gate at the end
do next phase → reads roadmap/backlog.ts, picks first entry
review-phase N → verify the work was done correctly
```

## What the Skills Do (summary — see each SKILL.md for full protocol)

- **plan-phase**: Reads the project code FIRST, identifies specific files and changes, writes a typed `.phase.ts` file with structured tasks. Each task has: problem context, implementation steps with file paths, acceptance criteria.
- **do-phase**: Executes ONE task at a time. Commits after each. Runs type-check between tasks. Full validation gate after all tasks. Transparency report per task. Compromise summary before marking done.
- **review-phase**: Two modes — Plan Quality (backlog: verify files exist, source confirms problem, pattern completeness) or Post-Execution Audit (done: verify claimed changes exist, bug actually fixed, pattern caught everywhere).
- **code-review**: Confidence-filtered (>=80% only). Reports severity + file:line + fix.
- **full-code-review**: 8 parallel specialist agents. Required before release.
- **audit-roadmap**: Cross-phase structural audit. 8 checks (dangling deps, cycles, clarification markers, stale phases, etc.). Never reads source code; read-only report.

## Migration (one-off, not a skill)

`scripts/migrate/audit.ts` is the plugin-version upgrade tool. It lives under `${CLAUDE_PLUGIN_ROOT}/scripts/migrate/` and is **never copied into the target repo** — migration tooling is disposable by design. The SessionStart drift check above surfaces it exactly when needed; the routing table row above drives the interactive remediation when the user says "migrate roadmap".
